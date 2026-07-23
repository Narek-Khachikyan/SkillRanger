import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { RunFileLock, type RunFileLockHooks } from "../runtime/run-lock.ts";
import type { RouterJournalEntry, RouterRun } from "./types.ts";

const routeIdPattern = /^route_[a-z0-9_-]{7,127}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const dateTimePattern = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const maxJournalEntries = 128;
const maxRouterDirectoryEntries = 4096;
const identityKeyBytes = 32;

const isErrno = (error: unknown, code: string): error is NodeJS.ErrnoException => (
  error instanceof Error && "code" in error && error.code === code
);

const canonicalizeJson = (value: unknown): string => {
  const order = (nested: unknown): unknown => {
    if (Array.isArray(nested)) return nested.map(order);
    if (typeof nested !== "object" || nested === null) return nested;
    return Object.fromEntries(
      Object.entries(nested as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, order(child)]),
    );
  };
  return JSON.stringify(order(value));
};

const digest = (value: unknown) => `sha256:${createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex")}`;

const safeRelativePath = (value: string) => {
  const normalized = value.replace(/\\/g, "/");
  return !path.isAbsolute(value) && normalized.split("/").every((segment) => segment && segment !== "." && segment !== "..");
};

const object = (value: unknown, at: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${at} must be an object.`);
  return value as Record<string, unknown>;
};

const keys = (value: unknown, required: string[], optional: string[], at: string) => {
  const record = object(value, at);
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown) fail(`${at} contains unknown property ${unknown}.`);
  const missing = required.find((key) => !Object.hasOwn(record, key));
  if (missing) fail(`${at} is missing required property ${missing}.`);
  return record;
};

const string = (value: unknown, at: string, nonEmpty = false) => {
  if (typeof value !== "string" || (nonEmpty && value.length === 0)) return fail(`${at} must be ${nonEmpty ? "a non-empty " : "a "}string.`);
  return value as string;
};

const boolean = (value: unknown, at: string) => {
  if (typeof value !== "boolean") return fail(`${at} must be a boolean.`);
  return value as boolean;
};

const integer = (value: unknown, at: string) => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`${at} must be a non-negative integer.`);
  return value as number;
};

const enumeration = (value: unknown, allowed: ReadonlySet<string>, at: string) => {
  if (typeof value !== "string" || !allowed.has(value)) return fail(`${at} has an invalid value.`);
  return value as string;
};

const stringArray = (value: unknown, at: string) => {
  if (!Array.isArray(value)) return fail(`${at} must be an array.`);
  return value.map((item, index) => string(item, `${at}[${index}]`));
};

const uniqueStringArray = (value: unknown, at: string) => {
  const values = stringArray(value, at);
  if (new Set(values).size !== values.length) fail(`${at} must contain unique values.`);
  return values;
};

const digestValue = (value: unknown, at: string) => {
  const result = string(value, at);
  if (!digestPattern.test(result)) return fail(`${at} must be a canonical SHA-256 value.`);
  return result;
};

const dateTime = (value: unknown, at: string) => {
  const result = string(value, at);
  if (!dateTimePattern.test(result) || Number.isNaN(Date.parse(result))) return fail(`${at} must be a valid date-time.`);
  return result;
};

const date = (value: unknown, at: string) => {
  const result = string(value, at);
  const [year, month, day] = result.split("-").map(Number);
  const maxDay = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (!datePattern.test(result) || !Number.isInteger(year) || day < 1 || day > maxDay) return fail(`${at} must be a valid date.`);
  return result;
};

const fail = (message: string): never => {
  throw new RouterStoreError("run-integrity", message);
};

const validateEvidence = (value: unknown, at: string) => {
  const record = keys(value, ["source", "kind", "id"], [], at);
  enumeration(record.source, new Set(["prompt", "fingerprint", "registry", "config"]), `${at}.source`);
  enumeration(record.kind, new Set(["action", "artifact", "technology", "quality", "domain", "constraint", "acceptance"]), `${at}.kind`);
  string(record.id, `${at}.id`, true);
};

const validateDomain = (value: unknown, at: string) => {
  const record = keys(value, ["id", "confidence", "role", "available", "reasons", "evidence"], [], at);
  string(record.id, `${at}.id`, true);
  if (typeof record.confidence !== "number" || !Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) fail(`${at}.confidence must be between 0 and 1.`);
  enumeration(record.role, new Set(["primary", "supporting"]), `${at}.role`);
  boolean(record.available, `${at}.available`);
  stringArray(record.reasons, `${at}.reasons`);
  if (!Array.isArray(record.evidence)) fail(`${at}.evidence must be an array.`);
  (record.evidence as unknown[]).forEach((item, index) => validateEvidence(item, `${at}.evidence[${index}]`));
};

const validateTaskProfile = (value: unknown, at: string) => {
  const record = keys(value, ["schemaVersion", "normalizedGoal", "locale", "actions", "artifactTypes", "technologies", "constraints", "qualityGoals", "acceptanceCriteria", "domains", "subtasks", "evidence"], [], at);
  if (record.schemaVersion !== "task-profile/1.0") fail(`${at}.schemaVersion is invalid.`);
  string(record.normalizedGoal, `${at}.normalizedGoal`);
  enumeration(record.locale, new Set(["en", "ru", "mixed", "unknown"]), `${at}.locale`);
  for (const field of ["actions", "artifactTypes", "technologies", "constraints", "qualityGoals", "acceptanceCriteria"]) stringArray(record[field], `${at}.${field}`);
  if (!Array.isArray(record.domains)) fail(`${at}.domains must be an array.`);
  (record.domains as unknown[]).forEach((item, index) => validateDomain(item, `${at}.domains[${index}]`));
  if (!Array.isArray(record.subtasks)) fail(`${at}.subtasks must be an array.`);
  (record.subtasks as unknown[]).forEach((item, index) => {
    const subtask = keys(item, ["id", "normalizedGoal", "actions", "artifactTypes", "candidateDomainIds"], [], `${at}.subtasks[${index}]`);
    string(subtask.id, `${at}.subtasks[${index}].id`, true);
    string(subtask.normalizedGoal, `${at}.subtasks[${index}].normalizedGoal`);
    stringArray(subtask.actions, `${at}.subtasks[${index}].actions`);
    stringArray(subtask.artifactTypes, `${at}.subtasks[${index}].artifactTypes`);
    stringArray(subtask.candidateDomainIds, `${at}.subtasks[${index}].candidateDomainIds`);
  });
  if (!Array.isArray(record.evidence)) fail(`${at}.evidence must be an array.`);
  (record.evidence as unknown[]).forEach((item, index) => validateEvidence(item, `${at}.evidence[${index}]`));
};

const validateSelection = (value: unknown, at: string) => {
  const record = keys(value, ["skillId", "displayName", "role", "domains", "version", "packageChecksum", "score", "source", "reasons", "verificationStatus"], [], at);
  string(record.skillId, `${at}.skillId`, true);
  string(record.displayName, `${at}.displayName`, true);
  enumeration(record.role, new Set(["environment", "primary", "companion", "verification", "agent-context"]), `${at}.role`);
  stringArray(record.domains, `${at}.domains`);
  string(record.version, `${at}.version`, true);
  digestValue(record.packageChecksum, `${at}.packageChecksum`);
  if (typeof record.score !== "number" || !Number.isFinite(record.score) || record.score < 0 || record.score > 1) fail(`${at}.score must be between 0 and 1.`);
  enumeration(record.source, new Set(["installed", "bundled-registry", "test-fixture-registry"]), `${at}.source`);
  stringArray(record.reasons, `${at}.reasons`);
  enumeration(record.verificationStatus, new Set(["ready", "guidance-only", "not-required"]), `${at}.verificationStatus`);
};

const validateSelections = (value: unknown, at: string) => {
  const record = keys(value, ["environment", "primary", "companions", "verification", "agentContext"], [], at);
  for (const field of ["environment", "companions", "verification", "agentContext"]) {
    if (!Array.isArray(record[field])) fail(`${at}.${field} must be an array.`);
    (record[field] as unknown[]).forEach((item, index) => validateSelection(item, `${at}.${field}[${index}]`));
  }
  validateSelection(record.primary, `${at}.primary`);
};

const validateSource = (value: unknown, at: string) => {
  const record = keys(value, ["skillId", "source", "version", "packageChecksum", "auditDigest", "rootIdentity", "locator", "files"], [], at);
  string(record.skillId, `${at}.skillId`, true);
  enumeration(record.source, new Set(["installed", "bundled-registry", "test-fixture-registry"]), `${at}.source`);
  string(record.version, `${at}.version`, true);
  digestValue(record.packageChecksum, `${at}.packageChecksum`);
  digestValue(record.auditDigest, `${at}.auditDigest`);
  digestValue(record.rootIdentity, `${at}.rootIdentity`);
  const locator = object(record.locator, `${at}.locator`);
  if (locator.kind === "installed") {
    keys(locator, ["kind", "targetAgent", "installedPath"], [], `${at}.locator`);
    string(locator.targetAgent, `${at}.locator.targetAgent`, true);
    const installedPath = string(locator.installedPath, `${at}.locator.installedPath`, true);
    if (!safeRelativePath(installedPath)) fail(`${at}.locator.installedPath must be a safe project-relative path.`);
  } else {
    keys(locator, ["kind", "skillId"], [], `${at}.locator`);
    enumeration(locator.kind, new Set(["bundled-registry", "test-fixture-registry"]), `${at}.locator.kind`);
    string(locator.skillId, `${at}.locator.skillId`, true);
  }
  if (!Array.isArray(record.files)) fail(`${at}.files must be an array.`);
  (record.files as unknown[]).forEach((item, index) => {
    const file = keys(item, ["path", "checksum", "bytes", "mimeType", "mandatory"], [], `${at}.files[${index}]`);
    string(file.path, `${at}.files[${index}].path`, true);
    digestValue(file.checksum, `${at}.files[${index}].checksum`);
    integer(file.bytes, `${at}.files[${index}].bytes`);
    enumeration(file.mimeType, new Set(["text/markdown", "text/plain", "application/json"]), `${at}.files[${index}].mimeType`);
    boolean(file.mandatory, `${at}.files[${index}].mandatory`);
  });
};

const validateReceipt = (value: unknown, at: string) => {
  const record = keys(value, ["readRequestId", "expectedReadRevision", "resultingReadRevision", "mode", "skillId", "path", "fileChecksum", "offset", "bytes", "chunkChecksum", "deliveredAt"], [], at);
  string(record.readRequestId, `${at}.readRequestId`, true);
  integer(record.expectedReadRevision, `${at}.expectedReadRevision`);
  integer(record.resultingReadRevision, `${at}.resultingReadRevision`);
  enumeration(record.mode, new Set(["mandatory-next", "optional-file"]), `${at}.mode`);
  string(record.skillId, `${at}.skillId`, true);
  string(record.path, `${at}.path`, true);
  digestValue(record.fileChecksum, `${at}.fileChecksum`);
  integer(record.offset, `${at}.offset`);
  integer(record.bytes, `${at}.bytes`);
  digestValue(record.chunkChecksum, `${at}.chunkChecksum`);
  dateTime(record.deliveredAt, `${at}.deliveredAt`);
};

export function assertValidRouterRun(value: unknown): asserts value is RouterRun {
  const record = keys(value, ["schemaVersion", "routerRunId", "revision", "readRevision", "state", "createdAt", "updatedAt", "projectIdentity", "taskProfile", "routing", "selections", "sourceInventory", "readLedger", "runtime"], ["failure"], "routerRun");
  if (record.schemaVersion !== "router-run/1.0") fail("routerRun.schemaVersion is invalid.");
  if (typeof record.routerRunId !== "string" || !routeIdPattern.test(record.routerRunId)) fail("routerRun.routerRunId is invalid.");
  integer(record.revision, "routerRun.revision");
  integer(record.readRevision, "routerRun.readRevision");
  enumeration(record.state, new Set(["prepared", "reading", "ready", "failed"]), "routerRun.state");
  dateTime(record.createdAt, "routerRun.createdAt");
  dateTime(record.updatedAt, "routerRun.updatedAt");
  digestValue(record.projectIdentity, "routerRun.projectIdentity");
  validateTaskProfile(record.taskProfile, "routerRun.taskProfile");

  const routing = keys(record.routing, ["targetAgent", "domains", "deterministicKey", "routerAlgorithmVersion", "routingDate", "fingerprintDigest", "registryDigest", "configDigest"], [], "routerRun.routing");
  string(routing.targetAgent, "routerRun.routing.targetAgent", true);
  if (!Array.isArray(routing.domains)) fail("routerRun.routing.domains must be an array.");
  (routing.domains as unknown[]).forEach((item, index) => validateDomain(item, `routerRun.routing.domains[${index}]`));
  digestValue(routing.deterministicKey, "routerRun.routing.deterministicKey");
  string(routing.routerAlgorithmVersion, "routerRun.routing.routerAlgorithmVersion", true);
  date(routing.routingDate, "routerRun.routing.routingDate");
  digestValue(routing.fingerprintDigest, "routerRun.routing.fingerprintDigest");
  digestValue(routing.registryDigest, "routerRun.routing.registryDigest");
  digestValue(routing.configDigest, "routerRun.routing.configDigest");
  validateSelections(record.selections, "routerRun.selections");

  if (!Array.isArray(record.sourceInventory)) fail("routerRun.sourceInventory must be an array.");
  (record.sourceInventory as unknown[]).forEach((item, index) => validateSource(item, `routerRun.sourceInventory[${index}]`));
  if (!Array.isArray(record.readLedger)) fail("routerRun.readLedger must be an array.");
  (record.readLedger as unknown[]).forEach((item, index) => validateReceipt(item, `routerRun.readLedger[${index}]`));
  const runtime = keys(record.runtime, ["kind", "runId"], [], "routerRun.runtime");
  enumeration(runtime.kind, new Set(["lifecycle-v1", "strict-v2"]), "routerRun.runtime.kind");
  string(runtime.runId, "routerRun.runtime.runId", true);
  if (record.failure !== undefined) {
    const failure = keys(record.failure, ["code", "reasonCode"], [], "routerRun.failure");
    enumeration(failure.code, new Set(["run-integrity", "source-unavailable", "recovery-required"]), "routerRun.failure.code");
    string(failure.reasonCode, "routerRun.failure.reasonCode", true);
  }
}

export type RouterStoreErrorCode = "run-not-found" | "run-integrity" | "identity-integrity" | "recovery-required";

export class RouterStoreError extends Error {
  readonly code: RouterStoreErrorCode;

  constructor(code: RouterStoreErrorCode, message: string) {
    super(message);
    this.name = "RouterStoreError";
    this.code = code;
  }
}

export type RouterRuntimeStore = {
  read(runId: string): Promise<unknown | undefined>;
  create(runId: string, value: unknown): Promise<void>;
  replace?(runId: string, value: unknown): Promise<void>;
};

type JournalPayload = RouterJournalEntry & {
  routerRun: RouterRun;
  runtimePayload?: unknown;
};

export type RouterStoreOptions = {
  hooks?: RunFileLockHooks;
  runtime?: RouterRuntimeStore;
  maxJournalEntries?: number;
  lockTimeoutMs?: number;
  staleLockMs?: number;
};

export type JournaledCreateInput = {
  routerRun: RouterRun;
  runtimePayload: unknown;
  runtime: RouterRuntimeStore;
};

export type JournaledUpdateInput = {
  routerRun: RouterRun;
  runtime: RouterRuntimeStore;
  runtimePayload: unknown;
  applyRuntime: () => Promise<void>;
};

export type RouterRuntimeUpdate = {
  runtime: RouterRuntimeStore;
  runtimePayload: unknown;
  applyRuntime: () => Promise<void>;
};

export type RouterRecoveryResult = {
  recovered: string[];
  inspected: number;
};

const safePath = (value: string) => value.replace(/\\/g, "/");

export class RouterStore {
  private readonly input: RouterStoreOptions;
  private readonly lock: RunFileLock;
  private readonly projectRootInput: string;
  private canonicalRoot?: string;
  private identityKey?: Buffer;
  private prepared = false;
  private preparing?: Promise<void>;

  constructor(projectRoot: string, input: RouterStoreOptions = {}) {
    this.projectRootInput = projectRoot;
    this.input = input;
    this.lock = new RunFileLock({
      lockPath: (runId) => this.runPath(runId).replace(/\.json$/, ".lock"),
      error: (message) => new RouterStoreError("run-integrity", message),
      hooks: input.hooks,
      lockTimeoutMs: input.lockTimeoutMs,
      staleLockMs: input.staleLockMs,
    });
  }

  private async root(): Promise<string> {
    if (this.canonicalRoot) return this.canonicalRoot;
    try {
      this.canonicalRoot = await realpath(this.projectRootInput);
    } catch {
      throw new RouterStoreError("identity-integrity", "Project root cannot be canonicalized.");
    }
    const metadata = await lstat(this.canonicalRoot).catch(() => undefined);
    if (!metadata?.isDirectory() || metadata.isSymbolicLink()) throw new RouterStoreError("identity-integrity", "Project root must be a canonical directory.");
    return this.canonicalRoot;
  }

  private skillRangerPath() {
    return path.join(this.canonicalRoot ?? path.resolve(this.projectRootInput), ".skillranger");
  }

  private routerDirectory() {
    return path.join(this.skillRangerPath(), "runs", "router");
  }

  private runPath(runId: string) {
    if (!routeIdPattern.test(runId)) throw new RouterStoreError("run-integrity", `Invalid router run id: ${runId}`);
    return path.join(this.routerDirectory(), `${runId}.json`);
  }

  private journalPath(runId: string) {
    return path.join(this.routerDirectory(), `${runId}.journal.json`);
  }

  private async ensureDirectory(target: string) {
    const root = await this.root();
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new RouterStoreError("run-integrity", "Router storage path escapes project root.");
    let current = root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      const metadata = await lstat(current).catch((error: unknown) => {
        if (isErrno(error, "ENOENT")) return undefined;
        throw error;
      });
      if (metadata?.isSymbolicLink()) throw new RouterStoreError("run-integrity", `Router storage path contains a symbolic link: ${current}`);
      if (metadata && !metadata.isDirectory()) throw new RouterStoreError("run-integrity", `Router storage path is not a directory: ${current}`);
      if (!metadata) await mkdir(current, { mode: 0o700 });
      const verified = await lstat(current);
      if (verified.isSymbolicLink() || !verified.isDirectory()) throw new RouterStoreError("run-integrity", `Router storage path changed during creation: ${current}`);
    }
  }

  private async listRouterDirectory() {
    const entries: string[] = [];
    let directory;
    try { directory = await opendir(this.routerDirectory()); } catch (error) {
      if (isErrno(error, "ENOENT")) return entries;
      throw new RouterStoreError("recovery-required", "Router directory cannot be scanned securely.");
    }
    try {
      for await (const entry of directory) {
        entries.push(entry.name);
        if (entries.length > maxRouterDirectoryEntries) throw new RouterStoreError("recovery-required", `Router directory exceeds ${maxRouterDirectoryEntries} entries.`);
      }
    } finally { await directory.close().catch(() => undefined); }
    return entries.sort();
  }

  private async readRegularFile(target: string, notFound: RouterStoreErrorCode, label: string) {
    let metadata;
    try {
      metadata = await lstat(target);
    } catch (error) {
      if (isErrno(error, "ENOENT")) throw new RouterStoreError(notFound, `${label} not found.`);
      throw new RouterStoreError("run-integrity", `${label} cannot be inspected.`);
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new RouterStoreError("run-integrity", `${label} must be a regular file.`);
    let handle;
    try {
      handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const opened = await handle.stat();
      if (!opened.isFile()) throw new RouterStoreError("run-integrity", `${label} must be a regular file.`);
      return await handle.readFile("utf8");
    } catch (error) {
      if (error instanceof RouterStoreError) throw error;
      throw new RouterStoreError("run-integrity", `${label} cannot be read securely.`);
    } finally {
      await handle?.close();
    }
  }

  private async writeAtomic(target: string, source: string, mode = 0o600) {
    await this.ensureDirectory(path.dirname(target));
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, source, { encoding: "utf8", flag: "wx", mode });
      await this.ensureDirectory(path.dirname(target));
      const temporaryMetadata = await lstat(temporary);
      if (temporaryMetadata.isSymbolicLink() || !temporaryMetadata.isFile()) throw new RouterStoreError("run-integrity", "Atomic router temporary file changed before commit.");
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!isErrno(error, "ENOENT")) throw error;
      });
    }
  }

  private async ensureIdentityKey(): Promise<Buffer> {
    await this.ensureDirectory(this.skillRangerPath());
    const target = path.join(this.skillRangerPath(), "identity.key");
    let source: Buffer;
    try {
      const metadata = await lstat(target);
      if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size !== identityKeyBytes || (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)) {
        throw new RouterStoreError("identity-integrity", "Router identity key is malformed or not owner-only.");
      }
      let handle;
      try {
        handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const opened = await handle.stat();
        if (!opened.isFile() || opened.size !== identityKeyBytes || (process.platform !== "win32" && (opened.mode & 0o077) !== 0)) throw new RouterStoreError("identity-integrity", "Router identity key changed or permissions are unsafe.");
        source = await handle.readFile();
      } finally {
        await handle?.close();
      }
    } catch (error) {
      if (error instanceof RouterStoreError) throw error;
      if (!isErrno(error, "ENOENT")) throw new RouterStoreError("identity-integrity", "Router identity key cannot be read safely.");
      source = randomBytes(identityKeyBytes);
      let handle;
      try {
        handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
        await handle.writeFile(source);
      } catch (writeError) {
        if (isErrno(writeError, "EEXIST")) return this.ensureIdentityKey();
        throw new RouterStoreError("identity-integrity", "Router identity key cannot be created safely.");
      } finally {
        await handle?.close();
      }
    }
    if (source.byteLength !== identityKeyBytes) throw new RouterStoreError("identity-integrity", "Router identity key has an invalid length.");
    if (this.identityKey && !this.identityKey.equals(source)) throw new RouterStoreError("identity-integrity", "Router identity key mutated during this process.");
    this.identityKey = Buffer.from(source);
    return this.identityKey;
  }

  private async calculatedProjectIdentity(): Promise<string> {
    const root = await this.root();
    const key = await this.ensureIdentityKey();
    return `sha256:${createHmac("sha256", key).update(root, "utf8").digest("hex")}`;
  }

  private async assertStoredIdentity() {
    const expected = await this.calculatedProjectIdentity();
    const entries = await this.listRouterDirectory();
    for (const entry of entries.filter((name) => name.endsWith(".json") && !name.endsWith(".journal.json"))) {
      if (!routeIdPattern.test(entry.slice(0, -".json".length))) throw new RouterStoreError("run-integrity", `Malformed router record filename: ${entry}`);
      const record = await this.readRunUnlocked(entry.slice(0, -".json".length));
      if (record.projectIdentity !== expected) throw new RouterStoreError("identity-integrity", "Router identity key does not match persisted run records.");
    }
  }

  private async assertRunIdentity(run: RouterRun) {
    if (run.projectIdentity !== await this.calculatedProjectIdentity()) {
      throw new RouterStoreError("identity-integrity", "Router run project identity does not match the project identity key.");
    }
  }

  private async ensurePrepared() {
    if (this.prepared) {
      await this.ensureIdentityKey();
      await this.assertStoredIdentity();
      await this.recoverInternal();
      return;
    }
    if (!this.preparing) {
      this.preparing = (async () => {
        await this.root();
        await this.ensureIdentityKey();
        await this.ensureDirectory(this.routerDirectory());
        await this.recoverInternal();
        this.prepared = true;
      })();
    }
    try { await this.preparing; }
    finally { this.preparing = undefined; }
  }

  private async readRunUnlocked(runId: string): Promise<RouterRun> {
    const source = await this.readRegularFile(this.runPath(runId), "run-not-found", `Router run ${runId}`);
    let parsed: unknown;
    try { parsed = JSON.parse(source); } catch { throw new RouterStoreError("run-integrity", `Router run ${runId} is not valid JSON.`); }
    assertValidRouterRun(parsed);
    if (parsed.routerRunId !== runId) throw new RouterStoreError("run-integrity", "Persisted router run ID does not match its file name.");
    return parsed;
  }

  private async writeRunUnlocked(run: RouterRun, createOnly = false) {
    assertValidRouterRun(run);
    const target = this.runPath(run.routerRunId);
    if (createOnly) {
      const metadata = await lstat(target).catch((error: unknown) => {
        if (isErrno(error, "ENOENT")) return undefined;
        throw error;
      });
      if (metadata) throw new RouterStoreError("run-integrity", `Router run already exists: ${run.routerRunId}`);
    }
    await this.writeAtomic(target, `${JSON.stringify(run, null, 2)}\n`);
  }

  private async readJournal(runId: string): Promise<JournalPayload> {
    const source = await this.readRegularFile(this.journalPath(runId), "run-not-found", `Router journal ${runId}`);
    let parsed: unknown;
    try { parsed = JSON.parse(source); } catch { throw new RouterStoreError("run-integrity", `Router journal ${runId} is not valid JSON.`); }
    const record = keys(parsed, ["schemaVersion", "operationId", "routerRunId", "runtimeRunId", "payloadDigest", "intendedTransition", "createdAt", "routerRun"], ["runtimePayload"], "routerJournal");
    if (record.schemaVersion !== "router-journal/1.0") throw new RouterStoreError("run-integrity", "Router journal schema version is invalid.");
    string(record.operationId, "routerJournal.operationId", true);
    if (record.routerRunId !== runId) throw new RouterStoreError("run-integrity", "Router journal ID does not match its file name.");
    string(record.runtimeRunId, "routerJournal.runtimeRunId", true);
    digestValue(record.payloadDigest, "routerJournal.payloadDigest");
    enumeration(record.intendedTransition, new Set(["create-runtime-and-router", "record-read"]), "routerJournal.intendedTransition");
    dateTime(record.createdAt, "routerJournal.createdAt");
    assertValidRouterRun(record.routerRun);
    if (record.routerRun.routerRunId !== runId) throw new RouterStoreError("run-integrity", "Router journal payload ID does not match its file name.");
    const expectedPayload = { routerRun: record.routerRun, ...(Object.hasOwn(record, "runtimePayload") ? { runtimePayload: record.runtimePayload } : {}) };
    if (record.payloadDigest !== digest(expectedPayload)) throw new RouterStoreError("run-integrity", "Router journal payload digest mismatch.");
    return record as unknown as JournalPayload;
  }

  private async recoverJournal(record: JournalPayload) {
    const runtime = this.input.runtime;
    if (record.intendedTransition === "create-runtime-and-router") {
      if (!runtime || !Object.hasOwn(record, "runtimePayload")) throw new RouterStoreError("recovery-required", "Runtime adapter is required to recover a cross-store journal.");
      const existingRuntime = await runtime.read(record.runtimeRunId);
      if (existingRuntime === undefined) await runtime.create(record.runtimeRunId, record.runtimePayload);
      else if (digest(existingRuntime) !== digest(record.runtimePayload)) throw new RouterStoreError("run-integrity", "Existing runtime record does not match the journal payload.");
    } else if (!runtime || !Object.hasOwn(record, "runtimePayload")) {
      throw new RouterStoreError("recovery-required", "Runtime adapter is required to recover a read journal.");
    } else {
      let existingRuntime = await runtime.read(record.runtimeRunId);
      if (existingRuntime === undefined) throw new RouterStoreError("recovery-required", "Runtime read bridge target is unavailable.");
      if (digest(existingRuntime) !== digest(record.runtimePayload)) {
        if (!runtime.replace) throw new RouterStoreError("recovery-required", "Runtime read bridge was not committed before interruption.");
        await runtime.replace(record.runtimeRunId, record.runtimePayload);
        existingRuntime = await runtime.read(record.runtimeRunId);
        if (existingRuntime === undefined || digest(existingRuntime) !== digest(record.runtimePayload)) {
          throw new RouterStoreError("recovery-required", "Runtime read bridge recovery did not persist the expected payload.");
        }
      }
    }
    const lock = await this.lock.acquire(record.routerRunId);
    try {
      let existing: RouterRun | undefined;
      try { existing = await this.readRunUnlocked(record.routerRunId); } catch (error) {
        if (!(error instanceof RouterStoreError) || error.code !== "run-not-found") throw error;
      }
      if (existing) {
        if (digest(existing) !== digest(record.routerRun)) {
          if (record.intendedTransition !== "record-read" || existing.revision + 1 !== record.routerRun.revision) {
            throw new RouterStoreError("run-integrity", "Existing router record does not match the journal payload.");
          }
          await this.writeRunUnlocked(record.routerRun);
        }
      } else {
        await this.writeRunUnlocked(record.routerRun, true);
      }
    } finally {
      await this.lock.release(lock);
    }
    await unlink(this.journalPath(record.routerRunId)).catch((error: unknown) => {
      if (!isErrno(error, "ENOENT")) throw error;
    });
  }

  private async recoverInternal(): Promise<RouterRecoveryResult> {
    const entries = await this.listRouterDirectory();
    const journalEntries = entries.filter((entry) => entry.endsWith(".journal.json")).sort();
    const limit = this.input.maxJournalEntries ?? maxJournalEntries;
    if (journalEntries.length > limit) throw new RouterStoreError("recovery-required", `Router journal directory exceeds the bounded limit of ${limit} entries.`);
    const recovered: string[] = [];
    for (const entry of journalEntries) {
      if (!/^route_[a-z0-9_-]{7,127}\.journal\.json$/.test(entry)) throw new RouterStoreError("run-integrity", `Malformed router journal filename: ${entry}`);
      const runId = entry.slice(0, -".journal.json".length);
      const record = await this.readJournal(runId);
      if (record.routerRun.projectIdentity !== await this.projectIdentity()) throw new RouterStoreError("identity-integrity", "Router journal identity does not match the project identity key.");
      await this.recoverJournal(record);
      recovered.push(runId);
    }
    return { recovered, inspected: journalEntries.length };
  }

  async recover(): Promise<RouterRecoveryResult> {
    await this.root();
    await this.ensureIdentityKey();
    await this.ensureDirectory(this.routerDirectory());
    return this.recoverInternal();
  }

  async projectIdentity(): Promise<string> {
    const identity = await this.calculatedProjectIdentity();
    await this.ensureDirectory(this.routerDirectory());
    await this.assertStoredIdentity();
    return identity;
  }

  async create(run: RouterRun): Promise<RouterRun> {
    await this.ensurePrepared();
    assertValidRouterRun(run);
    await this.assertRunIdentity(run);
    if (run.revision !== 0 || run.readRevision !== 0) throw new RouterStoreError("run-integrity", "A new router run must start at revision 0.");
    const lock = await this.lock.acquire(run.routerRunId);
    try {
      await this.writeRunUnlocked(run, true);
      return structuredClone(run);
    } finally { await this.lock.release(lock); }
  }

  async read(runId: string): Promise<RouterRun> {
    await this.ensurePrepared();
    return structuredClone(await this.readRunUnlocked(runId));
  }

  async update(runId: string, apply: (run: RouterRun) => RouterRun | Promise<RouterRun>): Promise<RouterRun> {
    await this.ensurePrepared();
    const lock = await this.lock.acquire(runId);
    try {
      const current = await this.readRunUnlocked(runId);
      const reduced = await apply(structuredClone(current));
      if (reduced.routerRunId !== runId) throw new RouterStoreError("run-integrity", "A router update cannot change the run ID.");
      const next = { ...reduced, revision: current.revision + 1 };
      assertValidRouterRun(next);
      await this.writeRunUnlocked(next);
      return structuredClone(next);
    } finally { await this.lock.release(lock); }
  }

  async journaledCreate(input: JournaledCreateInput): Promise<RouterRun> {
    await this.ensurePrepared();
    assertValidRouterRun(input.routerRun);
    await this.assertRunIdentity(input.routerRun);
    if (input.routerRun.revision !== 0 || input.routerRun.readRevision !== 0) throw new RouterStoreError("run-integrity", "A journaled router run must start at revision 0.");
    const operationId = `op_${randomUUID()}`;
    const journal: JournalPayload = {
      schemaVersion: "router-journal/1.0",
      operationId,
      routerRunId: input.routerRun.routerRunId,
      runtimeRunId: input.routerRun.runtime.runId,
      payloadDigest: digest({ routerRun: input.routerRun, runtimePayload: input.runtimePayload }),
      intendedTransition: "create-runtime-and-router",
      createdAt: new Date().toISOString(),
      routerRun: input.routerRun,
      runtimePayload: input.runtimePayload,
    };
    const lock = await this.lock.acquire(input.routerRun.routerRunId);
    try {
      await this.writeAtomic(this.journalPath(input.routerRun.routerRunId), `${JSON.stringify(journal, null, 2)}\n`);
      const existingRuntime = await input.runtime.read(input.routerRun.runtime.runId);
      if (existingRuntime === undefined) await input.runtime.create(input.routerRun.runtime.runId, input.runtimePayload);
      else if (digest(existingRuntime) !== digest(input.runtimePayload)) throw new RouterStoreError("run-integrity", "Existing runtime record does not match the journal payload.");
      await this.writeRunUnlocked(input.routerRun, true);
      await unlink(this.journalPath(input.routerRun.routerRunId));
      return structuredClone(input.routerRun);
    } finally { await this.lock.release(lock); }
  }

  async journaledUpdate(input: JournaledUpdateInput): Promise<RouterRun> {
    await this.ensurePrepared();
    assertValidRouterRun(input.routerRun);
    await this.assertRunIdentity(input.routerRun);
    const lock = await this.lock.acquire(input.routerRun.routerRunId);
    try {
      const current = await this.readRunUnlocked(input.routerRun.routerRunId);
      if (input.routerRun.revision !== current.revision + 1) throw new RouterStoreError("run-integrity", "A journaled router update must advance the current revision exactly once.");
      const journal: JournalPayload = {
        schemaVersion: "router-journal/1.0",
        operationId: `op_${randomUUID()}`,
        routerRunId: input.routerRun.routerRunId,
        runtimeRunId: input.routerRun.runtime.runId,
        payloadDigest: digest({ routerRun: input.routerRun, runtimePayload: input.runtimePayload }),
        intendedTransition: "record-read",
        createdAt: new Date().toISOString(),
        routerRun: input.routerRun,
        runtimePayload: input.runtimePayload,
      };
      await this.writeAtomic(this.journalPath(input.routerRun.routerRunId), `${JSON.stringify(journal, null, 2)}\n`);
      try {
        await input.applyRuntime();
      } catch (error) {
        const runtime = await input.runtime.read(input.routerRun.runtime.runId).catch(() => undefined);
        if (runtime === undefined || digest(runtime) !== digest(input.runtimePayload)) {
          await unlink(this.journalPath(input.routerRun.routerRunId)).catch(() => undefined);
          throw error;
        }
      }
      const runtime = await input.runtime.read(input.routerRun.runtime.runId);
      if (runtime === undefined || digest(runtime) !== digest(input.runtimePayload)) {
        await unlink(this.journalPath(input.routerRun.routerRunId)).catch(() => undefined);
        throw new RouterStoreError("run-integrity", "Runtime read bridge did not persist the expected payload.");
      }
      await this.writeRunUnlocked(input.routerRun);
      await unlink(this.journalPath(input.routerRun.routerRunId));
      return structuredClone(input.routerRun);
    } finally { await this.lock.release(lock); }
  }

  async prune(keepRunIds: Iterable<string> = []): Promise<string[]> {
    await this.ensurePrepared();
    const keep = new Set([...keepRunIds]);
    const entries = await this.listRouterDirectory();
    const removed: string[] = [];
    for (const entry of entries.filter((name) => routeIdPattern.test(name.replace(/\.json$/, "")) && name.endsWith(".json"))) {
      const runId = entry.slice(0, -".json".length);
      if (keep.has(runId)) continue;
      const metadata = await lstat(path.join(this.routerDirectory(), entry));
      if (metadata.isSymbolicLink() || !metadata.isFile()) throw new RouterStoreError("run-integrity", `Malformed router run record: ${entry}`);
      await unlink(path.join(this.routerDirectory(), entry));
      removed.push(runId);
    }
    return removed.sort();
  }
}

export { canonicalizeJson, digest as routerRecordDigest, identityKeyBytes, maxJournalEntries, routeIdPattern };

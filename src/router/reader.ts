import { createHash } from "node:crypto";
import { lstat, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import { ContainedFileReadError, readContainedFile } from "../runtime/strict/contained-file.ts";
import type {
  PreparedSkillSource,
  ReadRunSkillFileInput,
  ReadRunSkillFileResult,
  RouterReadReceipt,
  RouterRun,
  SkillSourceSnapshot,
} from "./types.ts";
import { RouterStore, type RouterRuntimeUpdate } from "./store.ts";

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const safePathPattern = /^[^/\\]+(?:\/[^/\\]+)*$/;
const blockedSegments = new Set(["node_modules", ".git", ".env", ".ssh"]);
const allowedDirectories = new Set(["references", "scripts", "assets"]);
const allowedExtensions = new Map<string, SkillSourceSnapshot["files"][number]["mimeType"]>([
  [".md", "text/markdown"],
  [".txt", "text/plain"],
  [".json", "application/json"],
  [".sh", "text/plain"],
  [".js", "text/plain"],
  [".mjs", "text/plain"],
  [".cjs", "text/plain"],
  [".ts", "text/plain"],
  [".py", "text/plain"],
]);
const defaultChunkBytes = 16_384;
const defaultSingleFileBytes = 256_000;
const defaultAdditionalReadBytes = 80_000;
const defaultMaxSourceFiles = 4096;
const defaultMaxSourceDepth = 32;

const isErrno = (error: unknown, code: string): error is NodeJS.ErrnoException => (
  error instanceof Error && "code" in error && error.code === code
);

const digestBytes = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const digestText = (value: string) => digestBytes(Buffer.from(value, "utf8"));

const fail = (code: RouterReaderErrorCode, message: string): never => {
  throw new RouterReaderError(code, message);
};

const assertDigest = (value: string, label: string) => {
  if (!digestPattern.test(value)) fail("run-integrity", `${label} is not a canonical SHA-256 digest.`);
};

const normalizeRelativePath = (value: string, label: string) => {
  if (typeof value !== "string" || !value || path.isAbsolute(value) || value.includes("\\") || !safePathPattern.test(value)) {
    fail("skill-path-blocked", `${label} must be a safe relative inventory path.`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith(".") || blockedSegments.has(segment))) {
    fail("skill-path-blocked", `${label} contains a blocked path segment.`);
  }
  return value;
};

const fileMimeType = (relativePath: string) => {
  if (relativePath === "SKILL.md") return "text/markdown" as const;
  const extension = path.posix.extname(relativePath).toLowerCase();
  return allowedExtensions.get(extension);
};

const isTextUtf8 = (bytes: Uint8Array) => {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return Buffer.from(text, "utf8").equals(Buffer.from(bytes));
  } catch {
    return false;
  }
};

const isInside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const assertNoSymlinkComponents = async (root: string, target: string, code: RouterReaderErrorCode = "skill-source-unavailable") => {
  const relative = path.relative(root, target);
  if (!isInside(root, target)) fail("skill-path-blocked", "Source path escapes its source root.");
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const metadata = await lstat(current).catch((error: unknown) => {
      if (isErrno(error, "ENOENT")) fail("skill-file-not-found", `Source path does not exist: ${segment}`);
      throw error;
    });
    if (metadata.isSymbolicLink()) fail(code, "Source path contains a symbolic link.");
  }
};

const canonicalSourceRoot = async (sourceRoot: string) => {
  const sourceMetadata = await lstat(sourceRoot).catch(() => undefined);
  if (!sourceMetadata || sourceMetadata.isSymbolicLink() || !sourceMetadata.isDirectory()) {
    fail("skill-source-unavailable", "Skill source root must be a real directory.");
  }
  let canonical: string;
  try { canonical = await realpath(sourceRoot); } catch { return fail("skill-source-unavailable", "Skill source root cannot be canonicalized."); }
  const metadata = await lstat(canonical).catch(() => undefined);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) fail("skill-source-unavailable", "Skill source root must be a real directory.");
  return canonical;
};

const containedSourceRoot = async (baseRoot: string, sourceRoot: string) => {
  const base = await realpath(baseRoot).catch(() => fail("skill-source-unavailable", "Authorized source root cannot be canonicalized."));
  const source = await canonicalSourceRoot(sourceRoot);
  const relative = path.relative(base, source);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("skill-path-blocked", "Skill source must stay inside its authorized root.");
  }
  await assertNoSymlinkComponents(base, source);
  return source;
};

const walkFiles = async (
  root: string,
  current = root,
  state: { files: number; maxFiles: number; maxDepth: number } = {
    files: 0,
    maxFiles: defaultMaxSourceFiles,
    maxDepth: defaultMaxSourceDepth,
  },
  depth = 0,
): Promise<string[]> => {
  if (depth > state.maxDepth) fail("skill-source-unavailable", "Skill source exceeds the directory depth limit.");
  const before = await lstat(current).catch(() => undefined);
  if (!before || !before.isDirectory() || before.isSymbolicLink()) fail("skill-source-unavailable", "Skill source directory is unavailable or symbolic.");
  const beforeIdentity = before ? { dev: before.dev, ino: before.ino } : fail("skill-source-unavailable", "Skill source directory is unavailable.");
  const canonical = await realpath(current).catch(() => undefined);
  if (!canonical || (current !== root && !isInside(root, canonical))) fail("skill-source-unavailable", "Skill source directory escapes its root.");
  const directory = await opendir(current);
  const entries = [];
  try {
    for await (const entry of directory) entries.push(entry);
  } finally { await directory.close().catch(() => undefined); }
  const after = await lstat(current).catch(() => undefined);
  if (!after || !after.isDirectory() || after.isSymbolicLink() || beforeIdentity.dev !== after.dev || beforeIdentity.ino !== after.ino) fail("skill-source-unavailable", "Skill source directory changed during traversal.");
  const result: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const fullPath = path.join(current, entry.name);
    const relative = path.relative(root, fullPath).replace(/\\/g, "/");
    await assertNoSymlinkComponents(root, fullPath);
    if (entry.isDirectory()) result.push(...await walkFiles(root, fullPath, state, depth + 1));
    else if (entry.isFile()) {
      state.files += 1;
      if (state.files > state.maxFiles) fail("skill-source-unavailable", "Skill source exceeds the file count limit.");
      result.push(relative);
    }
    else fail("skill-source-unavailable", `Unsupported source entry: ${relative}`);
  }
  return result.sort();
};

const packageChecksum = async (root: string, files: string[]) => {
  const hash = createHash("sha256");
  for (const relative of files) {
    const bytes = (await readContainedFile({ projectRoot: root, canonicalRoot: root, target: path.join(root, relative), phase: "verification" })).bytes;
    hash.update(relative);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
};

const inventoryPaths = (files: string[]) => files.filter((relative) => {
  if (relative === "SKILL.md") return true;
  const segments = relative.split("/");
  if (!allowedDirectories.has(segments[0] ?? "")) return false;
  return fileMimeType(relative) !== undefined;
});

const readSourceBytes = async (root: string, relative: string, maxBytes: number): Promise<Buffer> => {
  normalizeRelativePath(relative, "inventory path");
  if (relative !== "SKILL.md" && (!allowedDirectories.has(relative.split("/")[0] ?? "") || !fileMimeType(relative))) {
    fail("skill-path-blocked", `Inventory path is not an allowed text file: ${relative}`);
  }
  const target = path.join(root, ...relative.split("/"));
  await assertNoSymlinkComponents(root, target);
  try {
    const result = await readContainedFile({ projectRoot: root, canonicalRoot: root, target, phase: "verification" });
    if (result.bytes.byteLength > maxBytes) fail("skill-file-unsupported", `Skill file exceeds the configured size limit: ${relative}`);
    if (!isTextUtf8(result.bytes)) fail("skill-file-unsupported", `Skill file is not valid UTF-8 text: ${relative}`);
    return result.bytes;
  } catch (error) {
    if (error instanceof RouterReaderError) throw error;
    if (error instanceof ContainedFileReadError) fail("skill-source-unavailable", error.message);
    return fail("skill-source-unavailable", `Skill file could not be read securely: ${relative}`);
  }
};

export type SourceSnapshotInput = {
  skillId: string;
  source: PreparedSkillSource;
  version: string;
  packageChecksum: string;
  auditDigest: string;
  sourceRoot: string;
  authorizedRoot?: string;
  locator: SkillSourceSnapshot["locator"];
  mandatoryPaths?: string[];
  maxSingleFileBytes?: number;
};

export type SourceSnapshotOptions = {
  maxSingleFileBytes?: number;
  maxSourceFiles?: number;
  maxSourceDepth?: number;
};

export const createSkillSourceSnapshot = async (
  input: SourceSnapshotInput,
  options: SourceSnapshotOptions = {},
): Promise<SkillSourceSnapshot> => {
  assertDigest(input.packageChecksum, "packageChecksum");
  assertDigest(input.auditDigest, "auditDigest");
  if (input.locator.kind === "installed" && input.authorizedRoot === undefined) {
    fail("skill-path-blocked", "Installed source snapshots require an authorized project root.");
  }
  if (input.authorizedRoot !== undefined) {
    await containedSourceRoot(input.authorizedRoot, input.sourceRoot);
  }
  const root = await canonicalSourceRoot(input.sourceRoot);
  const allFiles = await walkFiles(root, root, {
    files: 0,
    maxFiles: options.maxSourceFiles ?? defaultMaxSourceFiles,
    maxDepth: options.maxSourceDepth ?? defaultMaxSourceDepth,
  });
  const allowedFiles = inventoryPaths(allFiles);
  const mandatory = new Set((input.mandatoryPaths ?? ["SKILL.md"]).map((value) => normalizeRelativePath(value, "mandatory path")));
  const available = new Set(allowedFiles);
  for (const required of mandatory) {
    if (!available.has(required)) fail("skill-file-not-found", `Mandatory skill file is not available: ${required}`);
  }
  const maxSingleFileBytes = options.maxSingleFileBytes ?? input.maxSingleFileBytes ?? defaultSingleFileBytes;
  const files: SkillSourceSnapshot["files"] = [];
  for (const relative of allowedFiles) {
    const mimeType = fileMimeType(relative);
    if (!mimeType) continue;
    try {
      const bytes = await readSourceBytes(root, relative, maxSingleFileBytes);
      files.push({ path: relative, checksum: digestBytes(bytes), bytes: bytes.byteLength, mimeType, mandatory: mandatory.has(relative) });
    } catch (error) {
      if (mandatory.has(relative)) throw error;
    }
  }
  const actualPackageChecksum = await packageChecksum(root, allFiles);
  if (actualPackageChecksum !== input.packageChecksum) fail("stale-skill-checksum", `Skill package checksum is stale: ${input.skillId}`);
  return {
    skillId: input.skillId,
    source: input.source,
    version: input.version,
    packageChecksum: input.packageChecksum,
    auditDigest: input.auditDigest,
    rootIdentity: digestText(root),
    locator: input.locator,
    files,
  };
};

export const createSkillSourceSnapshots = async (inputs: SourceSnapshotInput[], options: SourceSnapshotOptions = {}) => {
  const snapshots = await Promise.all(inputs.map((input) => createSkillSourceSnapshot(input, options)));
  return snapshots.sort((left, right) => left.skillId.localeCompare(right.skillId));
};

export const computeSourcePackageChecksum = async (sourceRoot: string) => {
  const root = await canonicalSourceRoot(sourceRoot);
  return packageChecksum(root, await walkFiles(root));
};

export type RouterReaderLimits = {
  chunkBytes?: number;
  maxSingleFileBytes?: number;
  maxAdditionalReadBytes?: number;
  maxSourceFiles?: number;
  maxSourceDepth?: number;
};

export type RouterSourceReaderOptions = RouterReaderLimits & {
  bundledRegistryRoot?: string;
  testFixtureRegistryRoot?: string;
  resolveInstalledRoot?: (installedPath: string) => string | Promise<string>;
  prepareMandatorySkillComplete?: (input: { run: RouterRun; skillId: string; packageChecksum: string }) => Promise<RouterRuntimeUpdate>;
  onMandatorySkillComplete?: (input: { run: RouterRun; skillId: string; packageChecksum: string }) => Promise<void>;
};

export type RouterReaderErrorCode =
  | "skill-not-selected"
  | "skill-source-unavailable"
  | "skill-file-not-found"
  | "skill-path-blocked"
  | "skill-file-unsupported"
  | "stale-skill-checksum"
  | "read-request-conflict"
  | "read-order-invalid"
  | "context-budget-exceeded"
  | "run-integrity";

export class RouterReaderError extends Error {
  readonly code: RouterReaderErrorCode;
  constructor(code: RouterReaderErrorCode, message: string) {
    super(message);
    this.name = "RouterReaderError";
    this.code = code;
  }
}

const selectedSkillIds = (run: RouterRun) => new Set([
  run.selections.primary.skillId,
  ...run.selections.environment.map(({ skillId }) => skillId),
  ...run.selections.companions.map(({ skillId }) => skillId),
  ...run.selections.verification.map(({ skillId }) => skillId),
  ...run.selections.agentContext.map(({ skillId }) => skillId),
]);

const snapshotFor = (run: RouterRun, skillId: string) => {
  if (!selectedSkillIds(run).has(skillId)) fail("skill-not-selected", `Skill is not selected: ${skillId}`);
  const snapshot = run.sourceInventory.find((candidate) => candidate.skillId === skillId);
  if (!snapshot) return fail("skill-source-unavailable", `Selected skill source is unavailable: ${skillId}`);
  return snapshot;
};

const completeBytes = (receipts: RouterReadReceipt[], skillId: string, relative: string) => {
  const chunks = receipts.filter((receipt) => receipt.skillId === skillId && receipt.path === relative).sort((left, right) => left.offset - right.offset);
  let offset = 0;
  for (const chunk of chunks) {
    if (chunk.offset !== offset) break;
    offset += chunk.bytes;
  }
  return { offset, chunks };
};

const validateReadLedger = (run: RouterRun) => {
  const selected = selectedSkillIds(run);
  const requestIds = new Set<string>();
  const revisionIds = new Set<number>();
  const mandatoryFiles = run.sourceInventory
    .filter(({ skillId }) => selected.has(skillId))
    .flatMap((snapshot) => snapshot.files.filter(({ mandatory }) => mandatory).map((file) => ({ snapshot, file })));
  const mandatoryProgress = new Map(mandatoryFiles.map(({ snapshot, file }) => [`${snapshot.skillId}\0${file.path}`, 0]));
  const optionalProgress = new Map<string, number>();
  for (const receipt of [...run.readLedger].sort((left, right) => left.resultingReadRevision - right.resultingReadRevision)) {
    if (requestIds.has(receipt.readRequestId) || revisionIds.has(receipt.resultingReadRevision)) fail("run-integrity", "Persisted read ledger contains duplicate request or revision identities.");
    requestIds.add(receipt.readRequestId);
    revisionIds.add(receipt.resultingReadRevision);
    if (receipt.resultingReadRevision !== receipt.expectedReadRevision + 1 || receipt.resultingReadRevision > run.readRevision || receipt.bytes <= 0 || receipt.offset < 0) fail("run-integrity", "Persisted read ledger contains an invalid revision or byte range.");
    assertDigest(receipt.fileChecksum, "read receipt fileChecksum");
    assertDigest(receipt.chunkChecksum, "read receipt chunkChecksum");
    const snapshot = run.sourceInventory.find(({ skillId }) => skillId === receipt.skillId);
    if (!snapshot || !selected.has(receipt.skillId)) return fail("run-integrity", "Persisted read ledger references an unselected skill.");
    const file = snapshot.files.find(({ path: filePath }) => filePath === receipt.path);
    if (!file || receipt.offset + receipt.bytes > file.bytes) fail("run-integrity", "Persisted read ledger references a file outside its snapshot range.");
    const key = `${receipt.skillId}\0${receipt.path}`;
    const progress = receipt.mode === "mandatory-next" ? mandatoryProgress : optionalProgress;
    const expectedOffset = progress.get(key) ?? 0;
    if (receipt.offset !== expectedOffset) fail("run-integrity", "Persisted read ledger contains a gap or overlap.");
    if (receipt.mode === "mandatory-next") {
      const firstIncomplete = mandatoryFiles.find((candidate) => {
        const candidateKey = `${candidate.snapshot.skillId}\0${candidate.file.path}`;
        return (mandatoryProgress.get(candidateKey) ?? 0) < candidate.file.bytes;
      });
      if (!firstIncomplete || firstIncomplete.snapshot.skillId !== receipt.skillId || firstIncomplete.file.path !== receipt.path) fail("run-integrity", "Mandatory read ledger order is invalid.");
    } else if (mandatoryFiles.some(({ snapshot: candidateSnapshot, file: candidateFile }) => (mandatoryProgress.get(`${candidateSnapshot.skillId}\0${candidateFile.path}`) ?? 0) < candidateFile.bytes)) {
      fail("run-integrity", "Optional read was recorded before mandatory reads completed.");
    }
    progress.set(key, expectedOffset + receipt.bytes);
  }
};

const safeChunkEnd = (bytes: Uint8Array, offset: number, requestedEnd: number) => {
  let end = Math.min(bytes.byteLength, requestedEnd);
  while (end > offset && end < bytes.byteLength && (bytes[end] & 0xc0) === 0x80) end -= 1;
  if (end === offset && offset < bytes.byteLength) {
    end = Math.min(bytes.byteLength, offset + 1);
    while (end < bytes.byteLength && (bytes[end] & 0xc0) === 0x80) end += 1;
  }
  return end;
};

const output = (run: RouterRun, input: ReadRunSkillFileInput, receipt: RouterReadReceipt, content: string, totalBytes: number, complete: boolean, skillMandatoryReadsComplete: boolean, runMandatoryReadsComplete: boolean): ReadRunSkillFileResult => ({
  ok: true,
  schemaVersion: "router-read-result/1.0",
  routerRunId: run.routerRunId,
  runtimeRunId: run.runtime.runId,
  runtime: run.runtime.kind,
  readRequestId: input.readRequestId,
  readRevision: receipt.resultingReadRevision,
  skillId: receipt.skillId,
  path: receipt.path,
  mimeType: run.sourceInventory.find(({ skillId }) => skillId === receipt.skillId)?.files.find(({ path: filePath }) => filePath === receipt.path)?.mimeType ?? "text/plain",
  content,
  fileChecksum: receipt.fileChecksum,
  chunkChecksum: receipt.chunkChecksum,
  deliveredOffset: receipt.offset,
  deliveredBytes: receipt.bytes,
  totalBytes,
  complete,
  readStatus: { fileComplete: complete, skillMandatoryReadsComplete, runMandatoryReadsComplete },
});

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class RouterSourceReader {
  private readonly projectRoot: string;
  private readonly store: RouterStore;
  private readonly options: RouterSourceReaderOptions;

  constructor(projectRoot: string, store: RouterStore, options: RouterSourceReaderOptions = {}) {
    this.projectRoot = path.resolve(projectRoot);
    this.store = store;
    this.options = options;
  }

  private async sourceRoot(snapshot: SkillSourceSnapshot) {
    if (snapshot.locator.kind === "installed") {
      const resolved = this.options.resolveInstalledRoot
        ? await this.options.resolveInstalledRoot(snapshot.locator.installedPath)
        : path.resolve(this.projectRoot, snapshot.locator.installedPath);
      return containedSourceRoot(this.projectRoot, resolved);
    }
    const registryRoot = snapshot.source === "bundled-registry" ? this.options.bundledRegistryRoot : this.options.testFixtureRegistryRoot;
    if (!registryRoot) return fail("skill-source-unavailable", `No registry root is configured for ${snapshot.skillId}`);
    return containedSourceRoot(registryRoot, path.join(registryRoot, "skills", snapshot.locator.skillId));
  }

  private async verifySnapshot(snapshot: SkillSourceSnapshot) {
    const root = await this.sourceRoot(snapshot);
    if (digestText(root) !== snapshot.rootIdentity) fail("stale-skill-checksum", `Skill source root identity is stale: ${snapshot.skillId}`);
    const allFiles = await walkFiles(root, root, {
      files: 0,
      maxFiles: this.options.maxSourceFiles ?? defaultMaxSourceFiles,
      maxDepth: this.options.maxSourceDepth ?? defaultMaxSourceDepth,
    });
    const actualPackage = await packageChecksum(root, allFiles);
    if (actualPackage !== snapshot.packageChecksum) fail("stale-skill-checksum", `Skill package checksum is stale: ${snapshot.skillId}`);
    return root;
  }

  private async readChunk(root: string, snapshot: SkillSourceSnapshot, file: SkillSourceSnapshot["files"][number], offset: number, requestedBytes: number) {
    const maxSingleFileBytes = this.options.maxSingleFileBytes ?? defaultSingleFileBytes;
    const bytes = await readSourceBytes(root, file.path, maxSingleFileBytes);
    if (bytes.byteLength !== file.bytes || digestBytes(bytes) !== file.checksum) fail("stale-skill-checksum", `Skill file checksum is stale: ${file.path}`);
    const end = safeChunkEnd(bytes, offset, offset + requestedBytes);
    const chunk = bytes.subarray(offset, end);
    if (chunk.byteLength === 0 && offset < bytes.byteLength) fail("read-order-invalid", "Reader could not produce a UTF-8 chunk.");
    const content = new TextDecoder("utf-8", { fatal: true }).decode(chunk);
    return { bytes, chunk, content, end };
  }

  async read(input: ReadRunSkillFileInput): Promise<ReadRunSkillFileResult> {
    if (!uuidPattern.test(input.readRequestId)) fail("run-integrity", "readRequestId must be a UUID.");
    const initial = await this.store.read(input.routerRunId);
    validateReadLedger(initial);
    const previous = initial.readLedger.find(({ readRequestId }) => readRequestId === input.readRequestId);
    if (previous) {
      const requestedSkill = input.mode === "optional-file" ? input.skillId : undefined;
      if (previous.expectedReadRevision !== input.expectedReadRevision || previous.mode !== input.mode || (requestedSkill !== undefined && previous.skillId !== requestedSkill) || (input.mode === "optional-file" && previous.path !== input.path)) {
        fail("read-request-conflict", `readRequestId is already bound to a different request: ${input.readRequestId}`);
      }
      const snapshot = snapshotFor(initial, previous.skillId);
      const file = snapshot.files.find(({ path: filePath }) => filePath === previous.path);
      if (!file) return fail("run-integrity", "Persisted read receipt references a file outside inventory.");
      const root = await this.verifySnapshot(snapshot);
      const chunk = await this.readChunk(root, snapshot, file, previous.offset, previous.bytes);
      if (digestBytes(chunk.chunk) !== previous.chunkChecksum) fail("stale-skill-checksum", "Persisted read receipt checksum is stale.");
      const current = await this.store.read(input.routerRunId);
      const fileComplete = previous.offset + previous.bytes === file.bytes;
      const skillMandatory = current.sourceInventory.find(({ skillId }) => skillId === previous.skillId)?.files.filter(({ mandatory }) => mandatory).every((required) => completeBytes(current.readLedger, previous.skillId, required.path).offset === required.bytes) ?? false;
      const selected = selectedSkillIds(current);
      const runMandatory = current.sourceInventory.filter(({ skillId }) => selected.has(skillId)).every((candidate) => candidate.files.filter(({ mandatory }) => mandatory).every((required) => completeBytes(current.readLedger, candidate.skillId, required.path).offset === required.bytes));
      return output(current, input, previous, chunk.content, file.bytes, fileComplete, skillMandatory, runMandatory);
    }

    if (!Number.isSafeInteger(input.expectedReadRevision) || input.expectedReadRevision < 0) fail("read-order-invalid", "expectedReadRevision is invalid.");
    const run = initial;
    if (run.readRevision !== input.expectedReadRevision) fail("read-order-invalid", "Read revision is stale or another read committed first.");
    const selectedIds = selectedSkillIds(run);
    const mandatoryFiles = run.sourceInventory.filter(({ skillId }) => selectedIds.has(skillId)).flatMap((snapshot) => snapshot.files.filter(({ mandatory }) => mandatory).map((file) => ({ snapshot, file })));
    let selected: { snapshot: SkillSourceSnapshot; file: SkillSourceSnapshot["files"][number] } | undefined;
    if (input.mode === "mandatory-next") {
      selected = mandatoryFiles.find((candidate) => completeBytes(run.readLedger, candidate.snapshot.skillId, candidate.file.path).offset < candidate.file.bytes);
      if (!selected) fail("read-order-invalid", "All mandatory skill files are already complete.");
    } else {
      const relative = normalizeRelativePath(input.path, "path");
      const snapshot = snapshotFor(run, input.skillId);
      const file = snapshot.files.find((candidate) => candidate.path === relative);
      if (!file) return fail("skill-file-not-found", "Requested path is not present in the persisted source inventory.");
      if (!mandatoryFiles.every((candidate) => completeBytes(run.readLedger, candidate.snapshot.skillId, candidate.file.path).offset === candidate.file.bytes)) {
        fail("read-order-invalid", "Optional files are available only after mandatory reads complete.");
      }
      selected = { snapshot, file };
    }
    if (!selected) return fail("read-order-invalid", "No readable skill file was selected.");
    const chosen = selected;
    const root = await this.verifySnapshot(chosen.snapshot);
    const progress = completeBytes(run.readLedger, chosen.snapshot.skillId, chosen.file.path);
    const chunkBytes = this.options.chunkBytes ?? defaultChunkBytes;
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 4) fail("run-integrity", "chunkBytes must be at least 4 bytes.");
    const additionalReadBytes = run.readLedger.filter(({ mode }) => mode === "optional-file").reduce((total, receipt) => total + receipt.bytes, 0);
    const budget = this.options.maxAdditionalReadBytes ?? defaultAdditionalReadBytes;
    const allowedBytes = input.mode === "optional-file" ? Math.max(0, budget - additionalReadBytes) : chunkBytes;
    if (allowedBytes < 1) fail("context-budget-exceeded", "Optional read budget is exhausted.");
    const chunk = await this.readChunk(root, chosen.snapshot, chosen.file, progress.offset, Math.min(chunkBytes, allowedBytes));
    const resultingReadRevision = run.readRevision + 1;
    const receipt: RouterReadReceipt = {
      readRequestId: input.readRequestId,
      expectedReadRevision: input.expectedReadRevision,
      resultingReadRevision,
      mode: input.mode,
      skillId: chosen.snapshot.skillId,
      path: chosen.file.path,
      fileChecksum: chosen.file.checksum,
      offset: progress.offset,
      bytes: chunk.chunk.byteLength,
      chunkChecksum: digestBytes(chunk.chunk),
      deliveredAt: new Date().toISOString(),
    };
    const nextLedger = [...run.readLedger, receipt];
    const fileComplete = chunk.end === chosen.file.bytes;
    const wasSkillMandatoryComplete = chosen.snapshot.files.filter(({ mandatory }) => mandatory).every((required) => completeBytes(run.readLedger, chosen.snapshot.skillId, required.path).offset === required.bytes);
    const skillMandatory = chosen.snapshot.files.filter(({ mandatory }) => mandatory).every((required) => completeBytes(nextLedger, chosen.snapshot.skillId, required.path).offset === required.bytes);
    const runMandatory = run.sourceInventory.filter(({ skillId }) => selectedIds.has(skillId)).every((candidate) => candidate.files.filter(({ mandatory }) => mandatory).every((required) => completeBytes(nextLedger, candidate.skillId, required.path).offset === required.bytes));
    const nextRun: RouterRun = {
      ...run,
      revision: run.revision + 1,
      state: runMandatory ? "ready" : "reading",
      readRevision: resultingReadRevision,
      readLedger: nextLedger,
      updatedAt: new Date().toISOString(),
    };
    const result = output(nextRun, input, receipt, chunk.content, chosen.file.bytes, fileComplete, skillMandatory, runMandatory);
    const completedSkill = input.mode === "mandatory-next" && skillMandatory && !wasSkillMandatoryComplete;
    const packageChecksum = run.selections.primary.skillId === result.skillId
      ? run.selections.primary.packageChecksum
      : [...run.selections.environment, ...run.selections.companions, ...run.selections.verification, ...run.selections.agentContext]
        .find(({ skillId }) => skillId === result.skillId)?.packageChecksum ?? chosen.snapshot.packageChecksum;
    if (completedSkill && this.options.prepareMandatorySkillComplete) {
      const runtimeUpdate = await this.options.prepareMandatorySkillComplete({ run: nextRun, skillId: result.skillId, packageChecksum });
      await this.store.journaledUpdate({ routerRun: nextRun, ...runtimeUpdate });
    } else {
      await this.store.update(input.routerRunId, (current) => {
        if (current.revision !== run.revision || current.readRevision !== run.readRevision) fail("read-order-invalid", "Read revision is stale or another read committed first.");
        return { ...nextRun, revision: current.revision };
      });
      if (completedSkill) await this.options.onMandatorySkillComplete?.({ run: nextRun, skillId: result.skillId, packageChecksum });
    }
    return result;
  }
}

export { defaultAdditionalReadBytes, defaultChunkBytes, defaultSingleFileBytes, digestBytes };

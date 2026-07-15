import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { addStrictEvidence, verifyStrictSkill } from "./reducer.ts";
import { assertValidCriticReportV2 } from "./critic.ts";
import { validateJsonSchema } from "./json-schema.ts";
import { assertValidStrictSkillRun } from "./validation.ts";
import { StrictSkillRunError, type EvidenceArtifact, type SkillRunV2 } from "./types.ts";
import { deriveStrictValidatorResults } from "./verification.ts";
import { captureSourceControl } from "./git.ts";

const lockTimeoutMs = 5_000;
const staleLockMs = 30_000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errno = (error: unknown, code: string) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
const digestBytes = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export class StrictSkillRunStore {
  private readonly projectRoot: string;

  constructor(projectRoot: string) { this.projectRoot = projectRoot; }

  private runPath(runId: string) {
    if (!/^run_[a-z0-9_-]{7,127}$/.test(runId)) throw new StrictSkillRunError("run-integrity", `Invalid run id ${runId}.`);
    return path.join(this.projectRoot, ".skillranger", "runs", `${runId}.json`);
  }

  private async acquire(runId: string) {
    const lockPath = `${this.runPath(runId).slice(0, -5)}.lock`;
    await mkdir(path.dirname(lockPath), { recursive: true });
    const started = Date.now();
    const token = randomUUID();
    while (true) {
      try {
        const handle = await open(lockPath, "wx");
        await handle.writeFile(JSON.stringify({ token, pid: process.pid }), "utf8");
        await handle.close();
        return { lockPath, token };
      } catch (error) {
        if (!errno(error, "EEXIST")) throw error;
        const info = await stat(lockPath).catch(() => undefined);
        if (info && Date.now() - info.mtimeMs > staleLockMs) await unlink(lockPath).catch(() => undefined);
        if (Date.now() - started > lockTimeoutMs) throw new StrictSkillRunError("run-integrity", "Timed out waiting for strict run lock.");
        await delay(25);
      }
    }
  }

  private async release(lock: { lockPath: string; token: string }) {
    const source = await readFile(lock.lockPath, "utf8").catch(() => "");
    if (source.includes(lock.token)) await unlink(lock.lockPath).catch(() => undefined);
  }

  private async readUnlocked(runId: string): Promise<SkillRunV2> {
    let parsed: unknown;
    try { parsed = JSON.parse(await readFile(this.runPath(runId), "utf8")); }
    catch (error) {
      if (errno(error, "ENOENT")) throw new StrictSkillRunError("run-not-found", `Strict run not found: ${runId}.`);
      if (error instanceof SyntaxError) throw new StrictSkillRunError("run-integrity", `Strict run ${runId} is not valid JSON.`);
      throw error;
    }
    assertValidStrictSkillRun(parsed);
    if (parsed.runId !== runId) throw new StrictSkillRunError("run-integrity", "Persisted strict run id mismatch.");
    return parsed;
  }

  private async writeUnlocked(run: SkillRunV2) {
    assertValidStrictSkillRun(run);
    const target = this.runPath(run.runId);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => undefined); }
  }

  async create(run: SkillRunV2) {
    const lock = await this.acquire(run.runId);
    try {
      try { await stat(this.runPath(run.runId)); throw new StrictSkillRunError("run-integrity", `Strict run already exists: ${run.runId}.`); }
      catch (error) { if (!errno(error, "ENOENT")) throw error; }
      await this.writeUnlocked(run);
      return run;
    } finally { await this.release(lock); }
  }

  async read(runId: string) { return this.readUnlocked(runId); }

  async update(runId: string, apply: (run: SkillRunV2) => SkillRunV2 | Promise<SkillRunV2>) {
    const lock = await this.acquire(runId);
    try {
      const current = await this.readUnlocked(runId);
      const next = await apply(structuredClone(current));
      if (next.runId !== runId || next.revision <= current.revision) throw new StrictSkillRunError("run-integrity", "Strict update must preserve id and advance revision.");
      await this.writeUnlocked(next);
      return next;
    } finally { await this.release(lock); }
  }

  async ingestEvidence(runId: string, input: {
    sourcePath: string;
    kind: string;
    validatedAs?: EvidenceArtifact["validatedAs"];
    attributions: EvidenceArtifact["attributions"];
  }) {
    const sourcePath = path.resolve(input.sourcePath);
    const root = path.resolve(this.projectRoot);
    if (sourcePath !== root && !sourcePath.startsWith(`${root}${path.sep}`)) throw new StrictSkillRunError("artifact-integrity", "Evidence source must stay inside the project root.");
    const sourceInfo = await lstat(sourcePath).catch(() => undefined);
    if (!sourceInfo?.isFile() || sourceInfo.isSymbolicLink()) throw new StrictSkillRunError("artifact-integrity", "Evidence source must be a real file, not a symlink.");
    const bytes = await readFile(sourcePath);
    if (input.validatedAs !== undefined) {
      const run = await this.read(runId);
      const producer = input.attributions.find(({ relation }) => relation === "produced");
      const ledger = run.skillLedgers.find(({ skillId }) => skillId === producer?.skillId);
      if (!ledger) throw new StrictSkillRunError("artifact-integrity", "Schema-validated evidence requires a selected producing skill.");
      let parsed: unknown;
      try { parsed = JSON.parse(bytes.toString("utf8")); }
      catch { throw new StrictSkillRunError("artifact-integrity", "Schema-validated evidence must be valid JSON."); }
      if (input.validatedAs === "critic-report") {
        try { assertValidCriticReportV2(parsed, ledger.contract); }
        catch (error) { throw new StrictSkillRunError("artifact-integrity", `Critic report validation failed: ${(error as Error).message}`); }
      } else {
        const errors = validateJsonSchema(ledger.schemaSnapshots[input.validatedAs], parsed);
        if (errors.length > 0) throw new StrictSkillRunError("artifact-integrity", `Evidence schema validation failed: ${errors.join(" ")}`);
      }
    }
    const sha256 = digestBytes(bytes);
    const hex = sha256.slice("sha256:".length);
    const relativeArtifactPath = path.join(".skillranger", "runs", runId, "artifacts", hex).replace(/\\/g, "/");
    const destination = path.join(this.projectRoot, relativeArtifactPath);
    await mkdir(path.dirname(destination), { recursive: true });
    let created = false;
    try {
      await writeFile(destination, bytes, { flag: "wx" });
      created = true;
    } catch (error) {
      if (!errno(error, "EEXIST")) throw error;
      if (digestBytes(await readFile(destination)) !== sha256) throw new StrictSkillRunError("artifact-integrity", "Existing content-addressed artifact is corrupt.");
    }
    try {
      const current = await this.read(runId);
      const sourceControl = await captureSourceControl(this.projectRoot, current.sourceControl.mode === "git" ? current.sourceControl.base : undefined);
      return await this.update(runId, (run) => addStrictEvidence(run, {
        artifactId: `artifact_${randomUUID()}`,
        kind: input.kind,
        path: relativeArtifactPath,
        sourcePath: path.relative(this.projectRoot, sourcePath).replace(/\\/g, "/"),
        sha256,
        size: bytes.byteLength,
        sourceControl,
        ...(input.validatedAs === undefined ? {} : { validatedAs: input.validatedAs }),
        attributions: input.attributions,
      }));
    } catch (error) {
      if (created) await unlink(destination).catch(() => undefined);
      throw error;
    }
  }

  async verifySkill(runId: string, skillId: string) {
    return this.update(runId, async (run) => {
      const ledger = run.skillLedgers.find((candidate) => candidate.skillId === skillId);
      if (!ledger) throw new StrictSkillRunError("run-integrity", `Unknown selected skill ${skillId}.`);
      const derivation = await deriveStrictValidatorResults(this.projectRoot, run, ledger);
      return verifyStrictSkill(run, skillId, derivation);
    });
  }
}

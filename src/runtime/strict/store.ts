import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { RunFileLock } from "../run-lock.ts";
import { addStrictEvidence, verifyStrictSkill } from "./reducer.ts";
import { assertValidCriticReportV2 } from "./critic.ts";
import { validateJsonSchema } from "./json-schema.ts";
import { assertValidStrictSkillRun } from "./validation.ts";
import { StrictSkillRunError, type EvidenceArtifact, type SkillRunV2 } from "./types.ts";
import { deriveStrictValidatorResults } from "./verification.ts";
import { deriveStrictCertificationProjection, strictCertificationMatches } from "./certification.ts";
import { captureSourceControl } from "./git.ts";
import { ContainedFileReadError, readContainedFile } from "./contained-file.ts";

const errno = (error: unknown, code: string) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
const digestBytes = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const readContainedEvidenceSource = async (projectRoot: string, sourcePath: string) => {
  try {
    return (await readContainedFile({ projectRoot, target: sourcePath, phase: "ingestion" })).bytes;
  } catch (error) {
    const message = error instanceof ContainedFileReadError ? error.message : "Evidence source could not be read securely.";
    throw new StrictSkillRunError("artifact-integrity", message.replace(/^Contained source/, "Evidence source"));
  }
};
const finalizeStrictRun = (source: SkillRunV2): SkillRunV2 => {
  if (source.skillLedgers.some(({ outcome }) => outcome === undefined)) {
    throw new StrictSkillRunError("run-not-finalizable", "Every selected skill must have a terminal outcome.");
  }
  const run = structuredClone(source);
  return {
    ...run,
    state: run.skillLedgers.some(({ outcome }) => outcome === "blocked") ? "blocked" : "verified",
    revision: run.revision + 1,
    updatedAt: new Date().toISOString(),
  };
};

export class StrictSkillRunStore {
  private readonly projectRoot: string;
  private readonly lock: RunFileLock;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.lock = new RunFileLock({
      lockPath: (runId) => `${this.runPath(runId).slice(0, -5)}.lock`,
      error: (message) => new StrictSkillRunError("run-integrity", message),
    });
  }

  private runPath(runId: string) {
    if (!/^run_[a-z0-9_-]{7,127}$/.test(runId)) throw new StrictSkillRunError("run-integrity", `Invalid run id ${runId}.`);
    return path.join(this.projectRoot, ".skillranger", "runs", `${runId}.json`);
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
    const lock = await this.lock.acquire(run.runId);
    try {
      try { await stat(this.runPath(run.runId)); throw new StrictSkillRunError("run-integrity", `Strict run already exists: ${run.runId}.`); }
      catch (error) { if (!errno(error, "ENOENT")) throw error; }
      await this.writeUnlocked(run);
      return run;
    } finally { await this.lock.release(lock); }
  }

  async read(runId: string) { return this.readUnlocked(runId); }

  async replace(runId: string, run: SkillRunV2) {
    if (run.runId !== runId) throw new StrictSkillRunError("run-integrity", "A strict runtime replacement cannot change the run ID.");
    const lock = await this.lock.acquire(runId);
    try {
      const current = await this.readUnlocked(runId);
      if (run.revision <= current.revision) throw new StrictSkillRunError("run-integrity", "A strict runtime replacement must advance the revision.");
      await this.writeUnlocked(run);
      return run;
    } finally { await this.lock.release(lock); }
  }

  async update(runId: string, apply: (run: SkillRunV2) => SkillRunV2 | Promise<SkillRunV2>) {
    const lock = await this.lock.acquire(runId);
    try {
      const current = await this.readUnlocked(runId);
      const next = await apply(structuredClone(current));
      if (next.runId !== runId || next.revision <= current.revision) throw new StrictSkillRunError("run-integrity", "Strict update must preserve id and advance revision.");
      if (current.state !== "verified" && next.state === "verified") {
        throw new StrictSkillRunError("run-integrity", "Strict certification must be finalized by the run store.");
      }
      await this.writeUnlocked(next);
      return next;
    } finally { await this.lock.release(lock); }
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
    const bytes = await readContainedEvidenceSource(root, sourcePath);
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
    try {
      await writeFile(destination, bytes, { flag: "wx" });
    } catch (error) {
      if (!errno(error, "EEXIST")) throw error;
      if (digestBytes(await readFile(destination)) !== sha256) throw new StrictSkillRunError("artifact-integrity", "Existing content-addressed artifact is corrupt.");
    }
    const current = await this.read(runId);
    const sourceControl = await captureSourceControl(this.projectRoot, current.sourceControl.mode === "git" ? current.sourceControl.base : undefined);
    return this.update(runId, (run) => addStrictEvidence(run, {
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
  }

  async verifySkill(runId: string, skillId: string) {
    return this.update(runId, async (run) => {
      const ledger = run.skillLedgers.find((candidate) => candidate.skillId === skillId);
      if (!ledger) throw new StrictSkillRunError("run-integrity", `Unknown selected skill ${skillId}.`);
      const derivation = await deriveStrictValidatorResults(this.projectRoot, run, ledger);
      return verifyStrictSkill(run, skillId, derivation);
    });
  }

  async finalizeRun(runId: string) {
    const lock = await this.lock.acquire(runId);
    try {
      const current = await this.readUnlocked(runId);
      for (const ledger of current.skillLedgers) {
        if (ledger.outcome !== "used") continue;
        const derivation = await deriveStrictValidatorResults(this.projectRoot, current, ledger);
        if (!derivation.artifactIntegrity.passed) {
          throw new StrictSkillRunError(
            "artifact-integrity",
            derivation.artifactIntegrity.message ?? "Strict evidence integrity failed during finalization.",
          );
        }
        const expected = deriveStrictCertificationProjection(current, ledger, derivation);
        if (!strictCertificationMatches(ledger.verificationReports.at(-1), expected)) {
          throw new StrictSkillRunError("run-integrity", `Latest verification report for ${ledger.skillId} does not match runtime-derived certification evidence.`);
        }
      }
      const finalized = finalizeStrictRun(current);
      await this.writeUnlocked(finalized);
      return finalized;
    } finally { await this.lock.release(lock); }
  }
}

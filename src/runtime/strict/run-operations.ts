import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { addStrictEvidence, verifyStrictSkill } from "./reducer.ts";
import { assertValidCriticReportV2, criticReportV2RequiredFields } from "./critic.ts";
import { validateJsonSchema } from "./json-schema.ts";
import { StrictSkillRunError, type EvidenceArtifact, type SkillRunV2 } from "./types.ts";
import { deriveStrictValidatorResults } from "./verification.ts";
import { deriveStrictCertificationProjection, strictCertificationMatches } from "./certification.ts";
import { captureSourceControl } from "./git.ts";
import { ContainedFileReadError, readContainedFile } from "./contained-file.ts";
import type { TrustedValidatorRegistryResolver } from "./validator-registry.ts";
import type { StrictSkillRunStore } from "./store.ts";

const errno = (error: unknown, code: string) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
const digestBytes = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
/**
 * Evidence kinds that verification looks up by validatedAs rather than by kind. A contract step may
 * name the report kind after its skill (performance-report), so the kind a host must send to satisfy
 * requiredEvidenceKinds is not always the one the output gate reads.
 */
const inferredValidatedAs: Record<string, EvidenceArtifact["validatedAs"]> = {
  "critic-report": "critic-report",
  "skill-output": "output",
  "performance-report": "output",
};
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

export async function ingestEvidence(
  store: StrictSkillRunStore,
  runId: string,
  input: {
    sourcePath: string;
    kind: string;
    validatedAs?: EvidenceArtifact["validatedAs"];
    attributions: EvidenceArtifact["attributions"];
  },
): Promise<SkillRunV2> {
  const sourcePath = path.resolve(input.sourcePath);
  const root = path.resolve(store.projectRoot);
  if (sourcePath !== root && !sourcePath.startsWith(`${root}${path.sep}`)) throw new StrictSkillRunError("artifact-integrity", "Evidence source must stay inside the project root.");
  const bytes = await readContainedEvidenceSource(root, sourcePath);
  const sha256 = digestBytes(bytes);
  const hex = sha256.slice("sha256:".length);
  const relativeArtifactPath = path.join(".skillranger", "runs", runId, "artifacts", hex).replace(/\\/g, "/");
  const destination = path.join(store.projectRoot, relativeArtifactPath);
  let createdBlob = false;
  try {
    return await store.update(runId, async (run) => {
      // Verification selects these two artifacts by validatedAs, but agents only ever set `kind`,
      // so a correct artifact stayed invisible and the run could never converge. Infer it from
      // the kind rather than requiring a field nothing advertises.
      const inferred = Object.hasOwn(inferredValidatedAs, input.kind) ? inferredValidatedAs[input.kind] : undefined;
      if (inferred) {
        if (input.validatedAs !== undefined && input.validatedAs !== inferred) {
          throw new StrictSkillRunError(
            "artifact-integrity",
            `Evidence of kind ${input.kind} cannot be validated as ${input.validatedAs}.`,
            { kind: input.kind, expectedValidatedAs: inferred, receivedValidatedAs: input.validatedAs },
          );
        }
        input = { ...input, validatedAs: inferred };
      }
      if (input.validatedAs !== undefined) {
        const producer = input.attributions.find(({ relation }) => relation === "produced");
        const ledger = run.skillLedgers.find(({ skillId }) => skillId === producer?.skillId);
        if (!ledger) throw new StrictSkillRunError("artifact-integrity", "Schema-validated evidence requires a selected producing skill.");
        let parsed: unknown;
        try { parsed = JSON.parse(bytes.toString("utf8")); }
        catch { throw new StrictSkillRunError("artifact-integrity", "Schema-validated evidence must be valid JSON."); }
        if (input.validatedAs === "critic-report") {
          try { assertValidCriticReportV2(parsed, ledger.contract); }
          catch (error) {
            throw new StrictSkillRunError(
              "artifact-integrity",
              `Critic report validation failed: ${(error as Error).message}`,
              { contract: "CriticReportV2", expectedSchemaVersion: "2.0", requiredFields: [...criticReportV2RequiredFields] },
            );
          }
        } else {
          const errors = validateJsonSchema(ledger.schemaSnapshots[input.validatedAs], parsed);
          if (errors.length > 0) throw new StrictSkillRunError("artifact-integrity", `Evidence schema validation failed: ${errors.join(" ")}`);
        }
      }
      const sourceControl = await captureSourceControl(store.projectRoot, run.sourceControl.mode === "git" ? run.sourceControl.base : undefined);
      const next = addStrictEvidence(run, {
        artifactId: `artifact_${randomUUID()}`,
        kind: input.kind,
        path: relativeArtifactPath,
        sourcePath: path.relative(store.projectRoot, sourcePath).replace(/\\/g, "/"),
        sha256,
        size: bytes.byteLength,
        sourceControl,
        ...(input.validatedAs === undefined ? {} : { validatedAs: input.validatedAs }),
        attributions: input.attributions,
      });
      await mkdir(path.dirname(destination), { recursive: true });
      try {
        await writeFile(destination, bytes, { flag: "wx" });
        createdBlob = true;
      } catch (error) {
        if (!errno(error, "EEXIST")) throw error;
        if (digestBytes(await readFile(destination)) !== sha256) throw new StrictSkillRunError("artifact-integrity", "Existing content-addressed artifact is corrupt.");
      }
      return next;
    });
  } catch (error) {
    if (createdBlob) await unlink(destination).catch(() => undefined);
    throw error;
  }
}

export async function verifySkill(
  store: StrictSkillRunStore,
  runId: string,
  skillId: string,
  trustedValidatorRegistry: TrustedValidatorRegistryResolver,
): Promise<SkillRunV2> {
  return store.update(runId, async (run) => {
    const ledger = run.skillLedgers.find((candidate) => candidate.skillId === skillId);
    if (!ledger) throw new StrictSkillRunError("run-integrity", `Unknown selected skill ${skillId}.`);
    const registry = trustedValidatorRegistry(run);
    const verifiedRuns = await store.listVerifiedRuns();
    const derivation = await deriveStrictValidatorResults(store.projectRoot, run, ledger, undefined, registry, { verifiedRuns });
    return verifyStrictSkill(run, skillId, derivation);
  });
}

export async function finalizeRun(
  store: StrictSkillRunStore,
  runId: string,
  trustedValidatorRegistry: TrustedValidatorRegistryResolver,
): Promise<SkillRunV2> {
  const lock = await store.lock.acquire(runId);
  try {
    const current = await store.readUnlocked(runId);
    // Only finalization itself produces "verified" (reducer transitions never do), so that state
    // alone proves the checks below already passed; repeating them could newly fail against
    // evidence legitimately pruned after success. A blocked state proves nothing: exhausting the
    // last skill's repair budget yields blocked with every outcome terminal before any
    // finalization ran, so blocked runs must always re-run the used-ledger integrity checks.
    if (current.state === "verified") return current;
    const registry = trustedValidatorRegistry(current);
    const verifiedRuns = await store.listVerifiedRuns();
    for (const ledger of current.skillLedgers) {
      if (ledger.outcome !== "used") continue;
      const derivation = await deriveStrictValidatorResults(store.projectRoot, current, ledger, undefined, registry, { verifiedRuns });
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
    // A repeat finalize of an already-blocked record changes nothing but revision and updatedAt;
    // skip the write so retried blocked finalizes cannot drift the terminal record.
    if (finalized.state === current.state) return current;
    await store.writeUnlocked(finalized);
    return finalized;
  } finally { await store.lock.release(lock); }
}

import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { readContainedFile } from "./contained-file.ts";
import { assertValidCriticReportV2 } from "./critic.ts";
import { isRfc3339DateTime } from "./date-time.ts";
import type { CriticReportV2, EvidenceArtifact, SkillLedger, VerifiedRunDirection } from "./types.ts";

export type Result = { passed: boolean; message?: string };

export type ValidatorEvaluationContext = {
  projectRoot: string;
  ledger: SkillLedger;
  artifacts: readonly EvidenceArtifact[];
  artifactBytes: Map<string, Buffer>;
  output?: unknown;
  verificationInput?: unknown;
  sourceReview?: unknown;
  criticReport?: CriticReportV2;
  /** The certified design direction of the current run, when its evidence carries one. */
  direction?: unknown;
  /** Read-only verified-runs enumeration supplied by the run store, newest first. */
  verifiedRuns?: readonly VerifiedRunDirection[];
  gateId?: string;
};

export type ValidatorEvaluator = (context: ValidatorEvaluationContext) => Result | Promise<Result>;

const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export const parse = <T = unknown>(artifact: EvidenceArtifact | undefined, artifactBytes: Map<string, Buffer>): T | undefined => {
  if (!artifact) return undefined;
  try { return JSON.parse(artifactBytes.get(artifact.artifactId)?.toString("utf8") ?? "") as T; }
  catch { return undefined; }
};

export const canonicalCriticArtifact = (ledger: SkillLedger, artifacts: EvidenceArtifact[]) => {
  const criticAttempts = new Set(ledger.steps
    .filter(({ type }) => type === "critic")
    .flatMap((step) => {
      const attempt = step.attempts.at(-1)?.attempt;
      return attempt === undefined ? [] : [`${step.id}\u0000${attempt}`];
    }));
  const candidates = artifacts.filter((artifact) => artifact.validatedAs === "critic-report"
    && artifact.attributions.some((attribution) => attribution.relation === "produced"
      && attribution.skillId === ledger.skillId
      && criticAttempts.has(`${attribution.stepId}\u0000${attribution.attempt}`)));
  return candidates.at(-1);
};

const readVerifiedArtifact = async (projectRoot: string, canonicalRoot: string, artifact: EvidenceArtifact) => {
  const target = path.resolve(projectRoot, artifact.path);
  try {
    const { bytes } = await readContainedFile({ projectRoot, canonicalRoot, target, phase: "verification" });
    if (bytes.byteLength !== artifact.size || digest(bytes) !== artifact.sha256) return undefined;
    return bytes;
  } catch {
    return undefined;
  }
};

const integrityFailure: Result = { passed: false, message: "Staged artifact digest, size, path, or file type changed." };

const verifyArtifactIntegrity = async (context: ValidatorEvaluationContext): Promise<Result> => {
  const canonicalRoot = await realpath(context.projectRoot).catch(() => undefined);
  if (!canonicalRoot) return integrityFailure;
  for (const artifact of context.artifacts) {
    const bytes = await readVerifiedArtifact(context.projectRoot, canonicalRoot, artifact);
    if (!bytes) return integrityFailure;
    context.artifactBytes.set(artifact.artifactId, bytes);
  }
  return { passed: true };
};

const criticIndependenceMessage = "Distinct invocation IDs provide host-attested critic/executor separation; they do not technically prove independent execution.";

const verifyCriticIndependence = (context: ValidatorEvaluationContext): Result => {
  try {
    assertValidCriticReportV2(context.criticReport, context.ledger.contract);
    return { passed: true, message: criticIndependenceMessage };
  } catch (error) {
    return { passed: false, message: (error as Error).message };
  }
};

export const coreValidatorEvaluators: Readonly<Record<string, ValidatorEvaluator>> = {
  "core/artifact-integrity": verifyArtifactIntegrity,
  "core/critic-independence": verifyCriticIndependence,
};

export const coreValidatorIds: readonly string[] = Object.keys(coreValidatorEvaluators);

export const atOrAfter = (candidate: string, basis: string) => {
  if (!isRfc3339DateTime(candidate) || !isRfc3339DateTime(basis)) return false;
  const candidateTime = Date.parse(candidate);
  const basisTime = Date.parse(basis);
  return !Number.isNaN(candidateTime) && !Number.isNaN(basisTime) && candidateTime >= basisTime;
};

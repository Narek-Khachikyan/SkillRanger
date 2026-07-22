import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { readContainedFile } from "./contained-file.ts";
import { assertValidCriticReportV2 } from "./critic.ts";
import { isRfc3339DateTime } from "./date-time.ts";
import { deriveBrowserGateResults, deriveTailwindSourceResults } from "./frontend-evidence.ts";
import { deriveVerificationEvidenceIds } from "./report-evidence.ts";
import { criticSystemGateId } from "./system-gates.ts";
import { StrictSkillRunError, type CriticReportV2, type EvidenceArtifact, type SkillLedger, type SkillRunV2, type StrictSystemGateResult } from "./types.ts";

type Result = { passed: boolean; message?: string };
export { criticSystemGateId };
export type StrictValidatorDerivation = {
  artifactIntegrity: Result;
  validatorResults: Record<string, Result>;
  systemGateResults: StrictSystemGateResult[];
};
const authenticDerivations = new WeakSet<object>();
const registerDerivation = (derivation: StrictValidatorDerivation) => {
  authenticDerivations.add(derivation);
  return derivation;
};
export const assertRuntimeStrictValidatorDerivation: (input: unknown) => asserts input is StrictValidatorDerivation = (input) => {
  if (typeof input !== "object" || input === null || !authenticDerivations.has(input)) {
    throw new StrictSkillRunError("run-integrity", "Strict verification requires a runtime-derived validator result.");
  }
};
export type StrictValidatorObservation = {
  gateId: string;
  validatorId: string;
  skillId: string;
  artifacts: readonly EvidenceArtifact[];
  evidence: {
    output?: unknown;
    verificationInput?: unknown;
    sourceReview?: unknown;
    criticReport?: unknown;
  };
  result: Readonly<Result>;
};
export type StrictValidatorObserver = (observation: StrictValidatorObservation) => void | Promise<void>;
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const parse = <T = unknown>(artifact: EvidenceArtifact | undefined, artifactBytes: Map<string, Buffer>): T | undefined => {
  if (!artifact) return undefined;
  try { return JSON.parse(artifactBytes.get(artifact.artifactId)?.toString("utf8") ?? "") as T; }
  catch { return undefined; }
};
const gateSlug = (gateId: string) => gateId.slice(gateId.lastIndexOf("/") + 1);
const canonicalCriticArtifact = (ledger: SkillLedger, artifacts: EvidenceArtifact[]) => {
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
const atOrAfter = (candidate: string, basis: string) => {
  if (!isRfc3339DateTime(candidate) || !isRfc3339DateTime(basis)) return false;
  const candidateTime = Date.parse(candidate);
  const basisTime = Date.parse(basis);
  return !Number.isNaN(candidateTime) && !Number.isNaN(basisTime) && candidateTime >= basisTime;
};
const repairedAfterFindings = (ledger: SkillLedger, artifactId: string) => ledger.repairRequests.some((request) => {
  if (!request.gateIds.includes(criticSystemGateId)) return false;
  const sourceReport = ledger.verificationReports[request.sourceReportIndex];
  if (!sourceReport?.evidenceIds.includes(artifactId)
    || !sourceReport.gateResults.some(({ gateId, passed, level }) =>
      gateId === criticSystemGateId && level === "hard" && !passed)) return false;
  return ledger.steps.some(({ type, attempts }) => type === "repair" && attempts.some((attempt) =>
    attempt.attempt === request.iteration
    && attempt.completedAt !== undefined
    && atOrAfter(attempt.startedAt, sourceReport.generatedAt)
    && atOrAfter(attempt.completedAt, attempt.startedAt)));
});
const getExpectedScreenshotsForCritic = (
  ledger: SkillLedger,
  artifacts: EvidenceArtifact[],
  criticArtifact: EvidenceArtifact,
): EvidenceArtifact[] => {
  const attribution = criticArtifact.attributions.find(({ relation }) => relation === "produced");
  if (!attribution) return [];
  const criticStepIndex = ledger.contract.steps.findIndex(({ id }) => id === attribution.stepId);
  if (criticStepIndex === -1) return [];

  const precedingStepIds = new Set(ledger.contract.steps.slice(0, criticStepIndex).map(({ id }) => id));
  const precedingScreenshots = artifacts.filter((artifact) =>
    artifact.kind.includes("screenshot") &&
    artifact.attributions.some(({ relation, stepId }) => relation === "produced" && precedingStepIds.has(stepId)),
  );

  const latestScreenshot = precedingScreenshots.at(-1);
  if (!latestScreenshot) return [];
  const latestAttribution = latestScreenshot.attributions.find(({ relation }) => relation === "produced")!;

  return precedingScreenshots.filter((artifact) =>
    artifact.attributions.some(({ relation, stepId, attempt }) =>
      relation === "produced" && stepId === latestAttribution.stepId && attempt === latestAttribution.attempt,
    ),
  );
};

const deriveCriticSystemGate = (
  ledger: SkillLedger,
  artifacts: EvidenceArtifact[],
  artifactBytes: Map<string, Buffer>,
): StrictSystemGateResult | undefined => {
  const criticArtifacts = artifacts.filter(({ validatedAs }) => validatedAs === "critic-report");
  if (criticArtifacts.length === 0) return undefined;
  const artifactIds = new Set(artifacts.map(({ artifactId }) => artifactId));

  for (const artifact of criticArtifacts) {
    const report = parse<CriticReportV2>(artifact, artifactBytes);
    if (!report) continue;
    assertValidCriticReportV2(report, ledger.contract);
    if (!report.evidenceArtifactIds.every((id) => artifactIds.has(id))) {
      return {
        gateId: criticSystemGateId,
        passed: false,
        level: "hard",
        message: "Critic report references evidence artifact IDs that do not exist.",
      };
    }
    const expected = getExpectedScreenshotsForCritic(ledger, artifacts, artifact);
    if (expected.length > 0 && !expected.every(({ artifactId }) => report.evidenceArtifactIds.includes(artifactId))) {
      return {
        gateId: criticSystemGateId,
        passed: false,
        level: "hard",
        message: "Critic report does not cover all required screenshot artifacts.",
      };
    }
  }

  const latestRepairAttempt = ledger.steps
    .filter(({ type }) => type === "repair")
    .flatMap(({ attempts }) => attempts)
    .filter((attempt) => attempt.completedAt !== undefined)
    .at(-1);

  const hasRepair = ledger.repairRequests.some((request) => request.gateIds.includes(criticSystemGateId));
  if (hasRepair && latestRepairAttempt) {
    const freshCleanReport = criticArtifacts.some((artifact) => {
      const report = parse<CriticReportV2>(artifact, artifactBytes);
      if (!report || report.outcome !== "clean") return false;
      const produced = artifact.attributions.find(({ relation }) => relation === "produced");
      if (!produced) return false;
      const step = ledger.steps.find(({ id }) => id === produced.stepId);
      const attempt = step?.attempts.find((a) => a.attempt === produced.attempt);
      if (!attempt || !attempt.startedAt || !atOrAfter(attempt.startedAt, latestRepairAttempt.startedAt)) return false;
      const expected = getExpectedScreenshotsForCritic(ledger, artifacts, artifact);
      return expected.length === 0 || expected.every(({ artifactId }) => report.evidenceArtifactIds.includes(artifactId));
    });

    if (!freshCleanReport) {
      return {
        gateId: criticSystemGateId,
        passed: false,
        level: "hard",
        message: "Repair was performed, but no fresh clean critic report covering the fresh screenshots was submitted.",
      };
    }
  }

  // Check all critic reports produced since the latest repair attempt (or since start if no repair)
  const currentCriticArtifacts = latestRepairAttempt
    ? criticArtifacts.filter((artifact) => {
        const produced = artifact.attributions.find(({ relation }) => relation === "produced");
        const step = ledger.steps.find(({ id }) => id === produced?.stepId);
        const attempt = step?.attempts.find((a) => a.attempt === produced?.attempt);
        return attempt?.startedAt && atOrAfter(attempt.startedAt, latestRepairAttempt.startedAt);
      })
    : criticArtifacts;

  const unresolvedFindingReport = currentCriticArtifacts.find((artifact) => {
    const report = parse<CriticReportV2>(artifact, artifactBytes);
    return report?.outcome === "findings";
  });

  if (unresolvedFindingReport) {
    const report = parse<CriticReportV2>(unresolvedFindingReport, artifactBytes);
    return {
      gateId: criticSystemGateId,
      passed: false,
      level: "hard",
      message: `Critic reported ${report?.findings.length ?? 1} unresolved finding(s).`,
    };
  }

  return {
    gateId: criticSystemGateId,
    passed: true,
    level: "hard",
  };
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

export const deriveStrictValidatorResults = async (
  projectRoot: string,
  run: SkillRunV2,
  ledger: SkillLedger,
  observer?: StrictValidatorObserver,
): Promise<StrictValidatorDerivation> => {
  const results: Record<string, Result> = {};
  const ids = new Set(deriveVerificationEvidenceIds(ledger, ledger.repairIterations));
  const artifacts = run.artifacts.filter(({ artifactId }) => ids.has(artifactId));
  const artifactBytes = new Map<string, Buffer>();
  const canonicalRoot = await realpath(projectRoot).catch(() => undefined);
  let integrity = canonicalRoot !== undefined;
  if (canonicalRoot) {
    for (const artifact of artifacts) {
      const bytes = await readVerifiedArtifact(projectRoot, canonicalRoot, artifact);
      if (!bytes) { integrity = false; break; }
      artifactBytes.set(artifact.artifactId, bytes);
    }
  }
  const artifactIntegrity: Result = integrity
    ? { passed: true }
    : { passed: false, message: "Staged artifact digest, size, path, or file type changed." };
  if (!artifactIntegrity.passed) return registerDerivation({ artifactIntegrity, validatorResults: results, systemGateResults: [] });

  const output = parse(artifacts.findLast(({ validatedAs }) => validatedAs === "output"), artifactBytes);
  const verificationInput = parse(artifacts.findLast(({ kind }) => kind === "verification-input"), artifactBytes);
  const latestImplementationDiff = artifacts.findLast(({ kind }) => kind === "implementation-diff");
  const latestSourceProducer = latestImplementationDiff?.attributions.find(({ relation }) => relation === "produced");
  const implementationDiffs = latestSourceProducer
    ? artifacts.filter((artifact) => artifact.kind === "implementation-diff" && artifact.attributions.some((attribution) =>
      attribution.relation === "produced"
      && attribution.skillId === latestSourceProducer.skillId
      && attribution.stepId === latestSourceProducer.stepId
      && attribution.attempt === latestSourceProducer.attempt))
    : [];
  const sourceReview = parse(implementationDiffs.at(-1), artifactBytes);
  const criticReport = parse(canonicalCriticArtifact(ledger, artifacts), artifactBytes);
  const criticSystemGate = deriveCriticSystemGate(ledger, artifacts, artifactBytes);
  const browser = deriveBrowserGateResults(verificationInput, artifacts);
  const sourceResults = implementationDiffs.map((artifact) =>
    deriveTailwindSourceResults(artifactBytes.get(artifact.artifactId)?.toString("utf8") ?? ""));
  const source = Object.fromEntries([
    "no-dynamic-tailwind-classes",
    "raw-colors-reviewed",
    "repeated-class-bundles-reviewed",
  ].map((slug) => {
    const failed = sourceResults.find((candidate) => candidate[slug]?.passed !== true)?.[slug];
    return [slug, failed ?? (sourceResults.length > 0
      ? { passed: true }
      : { passed: false, message: "No implementation diff evidence was staged." })];
  }));

  for (const gate of ledger.contract.gates) {
    if (gate.evaluator.type !== "validator") continue;
    let result: Result = { passed: false, message: `Runtime validator ${gate.evaluator.validatorId} found no valid evidence.` };
    if (gate.evaluator.validatorId === "core/artifact-integrity") result = { passed: true };
    else if (gate.evaluator.validatorId === "core/critic-independence") {
      try { assertValidCriticReportV2(criticReport, ledger.contract); result = { passed: true }; }
      catch (error) { result = { passed: false, message: (error as Error).message }; }
    } else if (gate.evaluator.validatorId === "frontend/performance-claims") {
      const report = record(output) ? output : undefined;
      const findings = Array.isArray(report?.findings) ? report.findings.filter(record) : [];
      const measurements = Array.isArray(report?.measurementsInspected) ? report.measurementsInspected.filter((item): item is string => typeof item === "string") : [];
      const gaps = Array.isArray(report?.measurementGaps) ? report.measurementGaps.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
      const beforeAfter = measurements.some((item) => /before/i.test(item)) && measurements.some((item) => /after/i.test(item));
      const checks: Record<string, boolean> = {
        "finding-dimension-present": findings.every((finding) => typeof finding.affectedFlow === "string" && typeof finding.dimension === "string"),
        "measured-claim-has-artifact": findings.filter((finding) => finding.basis === "measured").every((finding) => Array.isArray(finding.evidence) && finding.evidence.length > 0),
        "before-after-required-for-win": report?.mode !== "validate-change" || beforeAfter,
        "unmeasured-claims-labeled-risk": findings.every((finding) => finding.basis === "measured" || finding.basis === "risk"),
        "exact-missing-measurement": !findings.some((finding) => finding.basis === "risk") || gaps.length > 0,
        "priority-confidence-present": findings.every((finding) => typeof finding.impact === "string" && typeof finding.confidence === "string" && typeof finding.tradeoff === "string"),
        "no-false-performance-win": report?.mode !== "validate-change" || beforeAfter,
      };
      const passed = report !== undefined && checks[gateSlug(gate.id)] === true;
      result = { passed, ...(passed ? {} : { message: `Performance report failed ${gateSlug(gate.id)}.` }) };
    } else if (gate.evaluator.validatorId === "frontend/browser-hard-gates" || gate.evaluator.validatorId === "frontend/tailwind-source") {
      result = gate.evaluator.validatorId === "frontend/browser-hard-gates"
        ? browser[gateSlug(gate.id)]
        : source[gateSlug(gate.id)];
    }
    results[gate.id] = result;
    if (observer) {
      const observation = structuredClone({
        gateId: gate.id,
        validatorId: gate.evaluator.validatorId,
        skillId: ledger.skillId,
        artifacts,
        evidence: { output, verificationInput, sourceReview, criticReport },
        result,
      });
      try { await observer(observation); } catch { /* Instrumentation cannot alter certification. */ }
    }
  }
  return registerDerivation({
    artifactIntegrity,
    validatorResults: results,
    systemGateResults: criticSystemGate ? [criticSystemGate] : [],
  });
};

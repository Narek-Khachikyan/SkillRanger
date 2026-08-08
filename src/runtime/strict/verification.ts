import { resolveDomainPackForSkill } from "../../domains/registry.ts";
import { assertValidCriticReportV2 } from "./critic.ts";
import { atOrAfter, canonicalCriticArtifact, parse, type Result, type ValidatorEvaluationContext } from "./core-validators.ts";
import { deriveVerificationEvidenceIds } from "./report-evidence.ts";
import { criticSystemGateId } from "./system-gates.ts";
import {
  buildTrustedValidatorRegistry,
  validateValidatorOwnership,
  type TrustedValidatorRegistry,
} from "./validator-registry.ts";
import { StrictSkillRunError, type CriticReportV2, type EvidenceArtifact, type SkillLedger, type SkillRunV2, type StrictSystemGateResult } from "./types.ts";

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

  const criticArtifactIndex = artifacts.findIndex(({ artifactId }) => artifactId === criticArtifact.artifactId);
  if (criticArtifactIndex === -1) return [];
  const precedingStepIds = new Set(ledger.contract.steps.slice(0, criticStepIndex).map(({ id }) => id));
  const precedingScreenshots = artifacts.slice(0, criticArtifactIndex).filter((artifact) =>
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
    if (expected.length > 0) {
      if (!expected.every(({ artifactId }) => report.evidenceArtifactIds.includes(artifactId))) {
        return {
          gateId: criticSystemGateId,
          passed: false,
          level: "hard",
          message: "Critic report does not cover all required screenshot artifacts.",
        };
      }
      const expectedIds = new Set(expected.map(({ artifactId }) => artifactId));
      for (const finding of report.findings) {
        if (!finding.evidenceArtifactIds.some((id) => expectedIds.has(id))) {
          return {
            gateId: criticSystemGateId,
            passed: false,
            level: "hard",
            message: `Critic finding ${finding.id} does not reference a required screenshot artifact.`,
          };
        }
      }
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

export const deriveStrictValidatorResults = async (
  projectRoot: string,
  run: SkillRunV2,
  ledger: SkillLedger,
  observer?: StrictValidatorObserver,
  registry: TrustedValidatorRegistry = buildTrustedValidatorRegistry(run.skillLedgers),
): Promise<StrictValidatorDerivation> => {
  const results: Record<string, Result> = {};
  const ids = new Set(deriveVerificationEvidenceIds(ledger, ledger.repairIterations));
  const artifacts = run.artifacts.filter(({ artifactId }) => ids.has(artifactId));
  const artifactBytes = new Map<string, Buffer>();
  const integrityEvaluator = registry.resolveValidator("core/artifact-integrity");
  if (!integrityEvaluator) {
    throw new StrictSkillRunError("run-integrity", "The trusted validator registry cannot resolve core/artifact-integrity.");
  }
  const artifactIntegrity = await integrityEvaluator({ projectRoot, ledger, artifacts, artifactBytes });
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
  const sourceReview = implementationDiffs.map((artifact) =>
    artifactBytes.get(artifact.artifactId)?.toString("utf8") ?? "");
  const criticReport = parse<CriticReportV2>(canonicalCriticArtifact(ledger, artifacts), artifactBytes);
  const criticSystemGate = deriveCriticSystemGate(ledger, artifacts, artifactBytes);

  for (const gate of ledger.contract.gates) {
    if (gate.evaluator.type !== "validator") continue;
    const validatorId = gate.evaluator.validatorId;
    validateValidatorOwnership({
      validatorId,
      registry,
      skillId: ledger.skillId,
      skillDomain: resolveDomainPackForSkill(ledger.skillId)?.manifest.id,
    });
    const evaluator = registry.resolveValidator(validatorId);
    let result: Result;
    if (evaluator) {
      const context: ValidatorEvaluationContext = { projectRoot, ledger, artifacts, artifactBytes, output, verificationInput, sourceReview, criticReport, gateId: gate.id };
      result = await evaluator(context);
    } else {
      result = { passed: false, message: `Runtime validator ${validatorId} found no valid evidence.` };
    }
    results[gate.id] = result;
    if (observer) {
      const observation = structuredClone({
        gateId: gate.id,
        validatorId,
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

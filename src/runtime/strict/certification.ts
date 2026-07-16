import { isDeepStrictEqual } from "node:util";
import { deriveVerificationEvidenceIds } from "./report-evidence.ts";
import type { SkillLedger, SkillRunV2, VerificationReportV2 } from "./types.ts";
import type { StrictValidatorDerivation } from "./verification.ts";

export type StrictCertificationProjection = Pick<
  VerificationReportV2,
  "iteration" | "gateResults" | "hardPassed" | "evidenceIds"
>;

export const strictGateOrder = (
  ledger: Pick<SkillLedger, "contract">,
  systemGateIds: readonly string[],
) => [...ledger.contract.gates.map(({ id }) => id), ...systemGateIds];

export const deriveStrictCertificationProjection = (
  run: Pick<SkillRunV2, "artifacts">,
  ledger: SkillLedger,
  derivation: StrictValidatorDerivation,
): StrictCertificationProjection => {
  const evidenceIds = deriveVerificationEvidenceIds(ledger, ledger.repairIterations);
  const artifactIds = new Set(evidenceIds);
  const artifacts = run.artifacts.filter(({ artifactId }) => artifactIds.has(artifactId));
  const contractGateResults = ledger.contract.gates.map((gate) => {
    let passed = false;
    let message: string | undefined;
    const evaluator = gate.evaluator;
    if (evaluator.type === "evidence-present") passed = artifacts.some(({ kind }) => kind === evaluator.evidenceKind);
    else if (evaluator.type === "schema-valid") passed = evaluator.schema === "input" ? true : artifacts.some(({ validatedAs }) => validatedAs === evaluator.schema);
    else {
      const result = derivation.validatorResults[gate.id] ?? derivation.validatorResults[evaluator.validatorId];
      passed = result?.passed === true;
      message = result?.message ?? (result ? undefined : `Validator result missing: ${evaluator.validatorId}.`);
    }
    return { gateId: gate.id, passed, level: gate.level, ...(message === undefined ? {} : { message }) };
  });
  const gateResults = [...contractGateResults, ...derivation.systemGateResults];
  return {
    iteration: ledger.repairIterations,
    gateResults,
    hardPassed: gateResults.every((gate) => gate.level !== "hard" || gate.passed),
    evidenceIds,
  };
};

export const strictCertificationMatches = (
  report: VerificationReportV2 | undefined,
  expected: StrictCertificationProjection,
) => report !== undefined
  && report.iteration === expected.iteration
  && report.hardPassed === expected.hardPassed
  && isDeepStrictEqual(report.evidenceIds, expected.evidenceIds)
  && isDeepStrictEqual(report.gateResults, expected.gateResults);

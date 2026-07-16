import type { SkillLedger } from "./types.ts";

export const deriveVerificationEvidenceIds = (
  ledger: Pick<SkillLedger, "steps">,
  iteration: number,
) => {
  const repairIndex = ledger.steps.findIndex(({ type }) => type === "repair");
  return ledger.steps.flatMap((step, stepIndex) => {
    let attemptNumber: number | undefined;
    if (step.type === "repair") {
      attemptNumber = iteration === 0 ? undefined : iteration;
    } else if (repairIndex < 0 || stepIndex < repairIndex) {
      attemptNumber = step.attempts.at(-1)?.attempt;
    } else {
      attemptNumber = iteration + 1;
    }
    if (attemptNumber === undefined) return [];
    return step.attempts.find(({ attempt }) => attempt === attemptNumber)?.evidenceIds ?? [];
  });
};

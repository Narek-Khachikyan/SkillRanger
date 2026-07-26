import { StrictSkillRunError, type SkillRunV2 } from "./types.ts";

/**
 * A run blocks either before execution (unmet prerequisites, so no verification report exists) or
 * after hard gates fail past the repair budget. The prerequisite list is the discriminator; an
 * empty gate list is a valid outcome, not a missing one. Only `blocked` ledgers belong here: a
 * `no-op` skill was never applicable and reporting it as a gate failure is the dishonest terminal
 * report this contract exists to prevent.
 */
export const describeBlockedSkills = (run: SkillRunV2) => run.skillLedgers
  .filter((ledger) => ledger.outcome === "blocked")
  .map((ledger) => {
    const unmetPrerequisites = ledger.applicability?.unmetPrerequisites ?? [];
    return {
      skillId: ledger.skillId,
      reason: unmetPrerequisites.length > 0 ? "unmet-prerequisites" as const : "hard-gates-failed" as const,
      failedHardGates: (ledger.verificationReports.at(-1)?.gateResults ?? [])
        .filter((gate) => !gate.passed && gate.level === "hard")
        .map((gate) => gate.gateId),
      unmetPrerequisites,
    };
  });

/**
 * Shared by the MCP and CLI finalize surfaces so they cannot disagree about whether a blocked run
 * is a success. The store still persists the terminal state first; only the reply becomes an error.
 */
export const assertFinalizedVerified = (run: SkillRunV2): SkillRunV2 => {
  if (run.state === "verified") return run;
  throw new StrictSkillRunError(
    "run-blocked",
    `Skill run ${run.runId} finalized as ${run.state}, not verified.`,
    {
      runId: run.runId,
      state: run.state,
      blockedSkills: describeBlockedSkills(run),
      userMessage: "SkillRanger run is blocked; no verified result was produced.",
    },
  );
};

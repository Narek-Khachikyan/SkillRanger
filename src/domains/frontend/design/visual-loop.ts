import type { DesignExecutionPolicy } from "./policy-types.ts";
import type { VisualRun, VisualRunEvent, VisualRunState } from "./visual-loop-types.ts";

const transitionByState: Record<VisualRunState, VisualRunEvent["type"][]> = {
  "policy-resolved": ["directions-validated", "blocked", "failed"],
  "directions-valid": ["implementation-recorded", "blocked", "failed"],
  implemented: ["initial-evidence-recorded", "blocked", "failed"],
  "initial-evidence-captured": ["critique-recorded", "blocked", "failed"],
  critiqued: ["repair-requested", "no-repair-needed", "blocked", "failed"],
  "repair-requested": ["repair-recorded", "blocked", "failed"],
  "no-repair-needed": ["recheck-evidence-recorded", "blocked", "failed"],
  repaired: ["recheck-evidence-recorded", "blocked", "failed"],
  "recheck-evidence-captured": ["final-audit-recorded", "blocked", "failed"],
  "final-audited": ["verification-recorded", "blocked", "failed"],
  verified: [],
  failed: [],
  blocked: [],
};

const targetStateByEvent: Record<VisualRunEvent["type"], VisualRunState> = {
  "directions-validated": "directions-valid",
  "implementation-recorded": "implemented",
  "initial-evidence-recorded": "initial-evidence-captured",
  "critique-recorded": "critiqued",
  "repair-requested": "repair-requested",
  "no-repair-needed": "no-repair-needed",
  "repair-recorded": "repaired",
  "recheck-evidence-recorded": "recheck-evidence-captured",
  "final-audit-recorded": "final-audited",
  "verification-recorded": "verified",
  blocked: "blocked",
  failed: "failed",
};

export const allowedVisualRunEvents = (state: VisualRunState): string[] =>
  [...transitionByState[state]];

export const createVisualRun = (input: {
  id: string;
  policyPath: string;
}): VisualRun => ({
  schemaVersion: "1.0",
  id: input.id,
  policyPath: input.policyPath,
  state: "policy-resolved",
  variantIds: [],
  artifacts: {},
  history: [{ state: "policy-resolved", at: "1970-01-01T00:00:00.000Z" }],
});

const validateEvent = (
  run: VisualRun,
  event: VisualRunEvent,
  policy: DesignExecutionPolicy,
) => {
  if (!transitionByState[run.state].includes(event.type)) {
    throw new Error(`${event.type} is not allowed from ${run.state}`);
  }

  if (event.type === "directions-validated") {
    if (event.variantIds.length !== policy.variantLimit) {
      throw new Error(`${policy.profile} policy requires ${policy.variantLimit} variants`);
    }
    if (new Set(event.variantIds).size !== event.variantIds.length) {
      throw new Error("directions must contain unique variant ids");
    }
  }

  if (event.type === "implementation-recorded" && !run.variantIds.includes(event.variantId)) {
    throw new Error("implementation must reference a validated variant");
  }

  if (event.type === "critique-recorded"
    && event.selectedVariantId !== undefined
    && !run.variantIds.includes(event.selectedVariantId)) {
    throw new Error("selected variant must belong to the validated variants");
  }
  if (event.type === "critique-recorded"
    && (!Number.isInteger(event.repairFindingCount) || event.repairFindingCount < 0)) {
    throw new Error("repair finding count must be a non-negative integer");
  }

  if (event.type === "no-repair-needed") {
    if (policy.profile === "constrained") {
      throw new Error("constrained requires a corrective pass");
    }
    if (run.critiqueRepairFindingCount !== 0) {
      throw new Error("no-repair-needed requires a critique with zero repair findings");
    }
  }

  if (event.type === "recheck-evidence-recorded"
    && event.evidenceId === run.artifacts.initialEvidenceId) {
    throw new Error("recheck requires fresh evidence");
  }

  if (event.type === "verification-recorded" && event.outcome !== "verified") {
    throw new Error("verification-recorded requires a verified outcome");
  }
};

export const applyVisualRunEvent = (
  run: VisualRun,
  event: VisualRunEvent,
  policy: DesignExecutionPolicy,
): VisualRun => {
  validateEvent(run, event, policy);

  const targetState = targetStateByEvent[event.type];
  const next: VisualRun = {
    ...run,
    state: targetState,
    variantIds: [...run.variantIds],
    artifacts: { ...run.artifacts },
    history: [...run.history, { state: targetState, at: event.at, eventId: event.id }],
  };

  switch (event.type) {
    case "directions-validated":
      next.variantIds = [...event.variantIds];
      break;
    case "initial-evidence-recorded":
      next.artifacts.initialEvidenceId = event.evidenceId;
      break;
    case "critique-recorded":
      next.artifacts.critiqueId = event.critiqueId;
      next.selectedVariantId = event.selectedVariantId;
      next.critiqueRepairFindingCount = event.repairFindingCount;
      break;
    case "repair-requested":
    case "repair-recorded":
      next.artifacts.repairId = event.repairId;
      break;
    case "recheck-evidence-recorded":
      next.artifacts.recheckEvidenceId = event.evidenceId;
      break;
    case "final-audit-recorded":
    case "verification-recorded":
      next.artifacts.verificationReportPath = event.reportPath;
      break;
  }

  return next;
};

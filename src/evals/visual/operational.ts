import type { VisualOperationalEvidence } from "./types.ts";

export const isCompleteVisualOperationalEvidence = (value: unknown): value is VisualOperationalEvidence => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const evidence = value as Record<string, unknown>;
  return typeof evidence.hardGateFailed === "boolean"
    && Number.isInteger(evidence.criticalFindings) && Number(evidence.criticalFindings) >= 0
    && Number.isInteger(evidence.repairIterations) && Number(evidence.repairIterations) >= 0
    && ["verified", "failed", "implemented-unverified", "blocked"].includes(String(evidence.verificationOutcome))
    && typeof evidence.completionClaimed === "boolean";
};

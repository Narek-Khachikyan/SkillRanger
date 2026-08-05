import type { VisualBenchmarkRunResult, VisualOperationalEvidence } from "./types.ts";

export const isCompleteVisualOperationalEvidence = (value: unknown): value is VisualOperationalEvidence => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const evidence = value as Record<string, unknown>;
  return typeof evidence.hardGateFailed === "boolean"
    && Number.isInteger(evidence.criticalFindings) && Number(evidence.criticalFindings) >= 0
    && Number.isInteger(evidence.repairIterations) && Number(evidence.repairIterations) >= 0
    && ["verified", "failed", "implemented-unverified", "blocked"].includes(String(evidence.verificationOutcome))
    && typeof evidence.completionClaimed === "boolean";
};

export const isSuccessfulVisualBenchmarkExecution = (
  result: Pick<VisualBenchmarkRunResult, "exitCode" | "signal">,
) => result.exitCode === 0 && result.signal === null;

export const visualBenchmarkExecutionFailureReason = (
  result: Pick<VisualBenchmarkRunResult, "runId" | "exitCode" | "signal">,
): string | undefined => {
  if (isSuccessfulVisualBenchmarkExecution(result)) return undefined;

  const status = [
    result.exitCode === null ? "no exit code" : `exit code ${String(result.exitCode)}`,
    result.signal === null ? undefined : `termination signal ${result.signal}`,
  ].filter((value): value is string => value !== undefined).join(", ");
  return `visual benchmark run ${result.runId} command did not complete successfully (${status}); retained artifacts are non-certifying`;
};

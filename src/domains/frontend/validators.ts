import type { DomainValidatorEvaluator, DomainValidatorProjection } from "../types.ts";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const gateSlug = (gateId: string) => gateId.slice(gateId.lastIndexOf("/") + 1);

export const evaluatePerformanceClaims = (projection: DomainValidatorProjection) => {
  const output = record(projection.output) ? projection.output : undefined;
  const findings = Array.isArray(output?.findings) ? output.findings.filter(record) : [];
  const measurements = Array.isArray(output?.measurementsInspected)
    ? output.measurementsInspected.filter((item): item is string => typeof item === "string")
    : [];
  const gaps = Array.isArray(output?.measurementGaps)
    ? output.measurementGaps.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const beforeAfter = measurements.some((item) => /before/i.test(item)) && measurements.some((item) => /after/i.test(item));
  const checks: Record<string, boolean> = {
    "finding-dimension-present": findings.every((finding) => typeof finding.affectedFlow === "string" && typeof finding.dimension === "string"),
    "measured-claim-has-artifact": findings.filter((finding) => finding.basis === "measured").every((finding) => Array.isArray(finding.evidence) && finding.evidence.length > 0),
    "before-after-required-for-win": output?.mode !== "validate-change" || beforeAfter,
    "unmeasured-claims-labeled-risk": findings.every((finding) => finding.basis === "measured" || finding.basis === "risk"),
    "exact-missing-measurement": !findings.some((finding) => finding.basis === "risk") || gaps.length > 0,
    "priority-confidence-present": findings.every((finding) => typeof finding.impact === "string" && typeof finding.confidence === "string" && typeof finding.tradeoff === "string"),
    "no-false-performance-win": output?.mode !== "validate-change" || beforeAfter,
  };
  const slug = gateSlug(projection.gateId);
  const passed = output !== undefined && checks[slug] === true;
  return { passed, ...(passed ? {} : { message: `Performance report failed ${slug}.` }) };
};

export const frontendValidatorEvaluators: Readonly<Record<string, DomainValidatorEvaluator>> = {
  "frontend/performance-claims": evaluatePerformanceClaims,
};

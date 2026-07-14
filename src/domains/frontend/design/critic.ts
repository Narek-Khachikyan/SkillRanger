import type { VerificationFinding } from "../../../runtime/types.ts";
import type {
  VariantComparisonResult,
  VisualCriterion,
  VisualCriticInput,
  VisualCriticReport,
} from "./visual-loop-types.ts";

const criteria: VisualCriterion[] = [
  "product-specificity",
  "hierarchy",
  "composition",
  "typography",
  "color-roles",
  "state-quality",
  "responsive-transformation",
  "accessibility",
  "implementation-coherence",
  "ai-slop-risk",
];

const codeShape = /```(?:jsx|tsx|css|html|javascript|typescript)|(?:^|\n)(?:diff --git|@@ |\+\+\+ |--- )|<\/?[a-z][^>]*>|\bclassName\s*=|\b(?:git|npm|pnpm|yarn)\s+(?:add|commit|run)\b/i;

const hardFinding = (
  code: string,
  message: string,
  remediation: string,
  evidence: string[] = [],
): VerificationFinding => ({
  id: `${code}:${evidence.join(",") || "report"}`,
  code,
  source: "frontend.visual-critic",
  severity: "high",
  gate: "hard",
  message,
  evidence,
  remediation,
  autofixable: false,
});

const sortedUnique = (values: string[]) => [...new Set(values)].sort();

const mismatchEvidence = (expected: string[], actual: string[]) => {
  const expectedCounts = new Map<string, number>();
  const actualCounts = new Map<string, number>();
  for (const value of expected) expectedCounts.set(value, (expectedCounts.get(value) ?? 0) + 1);
  for (const value of actual) actualCounts.set(value, (actualCounts.get(value) ?? 0) + 1);
  return sortedUnique([...expectedCounts.keys(), ...actualCounts.keys()].filter(
    (value) => expectedCounts.get(value) !== actualCounts.get(value),
  ));
};

const reportStrings = (value: unknown, seen = new Set<object>()): string[] => {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((entry) => reportStrings(entry, seen));
  return Object.values(value).flatMap((entry) => reportStrings(entry, seen));
};

export const createVisualCriticInput = (
  input: Omit<VisualCriticInput, "schemaVersion"> & { schemaVersion?: "1.0" },
): VisualCriticInput => {
  if (input.generatorActorId === input.criticActorId) {
    throw new Error("Visual comparison requires an independent critic actor.");
  }
  return {
    schemaVersion: "1.0",
    policyId: input.policyId,
    generatorActorId: input.generatorActorId,
    criticActorId: input.criticActorId,
    candidates: input.candidates.map((candidate) => ({
      ...candidate,
      screenshotPaths: [...candidate.screenshotPaths],
    })),
  };
};

export const validateVisualCriticReport = (
  input: VisualCriticInput,
  report: VisualCriticReport,
): VerificationFinding[] => {
  const findings: VerificationFinding[] = [];
  const candidateIds = input.candidates.map(({ variantId }) => variantId);
  const evidenceIds = input.candidates.map(({ evidenceId }) => evidenceId);
  const reportCandidateIds = Array.isArray(report.candidateVariantIds) ? report.candidateVariantIds : [];
  const reportEvidenceIds = Array.isArray(report.evidenceIds) ? report.evidenceIds : [];

  if (report.generatorActorId === report.criticActorId) {
    findings.push(hardFinding(
      "critic-not-independent",
      "The visual critic must be independent from the generator.",
      "Produce the report with a critic actor different from the generator actor.",
      [report.criticActorId],
    ));
  }
  if (report.generatorActorId !== input.generatorActorId || report.criticActorId !== input.criticActorId) {
    findings.push(hardFinding(
      "critic-actor-mismatch",
      "The report actor identities do not match the critic input.",
      "Regenerate the report with the actor identities supplied in the critic input.",
      sortedUnique([report.generatorActorId, report.criticActorId]),
    ));
  }

  const candidateMismatch = mismatchEvidence(candidateIds, reportCandidateIds);
  if (candidateMismatch.length > 0) {
    findings.push(hardFinding(
      "critic-candidate-mismatch",
      "The report candidate set does not match the supplied variants.",
      "Compare every supplied candidate exactly once and do not add candidates.",
      candidateMismatch,
    ));
  }
  const evidenceMismatch = mismatchEvidence(evidenceIds, reportEvidenceIds);
  if (evidenceMismatch.length > 0) {
    findings.push(hardFinding(
      "critic-evidence-mismatch",
      "The report evidence set does not match the supplied evidence.",
      "Reference every supplied evidence id exactly once and do not add evidence ids.",
      evidenceMismatch,
    ));
  }

  const comparisons = Array.isArray(report.comparisons) ? report.comparisons : [];
  for (const candidateId of sortedUnique(candidateIds)) {
    const count = comparisons.filter((comparison) => comparison?.variantId === candidateId).length;
    if (count !== 1) {
      findings.push(hardFinding(
        "critic-comparison-missing",
        `Candidate ${candidateId} must have exactly one comparison.`,
        "Supply exactly one complete scorecard for every candidate.",
        [candidateId],
      ));
    }
  }
  const unexpectedComparisons = sortedUnique(comparisons
    .map((comparison) => comparison?.variantId)
    .filter((variantId): variantId is string => typeof variantId === "string" && !candidateIds.includes(variantId)));
  if (unexpectedComparisons.length > 0) {
    findings.push(hardFinding(
      "critic-comparison-invalid",
      "The report contains comparisons for candidates outside the supplied set.",
      "Remove comparisons that do not correspond to a supplied candidate.",
      unexpectedComparisons,
    ));
  }

  for (const comparison of comparisons) {
    const scorecard = comparison?.scores as Partial<Record<VisualCriterion, unknown>> | undefined;
    for (const criterion of criteria) {
      if (!scorecard || !Object.hasOwn(scorecard, criterion)) {
        findings.push(hardFinding(
          "critic-criterion-missing",
          `Comparison ${comparison?.variantId ?? "unknown"} is missing ${criterion}.`,
          "Score every required visual criterion.",
          [comparison?.variantId ?? "unknown", criterion],
        ));
        continue;
      }
      const score = scorecard[criterion];
      if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
        findings.push(hardFinding(
          "critic-score-invalid",
          `Comparison ${comparison?.variantId ?? "unknown"} has an invalid ${criterion} score.`,
          "Use a finite score between 0 and 1 for every criterion.",
          [comparison?.variantId ?? "unknown", criterion],
        ));
      }
    }
  }

  if (
    (report.selectedVariantId !== undefined && !candidateIds.includes(report.selectedVariantId)) ||
    (report.outcome === "selected" && report.selectedVariantId === undefined) ||
    (report.outcome === "no-acceptable-variant" && report.selectedVariantId !== undefined)
  ) {
    findings.push(hardFinding(
      "critic-selection-invalid",
      "The selected variant is inconsistent with the supplied candidates or report outcome.",
      "Select one supplied candidate for a selected outcome, or omit selection for no acceptable variant.",
      report.selectedVariantId === undefined ? [] : [report.selectedVariantId],
    ));
  }

  const suppliedEvidence = new Set([
    ...evidenceIds,
    ...input.candidates.flatMap(({ screenshotPaths }) => screenshotPaths),
  ]);
  const invalidAiSlopEvidence = sortedUnique(comparisons.flatMap((comparison) =>
    (Array.isArray(comparison?.aiSlopFindings) ? comparison.aiSlopFindings : [])
      .map(({ evidence }) => evidence)
      .filter((evidence) => typeof evidence !== "string" || !suppliedEvidence.has(evidence)),
  ).map(String));
  if (invalidAiSlopEvidence.length > 0) {
    findings.push(hardFinding(
      "critic-ai-slop-evidence-invalid",
      "AI-slop findings must point to supplied screenshots or evidence ids.",
      "Reference an evidence id or screenshot path from the critic input.",
      invalidAiSlopEvidence,
    ));
  }

  if (report.containsImplementationCode !== false || reportStrings(report).some((value) => codeShape.test(value))) {
    findings.push(hardFinding(
      "critic-code-output",
      "The critic report contains implementation code or code-shaped instructions.",
      "Return code-free visual analysis and leave implementation to the generator.",
    ));
  }

  return findings;
};

export const compareDesignVariants = (
  input: VisualCriticInput,
  report: VisualCriticReport,
): VariantComparisonResult => {
  const findings = validateVisualCriticReport(input, report);
  if (findings.some(({ severity, gate }) =>
    gate === "hard" && (severity === "critical" || severity === "high"))) {
    return { ok: false, findings };
  }
  return {
    ok: true,
    ...(report.selectedVariantId === undefined ? {} : { selectedVariantId: report.selectedVariantId }),
    findings,
    report,
  };
};

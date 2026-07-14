import type { VerificationFinding } from "../../../runtime/types.ts";
import type {
  AiSlopCode,
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

const aiSlopCodes = new Set<AiSlopCode>([
  "generic-hero-copy",
  "interchangeable-saas-layout",
  "excessive-generic-cards",
  "meaningless-effects",
  "invented-proof",
  "repeated-icon-grid",
  "arbitrary-radii-shadows",
  "weak-hierarchy",
  "meaningless-decoration",
]);

const aiSlopSeverities = new Set(["critical", "high", "medium", "low"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const hardFinding = (
  code: string,
  message: string,
  remediation: string,
  evidence: string[] = [],
  affectedSurface?: string,
): VerificationFinding => ({
  id: `${code}:${evidence.join(",") || "report"}`,
  code,
  source: "frontend.visual-critic",
  severity: "high",
  gate: "hard",
  message,
  evidence,
  ...(affectedSurface === undefined ? {} : { affectedSurface }),
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

  if (report.schemaVersion !== "1.0") {
    findings.push(hardFinding(
      "critic-schema-version",
      "The visual critic report schemaVersion must be 1.0.",
      "Regenerate the report with schemaVersion 1.0.",
    ));
  }
  if (report.outcome !== "selected" && report.outcome !== "no-acceptable-variant") {
    findings.push(hardFinding(
      "critic-outcome-invalid",
      "The visual critic report outcome is invalid.",
      "Use selected or no-acceptable-variant as the report outcome.",
    ));
  }
  if (
    typeof report.confidence !== "number" ||
    !Number.isFinite(report.confidence) ||
    report.confidence < 0 ||
    report.confidence > 1
  ) {
    findings.push(hardFinding(
      "critic-confidence-invalid",
      "The visual critic confidence must be a finite number between 0 and 1.",
      "Provide a finite confidence score from 0 through 1.",
    ));
  }

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

  const candidateById = new Map(input.candidates.map((candidate) => [candidate.variantId, candidate]));
  for (const comparison of comparisons) {
    const variantId = typeof comparison?.variantId === "string" ? comparison.variantId : "unknown";
    const candidate = candidateById.get(variantId);
    const variantEvidence = new Set(candidate
      ? [candidate.evidenceId, ...candidate.screenshotPaths]
      : []);
    const aiSlopFindings = Array.isArray(comparison?.aiSlopFindings)
      ? comparison.aiSlopFindings as unknown[]
      : [];
    const invalidEvidence: string[] = [];
    for (const [index, entry] of aiSlopFindings.entries()) {
      if (
        !isRecord(entry) ||
        !nonEmpty(entry.code) ||
        !aiSlopCodes.has(entry.code as AiSlopCode) ||
        typeof entry.severity !== "string" ||
        !aiSlopSeverities.has(entry.severity) ||
        !nonEmpty(entry.evidence) ||
        !nonEmpty(entry.explanation)
      ) {
        findings.push(hardFinding(
          "critic-ai-slop-finding-invalid",
          `Comparison ${variantId} has a malformed AI-slop finding.`,
          "Provide a legal AI-slop code and severity with non-empty evidence and explanation.",
          [variantId, String(index)],
          variantId,
        ));
        continue;
      }
      if (!variantEvidence.has(entry.evidence)) invalidEvidence.push(entry.evidence);
    }
    if (invalidEvidence.length > 0) {
      findings.push(hardFinding(
        "critic-ai-slop-evidence-invalid",
        `AI-slop findings for ${variantId} must point to that variant's supplied evidence.`,
        "Reference the enclosing variant's evidence id or one of its screenshot paths.",
        sortedUnique(invalidEvidence),
        variantId,
      ));
    }
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

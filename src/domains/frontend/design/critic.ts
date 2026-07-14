import type { VerificationFinding } from "../../../runtime/types.ts";
import type {
  AiSlopCode,
  VariantComparisonResult,
  VisualCriterion,
  VisualCriticInput,
  VisualCriticReport,
  VisualRun,
  VisualRunEvent,
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
const shellFenceShape = /```(?:sh|bash|zsh|shell)\b/i;
const shellCommandPrefix = /^(?:rm\s+-[a-z]*r[a-z]*f\b|curl\b|wget\b|python\d*\b|node\b|bash\b|zsh\b|sh\b|git\s+push\b)/i;
const operatorCommandPrefix = /^(?:npm|pnpm|yarn|git|rm|curl|wget|python\d*|node|bash|zsh|sh|cat|sed|awk|tee|cp|mv|find|docker|npx|bun|deno)\b/i;

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

const unwrapCommandPrefix = (line: string) => {
  const tokens = line.trim().split(/\s+/);
  const assignment = /^[A-Za-z_][A-Za-z0-9_]*=\S+$/;
  let changed = true;
  while (changed && tokens.length > 0) {
    changed = false;
    while (tokens[0] && assignment.test(tokens[0])) {
      tokens.shift();
      changed = true;
    }
    if (tokens[0] === "env") {
      tokens.shift();
      while (tokens[0]?.startsWith("-")) {
        const option = tokens.shift();
        if (option === "-u" && tokens.length > 0) tokens.shift();
      }
      changed = true;
    }
    if (tokens[0] === "sudo") {
      tokens.shift();
      while (tokens[0]?.startsWith("-")) {
        const option = tokens.shift();
        if (["-u", "-g", "-h", "-p", "-C", "-T", "-R", "-D"].includes(option ?? "")
          && tokens.length > 0) tokens.shift();
      }
      changed = true;
    }
  }
  return tokens.join(" ");
};

const containsShellCommand = (value: string) => shellFenceShape.test(value)
  || value.split(/\r?\n/).some((line) => {
    const command = unwrapCommandPrefix(line);
    if (shellCommandPrefix.test(command)) return true;
    return operatorCommandPrefix.test(command) && /(?:\s\|\s|\s(?:>|>>|<)\s)\S/.test(command);
  });

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

const stringArray = (value: unknown, nonEmptyItems = false): value is string[] =>
  Array.isArray(value) && value.every((item) =>
    typeof item === "string" && (!nonEmptyItems || item.trim().length > 0));

const validFinding = (value: unknown): value is VerificationFinding => {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "id", "code", "source", "severity", "gate", "message", "evidence",
    "affectedSurface", "remediation", "autofixable",
  ])) return false;
  return ["id", "code", "source", "message", "remediation"].every((key) => nonEmpty(value[key]))
    && ["critical", "high", "medium", "low", "info"].includes(String(value.severity))
    && (value.gate === "hard" || value.gate === "soft")
    && stringArray(value.evidence, true) && value.evidence.length > 0
    && (value.affectedSurface === undefined || nonEmpty(value.affectedSurface))
    && typeof value.autofixable === "boolean";
};

const validReportContract = (value: unknown): value is VisualCriticReport => {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "schemaVersion", "id", "generatorActorId", "criticActorId", "candidateVariantIds",
    "evidenceIds", "comparisons", "outcome", "selectedVariantId", "repairFindings",
    "confidence", "residualUncertainty", "containsImplementationCode",
  ])) return false;
  if (value.schemaVersion !== "1.0" || !nonEmpty(value.id) || !nonEmpty(value.generatorActorId)
    || !nonEmpty(value.criticActorId) || !stringArray(value.candidateVariantIds, true)
    || value.candidateVariantIds.length === 0
    || new Set(value.candidateVariantIds).size !== value.candidateVariantIds.length
    || !stringArray(value.evidenceIds, true)
    || value.evidenceIds.length === 0 || !Array.isArray(value.comparisons)
    || new Set(value.evidenceIds).size !== value.evidenceIds.length
    || value.comparisons.length === 0 || !Array.isArray(value.repairFindings)
    || !value.repairFindings.every(validFinding) || !stringArray(value.residualUncertainty, true)
    || typeof value.confidence !== "number" || !Number.isFinite(value.confidence)
    || value.confidence < 0 || value.confidence > 1
    || typeof value.containsImplementationCode !== "boolean") return false;
  return value.comparisons.every((comparison) => {
    if (!isRecord(comparison) || !hasOnlyKeys(comparison, [
      "variantId", "scores", "strengths", "weaknesses", "aiSlopFindings",
    ]) || !nonEmpty(comparison.variantId) || !isRecord(comparison.scores)
      || !stringArray(comparison.strengths, true) || !stringArray(comparison.weaknesses, true)
      || !Array.isArray(comparison.aiSlopFindings)) return false;
    const scorecard = comparison.scores as Record<string, unknown>;
    if (!hasOnlyKeys(scorecard, criteria)
      || criteria.some((criterion) => !Object.hasOwn(scorecard, criterion)
        || typeof scorecard[criterion] !== "number"
        || !Number.isFinite(scorecard[criterion])
        || (scorecard[criterion] as number) < 0
        || (scorecard[criterion] as number) > 1)) return false;
    return comparison.aiSlopFindings.every((entry) => isRecord(entry)
      && hasOnlyKeys(entry, ["code", "severity", "evidence", "explanation"])
      && nonEmpty(entry.code) && aiSlopCodes.has(entry.code as AiSlopCode)
      && typeof entry.severity === "string" && aiSlopSeverities.has(entry.severity)
      && nonEmpty(entry.evidence) && nonEmpty(entry.explanation));
  });
};

export const createVisualCriticInput = (
  input: Omit<VisualCriticInput, "schemaVersion"> & { schemaVersion?: "1.0" },
): VisualCriticInput => {
  if (!nonEmpty(input.policyId) || !nonEmpty(input.generatorActorId) || !nonEmpty(input.criticActorId)
    || !Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new Error("Visual critic input requires non-empty policy, actors, and candidates.");
  }
  if (input.generatorActorId === input.criticActorId) {
    throw new Error("Visual comparison requires an independent critic actor.");
  }
  const variantIds = new Set<string>();
  const evidenceIds = new Set<string>();
  for (const candidate of input.candidates) {
    if (!isRecord(candidate) || !nonEmpty(candidate.variantId) || !nonEmpty(candidate.directionPath)
      || !nonEmpty(candidate.evidenceId) || !stringArray(candidate.screenshotPaths, true)
      || candidate.screenshotPaths.length === 0) {
      throw new Error("Visual critic input candidates require non-empty artifact references and screenshots.");
    }
    if (!hasOnlyKeys(candidate, ["variantId", "directionPath", "evidenceId", "screenshotPaths"])) {
      throw new Error("Visual critic input candidate contains a schema-forbidden field.");
    }
    if (variantIds.has(candidate.variantId) || evidenceIds.has(candidate.evidenceId)) {
      throw new Error("Visual critic input candidate variantId and evidenceId values must be unique.");
    }
    variantIds.add(candidate.variantId);
    evidenceIds.add(candidate.evidenceId);
  }
  return {
    schemaVersion: "1.0",
    policyId: input.policyId,
    generatorActorId: input.generatorActorId,
    criticActorId: input.criticActorId,
    candidates: input.candidates.map((candidate) => ({
      variantId: candidate.variantId,
      directionPath: candidate.directionPath,
      evidenceId: candidate.evidenceId,
      screenshotPaths: [...candidate.screenshotPaths],
    })),
  };
};

export const validateVisualCriticReport = (
  input: VisualCriticInput,
  report: unknown,
): VerificationFinding[] => {
  if (!validReportContract(report)) {
    const invalid = [hardFinding(
      "critic-report-invalid",
      "The visual critic report does not satisfy the complete required contract.",
      "Provide every required report field, array, comparison scorecard, and verification finding in its published shape.",
    )];
    if (isRecord(report)) {
      const candidateIds = input.candidates.map(({ variantId }) => variantId);
      const evidenceIds = input.candidates.map(({ evidenceId }) => evidenceId);
      if (Array.isArray(report.candidateVariantIds)) {
        const mismatch = mismatchEvidence(candidateIds, report.candidateVariantIds.filter((id): id is string => typeof id === "string"));
        if (mismatch.length > 0) invalid.push(hardFinding(
          "critic-candidate-mismatch", "The report candidate set does not match the supplied variants.",
          "Compare every supplied candidate exactly once and do not add candidates.", mismatch,
        ));
      }
      if (Array.isArray(report.evidenceIds)) {
        const mismatch = mismatchEvidence(evidenceIds, report.evidenceIds.filter((id): id is string => typeof id === "string"));
        if (mismatch.length > 0) invalid.push(hardFinding(
          "critic-evidence-mismatch", "The report evidence set does not match the supplied evidence.",
          "Reference every supplied evidence id exactly once and do not add evidence ids.", mismatch,
        ));
      }
      if (report.schemaVersion !== "1.0") invalid.push(hardFinding(
        "critic-schema-version", "The visual critic report schemaVersion must be 1.0.",
        "Regenerate the report with schemaVersion 1.0.",
      ));
      if (report.outcome !== "selected" && report.outcome !== "no-acceptable-variant") invalid.push(hardFinding(
        "critic-outcome-invalid", "The visual critic report outcome is invalid.",
        "Use selected or no-acceptable-variant as the report outcome.",
      ));
      if (typeof report.confidence !== "number" || !Number.isFinite(report.confidence)
        || report.confidence < 0 || report.confidence > 1) invalid.push(hardFinding(
        "critic-confidence-invalid", "The visual critic confidence must be a finite number between 0 and 1.",
        "Provide a finite confidence score from 0 through 1.",
      ));
      if (Array.isArray(report.comparisons) && report.comparisons.some((comparison) =>
        !isRecord(comparison) || !Array.isArray(comparison.aiSlopFindings)
        || comparison.aiSlopFindings.some((entry) => !isRecord(entry)
          || !nonEmpty(entry.code) || !aiSlopCodes.has(entry.code as AiSlopCode)
          || typeof entry.severity !== "string" || !aiSlopSeverities.has(entry.severity)
          || !nonEmpty(entry.evidence) || !nonEmpty(entry.explanation)))) {
        invalid.push(hardFinding(
          "critic-ai-slop-finding-invalid", "A comparison has a malformed AI-slop finding collection.",
          "Provide aiSlopFindings as a valid array of complete findings.",
        ));
      }
      if (Array.isArray(report.comparisons)) {
        for (const candidateId of sortedUnique(candidateIds)) {
          const count = report.comparisons.filter((comparison) => isRecord(comparison) && comparison.variantId === candidateId).length;
          if (count !== 1) invalid.push(hardFinding(
            "critic-comparison-missing", `Candidate ${candidateId} must have exactly one comparison.`,
            "Supply exactly one complete scorecard for every candidate.", [candidateId],
          ));
        }
        for (const comparison of report.comparisons) {
          if (!isRecord(comparison) || !isRecord(comparison.scores)) continue;
          for (const criterion of criteria) {
            if (!Object.hasOwn(comparison.scores, criterion)) invalid.push(hardFinding(
              "critic-criterion-missing", `A comparison is missing ${criterion}.`,
              "Score every required visual criterion.", [criterion],
            ));
            else {
              const score = comparison.scores[criterion];
              if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
                invalid.push(hardFinding(
                  "critic-score-invalid", `A comparison has an invalid ${criterion} score.`,
                  "Use a finite score between 0 and 1 for every criterion.", [criterion],
                ));
              }
            }
          }
        }
      }
    }
    return invalid;
  }
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
    if (!Array.isArray(comparison?.aiSlopFindings)) {
      findings.push(hardFinding(
        "critic-ai-slop-finding-invalid",
        `Comparison ${variantId} must provide an AI-slop findings array.`,
        "Provide aiSlopFindings as an array, using an empty array when no findings exist.",
        [variantId, "collection"],
        variantId,
      ));
      continue;
    }
    const aiSlopFindings = comparison.aiSlopFindings as unknown[];
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
  if (reportStrings(report).some(containsShellCommand)) {
    findings.push(hardFinding(
      "critic-shell-output",
      "The critic report contains a shell command or command pipeline.",
      "Return visual analysis only; do not include executable shell instructions.",
    ));
  }

  return findings;
};

export const createCritiqueRecordedEvent = (
  run: Pick<VisualRun, "variantIds">,
  input: VisualCriticInput,
  report: unknown,
  event: { id: string; at: string },
): Extract<VisualRunEvent, { type: "critique-recorded" }> => {
  if (!Array.isArray(run.variantIds) || !stringArray(run.variantIds, true)
    || new Set(run.variantIds).size !== run.variantIds.length) {
    throw new Error("Current visual run candidate set must contain unique non-empty variant ids.");
  }
  const runCandidateIds = [...run.variantIds].sort();
  const inputCandidateIds = input.candidates.map(({ variantId }) => variantId).sort();
  if (runCandidateIds.length !== inputCandidateIds.length
    || runCandidateIds.some((id, index) => id !== inputCandidateIds[index])) {
    throw new Error("Visual critic input candidate set must exactly match the current visual run variants.");
  }
  const findings = validateVisualCriticReport(input, report);
  if (findings.length > 0 || !validReportContract(report)) {
    throw new Error("Cannot create a critique event from an invalid visual critic report.");
  }
  return {
    type: "critique-recorded",
    id: event.id,
    at: event.at,
    critiqueId: report.id,
    ...(report.selectedVariantId === undefined ? {} : { selectedVariantId: report.selectedVariantId }),
    repairFindingCount: report.repairFindings.length,
  };
};

export const compareDesignVariants = (
  input: VisualCriticInput,
  report: unknown,
): VariantComparisonResult => {
  const findings = validateVisualCriticReport(input, report);
  if (findings.some(({ severity, gate }) =>
    gate === "hard" && (severity === "critical" || severity === "high"))) {
    return { ok: false, findings };
  }
  const validReport = report as VisualCriticReport;
  return {
    ok: true,
    ...(validReport.selectedVariantId === undefined ? {} : { selectedVariantId: validReport.selectedVariantId }),
    findings,
    report: validReport,
  };
};

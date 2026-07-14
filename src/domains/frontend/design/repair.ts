import { normalizeFindings } from "../../../runtime/verification.ts";
import type { VerificationFinding, VerificationReport } from "../../../runtime/types.ts";
import type {
  BoundedRepairRequest,
  DesignChangeCategory,
  DesignExecutionPolicy,
  ProtectedInvariant,
  RepairPassCriterion,
} from "./policy-types.ts";

const evidenceKindsFor = (code: string): RepairPassCriterion["evidenceKinds"] => {
  if (/overflow|overlap|focus|contrast|touch|keyboard|motion/.test(code)) return ["screenshot", "browser-check"];
  if (/spacing|color|radii|shadow|card|typography|measure/.test(code)) return ["screenshot", "mechanical-check"];
  return ["test"];
};

const completionFinding = (input: {
  code: string;
  message: string;
  evidence: string[];
  remediation: string;
}): VerificationFinding => ({
  id: input.code,
  source: "frontend.bounded-repair",
  severity: "high",
  gate: "hard",
  autofixable: false,
  ...input,
});

const criticalOrHigh = (finding: VerificationFinding) =>
  finding.severity === "critical" || finding.severity === "high";

const severityRank: Record<VerificationFinding["severity"], number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const createBoundedRepairRequest = (input: {
  id: string;
  policy: DesignExecutionPolicy;
  report: VerificationReport;
  targetVariantId: string;
  sourceEvidenceId: string;
  allowedFiles: string[];
  allowedChanges: DesignChangeCategory[];
  protectedInvariants: ProtectedInvariant[];
}): BoundedRepairRequest => {
  const stopReason = input.report.outcome === "blocked" ? "blocked"
    : input.report.iteration >= input.policy.maxRepairIterations ? "iteration-limit"
    : undefined;
  const findings = normalizeFindings(input.report.findings);
  return {
    schemaVersion: "1.0",
    id: input.id,
    workflowId: input.report.workflowId,
    targetVariantId: input.targetVariantId,
    sourceEvidenceId: input.sourceEvidenceId,
    iteration: input.report.iteration + (stopReason ? 0 : 1),
    maxIterations: input.policy.maxRepairIterations,
    ...(stopReason ? { stopReason } : {}),
    findings,
    allowedFiles: [...new Set(input.allowedFiles)].sort(),
    allowedChanges: [...new Set(input.allowedChanges)],
    protectedInvariants: input.protectedInvariants,
    passCriteria: findings.map((finding) => ({
      findingId: finding.id,
      code: finding.code,
      expected: `No critical or high ${finding.code} finding remains on ${finding.affectedSurface ?? "global"}.`,
      evidenceKinds: evidenceKindsFor(finding.code),
    })),
  };
};

export const validateBoundedRepairCompletion = (input: {
  request: BoundedRepairRequest;
  recheckReport: VerificationReport;
  recheckEvidenceId: string;
  changedFiles: string[];
  appliedChanges: DesignChangeCategory[];
  violatedInvariants: string[];
}): VerificationFinding[] => {
  const findings: VerificationFinding[] = [];
  const sourceFindingIds = new Set(input.request.findings.map((finding) => finding.id));
  const leastSevereSourceFindingRank = Math.min(
    ...input.request.findings.map((finding) => severityRank[finding.severity]),
  );

  if (input.request.findings.length === 0) {
    findings.push(completionFinding({
      code: "repair-source-findings-missing",
      message: "Bounded repair completion requires at least one source finding.",
      evidence: [input.request.id],
      remediation: "Create the repair request from one or more source verification findings.",
    }));
  }

  if (input.recheckEvidenceId === input.request.sourceEvidenceId) {
    findings.push(completionFinding({
      code: "repair-evidence-stale",
      message: "Repair completion must use evidence different from the source evidence.",
      evidence: [input.recheckEvidenceId],
      remediation: "Run a fresh verification check and attach new evidence.",
    }));
  }

  const outOfScopeFiles = [...new Set(input.changedFiles.filter((file) => !input.request.allowedFiles.includes(file)))].sort();
  if (outOfScopeFiles.length > 0) {
    findings.push(completionFinding({
      code: "repair-file-scope-violation",
      message: "Repair changed files outside the approved file scope.",
      evidence: outOfScopeFiles,
      remediation: "Revert unrelated file changes or add them to the approved repair scope.",
    }));
  }

  const outOfScopeChanges = [...new Set(input.appliedChanges.filter((change) => !input.request.allowedChanges.includes(change)))];
  if (outOfScopeChanges.length > 0) {
    findings.push(completionFinding({
      code: "repair-change-scope-violation",
      message: "Repair applied change categories outside the approved semantic scope.",
      evidence: outOfScopeChanges,
      remediation: "Revert out-of-scope changes or obtain an expanded repair request.",
    }));
  }

  const protectedInvariantDescriptions = new Set(input.request.protectedInvariants.map((invariant) => invariant.description));
  const violatedProtectedInvariants = [...new Set(
    input.violatedInvariants.filter((invariant) => protectedInvariantDescriptions.has(invariant)),
  )].sort();
  if (violatedProtectedInvariants.length > 0) {
    findings.push(completionFinding({
      code: "repair-protected-invariant-violation",
      message: "Repair violated a protected invariant.",
      evidence: violatedProtectedInvariants,
      remediation: "Restore every protected invariant before completing the repair.",
    }));
  }

  const unresolvedTargetedFindings = input.recheckReport.findings.filter(
    (finding) => sourceFindingIds.has(finding.id) && criticalOrHigh(finding),
  );
  if (unresolvedTargetedFindings.length > 0) {
    findings.push(completionFinding({
      code: "repair-targeted-finding-unresolved",
      message: "A targeted critical or high finding remains after repair.",
      evidence: unresolvedTargetedFindings.map((finding) => finding.id),
      remediation: "Resolve every targeted critical or high finding and recheck the result.",
    }));
  }

  const regressions = input.recheckReport.findings.filter(
    (finding) =>
      !sourceFindingIds.has(finding.id) &&
      severityRank[finding.severity] >= leastSevereSourceFindingRank,
  );
  if (regressions.length > 0) {
    findings.push(completionFinding({
      code: "repair-regression",
      message: "Repair introduced a new regression at or above the repair severity baseline.",
      evidence: regressions.map((finding) => finding.id),
      remediation: "Resolve introduced equal-or-higher-severity regressions before completing the repair.",
    }));
  }

  return findings;
};

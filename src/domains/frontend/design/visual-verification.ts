import { statSync } from "node:fs";
import { createVerificationReport } from "../../../runtime/verification.ts";
import type { VerificationFinding } from "../../../runtime/types.ts";
import type { BoundedRepairRequest, DesignExecutionPolicy } from "./policy-types.ts";
import type { UiCheckResult, UiEvidenceBundle } from "./evidence-types.ts";
import type { DesignBrief, DesignDirection, DesignValidationResult } from "./types.ts";
import type { DesignVariantMetadata, VisualCriticReport, VisualRun, VisualRunState } from "./visual-loop-types.ts";
import { assertValidVisualRunSnapshot, digestDesignExecutionPolicy } from "./visual-loop.ts";
import { validateDesignBrief, validateDesignDirection } from "./validation.ts";

const artifactIsNonEmptyFile = (filePath: string) => {
  try {
    const artifact = statSync(filePath);
    return artifact.isFile() && artifact.size > 0;
  } catch {
    return false;
  }
};

const hardFinding = (
  code: string,
  message: string,
  evidence: string[],
  remediation: string,
  affectedSurface?: string,
): VerificationFinding => ({
  id: `${code}:${affectedSurface ?? evidence[0] ?? "visual-run"}`,
  code,
  source: "frontend.visual-verifier",
  severity: "high",
  gate: "hard",
  message,
  evidence,
  ...(affectedSurface ? { affectedSurface } : {}),
  remediation,
  autofixable: false,
});

const checkFinding = (check: UiCheckResult): VerificationFinding => ({
  id: `${check.code}:${check.viewport}:${check.state}:${check.locator}`,
  code: check.code,
  source: "frontend.ui-evidence",
  severity: check.severity,
  gate: check.gate,
  message: `${check.code} at ${check.viewport}px in ${check.state}: measured ${check.measured ?? "failure present"}; expected ${check.expected}.`,
  evidence: check.evidence,
  affectedSurface: `${check.viewport}px:${check.state}:${check.locator}`,
  remediation: check.remediation,
  autofixable: false,
});

const validateFinalLifecycle = (input: {
  policy: DesignExecutionPolicy;
  visualRun: VisualRun;
  variant: DesignVariantMetadata;
  initialEvidence: UiEvidenceBundle;
  recheckEvidence: UiEvidenceBundle;
  criticReport: VisualCriticReport;
  boundedRepairRequest?: BoundedRepairRequest;
}) => {
  const issues: string[] = [];
  try {
    assertValidVisualRunSnapshot(input.visualRun, input.policy);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid visual run snapshot";
    if (!message.includes("recheck evidence must be present and fresh")) issues.push(message);
  }
  const states = input.visualRun.history.map(({ state }) => state);
  const repairRequired = input.policy.profile === "constrained" || input.criticReport.repairFindings.length > 0;
  const repairRecorded = states.includes("repair-requested") || states.includes("repaired");
  const usesRepair = repairRequired || repairRecorded;
  const expectedStates: VisualRunState[] = [
    "policy-resolved", "directions-valid", "implemented", "initial-evidence-captured", "critiqued",
    ...(usesRepair ? ["repair-requested", "repaired"] as VisualRunState[] : ["no-repair-needed"] as VisualRunState[]),
    "recheck-evidence-captured", "final-audited",
  ];
  if (input.visualRun.policyDigest !== digestDesignExecutionPolicy(input.policy)) issues.push("policy digest mismatch");
  if (states.length !== expectedStates.length || states.some((state, index) => state !== expectedStates[index])) {
    issues.push(`history must be ${expectedStates.join(" -> ")}`);
  }
  if (input.visualRun.history.slice(1).some(({ eventId }) => !eventId)) issues.push("transition history event id missing");
  if (input.visualRun.history.some((entry, index) => index > 0
    && Date.parse(entry.at) < Date.parse(input.visualRun.history[index - 1].at))) {
    issues.push("history timestamps are not monotonic");
  }
  if (input.visualRun.variantIds.length !== input.policy.variantLimit
    || !input.visualRun.variantIds.includes(input.variant.id)) issues.push("variant set does not match policy");
  const implementationIds = input.visualRun.artifacts.implementations?.map(({ variantId }) => variantId) ?? [];
  if (implementationIds.length !== input.visualRun.variantIds.length
    || !implementationIds.every((id) => input.visualRun.variantIds.includes(id))) {
    issues.push("implementation artifacts do not cover variants");
  }
  if (input.visualRun.artifacts.initialEvidenceId !== input.initialEvidence.id
    || input.visualRun.artifacts.critiqueId !== input.criticReport.id
    || input.visualRun.artifacts.recheckEvidenceId !== input.recheckEvidence.id
    || !input.visualRun.artifacts.finalAuditReportPath) issues.push("lifecycle artifact identity mismatch");
  if (input.visualRun.critiqueRepairFindingCount !== input.criticReport.repairFindings.length) {
    issues.push("critic repair finding count mismatch");
  }
  if (usesRepair) {
    if (!input.boundedRepairRequest
      || input.visualRun.artifacts.repairId !== input.boundedRepairRequest.id
      || !input.visualRun.artifacts.repairImplementationArtifact) issues.push("completed bounded repair path missing");
  } else if (input.boundedRepairRequest || input.visualRun.artifacts.repairId
    || input.visualRun.artifacts.repairImplementationArtifact) issues.push("unexpected repair artifacts");
  return issues;
};

const evidenceMatrixIssues = (
  label: "initial" | "recheck",
  bundle: UiEvidenceBundle,
  policy: DesignExecutionPolicy,
) => {
  const validCaptures = bundle.captures.filter(({ viewport, state, screenshotPath, observation }) =>
    observation.viewport.width === viewport.width
    && observation.viewport.height === viewport.height
    && observation.state === state
    && observation.route === bundle.route
    && observation.screenshotPath === screenshotPath);
  const matrix = new Set(validCaptures.map(({ viewport, state }) => `${viewport.width}::${state}`));
  const issues = policy.requiredViewports.flatMap((viewport) =>
    policy.requiredStates
      .filter((state) => !matrix.has(`${viewport}::${state}`))
      .map((state) => `${label}:${viewport}px:${state}`));
  const metadataMatches = bundle.requiredViewports.length === policy.requiredViewports.length
    && bundle.requiredViewports.every((viewport, index) => viewport === policy.requiredViewports[index])
    && policy.requiredStates.every((state) => bundle.requiredStates.includes(state));
  if (!metadataMatches) issues.push(`${label}:required matrix metadata mismatch`);
  if (validCaptures.length !== bundle.captures.length) issues.push(`${label}:capture observation identity mismatch`);
  return issues;
};

export const verifyVisualResult = (input: {
  workflowId: string;
  policy: DesignExecutionPolicy;
  visualRun: VisualRun;
  variant: DesignVariantMetadata;
  brief: DesignBrief;
  direction: DesignDirection;
  initialEvidence: UiEvidenceBundle;
  recheckEvidence: UiEvidenceBundle;
  criticReport: VisualCriticReport;
  boundedRepairRequest?: BoundedRepairRequest;
  boundedRepairFindings: VerificationFinding[];
  artifactExists?: (filePath: string) => boolean;
}): DesignValidationResult => {
  const findings: VerificationFinding[] = [
    ...validateDesignBrief(input.brief),
    ...validateDesignDirection(input.brief, input.direction),
  ];
  const selectedVariantId = input.variant.id;

  if (input.visualRun.state !== "final-audited") {
    findings.push(hardFinding(
      "visual-run-not-final-audited",
      "The visual run has not completed final audit.",
      [input.visualRun.state],
      "Complete critique, any bounded repair, fresh recheck evidence, and final audit before verification.",
    ));
  }
  const lifecycleIssues = validateFinalLifecycle(input);
  if (lifecycleIssues.length > 0) {
    findings.push(hardFinding(
      "visual-run-lifecycle-invalid",
      "The visual run history does not prove the complete ordered critique and correction lifecycle.",
      lifecycleIssues,
      "Rebuild the run through validated state-machine transitions and persist every required artifact.",
      selectedVariantId,
    ));
  }
  if (input.visualRun.selectedVariantId !== selectedVariantId) {
    findings.push(hardFinding(
      "visual-selected-variant-mismatch",
      "The final run selection does not match the supplied variant.",
      [input.visualRun.selectedVariantId ?? "unselected", selectedVariantId],
      "Verify the variant selected by the visual run.",
      selectedVariantId,
    ));
  }
  if (
    input.criticReport.generatorActorId === input.criticReport.criticActorId
    || input.criticReport.generatorActorId !== input.variant.generatorActorId
    || input.criticReport.outcome !== "selected"
    || input.criticReport.selectedVariantId !== selectedVariantId
    || input.visualRun.artifacts.critiqueId !== input.criticReport.id
  ) {
    findings.push(hardFinding(
      "visual-critic-selection-invalid",
      "An independent critic did not select the final variant with matching artifact identity.",
      [input.criticReport.id, input.criticReport.generatorActorId, input.criticReport.criticActorId],
      "Run an independent critic against the initial evidence and persist its selected variant.",
      selectedVariantId,
    ));
  }
  if (input.initialEvidence.id === input.recheckEvidence.id) {
    findings.push(hardFinding(
      "visual-evidence-stale",
      "Initial and recheck evidence use the same immutable evidence id.",
      [input.initialEvidence.id],
      "Capture a new evidence bundle after correction.",
      selectedVariantId,
    ));
  }
  if (
    input.initialEvidence.variantId !== selectedVariantId
    || input.recheckEvidence.variantId !== selectedVariantId
    || input.visualRun.artifacts.initialEvidenceId !== input.initialEvidence.id
    || input.visualRun.artifacts.recheckEvidenceId !== input.recheckEvidence.id
    || !input.variant.evidenceIds.includes(input.initialEvidence.id)
    || !input.variant.evidenceIds.includes(input.recheckEvidence.id)
    || !input.criticReport.evidenceIds.includes(input.initialEvidence.id)
  ) {
    findings.push(hardFinding(
      "visual-variant-evidence-mismatch",
      "Evidence or lifecycle artifact identity does not match the selected variant.",
      [input.initialEvidence.id, input.recheckEvidence.id, input.initialEvidence.variantId, input.recheckEvidence.variantId],
      "Bind initial and recheck bundles to the selected variant and persist the same ids in the visual run.",
      selectedVariantId,
    ));
  }
  if (input.initialEvidence.sourceIdentity === input.recheckEvidence.sourceIdentity) {
    findings.push(hardFinding(
      "visual-evidence-source-stale",
      "Recheck evidence has the same source identity as initial evidence.",
      [input.initialEvidence.sourceIdentity],
      "Capture the corrected implementation from a new source identity.",
      selectedVariantId,
    ));
  }

  const missingMatrix = [
    ...evidenceMatrixIssues("initial", input.initialEvidence, input.policy),
    ...evidenceMatrixIssues("recheck", input.recheckEvidence, input.policy),
  ];
  if (missingMatrix.length > 0) {
    findings.push(hardFinding(
      "visual-evidence-matrix-incomplete",
      "Initial or fresh evidence does not cover the complete required viewport and state matrix.",
      missingMatrix,
      "Capture every required state at 390px, 768px, and 1440px before critique and after correction.",
      input.recheckEvidence.route,
    ));
  }

  const artifactExists = input.artifactExists ?? artifactIsNonEmptyFile;
  const missingScreenshots = [input.initialEvidence, input.recheckEvidence]
    .flatMap((bundle) => bundle.captures
      .filter(({ screenshotPath }) => !artifactExists(screenshotPath))
      .map(({ screenshotPath }) => screenshotPath));
  if (missingScreenshots.length > 0) {
    findings.push(hardFinding(
      "visual-screenshot-missing",
      "An initial or recheck screenshot is missing or empty.",
      [...new Set(missingScreenshots)],
      "Create every non-empty screenshot for both evidence captures.",
      input.recheckEvidence.route,
    ));
  }

  if (input.boundedRepairRequest && (
    input.boundedRepairRequest.targetVariantId !== selectedVariantId
    || input.boundedRepairRequest.sourceEvidenceId !== input.initialEvidence.id
    || input.visualRun.artifacts.repairId !== input.boundedRepairRequest.id
  )) {
    findings.push(hardFinding(
      "visual-repair-artifact-mismatch",
      "The bounded repair request is not bound to the selected variant and initial evidence.",
      [input.boundedRepairRequest.id],
      "Use the persisted bounded repair request for this variant and evidence cycle.",
      selectedVariantId,
    ));
  }
  findings.push(...input.boundedRepairFindings);
  findings.push(...input.recheckEvidence.captures.flatMap(({ checks }) => checks.map(checkFinding)));

  const capabilities = new Set(input.recheckEvidence.adapterCapabilities);
  const capabilityStatus = capabilities.has("browser") && capabilities.has("screenshots") ? "ready" : "degraded";
  const hardFailures = findings.some(({ severity, gate }) =>
    gate === "hard" && (severity === "critical" || severity === "high"));
  const report = createVerificationReport({
    domain: "frontend",
    workflowId: input.workflowId,
    iteration: input.recheckEvidence.iteration,
    capabilityStatus,
    executionStatus: "implemented",
    verificationStatus: hardFailures ? "failed" : "passed",
    findings,
    evidence: [
      ...input.recheckEvidence.captures.flatMap((capture) => artifactExists(capture.screenshotPath)
        ? [{ kind: "screenshot", path: capture.screenshotPath, description: `${input.recheckEvidence.route} at ${capture.viewport.width}px in ${capture.state}` }]
        : []),
      { kind: "visual-critique", description: `Critique ${input.criticReport.id}` },
      ...(input.boundedRepairRequest ? [{ kind: "bounded-repair", description: `Repair ${input.boundedRepairRequest.id}` }] : []),
      { kind: "ui-evidence", path: `.design/evidence/${input.initialEvidence.id}/bundle.json`, description: `Initial evidence ${input.initialEvidence.id}` },
      { kind: "ui-evidence", path: `.design/evidence/${input.recheckEvidence.id}/bundle.json`, description: `Recheck evidence ${input.recheckEvidence.id}` },
    ],
    residualRisks: capabilityStatus === "ready" ? input.criticReport.residualUncertainty : [
      "Browser and screenshot adapter capabilities were not both reported.",
      ...input.criticReport.residualUncertainty,
    ],
  });
  return { findings, report };
};

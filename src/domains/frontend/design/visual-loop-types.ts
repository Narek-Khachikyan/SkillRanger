import type { VerificationFinding, VerificationOutcome } from "../../../runtime/types.ts";
import type { DesignExecutionTrace } from "./execution-trace.ts";

export type DesignVariantMetadata = {
  schemaVersion: "1.0";
  id: string;
  recipeId: string;
  directionPath: string;
  ruleIds: string[];
  createdOrder: number;
  generatorActorId: string;
  implementationArtifact?: string;
  evidenceIds: string[];
};

export type VisualRunState =
  | "policy-resolved" | "directions-valid" | "implemented"
  | "initial-evidence-captured" | "critiqued"
  | "repair-requested" | "no-repair-needed" | "repaired"
  | "recheck-evidence-captured" | "final-audited" | "verified"
  | "failed" | "blocked";

export type VisualRun = {
  schemaVersion: "1.0";
  id: string;
  policyPath: string;
  policyDigest: string;
  state: VisualRunState;
  variantIds: string[];
  selectedVariantId?: string;
  executionTrace?: DesignExecutionTrace;
  critiqueRepairFindingCount?: number;
  artifacts: {
    implementations?: Array<{ variantId: string; artifactId: string }>;
    initialEvidenceId?: string;
    critiqueId?: string;
    repairId?: string;
    repairImplementationArtifact?: string;
    recheckEvidenceId?: string;
    finalAuditReportPath?: string;
    verificationReportPath?: string;
  };
  history: Array<{ state: VisualRunState; at: string; eventId?: string }>;
};

type VisualRunEventBase<Type extends string> = {
  id: string;
  at: string;
  type: Type;
};

export type VisualRunEvent =
  | (VisualRunEventBase<"directions-validated"> & { variantIds: string[]; traceId?: string })
  | (VisualRunEventBase<"implementation-recorded"> & {
    implementations: Array<{ variantId: string; artifactId: string }>;
  })
  | (VisualRunEventBase<"initial-evidence-recorded"> & { evidenceId: string })
  | (VisualRunEventBase<"critique-recorded"> & {
    critiqueId: string;
    selectedVariantId?: string;
    repairFindingCount: number;
  })
  | (VisualRunEventBase<"repair-requested"> & { repairId: string })
  | VisualRunEventBase<"no-repair-needed">
  | (VisualRunEventBase<"repair-recorded"> & { repairId: string; implementationArtifact: string })
  | (VisualRunEventBase<"recheck-evidence-recorded"> & { evidenceId: string })
  | (VisualRunEventBase<"final-audit-recorded"> & { reportPath: string })
  | (VisualRunEventBase<"verification-recorded"> & { outcome: VerificationOutcome; reportPath: string })
  | VisualRunEventBase<"blocked">
  | VisualRunEventBase<"failed">;

export type VisualCriterion =
  | "product-specificity" | "hierarchy" | "composition" | "typography"
  | "color-roles" | "state-quality" | "responsive-transformation"
  | "accessibility" | "implementation-coherence" | "ai-slop-risk";

export type AiSlopCode =
  | "generic-hero-copy" | "interchangeable-saas-layout" | "excessive-generic-cards"
  | "meaningless-effects" | "invented-proof" | "repeated-icon-grid"
  | "arbitrary-radii-shadows" | "weak-hierarchy" | "meaningless-decoration"
  | "generic-font-stack" | "gradient-abuse" | "centered-hero"
  | "eyebrow-everywhere" | "italic-display-heading" | "glassmorphism"
  | "glowing-orb";

export const legacyAiSlopCodes: readonly AiSlopCode[] = [
  "generic-hero-copy",
  "interchangeable-saas-layout",
  "excessive-generic-cards",
  "meaningless-effects",
  "invented-proof",
  "repeated-icon-grid",
  "arbitrary-radii-shadows",
  "weak-hierarchy",
  "meaningless-decoration",
] as const;

// Canonical schemaVersion-1.1 vocabulary: the frozen 1.0 codes plus the seven 1.1 tells. All five
// enum locations (domain schema, skill output schema, loop types, validator set, version checks)
// must stay in lock-step with this list; a same-version normative edit is rejected by the tests.
export const aiSlopCodes: readonly AiSlopCode[] = [
  ...legacyAiSlopCodes,
  "generic-font-stack",
  "gradient-abuse",
  "centered-hero",
  "eyebrow-everywhere",
  "italic-display-heading",
  "glassmorphism",
  "glowing-orb",
] as const;

export type VisualCriticInput = {
  schemaVersion: "1.0";
  generatorActorId: string;
  criticActorId: string;
  policyId: string;
  candidates: Array<{
    variantId: string;
    directionPath: string;
    evidenceId: string;
    screenshotPaths: string[];
  }>;
};

export type VisualCriticReport = {
  schemaVersion: "1.0" | "1.1";
  id: string;
  generatorActorId: string;
  criticActorId: string;
  candidateVariantIds: string[];
  evidenceIds: string[];
  comparisons: Array<{
    variantId: string;
    scores: Record<VisualCriterion, number>;
    strengths: string[];
    weaknesses: string[];
    aiSlopFindings: Array<{
      code: AiSlopCode;
      severity: "critical" | "high" | "medium" | "low";
      evidence: string;
      explanation: string;
    }>;
  }>;
  outcome: "selected" | "no-acceptable-variant";
  selectedVariantId?: string;
  repairFindings: VerificationFinding[];
  confidence: number;
  residualUncertainty: string[];
  containsImplementationCode: false;
};

export type VariantComparisonResult = {
  ok: boolean;
  selectedVariantId?: string;
  findings: VerificationFinding[];
  report?: VisualCriticReport;
};

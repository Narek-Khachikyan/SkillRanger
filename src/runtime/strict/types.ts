import type { ProjectFingerprint } from "../../types.ts";
import type { SourceControlSnapshot } from "./git.ts";

export type ApplicabilityPredicate =
  | { op: "all" | "any"; conditions: ApplicabilityPredicate[] }
  | { op: "not"; condition: ApplicabilityPredicate }
  | { op: "tag"; value: string }
  | { op: "signal"; collection: "projectTypes" | "languages" | "frameworks" | "styling" | "testing" | "infrastructure"; name: string; minConfidence?: number }
  | { op: "input"; path: string; present?: boolean; equals?: string | number | boolean };

export type ExecutionContractV2 = {
  schemaVersion: "2.0";
  skillId: string;
  contractVersion: string;
  inputSchema: string;
  outputSchema: string;
  mustRead: string[];
  applicability: ApplicabilityPredicate;
  prerequisites: Array<
    | { id: string; kind: "capability"; capability: string; requiredStatus: "ready" }
    | { id: string; kind: "input"; path: string }
  >;
  steps: Array<{
    id: string;
    type: "collect" | "validate" | "implement" | "critic" | "verify" | "repair" | "report";
    requiredEvidenceKinds: string[];
    ruleIds: string[];
    repairable?: boolean;
  }>;
  rules: Array<{ id: string; description: string }>;
  gates: Array<{
    id: string;
    level: "hard" | "advisory";
    evaluator:
      | { type: "evidence-present"; evidenceKind: string }
      | { type: "schema-valid"; schema: "input" | "output" | "critic-report" }
      | { type: "validator"; validatorId: string };
    ruleIds: string[];
  }>;
  maxRepairIterations: number;
};

export type ApplicabilityContext = {
  fingerprint: ProjectFingerprint;
  input: Record<string, unknown>;
};

export type StrictSkillRunState = "planned" | "reading" | "ready" | "running" | "verifying" | "repair-required" | "verified" | "blocked" | "failed";
export type StrictSkillOutcome = "used" | "no-op" | "blocked";
export type StrictSkillRunErrorCode =
  | "strict-contract-missing" | "strict-skill-not-installed" | "skill-content-unread"
  | "step-out-of-order" | "evidence-missing" | "unknown-rule-id" | "artifact-integrity"
  | "hard-gate-failed" | "repair-limit" | "run-not-finalizable" | "run-integrity" | "run-not-found";

export type SkillContentChunk = { path: string; ordinal: number; total: number; sha256: string; content: string };
export type SkillReadReceipt = Omit<SkillContentChunk, "content"> & { deliveredAt: string };
export type EvidenceAttribution = {
  skillId: string;
  stepId: string;
  attempt: number;
  relation: "produced" | "informed" | "verified";
  ruleIds: string[];
};
export type EvidenceArtifact = {
  artifactId: string;
  kind: string;
  path: string;
  sourcePath?: string;
  sha256: string;
  size: number;
  validatedAs?: "input" | "output" | "critic-report";
  attributions: EvidenceAttribution[];
  sourceControl: SourceControlSnapshot;
};
export type SkillStepAttempt = { attempt: number; startedAt: string; completedAt?: string; evidenceIds: string[] };
export type StrictSkillStep = ExecutionContractV2["steps"][number] & {
  status: "pending" | "active" | "satisfied" | "skipped" | "blocked";
  attempts: SkillStepAttempt[];
};
export type VerificationReportV2 = {
  schemaVersion: "2.0";
  skillId: string;
  iteration: number;
  generatedAt: string;
  gateResults: Array<{ gateId: string; passed: boolean; level: "hard" | "advisory"; message?: string }>;
  hardPassed: boolean;
  evidenceIds: string[];
};
export type StrictSystemGateResult = {
  gateId: string;
  passed: boolean;
  level: "hard";
  message?: string;
};
export type CriticReportV2 = {
  schemaVersion: "2.0";
  skillId: string;
  criticInvocationId: string;
  executorInvocationId: string;
  outcome: "clean" | "findings";
  findings: Array<{
    id: string;
    ruleId: string;
    severity: "critical" | "high" | "medium" | "low";
    message: string;
    evidenceArtifactIds: string[];
    remediation: string;
  }>;
};
export type RepairRequestV2 = {
  schemaVersion: "2.0";
  skillId: string;
  iteration: number;
  maxIterations: number;
  gateIds: string[];
  sourceReportIndex: number;
};
export type SkillLedger = {
  skillId: string;
  role: "primary" | "companion";
  mandatory: boolean;
  version: string;
  packageChecksum: string;
  contractChecksum: string;
  contract: ExecutionContractV2;
  schemaSnapshots: { input: Record<string, unknown>; output: Record<string, unknown> };
  schemaChecksums: { input: string; output: string };
  input: Record<string, unknown>;
  state: "reading" | "ready" | "running" | "verifying" | "repair-required" | StrictSkillOutcome;
  applicability: { applicable: boolean; unmetPrerequisites: string[] };
  contentChunks: SkillContentChunk[];
  readReceipts: SkillReadReceipt[];
  steps: StrictSkillStep[];
  repairIterations: number;
  verificationReports: VerificationReportV2[];
  repairRequests: RepairRequestV2[];
  outcome?: StrictSkillOutcome;
};
export type StrictSkillSelection = {
  skillId: string;
  role: "primary" | "companion";
  mandatory: boolean;
  version: string;
  packageChecksum: string;
  contractChecksum: string;
  contract: ExecutionContractV2;
  schemaSnapshots: { input: Record<string, unknown>; output: Record<string, unknown> };
  schemaChecksums: { input: string; output: string };
  input?: Record<string, unknown>;
  contentChunks: SkillContentChunk[];
  applicable: boolean;
  unmetPrerequisites: string[];
};
export type SkillRunV2 = {
  schemaVersion: "2.0";
  certification: "strict";
  runId: string;
  domain: string;
  targetAgent: string;
  locale: "en" | "ru" | "mixed" | "unknown";
  state: StrictSkillRunState;
  revision: number;
  createdAt: string;
  updatedAt: string;
  intent: { sha256: string; normalizedGoal: string; raw?: string };
  recommendations: Array<{ skillId: string; role: "primary" | "companion"; strictCompatible: boolean }>;
  excludedRecommendations: Array<{ skillId: string; reason: "strict-contract-missing" }>;
  skillLedgers: SkillLedger[];
  artifacts: EvidenceArtifact[];
  sourceControl: SourceControlSnapshot;
};

export class StrictSkillRunError extends Error {
  readonly code: StrictSkillRunErrorCode;

  constructor(code: StrictSkillRunErrorCode, message: string) {
    super(message);
    this.name = "StrictSkillRunError";
    this.code = code;
  }
}

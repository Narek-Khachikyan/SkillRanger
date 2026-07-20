export type TaskAction =
  | "create"
  | "implement"
  | "modify"
  | "fix"
  | "debug"
  | "review"
  | "test"
  | "verify"
  | "document"
  | "deploy"
  | "migrate"
  | "optimize"
  | "research"
  | "design"
  | "configure"
  | "investigate";

export type RiskLevel = "low" | "medium" | "high" | "block";
export type RouterSelectableRisk = Extract<RiskLevel, "low" | "medium">;
export type TaskLocale = "en" | "ru" | "mixed" | "unknown";
export type RouterSkillRole = "environment" | "primary" | "companion" | "verification" | "agent-context";
export type PreparedSkillSource = "installed" | "bundled-registry" | "test-fixture-registry";

export type TaskSignalEvidence = {
  source: "prompt" | "fingerprint" | "registry" | "config";
  kind: "action" | "artifact" | "technology" | "quality" | "domain" | "constraint" | "acceptance";
  id: string;
};

export type TaskSubtask = {
  id: string;
  normalizedGoal: string;
  actions: TaskAction[];
  artifactTypes: string[];
  candidateDomainIds: string[];
};

export type DomainCandidate = {
  id: string;
  confidence: number;
  role: "primary" | "supporting";
  available: boolean;
  reasons: string[];
  evidence: TaskSignalEvidence[];
};

export type TaskProfile = {
  schemaVersion: "task-profile/1.0";
  normalizedGoal: string;
  locale: TaskLocale;
  actions: TaskAction[];
  artifactTypes: string[];
  technologies: string[];
  constraints: string[];
  qualityGoals: string[];
  acceptanceCriteria: string[];
  domains: DomainCandidate[];
  subtasks: TaskSubtask[];
  evidence: TaskSignalEvidence[];
};

export type PreparedSkillSelection = {
  skillId: string;
  displayName: string;
  role: RouterSkillRole;
  domains: string[];
  version: string;
  packageChecksum: string;
  score: number;
  source: PreparedSkillSource;
  reasons: string[];
  verificationStatus: "ready" | "guidance-only" | "not-required";
};

export type PreparedSelections = {
  environment: PreparedSkillSelection[];
  primary: PreparedSkillSelection;
  companions: PreparedSkillSelection[];
  verification: PreparedSkillSelection[];
  agentContext: PreparedSkillSelection[];
};

export type RuntimeRunReference =
  | { kind: "lifecycle-v1"; runId: string }
  | { kind: "strict-v2"; runId: string };

export type RouterRoutingSnapshot = {
  targetAgent: string;
  domains: DomainCandidate[];
  deterministicKey: string;
  routerAlgorithmVersion: string;
  routingDate: string;
  fingerprintDigest: string;
  registryDigest: string;
  configDigest: string;
};

export type RouterReadReceipt = {
  readRequestId: string;
  expectedReadRevision: number;
  resultingReadRevision: number;
  mode: "mandatory-next" | "optional-file";
  skillId: string;
  path: string;
  fileChecksum: string;
  offset: number;
  bytes: number;
  chunkChecksum: string;
  deliveredAt: string;
};

export type SkillSourceSnapshot = {
  skillId: string;
  source: PreparedSkillSource;
  version: string;
  packageChecksum: string;
  auditDigest: string;
  rootIdentity: string;
  locator:
    | { kind: "installed"; targetAgent: string; installedPath: string }
    | { kind: "bundled-registry" | "test-fixture-registry"; skillId: string };
  files: Array<{
    path: string;
    checksum: string;
    bytes: number;
    mimeType: "text/markdown" | "text/plain" | "application/json";
    mandatory: boolean;
  }>;
};

export type RouterRun = {
  schemaVersion: "router-run/1.0";
  routerRunId: string;
  revision: number;
  readRevision: number;
  state: "prepared" | "reading" | "ready" | "failed";
  createdAt: string;
  updatedAt: string;
  projectIdentity: string;
  taskProfile: TaskProfile;
  routing: RouterRoutingSnapshot;
  selections: PreparedSelections;
  sourceInventory: SkillSourceSnapshot[];
  readLedger: RouterReadReceipt[];
  runtime: RuntimeRunReference;
  failure?: {
    code: "run-integrity" | "source-unavailable" | "recovery-required";
    reasonCode: string;
  };
};

export type RouterJournalEntry = {
  schemaVersion: "router-journal/1.0";
  operationId: string;
  routerRunId: string;
  runtimeRunId: string;
  payloadDigest: string;
  intendedTransition: "create-runtime-and-router" | "record-read";
  createdAt: string;
};

export type SkillReadInstruction = {
  order: number;
  skillId: string;
  path: string;
  checksum: string;
  bytes: number;
  mandatory: true;
};

export type RouterClarification = {
  questions: Array<{
    id: string;
    text: string;
    options: Array<{ value: string; label: string }>;
  }>;
};

export type InstallationSuggestion = {
  skillId: string;
  reason: string;
  nextTool: "plan_skill_install";
};

export type RuntimeClarificationSummary = {
  questions: Array<{ id: string; fields: string[]; text: string; allowDecline: boolean }>;
};

export type RouterExplanation = {
  deterministicKey: string;
  domains: Array<{ id: string; score: number; reasonCodes: string[] }>;
  candidates: Array<{ skillId: string; score: number; excluded?: string }>;
  selectedRoles: Record<RouterSkillRole, string[]>;
  omitted: Array<{ skillId: string; reasonCode: string }>;
};

export type PrepareTaskCoreInput = {
  projectRoot: string;
  registry: {
    kind: "bundled" | "test-fixture";
    root: string;
  };
  prompt: string;
  activation: {
    mode: "explicit" | "direct";
  };
  targetAgent?: string;
  capabilities?: Array<{
    id: string;
    source: "host-reported" | "server-observed";
  }>;
  strict?: boolean;
  skillInputs?: Record<string, Record<string, unknown>>;
  continuationToken?: string;
  clarificationAnswers?: Array<{
    questionId: string;
    value: string;
  }>;
  routingDate?: string;
  rawIntentPersistence?: "disabled" | "explicitly-authorized";
};

export type TriggerParseResult =
  | {
      activated: true;
      mode: "explicit" | "direct";
      trigger?: "@skillranger" | "skillranger" | "/sr";
      originalPrompt: string;
      normalizedIntent: string;
    }
  | {
      activated: false;
      mode: "explicit" | "direct";
      originalPrompt: string;
      reason: "trigger-required" | "empty-intent" | "intent-too-large";
    };

export type PrepareTaskCommon = {
  ok: true;
  schemaVersion: "router-result/1.0";
  activation: { mode: "explicit" | "direct"; trigger?: "@skillranger" | "skillranger" | "/sr" };
  taskProfile: TaskProfile;
  project: {
    displayRoot: string;
    fingerprintDigest: string;
    projectTypes: string[];
    languages: string[];
    frameworks: string[];
  };
  routing: {
    targetAgent: string;
    domains: DomainCandidate[];
    deterministicKey: string;
    routerAlgorithmVersion: string;
    routingDate: string;
    registryDigest: string;
    configDigest: string;
  };
  warnings: string[];
};

export type PrepareTaskResult =
  | (PrepareTaskCommon & {
      status: "prepared";
      run: {
        routerRunId: string;
        runtimeRunId: string;
        runtime: "lifecycle-v1" | "strict-v2";
        strict: boolean;
        readRevision: number;
      };
      selections: PreparedSelections;
      requiredReads: SkillReadInstruction[];
      runtimeClarification?: RuntimeClarificationSummary;
      verification: {
        required: boolean;
        available: boolean;
        missingCapabilities: string[];
        expectedEvidenceKinds: string[];
      };
    })
  | (PrepareTaskCommon & {
      status: "clarification_required";
      clarification: RouterClarification;
      continuationToken: string;
      expiresAt: string;
    })
  | (PrepareTaskCommon & { status: "decomposition_required"; decomposition: { subtasks: TaskSubtask[] } })
  | (PrepareTaskCommon & { status: "no_matching_skills"; suggestedAction: string })
  | (PrepareTaskCommon & {
      status: "strict_requirements_unmet";
      missing: Array<{
        skillId?: string;
        requirement: "installed-skill" | "lockfile-match" | "strict-contract-v2" | "skill-input" | "capability";
      }>;
      installationSuggestions: InstallationSuggestion[];
    })
  | (PrepareTaskCommon & {
      status: "context_budget_exceeded";
      requiredBytes: number;
      allowedBytes: number;
      blockingSkillIds: string[];
    });

export type RouterToolErrorCode =
  | "invalid-arguments"
  | "trigger-required"
  | "empty-intent"
  | "intent-too-large"
  | "router-disabled"
  | "target-agent-unresolved"
  | "project-root-unauthorized"
  | "continuation-invalid"
  | "continuation-expired"
  | "clarification-answer-invalid"
  | "skill-not-selected"
  | "skill-source-unavailable"
  | "skill-file-not-found"
  | "skill-path-blocked"
  | "skill-file-unsupported"
  | "stale-skill-checksum"
  | "read-request-conflict"
  | "read-order-invalid"
  | "context-budget-exceeded"
  | "capability-invalid"
  | "router-config-invalid"
  | "raw-intent-confirmation-required"
  | "routing-integrity"
  | "run-not-found"
  | "run-integrity";

export type RouterToolError = {
  ok: false;
  code: RouterToolErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export type ReadRunSkillFileInput = {
  routerRunId: string;
  readRequestId: string;
  expectedReadRevision: number;
} & (
  | { mode: "mandatory-next" }
  | { mode: "optional-file"; skillId: string; path: string }
);

export type ReadRunSkillFileResult = {
  ok: true;
  schemaVersion: "router-read-result/1.0";
  routerRunId: string;
  runtimeRunId: string;
  runtime: "lifecycle-v1" | "strict-v2";
  readRequestId: string;
  readRevision: number;
  skillId: string;
  path: string;
  mimeType: "text/markdown" | "text/plain" | "application/json";
  content: string;
  fileChecksum: string;
  chunkChecksum: string;
  deliveredOffset: number;
  deliveredBytes: number;
  totalBytes: number;
  complete: boolean;
  readStatus: {
    fileComplete: boolean;
    skillMandatoryReadsComplete: boolean;
    runMandatoryReadsComplete: boolean;
  };
};

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export type VerificationFinding = {
  id: string;
  code: string;
  source: string;
  severity: FindingSeverity;
  gate: "hard" | "soft";
  message: string;
  evidence: string[];
  affectedSurface?: string;
  remediation: string;
  autofixable: boolean;
};

export type CapabilityStatus = "ready" | "degraded" | "unavailable";
export type ExecutionStatus = "not-started" | "running" | "implemented" | "failed" | "blocked";
export type ResultVerificationStatus = "not-run" | "passed" | "failed" | "partial";
export type VerificationOutcome = "verified" | "implemented-unverified" | "failed" | "blocked";

export type VerificationReport = {
  schemaVersion: "1.0";
  domain: string;
  workflowId: string;
  iteration: number;
  capabilityStatus: CapabilityStatus;
  executionStatus: ExecutionStatus;
  verificationStatus: ResultVerificationStatus;
  outcome: VerificationOutcome;
  findings: VerificationFinding[];
  gates: {
    hardPassed: boolean;
    criticalFindings: number;
    highFindings: number;
  };
  evidence: Array<{
    kind: string;
    path?: string;
    description: string;
  }>;
  residualRisks: string[];
};

export type WorkflowStep = {
  id: string;
  type: "collect" | "validate" | "model" | "implement" | "verify" | "repair" | "report";
  requires: string[];
  produces: string[];
  gate?: string;
};

export type WorkflowBranchContext = {
  criticOutcome: "selected" | "no-acceptable-variant";
  profile: "constrained" | "standard" | "advanced";
  repairFindingCount: number;
};

export type WorkflowBranch = {
  id: string;
  afterStepId: string;
  convergeAt: string;
  cases: Array<{
    id: string;
    when: {
      criticOutcome: WorkflowBranchContext["criticOutcome"];
      profiles?: WorkflowBranchContext["profile"][];
      repairFindings?: "zero" | "positive";
    };
    stepIds: string[];
    terminal?: boolean;
  }>;
};

export type WorkflowDefinition = {
  schemaVersion: "1.0";
  id: string;
  domain: string;
  requiredCapabilities: string[];
  maxRepairIterations: number;
  steps: WorkflowStep[];
  branches?: WorkflowBranch[];
};

export type RepairRequest = {
  schemaVersion: "1.0";
  workflowId: string;
  iteration: number;
  maxIterations: number;
  stopReason?: "hard-gates-passed" | "iteration-limit" | "blocked";
  findings: VerificationFinding[];
  instructions: string[];
};

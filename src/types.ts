export type Confidence = "low" | "medium" | "high";

export type Signal = {
  name: string;
  confidence: number;
  evidence: string[];
};

export type ProjectType = {
  type: string;
  confidence: number;
  evidence?: string[];
};

export type ProjectFingerprint = {
  schemaVersion: "1.0";
  root: string;
  packageManager?: {
    name: string;
    confidence: number;
    evidence: string[];
  };
  projectTypes: ProjectType[];
  languages: Signal[];
  frameworks: Signal[];
  styling: Signal[];
  testing: Array<Signal & { type?: string }>;
  infrastructure: Signal[];
  agentContext: {
    agentsMd: { present: boolean; paths: string[] };
    codexSkills: { present: boolean; paths: string[] };
    claudeSkills: { present: boolean; paths: string[] };
  };
  signals: string[];
  tags: string[];
  warnings: string[];
};

export type RiskLevel = "low" | "medium" | "high" | "block";
export type CompatibilityLevel = "native" | "convertible" | "packageable" | "unsupported";
export type EvaluationStatus = "none" | "trigger-eval" | "task-eval" | "real-project-smoke" | "curated";
export type VerificationStatus = "ready" | "unverified" | "blocked";
export const skillLanes = [
  "framework",
  "design",
  "implementation",
  "qa",
  "agent-context",
] as const;
export type SkillLane = (typeof skillLanes)[number];

export type SkillManifest = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  stackTags: string[];
  taskTags: string[];
  supportedAgents: string[];
  routing?: {
    lane: SkillLane;
    category: string;
  };
  source: {
    type: string;
    registry: string;
    path: string;
  };
  version: string;
  checksum?: string;
  riskLevel: RiskLevel;
  permissions: {
    filesystem: string[];
    network: boolean;
    shell: boolean;
    writes?: string[];
  };
  scripts: string[];
  dependencies: string[];
  qualityScore: number;
  securityScore: number;
  quality?: {
    rubricVersion: "1.0";
    scores: {
      usefulness: number;
      triggerSpecificity: number;
      progressiveDisclosure: number;
      safety: number;
      verifiability: number;
      maintainability: number;
      portability: number;
    };
  };
  evaluation?: {
    status: EvaluationStatus;
    lastRunAt?: string;
    benchmarkVersion?: string;
    evidenceUri?: string;
    score?: number;
  };
  verification?: {
    requiredCapabilities: string[];
    fallback: Exclude<VerificationStatus, "ready">;
  };
  freshness?: {
    lastReviewedAt?: string;
    targetFrameworkVersions?: Record<string, string>;
  };
  installTargets: string[];
  compatibility?: Record<
    string,
    {
      level: CompatibilityLevel;
      scopes?: InstallScope[];
      adapter?: string;
      requiresAdapter?: boolean;
      requires?: string[];
    }
  >;
  conflictsWith: string[];
  supersedes: string[];
  maintainer: {
    name: string;
    trustTier: string;
  };
  license: string;
};

export type RegistrySkill = {
  manifest: SkillManifest;
  path: string;
  skillPath: string;
  checksum: string;
};

export type AuditFinding = {
  severity: RiskLevel;
  code: string;
  message: string;
  path?: string;
};

export type AuditReport = {
  skillId: string;
  checksum: string;
  riskLevel: RiskLevel;
  securityScore: number;
  findings: AuditFinding[];
};

export type Recommendation = {
  skillId: string;
  displayName: string;
  role?: "primary" | "companion";
  lane?: SkillLane;
  category?: string;
  score: number;
  scoreBreakdown: {
    stackMatch: number;
    userIntentMatch: number;
    qualityScore: number;
    securityScore: number;
    freshnessScore: number;
    compatibilityScore: number;
    duplicatePenalty: number;
    evaluationPenalty: number;
    laneAdjustment: number;
    skillAdjustment: number;
    finalScore: number;
  };
  riskLevel: RiskLevel;
  verification: {
    status: VerificationStatus;
    missingCapabilities: string[];
  };
  reasons: string[];
};

export type InstallScope = "repo" | "user";

export type InstallPlan = {
  skillId: string;
  targetAgent: string;
  scope: InstallScope;
  dryRun: boolean;
  writes: string[];
  lockfileUpdates: string[];
  warnings: string[];
};

export type Lockfile = {
  schemaVersion: "1.0";
  installed: Array<{
    skillId: string;
    version: string;
    checksum: string;
    targetAgent: string;
    scope: InstallScope;
    installedPath: string;
    source: SkillManifest["source"];
    audit: {
      riskLevel: RiskLevel;
      securityScore: number;
      findings: AuditFinding[];
    };
  }>;
};

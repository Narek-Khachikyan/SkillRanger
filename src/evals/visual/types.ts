import type { VisualCriterion } from "../../domains/frontend/design/visual-loop-types.ts";
export type { VisualCriterion } from "../../domains/frontend/design/visual-loop-types.ts";

export type VisualBenchmarkBrief = {
  schemaVersion: "1.0";
  id: string;
  recipeId: string;
  prompt: string;
  fixture: string;
  route: string;
  productFacts: string[];
  contentShapes: string[];
  requiredViewports: [390, 768, 1440];
  requiredStates: string[];
  scoringCriteria: VisualCriterion[];
  forbiddenInvention: Array<"metrics" | "testimonials" | "people" | "brands" | "transactions">;
};

export type VisualBenchmarkSuite = {
  schemaVersion: "1.0";
  version: "visual-benchmark-v1";
  skillRangerVersion: string;
  skillRangerChecksum: string;
  toolCapabilities: string[];
  briefs: VisualBenchmarkBrief[];
};

export type VisualCapabilityCandidate = { id: "weak" | "medium" | "strong"; modelId: string; commandProfile: string };
export type VisualBenchmarkArm = "without-skillranger" | "with-skillranger";
export type VisualBenchmarkPlanEntry = {
  runId: string; briefId: string; recipeId: string; capabilityCandidateId: VisualCapabilityCandidate["id"];
  modelId: string; commandProfile: string; arm: VisualBenchmarkArm; repetition: 1 | 2;
  prompt: string; fixture: string; route: string;
};
export type VisualBenchmarkPlan = { schemaVersion: "1.0"; benchmarkVersion: string; skillRangerVersion: string; skillRangerChecksum: string; entries: VisualBenchmarkPlanEntry[] };
export type VisualVerificationOutcome = "verified" | "failed" | "implemented-unverified" | "blocked";
export type VisualBenchmarkRunResult = VisualBenchmarkPlanEntry & {
  benchmarkVersion: string; skillRangerVersion: string; skillRangerChecksum: string; workspacePath: string;
  resultPath: string; dryRun: boolean; exitCode: number | null; signal: string | null; durationMs: number;
  stdoutPath?: string; stderrPath?: string; artifactPaths: string[];
  operationalEvidence: "complete" | "incomplete"; hardGateFailed: boolean | null; repairIterations: number | null;
  verificationOutcome: VisualVerificationOutcome | null; completionClaimed: boolean | null;
};

export type VisualHumanReview = {
  schemaVersion: "1.0"; benchmarkVersion: string; reviewerId: string; reviewerType: "human";
  judgments: Array<{ pairId: string; scoresA: Record<VisualCriterion, number>; scoresB: Record<VisualCriterion, number>; preference: "A" | "B" | "tie"; catastrophicA: boolean; catastrophicB: boolean; notes: string[] }>;
};

export type VisualBenchmarkMetricSet = {
  runSlots: number; sampleCount: number; meanQuality: number; medianQuality: number;
  pairwiseSkillRangerPreferenceShare: number; withinConditionVariance: number; repeatDesignAxisDivergence: number;
  catastrophicFailureRate: number; hardGateFailureRate: number; meanRepairIterations: number;
  verificationSuccessRate: number; falseCompletionRate: number;
};
export type VisualCandidateMetricSet = VisualBenchmarkMetricSet & {
  modelIds: string[]; successfulRecipeIds: string[]; evidencePaths: string[];
};
export type VisualBenchmarkReport = {
  schemaVersion: "1.0"; benchmarkVersion: string; metrics: VisualBenchmarkMetricSet;
  byCapability: Record<VisualCapabilityCandidate["id"], VisualCandidateMetricSet>;
  byArm: Record<VisualBenchmarkArm, VisualBenchmarkMetricSet>;
  skillRangerDeltas: Record<string, number>;
  modelIds: string[]; successfulRecipeIds: string[]; evidencePaths: string[];
};

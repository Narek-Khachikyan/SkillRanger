import { readFile } from "node:fs/promises";
import { loadLocalRegistry } from "../registry/index.ts";
import { recommendSkills } from "../recommender/index.ts";
import { scanProject } from "../scanner/index.ts";
import { defaultFrontendEvalSuitePath, defaultRegistryRoot } from "../paths.ts";
import type { Recommendation } from "../types.ts";

export type GraderType =
  | "code"
  | "test"
  | "schema"
  | "screenshot"
  | "browser"
  | "axe"
  | "lighthouse"
  | "static-analysis"
  | "runtime"
  | "human"
  | "pairwise"
  | "llm-judge"
  | "llm_judge"
  | "benchmark";

export type FrontendGraderType = GraderType;

export type FrontendEvalLocale = "en" | "ru" | "all";

export type FrontendRoutingExpected = {
  expectedSkill?: string;
  acceptableAlternates?: string[];
  shouldNotTrigger?: boolean;
  triageOnly?: boolean;
  falsePositiveSeverity?: "low" | "medium" | "high";
};

export type FrontendTaskAssertion =
  | string
  | {
      text: string;
      graderType: FrontendGraderType;
      requiredArtifacts?: string[];
    };

export type FrontendTriggerPrompt = {
  id: string;
  kind: "should-trigger" | "should-not-trigger" | "ambiguous";
  expectedSkill?: string;
  routingExpected?: FrontendRoutingExpected;
  text: string;
};

export type FrontendEvalSuite = {
  schemaVersion: "1.0";
  name: string;
  targetCounts: {
    triggerPrompts: number;
    taskEvals: number;
  };
  triggerPrompts: FrontendTriggerPrompt[];
  taskBands: Array<{
    id: string;
    targetCount: number;
    seedTasks: Array<{
      id: string;
      prompt: string;
      assertions: FrontendTaskAssertion[];
    }>;
  }>;
  artifactContract?: {
    screenshots?: string[];
    requiredMetadata?: string[];
    optionalArtifacts?: string[];
  };
  scoring: {
    utilityWeights: Record<string, number>;
    promotionGates: Record<string, number | string>;
  };
  skillSlices?: Array<{
    id: string;
    skillId: string;
    taskIds: string[];
    triggerPromptIds?: string[];
  }>;
};

export type FrontendTaskEvidenceStatus = "passed" | "failed" | "not-assessed";

export type FrontendTaskEvidence = {
  schemaVersion: "1.0";
  suiteName: string;
  baselines?: string[];
  repetitions?: number;
  skillSlice?: string;
  runs: Array<{
    runId: string;
    taskId: string;
    baseline?: string;
    repetition?: number;
    skillId: string;
    skillVersion: string;
    skillChecksum: string;
    model: string;
    fixture: string;
    command: string;
    durationMs: number;
    exitCode?: number | null;
    signal?: string | null;
    expectedArtifacts?: string[];
    artifacts: Array<{
      name: string;
      path: string;
    }>;
    assertions: Array<{
      text: string;
      status: FrontendTaskEvidenceStatus;
    }>;
    verification?: {
      outcome: "verified" | "implemented-unverified" | "failed" | "blocked";
      hardGatesPassed: boolean;
      criticalFindings: number;
    };
  }>;
};

export type FrontendVarianceSummary = {
  repetitions: number;
  issues: string[];
  promotionReady: boolean;
  groups: Array<{
    baseline: string;
    model: string;
    runs: number;
    passRate: number;
    worstRunPassRate: number;
    passRateStdDev: number;
    failedAssertions: number;
    falseCompletionClaims: number;
  }>;
  comparisons: Array<{
    candidate: string;
    baseline: string;
    passRateDelta: number;
    worstRunDelta: number;
    varianceDelta: number;
  }>;
};

export type FrontendTaskEvidenceReport = {
  issues: string[];
  metrics: {
    expectedTasks: number;
    recordedTasks: number;
    expectedRuns: number;
    recordedRuns: number;
    artifactCount: number;
    passedAssertions: number;
    failedAssertions: number;
    unassessedAssertions: number;
    promotionReady: boolean;
  };
};

export type FrontendPairwiseReview = {
  schemaVersion: "1.0";
  suiteName: string;
  skillSlice?: string;
  candidateUnderTestLabel: "A" | "B";
  comparisons: Array<{
    comparisonId: string;
    taskId: string;
    labels: ["A", "B"];
    winner: "A" | "B" | "tie" | "abstain";
    reviewer: {
      kind: "human";
      id: string;
    };
  }>;
};

export type FrontendPairwiseReviewReport = {
  issues: string[];
  metrics: {
    expectedTasks: number;
    reviewedTasks: number;
    decisiveComparisons: number;
    candidateWins: number;
    candidateLosses: number;
    ties: number;
    abstains: number;
    candidatePreferenceShare: number;
    promotionReady: boolean;
  };
};

export type FrontendEvalSummary = {
  name: string;
  locale: FrontendEvalLocale;
  triggerPrompts: {
    total: number;
    shouldTrigger: number;
    shouldNotTrigger: number;
    ambiguous: number;
    target: number;
    suiteTarget: number;
  };
  taskEvals: {
    seedTasks: number;
    target: number;
    bands: string[];
  };
  utilityWeightTotal: number;
  promotionGates: string[];
};

export type FrontendRoutingEvalFailureReason =
  | "unexpected-frontend-skill"
  | "missing-top-skill"
  | "wrong-top-skill"
  | "missing-acceptable-alternates";

export type FrontendRoutingEvalFailure = {
  id: string;
  expected: string;
  actual: string | null;
  reason: FrontendRoutingEvalFailureReason;
  topRecommendations: Recommendation[];
};

export type FrontendRoutingEvalMetrics = {
  total: number;
  evaluated: number;
  skipped: number;
  passed: number;
  failed: number;
  overallPassRate: number;
  expectedSkillRecall: number;
  shouldNotTriggerSpecificity: number;
};

export type FrontendRoutingEvalReport = {
  projectRoot: string;
  targetAgent: string;
  locale: FrontendEvalLocale;
  selectedPrompts: number;
  suitePrompts: number;
  metrics: FrontendRoutingEvalMetrics;
  failures: FrontendRoutingEvalFailure[];
};

export type RunFrontendRoutingEvalOptions = {
  projectRoot: string;
  targetAgent?: string;
  registryRoot?: string;
  locale?: FrontendEvalLocale;
};

const sum = (values: number[]) =>
  Number(values.reduce((total, value) => total + value, 0).toFixed(4));

const graderTypes: Record<FrontendGraderType, true> = {
  code: true,
  test: true,
  schema: true,
  screenshot: true,
  browser: true,
  axe: true,
  lighthouse: true,
  "static-analysis": true,
  runtime: true,
  human: true,
  llm_judge: true,
  "llm-judge": true,
  pairwise: true,
  benchmark: true,
};

const roundedRate = (passed: number, total: number) =>
  total === 0 ? 1 : Number((passed / total).toFixed(3));

const frontendRecommendations = (recommendations: Recommendation[]) =>
  recommendations.filter((recommendation) => recommendation.skillId.startsWith("frontend."));

const topSkillId = (recommendations: Recommendation[]) =>
  recommendations[0]?.skillId ?? null;

const failure = (
  prompt: FrontendTriggerPrompt,
  expected: string,
  actual: string | null,
  reason: FrontendRoutingEvalFailureReason,
  recommendations: Recommendation[],
): FrontendRoutingEvalFailure => ({
  id: prompt.id,
  expected,
  actual,
  reason,
  topRecommendations: recommendations.slice(0, 5),
});

export const loadFrontendEvalSuite = async (
  suitePath = defaultFrontendEvalSuitePath,
): Promise<FrontendEvalSuite> =>
  JSON.parse(await readFile(suitePath, "utf8")) as FrontendEvalSuite;

export const loadFrontendTaskEvidence = async (
  evidencePath: string,
): Promise<FrontendTaskEvidence> =>
  JSON.parse(await readFile(evidencePath, "utf8")) as FrontendTaskEvidence;

export const loadFrontendPairwiseReview = async (
  reviewPath: string,
): Promise<FrontendPairwiseReview> =>
  JSON.parse(await readFile(reviewPath, "utf8")) as FrontendPairwiseReview;

export const validateFrontendEvalSuite = (suite: FrontendEvalSuite) => {
  const issues: string[] = [];
  if (suite.schemaVersion !== "1.0") issues.push("schemaVersion must be 1.0");
  if (!suite.name?.trim()) issues.push("name is required");

  const promptIds = new Set<string>();
  for (const prompt of suite.triggerPrompts ?? []) {
    if (!prompt.id?.trim()) issues.push("trigger prompt id is required");
    if (promptIds.has(prompt.id)) issues.push(`duplicate trigger prompt id: ${prompt.id}`);
    promptIds.add(prompt.id);
    if (!prompt.text?.trim()) issues.push(`trigger prompt ${prompt.id} text is required`);
    if (!["should-trigger", "should-not-trigger", "ambiguous"].includes(prompt.kind)) {
      issues.push(`trigger prompt ${prompt.id} has invalid kind`);
    }
    if (prompt.routingExpected !== undefined) {
      const routing = prompt.routingExpected;
      if (routing.expectedSkill !== undefined && !routing.expectedSkill.trim()) {
        issues.push(`trigger prompt ${prompt.id} routingExpected.expectedSkill is required when present`);
      }
      if (
        routing.acceptableAlternates !== undefined &&
        (!Array.isArray(routing.acceptableAlternates) || routing.acceptableAlternates.some((skill) => !skill.trim()))
      ) {
        issues.push(`trigger prompt ${prompt.id} routingExpected.acceptableAlternates must be non-empty strings`);
      }
      if (routing.shouldNotTrigger !== undefined && typeof routing.shouldNotTrigger !== "boolean") {
        issues.push(`trigger prompt ${prompt.id} routingExpected.shouldNotTrigger must be boolean`);
      }
      if (routing.triageOnly !== undefined && typeof routing.triageOnly !== "boolean") {
        issues.push(`trigger prompt ${prompt.id} routingExpected.triageOnly must be boolean`);
      }
      if (
        routing.triageOnly === true &&
        (!Array.isArray(routing.acceptableAlternates) || routing.acceptableAlternates.length === 0)
      ) {
        issues.push(`trigger prompt ${prompt.id} routingExpected.acceptableAlternates is required for triageOnly`);
      }
      if (
        routing.falsePositiveSeverity !== undefined &&
        !["low", "medium", "high"].includes(routing.falsePositiveSeverity)
      ) {
        issues.push(`trigger prompt ${prompt.id} routingExpected.falsePositiveSeverity is invalid`);
      }
    }
  }
  const seededTriggerPrompts = (suite.triggerPrompts ?? []).length;
  if (suite.targetCounts?.triggerPrompts !== seededTriggerPrompts) {
    issues.push(
      `targetCounts.triggerPrompts must equal seeded prompts (${seededTriggerPrompts}).`,
    );
  }

  const taskIds = new Set<string>();
  for (const band of suite.taskBands ?? []) {
    if (!band.id?.trim()) issues.push("task band id is required");
    if (!Number.isInteger(band.targetCount) || band.targetCount <= 0) {
      issues.push(`task band ${band.id} targetCount must be positive`);
    }
    if (band.targetCount !== (band.seedTasks ?? []).length) {
      issues.push(
        `task band ${band.id} targetCount must equal seeded tasks (${(band.seedTasks ?? []).length}).`,
      );
    }
    for (const task of band.seedTasks ?? []) {
      if (!task.id?.trim()) issues.push(`task id is required in band ${band.id}`);
      if (taskIds.has(task.id)) issues.push(`duplicate task id: ${task.id}`);
      taskIds.add(task.id);
      if (!task.prompt?.trim()) issues.push(`task ${task.id} prompt is required`);
      if (!Array.isArray(task.assertions) || task.assertions.length === 0) {
        issues.push(`task ${task.id} must include assertions`);
      }
      for (const [index, assertion] of task.assertions.entries()) {
        if (typeof assertion === "string") {
          if (!assertion.trim()) issues.push(`task ${task.id} assertion ${index} text is required`);
          continue;
        }
        if (!assertion || typeof assertion !== "object" || Array.isArray(assertion)) {
          issues.push(`task ${task.id} assertion ${index} must be a string or object`);
          continue;
        }
        if (!assertion.text?.trim()) issues.push(`task ${task.id} assertion ${index} text is required`);
        if (typeof assertion.graderType !== "string" || !graderTypes[assertion.graderType as FrontendGraderType]) {
          issues.push(`task ${task.id} assertion ${index} graderType is invalid`);
        }
        if (
          assertion.requiredArtifacts !== undefined &&
          (!Array.isArray(assertion.requiredArtifacts) || assertion.requiredArtifacts.some((artifact) => !artifact.trim()))
        ) {
          issues.push(`task ${task.id} assertion ${index} requiredArtifacts must be non-empty strings`);
        }
      }
    }
  }
  const seededTaskEvals = (suite.taskBands ?? []).reduce(
    (count, band) => count + (band.seedTasks ?? []).length,
    0,
  );
  if (suite.targetCounts?.taskEvals !== seededTaskEvals) {
    issues.push(
      `targetCounts.taskEvals must equal seeded tasks (${seededTaskEvals}).`,
    );
  }

  if (suite.skillSlices !== undefined) {
    const sliceIds = new Set<string>();
    for (const slice of suite.skillSlices) {
      if (!slice.id?.trim()) issues.push("skill slice id is required");
      if (sliceIds.has(slice.id)) issues.push(`duplicate skill slice id: ${slice.id}`);
      sliceIds.add(slice.id);
      if (!slice.skillId?.trim()) issues.push(`skill slice ${slice.id} skillId is required`);
      if (!Array.isArray(slice.taskIds) || slice.taskIds.length === 0) {
        issues.push(`skill slice ${slice.id} taskIds must be non-empty`);
      } else {
        for (const taskId of slice.taskIds) {
          if (!taskIds.has(taskId)) issues.push(`skill slice ${slice.id} references unknown task: ${taskId}`);
        }
      }
      for (const promptId of slice.triggerPromptIds ?? []) {
        if (!promptIds.has(promptId)) issues.push(`skill slice ${slice.id} references unknown trigger prompt: ${promptId}`);
      }
    }
  }

  if (suite.artifactContract !== undefined) {
    for (const key of ["screenshots", "requiredMetadata", "optionalArtifacts"] as const) {
      const value = suite.artifactContract[key];
      if (value !== undefined && (!Array.isArray(value) || value.some((item) => !item.trim()))) {
        issues.push(`artifactContract.${key} must be non-empty strings when present`);
      }
    }
  }

  const weights = Object.values(suite.scoring?.utilityWeights ?? {});
  const weightTotal = sum(weights);
  if (Math.abs(weightTotal - 1) > 0.001) {
    issues.push(`utilityWeights must sum to 1.00, received ${weightTotal.toFixed(2)}`);
  }
  for (const gate of [
    "minimumTriggerRecall",
    "minimumTriggerPrecision",
    "minimumNoSkillDelta",
    "minimumOldSkillDelta",
    "maximumCategoryRegression",
    "minimumBlindPreferenceShare",
    "minimumRepetitions",
    "maximumPassRateStdDev",
  ]) {
    const value = suite.scoring?.promotionGates?.[gate];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
      issues.push(`promotionGates.${gate} must be a finite number when present`);
    }
  }

  return issues;
};

const assertionText = (assertion: FrontendTaskAssertion) =>
  typeof assertion === "string" ? assertion : assertion.text;

const assertionArtifacts = (assertion: FrontendTaskAssertion) =>
  typeof assertion === "string" ? [] : assertion.requiredArtifacts ?? [];

export const validateFrontendTaskEvidence = (
  suite: FrontendEvalSuite,
  evidence: FrontendTaskEvidence,
): FrontendTaskEvidenceReport => {
  const issues: string[] = [];
  const allTasks = (suite.taskBands ?? []).flatMap((band) => band.seedTasks ?? []);
  const selectedSlice = evidence.skillSlice
    ? suite.skillSlices?.find(
        (slice) => slice.id === evidence.skillSlice || slice.skillId === evidence.skillSlice,
      )
    : undefined;
  if (evidence.skillSlice && !selectedSlice) {
    issues.push(`task evidence references unknown skill slice: ${evidence.skillSlice}`);
  }
  const selectedTaskIds = selectedSlice ? new Set(selectedSlice.taskIds) : undefined;
  const tasks = selectedTaskIds
    ? allTasks.filter((task) => selectedTaskIds.has(task.id))
    : allTasks;
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const seenRunIds = new Set<string>();
  const seenRunKeys = new Set<string>();
  const comparisonMetadata = new Map<string, { model: string; fixture: string }>();
  const recordedTaskIds = new Set<string>();
  let artifactCount = 0;
  let passedAssertions = 0;
  let failedAssertions = 0;
  let unassessedAssertions = 0;

  if (evidence.schemaVersion !== "1.0") issues.push("task evidence schemaVersion must be 1.0");
  if (evidence.suiteName !== suite.name) issues.push(`task evidence suiteName must equal ${suite.name}`);
  if (!Array.isArray(evidence.runs)) {
    issues.push("task evidence runs must be an array");
  }
  const expectedBaselines = Array.isArray(evidence.baselines)
    ? [...new Set(evidence.baselines)]
    : [];
  if (expectedBaselines.some((baseline) => !baseline?.trim())) {
    issues.push("task evidence baselines must be non-empty strings");
  }
  const expectedRepetitions = evidence.repetitions ?? 1;
  if (!Number.isInteger(expectedRepetitions) || expectedRepetitions < 1) {
    issues.push("task evidence repetitions must be a positive integer");
  }

  for (const run of Array.isArray(evidence.runs) ? evidence.runs : []) {
    if (!run.runId?.trim()) issues.push("task evidence runId is required");
    if (seenRunIds.has(run.runId)) issues.push(`duplicate task evidence runId: ${run.runId}`);
    seenRunIds.add(run.runId);

    const task = taskById.get(run.taskId);
    if (!task) {
      issues.push(`task evidence references unknown task: ${run.taskId}`);
      continue;
    }
    recordedTaskIds.add(run.taskId);
    if (expectedBaselines.length > 0 && !run.baseline?.trim()) {
      issues.push(`task evidence ${run.taskId} baseline is required`);
    }
    if (
      run.baseline &&
      expectedBaselines.length > 0 &&
      !expectedBaselines.includes(run.baseline)
    ) {
      issues.push(`task evidence ${run.taskId} references unknown baseline: ${run.baseline}`);
    }
    if (expectedRepetitions > 1 && (!Number.isInteger(run.repetition) || (run.repetition ?? 0) < 1 || (run.repetition ?? 0) > expectedRepetitions)) {
      issues.push(`task evidence ${run.taskId} repetition must be from 1 to ${expectedRepetitions}`);
    }
    const runKey = [
      run.taskId,
      ...(expectedBaselines.length > 0 ? [run.baseline ?? ""] : []),
      ...(expectedRepetitions > 1 ? [`rep:${run.repetition ?? ""}`] : []),
    ].join("::");
    if (seenRunKeys.has(runKey)) {
      issues.push(`duplicate task evidence run: ${runKey}`);
    }
    seenRunKeys.add(runKey);
    if (expectedBaselines.length > 1) {
      const comparisonKey = [
        run.taskId,
        ...(expectedRepetitions > 1 ? [`rep:${run.repetition ?? ""}`] : []),
      ].join("::");
      const metadata = comparisonMetadata.get(comparisonKey);
      if (!metadata) {
        comparisonMetadata.set(comparisonKey, { model: run.model, fixture: run.fixture });
      } else {
        if (metadata.model !== run.model) {
          issues.push(`task evidence ${comparisonKey} must use the same model across baselines`);
        }
        if (metadata.fixture !== run.fixture) {
          issues.push(`task evidence ${comparisonKey} must use the same fixture across baselines`);
        }
      }
    }

    for (const key of ["skillId", "skillVersion", "skillChecksum", "model", "fixture", "command"] as const) {
      if (!run[key]?.trim()) issues.push(`task evidence ${run.taskId} ${key} is required`);
    }
    if (!Number.isFinite(run.durationMs) || run.durationMs <= 0) {
      issues.push(`task evidence ${run.taskId} durationMs must be positive`);
    }
    if (run.exitCode !== undefined && run.exitCode !== 0) {
      issues.push(
        `task evidence ${run.taskId}${run.baseline ? `::${run.baseline}` : ""} command failed with exit code ${run.exitCode}`,
      );
    }
    if (
      expectedBaselines.length > 0 &&
      run.baseline !== "without-skill" &&
      [run.skillId, run.skillVersion, run.skillChecksum].some(
        (value) => !value?.trim() || value === "(none)",
      )
    ) {
      issues.push(
        `task evidence ${run.taskId}::${run.baseline} requires skill id, version, and checksum`,
      );
    }
    if (
      expectedBaselines.length > 0 &&
      [run.model, run.fixture].some(
        (value) => !value?.trim() || value === "(none)",
      )
    ) {
      issues.push(
        `task evidence ${run.taskId}::${run.baseline} requires model and fixture metadata`,
      );
    }

    if (!Array.isArray(run.artifacts)) {
      issues.push(`task evidence ${run.taskId} artifacts must be an array`);
    }
    const artifactNames = new Set<string>();
    for (const artifact of Array.isArray(run.artifacts) ? run.artifacts : []) {
      artifactCount += 1;
      if (!artifact?.name?.trim() || !artifact.path?.trim()) {
        issues.push(`task evidence ${run.taskId} artifacts require name and path`);
        continue;
      }
      artifactNames.add(artifact.name);
    }

    if (!Array.isArray(run.assertions)) {
      issues.push(`task evidence ${run.taskId} assertions must be an array`);
    }
    const assertionByText = new Map<string, FrontendTaskEvidenceStatus>();
    for (const assertion of Array.isArray(run.assertions) ? run.assertions : []) {
      if (!assertion?.text?.trim()) {
        issues.push(`task evidence ${run.taskId} assertion text is required`);
        continue;
      }
      if (assertionByText.has(assertion.text)) {
        issues.push(`duplicate task evidence ${run.taskId} assertion: ${assertion.text}`);
      }
      if (!["passed", "failed", "not-assessed"].includes(assertion.status)) {
        issues.push(`task evidence ${run.taskId} assertion ${assertion.text} status is invalid`);
        continue;
      }
      assertionByText.set(assertion.text, assertion.status);
    }

    for (const expectedAssertion of task.assertions) {
      const text = assertionText(expectedAssertion);
      const status = assertionByText.get(text);
      if (!status) {
        issues.push(`task evidence ${run.taskId} is missing assertion: ${text}`);
        continue;
      }
      if (status === "passed") passedAssertions += 1;
      if (status === "failed") failedAssertions += 1;
      if (status === "not-assessed") unassessedAssertions += 1;
      for (const artifactName of assertionArtifacts(expectedAssertion)) {
        if (!artifactNames.has(artifactName)) {
          issues.push(`task evidence ${run.taskId} is missing required artifact ${artifactName}`);
        }
      }
    }
  }

  for (const task of tasks) {
    if (expectedBaselines.length === 0) {
      if (!recordedTaskIds.has(task.id)) {
        issues.push(`task evidence is missing task: ${task.id}`);
      }
      continue;
    }
    for (const baseline of expectedBaselines) {
      for (let repetition = 1; repetition <= expectedRepetitions; repetition += 1) {
        const expectedKey = [
          task.id,
          baseline,
          ...(expectedRepetitions > 1 ? [`rep:${repetition}`] : []),
        ].join("::");
        if (!seenRunKeys.has(expectedKey)) {
          issues.push(`task evidence is missing task/baseline: ${expectedKey}`);
        }
      }
    }
  }

  return {
    issues,
    metrics: {
      expectedTasks: tasks.length,
      recordedTasks: recordedTaskIds.size,
      expectedRuns: tasks.length * Math.max(expectedBaselines.length, 1) * Math.max(expectedRepetitions, 1),
      recordedRuns: seenRunKeys.size,
      artifactCount,
      passedAssertions,
      failedAssertions,
      unassessedAssertions,
      promotionReady: issues.length === 0 && failedAssertions === 0 && unassessedAssertions === 0,
    },
  };
};

const mean = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

const standardDeviation = (values: number[]) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  const squaredDeviations = values.reduce(
    (total, value) => total + (value - average) ** 2,
    0,
  );
  return Math.sqrt(squaredDeviations / (values.length - 1));
};

export const summarizeFrontendVariance = (
  evidence: FrontendTaskEvidence,
  suite?: FrontendEvalSuite,
): FrontendVarianceSummary => {
  const byGroup = new Map<string, FrontendTaskEvidence["runs"]>();
  for (const run of evidence.runs) {
    const key = `${run.baseline ?? "unspecified"}::${run.model}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), run]);
  }
  const groups = [...byGroup.entries()].map(([key, runs]) => {
    const [baseline, model] = key.split("::", 2) as [string, string];
    const byRepetition = new Map<number, typeof runs>();
    for (const run of runs) {
      const repetition = run.repetition ?? 1;
      byRepetition.set(repetition, [...(byRepetition.get(repetition) ?? []), run]);
    }
    const passRates = [...byRepetition.values()].map((repetitionRuns) => {
      const assessed = repetitionRuns.flatMap((run) =>
        run.assertions.filter((assertion) => assertion.status !== "not-assessed"),
      );
      const passed = assessed.filter((assertion) => assertion.status === "passed").length;
      return assessed.length === 0 ? 0 : passed / assessed.length;
    });
    const failedAssertions = runs.reduce(
      (total, run) => total + run.assertions.filter((assertion) => assertion.status === "failed").length,
      0,
    );
    const falseCompletionClaims = runs.filter((run) =>
      run.verification?.outcome === "verified" &&
      (
        !run.verification.hardGatesPassed ||
        run.verification.criticalFindings > 0 ||
        run.assertions.some((assertion) => assertion.status !== "passed")
      ),
    ).length;
    return {
      baseline,
      model,
      runs: runs.length,
      passRate: Number(mean(passRates).toFixed(4)),
      worstRunPassRate: Number(Math.min(...passRates).toFixed(4)),
      passRateStdDev: Number(standardDeviation(passRates).toFixed(4)),
      failedAssertions,
      falseCompletionClaims,
    };
  }).sort((a, b) => a.model.localeCompare(b.model) || a.baseline.localeCompare(b.baseline));
  const comparisons: FrontendVarianceSummary["comparisons"] = [];
  for (const candidate of groups.filter((group) => group.baseline === "current-skill")) {
    for (const baseline of groups.filter((group) => group.model === candidate.model && group.baseline !== "current-skill")) {
      comparisons.push({
        candidate: candidate.baseline,
        baseline: baseline.baseline,
        passRateDelta: Number((candidate.passRate - baseline.passRate).toFixed(4)),
        worstRunDelta: Number((candidate.worstRunPassRate - baseline.worstRunPassRate).toFixed(4)),
        varianceDelta: Number((candidate.passRateStdDev - baseline.passRateStdDev).toFixed(4)),
      });
    }
  }
  const issues: string[] = [];
  const currentGroups = groups.filter((group) => group.baseline === "current-skill");
  if (suite && currentGroups.length === 0) {
    issues.push("variance requires a current-skill model group");
  }
  if (suite) {
    for (const candidate of currentGroups) {
      for (const requiredBaseline of ["without-skill", "old-skill"] as const) {
        if (!groups.some(
          (group) => group.model === candidate.model && group.baseline === requiredBaseline,
        )) {
          issues.push(`${candidate.model} is missing required ${requiredBaseline} variance group`);
        }
      }
    }
  }
  const configuredMinimumRepetitions = suite?.scoring.promotionGates.minimumRepetitions;
  const minimumRepetitions = typeof configuredMinimumRepetitions === "number"
    ? configuredMinimumRepetitions
    : 1;
  const configuredMaximumStdDev = suite?.scoring.promotionGates.maximumPassRateStdDev;
  const maximumPassRateStdDev = typeof configuredMaximumStdDev === "number"
    ? configuredMaximumStdDev
    : 1;
  const normalizeDelta = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? (value >= 1 ? value / 100 : value) : 0;
  const minimumNoSkillDelta = normalizeDelta(suite?.scoring.promotionGates.minimumNoSkillDelta);
  const minimumOldSkillDelta = normalizeDelta(suite?.scoring.promotionGates.minimumOldSkillDelta);
  if ((evidence.repetitions ?? 1) < minimumRepetitions) {
    issues.push(`variance requires at least ${minimumRepetitions} repetitions`);
  }
  for (const group of groups.filter((candidate) => candidate.baseline === "current-skill")) {
    if (group.passRateStdDev > maximumPassRateStdDev) {
      issues.push(`${group.model} current-skill variance ${group.passRateStdDev} exceeds ${maximumPassRateStdDev}`);
    }
    if (group.falseCompletionClaims > 0) {
      issues.push(`${group.model} has ${group.falseCompletionClaims} false verified completion claims`);
    }
  }
  for (const comparison of comparisons) {
    const minimumDelta = comparison.baseline === "without-skill"
      ? minimumNoSkillDelta
      : comparison.baseline === "old-skill"
        ? minimumOldSkillDelta
        : 0;
    if (comparison.passRateDelta < minimumDelta) {
      issues.push(
        `${comparison.candidate} pass-rate delta over ${comparison.baseline} is ${comparison.passRateDelta}; required ${minimumDelta}`,
      );
    }
  }
  return {
    repetitions: evidence.repetitions ?? 1,
    issues,
    promotionReady: issues.length === 0,
    groups,
    comparisons,
  };
};

export const validateFrontendPairwiseReview = (
  suite: FrontendEvalSuite,
  review: FrontendPairwiseReview,
): FrontendPairwiseReviewReport => {
  const issues: string[] = [];
  const allTaskIds = new Set((suite.taskBands ?? []).flatMap((band) => band.seedTasks ?? []).map((task) => task.id));
  const selectedSlice = review.skillSlice
    ? suite.skillSlices?.find(
        (slice) => slice.id === review.skillSlice || slice.skillId === review.skillSlice,
      )
    : undefined;
  if (review.skillSlice && !selectedSlice) {
    issues.push(`pairwise review references unknown skill slice: ${review.skillSlice}`);
  }
  const taskIds = selectedSlice ? new Set(selectedSlice.taskIds) : allTaskIds;
  const reviewedTaskIds = new Set<string>();
  const comparisonIds = new Set<string>();
  let candidateWins = 0;
  let candidateLosses = 0;
  let ties = 0;
  let abstains = 0;

  if (review.schemaVersion !== "1.0") issues.push("pairwise review schemaVersion must be 1.0");
  if (review.suiteName !== suite.name) issues.push(`pairwise review suiteName must equal ${suite.name}`);
  if (!["A", "B"].includes(review.candidateUnderTestLabel)) {
    issues.push("pairwise review candidateUnderTestLabel must be A or B");
  }
  if (!Array.isArray(review.comparisons)) issues.push("pairwise review comparisons must be an array");

  for (const comparison of Array.isArray(review.comparisons) ? review.comparisons : []) {
    if (!comparison.comparisonId?.trim()) issues.push("pairwise review comparisonId is required");
    if (comparisonIds.has(comparison.comparisonId)) {
      issues.push(`duplicate pairwise review comparisonId: ${comparison.comparisonId}`);
    }
    comparisonIds.add(comparison.comparisonId);
    if (!taskIds.has(comparison.taskId)) {
      issues.push(`pairwise review references unknown task: ${comparison.taskId}`);
      continue;
    }
    if (reviewedTaskIds.has(comparison.taskId)) {
      issues.push(`duplicate pairwise review taskId: ${comparison.taskId}`);
    }
    reviewedTaskIds.add(comparison.taskId);
    if (!Array.isArray(comparison.labels) || comparison.labels.length !== 2 || comparison.labels[0] !== "A" || comparison.labels[1] !== "B") {
      issues.push(`pairwise review ${comparison.taskId} labels must be blinded A and B`);
    }
    if (!["A", "B", "tie", "abstain"].includes(comparison.winner)) {
      issues.push(`pairwise review ${comparison.taskId} winner is invalid`);
      continue;
    }
    if (comparison.reviewer?.kind !== "human") {
      issues.push(`pairwise review ${comparison.taskId} reviewer must be human`);
    }
    if (!comparison.reviewer?.id?.trim()) {
      issues.push(`pairwise review ${comparison.taskId} reviewer id is required`);
    }

    if (comparison.winner === "tie") ties += 1;
    else if (comparison.winner === "abstain") abstains += 1;
    else if (comparison.winner === review.candidateUnderTestLabel) candidateWins += 1;
    else candidateLosses += 1;
  }

  for (const taskId of taskIds) {
    if (!reviewedTaskIds.has(taskId)) issues.push(`pairwise review is missing task: ${taskId}`);
  }

  const decisiveComparisons = candidateWins + candidateLosses;
  const candidatePreferenceShare = roundedRate(candidateWins, decisiveComparisons);
  const configuredGate = suite.scoring?.promotionGates.minimumBlindPreferenceShare;
  const minimumBlindPreferenceShare = typeof configuredGate === "number" ? configuredGate : 1;
  return {
    issues,
    metrics: {
      expectedTasks: taskIds.size,
      reviewedTasks: reviewedTaskIds.size,
      decisiveComparisons,
      candidateWins,
      candidateLosses,
      ties,
      abstains,
      candidatePreferenceShare,
      promotionReady:
        issues.length === 0 &&
        decisiveComparisons > 0 &&
        candidatePreferenceShare >= minimumBlindPreferenceShare,
    },
  };
};

export const summarizeFrontendEvalSuite = (
  suite: FrontendEvalSuite,
  locale: FrontendEvalLocale = "all",
): FrontendEvalSummary => {
  const triggerPrompts = selectFrontendTriggerPrompts(suite, locale);
  const taskBands = suite.taskBands ?? [];
  return {
    name: suite.name,
    locale,
    triggerPrompts: {
      total: triggerPrompts.length,
      shouldTrigger: triggerPrompts.filter((prompt) => prompt.kind === "should-trigger").length,
      shouldNotTrigger: triggerPrompts.filter((prompt) => prompt.kind === "should-not-trigger").length,
      ambiguous: triggerPrompts.filter((prompt) => prompt.kind === "ambiguous").length,
      target: triggerPrompts.length,
      suiteTarget: suite.targetCounts.triggerPrompts,
    },
    taskEvals: {
      seedTasks: taskBands.reduce((count, band) => count + band.seedTasks.length, 0),
      target: suite.targetCounts.taskEvals,
      bands: taskBands.map((band) => band.id),
    },
    utilityWeightTotal: sum(Object.values(suite.scoring.utilityWeights)),
    promotionGates: Object.keys(suite.scoring.promotionGates),
  };
};

const cyrillicPattern = /\p{Script=Cyrillic}/u;
const latinPattern = /\p{Script=Latin}/u;

export const selectFrontendTriggerPrompts = (
  suite: FrontendEvalSuite,
  locale: FrontendEvalLocale,
): FrontendTriggerPrompt[] => {
  const prompts = suite.triggerPrompts ?? [];
  if (locale === "all") return prompts;
  if (locale === "ru") return prompts.filter((prompt) => cyrillicPattern.test(prompt.text));
  return prompts.filter((prompt) => latinPattern.test(prompt.text) && !cyrillicPattern.test(prompt.text));
};

export const runFrontendRoutingEval = async (
  suite: FrontendEvalSuite,
  options: RunFrontendRoutingEvalOptions,
): Promise<FrontendRoutingEvalReport> => {
  const targetAgent = options.targetAgent ?? "codex";
  const locale = options.locale ?? "all";
  const selectedPrompts = selectFrontendTriggerPrompts(suite, locale);
  const fingerprint = await scanProject(options.projectRoot);
  const skills = await loadLocalRegistry(options.registryRoot ?? defaultRegistryRoot);
  const failures: FrontendRoutingEvalFailure[] = [];
  let evaluated = 0;
  let skipped = 0;
  let passed = 0;
  let expectedSkillEvaluated = 0;
  let expectedSkillPassed = 0;
  let shouldNotTriggerEvaluated = 0;
  let shouldNotTriggerPassed = 0;

  for (const prompt of selectedPrompts) {
    const routing = prompt.routingExpected;
    const expectedSkill = routing?.expectedSkill ?? prompt.expectedSkill;
    if (!routing && !expectedSkill) {
      skipped += 1;
      continue;
    }

    evaluated += 1;
    const recommendations = frontendRecommendations(
      recommendSkills(fingerprint, skills, { targetAgent, userIntent: prompt.text }),
    );
    const actual = topSkillId(recommendations);

    if (routing?.shouldNotTrigger === true) {
      shouldNotTriggerEvaluated += 1;
      if (recommendations.length === 0) {
        shouldNotTriggerPassed += 1;
        passed += 1;
      } else {
        failures.push(
          failure(prompt, "no frontend recommendation", actual, "unexpected-frontend-skill", recommendations),
        );
      }
      continue;
    }

    if (routing?.triageOnly === true) {
      const allowed = routing.acceptableAlternates ?? [];
      if (allowed.length === 0) {
        failures.push(failure(prompt, "acceptable alternate", actual, "missing-acceptable-alternates", recommendations));
      } else if (actual && allowed.includes(actual)) {
        passed += 1;
      } else {
        failures.push(failure(prompt, allowed.join(" or "), actual, actual ? "wrong-top-skill" : "missing-top-skill", recommendations));
      }
      continue;
    }

    if (expectedSkill) {
      expectedSkillEvaluated += 1;
      const allowed = routing?.acceptableAlternates ?? [expectedSkill];
      if (actual && allowed.includes(actual)) {
        expectedSkillPassed += 1;
        passed += 1;
      } else {
        failures.push(failure(prompt, allowed.join(" or "), actual, actual ? "wrong-top-skill" : "missing-top-skill", recommendations));
      }
      continue;
    }

    skipped += 1;
    evaluated -= 1;
  }

  const failed = failures.length;
  return {
    projectRoot: fingerprint.root,
    targetAgent,
    locale,
    selectedPrompts: selectedPrompts.length,
    suitePrompts: (suite.triggerPrompts ?? []).length,
    metrics: {
      total: selectedPrompts.length,
      evaluated,
      skipped,
      passed,
      failed,
      overallPassRate: roundedRate(passed, evaluated),
      expectedSkillRecall: roundedRate(expectedSkillPassed, expectedSkillEvaluated),
      shouldNotTriggerSpecificity: roundedRate(shouldNotTriggerPassed, shouldNotTriggerEvaluated),
    },
    failures,
  };
};

export const scoreSkillUtility = (
  categoryScores: Record<string, number>,
  weights: Record<string, number>,
) => {
  const weightedScore = Object.entries(weights).reduce((total, [category, weight]) => {
    const score = categoryScores[category] ?? 0;
    return total + score * weight;
  }, 0);
  return Number(weightedScore.toFixed(2));
};

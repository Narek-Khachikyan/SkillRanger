import { readFile } from "node:fs/promises";
import { loadLocalRegistry } from "../registry/index.ts";
import { recommendSkills } from "../recommender/index.ts";
import { scanProject } from "../scanner/index.ts";
import { defaultFrontendEvalSuitePath, defaultRegistryRoot } from "../paths.ts";
import type { Recommendation } from "../types.ts";

export type FrontendGraderType = "code" | "screenshot" | "axe" | "lighthouse" | "human" | "llm_judge" | "pairwise";

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
};

export type FrontendTaskEvidenceStatus = "passed" | "failed" | "not-assessed";

export type FrontendTaskEvidence = {
  schemaVersion: "1.0";
  suiteName: string;
  runs: Array<{
    runId: string;
    taskId: string;
    skillId: string;
    skillVersion: string;
    skillChecksum: string;
    model: string;
    fixture: string;
    command: string;
    durationMs: number;
    artifacts: Array<{
      name: string;
      path: string;
    }>;
    assertions: Array<{
      text: string;
      status: FrontendTaskEvidenceStatus;
    }>;
  }>;
};

export type FrontendTaskEvidenceReport = {
  issues: string[];
  metrics: {
    expectedTasks: number;
    recordedTasks: number;
    artifactCount: number;
    passedAssertions: number;
    failedAssertions: number;
    unassessedAssertions: number;
    promotionReady: boolean;
  };
};

export type FrontendEvalSummary = {
  name: string;
  triggerPrompts: {
    total: number;
    shouldTrigger: number;
    shouldNotTrigger: number;
    ambiguous: number;
    target: number;
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
  metrics: FrontendRoutingEvalMetrics;
  failures: FrontendRoutingEvalFailure[];
};

export type RunFrontendRoutingEvalOptions = {
  projectRoot: string;
  targetAgent?: string;
  registryRoot?: string;
};

const sum = (values: number[]) =>
  Number(values.reduce((total, value) => total + value, 0).toFixed(4));

const graderTypes: Record<FrontendGraderType, true> = {
  code: true,
  screenshot: true,
  axe: true,
  lighthouse: true,
  human: true,
  llm_judge: true,
  pairwise: true,
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
  const tasks = (suite.taskBands ?? []).flatMap((band) => band.seedTasks ?? []);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const seenRunIds = new Set<string>();
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

  for (const run of Array.isArray(evidence.runs) ? evidence.runs : []) {
    if (!run.runId?.trim()) issues.push("task evidence runId is required");
    if (seenRunIds.has(run.runId)) issues.push(`duplicate task evidence runId: ${run.runId}`);
    seenRunIds.add(run.runId);

    const task = taskById.get(run.taskId);
    if (!task) {
      issues.push(`task evidence references unknown task: ${run.taskId}`);
      continue;
    }
    if (recordedTaskIds.has(run.taskId)) issues.push(`duplicate task evidence taskId: ${run.taskId}`);
    recordedTaskIds.add(run.taskId);

    for (const key of ["skillId", "skillVersion", "skillChecksum", "model", "fixture", "command"] as const) {
      if (!run[key]?.trim()) issues.push(`task evidence ${run.taskId} ${key} is required`);
    }
    if (!Number.isFinite(run.durationMs) || run.durationMs <= 0) {
      issues.push(`task evidence ${run.taskId} durationMs must be positive`);
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
    if (!recordedTaskIds.has(task.id)) issues.push(`task evidence is missing task: ${task.id}`);
  }

  return {
    issues,
    metrics: {
      expectedTasks: tasks.length,
      recordedTasks: recordedTaskIds.size,
      artifactCount,
      passedAssertions,
      failedAssertions,
      unassessedAssertions,
      promotionReady: issues.length === 0 && failedAssertions === 0 && unassessedAssertions === 0,
    },
  };
};

export const summarizeFrontendEvalSuite = (
  suite: FrontendEvalSuite,
): FrontendEvalSummary => {
  const triggerPrompts = suite.triggerPrompts ?? [];
  const taskBands = suite.taskBands ?? [];
  return {
    name: suite.name,
    triggerPrompts: {
      total: triggerPrompts.length,
      shouldTrigger: triggerPrompts.filter((prompt) => prompt.kind === "should-trigger").length,
      shouldNotTrigger: triggerPrompts.filter((prompt) => prompt.kind === "should-not-trigger").length,
      ambiguous: triggerPrompts.filter((prompt) => prompt.kind === "ambiguous").length,
      target: suite.targetCounts.triggerPrompts,
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

export const runFrontendRoutingEval = async (
  suite: FrontendEvalSuite,
  options: RunFrontendRoutingEvalOptions,
): Promise<FrontendRoutingEvalReport> => {
  const targetAgent = options.targetAgent ?? "codex";
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

  for (const prompt of suite.triggerPrompts ?? []) {
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
    metrics: {
      total: (suite.triggerPrompts ?? []).length,
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

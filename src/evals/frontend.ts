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

  const taskIds = new Set<string>();
  for (const band of suite.taskBands ?? []) {
    if (!band.id?.trim()) issues.push("task band id is required");
    if (!Number.isInteger(band.targetCount) || band.targetCount <= 0) {
      issues.push(`task band ${band.id} targetCount must be positive`);
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

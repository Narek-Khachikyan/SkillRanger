import { readFile } from "node:fs/promises";
import path from "node:path";
import { packageRoot } from "../../paths.ts";
import type { VisualBenchmarkBrief, VisualBenchmarkSuite, VisualCriterion } from "./types.ts";

export const visualCriteria: VisualCriterion[] = [
  "product-specificity", "hierarchy", "composition", "typography", "color-roles",
  "state-quality", "responsive-transformation", "accessibility", "implementation-coherence", "ai-slop-risk",
];
export const visualRecipeIds = ["operational-command-center", "consumer-discovery", "developer-tool", "editorial-content", "marketing-landing", "saas-workspace", "e-commerce", "mobile-consumer-app"] as const;
const defaultSuitePath = path.join(packageRoot, "evals/frontend/visual-benchmark/suite.json");

export const validateVisualBenchmarkSuite = (suite: VisualBenchmarkSuite): string[] => {
  const issues: string[] = [];
  if (suite.schemaVersion !== "1.0") issues.push("schemaVersion must be 1.0");
  if (suite.version !== "visual-benchmark-v1") issues.push("version must be visual-benchmark-v1");
  if (suite.briefs.length !== 8) issues.push("suite must contain exactly eight briefs");
  if (new Set(suite.briefs.map(({ id }) => id)).size !== suite.briefs.length) issues.push("brief ids must be unique");
  if (suite.briefs.map(({ recipeId }) => recipeId).join("|") !== visualRecipeIds.join("|")) issues.push("brief recipe order must be frozen");
  for (const brief of suite.briefs) {
    if (brief.schemaVersion !== "1.0") issues.push(`${brief.id}: schemaVersion must be 1.0`);
    if (brief.requiredViewports.join(",") !== "390,768,1440") issues.push(`${brief.id}: fixed viewports required`);
    for (const state of ["loading", "empty", "error", "success"]) if (!brief.requiredStates.includes(state)) issues.push(`${brief.id}: missing state ${state}`);
    for (const item of ["metrics", "testimonials", "people"] as const) if (!brief.forbiddenInvention.includes(item)) issues.push(`${brief.id}: missing forbidden invention ${item}`);
    if (brief.scoringCriteria.length !== 10 || visualCriteria.some((criterion) => !brief.scoringCriteria.includes(criterion))) issues.push(`${brief.id}: all ten criteria required`);
    if (!brief.prompt.toLowerCase().includes("screenshot") || !/critique/i.test(brief.prompt) || !/recheck/i.test(brief.prompt)) issues.push(`${brief.id}: prompt must freeze evidence lifecycle`);
  }
  return issues;
};

export const loadVisualBenchmarkSuite = async (suitePath = defaultSuitePath): Promise<VisualBenchmarkSuite> => {
  const manifest = JSON.parse(await readFile(path.resolve(suitePath), "utf8")) as Omit<VisualBenchmarkSuite, "briefs"> & { briefs: Array<string | VisualBenchmarkBrief> };
  const base = path.dirname(path.resolve(suitePath));
  const briefs = await Promise.all(manifest.briefs.map(async (entry) => typeof entry === "string"
    ? JSON.parse(await readFile(path.resolve(base, entry), "utf8")) as VisualBenchmarkBrief
    : entry));
  const suite = { ...manifest, briefs } as VisualBenchmarkSuite;
  const issues = validateVisualBenchmarkSuite(suite);
  if (issues.length) throw new Error(`Invalid visual benchmark suite: ${issues.join("; ")}`);
  return suite;
};

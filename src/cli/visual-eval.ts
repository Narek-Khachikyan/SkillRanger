import path from "node:path";
import { canonicalPath, isContained, readJson } from "./io.ts";
import { calibrateCapabilityRecord } from "../evals/visual/calibration.ts";
import { aggregateVisualBenchmark } from "../evals/visual/metrics.ts";
import { createBlindReviewPackage } from "../evals/visual/review.ts";
import { atomicJson, bindVisualCandidateProfileDigests, executeVisualBenchmarkPlan, generateVisualBenchmarkPlan, validateVisualCandidates } from "../evals/visual/runner.ts";
import { loadVisualBenchmarkSuite } from "../evals/visual/suite.ts";
import type { VisualBenchmarkPlan, VisualBenchmarkReport, VisualBenchmarkRunResult, VisualCapabilityCandidate, VisualHumanReview } from "../evals/visual/types.ts";

const required = (flags: Record<string, string | boolean>, name: string) => { const value = flags[name]; if (typeof value !== "string" || !value.trim()) throw new Error(`--${name} is required`); return value; };
const outputJson = async (file: string, value: unknown) => atomicJson(path.resolve(file), value);
const candidatesFrom = async (flags: Record<string, string | boolean>): Promise<VisualCapabilityCandidate[]> => {
  const file = path.resolve(required(flags, "candidates"));
  return bindVisualCandidateProfileDigests(validateVisualCandidates(await readJson<unknown>(file)), path.dirname(file));
};
const assertReviewOutputsSeparated = async (publicOutput: string, privateOutput: string) => {
  const publicCanonical = await canonicalPath(publicOutput);
  const privateCanonical = await canonicalPath(privateOutput);
  const publicTree = path.dirname(publicCanonical);
  if (publicCanonical === privateCanonical || isContained(publicTree, privateCanonical)
    || isContained(privateCanonical, publicCanonical) || isContained(publicCanonical, privateCanonical)) {
    throw new Error("private mapping output must be outside the public review tree");
  }
};
const relativeEvidence = (reportPath: string, evidencePaths: string[]) => evidencePaths.map((evidence) => {
  const relative = path.relative(path.dirname(path.resolve(reportPath)), path.resolve(evidence)).replace(/\\/g, "/");
  if (!relative || relative.split("/").includes("..")) throw new Error(`candidate evidence is outside the report tree: ${evidence}`);
  return relative;
});

export const handleVisualEvalCommand = async (input: { command?: string; flags: Record<string, string | boolean> }): Promise<boolean> => {
  if (input.command !== "eval:visual") return false;
  const flags = input.flags;
  const actions = ["plan", "run", "prepare-review", "aggregate", "calibrate"].filter((key) => flags[key]);
  if (actions.length !== 1) throw new Error("choose exactly one visual benchmark action");
  const suite = await loadVisualBenchmarkSuite(typeof flags.suite === "string" ? flags.suite : undefined);
  let result: unknown;
  if (actions[0] === "plan") {
    result = generateVisualBenchmarkPlan({ suite, candidates: await candidatesFrom(flags) });
    if (typeof flags.output === "string") await outputJson(flags.output, result);
  }
  if (actions[0] === "run") {
    const plan = generateVisualBenchmarkPlan({ suite, candidates: await candidatesFrom(flags) });
    const output = required(flags, "output");
    const artifactDir = typeof flags.artifacts === "string" && flags.artifacts.trim() ? flags.artifacts : output;
    result = await executeVisualBenchmarkPlan({ plan, commandTemplate: required(flags, "command"), outputDir: artifactDir, projectRoot: typeof flags.project === "string" ? flags.project : undefined, dryRun: Boolean(flags["dry-run"]), resume: Boolean(flags.resume), timeoutPerRunMs: typeof flags.timeout === "string" ? Number(flags.timeout) : undefined });
    await outputJson(typeof flags.artifacts === "string" ? output : path.join(output, "index.json"), result);
  }
  if (actions[0] === "prepare-review") {
    const plan = await readJson<VisualBenchmarkPlan>(required(flags, "plan-file"));
    const index = await readJson<{ runs: VisualBenchmarkRunResult[] }>(required(flags, "results"));
    const publicOutput = required(flags, "public-review-output"); const privateOutput = required(flags, "private-mapping-output");
    await assertReviewOutputsSeparated(publicOutput, privateOutput);
    const prepared = createBlindReviewPackage({ plan, results: index.runs, publicReviewDir: path.dirname(path.resolve(publicOutput)) });
    await outputJson(publicOutput, prepared.reviewPackage); await outputJson(privateOutput, prepared.privateMapping);
    result = { publicReviewOutput: path.resolve(publicOutput), privateMappingOutput: path.resolve(privateOutput), pairs: prepared.reviewPackage.pairs.length };
  }
  if (actions[0] === "aggregate") {
    const reviewPackagePath = required(flags, "review-package");
    const privateMappingPath = required(flags, "private-mapping");
    await assertReviewOutputsSeparated(reviewPackagePath, privateMappingPath);
    const plan = await readJson<VisualBenchmarkPlan>(required(flags, "plan-file"));
    const index = await readJson<{ runs: VisualBenchmarkRunResult[] }>(required(flags, "results"));
    const reviewPackage = await readJson<any>(reviewPackagePath);
    const privateMapping = await readJson<any>(privateMappingPath);
    const reviewPaths = required(flags, "human-review").split(",").filter(Boolean);
    const reviews = await Promise.all(reviewPaths.map((file) => readJson<VisualHumanReview>(file)));
    result = aggregateVisualBenchmark({ suite, plan, results: index.runs, reviewPackage, privateMapping, reviews, publicReviewDir: path.dirname(path.resolve(reviewPackagePath)) });
    if (typeof flags.output === "string") await outputJson(flags.output, result);
  }
  if (actions[0] === "calibrate") {
    const reportPath = required(flags, "report");
    const report = await readJson<VisualBenchmarkReport>(reportPath);
    if (report.promotion?.verdict !== "promotable") {
      throw new Error("visual benchmark report is not promotable; calibration requires promotion.verdict=promotable");
    }
    const candidateId = required(flags, "candidate");
    if (!["weak", "medium", "strong"].includes(candidateId)) throw new Error(`candidate not found: ${candidateId}`);
    const metrics = report.byCapability[candidateId as keyof typeof report.byCapability];
    if (!metrics) throw new Error(`candidate not found: ${candidateId}`);
    result = calibrateCapabilityRecord({ benchmarkVersion: report.benchmarkVersion, candidateId, sampleCount: metrics.sampleCount, meanQuality: metrics.meanQuality, catastrophicFailureRate: metrics.catastrophicFailureRate, verificationSuccessRate: metrics.verificationSuccessRate, withinConditionVariance: metrics.withinConditionVariance, meanRepairIterations: metrics.meanRepairIterations, modelIds: metrics.modelIds, successfulRecipeIds: metrics.successfulRecipeIds, evidencePaths: relativeEvidence(reportPath, metrics.evidencePaths) });
    if (typeof flags.output === "string") await outputJson(flags.output, result);
  }
  console.log(JSON.stringify(result, null, 2));
  return true;
};

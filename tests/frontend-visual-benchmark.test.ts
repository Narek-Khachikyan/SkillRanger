import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadVisualBenchmarkSuite, validateVisualBenchmarkSuite, visualCriteria } from "../src/evals/visual/suite.ts";
import { executeVisualBenchmarkPlan, executeVisualBenchmarkPlanSubsetForTesting, generateVisualBenchmarkPlan, validateVisualCandidates, validateVisualBenchmarkPlan } from "../src/evals/visual/runner.ts";
import { createBlindReviewPackage, validateHumanReview } from "../src/evals/visual/review.ts";
import { aggregateVisualBenchmark, mean, median, populationVariance } from "../src/evals/visual/metrics.ts";
import { visualCandidates } from "./helpers/visual-benchmark-fixtures.ts";
import type { VisualBenchmarkPlan, VisualBenchmarkRunResult, VisualHumanReview } from "../src/evals/visual/types.ts";

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

const completedFixture = async () => {
  const plan = generateVisualBenchmarkPlan({ suite: await loadVisualBenchmarkSuite(), candidates: [...visualCandidates] });
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-review-"));
  const screenshot = path.join(root, "render.png");
  await writeFile(screenshot, "rendered-pixels");
  const weakCatBriefs = new Set([...new Set(plan.entries.map(({ briefId }) => briefId))].slice(0, 2));
  const results: VisualBenchmarkRunResult[] = plan.entries.map((entry) => {
    const weakFailure = entry.capabilityCandidateId === "weak" && entry.arm === "with-skillranger" && weakCatBriefs.has(entry.briefId);
    return ({
    ...entry, benchmarkVersion: plan.benchmarkVersion, skillRangerVersion: plan.skillRangerVersion,
    skillRangerChecksum: plan.skillRangerChecksum, workspacePath: path.join(root, entry.runId, "workspace"),
    resultPath: path.join(root, entry.runId, "run-result.json"), dryRun: false, exitCode: 0, signal: null,
    durationMs: 1, artifactPaths: [screenshot], operationalEvidence: "complete", hardGateFailed: weakFailure,
    repairIterations: entry.capabilityCandidateId === "weak" && entry.arm === "with-skillranger" ? (entry.repetition === 1 ? 2 : 3) : 1,
    verificationOutcome: weakFailure ? "failed" : "verified", completionClaimed: true,
  });
  });
  let n = 0;
  const prepared = createBlindReviewPackage({ plan, results, labelFactory: () => `opaque-${++n}` });
  const byRun = new Map(results.map((result) => [result.runId, result]));
  const byPair = new Map(prepared.privateMapping.pairs.map((pair) => [pair.pairId, pair]));
  const review: VisualHumanReview = {
    schemaVersion: "1.0", benchmarkVersion: plan.benchmarkVersion, reviewerId: "human-1", reviewerType: "human",
    judgments: prepared.reviewPackage.pairs.map(({ pairId }) => {
      const mapping = byPair.get(pairId)!;
      const score = (side: "A" | "B") => mapping[side].arm === "with-skillranger" ? 4 : 3;
      const catastrophic = (side: "A" | "B") => {
        const result = byRun.get(mapping[side].runId)!;
        return result.capabilityCandidateId === "weak" && result.arm === "with-skillranger" && weakCatBriefs.has(result.briefId);
      };
      return { pairId, scoresA: Object.fromEntries(visualCriteria.map((criterion) => [criterion, score("A")])) as any, scoresB: Object.fromEntries(visualCriteria.map((criterion) => [criterion, score("B")])) as any, preference: mapping.A.arm === "with-skillranger" ? "A" : "B", catastrophicA: catastrophic("A"), catastrophicB: catastrophic("B"), notes: [] };
    }),
  };
  return { plan, results, ...prepared, review };
};

test("loads one frozen brief per recipe with fixed lifecycle evidence", async () => {
  const suite = await loadVisualBenchmarkSuite();
  assert.equal(suite.briefs.length, 8); assert.deepEqual(validateVisualBenchmarkSuite(suite), []);
  for (const brief of suite.briefs) {
    assert.deepEqual(brief.requiredViewports, [390, 768, 1440]); assert.equal(brief.scoringCriteria.length, 10);
    for (const state of ["loading", "empty", "error", "success"]) assert.ok(brief.requiredStates.includes(state));
    for (const term of ["direction", "implement", "screenshots", "critique", "repair", "recheck"]) assert.match(brief.prompt, new RegExp(term, "i"));
  }
});

test("generates exactly 96 immutable isolated slots and rejects malformed candidates", async () => {
  const plan = generateVisualBenchmarkPlan({ suite: await loadVisualBenchmarkSuite(), candidates: [...visualCandidates] });
  assert.equal(plan.entries.length, 96); assert.equal(new Set(plan.entries.map(({ runId }) => runId)).size, 96);
  assert.equal(plan.entries.filter(({ arm }) => arm === "with-skillranger").length, 48);
  assert.equal(plan.entries.filter(({ repetition }) => repetition === 2).length, 48);
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "visual-benchmark-"));
  const result = await executeVisualBenchmarkPlan({ plan, commandTemplate: "echo {{runId}}", outputDir, dryRun: true });
  assert.equal(new Set(result.runs.map(({ workspacePath }) => workspacePath)).size, 96);
  assert.throws(() => validateVisualCandidates([{ id: "weak", modelId: "", commandProfile: "" }]));
  assert.throws(() => validateVisualCandidates([...visualCandidates, { id: "strong", modelId: "x/y@z", commandProfile: "x", extra: true }]));
  assert.throws(() => validateVisualCandidates(visualCandidates.map((candidate) => ({ ...candidate, modelId: candidate.modelId.replace("@pinned", "") }))));
});

test("discovers rendered artifacts and persists immutable resume evidence", async () => {
  const full = generateVisualBenchmarkPlan({ suite: await loadVisualBenchmarkSuite(), candidates: [...visualCandidates] });
  const plan: VisualBenchmarkPlan = { ...full, entries: full.entries.slice(0, 1) };
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "visual-run-"));
  const script = `const f=require('fs');const d=process.argv[1];f.writeFileSync(d+'/screen.png','pixels');f.writeFileSync(d+'/run-metadata.json',JSON.stringify({schemaVersion:'1.0',hardGateFailed:false,repairIterations:1,verificationOutcome:'verified',completionClaimed:true}))`;
  const first = await executeVisualBenchmarkPlanSubsetForTesting({ plan, commandTemplate: `${process.execPath} -e \"${script}\" {{outputDir}}`, outputDir });
  assert.equal(first.runs[0].operationalEvidence, "complete");
  assert.equal(first.runs[0].artifactPaths.filter((item) => item.endsWith("screen.png")).length, 1);
  const bytesBefore = await readFile(first.runs[0].resultPath);
  const resumed = await executeVisualBenchmarkPlanSubsetForTesting({ plan, commandTemplate: "does-not-run", outputDir, resume: true });
  assert.deepEqual(resumed.runs[0], first.runs[0]);
  assert.deepEqual(await readFile(first.runs[0].resultPath), bytesBefore);
  const stale = { ...plan, entries: [{ ...plan.entries[0], modelId: "provider/other@pinned" }] };
  await assert.rejects(executeVisualBenchmarkPlanSubsetForTesting({ plan: stale, commandTemplate: "does-not-run", outputDir, resume: true }), /stale benchmark run/);
  assert.deepEqual(await readFile(first.runs[0].resultPath), bytesBefore);
});

test("rejects traversal, absolute, duplicate, and forged frozen plans before creating runs", async () => {
  const plan = generateVisualBenchmarkPlan({ suite: await loadVisualBenchmarkSuite(), candidates: [...visualCandidates] });
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "visual-plan-guard-"));
  for (const runId of ["../../escaped", path.resolve(outputDir, "absolute")]) {
    const forged = structuredClone(plan); forged.entries[0].runId = runId;
    assert.throws(() => validateVisualBenchmarkPlan(forged), /canonical runId/);
    await assert.rejects(executeVisualBenchmarkPlan({ plan: forged, commandTemplate: "echo ok", outputDir, dryRun: true }), /canonical runId/);
  }
  const duplicate = structuredClone(plan); duplicate.entries[1] = structuredClone(duplicate.entries[0]);
  assert.throws(() => validateVisualBenchmarkPlan(duplicate), /duplicate/);
  const missing = { ...plan, entries: plan.entries.slice(0, -1) };
  assert.throws(() => validateVisualBenchmarkPlan(missing), /frozen 96-slot/);
  assert.equal(await import("node:fs/promises").then(({ stat }) => stat(path.join(outputDir, "escaped")).then(() => true, () => false)), false);
});

test("rejects forged persisted result fields without rewriting the record", async () => {
  const full = generateVisualBenchmarkPlan({ suite: await loadVisualBenchmarkSuite(), candidates: [...visualCandidates] });
  const plan: VisualBenchmarkPlan = { ...full, entries: full.entries.slice(0, 1) };
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "visual-resume-guard-"));
  const script = `const f=require('fs');const d=process.argv[1];f.writeFileSync(d+'/screen.png','pixels');f.writeFileSync(d+'/run-metadata.json',JSON.stringify({schemaVersion:'1.0',hardGateFailed:false,repairIterations:0,verificationOutcome:'verified',completionClaimed:true}))`;
  const first = await executeVisualBenchmarkPlanSubsetForTesting({ plan, commandTemplate: `${process.execPath} -e \"${script}\" {{outputDir}}`, outputDir });
  const forged = { ...first.runs[0], durationMs: -999, repairIterations: -50, artifactPaths: ["/outside/secret.png"], extra: true };
  await writeFile(first.runs[0].resultPath, `${JSON.stringify(forged)}\n`);
  const before = await readFile(first.runs[0].resultPath);
  await assert.rejects(executeVisualBenchmarkPlanSubsetForTesting({ plan, commandTemplate: "does-not-run", outputDir, resume: true }), /stale benchmark run/);
  assert.deepEqual(await readFile(first.runs[0].resultPath), before);
});

test("requires complete 96-result rendered review evidence", async () => {
  const fixture = await completedFixture();
  assert.equal(fixture.reviewPackage.pairs.length, 48);
  assert.doesNotMatch(JSON.stringify(fixture.reviewPackage), /with-skillranger|without-skillranger|provider\//);
  assert.ok(fixture.reviewPackage.pairs.every((pair) => pair.screenshotsA.length && pair.screenshotsB.length));
  assert.throws(() => createBlindReviewPackage({ plan: fixture.plan, results: fixture.results.slice(0, 2) }), /all 96 plan slots/);
  assert.throws(() => createBlindReviewPackage({ plan: fixture.plan, results: [...fixture.results.slice(0, -1), fixture.results[0]] }), /duplicate run ids|stale or foreign/);
});

test("validates every human review field and exact pair coverage", async () => {
  const fixture = await completedFixture();
  assert.deepEqual(validateHumanReview(fixture.review, fixture.reviewPackage), []);
  const forged = { ...fixture.review, schemaVersion: "2.0", benchmarkVersion: "other", reviewerId: "", judgments: [{ ...fixture.review.judgments[0], catastrophicA: "false", notes: "none" }] } as any;
  const issues = validateHumanReview(forged, fixture.reviewPackage);
  for (const expected of ["schemaVersion must be 1.0", "benchmarkVersion must match public package", "reviewerId is required", "catastrophic fields must be boolean", "notes must be an array of strings", "review must cover every public pair exactly once"]) assert.ok(issues.includes(expected));
});

test("computes exact quality, median, population variance, divergence, deltas, and operational rates", async () => {
  assert.equal(mean([1, 2, 3]), 2); assert.equal(median([4, 1, 3, 2]), 2.5); close(populationVariance([1, 3]), 1);
  const fixture = await completedFixture();
  const report = aggregateVisualBenchmark({ results: fixture.results, reviewPackage: fixture.reviewPackage, privateMapping: fixture.privateMapping, reviews: [fixture.review] });
  assert.equal(report.metrics.runSlots, 96); close(report.metrics.meanQuality, .7); close(report.metrics.medianQuality, .7);
  close(report.metrics.pairwiseSkillRangerPreferenceShare, 1); close(report.metrics.withinConditionVariance, 0); close(report.metrics.repeatDesignAxisDivergence, 0);
  close(report.byArm["with-skillranger"].meanQuality, .8); close(report.byArm["without-skillranger"].meanQuality, .6); close(report.skillRangerDeltas.meanQuality, .2);
  assert.equal(report.byCapability.weak.sampleCount, 16); close(report.byCapability.weak.catastrophicFailureRate, .25); close(report.byCapability.weak.hardGateFailureRate, .25); close(report.byCapability.weak.meanRepairIterations, 2.5); close(report.byCapability.weak.verificationSuccessRate, .75); close(report.byCapability.weak.falseCompletionRate, .25);
  close(report.byCapability.medium.verificationSuccessRate, 1); close(report.byCapability.medium.falseCompletionRate, 0);
  assert.deepEqual(report.byCapability.medium.modelIds, ["provider/model-b@pinned"]); assert.ok(report.byCapability.medium.successfulRecipeIds.length > 0);
});

test("candidate recipe success requires both repetitions to pass", async () => {
  const fixture = await completedFixture();
  const target = fixture.results.find((result) => result.capabilityCandidateId === "medium" && result.arm === "with-skillranger" && result.repetition === 2)!;
  target.verificationOutcome = "failed";
  const report = aggregateVisualBenchmark({ results: fixture.results, reviewPackage: fixture.reviewPackage, privateMapping: fixture.privateMapping, reviews: [fixture.review] });
  assert.equal(report.byCapability.medium.successfulRecipeIds.includes(target.recipeId), false);
});

test("rejects mismatched public/private mappings before aggregation", async () => {
  const fixture = await completedFixture();
  const forged = structuredClone(fixture.privateMapping); forged.pairs[0].A.modelId = "provider/forged@pinned";
  assert.throws(() => aggregateVisualBenchmark({ results: fixture.results, reviewPackage: fixture.reviewPackage, privateMapping: forged, reviews: [fixture.review] }), /run mapping mismatch/);
});

test("rejects llm judges and incomplete scores", () => {
  const issues = validateHumanReview({ schemaVersion: "1.0", benchmarkVersion: "visual-benchmark-v1", reviewerId: "x", reviewerType: "llm", judgments: [{ pairId: "p", scoresA: {} as any, scoresB: {} as any, preference: "tie", catastrophicA: false, catastrophicB: false, notes: [] }] } as any);
  assert.ok(issues.includes("reviewerType must be human")); assert.ok(issues.includes("all ten criterion scores are required"));
});

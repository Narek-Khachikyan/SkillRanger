import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadVisualBenchmarkSuite, validateVisualBenchmarkSuite, visualCriteria } from "../src/evals/visual/suite.ts";
import { executeVisualBenchmarkPlan, executeVisualBenchmarkPlanSubsetForTesting, generateVisualBenchmarkPlan, validateVisualCandidates, validateVisualBenchmarkPlan } from "../src/evals/visual/runner.ts";
import { computeVisualBenchmarkResultDigest, createBlindReviewPackage, validateHumanReview } from "../src/evals/visual/review.ts";
import { aggregateVisualBenchmark, mean, median, populationVariance } from "../src/evals/visual/metrics.ts";
import { visualCandidates } from "./helpers/visual-benchmark-fixtures.ts";
import type { VisualBenchmarkPlan, VisualBenchmarkRunResult, VisualHumanReview } from "../src/evals/visual/types.ts";

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const persistResults = async (results: VisualBenchmarkRunResult[]) => {
  await Promise.all(results.map((result) => writeFile(result.resultPath, `${JSON.stringify(result)}\n`)));
  return results;
};

const completedFixture = async () => {
  const plan = generateVisualBenchmarkPlan({ suite: await loadVisualBenchmarkSuite(), candidates: [...visualCandidates] });
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-review-"));
  const publicReviewDir = path.join(root, "public");
  await mkdir(publicReviewDir, { recursive: true });
  const weakCatBriefs = new Set([...new Set(plan.entries.map(({ briefId }) => briefId))].slice(0, 2));
  const results: VisualBenchmarkRunResult[] = plan.entries.map((entry) => {
    const weakFailure = entry.capabilityCandidateId === "weak" && entry.arm === "with-skillranger" && weakCatBriefs.has(entry.briefId);
    const runRoot = path.join(root, "runs", entry.runId);
    const stdoutPath = path.join(runRoot, "stdout.txt");
    const stderrPath = path.join(runRoot, "stderr.txt");
    return ({
    ...entry, benchmarkVersion: plan.benchmarkVersion, skillRangerVersion: plan.skillRangerVersion,
    skillRangerChecksum: plan.skillRangerChecksum, workspacePath: path.join(runRoot, "workspace"),
    resultPath: path.join(runRoot, "run-result.json"), dryRun: false, exitCode: 0, signal: null,
    stdoutPath, stderrPath, durationMs: 1, artifactPaths: [stdoutPath, stderrPath, path.join(runRoot, "render.png")], operationalEvidence: "complete", hardGateFailed: weakFailure,
    repairIterations: entry.capabilityCandidateId === "weak" && entry.arm === "with-skillranger" ? (entry.repetition === 1 ? 2 : 3) : 1,
    verificationOutcome: weakFailure ? "failed" : "verified", criticalFindings: 0, completionClaimed: true,
  });
  });
  await Promise.all(results.map(async ({ workspacePath, artifactPaths }) => {
    await mkdir(workspacePath, { recursive: true });
    await writeFile(artifactPaths[0], "stdout");
    await writeFile(artifactPaths[1], "stderr");
    await writeFile(artifactPaths[2], "rendered-pixels");
  }));
  await persistResults(results);
  let n = 0;
  const prepared = createBlindReviewPackage({ plan, results, labelFactory: () => `opaque-${++n}`, publicReviewDir });
  const byRun = new Map(results.map((result) => [result.runId, result]));
  const byPair = new Map(prepared.privateMapping.pairs.map((pair) => [pair.pairId, pair]));
  const review: VisualHumanReview = {
    schemaVersion: "1.0", benchmarkVersion: plan.benchmarkVersion, reviewPackageDigest: prepared.reviewPackage.reviewPackageDigest, reviewerId: "human-1", reviewerType: "human",
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
  return { plan, results, publicReviewDir, ...prepared, review };
};

const secondHumanReview = (review: VisualHumanReview): VisualHumanReview => ({
  ...structuredClone(review),
  reviewerId: "human-2",
});

const aggregateReviews = (review: VisualHumanReview): VisualHumanReview[] => [review, secondHumanReview(review)];

const refreshFixtureContracts = (fixture: Awaited<ReturnType<typeof completedFixture>>) => {
  let n = 0;
  const prepared = createBlindReviewPackage({ plan: fixture.plan, results: fixture.results, labelFactory: () => `opaque-${++n}`, publicReviewDir: fixture.publicReviewDir });
  return {
    ...fixture,
    ...prepared,
    review: { ...fixture.review, reviewPackageDigest: prepared.reviewPackage.reviewPackageDigest },
  };
};

const cleanResults = async (results: VisualBenchmarkRunResult[]): Promise<VisualBenchmarkRunResult[]> => {
  for (const result of results) {
    result.hardGateFailed = false;
    result.verificationOutcome = "verified";
    result.criticalFindings = 0;
  }
  return persistResults(results);
};

const cleanReview = (review: VisualHumanReview): VisualHumanReview => ({
  ...structuredClone(review),
  judgments: review.judgments.map((judgment) => ({ ...judgment, catastrophicA: false, catastrophicB: false })),
});

const reviewWithCandidateWins = (
  fixture: Awaited<ReturnType<typeof completedFixture>>,
  review: VisualHumanReview,
  reviewerId: string,
  candidateWins: number,
  mode: "decisive" | "abstain" = "decisive",
): VisualHumanReview => {
  const mappings = new Map(fixture.privateMapping.pairs.map((pair) => [pair.pairId, pair]));
  return {
    ...structuredClone(review),
    reviewerId,
    judgments: review.judgments.map((judgment, index) => {
      const mapping = mappings.get(judgment.pairId)!;
      if (mode === "abstain" || index >= candidateWins) {
        if (mode === "abstain") return { ...judgment, preference: "abstain" } as any;
      }
      const candidateLabel = mapping.A.arm === "with-skillranger" ? "A" : "B";
      return { ...judgment, preference: candidateWins > index ? candidateLabel : candidateLabel === "A" ? "B" : "A" } as any;
    }),
  };
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
  const script = `const f=require('fs');const d=process.argv[1];f.writeFileSync(d+'/screen.png','pixels');f.writeFileSync(d+'/run-metadata.json',JSON.stringify({schemaVersion:'1.0',hardGateFailed:false,criticalFindings:0,repairIterations:1,verificationOutcome:'verified',completionClaimed:true}))`;
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

test("retains complete evidence for failed and timed-out commands without certifying execution", async () => {
  const full = generateVisualBenchmarkPlan({ suite: await loadVisualBenchmarkSuite(), candidates: [...visualCandidates] });
  const plan: VisualBenchmarkPlan = { ...full, entries: full.entries.slice(0, 1) };
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-command-status-"));
  const agent = path.join(root, "agent.cjs");
  const metadata = JSON.stringify({ schemaVersion: "1.0", hardGateFailed: false, criticalFindings: 0, repairIterations: 0, verificationOutcome: "verified", completionClaimed: true });
  await writeFile(agent, [
    "const fs=require('fs'),path=require('path'),d=process.argv[2];",
    "fs.writeFileSync(path.join(d,'screen.png'),'pixels');",
    `fs.writeFileSync(path.join(d,'run-metadata.json'),${JSON.stringify(metadata)});`,
    "if (process.argv[3] === 'fail') process.exit(23);",
    "if (process.argv[3] === 'timeout') process.on('SIGTERM', () => process.exit(0));",
    "setTimeout(() => {}, 1000);",
  ].join("\n"));

  const failed = await executeVisualBenchmarkPlanSubsetForTesting({
    plan,
    commandTemplate: `${process.execPath} ${agent} {{outputDir}} fail`,
    outputDir: path.join(root, "failed"),
  });
  assert.equal(failed.runs[0].exitCode, 23);
  assert.equal(failed.runs[0].signal, null);
  assert.equal(failed.runs[0].operationalEvidence, "complete");

  const timedOut = await executeVisualBenchmarkPlanSubsetForTesting({
    plan,
    commandTemplate: `${process.execPath} ${agent} {{outputDir}} timeout`,
    outputDir: path.join(root, "timed-out"),
    timeoutPerRunMs: 250,
  });
  assert.equal(timedOut.runs[0].exitCode, null);
  assert.equal(timedOut.runs[0].signal, "SIGTERM");
  assert.equal(timedOut.runs[0].operationalEvidence, "complete");
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
  const script = `const f=require('fs');const d=process.argv[1];f.writeFileSync(d+'/screen.png','pixels');f.writeFileSync(d+'/run-metadata.json',JSON.stringify({schemaVersion:'1.0',hardGateFailed:false,criticalFindings:0,repairIterations:0,verificationOutcome:'verified',completionClaimed:true}))`;
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
  assert.ok(fixture.reviewPackage.pairs.every((pair) => pair.screenshotDigestsA.length === pair.screenshotsA.length && pair.screenshotDigestsB.length === pair.screenshotsB.length));
  assert.ok(fixture.reviewPackage.pairs.every((pair) => [...pair.screenshotDigestsA, ...pair.screenshotDigestsB].every((digest) => /^[a-f0-9]{64}$/.test(digest))));
  assert.throws(() => createBlindReviewPackage({ plan: fixture.plan, results: fixture.results.slice(0, 2) }), /all 96 plan slots/);
  assert.throws(() => createBlindReviewPackage({ plan: fixture.plan, results: [...fixture.results.slice(0, -1), fixture.results[0]] }), /duplicate run ids|stale or foreign/);
  assert.throws(() => createBlindReviewPackage({ plan: fixture.plan, results: fixture.results, labelFactory: () => "with-skillranger" }), /non-opaque/);
});

test("rejects a public screenshot replaced at the same path before aggregation", async () => {
  const fixture = await completedFixture();
  const screenshot = path.join(fixture.publicReviewDir, fixture.reviewPackage.pairs[0].screenshotsA[0]);
  await writeFile(screenshot, "substituted-rendered-pixels");
  assert.throws(
    () => aggregateVisualBenchmark({ results: fixture.results, reviewPackage: fixture.reviewPackage, privateMapping: fixture.privateMapping, reviews: aggregateReviews(fixture.review), publicReviewDir: fixture.publicReviewDir }),
    /public review screenshot integrity mismatch/,
  );
});

test("rejects benchmark evidence outside the isolated run directory", async () => {
  const fixture = await completedFixture();
  const foreignRoot = await mkdtemp(path.join(os.tmpdir(), "visual-foreign-evidence-"));
  const foreignScreenshot = path.join(foreignRoot, "foreign.png");
  await writeFile(foreignScreenshot, "foreign-render");
  const forged = structuredClone(fixture.results);
  forged[0].artifactPaths = [forged[0].stdoutPath!, forged[0].stderrPath!, foreignScreenshot];
  assert.throws(
    () => createBlindReviewPackage({ plan: fixture.plan, results: forged }),
    /isolated run directory|escaped run directory/,
  );
});

test("rejects benchmark results that relocate evidence into a shared parent", async () => {
  const fixture = await completedFixture();
  const forged = structuredClone(fixture.results);
  forged[0].resultPath = path.join(path.dirname(path.dirname(forged[0].resultPath)), "shared-result.json");
  assert.throws(
    () => createBlindReviewPackage({ plan: fixture.plan, results: forged }),
    /isolated run directory/,
  );
});

test("rejects benchmark evidence that is not listed by the run artifact manifest", async () => {
  const fixture = await completedFixture();
  const runRoot = path.dirname(fixture.results[0].resultPath);
  const foreignScreenshot = path.join(runRoot, "not-in-manifest.png");
  await writeFile(path.join(runRoot, "artifact-manifest.json"), JSON.stringify({ schemaVersion: "1.0", artifacts: ["render.png"] }));
  await writeFile(foreignScreenshot, "foreign-render");
  const forged = structuredClone(fixture.results);
  forged[0].artifactPaths = [forged[0].stdoutPath!, forged[0].stderrPath!, foreignScreenshot];
  assert.throws(
    () => createBlindReviewPackage({ plan: fixture.plan, results: forged }),
    /artifact manifest/,
  );
});

test("rejects rendered evidence added after the artifact manifest", async () => {
  const fixture = await completedFixture();
  const runRoot = path.dirname(fixture.results[0].resultPath);
  await writeFile(path.join(runRoot, "late-render.png"), "foreign-render");
  await writeFile(path.join(runRoot, "artifact-manifest.json"), JSON.stringify({ schemaVersion: "1.0", artifacts: ["render.png"] }));
  assert.throws(
    () => createBlindReviewPackage({ plan: fixture.plan, results: fixture.results }),
    /artifact manifest/,
  );
});

test("requires retained stdout and stderr evidence for promotion", async () => {
  const fixture = await completedFixture();
  const forged = structuredClone(fixture.results);
  delete forged[0].stdoutPath;
  delete forged[0].stderrPath;
  forged[0].artifactPaths = [forged[0].artifactPaths[2]];
  assert.throws(
    () => createBlindReviewPackage({ plan: fixture.plan, results: forged }),
    /run logs must be retained/,
  );
});

test("aggregation rejects foreign evidence even when the immutable result and mapping are forged together", async () => {
  const fixture = await completedFixture();
  const foreignRoot = await mkdtemp(path.join(os.tmpdir(), "visual-foreign-aggregate-"));
  const foreignScreenshot = path.join(foreignRoot, "foreign.png");
  await writeFile(foreignScreenshot, "foreign-render");
  const results = structuredClone(fixture.results);
  results[0].artifactPaths = [results[0].stdoutPath!, results[0].stderrPath!, foreignScreenshot];
  await writeFile(results[0].resultPath, `${JSON.stringify(results[0])}\n`);
  const privateMapping = structuredClone(fixture.privateMapping);
  const mapped = privateMapping.pairs.flatMap((pair) => [pair.A, pair.B]).find((entry) => entry.runId === results[0].runId);
  assert.ok(mapped);
  mapped.sourceArtifactPaths = [foreignScreenshot];
  mapped.resultDigest = computeVisualBenchmarkResultDigest(results[0]);
  assert.throws(
    () => aggregateVisualBenchmark({
      results,
      reviewPackage: fixture.reviewPackage,
      privateMapping,
      reviews: aggregateReviews(fixture.review),
      publicReviewDir: fixture.publicReviewDir,
    }),
    /isolated run directory|escaped run directory/,
  );
});

test("validates every human review field and exact pair coverage", async () => {
  const fixture = await completedFixture();
  assert.deepEqual(validateHumanReview(fixture.review, fixture.reviewPackage), []);
  const forged = { ...fixture.review, schemaVersion: "2.0", benchmarkVersion: "other", reviewerId: "", judgments: [{ ...fixture.review.judgments[0], catastrophicA: "false", notes: "none" }] } as any;
  const issues = validateHumanReview(forged, fixture.reviewPackage);
  for (const expected of ["schemaVersion must be 1.0", "benchmarkVersion must match public package", "reviewerId is required", "catastrophic fields must be boolean", "notes must be an array of strings", "review must cover every public pair exactly once"]) assert.ok(issues.includes(expected));
  const stalePackage = structuredClone(fixture.reviewPackage); stalePackage.pairs[0].labelA = "option-stale";
  assert.ok(validateHumanReview(fixture.review, stalePackage).includes("public review package digest is invalid"));
  const partial = structuredClone(fixture.review); partial.judgments.pop();
  assert.throws(() => aggregateVisualBenchmark({ results: fixture.results, reviewPackage: fixture.reviewPackage, privateMapping: fixture.privateMapping, reviews: [partial, secondHumanReview(fixture.review)], publicReviewDir: fixture.publicReviewDir }), /Invalid human review.*cover every public pair/);
});

test("computes exact quality, median, population variance, divergence, deltas, and operational rates", async () => {
  assert.equal(mean([1, 2, 3]), 2); assert.equal(median([4, 1, 3, 2]), 2.5); close(populationVariance([1, 3]), 1);
  const fixture = await completedFixture();
  const report = aggregateVisualBenchmark({ results: fixture.results, reviewPackage: fixture.reviewPackage, privateMapping: fixture.privateMapping, reviews: aggregateReviews(fixture.review), publicReviewDir: fixture.publicReviewDir });
  assert.equal(report.metrics.runSlots, 96); close(report.metrics.meanQuality, .7); close(report.metrics.medianQuality, .7);
  close(report.metrics.pairwiseSkillRangerPreferenceShare, 1); close(report.metrics.withinConditionVariance, 0); close(report.metrics.repeatDesignAxisDivergence, 0);
  close(report.byArm["with-skillranger"].meanQuality, .8); close(report.byArm["without-skillranger"].meanQuality, .6); close(report.skillRangerDeltas.meanQuality, .2);
  assert.equal(report.byCapability.weak.sampleCount, 16); close(report.byCapability.weak.catastrophicFailureRate, .25); close(report.byCapability.weak.hardGateFailureRate, .25); close(report.byCapability.weak.meanRepairIterations, 2.5); close(report.byCapability.weak.verificationSuccessRate, .75); close(report.byCapability.weak.falseCompletionRate, .25);
  close(report.byCapability.medium.verificationSuccessRate, 1); close(report.byCapability.medium.falseCompletionRate, 0);
  assert.deepEqual(report.byCapability.medium.modelIds, ["provider/model-b@pinned"]); assert.ok(report.byCapability.medium.successfulRecipeIds.length > 0);
});

test("blocks complete rendered evidence when the benchmark command fails", async () => {
  for (const status of [
    { exitCode: 23, signal: null, expected: /exit code 23/ },
    { exitCode: null, signal: "SIGTERM", expected: /termination signal SIGTERM/ },
  ] as const) {
    const fixture = await completedFixture();
    fixture.results[0].exitCode = status.exitCode;
    fixture.results[0].signal = status.signal;
    await persistResults(fixture.results);
    const refreshed = refreshFixtureContracts(fixture);
    const report = aggregateVisualBenchmark({
      results: refreshed.results,
      reviewPackage: refreshed.reviewPackage,
      privateMapping: refreshed.privateMapping,
      reviews: aggregateReviews(refreshed.review),
      publicReviewDir: refreshed.publicReviewDir,
    });
    assert.equal(report.promotion.verdict, "blocked");
    assert.ok(report.promotion.blockingReasons.some((reason) => reason.includes(fixture.results[0].runId) && status.expected.test(reason)));
  }
});

test("candidate recipe success requires both repetitions to pass", async () => {
  const fixture = await completedFixture();
  const target = fixture.results.find((result) => result.capabilityCandidateId === "medium" && result.arm === "with-skillranger" && result.repetition === 2)!;
  target.verificationOutcome = "failed";
  await persistResults(fixture.results);
  const refreshed = refreshFixtureContracts(fixture);
  const report = aggregateVisualBenchmark({ results: refreshed.results, reviewPackage: refreshed.reviewPackage, privateMapping: refreshed.privateMapping, reviews: aggregateReviews(refreshed.review), publicReviewDir: refreshed.publicReviewDir });
  assert.equal(report.byCapability.medium.successfulRecipeIds.includes(target.recipeId), false);
});

test("rejects mismatched public/private mappings before aggregation", async () => {
  const fixture = await completedFixture();
  const forged = structuredClone(fixture.privateMapping); forged.pairs[0].A.modelId = "provider/forged@pinned";
  assert.throws(() => aggregateVisualBenchmark({ results: fixture.results, reviewPackage: fixture.reviewPackage, privateMapping: forged, reviews: aggregateReviews(fixture.review), publicReviewDir: fixture.publicReviewDir }), /run mapping mismatch/);
  const forgedResults = structuredClone(fixture.results); forgedResults[0].criticalFindings = 1;
  assert.throws(() => aggregateVisualBenchmark({ results: forgedResults, reviewPackage: fixture.reviewPackage, privateMapping: fixture.privateMapping, reviews: aggregateReviews(fixture.review), publicReviewDir: fixture.publicReviewDir }), /immutable benchmark result mismatch/);
});

test("rejects llm judges and incomplete scores", () => {
  const issues = validateHumanReview({ schemaVersion: "1.0", benchmarkVersion: "visual-benchmark-v1", reviewerId: "x", reviewerType: "llm", judgments: [{ pairId: "p", scoresA: {} as any, scoresB: {} as any, preference: "tie", catastrophicA: false, catastrophicB: false, notes: [] }] } as any);
  assert.ok(issues.includes("reviewerType must be human")); assert.ok(issues.includes("all ten criterion scores are required"));
});

test("accepts explicit abstention and requires two distinct complete human reviews", async () => {
  const fixture = await completedFixture();
  await cleanResults(fixture.results);
  const refreshed = refreshFixtureContracts(fixture);
  const abstaining = reviewWithCandidateWins(refreshed, refreshed.review, "human-1", 0, "abstain");
  assert.deepEqual(validateHumanReview(abstaining, refreshed.reviewPackage), []);
  const report = aggregateVisualBenchmark({
    results: refreshed.results,
    reviewPackage: refreshed.reviewPackage,
    privateMapping: refreshed.privateMapping,
    reviews: [abstaining, secondHumanReview(abstaining)],
    publicReviewDir: refreshed.publicReviewDir,
  });
  assert.equal(report.promotion.verdict, "blocked");
  assert.equal(report.promotion.abstentions, 96);
  assert.equal(report.promotion.decisiveComparisons, 0);
  assert.ok(report.promotion.blockingReasons.some((reason) => /decisive/i.test(reason)));
  assert.throws(() => aggregateVisualBenchmark({
    results: refreshed.results,
    reviewPackage: refreshed.reviewPackage,
    privateMapping: refreshed.privateMapping,
    reviews: [abstaining],
    publicReviewDir: refreshed.publicReviewDir,
  }), /exactly two human reviews/);
  assert.throws(() => aggregateVisualBenchmark({
    results: refreshed.results,
    reviewPackage: refreshed.reviewPackage,
    privateMapping: refreshed.privateMapping,
    reviews: [abstaining, structuredClone(abstaining)],
    publicReviewDir: refreshed.publicReviewDir,
  }), /distinct reviewer identities/);
});

test("uses equal reviewer weight and decisive-only preference at the 60 percent threshold", async () => {
  const fixture = await completedFixture();
  await cleanResults(fixture.results);
  const refreshed = refreshFixtureContracts(fixture);
  const baseReview = cleanReview(refreshed.review);
  const sparse = (reviewerId: string, candidateWins: number, comparatorWins: number) => {
    const review = reviewWithCandidateWins(refreshed, baseReview, reviewerId, candidateWins);
    review.judgments = review.judgments.map((judgment, index) =>
      index < candidateWins + comparatorWins ? judgment : { ...judgment, preference: "abstain" } as any);
    return review;
  };
  const passing = [
    reviewWithCandidateWins(refreshed, baseReview, "human-1", 48),
    sparse("human-2", 10, 10),
  ];
  const passReport = aggregateVisualBenchmark({ results: refreshed.results, reviewPackage: refreshed.reviewPackage, privateMapping: refreshed.privateMapping, reviews: passing, publicReviewDir: refreshed.publicReviewDir });
  assert.equal(passReport.promotion.candidateWins, 58);
  assert.equal(passReport.promotion.comparatorWins, 10);
  assert.equal(passReport.promotion.abstentions, 28);
  close(passReport.promotion.candidatePreferenceShare, (1 + 0.5) / 2);
  assert.equal(passReport.promotion.verdict, "promotable");
  close(passReport.metrics.pairwiseSkillRangerPreferenceShare, (1 + 0.5) / 2);

  const failing = [
    reviewWithCandidateWins(refreshed, baseReview, "human-1", 48),
    sparse("human-2", 0, 1),
  ];
  const failReport = aggregateVisualBenchmark({ results: refreshed.results, reviewPackage: refreshed.reviewPackage, privateMapping: refreshed.privateMapping, reviews: failing, publicReviewDir: refreshed.publicReviewDir });
  assert.equal(failReport.promotion.candidateWins, 48);
  close(failReport.promotion.candidatePreferenceShare, (1 + 0) / 2);
  assert.equal(failReport.promotion.verdict, "blocked");
  assert.ok(failReport.promotion.blockingReasons.some((reason) => /60%|preference/i.test(reason)));
});

test("preserves every promotion blocker even when the analytical averages are strong", async () => {
  const fixture = await completedFixture();
  await cleanResults(fixture.results);
  const results = fixture.results;
  results[0].hardGateFailed = true;
  results[1].verificationOutcome = "implemented-unverified";
  results[2].criticalFindings = 1;
  results[3].completionClaimed = true;
  await persistResults(results);
  const refreshed = refreshFixtureContracts(fixture);
  const reviews = [
    reviewWithCandidateWins(refreshed, refreshed.review, "human-1", 48),
    reviewWithCandidateWins(refreshed, refreshed.review, "human-2", 48),
  ];
  reviews[0].judgments[0].catastrophicA = true;
  const report = aggregateVisualBenchmark({ results, reviewPackage: refreshed.reviewPackage, privateMapping: refreshed.privateMapping, reviews, publicReviewDir: refreshed.publicReviewDir });
  assert.equal(report.promotion.verdict, "blocked");
  for (const expected of ["catastrophic", "hard-gate", "unverified", "critical", "false completion"]) {
    assert.ok(report.promotion.blockingReasons.some((reason) => reason.toLowerCase().includes(expected)), expected);
  }
});

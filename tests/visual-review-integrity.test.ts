import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadVisualBenchmarkSuite, visualCriteria } from "../src/evals/visual/suite.ts";
import { aggregateVisualBenchmark } from "../src/evals/visual/metrics.ts";
import { createBlindReviewPackage } from "../src/evals/visual/review.ts";
import { generateVisualBenchmarkPlan } from "../src/evals/visual/runner.ts";
import { evaluateReleaseHandoff } from "../src/release/certification.ts";
import type { VisualBenchmarkRunResult, VisualHumanReview } from "../src/evals/visual/types.ts";

test("rejects a public blind-review screenshot substituted at the same path", async () => {
  const suite = await loadVisualBenchmarkSuite();
  const candidates = [
    { id: "weak", modelId: "fixture/model-weak@pinned", commandProfile: "weak.json" },
    { id: "medium", modelId: "fixture/model-medium@pinned", commandProfile: "medium.json" },
    { id: "strong", modelId: "fixture/model-strong@pinned", commandProfile: "strong.json" },
  ] as const;
  const plan = generateVisualBenchmarkPlan({
    suite,
    candidates: [...candidates],
  });
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-review-integrity-"));
  const publicReviewDir = path.join(root, "public");
  await mkdir(publicReviewDir, { recursive: true });
  const results: VisualBenchmarkRunResult[] = plan.entries.map((entry) => {
    const runRoot = path.join(root, "runs", entry.runId);
    const stdoutPath = path.join(runRoot, "stdout.txt");
    const stderrPath = path.join(runRoot, "stderr.txt");
    return {
      ...entry,
      benchmarkVersion: plan.benchmarkVersion,
      skillRangerVersion: plan.skillRangerVersion,
      skillRangerChecksum: plan.skillRangerChecksum,
      workspacePath: path.join(runRoot, "workspace"),
      resultPath: path.join(runRoot, "run-result.json"),
      dryRun: false,
      exitCode: 0,
      signal: null,
      durationMs: 1,
      stdoutPath,
      stderrPath,
      artifactPaths: [stdoutPath, stderrPath, path.join(runRoot, "render.png")],
      operationalEvidence: "complete",
      hardGateFailed: false,
      criticalFindings: 0,
      repairIterations: 0,
      verificationOutcome: "verified",
      completionClaimed: false,
    };
  });
  await Promise.all(results.map(async (result) => {
    await mkdir(result.workspacePath, { recursive: true });
    await writeFile(result.stdoutPath!, "stdout");
    await writeFile(result.stderrPath!, "stderr");
    await writeFile(result.artifactPaths[2], "rendered-pixels");
    await writeFile(result.resultPath, `${JSON.stringify(result)}\n`);
  }));

  let label = 0;
  const prepared = createBlindReviewPackage({
    plan,
    results,
    publicReviewDir,
    labelFactory: () => `opaque-${++label}`,
  });
  const mappingByPair = new Map(prepared.privateMapping.pairs.map((pair) => [pair.pairId, pair]));
  const scores = Object.fromEntries(visualCriteria.map((criterion) => [criterion, 4]));
  const makeReview = (reviewerId: string): VisualHumanReview => ({
    schemaVersion: "1.0",
    benchmarkVersion: plan.benchmarkVersion,
    reviewPackageDigest: prepared.reviewPackage.reviewPackageDigest,
    reviewerId,
    reviewerType: "human",
    judgments: prepared.reviewPackage.pairs.map((pair) => ({
      pairId: pair.pairId,
      scoresA: scores,
      scoresB: scores,
      preference: mappingByPair.get(pair.pairId)!.A.arm === "with-skillranger" ? "A" : "B",
      catastrophicA: false,
      catastrophicB: false,
      notes: [],
    })),
  });
  const input = {
    suite,
    plan,
    results,
    reviewPackage: prepared.reviewPackage,
    privateMapping: prepared.privateMapping,
    publicReviewDir,
    reviews: [makeReview("human-1"), makeReview("human-2")],
  };
  const aggregateReport = aggregateVisualBenchmark(input);
  assert.equal(aggregateReport.promotion.verdict, "promotable");

  const publicScreenshot = path.join(publicReviewDir, prepared.reviewPackage.pairs[0].screenshotsA[0]);
  await writeFile(publicScreenshot, "substituted-rendered-pixels");
  assert.throws(() => aggregateVisualBenchmark(input), /public review screenshot integrity mismatch/);

  const handoff = evaluateReleaseHandoff({
    releaseArtifacts: {
      schemaVersion: "1.0",
      releaseVersion: "0.4.0",
      packageVersion: "0.4.0",
      domain: { id: "frontend", version: "1.0.0", releaseVersion: "0.4.0" },
      ruleContract: { families: [], ruleCount: 0, recipeCount: 0, examplePackCount: 0, exampleSceneCount: 0, assetCount: 0 },
      files: [],
      issues: [],
      ok: true,
    },
    visual: {
      suite,
      candidates: [...candidates],
      plan,
      results,
      reviewPackage: prepared.reviewPackage,
      privateMapping: prepared.privateMapping,
      publicReviewDir,
      capabilityRecord: {} as never,
      aggregateReportPath: path.join(root, "aggregate.json"),
      reviews: input.reviews,
      aggregateReport,
    },
    evidenceFiles: [],
  });
  assert.equal(handoff.gates.visual.verdict, "not-promotable");
  assert.ok(handoff.gates.visual.blockingReasons.some((reason) => /public review screenshot integrity mismatch/.test(reason)));
});

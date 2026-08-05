import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { isContained } from "../src/cli/io.ts";
import { computeVisualBenchmarkResultDigest } from "../src/evals/visual/review.ts";
const run = promisify(execFile);
const cli = (args: string[]) => run(process.execPath, ["src/cli/index.ts", "eval:visual", ...args]);
const releaseCli = (args: string[]) => run(process.execPath, ["src/cli/index.ts", "release:certify", ...args]);

test("shared CLI containment handles the filesystem root", () => {
  assert.equal(isContained("/", "/mapping.json"), true);
  assert.equal(isContained("/public", "/publicity/mapping.json"), false);
});

test("eval:visual plans the frozen 96-run matrix and atomically writes it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-cli-")); const output = path.join(root, "plan.json");
  const { stdout } = await cli(["--plan", "--candidates", "tests/fixtures/visual-candidates.json", "--output", output, "--json"]);
  const printed = JSON.parse(stdout); const persisted = JSON.parse(await readFile(output, "utf8"));
  assert.equal(printed.entries.length, 96); assert.deepEqual(persisted, printed);
});

test("eval:visual carries command-profile digests through the frozen plan", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-cli-profile-digests-"));
  const candidatesPath = path.join(root, "candidates.json"); const planPath = path.join(root, "plan.json");
  for (const profile of ["weak.json", "medium.json", "strong.json"]) await writeFile(path.join(root, profile), `${profile}\n`);
  await writeFile(candidatesPath, JSON.stringify([
    { id: "weak", modelId: "fixture/model-weak@pinned", commandProfile: "weak.json" },
    { id: "medium", modelId: "fixture/model-medium@pinned", commandProfile: "medium.json" },
    { id: "strong", modelId: "fixture/model-strong@pinned", commandProfile: "strong.json" },
  ]));
  await cli(["--plan", "--candidates", candidatesPath, "--output", planPath, "--json"]);
  const first = JSON.parse(await readFile(planPath, "utf8"));
  assert.ok(first.entries.every((entry: any) => /^sha256:[a-f0-9]{64}$/.test(entry.commandProfileDigest)));
  const firstDigest = first.entries.find((entry: any) => entry.capabilityCandidateId === "weak").commandProfileDigest;
  await writeFile(path.join(root, "weak.json"), "changed\n");
  await cli(["--plan", "--candidates", candidatesPath, "--output", planPath, "--json"]);
  const second = JSON.parse(await readFile(planPath, "utf8"));
  assert.notEqual(second.entries.find((entry: any) => entry.capabilityCandidateId === "weak").commandProfileDigest, firstDigest);
});

test("eval:visual run writes the documented result index separately from artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-cli-run-")); const output = path.join(root, "results", "index.json"); const artifacts = path.join(root, "artifacts");
  await cli(["--run", "--candidates", "tests/fixtures/visual-candidates.json", "--command", "echo {{runId}}", "--artifacts", artifacts, "--output", output, "--dry-run", "--json"]);
  const index = JSON.parse(await readFile(output, "utf8")); assert.equal(index.runs.length, 96); assert.ok(index.runs.every((run: any) => run.workspacePath.startsWith(artifacts)));
});

test("eval:visual run accepts output as the result directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-cli-run-output-"));
  const output = path.join(root, "results");
  await cli(["--run", "--candidates", "tests/fixtures/visual-candidates.json", "--command", "echo {{runId}}", "--output", output, "--dry-run", "--json"]);
  const index = JSON.parse(await readFile(path.join(output, "index.json"), "utf8"));
  assert.equal(index.runs.length, 96);
  assert.ok(index.runs.every((record: any) => record.workspacePath.startsWith(output)));
});

test("eval:visual rejects multiple actions", async () => {
  await assert.rejects(() => cli(["--plan", "--aggregate", "--candidates", "tests/fixtures/visual-candidates.json"]), (error: any) => /choose exactly one visual benchmark action/.test(error.stderr));
});

test("eval:visual rejects malformed or unpinned candidate configs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-cli-candidates-")); const file = path.join(root, "candidates.json");
  await writeFile(file, JSON.stringify([{ id: "weak", modelId: "", commandProfile: "" }, { id: "medium", modelId: "provider/m", commandProfile: "m" }, { id: "strong", modelId: "provider/s", commandProfile: "s", extra: true }]));
  await assert.rejects(() => cli(["--plan", "--candidates", file]), (error: any) => /invalid keys|pinned/.test(error.stderr));
});

test("eval:visual calibrate rejects a blocked aggregate report", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-cli-calibrate-"));
  const report = path.join(root, "blocked-report.json");
  await writeFile(report, JSON.stringify({ promotion: { verdict: "blocked" } }));
  await assert.rejects(
    () => cli(["--calibrate", "--report", report, "--candidate", "medium"]),
    (error: any) => /not promotable.*promotion\.verdict=promotable/.test(error.stderr),
  );
});

test("eval:visual prevents private mapping inside a public tree through symlink aliases", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-cli-review-")); const publicDir = path.join(root, "public"); const alias = path.join(root, "public-alias");
  const { mkdir } = await import("node:fs/promises"); await mkdir(publicDir); await symlink(publicDir, alias, "dir");
  const plan = path.join(root, "plan.json"); const results = path.join(root, "results.json"); await writeFile(plan, JSON.stringify({})); await writeFile(results, JSON.stringify({ runs: [] }));
  await assert.rejects(() => cli(["--prepare-review", "--plan-file", plan, "--results", results, "--public-review-output", path.join(publicDir, "package.json"), "--private-mapping-output", path.join(alias, "private.json")]), (error: any) => /outside the public review tree/.test(error.stderr));
});

test("eval:visual aggregate prevents a private mapping inside the public review tree", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-cli-aggregate-separation-"));
  const publicDir = path.join(root, "public");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(publicDir);
  const reviewPackage = path.join(publicDir, "package.json");
  const privateMapping = path.join(publicDir, "private.json");
  await writeFile(reviewPackage, "{}");
  await writeFile(privateMapping, "{}");
  await assert.rejects(
    () => cli(["--aggregate", "--plan-file", path.join(root, "plan.json"), "--results", path.join(root, "results.json"), "--review-package", reviewPackage, "--private-mapping", privateMapping, "--human-review", path.join(root, "review.json")]),
    (error: any) => /outside the public review tree/.test(error.stderr),
  );
});

test("eval:visual runs, prepares, and aggregates runner-produced operational evidence end to end", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-cli-e2e-"));
  const agent = path.join(root, "agent.cjs");
  await writeFile(agent, `const f=require('fs'),p=require('path'),d=process.argv[2];f.writeFileSync(p.join(d,'screen.png'),'pixels');f.writeFileSync(p.join(d,'run-metadata.json'),JSON.stringify({schemaVersion:'1.0',hardGateFailed:false,criticalFindings:0,repairIterations:1,verificationOutcome:'verified',completionClaimed:true}));`);
  const artifacts = path.join(root, "artifacts"); const results = path.join(root, "results.json");
  await cli(["--run", "--candidates", "tests/fixtures/visual-candidates.json", "--command", `${process.execPath} ${agent} {{outputDir}}`, "--artifacts", artifacts, "--output", results, "--json"]);
  const resultIndex = JSON.parse(await readFile(results, "utf8"));
  assert.ok(resultIndex.runs.every((record: any) => record.operationalEvidence === "complete" && record.verificationOutcome === "verified"));
  const timeoutAgent = path.join(root, "timeout-agent.cjs");
  await writeFile(timeoutAgent, [
    "const fs=require('fs'),path=require('path'),d=process.argv[2],target=process.argv[3],runId=process.argv[4];",
    "fs.writeFileSync(path.join(d,'screen.png'),'pixels');",
    "fs.writeFileSync(path.join(d,'run-metadata.json'),JSON.stringify({schemaVersion:'1.0',hardGateFailed:false,criticalFindings:0,repairIterations:1,verificationOutcome:'verified',completionClaimed:true}));",
    "if (runId !== target) process.exit(0);",
    "process.on('SIGTERM', () => process.exit(0));",
    "setTimeout(() => {}, 10000);",
  ].join("\n"));
  const timeoutResults = path.join(root, "timeout-results.json");
  const timeoutTarget = resultIndex.runs[0].runId;
  await cli(["--run", "--candidates", "tests/fixtures/visual-candidates.json", "--command", `${process.execPath} ${timeoutAgent} {{outputDir}} ${timeoutTarget} {{runId}}`, "--artifacts", path.join(root, "timeout-artifacts"), "--output", timeoutResults, "--timeout", "2000", "--json"]);
  const timeoutResult = JSON.parse(await readFile(timeoutResults, "utf8")).runs[0];
  assert.equal(timeoutResult.runId, timeoutTarget);
  assert.equal(timeoutResult.exitCode, null);
  assert.equal(timeoutResult.signal, "SIGTERM");
  const plan = path.join(root, "plan.json"); await cli(["--plan", "--candidates", "tests/fixtures/visual-candidates.json", "--output", plan, "--json"]);
  const publicPackage = path.join(root, "public", "package.json"); const privateMapping = path.join(root, "private", "mapping.json");
  await cli(["--prepare-review", "--plan-file", plan, "--results", results, "--public-review-output", publicPackage, "--private-mapping-output", privateMapping, "--json"]);
  const publicValue = JSON.parse(await readFile(publicPackage, "utf8")); const mappingValue = JSON.parse(await readFile(privateMapping, "utf8"));
  const mappingByPair = new Map(mappingValue.pairs.map((pair: any) => [pair.pairId, pair]));
  const scores = Object.fromEntries(publicValue.criteria.map((criterion: string) => [criterion, 4]));
  const review = { schemaVersion: "1.0", benchmarkVersion: publicValue.benchmarkVersion, reviewPackageDigest: publicValue.reviewPackageDigest, reviewerId: "human-e2e", reviewerType: "human", judgments: publicValue.pairs.map((pair: any) => ({ pairId: pair.pairId, scoresA: scores, scoresB: scores, preference: mappingByPair.get(pair.pairId).A.arm === "with-skillranger" ? "A" : "B", catastrophicA: false, catastrophicB: false, notes: [] })) };
  assert.equal(mappingByPair.size, 48);
  const reviewPath = path.join(root, "review.json"); const secondReviewPath = path.join(root, "review-2.json"); const reportPath = path.join(root, "report.json");
  await writeFile(reviewPath, JSON.stringify(review)); await writeFile(secondReviewPath, JSON.stringify({ ...review, reviewerId: "human-e2e-2" }));
  await cli(["--aggregate", "--plan-file", plan, "--results", results, "--review-package", publicPackage, "--private-mapping", privateMapping, "--human-review", `${reviewPath},${secondReviewPath}`, "--output", reportPath, "--json"]);
  const report = JSON.parse(await readFile(reportPath, "utf8")); assert.equal(report.metrics.runSlots, 96); assert.equal(report.metrics.verificationSuccessRate, 1); assert.equal(report.metrics.meanRepairIterations, 1); assert.equal(report.promotion.verdict, "promotable");
  const capabilityPath = path.join(root, "capability.json");
  await cli(["--calibrate", "--report", reportPath, "--candidate", "medium", "--output", capabilityPath, "--json"]);
  const releaseArgs = (output: string) => [
    "--visual-candidates", "tests/fixtures/visual-candidates.json", "--visual-plan", plan, "--visual-results", results,
    "--visual-report", reportPath, "--review-package", publicPackage, "--private-mapping", privateMapping,
    "--capability-record", capabilityPath, "--human-review", `${reviewPath},${secondReviewPath}`, "--output", output, "--json",
  ];
  const setFirstResultExecutionStatus = async (exitCode: number | null, signal: string | null) => {
    const resultIndex = JSON.parse(await readFile(results, "utf8"));
    const result = { ...resultIndex.runs[0], exitCode, signal };
    resultIndex.runs[0] = result;
    await writeFile(result.resultPath, JSON.stringify(result));
    await writeFile(results, JSON.stringify(resultIndex));
    const mapping = JSON.parse(await readFile(privateMapping, "utf8"));
    const pair = mapping.pairs.find((candidate: any) => candidate.A.runId === result.runId || candidate.B.runId === result.runId);
    const side = pair.A.runId === result.runId ? pair.A : pair.B;
    side.resultDigest = computeVisualBenchmarkResultDigest(result);
    await writeFile(privateMapping, JSON.stringify(mapping));
  };
  for (const status of [
    { name: "non-zero exit", exitCode: 23, signal: null, expected: /exit code 23/ },
    { name: "termination signal", exitCode: null, signal: "SIGTERM", expected: /termination signal SIGTERM/ },
    { name: "timeout", exitCode: timeoutResult.exitCode, signal: timeoutResult.signal, expected: /termination signal SIGTERM/ },
  ] as const) {
    await setFirstResultExecutionStatus(status.exitCode, status.signal);
    await cli(["--aggregate", "--plan-file", plan, "--results", results, "--review-package", publicPackage, "--private-mapping", privateMapping, "--human-review", `${reviewPath},${secondReviewPath}`, "--output", reportPath, "--json"]);
    const failedReport = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(failedReport.promotion.verdict, "blocked", `${status.name} must block aggregation`);
    assert.equal(failedReport.metrics.verificationSuccessRate, 95 / 96, `${status.name} must not count as a successful verification`);
    assert.equal(failedReport.metrics.falseCompletionRate, 1 / 96, `${status.name} must count as a false completion`);
    const handoffPath = path.join(root, `release-${status.name.replaceAll(" ", "-")}.json`);
    await assert.rejects(() => releaseCli(releaseArgs(handoffPath)), (error: any) => error.code === 1);
    const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
    assert.ok(handoff.gates.visual.blockingReasons.some((reason: string) => status.expected.test(reason)), `${status.name} must block release certification`);
  }
  await setFirstResultExecutionStatus(0, null);
  await cli(["--aggregate", "--plan-file", plan, "--results", results, "--review-package", publicPackage, "--private-mapping", privateMapping, "--human-review", `${reviewPath},${secondReviewPath}`, "--output", reportPath, "--json"]);
  await writeFile(path.join(root, "public", publicValue.pairs[0].screenshotsA[0]), "substituted-rendered-pixels");
  await assert.rejects(
    () => cli(["--aggregate", "--plan-file", plan, "--results", results, "--review-package", publicPackage, "--private-mapping", privateMapping, "--human-review", `${reviewPath},${secondReviewPath}`, "--output", path.join(root, "substituted-report.json"), "--json"]),
    (error: any) => /public review screenshot integrity mismatch/.test(error.stderr),
  );
  const handoffPath = path.join(root, "release-handoff.json");
  await assert.rejects(
    () => releaseCli(releaseArgs(handoffPath)),
    (error: any) => error.code === 1,
  );
  const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
  assert.equal(handoff.gates.visual.verdict, "not-promotable");
  assert.ok(handoff.gates.visual.blockingReasons.some((reason: string) => /public review screenshot integrity mismatch/.test(reason)));
});

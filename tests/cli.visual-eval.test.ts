import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
const run = promisify(execFile);
const cli = (args: string[]) => run(process.execPath, ["src/cli/index.ts", "eval:visual", ...args]);

test("eval:visual plans the frozen 96-run matrix and atomically writes it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-cli-")); const output = path.join(root, "plan.json");
  const { stdout } = await cli(["--plan", "--candidates", "tests/fixtures/visual-candidates.json", "--output", output, "--json"]);
  const printed = JSON.parse(stdout); const persisted = JSON.parse(await readFile(output, "utf8"));
  assert.equal(printed.entries.length, 96); assert.deepEqual(persisted, printed);
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

test("eval:visual prevents private mapping inside a public tree through symlink aliases", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-cli-review-")); const publicDir = path.join(root, "public"); const alias = path.join(root, "public-alias");
  const { mkdir } = await import("node:fs/promises"); await mkdir(publicDir); await symlink(publicDir, alias, "dir");
  const plan = path.join(root, "plan.json"); const results = path.join(root, "results.json"); await writeFile(plan, JSON.stringify({})); await writeFile(results, JSON.stringify({ runs: [] }));
  await assert.rejects(() => cli(["--prepare-review", "--plan-file", plan, "--results", results, "--public-review-output", path.join(publicDir, "package.json"), "--private-mapping-output", path.join(alias, "private.json")]), (error: any) => /outside the public review tree/.test(error.stderr));
});

test("eval:visual runs, prepares, and aggregates runner-produced operational evidence end to end", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-cli-e2e-"));
  const agent = path.join(root, "agent.cjs");
  await writeFile(agent, `const f=require('fs'),p=require('path'),d=process.argv[2];f.writeFileSync(p.join(d,'screen.png'),'pixels');f.writeFileSync(p.join(d,'run-metadata.json'),JSON.stringify({schemaVersion:'1.0',hardGateFailed:false,repairIterations:1,verificationOutcome:'verified',completionClaimed:true}));`);
  const artifacts = path.join(root, "artifacts"); const results = path.join(root, "results.json");
  await cli(["--run", "--candidates", "tests/fixtures/visual-candidates.json", "--command", `${process.execPath} ${agent} {{outputDir}}`, "--artifacts", artifacts, "--output", results, "--json"]);
  const resultIndex = JSON.parse(await readFile(results, "utf8"));
  assert.ok(resultIndex.runs.every((record: any) => record.operationalEvidence === "complete" && record.verificationOutcome === "verified"));
  const plan = path.join(root, "plan.json"); await cli(["--plan", "--candidates", "tests/fixtures/visual-candidates.json", "--output", plan, "--json"]);
  const publicPackage = path.join(root, "public", "package.json"); const privateMapping = path.join(root, "private", "mapping.json");
  await cli(["--prepare-review", "--plan-file", plan, "--results", results, "--public-review-output", publicPackage, "--private-mapping-output", privateMapping, "--json"]);
  const publicValue = JSON.parse(await readFile(publicPackage, "utf8")); const mappingValue = JSON.parse(await readFile(privateMapping, "utf8"));
  const mappingByPair = new Map(mappingValue.pairs.map((pair: any) => [pair.pairId, pair]));
  const scores = Object.fromEntries(publicValue.criteria.map((criterion: string) => [criterion, 4]));
  const review = { schemaVersion: "1.0", benchmarkVersion: publicValue.benchmarkVersion, reviewerId: "human-e2e", reviewerType: "human", judgments: publicValue.pairs.map((pair: any) => ({ pairId: pair.pairId, scoresA: scores, scoresB: scores, preference: "tie", catastrophicA: false, catastrophicB: false, notes: [] })) };
  assert.equal(mappingByPair.size, 48);
  const reviewPath = path.join(root, "review.json"); const reportPath = path.join(root, "report.json"); await writeFile(reviewPath, JSON.stringify(review));
  await cli(["--aggregate", "--results", results, "--review-package", publicPackage, "--private-mapping", privateMapping, "--human-review", reviewPath, "--output", reportPath, "--json"]);
  const report = JSON.parse(await readFile(reportPath, "utf8")); assert.equal(report.metrics.runSlots, 96); assert.equal(report.metrics.verificationSuccessRate, 1); assert.equal(report.metrics.meanRepairIterations, 1);
});

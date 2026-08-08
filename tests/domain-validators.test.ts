import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  StrictSkillRunError,
  StrictSkillRunStore,
  beginStrictStep,
  buildTrustedValidatorRegistry,
  completeStrictStep,
  createContentChunks,
  createStrictSkillRun,
  deriveStrictValidatorResults,
  readNextStrictChunk,
  type ExecutionContractV2,
  type SkillLedger,
  type ValidatorEvaluationContext,
} from "../src/runtime/strict/index.ts";

const sha = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const skillId = "frontend.domain-validators-test";
const performanceGateSlugs = [
  "finding-dimension-present",
  "measured-claim-has-artifact",
  "before-after-required-for-win",
  "unmeasured-claims-labeled-risk",
  "exact-missing-measurement",
  "priority-confidence-present",
  "no-false-performance-win",
];
const contract: ExecutionContractV2 = {
  schemaVersion: "2.0",
  skillId,
  contractVersion: "2.0.0",
  inputSchema: "input.schema.json",
  outputSchema: "output.schema.json",
  mustRead: ["SKILL.md"],
  applicability: { op: "tag", value: "frontend" },
  prerequisites: [],
  maxRepairIterations: 1,
  rules: [{ id: `${skillId}/rule/evidence`, description: "Record evidence." }],
  steps: [{ id: `${skillId}/step/collect`, type: "collect", requiredEvidenceKinds: ["report"], ruleIds: [`${skillId}/rule/evidence`] }],
  gates: performanceGateSlugs.map((slug) => ({
    id: `${skillId}/gate/${slug}`,
    level: "hard" as const,
    evaluator: { type: "validator" as const, validatorId: "frontend/performance-claims" },
    ruleIds: [`${skillId}/rule/evidence`],
  })),
};

const riskReviewReport = {
  mode: "risk-review",
  findings: [{
    affectedFlow: "initial load", dimension: "LCP", basis: "risk", impact: "high", confidence: "medium",
    behavior: "Hero delivery may delay paint", evidence: [], expectedBenefit: "Earlier LCP",
    tradeoff: "Potential preload bytes",
  }],
  measurementsInspected: [],
  measurementGaps: ["Capture before/after LCP traces for the initial load flow"],
  residualRisks: [],
};
const measuredChangeReport = {
  mode: "validate-change",
  findings: [{
    affectedFlow: "initial load", dimension: "LCP", basis: "measured", impact: "high", confidence: "medium",
    behavior: "Hero delivery may delay paint", evidence: ["trace.json"], expectedBenefit: "Earlier LCP",
    tradeoff: "Potential preload bytes",
  }],
  measurementsInspected: ["before trace", "after trace"],
  measurementGaps: [],
  residualRisks: [],
};

const fixtureRun = (executionContract = contract, runId = "run_domain_validators") => createStrictSkillRun({
  runId, domain: "frontend", targetAgent: "codex", locale: "en",
  intent: { sha256: sha("validators"), normalizedGoal: "validate performance claims" }, now: "2026-07-15T10:00:00.000Z",
  selectedSkills: [{
    skillId: executionContract.skillId, role: "primary", mandatory: true, version: "1.0.0",
    packageChecksum: sha("package"), contractChecksum: sha(JSON.stringify(executionContract)), contract: executionContract,
    schemaSnapshots: { input: { type: "object" }, output: { type: "object" } },
    schemaChecksums: { input: sha(JSON.stringify({ type: "object" })), output: sha(JSON.stringify({ type: "object" })) },
    contentChunks: createContentChunks("SKILL.md", "# Validator Test\n"), applicable: true, unmetPrerequisites: [],
  }],
});

const evaluator = () => {
  const registry = buildTrustedValidatorRegistry([{ skillId: contract.skillId }]);
  const resolved = registry.resolveValidator("frontend/performance-claims");
  assert.ok(resolved, "frontend/performance-claims must resolve through the trusted registry");
  return resolved;
};

const contextFor = (ledger: SkillLedger, output: unknown, gateId: string): ValidatorEvaluationContext => ({
  projectRoot: "/project",
  ledger,
  artifacts: [],
  artifactBytes: new Map(),
  output,
  gateId,
});

const resultsFor = (ledger: SkillLedger, output: unknown) => Object.fromEntries(
  contract.gates.map((gate) => [gate.id.slice(gate.id.lastIndexOf("/") + 1), evaluator()(contextFor(ledger, output, gate.id))]),
);

const failedGateIds = (results: Record<string, { passed: boolean }>) =>
  Object.entries(results).filter(([, result]) => !result.passed).map(([gate]) => gate);

test("valid risk-review evidence passes every performance gate through the domain validator seam", () => {
  const results = resultsFor(fixtureRun().skillLedgers[0], riskReviewReport);
  assert.deepEqual(failedGateIds(results), []);
});

test("valid measured validate-change evidence with before/after measurements passes every performance gate", () => {
  const results = resultsFor(fixtureRun().skillLedgers[0], measuredChangeReport);
  assert.deepEqual(failedGateIds(results), []);
});

test("findings without a flow and dimension fail only finding-dimension-present", () => {
  const results = resultsFor(fixtureRun().skillLedgers[0], {
    ...riskReviewReport,
    findings: [{ basis: "risk", impact: "high", confidence: "medium", tradeoff: "bytes" }],
  });
  assert.deepEqual(failedGateIds(results), ["finding-dimension-present"]);
});

test("measured claims without attached artifacts fail only measured-claim-has-artifact", () => {
  const results = resultsFor(fixtureRun().skillLedgers[0], {
    ...measuredChangeReport,
    findings: [{
      affectedFlow: "initial load", dimension: "LCP", basis: "measured", impact: "high", confidence: "medium",
      behavior: "faster", evidence: [], expectedBenefit: "Earlier paint", tradeoff: "bytes",
    }],
  });
  assert.deepEqual(failedGateIds(results), ["measured-claim-has-artifact"]);
});

test("findings without priority and confidence fields fail only priority-confidence-present", () => {
  const results = resultsFor(fixtureRun().skillLedgers[0], {
    ...riskReviewReport,
    findings: [{ affectedFlow: "initial load", dimension: "LCP", basis: "risk" }],
  });
  assert.deepEqual(failedGateIds(results), ["priority-confidence-present"]);
});

test("claims that are neither measured nor labeled risk fail only unmeasured-claims-labeled-risk", () => {
  const results = resultsFor(fixtureRun().skillLedgers[0], {
    ...riskReviewReport,
    findings: [{
      affectedFlow: "initial load", dimension: "LCP", basis: "opinion", impact: "high", confidence: "medium",
      behavior: "feels slower", evidence: [], expectedBenefit: "Faster", tradeoff: "bytes",
    }],
  });
  assert.deepEqual(failedGateIds(results), ["unmeasured-claims-labeled-risk"]);
});

test("incomplete performance output fails every performance gate with the existing message", () => {
  const ledger = fixtureRun().skillLedgers[0];
  for (const incomplete of [undefined, [], "not a report"]) {
    const results = resultsFor(ledger, incomplete);
    assert.deepEqual(failedGateIds(results), performanceGateSlugs);
    for (const slug of performanceGateSlugs) {
      assert.equal(results[slug].message, `Performance report failed ${slug}.`);
    }
  }
});

test("causally insufficient validate-change evidence fails only the before/after and false-win gates", () => {
  const results = resultsFor(fixtureRun().skillLedgers[0], {
    ...measuredChangeReport,
    measurementsInspected: ["after trace"],
  });
  assert.deepEqual(failedGateIds(results), ["before-after-required-for-win", "no-false-performance-win"]);
});

test("risk claims without an exact measurement gap fail only exact-missing-measurement", () => {
  const results = resultsFor(fixtureRun().skillLedgers[0], {
    ...riskReviewReport,
    measurementGaps: [],
  });
  assert.deepEqual(failedGateIds(results), ["exact-missing-measurement"]);
});

test("an unrecognized performance gate slug fails closed", () => {
  const result = evaluator()(contextFor(fixtureRun().skillLedgers[0], riskReviewReport, `${skillId}/gate/unexpected`));
  assert.deepEqual(result, { passed: false, message: "Performance report failed unexpected." });
});

const stageReport = async (root: string, store: StrictSkillRunStore, report: unknown, stagedAsOutput = true) => {
  const source = path.join(root, "report.json");
  await writeFile(source, `${JSON.stringify(report)}\n`);
  let run = beginStrictStep(
    readNextStrictChunk(fixtureRun(), contract.skillId).run,
    contract.skillId,
    contract.steps[0].id,
  );
  await store.create(run);
  run = await store.ingestEvidence(run.runId, {
    sourcePath: source,
    kind: "report",
    ...(stagedAsOutput ? { validatedAs: "output" } : {}),
    attributions: [{
      skillId: contract.skillId,
      stepId: contract.steps[0].id,
      attempt: 1,
      relation: "produced",
      ruleIds: contract.rules.map(({ id }) => id),
    }],
  });
  return store.update(run.runId, (current) => completeStrictStep(current, contract.skillId, contract.steps[0].id));
};

test("deriveStrictValidatorResults keys domain validator results by gate id through the integrity seam", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "domain-validators-derive-"));
  const store = new StrictSkillRunStore(root);
  const run = await stageReport(root, store, riskReviewReport);

  const derivation = await deriveStrictValidatorResults(root, run, run.skillLedgers[0]);
  assert.equal(derivation.artifactIntegrity.passed, true);
  for (const gate of contract.gates) {
    assert.equal(derivation.validatorResults[gate.id].passed, true, gate.id);
  }
});

test("missing performance evidence fails every declared gate through the domain validator seam", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "domain-validators-missing-"));
  const store = new StrictSkillRunStore(root);
  const run = await stageReport(root, store, {}, false);

  const derivation = await deriveStrictValidatorResults(root, run, run.skillLedgers[0]);
  for (const gate of contract.gates) {
    assert.equal(derivation.validatorResults[gate.id].passed, false, gate.id);
    assert.match(derivation.validatorResults[gate.id].message ?? "", /^Performance report failed .+\.$/);
  }
  await assert.rejects(
    store.verifySkill(run.runId, contract.skillId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "hard-gate-failed",
  );
  assert.equal((await store.read(run.runId)).state, "verifying");
});

test("verification and finalization re-derive identical performance gate results across independent stores", async () => {
  const firstRoot = await mkdtemp(path.join(os.tmpdir(), "domain-validators-parity-a-"));
  const secondRoot = await mkdtemp(path.join(os.tmpdir(), "domain-validators-parity-b-"));
  const firstStore = new StrictSkillRunStore(firstRoot);
  const secondStore = new StrictSkillRunStore(secondRoot);
  const first = await stageReport(firstRoot, firstStore, measuredChangeReport);
  const second = await stageReport(secondRoot, secondStore, measuredChangeReport);

  const firstReport = (await firstStore.verifySkill(first.runId, contract.skillId))
    .skillLedgers[0].verificationReports.at(-1)!;
  const secondReport = (await secondStore.verifySkill(second.runId, contract.skillId))
    .skillLedgers[0].verificationReports.at(-1)!;

  assert.equal(firstReport.hardPassed, true);
  assert.equal(firstReport.hardPassed, secondReport.hardPassed);
  assert.equal(firstReport.gateResults.filter(({ gateId }) => gateId.startsWith(`${skillId}/gate/`)).length, contract.gates.length);
  assert.deepEqual(firstReport.gateResults, secondReport.gateResults);
  assert.equal((await firstStore.finalizeRun(first.runId)).state, "verified");
  assert.equal((await secondStore.finalizeRun(second.runId)).state, "verified");
});

test("independently persisted runs re-derive identical failed gate results for identical incomplete evidence", async () => {
  const firstRoot = await mkdtemp(path.join(os.tmpdir(), "domain-validators-fail-parity-a-"));
  const secondRoot = await mkdtemp(path.join(os.tmpdir(), "domain-validators-fail-parity-b-"));
  const firstStore = new StrictSkillRunStore(firstRoot);
  const secondStore = new StrictSkillRunStore(secondRoot);
  const first = await stageReport(firstRoot, firstStore, {}, false);
  const second = await stageReport(secondRoot, secondStore, {}, false);

  const firstDerivation = await deriveStrictValidatorResults(firstRoot, first, first.skillLedgers[0]);
  const secondDerivation = await deriveStrictValidatorResults(secondRoot, second, second.skillLedgers[0]);
  assert.deepEqual(firstDerivation.validatorResults, secondDerivation.validatorResults);
  assert.deepEqual(
    failedGateIds(firstDerivation.validatorResults).map((gateId) => gateId.slice(gateId.lastIndexOf("/") + 1)),
    performanceGateSlugs,
  );
  for (const slug of performanceGateSlugs) {
    assert.equal(firstDerivation.validatorResults[`${skillId}/gate/${slug}`].message, `Performance report failed ${slug}.`);
  }
});

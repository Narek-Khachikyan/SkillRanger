import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addStrictEvidence,
  beginStrictStep,
  completeStrictStep,
  createContentChunks,
  createStrictSkillRun,
  deriveStrictValidatorResults,
  readNextStrictChunk,
  StrictSkillRunError,
  StrictSkillRunStore,
  assertValidCriticReportV2,
  assertValidStrictSkillRun,
  type ExecutionContractV2,
  type StrictSkillSelection,
} from "../src/runtime/strict/index.ts";
import * as strictApi from "../src/runtime/strict/index.ts";
import { initializeRouterContext } from "../src/mcp/router-context.ts";
import { callMcpTool } from "../src/mcp/tools.ts";
import { describeBlockedSkills } from "../src/runtime/strict/finalization.ts";
import { verifyStrictSkill } from "../src/runtime/strict/reducer.ts";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const contract = (): ExecutionContractV2 => ({
  schemaVersion: "2.0", skillId: "frontend.test-skill", contractVersion: "2.0.0",
  inputSchema: "input.schema.json", outputSchema: "output.schema.json", mustRead: ["SKILL.md"],
  applicability: { op: "tag", value: "frontend" }, prerequisites: [], maxRepairIterations: 1,
  rules: [{ id: "frontend.test-skill/rule/complete", description: "Complete evidence." }],
  steps: [
    { id: "frontend.test-skill/step/inspect", type: "collect", requiredEvidenceKinds: ["inspection"], ruleIds: ["frontend.test-skill/rule/complete"] },
    { id: "frontend.test-skill/step/repair", type: "repair", requiredEvidenceKinds: ["repair-diff"], ruleIds: ["frontend.test-skill/rule/complete"], repairable: true },
    { id: "frontend.test-skill/step/report", type: "report", requiredEvidenceKinds: ["skill-output"], ruleIds: ["frontend.test-skill/rule/complete"] },
  ],
  gates: [
    { id: "frontend.test-skill/gate/inspection", level: "hard", evaluator: { type: "evidence-present", evidenceKind: "inspection" }, ruleIds: ["frontend.test-skill/rule/complete"] },
    { id: "frontend.test-skill/gate/output", level: "hard", evaluator: { type: "schema-valid", schema: "output" }, ruleIds: ["frontend.test-skill/rule/complete"] },
    { id: "frontend.test-skill/gate/custom", level: "hard", evaluator: { type: "validator", validatorId: "core/artifact-integrity" }, ruleIds: ["frontend.test-skill/rule/complete"] },
  ],
});

test("public strict API does not expose decisive verification booleans", () => {
  assert.equal("verifyStrictSkill" in strictApi, false);
  assert.equal("finalizeStrictRun" in strictApi, false);
});

test("deep raw verification rejects a caller-constructed derivation", () => {
  assert.throws(
    () => verifyStrictSkill(verificationReadyFixture(), "frontend.test-skill", {
      artifactIntegrity: { passed: true },
      validatorResults: { "core/artifact-integrity": { passed: true } },
      systemGateResults: [],
    }),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
  );
});

test("publishes closed run, critic, verification, and repair schemas", async () => {
  for (const file of [
    "skill-run-v2.schema.json",
    "critic-report-v2.schema.json",
    "verification-report-v2.schema.json",
    "repair-request-v2.schema.json",
  ]) {
    const schema = JSON.parse(await readFile(`schemas/${file}`, "utf8"));
    assert.equal(schema.additionalProperties, false, file);
  }

  const report = {
    schemaVersion: "2.0" as const,
    skillId: "frontend.test-skill",
    criticInvocationId: "critic-2",
    executorInvocationId: "executor-1",
    outcome: "findings" as const,
    evidenceArtifactIds: ["artifact-1"],
    findings: [{
      id: "finding-1",
      ruleId: "frontend.test-skill/rule/complete",
      severity: "high" as const,
      message: "The output is incomplete.",
      evidenceArtifactIds: ["artifact-1"],
      remediation: "Complete the output.",
    }],
  };
  assert.doesNotThrow(() => assertValidCriticReportV2(report, contract()));
  assert.throws(
    () => assertValidCriticReportV2({ ...report, criticInvocationId: report.executorInvocationId }, contract()),
    /independent/i,
  );
});

const selection = (overrides: Partial<StrictSkillSelection> = {}): StrictSkillSelection => ({
  skillId: "frontend.test-skill", role: "primary", mandatory: true, version: "1.0.0",
  packageChecksum: sha("package"), contractChecksum: sha(JSON.stringify(contract())), contract: contract(),
  schemaSnapshots: { input: { type: "object" }, output: { type: "object" } },
  schemaChecksums: { input: sha(JSON.stringify({ type: "object" })), output: sha(JSON.stringify({ type: "object" })) },
  contentChunks: createContentChunks("SKILL.md", "line one\nline two\n", 12),
  applicable: true, unmetPrerequisites: [],
  ...overrides,
});

const created = () => createStrictSkillRun({
  runId: "run_strict_test", domain: "frontend", targetAgent: "codex", locale: "en",
  intent: { sha256: sha("test"), normalizedGoal: "test strict runtime" }, selectedSkills: [selection()],
  now: "2026-07-15T10:00:00.000Z",
});

const fullyRead = () => {
  let run = created();
  while (run.state === "reading") run = readNextStrictChunk(run, "frontend.test-skill", "2026-07-15T10:00:01.000Z").run;
  return run;
};

const attach = (
  run: ReturnType<typeof created>,
  kind: string,
  stepId: string,
  validatedAs?: "output" | "critic-report",
) => {
  const step = run.skillLedgers.flatMap(({ steps }) => steps).find(({ id }) => id === stepId)!;
  const attempt = step.attempts.at(-1)!.attempt;
  return addStrictEvidence(run, {
  artifactId: `artifact-${kind}-${run.revision}`,
  kind,
  path: `artifacts/${kind}.json`,
  sha256: sha(`${kind}-${run.revision}`),
    size: 10,
    sourceControl: { mode: "non-git" },
  ...(validatedAs ? { validatedAs } : {}),
    attributions: [{ skillId: "frontend.test-skill", stepId, attempt, relation: "produced", ruleIds: ["frontend.test-skill/rule/complete"] }],
  });
};

const verificationReadyFixture = (includeCriticEvidence = false) => {
  let run = fullyRead();
  run = beginStrictStep(run, "frontend.test-skill", contract().steps[0].id);
  run = attach(run, "inspection", contract().steps[0].id);
  run = completeStrictStep(run, "frontend.test-skill", contract().steps[0].id);
  run = beginStrictStep(run, "frontend.test-skill", contract().steps[2].id);
  run = attach(run, "skill-output", contract().steps[2].id, "output");
  if (includeCriticEvidence) run = attach(run, "critic-report", contract().steps[2].id, "critic-report");
  run = completeStrictStep(run, "frontend.test-skill", contract().steps[2].id);
  return run;
};

const derivationRoot = await mkdtemp(path.join(os.tmpdir(), "strict-reducer-derivation-"));
const authenticFixtureDerivation = async () => {
  const source = verificationReadyFixture();
  source.artifacts = [];
  return deriveStrictValidatorResults(derivationRoot, source, source.skillLedgers[0]);
};
const passingDerivation = await authenticFixtureDerivation();
passingDerivation.validatorResults["core/artifact-integrity"] = { passed: true };
const failingDerivation = await authenticFixtureDerivation();
for (const gateId of Object.keys(failingDerivation.validatorResults)) failingDerivation.validatorResults[gateId] = { passed: false };
failingDerivation.validatorResults["core/artifact-integrity"] = { passed: false };
const artifactFailureDerivation = await deriveStrictValidatorResults(
  derivationRoot,
  verificationReadyFixture(),
  verificationReadyFixture().skillLedgers[0],
);
const criticFailingDerivation = await authenticFixtureDerivation();
criticFailingDerivation.systemGateResults = [{
  gateId: "core/gate/critic-findings", passed: false, level: "hard",
  message: "Critic reported 1 unresolved finding(s).",
}];
const criticPassingDerivation = await authenticFixtureDerivation();
criticPassingDerivation.systemGateResults = [{ gateId: "core/gate/critic-findings", passed: true, level: "hard" }];

test("deep raw verification rejects a cloned runtime derivation", () => {
  assert.throws(
    () => verifyStrictSkill(verificationReadyFixture(), "frontend.test-skill", structuredClone(passingDerivation)),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
  );
});

const fullyExecutedFixture = () => verifyStrictSkill(verificationReadyFixture(), "frontend.test-skill", passingDerivation);

const repairRequiredFixture = () => verifyStrictSkill(verificationReadyFixture(), "frontend.test-skill", failingDerivation);

const repairExhaustedFixture = () => {
  let run = repairRequiredFixture();
  run = beginStrictStep(run, "frontend.test-skill", contract().steps[1].id);
  run = attach(run, "repair-diff", contract().steps[1].id);
  run = completeStrictStep(run, "frontend.test-skill", contract().steps[1].id);
  run = beginStrictStep(run, "frontend.test-skill", contract().steps[2].id);
  run = attach(run, "skill-output", contract().steps[2].id, "output");
  run = completeStrictStep(run, "frontend.test-skill", contract().steps[2].id);
  return verifyStrictSkill(run, "frontend.test-skill", failingDerivation);
};

const renamedContract = (skillId: string): ExecutionContractV2 => JSON.parse(
  JSON.stringify(contract()).replaceAll("frontend.test-skill", skillId),
) as ExecutionContractV2;

const attachForSkill = (
  run: ReturnType<typeof created>,
  skillId: string,
  kind: string,
  stepId: string,
  validatedAs?: "output",
) => {
  const ledger = run.skillLedgers.find((candidate) => candidate.skillId === skillId)!;
  const attempt = ledger.steps.find(({ id }) => id === stepId)!.attempts.at(-1)!.attempt;
  return addStrictEvidence(run, {
    artifactId: `artifact-${skillId}-${kind}-${run.revision}`,
    kind,
    path: `artifacts/${skillId}-${kind}.json`,
    sha256: sha(`${skillId}-${kind}-${run.revision}`),
    size: 10,
    sourceControl: { mode: "non-git" },
    ...(validatedAs ? { validatedAs } : {}),
    attributions: [{ skillId, stepId, attempt, relation: "produced", ruleIds: ledger.contract.rules.map(({ id }) => id) }],
  });
};

test("accepts a reducer-produced ready ledger for a repair-only contract", () => {
  const skillId = "frontend.repair-only";
  const repairOnly = renamedContract(skillId);
  repairOnly.steps = repairOnly.steps.filter(({ type }) => type === "repair");
  let run = createStrictSkillRun({
    runId: "run_repair_only", domain: "frontend", targetAgent: "codex", locale: "en",
    intent: { sha256: sha("repair only"), normalizedGoal: "validate a repair-only contract" },
    selectedSkills: [selection({
      skillId,
      contract: repairOnly,
      contractChecksum: sha(JSON.stringify(repairOnly)),
    })],
  });
  while (run.state === "reading") run = readNextStrictChunk(run, skillId).run;

  assert.equal(run.state, "ready");
  assert.equal(run.skillLedgers[0].state, "ready");
  assert.deepEqual(run.skillLedgers[0].steps.map(({ status }) => status), ["skipped"]);
  assert.doesNotThrow(() => assertValidStrictSkillRun(run));

  const forged = structuredClone(run);
  forged.state = "verifying";
  assert.throws(() => assertValidStrictSkillRun(forged), StrictSkillRunError);
});

test("accepts reducer verification while another ledger owns the active step", () => {
  const firstSkillId = "frontend.first";
  const secondSkillId = "frontend.second";
  const firstContract = renamedContract(firstSkillId);
  const secondContract = renamedContract(secondSkillId);
  let run = createStrictSkillRun({
    runId: "run_multi_active", domain: "frontend", targetAgent: "codex", locale: "en",
    intent: { sha256: sha("multi active"), normalizedGoal: "verify one active multi-ledger run" },
    selectedSkills: [
      selection({ skillId: firstSkillId, contract: firstContract, contractChecksum: sha(JSON.stringify(firstContract)) }),
      selection({ skillId: secondSkillId, contract: secondContract, contractChecksum: sha(JSON.stringify(secondContract)) }),
    ],
  });
  for (const skillId of [firstSkillId, secondSkillId]) {
    const ledger = () => run.skillLedgers.find((candidate) => candidate.skillId === skillId)!;
    while (ledger().readReceipts.length < ledger().contentChunks.length) run = readNextStrictChunk(run, skillId).run;
  }
  run = beginStrictStep(run, firstSkillId, firstContract.steps[0].id);
  run = attachForSkill(run, firstSkillId, "inspection", firstContract.steps[0].id);
  run = completeStrictStep(run, firstSkillId, firstContract.steps[0].id);
  run = beginStrictStep(run, firstSkillId, firstContract.steps[2].id);
  run = attachForSkill(run, firstSkillId, "skill-output", firstContract.steps[2].id, "output");
  run = completeStrictStep(run, firstSkillId, firstContract.steps[2].id);
  run = beginStrictStep(run, secondSkillId, secondContract.steps[0].id);
  run = verifyStrictSkill(run, firstSkillId, passingDerivation);

  assert.equal(run.state, "verifying");
  assert.deepEqual(run.skillLedgers.map(({ state }) => state), ["used", "running"]);
  assert.doesNotThrow(() => assertValidStrictSkillRun(run));

  const forged = structuredClone(run);
  forged.state = "failed";
  assert.throws(() => assertValidStrictSkillRun(forged), StrictSkillRunError);
});

test("chunks UTF-8 content deterministically and requires every sequential receipt", () => {
  const chunks = createContentChunks("SKILL.md", "1234567890\nабвгд\nlast", 12);
  assert.equal(chunks.map(({ content }) => content).join(""), "1234567890\nабвгд\nlast");
  assert.deepEqual(chunks.map(({ ordinal }) => ordinal), chunks.map((_, index) => index));

  let run = created();
  assert.equal(run.state, "reading");
  assert.throws(() => beginStrictStep(run, "frontend.test-skill", contract().steps[0].id), (error: unknown) => error instanceof StrictSkillRunError && error.code === "skill-content-unread");
  const first = readNextStrictChunk(run, "frontend.test-skill", "2026-07-15T10:00:01.000Z");
  assert.equal(first.chunk.ordinal, 0);
  run = first.run;
  assert.equal(run.skillLedgers[0].readReceipts.length, 1);
  while (run.state === "reading") run = readNextStrictChunk(run, "frontend.test-skill", "2026-07-15T10:00:02.000Z").run;
  assert.equal(run.state, "ready");
});

test("enforces step order, current-step evidence, and required evidence kinds", () => {
  let run = fullyRead();
  assert.throws(() => beginStrictStep(run, "frontend.test-skill", contract().steps[2].id), (error: unknown) => error instanceof StrictSkillRunError && error.code === "step-out-of-order");
  run = beginStrictStep(run, "frontend.test-skill", contract().steps[0].id);
  assert.throws(() => completeStrictStep(run, "frontend.test-skill", contract().steps[0].id), (error: unknown) => error instanceof StrictSkillRunError && error.code === "evidence-missing");
  run = attach(run, "inspection", contract().steps[0].id);
  run = completeStrictStep(run, "frontend.test-skill", contract().steps[0].id);
  assert.equal(run.skillLedgers[0].steps[0].status, "satisfied");
  assert.equal(run.skillLedgers[0].steps[1].status, "skipped");
});

test("rejects persisted step snapshots that diverge from the execution contract", () => {
  const forged = structuredClone(created());
  forged.skillLedgers[0].steps[0].id = "frontend.test-skill/step/forged";
  assert.throws(() => assertValidStrictSkillRun(forged), StrictSkillRunError);
});

test("rejects a persisted used ledger without a passing verification report", () => {
  const forged = fullyExecutedFixture();
  forged.skillLedgers[0].verificationReports = [];
  assert.throws(() => assertValidStrictSkillRun(forged), StrictSkillRunError);
});

test("rejects a passing verified ledger forged as report-driven blocked", () => {
  const forged = fullyExecutedFixture();
  forged.state = "blocked";
  forged.skillLedgers[0].state = "blocked";
  forged.skillLedgers[0].outcome = "blocked";
  assert.throws(() => assertValidStrictSkillRun(forged), StrictSkillRunError);
});

test("rejects persisted attempts that reference missing artifacts", () => {
  const forged = fullyExecutedFixture();
  forged.skillLedgers[0].steps[0].attempts[0].evidenceIds[0] = "artifact-missing";
  assert.throws(() => assertValidStrictSkillRun(forged), StrictSkillRunError);
});

test("rejects persisted verification reports inconsistent with their contract", () => {
  for (const mutate of [
    (run: ReturnType<typeof fullyExecutedFixture>) => { run.skillLedgers[0].verificationReports[0].skillId = "frontend.forged"; },
    (run: ReturnType<typeof fullyExecutedFixture>) => { run.skillLedgers[0].verificationReports[0].gateResults[0].level = "advisory"; },
    (run: ReturnType<typeof fullyExecutedFixture>) => { run.skillLedgers[0].verificationReports[0].hardPassed = false; },
  ]) {
    const forged = fullyExecutedFixture();
    mutate(forged);
    assert.throws(() => assertValidStrictSkillRun(forged), StrictSkillRunError);
  }

  const missingEvidence = fullyExecutedFixture();
  missingEvidence.skillLedgers[0].verificationReports[0].evidenceIds.pop();
  assert.throws(() => assertValidStrictSkillRun(missingEvidence), StrictSkillRunError);

  const duplicateEvidence = fullyExecutedFixture();
  duplicateEvidence.skillLedgers[0].verificationReports[0].evidenceIds.push(
    duplicateEvidence.skillLedgers[0].verificationReports[0].evidenceIds[0],
  );
  assert.throws(() => assertValidStrictSkillRun(duplicateEvidence), StrictSkillRunError);

  const systemGateWithoutCriticEvidence = fullyExecutedFixture();
  systemGateWithoutCriticEvidence.skillLedgers[0].verificationReports[0].gateResults.push({
    gateId: "core/gate/critic-findings",
    passed: true,
    level: "hard",
  });
  assert.throws(() => assertValidStrictSkillRun(systemGateWithoutCriticEvidence), StrictSkillRunError);
});

test("rejects persisted repair bookkeeping outside contract bounds", () => {
  const forgedCounter = repairRequiredFixture();
  forgedCounter.skillLedgers[0].repairIterations = 2;
  assert.throws(() => assertValidStrictSkillRun(forgedCounter), StrictSkillRunError);

  const forgedRequest = repairRequiredFixture();
  forgedRequest.skillLedgers[0].repairRequests[0].sourceReportIndex = 1;
  assert.throws(() => assertValidStrictSkillRun(forgedRequest), StrictSkillRunError);
});

test("rejects persisted artifact attributions outside the declared execution graph", () => {
  for (const mutate of [
    (run: ReturnType<typeof fullyExecutedFixture>) => { run.artifacts[0].attributions[0].stepId = "frontend.test-skill/step/forged"; },
    (run: ReturnType<typeof fullyExecutedFixture>) => { run.artifacts[0].attributions[0].attempt = 2; },
    (run: ReturnType<typeof fullyExecutedFixture>) => { run.artifacts[0].attributions[0].ruleIds = ["frontend.test-skill/rule/forged"]; },
  ]) {
    const forged = fullyExecutedFixture();
    mutate(forged);
    assert.throws(() => assertValidStrictSkillRun(forged), StrictSkillRunError);
  }
});

test("rejects cross-ledger and cross-attempt artifact ownership rewiring", () => {
  const firstSkillId = "frontend.first-owner";
  const secondSkillId = "frontend.second-owner";
  const firstContract = renamedContract(firstSkillId);
  const secondContract = renamedContract(secondSkillId);
  let multi = createStrictSkillRun({
    runId: "run_owner_ledgers", domain: "frontend", targetAgent: "codex", locale: "en",
    intent: { sha256: sha("owner ledgers"), normalizedGoal: "validate cross-ledger ownership" },
    selectedSkills: [
      selection({ skillId: firstSkillId, contract: firstContract, contractChecksum: sha(JSON.stringify(firstContract)) }),
      selection({ skillId: secondSkillId, contract: secondContract, contractChecksum: sha(JSON.stringify(secondContract)) }),
    ],
  });
  for (const skillId of [firstSkillId, secondSkillId]) {
    const ledger = () => multi.skillLedgers.find((candidate) => candidate.skillId === skillId)!;
    while (ledger().readReceipts.length < ledger().contentChunks.length) multi = readNextStrictChunk(multi, skillId).run;
    const stepId = ledger().contract.steps[0].id;
    multi = beginStrictStep(multi, skillId, stepId);
    multi = attachForSkill(multi, skillId, "inspection", stepId);
    multi = completeStrictStep(multi, skillId, stepId);
  }
  const crossLedger = structuredClone(multi);
  const [firstLedger, secondLedger] = crossLedger.skillLedgers;
  firstLedger.steps[0].attempts[0].evidenceIds[0] = secondLedger.steps[0].attempts[0].evidenceIds[0];
  assert.throws(
    () => assertValidStrictSkillRun(crossLedger),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
  );

  const crossAttempt = repairExhaustedFixture();
  const reportAttempts = crossAttempt.skillLedgers[0].steps[2].attempts;
  [reportAttempts[0].evidenceIds, reportAttempts[1].evidenceIds] = [
    reportAttempts[1].evidenceIds,
    reportAttempts[0].evidenceIds,
  ];
  assert.throws(
    () => assertValidStrictSkillRun(crossAttempt),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
  );
});

test("rejects persisted terminal and aggregate states inconsistent with their lifecycle", () => {
  const forgedNoOp = created();
  forgedNoOp.state = "planned";
  forgedNoOp.skillLedgers[0].state = "no-op";
  forgedNoOp.skillLedgers[0].outcome = "no-op";
  assert.throws(() => assertValidStrictSkillRun(forgedNoOp), StrictSkillRunError);

  const forgedAggregate = created();
  forgedAggregate.state = "verified";
  assert.throws(() => assertValidStrictSkillRun(forgedAggregate), StrictSkillRunError);

  for (const state of ["ready", "verifying"] as const) {
    const forgedInProgress = created();
    forgedInProgress.state = state;
    assert.throws(() => assertValidStrictSkillRun(forgedInProgress), StrictSkillRunError);
  }
});

test("rejects a pre-verification aggregate forged from verifying to ready", () => {
  const forged = verificationReadyFixture();
  assert.equal(forged.state, "verifying");
  assert.equal(forged.skillLedgers[0].state, "ready");
  forged.state = "ready";
  assert.throws(() => assertValidStrictSkillRun(forged), StrictSkillRunError);
});

test("rejects a repair-required ledger globally relabeled ready", () => {
  const forged = repairRequiredFixture();
  forged.state = "ready";
  assert.throws(() => assertValidStrictSkillRun(forged), StrictSkillRunError);

  forged.skillLedgers[0].state = "ready";
  assert.throws(() => assertValidStrictSkillRun(forged), StrictSkillRunError);
});

test("rejects a repair-required ledger globally relabeled verifying", () => {
  const forged = repairRequiredFixture();
  forged.state = "verifying";
  forged.skillLedgers[0].steps[2].status = "satisfied";
  assert.throws(() => assertValidStrictSkillRun(forged), StrictSkillRunError);

  forged.skillLedgers[0].state = "verifying";
  assert.throws(() => assertValidStrictSkillRun(forged), StrictSkillRunError);
});

test("accepts reducer-produced persisted lifecycle graphs", () => {
  assert.doesNotThrow(() => assertValidStrictSkillRun(created()));
  assert.doesNotThrow(() => assertValidStrictSkillRun(verificationReadyFixture()));
  assert.doesNotThrow(() => assertValidStrictSkillRun(repairRequiredFixture()));
  assert.doesNotThrow(() => assertValidStrictSkillRun(fullyExecutedFixture()));
  assert.doesNotThrow(() => assertValidStrictSkillRun(repairExhaustedFixture()));
});

test("computes verification, opens one bounded repair, and refuses caller-controlled completion", () => {
  let run = fullyRead();
  run = beginStrictStep(run, "frontend.test-skill", contract().steps[0].id);
  run = attach(run, "inspection", contract().steps[0].id);
  run = completeStrictStep(run, "frontend.test-skill", contract().steps[0].id);
  run = beginStrictStep(run, "frontend.test-skill", contract().steps[2].id);
  run = attach(run, "skill-output", contract().steps[2].id, "output");
  run = completeStrictStep(run, "frontend.test-skill", contract().steps[2].id);

  const failed = verifyStrictSkill(run, "frontend.test-skill", failingDerivation);
  assert.equal(failed.state, "repair-required");
  assert.equal(failed.skillLedgers[0].repairRequests.length, 1);
  assert.equal(failed.skillLedgers[0].steps[1].status, "pending");

  run = beginStrictStep(failed, "frontend.test-skill", contract().steps[1].id);
  run = attach(run, "repair-diff", contract().steps[1].id);
  run = completeStrictStep(run, "frontend.test-skill", contract().steps[1].id);
  run = beginStrictStep(run, "frontend.test-skill", contract().steps[2].id);
  run = attach(run, "skill-output", contract().steps[2].id, "output");
  run = completeStrictStep(run, "frontend.test-skill", contract().steps[2].id);
  run = verifyStrictSkill(run, "frontend.test-skill", passingDerivation);
  assert.equal(run.skillLedgers[0].outcome, "used");
});

test("preserves every repair step evidence across historical and current verification iterations", async () => {
  const multiRepairContract: ExecutionContractV2 = {
    ...contract(),
    steps: [
      { id: "frontend.test-skill/step/inspect", type: "collect", requiredEvidenceKinds: ["inspection"], ruleIds: ["frontend.test-skill/rule/complete"] },
      { id: "frontend.test-skill/step/repair-a", type: "repair", requiredEvidenceKinds: ["repair-a"], ruleIds: ["frontend.test-skill/rule/complete"], repairable: true },
      { id: "frontend.test-skill/step/review", type: "validate", requiredEvidenceKinds: ["review"], ruleIds: ["frontend.test-skill/rule/complete"] },
      { id: "frontend.test-skill/step/repair-b", type: "repair", requiredEvidenceKinds: ["repair-b"], ruleIds: ["frontend.test-skill/rule/complete"], repairable: true },
      { id: "frontend.test-skill/step/report", type: "report", requiredEvidenceKinds: ["skill-output"], ruleIds: ["frontend.test-skill/rule/complete"] },
    ],
    gates: [
      { id: "frontend.test-skill/gate/inspection", level: "hard", evaluator: { type: "evidence-present", evidenceKind: "inspection" }, ruleIds: ["frontend.test-skill/rule/complete"] },
      { id: "frontend.test-skill/gate/repair-a", level: "hard", evaluator: { type: "evidence-present", evidenceKind: "repair-a" }, ruleIds: ["frontend.test-skill/rule/complete"] },
      { id: "frontend.test-skill/gate/repair-b", level: "hard", evaluator: { type: "evidence-present", evidenceKind: "repair-b" }, ruleIds: ["frontend.test-skill/rule/complete"] },
      { id: "frontend.test-skill/gate/output", level: "hard", evaluator: { type: "schema-valid", schema: "output" }, ruleIds: ["frontend.test-skill/rule/complete"] },
      { id: "frontend.test-skill/gate/custom", level: "hard", evaluator: { type: "validator", validatorId: "core/artifact-integrity" }, ruleIds: ["frontend.test-skill/rule/complete"] },
    ],
  };
  let run = createStrictSkillRun({
    runId: "run_multi_repair", domain: "frontend", targetAgent: "codex", locale: "en",
    intent: { sha256: sha("multi repair"), normalizedGoal: "verify every repair step" },
    selectedSkills: [selection({
      contract: multiRepairContract,
      contractChecksum: sha(JSON.stringify(multiRepairContract)),
    })],
    now: "2026-07-15T10:00:00.000Z",
  });
  while (run.state === "reading") run = readNextStrictChunk(run, multiRepairContract.skillId, "2026-07-15T10:00:01.000Z").run;
  const complete = (stepIndex: number, kind: string, validatedAs?: "output") => {
    const stepId = multiRepairContract.steps[stepIndex].id;
    run = beginStrictStep(run, multiRepairContract.skillId, stepId);
    run = attach(run, kind, stepId, validatedAs);
    run = completeStrictStep(run, multiRepairContract.skillId, stepId);
  };
  const reportKinds = (reportIndex: number) => {
    const byId = new Map(run.artifacts.map((artifact) => [artifact.artifactId, artifact.kind]));
    return run.skillLedgers[0].verificationReports[reportIndex].evidenceIds.map((id) => byId.get(id));
  };

  complete(0, "inspection");
  complete(2, "review");
  complete(4, "skill-output", "output");
  run = verifyStrictSkill(run, multiRepairContract.skillId, failingDerivation);
  assert.deepEqual(reportKinds(0), ["inspection", "review", "skill-output"]);

  complete(1, "repair-a");
  complete(2, "review");
  complete(3, "repair-b");
  complete(4, "skill-output", "output");
  run = verifyStrictSkill(run, multiRepairContract.skillId, passingDerivation);

  assert.equal(run.skillLedgers[0].outcome, "used");
  assert.deepEqual(reportKinds(0), ["inspection", "review", "skill-output"]);
  assert.deepEqual(reportKinds(1), ["inspection", "repair-a", "review", "repair-b", "skill-output"]);
  assert.doesNotThrow(() => assertValidStrictSkillRun(run));

  const root = await mkdtemp(path.join(os.tmpdir(), "strict-multi-repair-"));
  const store = new StrictSkillRunStore(root);
  await store.create(run);
  assert.deepEqual(await store.read(run.runId), run);
});

test("critical critic findings enter bounded repair before a later passing critic gate can be used", () => {
  const criticGateId = "core/gate/critic-findings";
  const criticReport = Object.freeze({
    schemaVersion: "2.0" as const,
    skillId: "frontend.test-skill",
    criticInvocationId: "critic-2",
    executorInvocationId: "executor-1",
    outcome: "findings" as const,
    evidenceArtifactIds: ["artifact-screenshot"],
    findings: [Object.freeze({
      id: "critical-1",
      ruleId: contract().rules[0].id,
      severity: "critical" as const,
      message: "The verified surface is still broken.",
      evidenceArtifactIds: ["artifact-screenshot"],
      remediation: "Repair and recapture the surface.",
    })],
  });
  assert.doesNotThrow(() => assertValidCriticReportV2(criticReport, contract()));

  let run = verifyStrictSkill(verificationReadyFixture(true), "frontend.test-skill", criticFailingDerivation);
  assert.equal(run.state, "repair-required");
  assert.equal(run.skillLedgers[0].verificationReports[0].hardPassed, false);
  assert.deepEqual(run.skillLedgers[0].repairRequests[0].gateIds, [criticGateId]);

  run = beginStrictStep(run, "frontend.test-skill", contract().steps[1].id);
  run = attach(run, "repair-diff", contract().steps[1].id);
  run = completeStrictStep(run, "frontend.test-skill", contract().steps[1].id);
  run = beginStrictStep(run, "frontend.test-skill", contract().steps[2].id);
  run = attach(run, "skill-output", contract().steps[2].id, "output");
  run = attach(run, "critic-report", contract().steps[2].id, "critic-report");
  run = completeStrictStep(run, "frontend.test-skill", contract().steps[2].id);
  run = verifyStrictSkill(run, "frontend.test-skill", criticPassingDerivation);

  assert.equal(run.skillLedgers[0].outcome, "used");
  assert.equal(run.skillLedgers[0].verificationReports[1].gateResults.at(-1)?.gateId, criticGateId);
  assert.doesNotThrow(() => assertValidStrictSkillRun(run));

  const duplicate = structuredClone(run);
  duplicate.skillLedgers[0].verificationReports[1].gateResults.push({ gateId: criticGateId, passed: true, level: "hard" });
  assert.throws(() => assertValidStrictSkillRun(duplicate), StrictSkillRunError);
});

test("rejects failed artifact integrity before reducing contract gates", () => {
  const untouchedSource = new Proxy({} as ReturnType<typeof verificationReadyFixture>, {
    get: () => { throw new Error("strict run source was touched"); },
  });
  assert.throws(
    () => verifyStrictSkill(untouchedSource, "frontend.test-skill", artifactFailureDerivation),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "artifact-integrity",
  );
});

test("derives no-op and blocked ledgers before execution and blocks aggregate certification", async () => {
  const run = createStrictSkillRun({
    runId: "run_strict_terminal", domain: "frontend", targetAgent: "codex", locale: "en",
    intent: { sha256: sha("test"), normalizedGoal: "terminal ledgers" },
    selectedSkills: [
      selection({ skillId: "frontend.noop", contract: renamedContract("frontend.noop"), contractChecksum: sha(JSON.stringify(renamedContract("frontend.noop"))), applicable: false }),
      selection({ skillId: "frontend.blocked", contract: renamedContract("frontend.blocked"), contractChecksum: sha(JSON.stringify(renamedContract("frontend.blocked"))), unmetPrerequisites: ["browser-ready"] }),
    ],
    now: "2026-07-15T10:00:00.000Z",
  });
  assert.deepEqual(run.skillLedgers.map(({ outcome }) => outcome), ["no-op", "blocked"]);
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-terminal-finalize-"));
  const store = new StrictSkillRunStore(root);
  await store.create(run);
  const finalized = await store.finalizeRun(run.runId);
  assert.equal(finalized.state, "blocked");

  // Agents retry an errored blocked finalize; a repeat call must not rewrite the terminal record.
  const repeated = await store.finalizeRun(run.runId);
  assert.equal(repeated.revision, finalized.revision);
  assert.equal(repeated.updatedAt, finalized.updatedAt);

  // A no-op skill was never applicable; reporting it as a gate failure is the dishonest terminal
  // report this contract exists to prevent.
  assert.deepEqual(describeBlockedSkills(finalized), [{
    skillId: "frontend.blocked",
    reason: "unmet-prerequisites",
    failedHardGates: [],
    unmetPrerequisites: ["browser-ready"],
  }]);
});

test("mid-run blocked aggregate state does not satisfy repeat-finalize idempotence", async () => {
  // Exhausting one skill's repair budget blocks the aggregate state while other ledgers are still
  // non-terminal; finalize must keep demanding terminal outcomes instead of returning the record.
  const run = createStrictSkillRun({
    runId: "run_strict_midrun_blocked", domain: "frontend", targetAgent: "codex", locale: "en",
    intent: { sha256: sha("test"), normalizedGoal: "mid-run blocked" },
    selectedSkills: [
      selection({ skillId: "frontend.blocked", contract: renamedContract("frontend.blocked"), contractChecksum: sha(JSON.stringify(renamedContract("frontend.blocked"))), unmetPrerequisites: ["browser-ready"] }),
      selection({ skillId: "frontend.pending", contract: renamedContract("frontend.pending"), contractChecksum: sha(JSON.stringify(renamedContract("frontend.pending"))) }),
    ],
    now: "2026-07-15T10:00:00.000Z",
  });
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-midrun-blocked-"));
  const store = new StrictSkillRunStore(root);
  await store.create({ ...run, state: "blocked" as const });
  await assert.rejects(
    () => store.finalizeRun(run.runId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-not-finalizable",
  );
});

test("MCP finalize reports run-blocked for a run blocked before execution", async () => {
  // Blocked at creation: no verification report exists, so failedHardGates is legitimately empty.
  // An acceptance criterion demanding a non-empty gate list would be unsatisfiable here.
  const run = createStrictSkillRun({
    runId: "run_strict_blocked_mcp", domain: "frontend", targetAgent: "codex", locale: "en",
    intent: { sha256: sha("test"), normalizedGoal: "blocked before execution" },
    selectedSkills: [selection({ unmetPrerequisites: ["browser-ready"] })],
    now: "2026-07-15T10:00:00.000Z",
  });
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-blocked-mcp-"));
  await new StrictSkillRunStore(root).create(run);
  process.env.SKILLRANGER_PROJECT_ROOT = root;
  initializeRouterContext();

  const finalized = await callMcpTool("finalize_skill_run", { projectRoot: root, runId: run.runId });
  assert.equal(finalized.isError, true);
  const body = finalized.structuredContent as {
    code: string;
    lifecycleCode: string;
    state: string;
    userMessage: string;
    blockedSkills: Array<{ skillId: string; reason: string; failedHardGates: string[]; unmetPrerequisites: string[] }>;
  };
  assert.equal(body.code, "run-blocked");
  // Additive: raising this through StrictSkillRunError so the CLI shares one helper routes it via
  // withSkillRunErrors, which stamps lifecycleCode on every strict error.
  assert.equal(body.lifecycleCode, "run-blocked");
  assert.equal(body.state, "blocked");
  assert.match(body.userMessage, /no verified result/);
  assert.equal(body.blockedSkills.length, 1);
  assert.equal(body.blockedSkills[0].reason, "unmet-prerequisites");
  assert.deepEqual(body.blockedSkills[0].failedHardGates, []);
  assert.deepEqual(body.blockedSkills[0].unmetPrerequisites, ["browser-ready"]);

  // The error must not replace terminal persistence, or the run would be left unfinalized.
  const inspected = await callMcpTool("inspect_skill_run", { projectRoot: root, runId: run.runId });
  assert.equal(inspected.isError, false);
  assert.equal((inspected.structuredContent as { state: string }).state, "blocked");
});

test("blocked-skill reasons distinguish unmet prerequisites from failed hard gates", () => {
  const ledger = (overrides: Record<string, unknown>) => ({
    skillId: "frontend.test-skill", outcome: "blocked",
    applicability: { applicable: true, unmetPrerequisites: [] },
    verificationReports: [],
    ...overrides,
  });
  const described = describeBlockedSkills({
    skillLedgers: [
      ledger({ applicability: { applicable: true, unmetPrerequisites: ["browser-ready"] } }),
      ledger({
        skillId: "frontend.gated",
        verificationReports: [{ gateResults: [
          { gateId: "frontend.gated/gate/critic-independent", level: "hard", passed: false },
          { gateId: "frontend.gated/gate/soft-hint", level: "soft", passed: false },
          { gateId: "frontend.gated/gate/ok", level: "hard", passed: true },
        ] }],
      }),
      ledger({ skillId: "frontend.done", outcome: "used" }),
    ],
  } as never);

  assert.deepEqual(described.map(({ skillId, reason }) => [skillId, reason]), [
    ["frontend.test-skill", "unmet-prerequisites"],
    ["frontend.gated", "hard-gates-failed"],
  ]);
  assert.deepEqual(described[0].failedHardGates, []);
  assert.deepEqual(described[1].failedHardGates, ["frontend.gated/gate/critic-independent"]);
});

test("critic v2 rejection names its contract and travels with structured details", async () => {
  // The observed failure: an agent submitted a VisualCriticReport v1 shape as strict evidence and
  // could not tell from the message which of the two critic contracts was expected.
  assert.throws(
    () => assertValidCriticReportV2({ schemaVersion: "1.0", policyId: "p", findings: [], passed: true }, contract()),
    (error: unknown) => error instanceof Error
      && /CriticReportV2/.test(error.message)
      && /not VisualCriticReport v1/.test(error.message),
  );

  const root = await mkdtemp(path.join(os.tmpdir(), "strict-critic-details-"));
  const store = new StrictSkillRunStore(root);
  await store.create(beginStrictStep(fullyRead(), "frontend.test-skill", contract().steps[0].id));
  process.env.SKILLRANGER_PROJECT_ROOT = root;
  initializeRouterContext();
  const sourcePath = path.join(root, "critic.json");
  await writeFile(sourcePath, JSON.stringify({ schemaVersion: "1.0", passed: true }), "utf8");

  const result = await callMcpTool("add_skill_evidence", {
    projectRoot: root, runId: "run_strict_test", skillId: "frontend.test-skill",
    stepId: contract().steps[0].id, sourcePath, kind: "critic-report", validatedAs: "critic-report",
    relation: "produced", ruleIds: contract().steps[0].ruleIds,
  });
  assert.equal(result.isError, true);
  const details = (result.structuredContent as { details?: Record<string, unknown> }).details ?? {};
  assert.equal(details.contract, "CriticReportV2");
  assert.equal(details.expectedSchemaVersion, "2.0");
  assert.deepEqual(details.requiredFields, [
    "schemaVersion", "skillId", "criticInvocationId", "executorInvocationId", "outcome", "evidenceArtifactIds", "findings",
  ]);
});

test("validatedAs is inferred from kind for the artifacts verification looks up by it", async () => {
  // Agents set only `kind`; the critic gate selects by `validatedAs`, so a correct report used to
  // be ingested unvalidated and then stay invisible to verification.
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-critic-infer-"));
  const store = new StrictSkillRunStore(root);
  await store.create(beginStrictStep(fullyRead(), "frontend.test-skill", contract().steps[0].id));
  const stepId = contract().steps[0].id;
  const attribution = { skillId: "frontend.test-skill", stepId, attempt: 1, relation: "produced" as const, ruleIds: ["frontend.test-skill/rule/complete"] };
  const report = {
    schemaVersion: "2.0", skillId: "frontend.test-skill",
    criticInvocationId: "critic-1", executorInvocationId: "exec-1",
    outcome: "clean", evidenceArtifactIds: ["artifact-1"], findings: [],
  };
  const sourcePath = path.join(root, "critic.json");
  await writeFile(sourcePath, JSON.stringify(report), "utf8");

  const run = await store.ingestEvidence("run_strict_test", {
    sourcePath, kind: "critic-report", attributions: [attribution],
  });
  const stored = run.artifacts.at(-1);
  assert.equal(stored?.kind, "critic-report");
  assert.equal(stored?.validatedAs, "critic-report", "validatedAs must be inferred so the verifier can find it");

  // An invalid report of the same kind is now rejected at ingestion rather than accepted silently.
  const badPath = path.join(root, "bad-critic.json");
  await writeFile(badPath, JSON.stringify({ schemaVersion: "1.0", passed: true }), "utf8");
  await assert.rejects(
    () => store.ingestEvidence("run_strict_test", { sourcePath: badPath, kind: "critic-report", attributions: [attribution] }),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "artifact-integrity",
  );

  // A conflicting explicit validatedAs is refused instead of silently overridden.
  await assert.rejects(
    () => store.ingestEvidence("run_strict_test", { sourcePath, kind: "critic-report", validatedAs: "output", attributions: [attribution] }),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "artifact-integrity",
  );

  // A kind that collides with an Object.prototype member must stay plain evidence, not walk the
  // prototype into inference and fail against a schema the agent never requested.
  const protoRun = await store.ingestEvidence("run_strict_test", {
    sourcePath, kind: "toString", attributions: [attribution],
  });
  const protoStored = protoRun.artifacts.at(-1);
  assert.equal(protoStored?.kind, "toString");
  assert.equal(protoStored?.validatedAs, undefined);
});

test("skill-output evidence is validated against the output schema without an explicit validatedAs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-output-infer-"));
  const store = new StrictSkillRunStore(root);
  await store.create(beginStrictStep(fullyRead(), "frontend.test-skill", contract().steps[0].id));
  const stepId = contract().steps[0].id;
  const attribution = { skillId: "frontend.test-skill", stepId, attempt: 1, relation: "produced" as const, ruleIds: ["frontend.test-skill/rule/complete"] };
  const sourcePath = path.join(root, "skill-output.json");
  await writeFile(sourcePath, JSON.stringify({ summary: "done" }), "utf8");

  const run = await store.ingestEvidence("run_strict_test", {
    sourcePath, kind: "skill-output", attributions: [attribution],
  });
  assert.equal(run.artifacts.at(-1)?.validatedAs, "output", "verification.ts selects the output artifact by validatedAs");

  await assert.rejects(
    () => store.ingestEvidence("run_strict_test", { sourcePath, kind: "skill-output", validatedAs: "critic-report", attributions: [attribution] }),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "artifact-integrity",
  );
});

test("a contract-named report kind is still inferred as the output the gates read", async () => {
  // frontend.performance-review names its report kind performance-report, so the kind a host must
  // send to satisfy requiredEvidenceKinds is not the one the output gate looks up.
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-report-infer-"));
  const store = new StrictSkillRunStore(root);
  await store.create(beginStrictStep(fullyRead(), "frontend.test-skill", contract().steps[0].id));
  const stepId = contract().steps[0].id;
  const attribution = { skillId: "frontend.test-skill", stepId, attempt: 1, relation: "produced" as const, ruleIds: ["frontend.test-skill/rule/complete"] };
  const sourcePath = path.join(root, "performance-report.json");
  await writeFile(sourcePath, JSON.stringify({ summary: "done" }), "utf8");

  const run = await store.ingestEvidence("run_strict_test", {
    sourcePath, kind: "performance-report", attributions: [attribution],
  });
  assert.equal(run.artifacts.at(-1)?.validatedAs, "output", "the schema-valid output gate selects by validatedAs");
});

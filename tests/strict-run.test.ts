import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  addStrictEvidence,
  beginStrictStep,
  completeStrictStep,
  createContentChunks,
  createStrictSkillRun,
  finalizeStrictRun,
  readNextStrictChunk,
  verifyStrictSkill,
  StrictSkillRunError,
  assertValidCriticReportV2,
  type ExecutionContractV2,
  type StrictSkillSelection,
} from "../src/runtime/strict/index.ts";

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

const attach = (run: ReturnType<typeof created>, kind: string, stepId: string, validatedAs?: "output") => {
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

const renamedContract = (skillId: string): ExecutionContractV2 => JSON.parse(
  JSON.stringify(contract()).replaceAll("frontend.test-skill", skillId),
) as ExecutionContractV2;

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

test("computes verification, opens one bounded repair, and refuses caller-controlled completion", () => {
  let run = fullyRead();
  run = beginStrictStep(run, "frontend.test-skill", contract().steps[0].id);
  run = attach(run, "inspection", contract().steps[0].id);
  run = completeStrictStep(run, "frontend.test-skill", contract().steps[0].id);
  run = beginStrictStep(run, "frontend.test-skill", contract().steps[2].id);
  run = attach(run, "skill-output", contract().steps[2].id, "output");
  run = completeStrictStep(run, "frontend.test-skill", contract().steps[2].id);

  const failed = verifyStrictSkill(run, "frontend.test-skill", {
    validatorResults: { "core/artifact-integrity": { passed: false, message: "Digest mismatch." } },
  });
  assert.equal(failed.state, "repair-required");
  assert.equal(failed.skillLedgers[0].repairRequests.length, 1);
  assert.equal(failed.skillLedgers[0].steps[1].status, "pending");
  assert.throws(() => finalizeStrictRun(failed), (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-not-finalizable");

  run = beginStrictStep(failed, "frontend.test-skill", contract().steps[1].id);
  run = attach(run, "repair-diff", contract().steps[1].id);
  run = completeStrictStep(run, "frontend.test-skill", contract().steps[1].id);
  run = beginStrictStep(run, "frontend.test-skill", contract().steps[2].id);
  run = attach(run, "skill-output", contract().steps[2].id, "output");
  run = completeStrictStep(run, "frontend.test-skill", contract().steps[2].id);
  run = verifyStrictSkill(run, "frontend.test-skill", {
    validatorResults: { "core/artifact-integrity": { passed: true } },
  });
  assert.equal(run.skillLedgers[0].outcome, "used");
  assert.equal(finalizeStrictRun(run).state, "verified");
});

test("derives no-op and blocked ledgers before execution and blocks aggregate certification", () => {
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
  assert.equal(finalizeStrictRun(run).state, "blocked");
});

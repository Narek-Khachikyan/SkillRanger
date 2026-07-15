import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  StrictSkillRunError,
  StrictSkillRunStore,
  beginStrictStep,
  completeStrictStep,
  createContentChunks,
  createStrictSkillRun,
  readNextStrictChunk,
  type ExecutionContractV2,
} from "../src/runtime/strict/index.ts";

const sha = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const contract: ExecutionContractV2 = {
  schemaVersion: "2.0", skillId: "frontend.store-test", contractVersion: "2.0.0",
  inputSchema: "input.schema.json", outputSchema: "output.schema.json", mustRead: ["SKILL.md"],
  applicability: { op: "tag", value: "frontend" }, prerequisites: [], maxRepairIterations: 1,
  rules: [{ id: "frontend.store-test/rule/evidence", description: "Record evidence." }],
  steps: [{ id: "frontend.store-test/step/collect", type: "collect", requiredEvidenceKinds: ["report"], ruleIds: ["frontend.store-test/rule/evidence"] }],
  gates: [
    { id: "frontend.store-test/gate/report", level: "hard", evaluator: { type: "evidence-present", evidenceKind: "report" }, ruleIds: ["frontend.store-test/rule/evidence"] },
    { id: "frontend.store-test/gate/output", level: "hard", evaluator: { type: "schema-valid", schema: "output" }, ruleIds: ["frontend.store-test/rule/evidence"] },
  ],
};

const fixtureRun = () => createStrictSkillRun({
  runId: "run_strict_store", domain: "frontend", targetAgent: "codex", locale: "en",
  intent: { sha256: sha("store"), normalizedGoal: "store evidence" }, now: "2026-07-15T10:00:00.000Z",
  selectedSkills: [{
    skillId: contract.skillId, role: "primary", mandatory: true, version: "1.0.0",
    packageChecksum: sha("package"), contractChecksum: sha(JSON.stringify(contract)), contract,
    schemaSnapshots: { input: { type: "object" }, output: { type: "object" } },
    schemaChecksums: { input: sha(JSON.stringify({ type: "object" })), output: sha(JSON.stringify({ type: "object" })) },
    contentChunks: createContentChunks("SKILL.md", "# Store Test\n"), applicable: true, unmetPrerequisites: [],
  }],
});

test("strict store writes atomically and rejects a tampered persisted content snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-store-"));
  const store = new StrictSkillRunStore(root);
  const run = fixtureRun();
  await store.create(run);
  assert.deepEqual(await store.read(run.runId), run);

  const runPath = path.join(root, ".skillranger", "runs", `${run.runId}.json`);
  const tampered = JSON.parse(await readFile(runPath, "utf8"));
  tampered.skillLedgers[0].contentChunks[0].content = "mutated";
  await writeFile(runPath, `${JSON.stringify(tampered)}\n`);
  await assert.rejects(store.read(run.runId), (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity");
});

test("rejects a persisted used outcome without completed steps and verification", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-forged-used-"));
  const store = new StrictSkillRunStore(root);
  const run = fixtureRun();
  await store.create(run);

  const runPath = path.join(root, ".skillranger", "runs", `${run.runId}.json`);
  const forged = JSON.parse(await readFile(runPath, "utf8"));
  forged.skillLedgers[0].state = "used";
  forged.skillLedgers[0].outcome = "used";
  await writeFile(runPath, `${JSON.stringify(forged)}\n`);

  await assert.rejects(
    store.read(run.runId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
  );
});

test("ingests immutable evidence and binds it to the active step", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-evidence-"));
  const source = path.join(root, "reports", "report.json");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, "{}\n");
  const store = new StrictSkillRunStore(root);
  let run = fixtureRun();
  run = readNextStrictChunk(run, contract.skillId).run;
  run = beginStrictStep(run, contract.skillId, contract.steps[0].id);
  await store.create(run);

  run = await store.ingestEvidence(run.runId, {
    sourcePath: source,
    kind: "report",
    validatedAs: "output",
    attributions: [{ skillId: contract.skillId, stepId: contract.steps[0].id, attempt: 1, relation: "produced", ruleIds: contract.rules.map(({ id }) => id) }],
  });
  const artifact = run.artifacts[0];
  assert.equal(artifact.sha256, sha("{}\n"));
  await writeFile(source, "mutated source\n");
  assert.equal(await readFile(path.join(root, artifact.path), "utf8"), "{}\n");
});

test("rejects evidence falsely declared as schema-validated", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-evidence-schema-"));
  const source = path.join(root, "invalid.json");
  await writeFile(source, "not json\n");
  const store = new StrictSkillRunStore(root);
  let run = fixtureRun();
  run = beginStrictStep(readNextStrictChunk(run, contract.skillId).run, contract.skillId, contract.steps[0].id);
  await store.create(run);
  await assert.rejects(store.ingestEvidence(run.runId, {
    sourcePath: source, kind: "report", validatedAs: "output",
    attributions: [{ skillId: contract.skillId, stepId: contract.steps[0].id, attempt: 1, relation: "produced", ruleIds: contract.rules.map(({ id }) => id) }],
  }), (error: unknown) => error instanceof StrictSkillRunError && error.code === "artifact-integrity");
});

test("derives verification gates inside the runtime from immutable artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-verify-runtime-"));
  const source = path.join(root, "report.json");
  await writeFile(source, "{}\n");
  const store = new StrictSkillRunStore(root);
  let run = beginStrictStep(readNextStrictChunk(fixtureRun(), contract.skillId).run, contract.skillId, contract.steps[0].id);
  await store.create(run);
  run = await store.ingestEvidence(run.runId, {
    sourcePath: source, kind: "report", validatedAs: "output",
    attributions: [{ skillId: contract.skillId, stepId: contract.steps[0].id, attempt: 1, relation: "produced", ruleIds: contract.rules.map(({ id }) => id) }],
  });
  run = await store.update(run.runId, (current) => completeStrictStep(current, contract.skillId, contract.steps[0].id));
  run = await store.verifySkill(run.runId, contract.skillId);
  assert.equal(run.skillLedgers[0].outcome, "used");
  assert.equal(run.skillLedgers[0].verificationReports[0].hardPassed, true);
});

test("rejects changed evidence even when the contract omits an integrity gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-evidence-mutated-"));
  const source = path.join(root, "report.json");
  await writeFile(source, "{}\n");
  const store = new StrictSkillRunStore(root);
  let run = beginStrictStep(readNextStrictChunk(fixtureRun(), contract.skillId).run, contract.skillId, contract.steps[0].id);
  await store.create(run);
  run = await store.ingestEvidence(run.runId, {
    sourcePath: source,
    kind: "report",
    validatedAs: "output",
    attributions: [{ skillId: contract.skillId, stepId: contract.steps[0].id, attempt: 1, relation: "produced", ruleIds: contract.rules.map(({ id }) => id) }],
  });
  await writeFile(path.join(root, run.artifacts[0].path), "changed\n");
  run = await store.update(run.runId, (current) => completeStrictStep(current, contract.skillId, contract.steps[0].id));

  await assert.rejects(
    store.verifySkill(run.runId, contract.skillId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "artifact-integrity",
  );
});

test("rejects symlink evidence before creating an artifact", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-evidence-link-"));
  const real = path.join(root, "real.txt");
  const link = path.join(root, "link.txt");
  await writeFile(real, "evidence");
  await symlink(real, link);
  const store = new StrictSkillRunStore(root);
  let run = fixtureRun();
  run = readNextStrictChunk(run, contract.skillId).run;
  run = beginStrictStep(run, contract.skillId, contract.steps[0].id);
  await store.create(run);

  await assert.rejects(store.ingestEvidence(run.runId, {
    sourcePath: link, kind: "report",
    attributions: [{ skillId: contract.skillId, stepId: contract.steps[0].id, attempt: 1, relation: "produced", ruleIds: contract.rules.map(({ id }) => id) }],
  }), (error: unknown) => error instanceof StrictSkillRunError && error.code === "artifact-integrity");
});

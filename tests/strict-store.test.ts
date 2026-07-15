import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
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
  type EvidenceArtifact,
  type ExecutionContractV2,
} from "../src/runtime/strict/index.ts";
import { deriveBrowserGateResults, deriveTailwindSourceResults } from "../src/runtime/strict/frontend-evidence.ts";

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

const domainValidatorContract: ExecutionContractV2 = {
  ...contract,
  gates: [...contract.gates, {
    id: "frontend.store-test/gate/domain-validator",
    level: "hard",
    evaluator: { type: "validator", validatorId: "frontend/performance-claims" },
    ruleIds: ["frontend.store-test/rule/evidence"],
  }],
};

const fixtureRun = (executionContract = contract) => createStrictSkillRun({
  runId: "run_strict_store", domain: "frontend", targetAgent: "codex", locale: "en",
  intent: { sha256: sha("store"), normalizedGoal: "store evidence" }, now: "2026-07-15T10:00:00.000Z",
  selectedSkills: [{
    skillId: executionContract.skillId, role: "primary", mandatory: true, version: "1.0.0",
    packageChecksum: sha("package"), contractChecksum: sha(JSON.stringify(executionContract)), contract: executionContract,
    schemaSnapshots: { input: { type: "object" }, output: { type: "object" } },
    schemaChecksums: { input: sha(JSON.stringify({ type: "object" })), output: sha(JSON.stringify({ type: "object" })) },
    contentChunks: createContentChunks("SKILL.md", "# Store Test\n"), applicable: true, unmetPrerequisites: [],
  }],
});

const stageCompletedEvidence = async (
  root: string,
  store: StrictSkillRunStore,
  executionContract = contract,
) => {
  const source = path.join(root, "report.json");
  await writeFile(source, "{}\n");
  let run = beginStrictStep(
    readNextStrictChunk(fixtureRun(executionContract), executionContract.skillId).run,
    executionContract.skillId,
    executionContract.steps[0].id,
  );
  await store.create(run);
  run = await store.ingestEvidence(run.runId, {
    sourcePath: source,
    kind: "report",
    validatedAs: "output",
    attributions: [{
      skillId: executionContract.skillId,
      stepId: executionContract.steps[0].id,
      attempt: 1,
      relation: "produced",
      ruleIds: executionContract.rules.map(({ id }) => id),
    }],
  });
  return store.update(run.runId, (current) => completeStrictStep(current, executionContract.skillId, executionContract.steps[0].id));
};

const redirectArtifactParentOutsideRoot = async (root: string, run: Awaited<ReturnType<typeof stageCompletedEvidence>>) => {
  const artifactParent = path.dirname(path.join(root, run.artifacts[0].path));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "strict-evidence-outside-"));
  const outsideArtifacts = path.join(outsideRoot, "artifacts");
  await rename(artifactParent, outsideArtifacts);
  await symlink(outsideArtifacts, artifactParent, "dir");
};

const browserObservation = (width: number) => ({
  viewport: { width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 },
  state: "default",
  screenshotPath: `evidence/${width}.png`,
  horizontalOverflow: false,
  clippedControls: [],
  unreachableActions: [],
  stickyOverlaps: [],
  consoleErrors: [],
  keyboardTraps: [],
  invisibleFocus: [],
  criticalAxeViolations: [],
  reducedMotionVerified: true,
});
const browserArtifacts = [390, 768, 1440].map((width) => ({
  kind: `browser-screenshot-${width}`,
  sourcePath: `evidence/${width}.png`,
})) as EvidenceArtifact[];

test("derives browser gates only from closed observations bound to screenshot evidence", () => {
  const observations = [390, 768, 1440].map(browserObservation);
  const valid = deriveBrowserGateResults({ observations }, browserArtifacts);
  assert.equal(Object.keys(valid).length, 7);
  assert.ok(Object.values(valid).every(({ passed }) => passed));

  const forged = deriveBrowserGateResults({ checks: { "required-states-covered": true } }, browserArtifacts);
  assert.ok(Object.values(forged).every(({ passed, message }) => !passed && /valid browser observations/i.test(message ?? "")));

  const unbound = deriveBrowserGateResults({ observations: observations.map((item, index) => index === 0 ? { ...item, screenshotPath: "evidence/unbound.png" } : item) }, browserArtifacts);
  assert.ok(Object.values(unbound).every(({ passed, message }) => !passed && /not bound/i.test(message ?? "")));

  const openShape = deriveBrowserGateResults({ observations: [{ ...observations[0], callerApproved: true }, ...observations.slice(1)] }, browserArtifacts);
  assert.ok(Object.values(openShape).every(({ passed }) => !passed));
});

test("rejects reuse of one screenshot across required browser viewports", () => {
  const observations = [390, 768, 1440].map((width) => ({
    ...browserObservation(width),
    screenshotPath: "evidence/shared.png",
  }));
  const artifacts = [390, 768, 1440].map((width) => ({
    kind: `browser-screenshot-${width}`,
    sourcePath: "evidence/shared.png",
  })) as EvidenceArtifact[];

  const results = deriveBrowserGateResults({ observations }, artifacts);

  assert.ok(Object.values(results).every(({ passed, message }) => !passed && /distinct screenshot/i.test(message ?? "")));
});

test("binds each browser observation viewport to its screenshot artifact kind", () => {
  const observations = [390, 768, 1440].map(browserObservation);
  const mismatched = browserArtifacts.map((artifact, index) => ({
    ...artifact,
    kind: `browser-screenshot-${[768, 390, 1440][index]}`,
  }));

  const results = deriveBrowserGateResults({ observations }, mismatched);

  assert.ok(Object.values(results).every(({ passed, message }) => !passed && /not bound/i.test(message ?? "")));
});

test("derives Tailwind source gates from staged source text instead of checks claims", () => {
  const dynamic = deriveTailwindSourceResults('{"checks":{"no-dynamic-tailwind-classes":true},"diff":"+ <div className={`p-4 bg-${color}-600`}>"}');
  assert.equal(dynamic["no-dynamic-tailwind-classes"].passed, false);

  const staticSource = deriveTailwindSourceResults('+ <div className="bg-brand-600 text-on-brand">Save</div>');
  assert.equal(staticSource["no-dynamic-tailwind-classes"].passed, true);
  assert.equal(staticSource["repeated-class-bundles-reviewed"].passed, true);

  const conflicting = deriveTailwindSourceResults('+ <div className="block flex">Save</div>');
  assert.equal(conflicting["repeated-class-bundles-reviewed"].passed, false);
});

test("detects dynamic Tailwind templates in first and later class positions", () => {
  const first = deriveTailwindSourceResults('<div className={`bg-${color}-600`}>Save</div>');
  const later = deriveTailwindSourceResults('<div className={`p-4 bg-${color}-600`}>Save</div>');

  assert.equal(first["no-dynamic-tailwind-classes"].passed, false);
  assert.equal(later["no-dynamic-tailwind-classes"].passed, false);
});

test("validates only added content in a unified implementation diff", () => {
  const results = deriveTailwindSourceResults(`diff --git a/Card.tsx b/Card.tsx
--- a/Card.tsx
+++ b/Card.tsx
@@ -1 +1 @@
-<div className={\`p-4 bg-\${color}-600\`}>Save</div>
+<div className="bg-brand-600">Save</div>
`);

  assert.equal(results["no-dynamic-tailwind-classes"].passed, true);
});

test("derives the raw color advisory from staged source text", () => {
  const results = deriveTailwindSourceResults('<div className="bg-red-500">Save</div>');

  assert.equal(results["raw-colors-reviewed"].passed, false);
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

test("invokes a registered domain validator only after artifact integrity passes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-domain-validator-"));
  let calls = 0;
  const store = new StrictSkillRunStore(root, {
    "frontend/performance-claims": () => { calls += 1; return { passed: true }; },
  });
  const run = await stageCompletedEvidence(root, store, domainValidatorContract);

  const verified = await store.verifySkill(run.runId, domainValidatorContract.skillId);

  assert.equal(verified.skillLedgers[0].outcome, "used");
  assert.equal(calls, 1);
});

test("rejects an artifact reached through an escaping parent symlink before domain validation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-parent-link-"));
  let calls = 0;
  const store = new StrictSkillRunStore(root, {
    "frontend/performance-claims": () => { calls += 1; throw new Error("domain validator invoked"); },
  });
  const run = await stageCompletedEvidence(root, store, domainValidatorContract);
  await redirectArtifactParentOutsideRoot(root, run);

  await assert.rejects(
    store.verifySkill(run.runId, domainValidatorContract.skillId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "artifact-integrity",
  );
  assert.equal(calls, 0);
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

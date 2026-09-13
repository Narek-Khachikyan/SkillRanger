import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SkillRunStore } from "../src/runtime/skill-run/index.ts";
import { createSkillRun } from "../src/runtime/skill-run/reducer.ts";
import type { CreateSkillRunInput, SkillRun } from "../src/runtime/skill-run/types.ts";
import { SkillRunError } from "../src/runtime/skill-run/types.ts";
import {
  StrictSkillRunStore,
  createContentChunks,
  createStrictSkillRun,
} from "../src/runtime/strict/index.ts";
import { StrictSkillRunError } from "../src/runtime/strict/types.ts";
import type { ExecutionContractV2 } from "../src/runtime/strict/types.ts";
import { readPersistedRun } from "../src/runtime/persisted-run.ts";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const contract: ExecutionContractV2 = {
  schemaVersion: "2.0",
  skillId: "frontend.persisted-run-test",
  contractVersion: "2.0.0",
  inputSchema: "input.schema.json",
  outputSchema: "output.schema.json",
  mustRead: ["SKILL.md"],
  applicability: { op: "tag", value: "frontend" },
  prerequisites: [],
  maxRepairIterations: 1,
  rules: [{ id: "frontend.persisted-run-test/rule/evidence", description: "Record evidence." }],
  steps: [{ id: "frontend.persisted-run-test/step/collect", type: "collect", requiredEvidenceKinds: ["report"], ruleIds: ["frontend.persisted-run-test/rule/evidence"] }],
  gates: [
    { id: "frontend.persisted-run-test/gate/report", level: "hard", evaluator: { type: "evidence-present", evidenceKind: "report" }, ruleIds: ["frontend.persisted-run-test/rule/evidence"] },
  ],
};

const fixtureLifecycleInput = (runId: string): CreateSkillRunInput => ({
  runId,
  domain: "frontend",
  targetAgent: "opencode",
  locale: "en",
  intent: { sha256: sha("persisted-run"), normalizedGoal: "persisted run" },
  policy: {
    lifecycleRequired: true,
    mandatorySkillIds: [],
    clarification: { required: false, questions: [] },
    verificationRequired: false,
  },
  now: "2026-07-11T00:00:00.000Z",
});

test("routes a lifecycle-v1 run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "persisted-run-lifecycle-"));
  const runId = "run_persisted_lifecycle";
  const store = new SkillRunStore(root);
  const run = createSkillRun(fixtureLifecycleInput(runId));
  await store.create(run);
  const persisted = await readPersistedRun(root, runId);
  assert.equal(persisted.runtime, "lifecycle-v1");
  assert.equal(persisted.run.runId, runId);
  assert.equal((persisted.run as SkillRun).schemaVersion, "1.0");
});

test("routes a strict-v2 run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "persisted-run-strict-"));
  const runId = "run_persisted_strict";
  const store = new StrictSkillRunStore(root);
  const run = createStrictSkillRun({
    runId,
    domain: "frontend",
    targetAgent: "codex",
    locale: "en",
    intent: { sha256: sha("persisted"), normalizedGoal: "persisted" },
    now: "2026-07-15T10:00:00.000Z",
    selectedSkills: [
      {
        skillId: contract.skillId,
        role: "primary",
        mandatory: true,
        version: "1.0.0",
        packageChecksum: sha("package"),
        contractChecksum: sha(JSON.stringify(contract)),
        contract,
        schemaSnapshots: { input: { type: "object" }, output: { type: "object" } },
        schemaChecksums: { input: sha(JSON.stringify({ type: "object" })), output: sha(JSON.stringify({ type: "object" })) },
        contentChunks: createContentChunks("SKILL.md", "# Test\n"),
        applicable: true,
        unmetPrerequisites: [],
      },
    ],
  });
  await store.create(run);
  const persisted = await readPersistedRun(root, runId);
  assert.equal(persisted.runtime, "strict-v2");
  assert.equal(persisted.run.runId, runId);
  assert.equal(persisted.run.schemaVersion, "2.0");
});

test("rejects an invalid run id", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "persisted-run-invalid-"));
  await assert.rejects(
    () => readPersistedRun(root, "bad!"),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity" && error.message.includes("bad!"),
  );
  await assert.rejects(
    () => readPersistedRun(root, "../outside"),
    (error: unknown) => (error instanceof SkillRunError || error instanceof StrictSkillRunError) && (error as { code: string }).code === "run-integrity",
  );
});

test("maps not-found per runtime", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "persisted-run-notfound-"));
  await assert.rejects(
    () => readPersistedRun(root, "run_notfound_12345"),
    (error: unknown) => error instanceof SkillRunError && error.code === "run-not-found" && error.message === "Skill run not found: run_notfound_12345.",
  );
});

test("maps integrity errors per runtime", async () => {
  // lifecycle: valid JSON but invalid persisted state
  const lifecycleRoot = await mkdtemp(path.join(os.tmpdir(), "persisted-run-lifecycle-integrity-"));
  const lifecycleId = "run_lifecycle_integrity";
  const lifecycleStore = new SkillRunStore(lifecycleRoot);
  const lifecycleRun = createSkillRun(fixtureLifecycleInput(lifecycleId));
  await lifecycleStore.create(lifecycleRun);
  const lifecyclePath = path.join(lifecycleRoot, ".skillranger", "runs", `${lifecycleId}.json`);
  const lifecycleTampered = JSON.parse(await readFile(lifecyclePath, "utf8"));
  lifecycleTampered.revision = -1;
  await writeFile(lifecyclePath, JSON.stringify(lifecycleTampered));
  await assert.rejects(
    () => readPersistedRun(lifecycleRoot, lifecycleId),
    (error: unknown) => error instanceof SkillRunError && error.code === "run-integrity",
  );

  // strict: tampered content chunk
  const strictRoot = await mkdtemp(path.join(os.tmpdir(), "persisted-run-strict-integrity-"));
  const strictId = "run_strict_integrity";
  const strictStore = new StrictSkillRunStore(strictRoot);
  const strictRun = createStrictSkillRun({
    runId: strictId,
    domain: "frontend",
    targetAgent: "codex",
    locale: "en",
    intent: { sha256: sha("strict"), normalizedGoal: "strict" },
    now: "2026-07-15T10:00:00.000Z",
    selectedSkills: [
      {
        skillId: contract.skillId,
        role: "primary",
        mandatory: true,
        version: "1.0.0",
        packageChecksum: sha("package"),
        contractChecksum: sha(JSON.stringify(contract)),
        contract,
        schemaSnapshots: { input: { type: "object" }, output: { type: "object" } },
        schemaChecksums: { input: sha(JSON.stringify({ type: "object" })), output: sha(JSON.stringify({ type: "object" })) },
        contentChunks: createContentChunks("SKILL.md", "# Test\n"),
        applicable: true,
        unmetPrerequisites: [],
      },
    ],
  });
  await strictStore.create(strictRun);
  const strictPath = path.join(strictRoot, ".skillranger", "runs", `${strictId}.json`);
  const strictTampered = JSON.parse(await readFile(strictPath, "utf8"));
  strictTampered.skillLedgers[0].contentChunks[0].content = "mutated";
  await writeFile(strictPath, JSON.stringify(strictTampered));
  await assert.rejects(
    () => readPersistedRun(strictRoot, strictId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
  );

  // invalid persisted JSON (raw) maps to lifecycle integrity
  const invalidRoot = await mkdtemp(path.join(os.tmpdir(), "persisted-run-invalid-json-"));
  const invalidId = "run_invalid_json_123";
  const invalidPath = path.join(invalidRoot, ".skillranger", "runs", `${invalidId}.json`);
  await mkdtemp(path.join(os.tmpdir(), "dummy")); // ensure base exists via mkdir in store path
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(invalidPath), { recursive: true });
  await writeFile(invalidPath, "{ invalid json");
  await assert.rejects(
    () => readPersistedRun(invalidRoot, invalidId),
    (error: unknown) => error instanceof SkillRunError && error.code === "run-integrity" && error.message === `Skill run ${invalidId} is not valid persisted JSON.`,
  );
});

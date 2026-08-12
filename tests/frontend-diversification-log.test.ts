import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import "../src/domains/bundled.ts";
import {
  deriveDiversificationLog,
  diversificationLogPath,
  finalizeStrictRunRefreshingDiversificationLog,
  readDiversificationLog,
  refreshDiversificationLog,
  validateDiversificationLog,
  writeDiversificationLog,
  type DiversificationLog,
} from "../src/domains/frontend/design/index.ts";
import {
  evaluateDiversificationGate,
  designIdentityFingerprint,
  type DesignIdentityFingerprintParts,
} from "../src/domains/frontend/design/index.ts";
import {
  StrictSkillRunStore,
  beginStrictStep,
  completeStrictStep,
  createContentChunks,
  createStrictSkillRun,
  readNextStrictChunk,
  type ExecutionContractV2,
  type SkillRunV2,
  type VerifiedRunDirection,
} from "../src/runtime/strict/index.ts";

const sha = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const direction = (overrides: Partial<{
  macrostructure: string;
  paperBand: string;
  displayStyle: string;
  accentHue: string;
  composition: string;
  material: string;
}> = {}) => ({
  schemaVersion: "1.1",
  recipeId: "developer-tool",
  selectedRuleIds: ["typography.role-contrast", "layout.direction-support", "responsive.recomposition", "color.role-pairing", "state.state-consistency", "signature-move.data-shape"],
  thesis: "Give the operations screen an evidence-forward instrument voice.",
  productReason: "Operators triage live production data under time pressure.",
  axes: {
    density: "balanced",
    hierarchy: "data-first",
    composition: overrides.composition ?? "structured-list",
    material: overrides.material ?? "layered",
    motionIntensity: "low",
    expressionLevel: "restrained",
  },
  macrostructure: overrides.macrostructure ?? "operations-single-pane",
  themeAxes: {
    paperBand: overrides.paperBand ?? "ink",
    displayStyle: overrides.displayStyle ?? "instrument",
    accentHue: overrides.accentHue ?? "ocean",
  },
  typographyRoles: { display: "Instrument Sans", body: "Inter" },
  colorRoles: { surface: "paper", accent: "ocean" },
  signatureMove: "Live metric rows reveal cause chains inline.",
  rejectedDefaults: ["generic SaaS card grid"],
  destructiveCritique: "Dense rows may overwhelm new operators; mitigated by inline severity cues.",
});

const verifiedRun = (runId: string, directionValue: unknown, updatedAt = runId): VerifiedRunDirection => ({
  runId,
  updatedAt,
  directionDigest: sha(JSON.stringify(directionValue)),
  direction: directionValue,
});

const identityOf = (run: VerifiedRunDirection): DesignIdentityFingerprintParts | undefined =>
  validateDiversificationLog(deriveDiversificationLog([run], "2026-08-12T00:00:00.000Z")).entries[0].identity;

test("derivation records identity facts from verified run facts, newest first", () => {
  const log = deriveDiversificationLog([
    verifiedRun("run_prior_0000001", direction({ composition: "grid" }), "2026-08-01T00:00:00.000Z"),
    verifiedRun("run_prior_0000002", direction({ accentHue: "kelp" }), "2026-08-02T00:00:00.000Z"),
  ], "2026-08-12T00:00:00.000Z");
  assert.deepEqual(log, {
    schemaVersion: "1.0",
    kind: "frontend-diversification-log",
    derivedAt: "2026-08-12T00:00:00.000Z",
    source: "verified-run-facts",
    entries: [
      {
        runId: "run_prior_0000002",
        updatedAt: "2026-08-02T00:00:00.000Z",
        directionDigest: sha(JSON.stringify(direction({ accentHue: "kelp" }))),
        identity: {
          macrostructure: "operations-single-pane",
          themeAxes: { paperBand: "ink", displayStyle: "instrument", accentHue: "kelp" },
          composition: "structured-list",
          material: "layered",
        },
      },
      {
        runId: "run_prior_0000001",
        updatedAt: "2026-08-01T00:00:00.000Z",
        directionDigest: sha(JSON.stringify(direction({ composition: "grid" }))),
        identity: {
          macrostructure: "operations-single-pane",
          themeAxes: { paperBand: "ink", displayStyle: "instrument", accentHue: "ocean" },
          composition: "grid",
          material: "layered",
        },
      },
    ],
  });
});

test("derivation is deterministic regardless of input order", () => {
  const a = verifiedRun("run_prior_0000001", direction(), "2026-08-01T00:00:00.000Z");
  const b = verifiedRun("run_prior_0000002", direction({ composition: "grid" }), "2026-08-02T00:00:00.000Z");
  const c = verifiedRun("run_prior_0000003", direction({ material: "flat" }), "2026-08-03T00:00:00.000Z");
  assert.deepEqual(
    deriveDiversificationLog([c, a, b], "2026-08-12T00:00:00.000Z"),
    deriveDiversificationLog([b, c, a], "2026-08-12T00:00:00.000Z"),
  );
  const ordered = deriveDiversificationLog([a, b, c], "2026-08-12T00:00:00.000Z").entries;
  assert.deepEqual(ordered.map(({ runId }) => runId), ["run_prior_0000003", "run_prior_0000002", "run_prior_0000001"]);
});

test("directions without identity content produce entries without an identity field", () => {
  const run = verifiedRun("run_prior_0000001", "not a direction\n");
  const log = deriveDiversificationLog([run], "2026-08-12T00:00:00.000Z");
  assert.equal(log.entries.length, 1);
  assert.deepEqual(log.entries[0], {
    runId: run.runId,
    updatedAt: run.updatedAt,
    directionDigest: run.directionDigest,
  });
  assert.equal("identity" in log.entries[0], false);
  assert.equal(identityOf(run), undefined);
});

test("validation round-trips derived logs and rejects malformed shapes", () => {
  const log = deriveDiversificationLog([
    verifiedRun("run_prior_0000001", direction({ accentHue: "kelp" }), "2026-08-01T00:00:00.000Z"),
  ], "2026-08-12T00:00:00.000Z");
  assert.deepEqual(validateDiversificationLog(JSON.parse(JSON.stringify(log))), log);

  assert.throws(() => validateDiversificationLog({ ...log, schemaVersion: "1.1" }), /schemaVersion/);
  assert.throws(() => validateDiversificationLog({ ...log, kind: "other-log" }), /kind/);
  assert.throws(() => validateDiversificationLog({ ...log, source: "model-written" }), /source/);
  assert.throws(() => validateDiversificationLog({ ...log, derivedAt: "" }), /derivedAt/);
  assert.throws(() => validateDiversificationLog({ ...log, entries: "nope" }), /entries/);

  const brokenEntry = {
    ...log,
    entries: [{ ...log.entries[0], runId: "  " }],
  };
  assert.throws(() => validateDiversificationLog(brokenEntry), /runId/);

  const foreignIdentity = {
    ...log,
    entries: [{ ...log.entries[0], identity: { macrostructure: "hero-split", extraField: "x" } }],
  };
  assert.throws(() => validateDiversificationLog(foreignIdentity), /identity/);

  const canonicalized = validateDiversificationLog(JSON.parse(JSON.stringify(log)));
  assert.equal(canonicalized.entries[0].identity!.macrostructure, "operations-single-pane");
});

test("derivation caps entries at the gate's default snapshot count", () => {
  const runs = [
    verifiedRun("run_prior_0000004", direction({ accentHue: "kelp" }), "2026-08-04T00:00:00.000Z"),
    verifiedRun("run_prior_0000003", direction({ composition: "grid" }), "2026-08-03T00:00:00.000Z"),
    verifiedRun("run_prior_0000002", direction({ material: "flat" }), "2026-08-02T00:00:00.000Z"),
    verifiedRun("run_prior_0000001", direction({ macrostructure: "hero-split" }), "2026-08-01T00:00:00.000Z"),
  ];
  const log = deriveDiversificationLog(runs, "2026-08-12T00:00:00.000Z");
  assert.deepEqual(log.entries.map(({ runId }) => runId), [
    "run_prior_0000004",
    "run_prior_0000003",
    "run_prior_0000002",
  ], "the awareness cache never reports identities outside the gate's comparison window");
  assert.ok(!log.entries.some(({ runId }) => runId === "run_prior_0000001"));
});

test("read returns undefined when the log is absent and degrades on corrupt content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "div-log-read-"));
  assert.equal(await readDiversificationLog(root), undefined);

  await mkdir(path.join(root, ".design"), { recursive: true });
  await writeFile(path.join(root, ".design", "diversification-log.json"), "not json\n");
  assert.equal(await readDiversificationLog(root), undefined, "a corrupt cache degrades to absent");

  await writeFile(
    path.join(root, ".design", "diversification-log.json"),
    JSON.stringify({ schemaVersion: "9.9", kind: "frontend-diversification-log", derivedAt: "x", source: "verified-run-facts", entries: [] }),
  );
  assert.equal(await readDiversificationLog(root), undefined, "a structurally invalid cache degrades to absent");
});

test("refresh writes the log to .design/diversification-log.json and read round-trips it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "div-log-write-"));
  const prior = verifiedRun("run_prior_0000001", direction(), "2026-08-01T00:00:00.000Z");
  const refreshed = await refreshDiversificationLog(root, [prior], "2026-08-12T00:00:00.000Z");

  const raw = await readFile(diversificationLogPath(root), "utf8");
  assert.deepEqual(JSON.parse(raw), refreshed);
  assert.deepEqual(await readDiversificationLog(root), refreshed);
  assert.equal(refreshed.entries.length, 1);
  assert.equal(refreshed.entries[0].runId, "run_prior_0000001");
});

test("tooling refresh derives only verified runs: unverified and blocked runs never appear", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "div-log-store-"));
  const store = new StrictSkillRunStore(root);

  let first = await stageDirectionRun(root, store, "run_divlog_a", direction());
  first = await store.verifySkill(first.runId, contract.skillId);
  assert.equal((await store.finalizeRun(first.runId)).state, "verified");

  let second = await stageDirectionRun(root, store, "run_divlog_b", direction({ accentHue: "kelp" }));
  second = await store.verifySkill(second.runId, contract.skillId);
  assert.equal((await store.finalizeRun(second.runId)).state, "verified");

  const inFlight = await stageDirectionRun(root, store, "run_divlog_c", direction({ composition: "grid" }));
  assert.notEqual(inFlight.state, "verified");

  const log = await refreshDiversificationLog(root, await store.listVerifiedRuns(), "2026-08-12T00:00:00.000Z");
  assert.deepEqual(log.entries.map(({ runId }) => runId), ["run_divlog_b", "run_divlog_a"]);
  assert.deepEqual(log.entries.map(({ identity }) => identity?.themeAxes?.accentHue), ["kelp", "ocean"]);
  assert.ok(!log.entries.some(({ runId }) => runId === "run_divlog_c"));
});

test("the shared finalize helper refreshes the log for frontend runs and skips other domains", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "div-log-helper-"));
  const store = new StrictSkillRunStore(root);

  let frontend = await stageDirectionRun(root, store, "run_divlog_f", direction());
  frontend = await store.verifySkill(frontend.runId, contract.skillId);
  const finalized = await finalizeStrictRunRefreshingDiversificationLog(root, store, frontend.runId);
  assert.equal(finalized.state, "verified");
  assert.deepEqual((await readDiversificationLog(root))?.entries.map(({ runId }) => runId), ["run_divlog_f"]);

  const nonFrontendRun = createStrictSkillRun({
    runId: "run_divlog_perf",
    domain: "performance",
    targetAgent: "codex",
    locale: "en",
    intent: { sha256: sha("run_divlog_perf"), normalizedGoal: "performance run" },
    now: "2026-08-10T00:00:00.000Z",
    selectedSkills: [{
      skillId: contract.skillId,
      role: "primary",
      mandatory: true,
      version: "1.0.0",
      packageChecksum: sha("package"),
      contractChecksum: sha(JSON.stringify(contract)),
      contract,
      schemaSnapshots: { input: { type: "object" }, output: { type: "object" } },
      schemaChecksums: { input: sha(JSON.stringify({ type: "object" })), output: sha(JSON.stringify({ type: "object" })) },
      contentChunks: createContentChunks("SKILL.md", "# Direction Test\n"),
      applicable: false,
      unmetPrerequisites: [],
    }],
  });
  await store.create(nonFrontendRun);
  const nonFrontendFinalized = await finalizeStrictRunRefreshingDiversificationLog(root, store, nonFrontendRun.runId);
  assert.equal(nonFrontendFinalized.state, "verified");
  const logAfter = await readDiversificationLog(root);
  assert.deepEqual(logAfter?.entries.map(({ runId }) => runId), ["run_divlog_f"], "a non-frontend finalize must not rewrite the log");
});

test("the log is not the enforcement mechanism: editing it cannot change gate outcomes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "div-log-not-enforcement-"));
  const prior = verifiedRun("run_prior_0000001", direction(), "2026-08-01T00:00:00.000Z");
  await refreshDiversificationLog(root, [prior], "2026-08-12T00:00:00.000Z");

  const current = direction({ accentHue: "kelp" });
  assert.equal(
    evaluateDiversificationGate({ direction: current, verifiedRuns: [prior], count: 3 }).passed,
    true,
    "the direction deviates from the verified prior run",
  );

  const tampered: DiversificationLog = {
    schemaVersion: "1.0",
    kind: "frontend-diversification-log",
    derivedAt: "2026-08-12T00:00:00.000Z",
    source: "verified-run-facts",
    entries: [{
      runId: prior.runId,
      updatedAt: prior.updatedAt,
      directionDigest: prior.directionDigest,
      identity: {
        macrostructure: "hero-split",
        themeAxes: { paperBand: "chalk", displayStyle: "editorial", accentHue: "kelp" },
        composition: "split-pane",
        material: "flat",
      },
    }],
  };
  await writeDiversificationLog(root, tampered);
  assert.deepEqual(await readDiversificationLog(root), tampered, "the tampered log reads back");

  const replay = evaluateDiversificationGate({ direction: current, verifiedRuns: [prior], count: 3 });
  assert.equal(replay.passed, true, "the gate reads store facts, never the log");
  assert.equal(replay.message, evaluateDiversificationGate({ direction: current, verifiedRuns: [prior], count: 3 }).message);

  const repeating = evaluateDiversificationGate({ direction: direction(), verifiedRuns: [prior], count: 3 });
  assert.equal(repeating.passed, false, "a real repetition still fails regardless of the tampered log");
  assert.deepEqual(designIdentityFingerprint(prior.direction), designIdentityFingerprint(direction()));
});

const contract: ExecutionContractV2 = {
  schemaVersion: "2.0",
  skillId: "frontend.diversification-log-test",
  contractVersion: "2.0.0",
  inputSchema: "input.schema.json",
  outputSchema: "output.schema.json",
  mustRead: ["SKILL.md"],
  applicability: { op: "tag", value: "frontend" },
  prerequisites: [],
  maxRepairIterations: 1,
  rules: [
    { id: "frontend.diversification-log-test/rule/direction", description: "Record a direction." },
    { id: "frontend.diversification-log-test/rule/output", description: "Record the output." },
  ],
  steps: [
    { id: "frontend.diversification-log-test/step/direction", type: "collect", requiredEvidenceKinds: ["design-direction"], ruleIds: ["frontend.diversification-log-test/rule/direction"] },
    { id: "frontend.diversification-log-test/step/report", type: "report", requiredEvidenceKinds: ["skill-output"], ruleIds: ["frontend.diversification-log-test/rule/output"] },
  ],
  gates: [
    { id: "frontend.diversification-log-test/gate/direction", level: "hard", evaluator: { type: "evidence-present", evidenceKind: "design-direction" }, ruleIds: ["frontend.diversification-log-test/rule/direction"] },
    { id: "frontend.diversification-log-test/gate/output", level: "hard", evaluator: { type: "schema-valid", schema: "output" }, ruleIds: ["frontend.diversification-log-test/rule/output"] },
  ],
};

const fixtureRun = (runId: string): SkillRunV2 => createStrictSkillRun({
  runId,
  domain: "frontend",
  targetAgent: "codex",
  locale: "en",
  intent: { sha256: sha(runId), normalizedGoal: "direction run" },
  now: "2026-08-10T00:00:00.000Z",
  selectedSkills: [{
    skillId: contract.skillId,
    role: "primary",
    mandatory: true,
    version: "1.0.0",
    packageChecksum: sha("package"),
    contractChecksum: sha(JSON.stringify(contract)),
    contract,
    schemaSnapshots: { input: { type: "object" }, output: { type: "object" } },
    schemaChecksums: { input: sha(JSON.stringify({ type: "object" })), output: sha(JSON.stringify({ type: "object" })) },
    contentChunks: createContentChunks("SKILL.md", "# Direction Test\n"),
    applicable: true,
    unmetPrerequisites: [],
  }],
});

const stageDirectionRun = async (root: string, store: StrictSkillRunStore, runId: string, directionValue: unknown) => {
  let run = beginStrictStep(
    readNextStrictChunk(fixtureRun(runId), contract.skillId).run,
    contract.skillId,
    contract.steps[0].id,
  );
  await store.create(run);
  const directionSource = path.join(root, `${runId}-direction.json`);
  await writeFile(directionSource, JSON.stringify(directionValue));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: directionSource,
    kind: "design-direction",
    attributions: [{
      skillId: contract.skillId,
      stepId: contract.steps[0].id,
      attempt: 1,
      relation: "produced",
      ruleIds: contract.rules.map(({ id }) => id),
    }],
  });
  run = await store.update(run.runId, (current) => completeStrictStep(current, contract.skillId, contract.steps[0].id));
  const outputSource = path.join(root, `${runId}-output.json`);
  await writeFile(outputSource, "{}\n");
  run = await store.update(run.runId, (current) => beginStrictStep(current, contract.skillId, contract.steps[1].id));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: outputSource,
    kind: "skill-output",
    validatedAs: "output",
    attributions: [{
      skillId: contract.skillId,
      stepId: contract.steps[1].id,
      attempt: 1,
      relation: "produced",
      ruleIds: contract.rules.map(({ id }) => id),
    }],
  });
  return store.update(run.runId, (current) => completeStrictStep(current, contract.skillId, contract.steps[1].id));
};

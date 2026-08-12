import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import "../src/domains/bundled.ts";
import {
  evaluateDiversificationGate,
  designIdentityFingerprint,
  designIdentityFingerprintParts,
  defaultDiversificationCount,
  parseDiversificationMessage,
  resolveDesignExecutionPolicy,
  type DiversificationSnapshot,
} from "../src/domains/frontend/design/index.ts";
import {
  StrictSkillRunStore,
  StrictSkillRunError,
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

test("identity fingerprint covers macrostructure, theme axes, composition, and material with trim normalization", () => {
  const parts = designIdentityFingerprintParts(direction());
  assert.deepEqual(parts, {
    macrostructure: "operations-single-pane",
    themeAxes: { paperBand: "ink", displayStyle: "instrument", accentHue: "ocean" },
    composition: "structured-list",
    material: "layered",
  });
  assert.equal(
    designIdentityFingerprint({ ...direction(), macrostructure: "  hero-split  " }),
    designIdentityFingerprint({ ...direction(), macrostructure: "hero-split" }),
  );
  assert.equal(
    designIdentityFingerprint(direction()),
    designIdentityFingerprint({ ...direction() }),
  );
  assert.notEqual(
    designIdentityFingerprint(direction({ composition: "grid" })),
    designIdentityFingerprint(direction()),
  );
});

test("same-fingerprint repetition fails the diversification gate", () => {
  const current = direction();
  const prior = verifiedRun("run_prior_0000001", direction());
  const result = evaluateDiversificationGate({ direction: current, verifiedRuns: [prior], count: 3 });
  assert.equal(result.passed, false);
  assert.deepEqual(result.sameFingerprintRunIds, ["run_prior_0000001"]);
  assert.deepEqual(result.snapshot, { runIds: ["run_prior_0000001"], directionDigests: [prior.directionDigest] });
  assert.equal(parseDiversificationMessage(result.message)?.passed, false);
});

test("deviation on any single identity dimension passes the gate", () => {
  const cases = [
    direction({ macrostructure: "hero-split" }),
    direction({ paperBand: "chalk" }),
    direction({ displayStyle: "editorial" }),
    direction({ accentHue: "kelp" }),
    direction({ composition: "split-pane" }),
    direction({ material: "flat" }),
  ];
  for (const candidate of cases) {
    const result = evaluateDiversificationGate({
      direction: candidate,
      verifiedRuns: [verifiedRun("run_prior_0000001", direction())],
      count: 3,
    });
    assert.equal(result.passed, true, `expected deviation to pass for ${JSON.stringify(designIdentityFingerprintParts(candidate))}`);
    assert.deepEqual(result.sameFingerprintRunIds, []);
  }
});

test("empty verified-run ledger passes and records an empty snapshot", () => {
  const result = evaluateDiversificationGate({ direction: direction(), verifiedRuns: [], count: 3 });
  assert.equal(result.passed, true);
  assert.deepEqual(result.snapshot, { runIds: [], directionDigests: [] });
  assert.deepEqual(result.comparisons, []);
});

test("fewer-than-N verified runs compare against the available set only", () => {
  const result = evaluateDiversificationGate({
    direction: direction({ accentHue: "kelp" }),
    verifiedRuns: [
      verifiedRun("run_prior_0000002", direction(), "2026-08-01T00:00:00.000Z"),
      verifiedRun("run_prior_0000001", direction({ composition: "grid" }), "2026-07-01T00:00:00.000Z"),
    ],
    count: 3,
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.snapshot.runIds, ["run_prior_0000002", "run_prior_0000001"]);
});

test("only the newest N verified runs constrain the gate", () => {
  const current = direction();
  const runs = [
    verifiedRun("run_prior_0000003", direction({ composition: "grid" }), "2026-08-03T00:00:00.000Z"),
    verifiedRun("run_prior_0000002", direction({ accentHue: "kelp" }), "2026-08-02T00:00:00.000Z"),
    verifiedRun("run_prior_0000001", direction({ material: "flat" }), "2026-08-01T00:00:00.000Z"),
    verifiedRun("run_prior_0000000", direction(), "2026-07-31T00:00:00.000Z"),
  ];
  const result = evaluateDiversificationGate({ direction: current, verifiedRuns: runs, count: 3 });
  assert.equal(result.passed, true, "the matching fourth-oldest run must not constrain");
  assert.deepEqual(result.snapshot.runIds, ["run_prior_0000003", "run_prior_0000002", "run_prior_0000001"]);
});

test("a direction without identity content has no fingerprint and cannot pass", () => {
  assert.equal(designIdentityFingerprint("direction\n"), undefined);
  const result = evaluateDiversificationGate({ direction: "direction\n", verifiedRuns: [], count: 3 });
  assert.equal(result.passed, false);
  assert.equal(parseDiversificationMessage(result.message), undefined);
});

test("diversification message serialization round-trips the snapshot", () => {
  const prior = verifiedRun("run_prior_0000001", direction());
  const result = evaluateDiversificationGate({ direction: direction(), verifiedRuns: [prior], count: 3 });
  const parsed = parseDiversificationMessage(result.message);
  assert.ok(parsed);
  assert.deepEqual(parsed, {
    passed: false,
    snapshot: result.snapshot,
    sameFingerprintRunIds: ["run_prior_0000001"],
  });
  assert.equal(parseDiversificationMessage(result.message)!.snapshot.runIds.length, 1);
  assert.equal(parseDiversificationMessage("not json"), undefined);
  assert.equal(parseDiversificationMessage('{"gate":"other"}'), undefined);
});

test("replay re-checks the recorded snapshot and reproduces the identical outcome and message", () => {
  const current = direction();
  const prior = verifiedRun("run_prior_0000001", direction());
  const live = evaluateDiversificationGate({ direction: current, verifiedRuns: [prior], count: 3 });
  assert.equal(live.passed, false);
  const replay = evaluateDiversificationGate({
    direction: current,
    verifiedRuns: [prior],
    count: 3,
    recordedSnapshot: live.snapshot,
  });
  assert.equal(replay.passed, false);
  assert.equal(replay.message, live.message, "replay must reproduce the recorded gate result byte for byte");
  assert.deepEqual(replay.snapshot, live.snapshot);
});

test("a run completing between verify and finalize cannot flip the replayed outcome", () => {
  const current = direction({ accentHue: "kelp" });
  const recordedPrior = verifiedRun("run_prior_0000001", direction(), "2026-08-01T00:00:00.000Z");
  const live = evaluateDiversificationGate({
    direction: current,
    verifiedRuns: [recordedPrior],
    count: 3,
  });
  assert.equal(live.passed, true, "the recorded snapshot must be captured while the direction still deviates");
  const interleaved = verifiedRun("run_prior_0000009", direction({ accentHue: "kelp" }), "2026-08-09T00:00:00.000Z");
  const flippedLive = evaluateDiversificationGate({
    direction: current,
    verifiedRuns: [interleaved, recordedPrior],
    count: 3,
  });
  assert.equal(flippedLive.passed, false, "a live re-derivation after the interleaved run would flip the outcome");
  const replay = evaluateDiversificationGate({
    direction: current,
    verifiedRuns: [interleaved, recordedPrior],
    count: 3,
    recordedSnapshot: live.snapshot,
  });
  assert.equal(replay.passed, true, "replay ignores runs outside the recorded snapshot");
  assert.equal(replay.message, live.message);
});

test("replay fails when a recorded run's direction digest drifted", () => {
  const current = direction();
  const recordedPrior = verifiedRun("run_prior_0000001", direction(), "2026-08-01T00:00:00.000Z");
  const live = evaluateDiversificationGate({ direction: current, verifiedRuns: [recordedPrior], count: 3 });
  assert.equal(live.passed, false);
  const drifted = { ...recordedPrior, directionDigest: sha("changed") };
  const replay = evaluateDiversificationGate({
    direction: current,
    verifiedRuns: [drifted],
    count: 3,
    recordedSnapshot: live.snapshot,
  });
  assert.equal(replay.passed, false);
  assert.notEqual(replay.message, live.message, "drift must surface as a distinct failed re-check");
  assert.match(replay.message, /digest/);
});

test("replay fails when a recorded run is no longer present", () => {
  const current = direction();
  const recordedPrior = verifiedRun("run_prior_0000001", direction());
  const live = evaluateDiversificationGate({ direction: current, verifiedRuns: [recordedPrior], count: 3 });
  assert.equal(live.passed, false);
  const replay = evaluateDiversificationGate({
    direction: current,
    verifiedRuns: [],
    count: 3,
    recordedSnapshot: live.snapshot,
  });
  assert.equal(replay.passed, false);
  assert.match(replay.message, /no longer present/);
});

test("diversification count lives in the execution policy and defaults to 3", () => {
  const ranked = ["developer-tool"];
  const policy = resolveDesignExecutionPolicy({ mode: "explore", profile: "standard", rankedRecipeIds: ranked });
  assert.equal(policy.diversificationCount, 3);
  assert.equal(policy.diversificationCount, defaultDiversificationCount);
  const raised = resolveDesignExecutionPolicy({
    mode: "explore",
    profile: "standard",
    rankedRecipeIds: ranked,
    diversificationCount: 5,
  });
  assert.equal(raised.diversificationCount, 5);
  const invalid = resolveDesignExecutionPolicy({
    mode: "explore",
    profile: "standard",
    rankedRecipeIds: ranked,
    diversificationCount: 0,
  });
  assert.equal(invalid.diversificationCount, 3);
});

const storeContract: ExecutionContractV2 = {
  schemaVersion: "2.0",
  skillId: "frontend.diversification-store-test",
  contractVersion: "2.0.0",
  inputSchema: "input.schema.json",
  outputSchema: "output.schema.json",
  mustRead: ["SKILL.md"],
  applicability: { op: "tag", value: "frontend" },
  prerequisites: [],
  maxRepairIterations: 1,
  rules: [
    { id: "frontend.diversification-store-test/rule/direction", description: "Record a direction." },
    { id: "frontend.diversification-store-test/rule/output", description: "Record the output." },
  ],
  steps: [
    { id: "frontend.diversification-store-test/step/direction", type: "collect", requiredEvidenceKinds: ["design-direction"], ruleIds: ["frontend.diversification-store-test/rule/direction"] },
    { id: "frontend.diversification-store-test/step/report", type: "report", requiredEvidenceKinds: ["skill-output"], ruleIds: ["frontend.diversification-store-test/rule/output"] },
  ],
  gates: [
    { id: "frontend.diversification-store-test/gate/direction", level: "hard", evaluator: { type: "evidence-present", evidenceKind: "design-direction" }, ruleIds: ["frontend.diversification-store-test/rule/direction"] },
    { id: "frontend.diversification-store-test/gate/output", level: "hard", evaluator: { type: "schema-valid", schema: "output" }, ruleIds: ["frontend.diversification-store-test/rule/output"] },
  ],
};

const gatedContract: ExecutionContractV2 = {
  ...storeContract,
  gates: [...storeContract.gates, {
    id: "frontend.diversification-store-test/gate/identity-diversification",
    level: "hard",
    evaluator: { type: "validator", validatorId: "frontend/identity-diversification" },
    ruleIds: ["frontend.diversification-store-test/rule/direction"],
  }],
};

const fixtureRun = (executionContract: ExecutionContractV2, runId: string, now: string): SkillRunV2 =>
  createStrictSkillRun({
    runId,
    domain: "frontend",
    targetAgent: "codex",
    locale: "en",
    intent: { sha256: sha(runId), normalizedGoal: "direction run" },
    now,
    selectedSkills: [{
      skillId: executionContract.skillId,
      role: "primary",
      mandatory: true,
      version: "1.0.0",
      packageChecksum: sha("package"),
      contractChecksum: sha(JSON.stringify(executionContract)),
      contract: executionContract,
      schemaSnapshots: { input: { type: "object" }, output: { type: "object" } },
      schemaChecksums: { input: sha(JSON.stringify({ type: "object" })), output: sha(JSON.stringify({ type: "object" })) },
      contentChunks: createContentChunks("SKILL.md", "# Direction Test\n"),
      applicable: true,
      unmetPrerequisites: [],
    }],
  });

const stageDirectionRun = async (root: string, store: StrictSkillRunStore, runId: string, directionValue: unknown) => {
  let run = beginStrictStep(
    readNextStrictChunk(fixtureRun(gatedContract, runId, "2026-08-10T00:00:00.000Z"), gatedContract.skillId).run,
    gatedContract.skillId,
    gatedContract.steps[0].id,
  );
  await store.create(run);
  const directionSource = path.join(root, `${runId}-direction.json`);
  await writeFile(directionSource, JSON.stringify(directionValue));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: directionSource,
    kind: "design-direction",
    attributions: [{
      skillId: gatedContract.skillId,
      stepId: gatedContract.steps[0].id,
      attempt: 1,
      relation: "produced",
      ruleIds: gatedContract.rules.map(({ id }) => id),
    }],
  });
  run = await store.update(run.runId, (current) => completeStrictStep(current, gatedContract.skillId, gatedContract.steps[0].id));
  const outputSource = path.join(root, `${runId}-output.json`);
  await writeFile(outputSource, "{}\n");
  run = await store.update(run.runId, (current) => beginStrictStep(current, gatedContract.skillId, gatedContract.steps[1].id));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: outputSource,
    kind: "skill-output",
    validatedAs: "output",
    attributions: [{
      skillId: gatedContract.skillId,
      stepId: gatedContract.steps[1].id,
      attempt: 1,
      relation: "produced",
      ruleIds: gatedContract.rules.map(({ id }) => id),
    }],
  });
  return store.update(run.runId, (current) => completeStrictStep(current, gatedContract.skillId, gatedContract.steps[1].id));
};

test("store verified-runs enumeration returns only verified runs with directions, newest first", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-verified-enum-"));
  const store = new StrictSkillRunStore(root);

  let run = await stageDirectionRun(root, store, "run_diversif_a", direction({ accentHue: "kelp" }));
  await store.verifySkill(run.runId, gatedContract.skillId);
  await store.finalizeRun(run.runId);

  run = await stageDirectionRun(root, store, "run_diversif_b", direction({ composition: "grid" }));
  await store.verifySkill(run.runId, gatedContract.skillId);
  await store.finalizeRun(run.runId);

  const unverified = await stageDirectionRun(root, store, "run_diversif_c", direction({ material: "flat" }));
  assert.notEqual(unverified.state, "verified");

  const listed = await store.listVerifiedRuns();
  assert.deepEqual(listed.map(({ runId }) => runId), ["run_diversif_b", "run_diversif_a"]);
  assert.equal(listed[0].directionDigest, sha(JSON.stringify(direction({ composition: "grid" }))));
  assert.deepEqual(designIdentityFingerprintParts(listed[0].direction), designIdentityFingerprintParts(direction({ composition: "grid" })));
  assert.deepEqual(listed[1].directionDigest, sha(JSON.stringify(direction({ accentHue: "kelp" }))));
});

test("store enumeration excludes verified runs without a direction and corrupt direction blobs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-verified-enum-edge-"));
  const store = new StrictSkillRunStore(root);

  let run = await stageDirectionRun(root, store, "run_diversif_a", direction());
  run = await store.verifySkill(run.runId, gatedContract.skillId);
  await store.finalizeRun(run.runId);
  const directionArtifact = run.artifacts.find(({ kind }) => kind === "design-direction")!;
  await writeFile(path.join(root, directionArtifact.path), "corrupted\n");

  run = await stageDirectionRun(root, store, "run_diversif_b", direction({ accentHue: "kelp" }));
  run = await store.verifySkill(run.runId, gatedContract.skillId);
  await store.finalizeRun(run.runId);

  const listed = await store.listVerifiedRuns();
  assert.deepEqual(listed.map(({ runId }) => runId), ["run_diversif_b"]);
});

test("store enumeration returns an empty list for an empty runs directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-verified-enum-empty-"));
  const store = new StrictSkillRunStore(root);
  assert.deepEqual(await store.listVerifiedRuns(), []);
});

test("an unverified-only ledger passes the gate: unverified runs never constrain", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-diversif-unverified-"));
  const store = new StrictSkillRunStore(root);

  // An in-flight run with a direction identical to the certified run's direction is NOT verified,
  // so it must not appear in the comparison set.
  await stageDirectionRun(root, store, "run_diversif_inflight", direction());

  let certified = await stageDirectionRun(root, store, "run_diversif_cert", direction());
  certified = await store.verifySkill(certified.runId, gatedContract.skillId);
  assert.equal(certified.skillLedgers[0].outcome, "used");
  const gateResult = certified.skillLedgers[0].verificationReports.at(-1)!.gateResults
    .find(({ gateId }) => gateId === "frontend.diversification-store-test/gate/identity-diversification")!;
  assert.equal(gateResult.passed, true);
  assert.deepEqual(parseDiversificationMessage(gateResult.message!)?.snapshot, { runIds: [], directionDigests: [] });
  assert.equal((await store.finalizeRun(certified.runId)).state, "verified");
});

test("diversification gate records the comparison snapshot in the verification report and finalization replays it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-diversif-e2e-"));
  const store = new StrictSkillRunStore(root);

  let first = await stageDirectionRun(root, store, "run_diversif_1", direction());
  first = await store.verifySkill(first.runId, gatedContract.skillId);
  assert.equal(first.skillLedgers[0].outcome, "used");
  assert.equal((await store.finalizeRun(first.runId)).state, "verified");

  let second = await stageDirectionRun(root, store, "run_diversif_2", direction({ accentHue: "kelp" }));
  second = await store.verifySkill(second.runId, gatedContract.skillId);
  assert.equal(second.skillLedgers[0].outcome, "used");
  const gateResult = second.skillLedgers[0].verificationReports.at(-1)!.gateResults
    .find(({ gateId }) => gateId === "frontend.diversification-store-test/gate/identity-diversification")!;
  assert.equal(gateResult.passed, true);
  const recorded = parseDiversificationMessage(gateResult.message!);
  assert.ok(recorded);
  assert.deepEqual(recorded.snapshot, {
    runIds: ["run_diversif_1"],
    directionDigests: [sha(JSON.stringify(direction()))],
  });

  const finalized = await store.finalizeRun(second.runId);
  assert.equal(finalized.state, "verified");
});

test("a run completing between verify and finalize cannot flip the gate outcome", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-diversif-flip-"));
  const store = new StrictSkillRunStore(root);

  let first = await stageDirectionRun(root, store, "run_diversif_1", direction());
  first = await store.verifySkill(first.runId, gatedContract.skillId);
  assert.equal((await store.finalizeRun(first.runId)).state, "verified");

  // Second run repeats nothing yet: it deviates from run 1, so its gate passes and records the
  // snapshot [run 1]. It stays unfinalized while a third run completes.
  let second = await stageDirectionRun(root, store, "run_diversif_2", direction({ accentHue: "kelp" }));
  second = await store.verifySkill(second.runId, gatedContract.skillId);
  assert.equal(second.skillLedgers[0].outcome, "used");
  const recordedSnapshot = parseDiversificationMessage(
    second.skillLedgers[0].verificationReports.at(-1)!.gateResults
      .find(({ gateId }) => gateId === "frontend.diversification-store-test/gate/identity-diversification")!.message!,
  )!.snapshot as DiversificationSnapshot;
  assert.deepEqual(recordedSnapshot.runIds, ["run_diversif_1"]);

  // A third run with the same identity as run 2 completes and verifies between run 2's verify and
  // finalize. A live re-derivation would now compare run 2 against run 3 (same identity) and flip
  // the gate; the recorded snapshot keeps the outcome stable.
  let third = await stageDirectionRun(root, store, "run_diversif_3", direction({ accentHue: "kelp" }));
  third = await store.verifySkill(third.runId, gatedContract.skillId);
  assert.equal(third.skillLedgers[0].outcome, "used");
  assert.equal((await store.finalizeRun(third.runId)).state, "verified");

  const replayed = await store.finalizeRun(second.runId);
  assert.equal(replayed.state, "verified");
});

test("finalization re-check rejects when a recorded snapshot's run drifted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-diversif-drift-"));
  const store = new StrictSkillRunStore(root);

  let first = await stageDirectionRun(root, store, "run_diversif_1", direction());
  first = await store.verifySkill(first.runId, gatedContract.skillId);
  assert.equal((await store.finalizeRun(first.runId)).state, "verified");

  let second = await stageDirectionRun(root, store, "run_diversif_2", direction({ accentHue: "kelp" }));
  second = await store.verifySkill(second.runId, gatedContract.skillId);
  assert.equal(second.skillLedgers[0].outcome, "used");

  const directionArtifact = first.artifacts.find(({ kind }) => kind === "design-direction")!;
  await writeFile(path.join(root, directionArtifact.path), "tampered\n");

  await assert.rejects(
    store.finalizeRun(second.runId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
  );
});

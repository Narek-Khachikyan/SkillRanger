import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type {
  DesignVariantMetadata,
  VisualCriticReport,
  VisualRun,
  VisualRunEvent,
} from "../src/domains/frontend/design/index.ts";
import {
  allowedVisualRunEvents,
  applyVisualRunEvent,
  createVisualRun,
  resolveDesignExecutionPolicy,
} from "../src/domains/frontend/design/index.ts";

const constrained = resolveDesignExecutionPolicy({
  mode: "refine",
  profile: "constrained",
  rankedRecipeIds: ["developer-tool"],
});
const standard = resolveDesignExecutionPolicy({
  mode: "explore",
  profile: "standard",
  rankedRecipeIds: ["saas-workspace", "developer-tool"],
});

const event = (sequence: number) => ({
  id: String(sequence),
  at: `2026-07-14T00:00:${String(sequence).padStart(2, "0")}Z`,
});

const runThroughCritique = (
  policy = constrained,
  repairFindingCount = 1,
) => {
  const variantIds = policy.variantLimit === 1 ? ["v1"] : ["v1", "v2"];
  let run = createVisualRun({ id: "run-path", policyPath: ".design/execution-policy.json" });
  run = applyVisualRunEvent(run, { type: "directions-validated", ...event(1), variantIds }, policy);
  run = applyVisualRunEvent(run, {
    type: "implementation-recorded",
    ...event(2),
    variantId: "v1",
    implementationArtifact: "git-diff:initial",
  }, policy);
  run = applyVisualRunEvent(run, { type: "initial-evidence-recorded", ...event(3), evidenceId: "e1" }, policy);
  return applyVisualRunEvent(run, {
    type: "critique-recorded",
    ...event(4),
    critiqueId: "c1",
    selectedVariantId: "v1",
    repairFindingCount,
  }, policy);
};

test("exports immutable visual orchestration artifacts", () => {
  const variant: DesignVariantMetadata = {
    schemaVersion: "1.0",
    id: "variant-a",
    recipeId: "saas-workspace",
    directionPath: ".design/variants/variant-a/direction.json",
    ruleIds: ["layout.list-detail", "state.recovery-first"],
    createdOrder: 1,
    generatorActorId: "generator-1",
    implementationArtifact: "git-diff:abc",
    evidenceIds: ["evidence-initial-a"],
  };
  const run: VisualRun = {
    schemaVersion: "1.0",
    id: "visual-run-1",
    policyPath: ".design/execution-policy.json",
    state: "implemented",
    variantIds: [variant.id],
    artifacts: {},
    history: [{ state: "policy-resolved", at: "2026-07-14T00:00:00.000Z" }],
  };
  assert.equal(run.state, "implemented");
});

test("publishes visual variant, critic, and run schemas", async () => {
  const manifest = JSON.parse(await readFile("domains/frontend/domain.manifest.json", "utf8"));
  for (const file of ["design-variant", "visual-critic-report", "visual-run"]) {
    assert.ok(manifest.artifacts.schemas.includes(`schemas/${file}.schema.json`));
  }
});

test("visual contracts are strict and bound critic scores", async () => {
  const [variantSchema, criticSchema, runSchema] = await Promise.all(
    ["design-variant", "visual-critic-report", "visual-run"].map(async (file) =>
      JSON.parse(await readFile(`domains/frontend/schemas/${file}.schema.json`, "utf8")),
    ),
  );
  assert.equal(variantSchema.additionalProperties, false);
  assert.equal(variantSchema.properties.evidenceIds.uniqueItems, true);
  assert.equal(criticSchema.additionalProperties, false);
  assert.equal(criticSchema.properties.candidateVariantIds.uniqueItems, true);
  assert.equal(criticSchema.properties.evidenceIds.uniqueItems, true);
  assert.equal(criticSchema.$defs.score.minimum, 0);
  assert.equal(criticSchema.$defs.score.maximum, 1);
  assert.equal(criticSchema.properties.confidence.minimum, 0);
  assert.equal(criticSchema.properties.confidence.maximum, 1);
  assert.equal(runSchema.additionalProperties, false);
  assert.equal(runSchema.properties.variantIds.uniqueItems, true);
  assert.equal(runSchema.properties.critiqueRepairFindingCount.type, "integer");
  assert.equal(runSchema.properties.critiqueRepairFindingCount.minimum, 0);
});

test("verification events retain their report artifact path", () => {
  const event: VisualRunEvent = {
    id: "event-verification-1",
    at: "2026-07-14T00:01:00.000Z",
    type: "verification-recorded",
    outcome: "verified",
    reportPath: ".design/verification-report.json",
  };
  assert.equal(event.reportPath, ".design/verification-report.json");
});

test("requires the complete constrained visual correction path and retains artifacts", () => {
  let run = runThroughCritique(constrained, 0);
  const beforeInvalid = structuredClone(run);
  assert.throws(
    () => applyVisualRunEvent(run, { type: "no-repair-needed", ...event(5) }, constrained),
    /constrained requires a corrective pass/,
  );
  assert.deepEqual(run, beforeInvalid);

  run = applyVisualRunEvent(run, { type: "repair-requested", ...event(6), repairId: "r1" }, constrained);
  run = applyVisualRunEvent(run, {
    type: "repair-recorded",
    ...event(7),
    repairId: "r1",
    implementationArtifact: "git-diff:repair",
  }, constrained);
  assert.throws(
    () => applyVisualRunEvent(run, { type: "recheck-evidence-recorded", ...event(8), evidenceId: "e1" }, constrained),
    /fresh evidence/,
  );
  run = applyVisualRunEvent(run, { type: "recheck-evidence-recorded", ...event(9), evidenceId: "e2" }, constrained);
  run = applyVisualRunEvent(run, {
    type: "final-audit-recorded",
    ...event(10),
    reportPath: ".design/final-audit.json",
  }, constrained);
  assert.equal(run.artifacts.verificationReportPath, ".design/final-audit.json");
  run = applyVisualRunEvent(run, {
    type: "verification-recorded",
    ...event(11),
    outcome: "verified",
    reportPath: ".design/verification-report.json",
  }, constrained);

  assert.equal(run.state, "verified");
  assert.equal(run.selectedVariantId, "v1");
  assert.equal(run.critiqueRepairFindingCount, 0);
  assert.deepEqual(run.artifacts, {
    initialEvidenceId: "e1",
    critiqueId: "c1",
    repairId: "r1",
    recheckEvidenceId: "e2",
    verificationReportPath: ".design/verification-report.json",
  });
  assert.equal(run.history.length, 10);
});

test("allows the standard no-repair branch only for a critique with zero findings", () => {
  let run = runThroughCritique(standard, 0);
  run = applyVisualRunEvent(run, { type: "no-repair-needed", ...event(5) }, standard);
  run = applyVisualRunEvent(run, { type: "recheck-evidence-recorded", ...event(6), evidenceId: "e2" }, standard);
  assert.equal(run.state, "recheck-evidence-captured");

  const findingsRun = runThroughCritique(standard, 2);
  assert.throws(
    () => applyVisualRunEvent(findingsRun, { type: "no-repair-needed", ...event(5) }, standard),
    /zero repair findings/,
  );
});

test("rejects variant counts and duplicate variant ids that disagree with policy", () => {
  const run = createVisualRun({ id: "run-count", policyPath: ".design/execution-policy.json" });
  for (const variantIds of [["v1"], ["v1", "v1"]]) {
    const before = structuredClone(run);
    assert.throws(
      () => applyVisualRunEvent(run, { type: "directions-validated", ...event(1), variantIds }, standard),
      variantIds.length === 1 ? /requires 2 variants/ : /unique variant ids/,
    );
    assert.deepEqual(run, before);
  }
});

test("rejects implementations and critique selections outside the validated variants", () => {
  let run = createVisualRun({ id: "run-membership", policyPath: ".design/execution-policy.json" });
  run = applyVisualRunEvent(run, {
    type: "directions-validated",
    ...event(1),
    variantIds: ["v1", "v2"],
  }, standard);
  assert.throws(() => applyVisualRunEvent(run, {
    type: "implementation-recorded",
    ...event(2),
    variantId: "v3",
    implementationArtifact: "git-diff:initial",
  }, standard), /validated variant/);

  run = applyVisualRunEvent(run, {
    type: "implementation-recorded",
    ...event(2),
    variantId: "v1",
    implementationArtifact: "git-diff:initial",
  }, standard);
  run = applyVisualRunEvent(run, { type: "initial-evidence-recorded", ...event(3), evidenceId: "e1" }, standard);
  assert.throws(() => applyVisualRunEvent(run, {
    type: "critique-recorded",
    ...event(4),
    critiqueId: "c1",
    selectedVariantId: "v3",
    repairFindingCount: 1,
  }, standard), /selected variant/);
});

test("persists and validates the critique finding count for replay", () => {
  const run = runThroughCritique(standard, 0);
  const replayed = JSON.parse(JSON.stringify(run)) as VisualRun;
  const next = applyVisualRunEvent(replayed, { type: "no-repair-needed", ...event(5) }, standard);
  assert.equal(next.state, "no-repair-needed");

  let beforeCritique = createVisualRun({ id: "run-invalid-count", policyPath: "policy.json" });
  beforeCritique = applyVisualRunEvent(beforeCritique, {
    type: "directions-validated", ...event(1), variantIds: ["v1", "v2"],
  }, standard);
  beforeCritique = applyVisualRunEvent(beforeCritique, {
    type: "implementation-recorded", ...event(2), variantId: "v1", implementationArtifact: "diff",
  }, standard);
  beforeCritique = applyVisualRunEvent(beforeCritique, {
    type: "initial-evidence-recorded", ...event(3), evidenceId: "e1",
  }, standard);
  assert.throws(() => applyVisualRunEvent(beforeCritique, {
    type: "critique-recorded",
    ...event(4),
    critiqueId: "c1",
    selectedVariantId: "v1",
    repairFindingCount: -1,
  }, standard), /non-negative integer/);
});

test("rejects skipped stages and leaves the original run unchanged", () => {
  const run = createVisualRun({ id: "run-skip", policyPath: ".design/execution-policy.json" });
  const before = structuredClone(run);
  assert.throws(() => applyVisualRunEvent(run, {
    type: "final-audit-recorded",
    ...event(2),
    reportPath: "report.json",
  }, constrained), /not allowed from policy-resolved/);
  assert.deepEqual(run, before);
  assert.equal(run.history.length, 1);
});

test("requires a verified outcome and makes terminal states terminal", () => {
  let run = runThroughCritique(standard, 0);
  run = applyVisualRunEvent(run, { type: "no-repair-needed", ...event(5) }, standard);
  run = applyVisualRunEvent(run, { type: "recheck-evidence-recorded", ...event(6), evidenceId: "e2" }, standard);
  run = applyVisualRunEvent(run, { type: "final-audit-recorded", ...event(7), reportPath: "audit.json" }, standard);
  assert.throws(() => applyVisualRunEvent(run, {
    type: "verification-recorded",
    ...event(8),
    outcome: "implemented-unverified",
    reportPath: "verification.json",
  }, standard), /verified outcome/);

  const blocked = applyVisualRunEvent(
    createVisualRun({ id: "run-blocked", policyPath: "policy.json" }),
    { type: "blocked", ...event(1) },
    constrained,
  );
  assert.deepEqual(allowedVisualRunEvents("blocked"), []);
  assert.throws(() => applyVisualRunEvent(blocked, { type: "failed", ...event(2) }, constrained), /not allowed/);
});

test("publishes the exact allowed event table without exposing mutable internals", () => {
  assert.deepEqual(allowedVisualRunEvents("critiqued"), [
    "repair-requested", "no-repair-needed", "blocked", "failed",
  ]);
  const events = allowedVisualRunEvents("policy-resolved");
  events.pop();
  assert.deepEqual(allowedVisualRunEvents("policy-resolved"), ["directions-validated", "blocked", "failed"]);
});

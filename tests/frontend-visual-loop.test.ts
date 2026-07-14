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
  digestDesignExecutionPolicy,
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
const advanced = resolveDesignExecutionPolicy({
  mode: "reimagine",
  profile: "advanced",
  rankedRecipeIds: ["saas-workspace", "developer-tool", "operational-command-center"],
});

const event = (sequence: number) => ({
  id: String(sequence),
  at: `2026-07-14T00:00:${String(sequence).padStart(2, "0")}Z`,
});

const runThroughCritique = (
  policy = constrained,
  repairFindingCount = 1,
  selectedVariantId?: string,
) => {
  const variantIds = ["v1", "v2", "v3"].slice(0, policy.variantLimit);
  let run = createVisualRun({ id: "run-path", policyPath: ".design/execution-policy.json", policy });
  run = applyVisualRunEvent(run, { type: "directions-validated", ...event(1), variantIds }, policy);
  run = applyVisualRunEvent(run, {
    type: "implementation-recorded",
    ...event(2),
    implementations: variantIds.map((variantId) => ({
      variantId,
      artifactId: `git-diff:initial:${variantId}`,
    })),
  }, policy);
  run = applyVisualRunEvent(run, { type: "initial-evidence-recorded", ...event(3), evidenceId: "e1" }, policy);
  return applyVisualRunEvent(run, {
    type: "critique-recorded",
    ...event(4),
    critiqueId: "c1",
    selectedVariantId,
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
    policyDigest: digestDesignExecutionPolicy(constrained),
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
  assert.ok(runSchema.required.includes("policyDigest"));
  assert.equal(runSchema.properties.policyDigest.pattern, "^sha256:[a-f0-9]{64}$");
  assert.equal(runSchema.properties.variantIds.uniqueItems, true);
  assert.equal(runSchema.properties.critiqueRepairFindingCount.type, "integer");
  assert.equal(runSchema.properties.critiqueRepairFindingCount.minimum, 0);
  const artifacts = runSchema.properties.artifacts.properties;
  assert.deepEqual(artifacts.implementations.items.required, ["variantId", "artifactId"]);
  assert.equal(artifacts.implementations.items.additionalProperties, false);
  assert.equal(artifacts.repairImplementationArtifact.minLength, 1);
  assert.equal(artifacts.finalAuditReportPath.minLength, 1);
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

test("binds a visual run to the complete canonical execution policy", () => {
  const sameLimitStandard = resolveDesignExecutionPolicy({
    mode: "refine", profile: "standard", rankedRecipeIds: ["developer-tool"],
  });
  assert.equal(sameLimitStandard.variantLimit, constrained.variantLimit);
  const run = createVisualRun({ id: "policy-bound", policyPath: "policy.json", policy: constrained });
  const before = structuredClone(run);
  assert.throws(() => applyVisualRunEvent(run, {
    type: "directions-validated", ...event(1), variantIds: ["v1"],
  }, sameLimitStandard), /policy digest mismatch/i);
  assert.deepEqual(run, before);

  const reordered = Object.fromEntries(
    Object.entries(constrained).reverse().map(([key, value]) => [
      key,
      key === "freedoms" ? Object.fromEntries(Object.entries(value).reverse()) : value,
    ]),
  ) as typeof constrained;
  assert.equal(digestDesignExecutionPolicy(reordered), digestDesignExecutionPolicy(constrained));
  assert.equal(run.policyDigest, digestDesignExecutionPolicy(constrained));
});

test("policy digest covers calibration and all other policy fields", () => {
  const run = createVisualRun({ id: "policy-complete", policyPath: "policy.json", policy: constrained });
  const calibrated = {
    ...constrained,
    capabilityClassId: `${constrained.capabilityClassId}-calibrated`,
  };
  assert.equal(calibrated.variantLimit, constrained.variantLimit);
  assert.throws(() => applyVisualRunEvent(run, {
    type: "directions-validated", ...event(1), variantIds: ["v1"],
  }, calibrated), /policy digest mismatch/i);
});

test("requires the complete constrained visual correction path and retains artifacts", () => {
  let run = runThroughCritique(constrained, 0, "v1");
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
  assert.equal(run.artifacts.finalAuditReportPath, ".design/final-audit.json");
  assert.equal(run.artifacts.verificationReportPath, undefined);
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
    implementations: [{ variantId: "v1", artifactId: "git-diff:initial:v1" }],
    initialEvidenceId: "e1",
    critiqueId: "c1",
    repairId: "r1",
    repairImplementationArtifact: "git-diff:repair",
    recheckEvidenceId: "e2",
    finalAuditReportPath: ".design/final-audit.json",
    verificationReportPath: ".design/verification-report.json",
  });
  assert.equal(run.history.length, 10);
});

test("allows the standard no-repair branch only for a critique with zero findings", () => {
  let run = runThroughCritique(standard, 0, "v1");
  run = applyVisualRunEvent(run, { type: "no-repair-needed", ...event(5) }, standard);
  run = applyVisualRunEvent(run, { type: "recheck-evidence-recorded", ...event(6), evidenceId: "e2" }, standard);
  assert.equal(run.state, "recheck-evidence-captured");

  const findingsRun = runThroughCritique(standard, 2, "v1");
  assert.throws(
    () => applyVisualRunEvent(findingsRun, { type: "no-repair-needed", ...event(5) }, standard),
    /zero repair findings/,
  );
});

test("rejects variant counts and duplicate variant ids that disagree with policy", () => {
  const run = createVisualRun({ id: "run-count", policyPath: ".design/execution-policy.json", policy: standard });
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
  let run = createVisualRun({ id: "run-membership", policyPath: ".design/execution-policy.json", policy: standard });
  run = applyVisualRunEvent(run, {
    type: "directions-validated",
    ...event(1),
    variantIds: ["v1", "v2"],
  }, standard);
  assert.throws(() => applyVisualRunEvent(run, {
    type: "implementation-recorded",
    ...event(2),
    implementations: [
      { variantId: "v1", artifactId: "git-diff:v1" },
      { variantId: "v3", artifactId: "git-diff:v3" },
    ],
  }, standard), /validated variant/);

  run = applyVisualRunEvent(run, {
    type: "implementation-recorded",
    ...event(2),
    implementations: [
      { variantId: "v1", artifactId: "git-diff:v1" },
      { variantId: "v2", artifactId: "git-diff:v2" },
    ],
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
  const run = runThroughCritique(standard, 0, "v1");
  const replayed = JSON.parse(JSON.stringify(run)) as VisualRun;
  const next = applyVisualRunEvent(replayed, { type: "no-repair-needed", ...event(5) }, standard);
  assert.equal(next.state, "no-repair-needed");

  let beforeCritique = createVisualRun({ id: "run-invalid-count", policyPath: "policy.json", policy: standard });
  beforeCritique = applyVisualRunEvent(beforeCritique, {
    type: "directions-validated", ...event(1), variantIds: ["v1", "v2"],
  }, standard);
  beforeCritique = applyVisualRunEvent(beforeCritique, {
    type: "implementation-recorded",
    ...event(2),
    implementations: [
      { variantId: "v1", artifactId: "diff:v1" },
      { variantId: "v2", artifactId: "diff:v2" },
    ],
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
  const run = createVisualRun({ id: "run-skip", policyPath: ".design/execution-policy.json", policy: constrained });
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
  let run = runThroughCritique(standard, 0, "v1");
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
    createVisualRun({ id: "run-blocked", policyPath: "policy.json", policy: constrained }),
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

test("requires atomic exact implementation coverage for standard and advanced policies", () => {
  let standardRun = createVisualRun({ id: "run-standard-coverage", policyPath: "policy.json", policy: standard });
  standardRun = applyVisualRunEvent(standardRun, {
    type: "directions-validated", ...event(1), variantIds: ["v1", "v2"],
  }, standard);

  const invalidImplementations = [
    {
      implementations: [{ variantId: "v1", artifactId: "a1" }],
      message: /exactly cover all validated variants/,
    },
    {
      implementations: [
        { variantId: "v1", artifactId: "a1" },
        { variantId: "v1", artifactId: "a2" },
      ],
      message: /unique variant ids/,
    },
    {
      implementations: [
        { variantId: "v1", artifactId: "a1" },
        { variantId: "v2", artifactId: "a2" },
        { variantId: "v3", artifactId: "a3" },
      ],
      message: /exactly cover all validated variants/,
    },
  ];
  for (const invalid of invalidImplementations) {
    const before = structuredClone(standardRun);
    assert.throws(() => applyVisualRunEvent(standardRun, {
      type: "implementation-recorded", ...event(2), implementations: invalid.implementations,
    }, standard), invalid.message);
    assert.deepEqual(standardRun, before);
  }

  standardRun = applyVisualRunEvent(standardRun, {
    type: "implementation-recorded",
    ...event(2),
    implementations: [
      { variantId: "v2", artifactId: "a2" },
      { variantId: "v1", artifactId: "a1" },
    ],
  }, standard);
  assert.deepEqual(standardRun.artifacts.implementations, [
    { variantId: "v2", artifactId: "a2" },
    { variantId: "v1", artifactId: "a1" },
  ]);

  let advancedRun = createVisualRun({ id: "run-advanced-coverage", policyPath: "policy.json", policy: advanced });
  advancedRun = applyVisualRunEvent(advancedRun, {
    type: "directions-validated", ...event(1), variantIds: ["v1", "v2", "v3"],
  }, advanced);
  advancedRun = applyVisualRunEvent(advancedRun, {
    type: "implementation-recorded",
    ...event(2),
    implementations: [
      { variantId: "v3", artifactId: "a3" },
      { variantId: "v1", artifactId: "a1" },
      { variantId: "v2", artifactId: "a2" },
    ],
  }, advanced);
  assert.equal(advancedRun.artifacts.implementations?.length, 3);
});

test("requires a selected candidate before repair or no-repair decisions", () => {
  const constrainedRun = runThroughCritique(constrained, 1, undefined);
  const standardRun = runThroughCritique(standard, 0, undefined);
  for (const [run, nextEvent, policy] of [
    [constrainedRun, { type: "repair-requested", ...event(5), repairId: "r1" }, constrained],
    [standardRun, { type: "no-repair-needed", ...event(5) }, standard],
  ] as const) {
    const before = structuredClone(run);
    assert.throws(
      () => applyVisualRunEvent(run, nextEvent, policy),
      /selected variant is required/,
    );
    assert.deepEqual(run, before);
  }
});

test("rejects a stale repair id without mutation or artifact overwrite", () => {
  let run = runThroughCritique(constrained, 1, "v1");
  run = applyVisualRunEvent(run, { type: "repair-requested", ...event(5), repairId: "repair-current" }, constrained);
  const before = structuredClone(run);
  assert.throws(() => applyVisualRunEvent(run, {
    type: "repair-recorded",
    ...event(6),
    repairId: "repair-stale",
    implementationArtifact: "git-diff:stale",
  }, constrained), /match the requested repair id/);
  assert.deepEqual(run, before);
  assert.equal(run.artifacts.repairId, "repair-current");
  assert.equal(run.artifacts.repairImplementationArtifact, undefined);
});

test("clones persisted implementation references across later transitions", () => {
  const implemented = (() => {
    let run = createVisualRun({ id: "run-immutable-artifacts", policyPath: "policy.json", policy: standard });
    run = applyVisualRunEvent(run, {
      type: "directions-validated", ...event(1), variantIds: ["v1", "v2"],
    }, standard);
    return applyVisualRunEvent(run, {
      type: "implementation-recorded",
      ...event(2),
      implementations: [
        { variantId: "v1", artifactId: "a1" },
        { variantId: "v2", artifactId: "a2" },
      ],
    }, standard);
  })();
  const next = applyVisualRunEvent(implemented, {
    type: "initial-evidence-recorded", ...event(3), evidenceId: "e1",
  }, standard);
  assert.notEqual(next.artifacts.implementations, implemented.artifacts.implementations);
  assert.notEqual(next.artifacts.implementations?.[0], implemented.artifacts.implementations?.[0]);
  assert.deepEqual(next.artifacts.implementations, implemented.artifacts.implementations);
});

test("validates all visual event payload fields before mutation", () => {
  const base = createVisualRun({ id: "run-payload", policyPath: "policy.json", policy: constrained });
  for (const bad of [
    { type: "directions-validated", id: "", at: event(1).at, variantIds: ["v1"] },
    { type: "directions-validated", id: "1", at: "not-a-date", variantIds: ["v1"] },
    { type: "directions-validated", ...event(1), variantIds: [""] },
    { type: "directions-validated", ...event(1), variantIds: ["v1"], injected: true },
  ]) {
    const before = structuredClone(base);
    assert.throws(() => applyVisualRunEvent(base, bad as VisualRunEvent, constrained), /non-empty|RFC 3339|unknown field/);
    assert.deepEqual(base, before);
  }

  let run = applyVisualRunEvent(base, { type: "directions-validated", ...event(1), variantIds: ["v1"] }, constrained);
  const before = structuredClone(run);
  assert.throws(() => applyVisualRunEvent(run, {
    type: "implementation-recorded", ...event(2), implementations: [{ variantId: "v1", artifactId: "" }],
  }, constrained), /artifact/i);
  assert.deepEqual(run, before);

  assert.throws(() => applyVisualRunEvent(run, {
    type: "implementation-recorded", ...event(2),
    implementations: [{ variantId: "v1", artifactId: "diff:v1", injected: true }],
  } as VisualRunEvent, constrained), /unknown field/i);
  assert.deepEqual(run, before);

  const corrupt = { ...base, injected: true } as VisualRun;
  assert.throws(() => applyVisualRunEvent(corrupt, {
    type: "directions-validated", ...event(1), variantIds: ["v1"],
  }, constrained), /unknown field/);
});

test("deep-clones history snapshots across transitions", () => {
  const first = createVisualRun({ id: "history-clone", policyPath: "policy.json", policy: constrained });
  const second = applyVisualRunEvent(first, {
    type: "directions-validated", ...event(1), variantIds: ["v1"],
  }, constrained);
  assert.notEqual(second.history[0], first.history[0]);
  second.history[0].at = "2027-01-01T00:00:00Z";
  assert.equal(first.history[0].at, "1970-01-01T00:00:00.000Z");
});

test("rejects forged persisted snapshots before any transition", () => {
  let implemented = createVisualRun({ id: "coherence", policyPath: "policy.json", policy: constrained });
  implemented = applyVisualRunEvent(implemented, { type: "directions-validated", ...event(1), variantIds: ["v1"] }, constrained);
  implemented = applyVisualRunEvent(implemented, {
    type: "implementation-recorded", ...event(2), implementations: [{ variantId: "v1", artifactId: "diff:v1" }],
  }, constrained);
  const evidenced = applyVisualRunEvent(implemented, {
    type: "initial-evidence-recorded", ...event(3), evidenceId: "e1",
  }, constrained);
  const critiqued = applyVisualRunEvent(evidenced, {
    type: "critique-recorded", ...event(4), critiqueId: "c1", selectedVariantId: "v1", repairFindingCount: 1,
  }, constrained);
  const requested = applyVisualRunEvent(critiqued, {
    type: "repair-requested", ...event(5), repairId: "r1",
  }, constrained);
  const repaired = applyVisualRunEvent(requested, {
    type: "repair-recorded", ...event(6), repairId: "r1", implementationArtifact: "repair:v1",
  }, constrained);
  const rechecked = applyVisualRunEvent(repaired, {
    type: "recheck-evidence-recorded", ...event(7), evidenceId: "e2",
  }, constrained);
  const audited = applyVisualRunEvent(rechecked, {
    type: "final-audit-recorded", ...event(8), reportPath: "audit.json",
  }, constrained);

  const forgeries: Array<[string, VisualRun, VisualRunEvent]> = [
    ["empty history", { ...implemented, history: [] }, { type: "initial-evidence-recorded", ...event(3), evidenceId: "e1" }],
    ["wrong first history", { ...implemented, history: [{ ...implemented.history[0], state: "directions-valid" }] }, { type: "initial-evidence-recorded", ...event(3), evidenceId: "e1" }],
    ["wrong last history", { ...implemented, history: implemented.history.slice(0, -1) }, { type: "initial-evidence-recorded", ...event(3), evidenceId: "e1" }],
    ["illegal history jump", { ...audited, history: [audited.history[0], audited.history.at(-1)!] }, { type: "verification-recorded", ...event(9), outcome: "verified", reportPath: "verify.json" }],
    ["bad variant count", { ...implemented, variantIds: ["v1", "v2"] }, { type: "initial-evidence-recorded", ...event(3), evidenceId: "e1" }],
    ["missing implementation", { ...implemented, artifacts: {} }, { type: "initial-evidence-recorded", ...event(3), evidenceId: "e1" }],
    ["missing initial evidence", { ...evidenced, artifacts: { ...evidenced.artifacts, initialEvidenceId: undefined } }, { type: "critique-recorded", ...event(4), critiqueId: "c1", selectedVariantId: "v1", repairFindingCount: 1 }],
    ["missing critique", { ...critiqued, artifacts: { ...critiqued.artifacts, critiqueId: undefined } }, { type: "repair-requested", ...event(5), repairId: "r1" }],
    ["missing repair request", { ...requested, artifacts: { ...requested.artifacts, repairId: undefined } }, { type: "repair-recorded", ...event(6), repairId: "r1", implementationArtifact: "repair:v1" }],
    ["missing repair artifact", { ...repaired, artifacts: { ...repaired.artifacts, repairImplementationArtifact: undefined } }, { type: "recheck-evidence-recorded", ...event(7), evidenceId: "e2" }],
    ["stale recheck", { ...rechecked, artifacts: { ...rechecked.artifacts, recheckEvidenceId: "e1" } }, { type: "final-audit-recorded", ...event(8), reportPath: "audit.json" }],
    ["forged final audited", { ...audited, artifacts: { ...audited.artifacts, finalAuditReportPath: undefined } }, { type: "verification-recorded", ...event(9), outcome: "verified", reportPath: "verify.json" }],
  ];
  for (const [label, forged, next] of forgeries) {
    const before = structuredClone(forged);
    assert.throws(() => applyVisualRunEvent(forged, next, constrained), /snapshot invariant/i, label);
    assert.deepEqual(forged, before, label);
  }
});

test("rejects forged no-repair semantics and verified snapshots", () => {
  let noRepair = runThroughCritique(standard, 0, "v1");
  noRepair = applyVisualRunEvent(noRepair, { type: "no-repair-needed", ...event(5) }, standard);
  const constrainedForgery = structuredClone(noRepair);
  constrainedForgery.policyDigest = digestDesignExecutionPolicy(constrained);
  assert.throws(() => applyVisualRunEvent(constrainedForgery, {
    type: "recheck-evidence-recorded", ...event(6), evidenceId: "e2",
  }, constrained), /snapshot invariant/i);

  let verified = applyVisualRunEvent(noRepair, {
    type: "recheck-evidence-recorded", ...event(6), evidenceId: "e2",
  }, standard);
  verified = applyVisualRunEvent(verified, { type: "final-audit-recorded", ...event(7), reportPath: "audit.json" }, standard);
  verified = applyVisualRunEvent(verified, {
    type: "verification-recorded", ...event(8), outcome: "verified", reportPath: "verify.json",
  }, standard);
  const forged = { ...verified, artifacts: { ...verified.artifacts, verificationReportPath: undefined } };
  assert.throws(() => applyVisualRunEvent(forged, { type: "failed", ...event(9) }, standard), /snapshot invariant/i);
});

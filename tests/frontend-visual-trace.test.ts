import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applyVisualRunEvent,
  createCritiqueRecordedEvent,
  createDesignExecutionTrace,
  createVisualCriticInput,
  createVisualRun,
  loadRecipeExamplePacks,
  prepareMaterialVisualExecution,
  resolveDesignExecutionPolicy,
  verifyVisualResult,
  type DesignDirection,
} from "../src/domains/frontend/design/index.ts";
import { makeBrief, makeBundle, makeVerificationInput } from "./helpers/frontend-visual-fixtures.ts";

const direction = (): DesignDirection => ({
  schemaVersion: "1.0",
  recipeId: "developer-tool",
  selectedRuleIds: [
    "typography.role-contrast",
    "layout.action-evidence",
    "responsive.recompose-not-stack",
    "color.semantic-roles",
    "state.complete-primary-flow",
    "signature.product-data-grammar",
  ],
  thesis: "Run state leads the diagnostic flow.",
  productReason: "Maintainers must find the failing step before copying a command.",
  axes: {
    density: "compact",
    hierarchy: "exception-first",
    composition: "split-pane",
    material: "bordered",
    motionIntensity: "low",
    expressionLevel: "restrained",
  },
  typographyRoles: { heading: "sans-semibold", body: "sans", code: "mono" },
  colorRoles: { failure: "destructive", success: "positive", surface: "background" },
  signatureMove: "The failed step anchors log and command context.",
  rejectedDefaults: ["decorative metric cards"],
  destructiveCritique: "The split pane must collapse into list-detail at 390px.",
});

const event = (sequence: number) => ({
  id: `trace-event-${sequence}`,
  at: `2026-08-04T00:00:${String(sequence).padStart(2, "0")}Z`,
});

test("carries one direction and its example pack through the complete visual lifecycle", async () => {
  const brief = makeBrief();
  const policy = resolveDesignExecutionPolicy({
    mode: "refine",
    profile: "standard",
    rankedRecipeIds: ["developer-tool"],
    requiredStates: brief.surface.requiredStates,
  });
  const pack = (await loadRecipeExamplePacks()).find(({ recipeId }) => recipeId === "developer-tool");
  assert.ok(pack);
  const selectedDirection = direction();
  const trace = createDesignExecutionTrace({
    id: "design-trace-1",
    directionPath: ".design/variants/v1/direction.json",
    examplePackPath: "domains/frontend/examples/developer-tool/example.json",
    direction: selectedDirection,
    examplePack: pack,
  });

  let run = createVisualRun({
    id: "visual-trace-run",
    policyPath: ".design/execution-policy.json",
    policy,
    executionTrace: trace,
  });
  run = applyVisualRunEvent(run, {
    type: "directions-validated",
    ...event(1),
    variantIds: ["v1"],
    traceId: trace.id,
  }, policy);
  run = applyVisualRunEvent(run, {
    type: "implementation-recorded",
    ...event(2),
    implementations: [{ variantId: "v1", artifactId: "git-diff:initial" }],
  }, policy);
  run = applyVisualRunEvent(run, {
    type: "initial-evidence-recorded",
    ...event(3),
    evidenceId: "e1",
  }, policy);

  const verificationInput = makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:initial" }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:repair" }),
  });
  const criticInput = createVisualCriticInput({
    policyId: "design-trace-1",
    generatorActorId: "g1",
    criticActorId: "c1",
    candidates: [{
      variantId: "v1",
      directionPath: trace.directionPath,
      evidenceId: "e1",
      screenshotPaths: ["/tmp/e1/390-loading.png"],
    }],
  });
  assert.throws(() => createCritiqueRecordedEvent(
    run,
    {
      ...criticInput,
      candidates: [{ ...criticInput.candidates[0]!, directionPath: ".design/variants/stale/direction.json" }],
    },
    verificationInput.criticReport,
    event(4),
  ), /current material execution trace direction/);
  const critiqueEvent = createCritiqueRecordedEvent(
    run,
    criticInput,
    verificationInput.criticReport,
    event(4),
  );
  run = applyVisualRunEvent(run, critiqueEvent, policy);
  run = applyVisualRunEvent(run, { type: "no-repair-needed", ...event(5) }, policy);
  run = applyVisualRunEvent(run, {
    type: "recheck-evidence-recorded",
    ...event(6),
    evidenceId: "e2",
  }, policy);
  run = applyVisualRunEvent(run, {
    type: "final-audit-recorded",
    ...event(7),
    reportPath: ".design/final-audit.json",
  }, policy);

  verificationInput.policy = policy;
  verificationInput.visualRun = run;
  verificationInput.variant = {
    ...verificationInput.variant,
    recipeId: selectedDirection.recipeId,
    directionPath: trace.directionPath,
    ruleIds: [...selectedDirection.selectedRuleIds!],
  };
  verificationInput.direction = selectedDirection;
  verificationInput.examplePack = pack;
  const result = verifyVisualResult(verificationInput);

  assert.equal(result.report.outcome, "verified");
  assert.equal(result.findings.length, 0);
  assert.deepEqual(run.executionTrace, trace);
});

test("verifies a legacy schemaVersion-1.0 critic report through the full verifier", async () => {
  const brief = makeBrief();
  const policy = resolveDesignExecutionPolicy({
    mode: "refine",
    profile: "standard",
    rankedRecipeIds: ["developer-tool"],
    requiredStates: brief.surface.requiredStates,
  });
  const pack = (await loadRecipeExamplePacks()).find(({ recipeId }) => recipeId === "developer-tool");
  assert.ok(pack);
  const selectedDirection = direction();
  const trace = createDesignExecutionTrace({
    id: "design-trace-legacy",
    directionPath: ".design/variants/v1/direction.json",
    examplePackPath: "domains/frontend/examples/developer-tool/example.json",
    direction: selectedDirection,
    examplePack: pack,
  });

  let run = createVisualRun({
    id: "visual-trace-legacy-run",
    policyPath: ".design/execution-policy.json",
    policy,
    executionTrace: trace,
  });
  run = applyVisualRunEvent(run, {
    type: "directions-validated", ...event(1), variantIds: ["v1"], traceId: trace.id,
  }, policy);
  run = applyVisualRunEvent(run, {
    type: "implementation-recorded", ...event(2),
    implementations: [{ variantId: "v1", artifactId: "git-diff:initial" }],
  }, policy);
  run = applyVisualRunEvent(run, {
    type: "initial-evidence-recorded", ...event(3), evidenceId: "e1",
  }, policy);
  run = applyVisualRunEvent(run, {
    type: "critique-recorded", ...event(4), critiqueId: "c1", selectedVariantId: "v1",
    repairFindingCount: 0,
  }, policy);
  run = applyVisualRunEvent(run, { type: "no-repair-needed", ...event(5) }, policy);
  run = applyVisualRunEvent(run, {
    type: "recheck-evidence-recorded", ...event(6), evidenceId: "e2",
  }, policy);
  run = applyVisualRunEvent(run, {
    type: "final-audit-recorded", ...event(7), reportPath: ".design/final-audit.json",
  }, policy);

  const verificationInput = makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:initial" }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:repair" }),
  });
  verificationInput.policy = policy;
  verificationInput.visualRun = run;
  verificationInput.variant = {
    ...verificationInput.variant,
    recipeId: selectedDirection.recipeId,
    directionPath: trace.directionPath,
    ruleIds: [...selectedDirection.selectedRuleIds!],
  };
  verificationInput.direction = selectedDirection;
  verificationInput.examplePack = pack;
  verificationInput.criticReport.schemaVersion = "1.0";
  verificationInput.criticReport.comparisons[0].aiSlopFindings = [{
    code: "weak-hierarchy", severity: "high", evidence: "e1",
    explanation: "The primary action is visually subordinate.",
  }];

  const result = verifyVisualResult(verificationInput);
  assert.equal(result.report.outcome, "verified");
  assert.ok(!result.findings.some(({ code }) =>
    code === "critic-ai-slop-vocabulary" || code === "critic-schema-version"));
});

test("blocks a material run when rule selection is missing before implementation", async () => {
  const brief = makeBrief();
  const policy = resolveDesignExecutionPolicy({
    mode: "refine",
    profile: "constrained",
    rankedRecipeIds: ["developer-tool"],
    requiredStates: brief.surface.requiredStates,
  });
  const pack = (await loadRecipeExamplePacks()).find(({ recipeId }) => recipeId === "developer-tool");
  assert.ok(pack);
  const incomplete = direction();
  delete incomplete.selectedRuleIds;

  const preparation = prepareMaterialVisualExecution({
    id: "blocked-material-run",
    policyPath: ".design/execution-policy.json",
    policy,
    directionPath: ".design/variants/v1/direction.json",
    examplePackPath: "domains/frontend/examples/developer-tool/example.json",
    direction: incomplete,
    examplePack: pack,
    blockedAt: "2026-08-04T00:00:00Z",
  });

  assert.equal(preparation.ok, false);
  assert.equal(preparation.run.state, "blocked");
  assert.ok(preparation.findings.some(({ code }) => code === "direction-rule-selection-missing"));
});

test("blocks a material run when its worked-example pack is missing", async () => {
  const brief = makeBrief();
  const policy = resolveDesignExecutionPolicy({
    mode: "refine",
    profile: "constrained",
    rankedRecipeIds: ["developer-tool"],
    requiredStates: brief.surface.requiredStates,
  });
  const preparation = prepareMaterialVisualExecution({
    id: "missing-example-run",
    policyPath: ".design/execution-policy.json",
    policy,
    directionPath: ".design/variants/v1/direction.json",
    examplePackPath: "domains/frontend/examples/developer-tool/example.json",
    direction: direction(),
    blockedAt: "2026-08-04T00:00:00Z",
  });

  assert.equal(preparation.ok, false);
  assert.equal(preparation.run.state, "blocked");
  assert.ok(preparation.findings.some(({ code }) => code === "visual-execution-example-pack-missing"));
});

test("prepares a valid material run with its trace before directions are implemented", async () => {
  const brief = makeBrief();
  const policy = resolveDesignExecutionPolicy({
    mode: "refine",
    profile: "constrained",
    rankedRecipeIds: ["developer-tool"],
    requiredStates: brief.surface.requiredStates,
  });
  const pack = (await loadRecipeExamplePacks()).find(({ recipeId }) => recipeId === "developer-tool");
  assert.ok(pack);
  const preparation = prepareMaterialVisualExecution({
    id: "prepared-material-run",
    policyPath: ".design/execution-policy.json",
    policy,
    directionPath: ".design/variants/v1/direction.json",
    examplePackPath: "domains/frontend/examples/developer-tool/example.json",
    direction: direction(),
    examplePack: pack,
  });

  assert.equal(preparation.ok, true);
  assert.ok(preparation.trace);
  assert.equal(preparation.run.state, "policy-resolved");
  assert.equal(preparation.run.executionTrace?.id, preparation.trace.id);
});

test("blocks a material run when the selected rules are incompatible with the worked example", async () => {
  const brief = makeBrief();
  const policy = resolveDesignExecutionPolicy({
    mode: "refine",
    profile: "constrained",
    rankedRecipeIds: ["developer-tool"],
    requiredStates: brief.surface.requiredStates,
  });
  const pack = (await loadRecipeExamplePacks()).find(({ recipeId }) => recipeId === "developer-tool");
  assert.ok(pack);
  const incompatible = direction();
  incompatible.selectedRuleIds = [
    ...incompatible.selectedRuleIds!.slice(0, 5),
    "signature.brand-voice",
  ];

  const preparation = prepareMaterialVisualExecution({
    id: "incompatible-material-run",
    policyPath: ".design/execution-policy.json",
    policy,
    directionPath: ".design/variants/v1/direction.json",
    examplePackPath: "domains/frontend/examples/developer-tool/example.json",
    direction: incompatible,
    examplePack: pack,
    blockedAt: "2026-08-04T00:00:00Z",
  });

  assert.equal(preparation.ok, false);
  assert.equal(preparation.run.state, "blocked");
  assert.ok(preparation.findings.some(({ code }) => code === "direction-rule-selection-contract"));
  assert.ok(preparation.findings.some(({ code }) => code === "visual-execution-example-mismatch"));
});

test("final verification rejects a direction changed after its execution trace was recorded", async () => {
  const pack = (await loadRecipeExamplePacks()).find(({ recipeId }) => recipeId === "developer-tool");
  assert.ok(pack);
  const selectedDirection = direction();
  const trace = createDesignExecutionTrace({
    id: "design-trace-changed",
    directionPath: ".design/variants/v1/direction.json",
    examplePackPath: "domains/frontend/examples/developer-tool/example.json",
    direction: selectedDirection,
    examplePack: pack,
  });
  const input = makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:initial" }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:repair" }),
  });
  input.visualRun.executionTrace = trace;
  input.variant = {
    ...input.variant,
    recipeId: selectedDirection.recipeId,
    directionPath: trace.directionPath,
    ruleIds: [...selectedDirection.selectedRuleIds!],
  };
  input.direction = { ...selectedDirection, thesis: "A changed thesis must not be promoted." };
  input.examplePack = pack;

  const result = verifyVisualResult(input);
  assert.equal(result.report.outcome, "failed");
  assert.ok(result.findings.some(({ code }) => code === "visual-execution-trace-mismatch"));
});

test("final verification rejects a variant that changes the traced rule decision late", async () => {
  const pack = (await loadRecipeExamplePacks()).find(({ recipeId }) => recipeId === "developer-tool");
  assert.ok(pack);
  const selectedDirection = direction();
  const trace = createDesignExecutionTrace({
    id: "design-trace-late-variant-change",
    directionPath: ".design/variants/v1/direction.json",
    examplePackPath: "domains/frontend/examples/developer-tool/example.json",
    direction: selectedDirection,
    examplePack: pack,
  });
  const input = makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:initial" }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:repair" }),
  });
  input.visualRun.executionTrace = trace;
  input.variant = {
    ...input.variant,
    recipeId: selectedDirection.recipeId,
    directionPath: trace.directionPath,
    ruleIds: [...selectedDirection.selectedRuleIds!.slice(0, 5), "signature.brand-voice"],
  };
  input.direction = selectedDirection;
  input.examplePack = pack;

  const result = verifyVisualResult(input);
  assert.equal(result.report.outcome, "failed");
  assert.ok(result.findings.some(({ code }) => code === "visual-variant-rule-selection-mismatch"));
});

test("final verification rejects a detached trace even when the caller supplies a valid trace argument", async () => {
  const pack = (await loadRecipeExamplePacks()).find(({ recipeId }) => recipeId === "developer-tool");
  assert.ok(pack);
  const selectedDirection = direction();
  const trace = createDesignExecutionTrace({
    id: "design-trace-detached",
    directionPath: ".design/variants/v1/direction.json",
    examplePackPath: "domains/frontend/examples/developer-tool/example.json",
    direction: selectedDirection,
    examplePack: pack,
  });
  const input = makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:initial" }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:repair" }),
  });
  input.executionTrace = trace;
  input.variant = {
    ...input.variant,
    recipeId: selectedDirection.recipeId,
    directionPath: trace.directionPath,
    ruleIds: [...selectedDirection.selectedRuleIds!],
  };
  input.direction = selectedDirection;
  input.examplePack = pack;

  const result = verifyVisualResult(input);
  assert.equal(result.report.outcome, "failed");
  assert.ok(result.findings.some(({ code }) => code === "visual-run-trace-missing"));
});

test("final verification rejects a caller trace that reuses the persisted trace id", async () => {
  const pack = (await loadRecipeExamplePacks()).find(({ recipeId }) => recipeId === "developer-tool");
  assert.ok(pack);
  const selectedDirection = direction();
  const persistedTrace = createDesignExecutionTrace({
    id: "design-trace-reused-id",
    directionPath: ".design/variants/v1/direction.json",
    examplePackPath: "domains/frontend/examples/developer-tool/example.json",
    direction: selectedDirection,
    examplePack: pack,
  });
  const lateDirection = { ...selectedDirection, thesis: "A late direction that was not persisted before implementation." };
  const callerTrace = createDesignExecutionTrace({
    id: persistedTrace.id,
    directionPath: persistedTrace.directionPath,
    examplePackPath: persistedTrace.examplePackPath,
    direction: lateDirection,
    examplePack: pack,
  });
  const input = makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:initial" }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:repair" }),
  });
  input.visualRun.executionTrace = persistedTrace;
  input.executionTrace = callerTrace;
  input.variant = {
    ...input.variant,
    recipeId: lateDirection.recipeId,
    directionPath: callerTrace.directionPath,
    ruleIds: [...lateDirection.selectedRuleIds!],
  };
  input.direction = lateDirection;
  input.examplePack = pack;

  const result = verifyVisualResult(input);
  assert.equal(result.report.outcome, "failed");
  assert.ok(result.findings.some(({ code }) => code === "visual-execution-trace-mismatch"));
});

test("publishes one versioned execution-trace contract without a second rule-selection schema", async () => {
  const manifest = JSON.parse(await readFile("domains/frontend/domain.manifest.json", "utf8")) as {
    artifacts: { schemas: string[] };
  };
  assert.ok(manifest.artifacts.schemas.includes("schemas/visual-execution-trace.schema.json"));
  const traceSchema = JSON.parse(await readFile("domains/frontend/schemas/visual-execution-trace.schema.json", "utf8"));
  const runSchema = JSON.parse(await readFile("domains/frontend/schemas/visual-run.schema.json", "utf8"));
  assert.equal(traceSchema.additionalProperties, false);
  assert.deepEqual(traceSchema.required, [
    "schemaVersion", "id", "directionPath", "directionDigest", "recipeId",
    "examplePackPath", "examplePackDigest", "ruleSelectionDigest",
  ]);
  assert.equal(runSchema.properties.executionTrace.$ref, "#/$defs/executionTrace");
  assert.equal(runSchema.$defs.executionTrace.additionalProperties, false);
});

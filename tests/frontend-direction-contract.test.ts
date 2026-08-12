import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  compileDesignMarkdown,
  validateDesignBrief,
  validateDesignDirection,
  validateDesignResult,
  type DesignBrief,
  type DesignDirection,
} from "../src/domains/frontend/design/index.ts";
import { validateJsonSchema } from "../src/runtime/strict/json-schema.ts";

const makeBrief = (): DesignBrief => ({
  schemaVersion: "1.0",
  product: {
    domain: "developer tool",
    primaryUserOrActor: "software developer",
    primaryTask: "inspect and install agent skills",
    contentTypes: ["recommendations", "project evidence", "commands"],
    usageFrequency: "frequent",
    stakes: [],
  },
  surface: {
    type: "dashboard",
    primaryAction: "inspect recommendation",
    supportedViewports: [390, 768, 1440],
    requiredStates: ["success"],
  },
  direction: { requestedTone: ["technical", "quiet"], antiGoals: ["generic SaaS metrics"], existingDirection: "local neutral tokens" },
  evidence: {
    observed: [{ statement: "The project exposes CLI commands.", source: "README.md" }],
    inferred: [], assumed: [], unknown: [],
  },
});

const makeIdentity = () => ({
  macrostructure: "anchored-hero-with-work-object-rail",
  themeAxes: {
    paperBand: "warm-white",
    displayStyle: "typographic",
    accentHue: "vermillion",
  },
});

const makeCommon = () => ({
  recipeId: "developer-tool",
  selectedRuleIds: [
    "typography.role-contrast",
    "layout.action-evidence",
    "responsive.recompose-not-stack",
    "color.semantic-roles",
    "state.complete-primary-flow",
    "signature.product-data-grammar",
  ],
  thesis: "A compact evidence-first workspace for comparing skills and install risk.",
  productReason: "Developers repeatedly compare project evidence, risk, and commands.",
  axes: {
    density: "balanced",
    hierarchy: "action-first",
    composition: "structured-list",
    material: "bordered",
    motionIntensity: "low",
    expressionLevel: "restrained",
  },
  typographyRoles: { body: "UI sans", code: "monospace" },
  colorRoles: { danger: "installation risk", accent: "selected recommendation" },
  signatureMove: "Recommendation evidence remains pinned beside the selected skill.",
  rejectedDefaults: ["decorative metric cards"],
  destructiveCritique: "The structured list must not become a grid of equal-weight cards.",
});

const makeDirection = (schemaVersion: "1.0" | "1.1"): DesignDirection => ({
  ...makeCommon(),
  ...(schemaVersion === "1.1" ? makeIdentity() : {}),
  schemaVersion,
}) as DesignDirection;

const codesOf = (direction: unknown) =>
  validateDesignDirection(makeBrief(), direction).map(({ code }) => code);

test("validator accepts legacy schemaVersion 1.0 directions unchanged", () => {
  assert.deepEqual(validateDesignDirection(makeBrief(), makeDirection("1.0")), []);
});

test("validator accepts schemaVersion 1.1 directions with identity fields", () => {
  assert.deepEqual(validateDesignDirection(makeBrief(), makeDirection("1.1")), []);
});

test("validator rejects 1.1 directions missing the macrostructure identity field", () => {
  const direction = makeDirection("1.1") as Record<string, unknown>;
  delete direction.macrostructure;
  assert.ok(codesOf(direction).includes("direction-identity-contract"));
});

test("validator rejects 1.1 directions missing the theme-axes identity record", () => {
  const direction = makeDirection("1.1") as Record<string, unknown>;
  delete direction.themeAxes;
  assert.ok(codesOf(direction).includes("direction-theme-axes-contract"));
});

test("validator rejects malformed 1.1 theme axes", () => {
  const valid = makeDirection("1.1") as Record<string, unknown>;
  const withThemeAxes = (themeAxes: unknown) => ({ ...valid, themeAxes });

  assert.ok(codesOf(withThemeAxes({ paperBand: "warm-white", displayStyle: "typographic" })).includes("direction-theme-axes-contract"));
  assert.ok(codesOf(withThemeAxes({ paperBand: "  ", displayStyle: "typographic", accentHue: "vermillion" })).includes("direction-theme-axes-contract"));
  assert.ok(codesOf(withThemeAxes({ paperBand: "warm-white", displayStyle: "typographic", accentHue: 42 })).includes("direction-theme-axes-contract"));
  assert.ok(codesOf(withThemeAxes({ paperBand: "warm-white", displayStyle: "typographic", accentHue: "vermillion", hue: "extra" })).includes("direction-theme-axes-contract"));
  assert.ok(codesOf(withThemeAxes("cool-neutral")).includes("direction-theme-axes-contract"));
  assert.ok(codesOf(withThemeAxes(null)).includes("direction-theme-axes-contract"));
});

test("validator rejects unknown direction schema versions", () => {
  const direction = makeDirection("1.1") as Record<string, unknown>;
  direction.schemaVersion = "2.0";
  assert.deepEqual(codesOf(direction), ["direction-schema-version"]);
});

test("validator rejects 1.0 directions that carry identity fields", () => {
  const direction = { ...makeDirection("1.0"), ...makeIdentity() } as Record<string, unknown>;
  assert.ok(codesOf(direction).includes("direction-structure-contract"));
});

test("validator rejects 1.1 directions with fields outside the canonical contract", () => {
  const direction = makeDirection("1.1") as Record<string, unknown>;
  direction.vendorField = "unsupported";
  assert.ok(codesOf(direction).includes("direction-structure-contract"));
});

test("the six treatment axes are still validated on both schema versions", () => {
  for (const schemaVersion of ["1.0", "1.1"] as const) {
    const direction = makeDirection(schemaVersion) as Record<string, unknown>;
    direction.axes = { ...makeCommon().axes, motionIntensity: "banana" };
    assert.ok(codesOf(direction).includes("direction-axes-contract"), schemaVersion);
  }
});

test("a 1.1 direction flows through end-to-end result validation", () => {
  const result = validateDesignResult({
    workflowId: "frontend.design-generation",
    brief: makeBrief(),
    direction: makeDirection("1.1"),
    capabilities: [],
  });
  assert.equal(result.findings.some(({ code }) => code.startsWith("direction-")), false);
  assert.match(compileDesignMarkdown(makeBrief(), makeDirection("1.1")), /# Design Contract/);
});

test("the published direction schema pins the 1.0/1.1 duality", async () => {
  const schema = JSON.parse(await readFile("domains/frontend/schemas/design-direction.schema.json", "utf8"));
  const valid10 = { ...makeCommon(), schemaVersion: "1.0" };
  const valid11 = { ...makeCommon(), ...makeIdentity(), schemaVersion: "1.1" };
  const missingIdentity = { ...makeCommon(), schemaVersion: "1.1" };
  const malformedThemeAxes = {
    ...makeCommon(),
    ...makeIdentity(),
    schemaVersion: "1.1",
    themeAxes: { paperBand: "warm-white", displayStyle: "typographic" },
  };
  const v10WithIdentity = { ...makeCommon(), ...makeIdentity(), schemaVersion: "1.0" };

  assert.deepEqual(validateJsonSchema(schema, valid10), []);
  assert.deepEqual(validateJsonSchema(schema, valid11), []);
  assert.notDeepEqual(validateJsonSchema(schema, missingIdentity), []);
  assert.notDeepEqual(validateJsonSchema(schema, malformedThemeAxes), []);
  assert.notDeepEqual(validateJsonSchema(schema, v10WithIdentity), []);
  assert.notDeepEqual(validateJsonSchema(schema, { ...valid11, schemaVersion: "2.0" }), []);
});

test("a schema 1.0 direction remains a valid strict-run evidence artifact", () => {
  assert.deepEqual(validateDesignBrief(makeBrief()), []);
  assert.deepEqual(validateDesignDirection(makeBrief(), makeDirection("1.0")), []);
});

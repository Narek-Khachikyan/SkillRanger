import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  designRuleFamilies,
  frontendRecipeIds,
  loadDesignRuleLibrary,
  loadFrontendRecipes,
  recommendFrontendRecipe,
  selectDesignRules,
  validateDesignDirection,
  type DesignBrief,
  type DesignDirection,
} from "../src/domains/frontend/design/index.ts";

const makeBrief = (input: { domain: string; surfaceType: string }): DesignBrief => ({
  schemaVersion: "1.0",
  product: {
    domain: input.domain,
    primaryUserOrActor: "User",
    primaryTask: "Complete the primary flow",
    contentTypes: input.domain.split(" "),
    usageFrequency: "frequent",
    stakes: [],
  },
  surface: {
    type: input.surfaceType,
    primaryAction: "Continue",
    supportedViewports: [390, 768, 1440],
    requiredStates: ["loading", "empty", "error", "success"],
  },
  direction: { requestedTone: [], antiGoals: ["generic UI"], existingDirection: "none" },
  evidence: {
    observed: [{ statement: `Domain: ${input.domain}`, source: "test fixture" }],
    inferred: [], assumed: [], unknown: [],
  },
});

test("loads all six rule families with unique versioned ids", async () => {
  const library = await loadDesignRuleLibrary();
  assert.ok(library.rules.every((rule) => rule.schemaVersion === "1.1"));
  const publishedSchema = JSON.parse(await readFile("domains/frontend/schemas/design-rule.schema.json", "utf8"));
  assert.equal(publishedSchema.properties.schemaVersion.const, "1.1");
  assert.deepEqual([...new Set(library.rules.map(({ family }) => family))], [
    "typography", "layout", "responsive", "color", "state", "signature-move",
  ]);
  assert.equal(library.rules.length, 18);
  assert.deepEqual(library.rules.map(({ id }) => id), [
    "typography.role-contrast", "typography.editorial-product", "typography.dense-workspace",
    "layout.action-evidence", "layout.list-detail", "layout.commerce-comparison",
    "responsive.recompose-not-stack", "responsive.list-detail-drill-in", "responsive.mobile-thumb-zone",
    "color.semantic-roles", "color.commerce-trust", "color.operational-status",
    "state.complete-primary-flow", "state.recovery-first", "state.optimistic-offline",
    "signature.product-data-grammar", "signature.conversion-proof", "signature.repeated-action-feedback",
  ]);
  assert.ok(library.rules.every((rule) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(rule.version)));
  assert.ok(library.rules.every((rule) => rule.provenance.length >= 2 && rule.verification.length > 0));
  assert.ok(library.rules.every((rule) => rule.provenance.every((entry) =>
    entry.source.startsWith("https://") && entry.page?.length && entry.state?.length &&
    entry.extractionMethod.length > 0 && entry.extractionSchema.length > 0 &&
    entry.evidenceStatus.length > 0 && (entry.reviewedAt || entry.capturedAt))
  ));
  assert.ok(library.rules.every((rule) => new Set(rule.provenance.map(({ source }) => source)).size >= 2));
  const ledger = await readFile("docs/FRONTEND_DESIGN_PATTERN_DISTILLATION_2026-08-04.md", "utf8");
  assert.match(ledger, /Provenance ledger/);
  assert.match(ledger, /Refero Linear style/);
  assert.match(ledger, /DesignMD Linear benchmark/);
  assert.match(ledger, /recurr/i);
});

test("selects one compatible rule from every family", async () => {
  const families = ["typography", "layout", "responsive", "color", "state", "signature-move"] as const;
  const library = await loadDesignRuleLibrary();
  for (const recipeId of frontendRecipeIds) {
    const selected = selectDesignRules(library, { recipeId, families: [...families] });
    assert.equal(selected.length, 6);
    assert.ok(selected.every((rule) => rule.recipeIds.includes(recipeId) || rule.recipeIds.includes("*")));
  }
});

const makeDirection = (recipeId: string): DesignDirection => ({
  schemaVersion: "1.0",
  recipeId,
  selectedRuleIds: [
    "typography.role-contrast",
    "layout.action-evidence",
    "responsive.recompose-not-stack",
    "color.semantic-roles",
    "state.complete-primary-flow",
    "signature.product-data-grammar",
  ],
  thesis: "A product-specific direction.",
  productReason: "The product evidence supports this direction.",
  axes: {
    density: "balanced",
    hierarchy: "action-first",
    composition: "structured-list",
    material: "bordered",
    motionIntensity: "low",
    expressionLevel: "restrained",
  },
  typographyRoles: { body: "UI sans" },
  colorRoles: { accent: "primary action" },
  signatureMove: "Use the primary work object as the visual grammar.",
  rejectedDefaults: ["generic cards"],
  destructiveCritique: "The direction must preserve product evidence.",
});

test("rejects malformed design rule records at runtime", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-rules-"));
  try {
    await cp("domains/frontend/rules", root, { recursive: true });
    const file = path.join(root, "typography.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    source.rules[0].verification = [];
    await writeFile(file, JSON.stringify(source), "utf8");
    await assert.rejects(loadDesignRuleLibrary(root), /Invalid design rule contract/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const withRulesFixture = async (mutate: (root: string) => Promise<void> | void, assertion: RegExp) => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-rules-"));
  try {
    await cp("domains/frontend/rules", root, { recursive: true });
    await mutate(root);
    await assert.rejects(loadDesignRuleLibrary(root), assertion);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("rejects incomplete provenance metadata", async () => {
  await withRulesFixture(async (root) => {
    const file = path.join(root, "typography.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    delete source.rules[0].provenance[0].extractionSchema;
    await writeFile(file, JSON.stringify(source), "utf8");
  }, /provenance/);
});

test("rejects repeated provenance source records", async () => {
  await withRulesFixture(async (root) => {
    const file = path.join(root, "typography.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    source.rules[0].provenance[1].source = source.rules[0].provenance[0].source;
    await writeFile(file, JSON.stringify(source), "utf8");
  }, /two independent sources/);
});

test("rejects an invalid supplied provenance date even when the other date is valid", async () => {
  await withRulesFixture(async (root) => {
    const file = path.join(root, "typography.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    source.rules[0].provenance[0].reviewedAt = "2026-02-30";
    source.rules[0].provenance[0].capturedAt = "2026-08-04";
    await writeFile(file, JSON.stringify(source), "utf8");
  }, /provenance/);
});

test("rejects an unnormalized external design payload", async () => {
  await withRulesFixture(async (root) => {
    await writeFile(path.join(root, "typography.json"), JSON.stringify({
      schemaVersion: "1.0",
      family: "typography",
      rules: [{
        name: "External DESIGN.md output",
        colors: { accent: "#fff" },
        typography: { body: "Inter" },
      }],
    }), "utf8");
  }, /Invalid design rule contract/);
});

test("rejects vendor fields added to a normalized rule file envelope", async () => {
  await withRulesFixture(async (root) => {
    const file = path.join(root, "typography.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    source.tokens = { "--font-body": "Inter" };
    await writeFile(file, JSON.stringify(source), "utf8");
  }, /Invalid design rule file/);
});

test("rejects unknown recipe compatibility ids", async () => {
  await withRulesFixture(async (root) => {
    const file = path.join(root, "typography.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    source.rules[0].recipeIds = ["un-normalized-external-recipe"];
    await writeFile(file, JSON.stringify(source), "utf8");
  }, /Unknown recipe id/);
});

test("rejects an index that does not preserve all ordered families", async () => {
  await withRulesFixture(async (root) => {
    const file = path.join(root, "index.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    delete source.files.color;
    source.files.typography = "color.json";
    await writeFile(file, JSON.stringify(source), "utf8");
  }, /all six families|ordered/);
});

test("rejects duplicate stable rule identifiers", async () => {
  await withRulesFixture(async (root) => {
    const file = path.join(root, "layout.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    source.rules[1].id = source.rules[0].id;
    await writeFile(file, JSON.stringify(source), "utf8");
  }, /Duplicate design rule id/);
});

test("accepts a normative rule revision only with a semantic version and independent products", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-rules-"));
  try {
    await cp("domains/frontend/rules", root, { recursive: true });
    const file = path.join(root, "typography.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    source.rules[0].version = "1.1.0";
    source.rules[0].constraints[0] = "The revised normative constraint is explicit.";
    source.rules[0].provenance[0].productId = "linear";
    source.rules[0].provenance[1].productId = "stripe";
    await writeFile(file, JSON.stringify(source), "utf8");
    const library = await loadDesignRuleLibrary(root);
    assert.equal(library.rules.find(({ id }) => id === "typography.role-contrast")?.version, "1.1.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a normative rule revision backed only by two extractors of one product", async () => {
  await withRulesFixture(async (root) => {
    const file = path.join(root, "typography.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    source.rules[0].version = "1.1.0";
    source.rules[0].constraints[0] = "A revision backed only by repeated Linear extraction.";
    source.rules[0].provenance[0].productId = "linear";
    source.rules[0].provenance[1].productId = "linear";
    await writeFile(file, JSON.stringify(source), "utf8");
  }, /two independent products/);
});

test("requires a version change for normative edits but permits wording and provenance corrections", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-rules-"));
  try {
    await cp("domains/frontend/rules", root, { recursive: true });
    const file = path.join(root, "typography.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    source.rules[0].constraints[0] = "A normative edit without a version change.";
    await writeFile(file, JSON.stringify(source), "utf8");
    await assert.rejects(loadDesignRuleLibrary(root), /requires an explicit semantic version change/);

    source.rules[0].version = "1.1.0";
    source.rules[0].provenance[0].productId = "linear";
    source.rules[0].provenance[1].productId = "stripe";
    await writeFile(file, JSON.stringify(source), "utf8");
    await loadDesignRuleLibrary(root);

    source.rules[0].version = "1.0.0";
    source.rules[0].name = "A wording correction only";
    source.rules[0].provenance[0].source = "SkillRanger curated frontend research (corrected label)";
    source.rules[0].constraints[0] = JSON.parse(await readFile("domains/frontend/rules/typography.json", "utf8")).rules[0].constraints[0];
    await writeFile(file, JSON.stringify(source), "utf8");
    await loadDesignRuleLibrary(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a non-semantic design-rule version", async () => {
  await withRulesFixture(async (root) => {
    const file = path.join(root, "typography.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    source.rules[0].version = "1.0";
    await writeFile(file, JSON.stringify(source), "utf8");
  }, /semantic version/);
});

test("requires recipe selection to cover the ordered six-family contract", async () => {
  const library = await loadDesignRuleLibrary();
  assert.throws(
    () => selectDesignRules(library, { recipeId: "unknown-recipe", families: [...designRuleFamilies] }),
    /Unknown frontend recipe/,
  );
  assert.throws(
    () => selectDesignRules(library, { recipeId: frontendRecipeIds[0], families: ["typography", "typography"] }),
    /exactly one rule from each ordered family/,
  );
});

test("validates six selected rule families on a design direction", () => {
  const invalid = makeDirection("e-commerce");
  invalid.selectedRuleIds[5] = "state.recovery-first";
  assert.ok(validateDesignDirection(
    makeBrief({ domain: "commerce", surfaceType: "storefront" }),
    invalid,
  ).some(({ code }) => code === "direction-rule-selection-contract"));
});

test("preserves schema 1.0 directions created before rule selection metadata", () => {
  const legacy = makeDirection("developer-tool") as DesignDirection & { selectedRuleIds?: string[] };
  delete legacy.selectedRuleIds;
  const codes = validateDesignDirection(
    makeBrief({ domain: "developer tool", surfaceType: "workspace" }),
    legacy,
  ).map(({ code }) => code);
  assert.equal(codes.includes("direction-rule-selection-contract"), false);
  assert.equal(codes.includes("direction-structure-contract"), false);
});

test("loads exactly eight stable frontend recipes", async () => {
  assert.deepEqual(frontendRecipeIds, [
    "operational-command-center", "consumer-discovery", "developer-tool", "editorial-content",
    "marketing-landing", "saas-workspace", "e-commerce", "mobile-consumer-app",
  ]);
  const recipes = await loadFrontendRecipes();
  assert.equal(recipes.length, 8);
  assert.deepEqual(recipes.map(({ id }) => id), frontendRecipeIds);
  for (const recipeId of frontendRecipeIds) {
    assert.equal(
      validateDesignDirection(makeBrief({ domain: recipeId, surfaceType: "application" }), makeDirection(recipeId))
        .some(({ code }) => code === "direction-recipe-contract"),
      false,
      recipeId,
    );
  }
});

test("ranks each new product recipe from product evidence", async () => {
  const cases = [
    ["marketing campaigns conversion proof", "landing page", "marketing-landing"],
    ["team workspace projects collaboration", "workspace", "saas-workspace"],
    ["product catalog cart checkout orders", "storefront", "e-commerce"],
    ["daily habit feed camera notifications", "mobile app", "mobile-consumer-app"],
  ] as const;
  for (const [domain, surfaceType, expected] of cases) {
    const brief = makeBrief({ domain, surfaceType });
    assert.equal(recommendFrontendRecipe(brief, await loadFrontendRecipes())[0].recipe.id, expected);
  }
});

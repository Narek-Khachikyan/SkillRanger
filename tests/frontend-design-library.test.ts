import test from "node:test";
import assert from "node:assert/strict";
import {
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
  assert.deepEqual([...new Set(library.rules.map(({ family }) => family))].sort(),
    ["color", "layout", "responsive", "signature-move", "state", "typography"]);
  assert.equal(library.rules.length, 18);
  assert.equal(new Set(library.rules.map(({ id }) => id)).size, library.rules.length);
  assert.ok(library.rules.every((rule) => rule.version === "1.0.0"));
  assert.ok(library.rules.every((rule) => rule.provenance.length > 0 && rule.verification.length > 0));
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

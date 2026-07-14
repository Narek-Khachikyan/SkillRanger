import test from "node:test";
import assert from "node:assert/strict";
import {
  frontendRecipeIds,
  loadFrontendRecipes,
  recommendFrontendRecipe,
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

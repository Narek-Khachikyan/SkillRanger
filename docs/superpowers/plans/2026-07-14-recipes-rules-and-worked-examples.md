# Recipes, Rules, And Worked Examples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the frontend knowledge base to eight recipes and provide validated, versioned design rules plus concrete good/bad desktop/mobile/state examples for every recipe.

**Architecture:** A static recipe catalog replaces duplicated recipe-id lists. A versioned rule library stores reusable design decisions as data grouped into six families, while recipe example packs store product-specific scenes and explanations. A dependency-free SVG renderer generates deterministic visual plates from those scenes so examples are inspectable in the repository and testable without installing a browser.

**Tech Stack:** TypeScript 6, Node.js 24 built-ins, Node test runner, JSON Schema 2020-12, deterministic SVG generation.

## Global Constraints

- Keep every recipe at schema version `1.0` and preserve the four existing recipe ids.
- Add exactly `marketing-landing`, `saas-workspace`, `e-commerce`, and `mobile-consumer-app`.
- Keep recipe selection product-evidence-driven; do not add style-only recipes.
- Rules must declare provenance, compatible recipe ids, preconditions, constraints, accessibility notes, anti-patterns, and verification criteria.
- Include all six rule families: typography, layout, responsive, color, state, and signature move.
- Every recipe example pack must contain good and bad success results on desktop and mobile plus good and bad loading, empty, and error states.
- Example copy must use neutral structural content and must not imply real metrics, testimonials, people, brands, or transactions.
- Generated SVG plates are explanatory evidence, not production UI templates or arbitrary JSX/CSS.
- Use TDD for every task and commit only the files listed for that task.

---

### Task 1: Eight-recipe catalog and validation

**Files:**
- Create: `src/domains/frontend/design/catalog.ts`
- Create: `domains/frontend/recipes/marketing-landing.json`
- Create: `domains/frontend/recipes/saas-workspace.json`
- Create: `domains/frontend/recipes/e-commerce.json`
- Create: `domains/frontend/recipes/mobile-consumer-app.json`
- Modify: `src/domains/frontend/design/index.ts`
- Modify: `src/domains/frontend/design/validation.ts`
- Modify: `domains/frontend/domain.manifest.json`
- Test: `tests/frontend-design-library.test.ts`
- Test: `tests/frontend-design-runtime.test.ts`

**Interfaces:**
- Produces: `frontendRecipeFiles`, `frontendRecipeIds`, `loadFrontendRecipes()`, and eight valid `DesignRecipe` records.
- Consumes: current `DesignRecipe` type and `defaultDomainsRoot`.

- [ ] **Step 1: Write failing catalog and recommendation tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  frontendRecipeIds,
  loadFrontendRecipes,
  recommendFrontendRecipe,
  type DesignBrief,
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

test("loads exactly eight stable frontend recipes", async () => {
  assert.deepEqual(frontendRecipeIds, [
    "operational-command-center", "consumer-discovery", "developer-tool", "editorial-content",
    "marketing-landing", "saas-workspace", "e-commerce", "mobile-consumer-app",
  ]);
  const recipes = await loadFrontendRecipes();
  assert.equal(recipes.length, 8);
  assert.deepEqual(recipes.map(({ id }) => id), frontendRecipeIds);
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
```

- [ ] **Step 2: Run the focused test and confirm missing recipes/catalog**

Run: `node --test tests/frontend-design-library.test.ts`

Expected: FAIL because `frontendRecipeIds` is not exported and only four recipe files exist.

- [ ] **Step 3: Add the catalog and exact new recipe records**

```ts
export const frontendRecipeFiles = [
  "operational-command-center.json",
  "consumer-discovery.json",
  "developer-tool.json",
  "editorial-content.json",
  "marketing-landing.json",
  "saas-workspace.json",
  "e-commerce.json",
  "mobile-consumer-app.json",
] as const;

export const frontendRecipeIds = frontendRecipeFiles.map((file) => file.replace(/\.json$/, ""));
```

Create the four JSON files with these exact product decisions:

| id | domain signals | layout models | density | hierarchy | required extra states | signature move | forbidden defaults |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `marketing-landing` | marketing, landing, campaign, conversion, launch, pricing, proof | editorial-grid, structured-list, grid | spacious, balanced | narrative-first, action-first | pricing-unavailable, form-error | Turn supplied proof, product mechanism, or conversion path into the page rhythm | fake testimonials, invented logos, generic three-card feature grid, unrelated gradient orb |
| `saas-workspace` | workspace, collaboration, project, task, team, settings, inbox | split-pane, structured-list, table | balanced, compact | action-first, exception-first, data-first | first-run, no-permission, sync-error | Use the real work object and its lifecycle as navigation and hierarchy | dashboard metric cards without decisions, nested generic cards, decorative activity feed |
| `e-commerce` | commerce, store, product, catalog, cart, checkout, order, inventory | grid, structured-list, split-pane | balanced, spacious | action-first, narrative-first, data-first | unavailable, cart-empty, payment-error | Make product evidence, price, availability, and fulfillment state the visual grammar | fake reviews, invented discounts, hidden fulfillment cost, identical product cards without comparison cues |
| `mobile-consumer-app` | mobile, habit, feed, camera, chat, fitness, music, social, notification | structured-list, timeline, grid | balanced, spacious | action-first, narrative-first | first-run, offline, permission-denied | Organize the composition around a one-thumb repeated action and immediate state feedback | desktop navigation shrunk to mobile, floating action without task meaning, excessive carousels, gesture-only actions |

Each file must also include one complete `appropriateWhen`, one `inappropriateWhen`, a mobile strategy, and three validation rules. Use product language from the table and include `loading`, `empty`, and `error` in `requiredStates`.

Replace the private `recipeFiles` in `index.ts` and the hard-coded `supportedRecipeIds` in `validation.ts` with imports from `catalog.ts`. Add all four paths to the domain manifest.

- [ ] **Step 4: Run catalog, direction, and domain-pack tests**

Run: `node --test tests/frontend-design-library.test.ts tests/frontend-design-runtime.test.ts tests/domain-pack.test.ts && npm run build`

Expected: PASS; all eight recipe ids validate in `DesignDirection.recipeId`.

- [ ] **Step 5: Commit the recipe expansion**

```bash
git add src/domains/frontend/design/catalog.ts src/domains/frontend/design/index.ts src/domains/frontend/design/validation.ts domains/frontend/recipes domains/frontend/domain.manifest.json tests/frontend-design-library.test.ts tests/frontend-design-runtime.test.ts
git commit -m "feat(frontend): expand design recipes to eight"
```

---

### Task 2: Versioned design-rule library

**Files:**
- Create: `src/domains/frontend/design/library-types.ts`
- Create: `src/domains/frontend/design/library.ts`
- Create: `domains/frontend/schemas/design-rule.schema.json`
- Create: `domains/frontend/rules/typography.json`
- Create: `domains/frontend/rules/layout.json`
- Create: `domains/frontend/rules/responsive.json`
- Create: `domains/frontend/rules/color.json`
- Create: `domains/frontend/rules/state.json`
- Create: `domains/frontend/rules/signature-move.json`
- Create: `domains/frontend/rules/index.json`
- Modify: `src/domains/types.ts`
- Modify: `src/domains/frontend/design/index.ts`
- Modify: `domains/frontend/domain.manifest.json`
- Test: `tests/frontend-design-library.test.ts`

**Interfaces:**
- Produces: `DesignRuleFamily`, `DesignRule`, `DesignRuleIndex`, `loadDesignRuleLibrary()`, `selectDesignRules(input)`, and optional domain artifact fields `rules?: string[]` and `examples?: string[]`.
- Consumes: recipe ids from Task 1.

- [ ] **Step 1: Add failing completeness and compatibility tests**

```ts
import { loadDesignRuleLibrary, selectDesignRules } from "../src/domains/frontend/design/index.ts";

test("loads all six rule families with unique versioned ids", async () => {
  const library = await loadDesignRuleLibrary();
  assert.deepEqual([...new Set(library.rules.map(({ family }) => family))].sort(),
    ["color", "layout", "responsive", "signature-move", "state", "typography"]);
  assert.equal(new Set(library.rules.map(({ id }) => id)).size, library.rules.length);
  assert.ok(library.rules.every((rule) => rule.version === "1.0.0"));
  assert.ok(library.rules.every((rule) => rule.provenance.length > 0 && rule.verification.length > 0));
});

test("selects one compatible rule from every family", async () => {
  const selected = selectDesignRules(await loadDesignRuleLibrary(), {
    recipeId: "e-commerce",
    families: ["typography", "layout", "responsive", "color", "state", "signature-move"],
  });
  assert.equal(selected.length, 6);
  assert.ok(selected.every((rule) => rule.recipeIds.includes("e-commerce") || rule.recipeIds.includes("*")));
});
```

- [ ] **Step 2: Run the test and verify the library module is missing**

Run: `node --test tests/frontend-design-library.test.ts`

Expected: FAIL on the missing `loadDesignRuleLibrary` export.

- [ ] **Step 3: Define the rule contract and library loader**

```ts
export type DesignRuleFamily = "typography" | "layout" | "responsive" | "color" | "state" | "signature-move";

export type DesignRule = {
  schemaVersion: "1.0";
  id: string;
  version: "1.0.0";
  family: DesignRuleFamily;
  name: string;
  recipeIds: string[];
  preconditions: string[];
  intent: string;
  constraints: string[];
  rolesConsumed: string[];
  responsiveBehavior: string[];
  accessibility: string[];
  antiPatterns: string[];
  verification: string[];
  provenance: Array<{ source: string; reviewedAt: string }>;
};

export type DesignRuleIndex = {
  schemaVersion: "1.0";
  files: Record<DesignRuleFamily, string>;
};
```

`loadDesignRuleLibrary` reads `index.json`, loads every declared file under `domains/frontend/rules`, rejects duplicate ids, unknown recipe ids, missing families, and paths escaping the rules root. `selectDesignRules` preserves the requested family order and throws `No compatible <family> rule for recipe <id>` when a family has no compatible rule.

Extend `DomainPackManifest.artifacts` with optional `rules?: string[]` and `examples?: string[]`. Add `"rules": ["rules/index.json"]` to the frontend manifest; Task 3 will populate `examples`.

Create at least these exact ids so every family has a cross-recipe baseline and a specialized option:

```text
typography.role-contrast, typography.editorial-product, typography.dense-workspace
layout.action-evidence, layout.list-detail, layout.commerce-comparison
responsive.recompose-not-stack, responsive.list-detail-drill-in, responsive.mobile-thumb-zone
color.semantic-roles, color.commerce-trust, color.operational-status
state.complete-primary-flow, state.recovery-first, state.optimistic-offline
signature.product-data-grammar, signature.conversion-proof, signature.repeated-action-feedback
```

For `typography.role-contrast`, use `recipeIds: ["*"]`, require display/body/meta roles, forbid size-only hierarchy, require at least `1.25` scale between adjacent display roles, preserve `45–75ch` reading measure, and verify heading semantics plus computed role contrast. For every other id, encode the named product decision in `intent`, at least two constraints, one anti-pattern, one accessibility rule, one verification rule, and provenance `{ "source": "SkillRanger curated frontend research", "reviewedAt": "2026-07-14" }`.

- [ ] **Step 4: Run library and path-safety tests**

Run: `node --test tests/frontend-design-library.test.ts tests/domain-pack.test.ts && npm run build`

Expected: PASS; the library contains 18 unique rules and every recipe can select all six families.

- [ ] **Step 5: Commit the rule library**

```bash
git add src/domains/types.ts src/domains/frontend/design/library-types.ts src/domains/frontend/design/library.ts src/domains/frontend/design/index.ts domains/frontend/schemas/design-rule.schema.json domains/frontend/rules domains/frontend/domain.manifest.json tests/frontend-design-library.test.ts
git commit -m "feat(frontend): add verified design rule library"
```

---

### Task 3: Worked example packs and deterministic visual plates

**Files:**
- Create: `src/domains/frontend/design/example-types.ts`
- Create: `src/domains/frontend/design/examples.ts`
- Create: `src/domains/frontend/design/example-renderer.ts`
- Create: `src/domains/frontend/design/generate-example-assets.ts`
- Create: `domains/frontend/schemas/recipe-example.schema.json`
- Create: `domains/frontend/examples/operational-command-center/example.json`
- Create: `domains/frontend/examples/consumer-discovery/example.json`
- Create: `domains/frontend/examples/developer-tool/example.json`
- Create: `domains/frontend/examples/editorial-content/example.json`
- Create: `domains/frontend/examples/marketing-landing/example.json`
- Create: `domains/frontend/examples/saas-workspace/example.json`
- Create: `domains/frontend/examples/e-commerce/example.json`
- Create: `domains/frontend/examples/mobile-consumer-app/example.json`
- Generate: `domains/frontend/examples/*/assets/*.svg`
- Modify: `src/domains/frontend/design/index.ts`
- Modify: `domains/frontend/domain.manifest.json`
- Test: `tests/frontend-recipe-examples.test.ts`

**Interfaces:**
- Produces: `RecipeExamplePack`, `ExampleScene`, `loadRecipeExamplePacks()`, `renderExamplePlate(scene)`, and `generateExampleAssets(root)`.
- Consumes: eight recipe ids and rule ids from Tasks 1–2.

- [ ] **Step 1: Write failing 8-pack, 80-asset, and explanation tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { loadRecipeExamplePacks } from "../src/domains/frontend/design/index.ts";

test("ships complete good/bad desktop/mobile/state packs", async () => {
  const packs = await loadRecipeExamplePacks();
  assert.equal(packs.length, 8);
  for (const pack of packs) {
    const keys = new Set(pack.scenes.map((scene) => `${scene.quality}:${scene.viewport}:${scene.state}`));
    for (const required of [
      "good:desktop:success", "bad:desktop:success", "good:mobile:success", "bad:mobile:success",
      "good:mobile:loading", "bad:mobile:loading", "good:mobile:empty", "bad:mobile:empty",
      "good:mobile:error", "bad:mobile:error",
    ]) assert.ok(keys.has(required), `${pack.recipeId} lacks ${required}`);
    assert.equal(pack.scenes.length, 10);
    assert.ok(pack.differenceExplanation.length >= 3);
    for (const scene of pack.scenes) assert.ok((await stat(scene.assetPath)).size > 100);
  }
});
```

- [ ] **Step 2: Run the test and confirm example packs are absent**

Run: `node --test tests/frontend-recipe-examples.test.ts`

Expected: FAIL because `loadRecipeExamplePacks` is not exported.

- [ ] **Step 3: Define example data and the safe SVG renderer**

```ts
export type ExampleScene = {
  id: string;
  quality: "good" | "bad";
  viewport: "desktop" | "mobile";
  state: "success" | "loading" | "empty" | "error";
  title: string;
  primaryAction: string;
  blocks: Array<{ kind: "heading" | "copy" | "action" | "list" | "media" | "status"; label: string; emphasis: 1 | 2 | 3 }>;
  appliedRuleIds: string[];
  violatedRuleIds: string[];
  asset: string;
};

export type RecipeExamplePack = {
  schemaVersion: "1.0";
  recipeId: string;
  productScenario: string;
  differenceExplanation: string[];
  scenes: ExampleScene[];
};
```

`renderExamplePlate` must XML-escape every label, use fixed canvases `1440x900` and `390x844`, use only semantic palette constants, show state labels visibly, and render bad scenes with the declared violated-rule ids in a footer. It must never interpolate raw SVG markup from example JSON. `generateExampleAssets` writes each scene to `<pack>/assets/<scene.id>.svg` and rejects output paths outside the pack.

Set `artifacts.examples` in `domains/frontend/domain.manifest.json` to the eight `examples/<recipe-id>/example.json` paths in recipe catalog order.

Use these exact neutral scenarios and primary objects:

| recipe | scenario | primary object/action |
| --- | --- | --- |
| operational-command-center | Incident queue with stale and assigned states | incident / Triage incident |
| consumer-discovery | Saved reading catalogue with filters | title / Save title |
| developer-tool | Repository run diagnostics | run / Inspect failure |
| editorial-content | Sourced implementation guide | section / Continue reading |
| marketing-landing | Product capability explanation with supplied proof slot | capability / Request access |
| saas-workspace | Team project task list with permissions | task / Update status |
| e-commerce | Product comparison with availability and fulfillment | product / Add to cart |
| mobile-consumer-app | Daily habit check-in with offline recovery | check-in / Mark complete |

For every pack, the three difference explanations must cover hierarchy/composition, semantic roles/state recovery, and mobile transformation. Good scenes apply at least one rule from each relevant family; bad scenes violate at least three named rules. Use only labels from the scenario table plus `Loading`, `Nothing here yet`, `Try again`, `Unavailable`, `Permission required`, and `Offline`.

- [ ] **Step 4: Generate and validate all assets**

Run:

```bash
node src/domains/frontend/design/generate-example-assets.ts
node --test tests/frontend-recipe-examples.test.ts tests/frontend-design-library.test.ts
git diff --check
```

Expected: PASS; exactly 80 SVG files exist and a second generator run produces no diff.

- [ ] **Step 5: Commit examples and generated evidence**

```bash
git add src/domains/frontend/design/example-types.ts src/domains/frontend/design/examples.ts src/domains/frontend/design/example-renderer.ts src/domains/frontend/design/generate-example-assets.ts src/domains/frontend/design/index.ts domains/frontend/schemas/recipe-example.schema.json domains/frontend/examples domains/frontend/domain.manifest.json tests/frontend-recipe-examples.test.ts
git commit -m "feat(frontend): add worked recipe example packs"
```

---

### Task 4: Library documentation and constrained-profile consumption

**Files:**
- Create: `docs/design-rule-library.md`
- Modify: `domains/frontend/README.md`
- Modify: `docs/domains/frontend.md`
- Modify: `registry/skills/frontend.visual-design-polish/references/visual-rules.md`
- Modify: `registry/skills/frontend.visual-design-polish/references/evidence-examples.md`
- Modify: `registry/skills/frontend.visual-design-polish/SKILL.md`
- Modify: `registry/skills/frontend.visual-design-polish/workflow.json`
- Test: `tests/design-skill-contracts.test.ts`

**Interfaces:**
- Consumes: recipe, rule, and example ids from Tasks 1–3.
- Produces: agent-readable lookup rules and a constrained-profile requirement to select library rule ids before implementation.

- [ ] **Step 1: Add failing documentation-contract tests**

```ts
test("visual design skill references the canonical rule and example libraries", async () => {
  const skill = await readFile("registry/skills/frontend.visual-design-polish/SKILL.md", "utf8");
  const rules = await readFile("registry/skills/frontend.visual-design-polish/references/visual-rules.md", "utf8");
  const examples = await readFile("registry/skills/frontend.visual-design-polish/references/evidence-examples.md", "utf8");
  assert.match(skill, /selected rule ids/i);
  assert.match(rules, /domains\/frontend\/rules\/index\.json/);
  assert.match(examples, /domains\/frontend\/examples\/<recipe-id>\/example\.json/);
});
```

- [ ] **Step 2: Run the contract test and verify the new paths are missing**

Run: `node --test tests/design-skill-contracts.test.ts`

Expected: FAIL on at least one missing canonical library path.

- [ ] **Step 3: Document lookup and selection behavior**

`docs/design-rule-library.md` must document: six families, rule field meanings, recipe compatibility, provenance, constrained selection of exactly one compatible rule per family, standard comparison using rule ids, advanced deviations with destructive critique, example asset generation, and the rule that example SVGs are explanatory rather than code templates.

Update the skill references to require agents to record selected rule ids in structured direction metadata and to compare their direction against the recipe's good/bad pack before implementation. Update constrained workflow instructions to require six selected rule ids.

- [ ] **Step 4: Run registry and documentation checks**

Run: `node --test tests/design-skill-contracts.test.ts tests/frontend-recipe-examples.test.ts && npm run validate:registry && npm run lint:skills`

Expected: PASS with resolvable library paths and no skill lint issues.

- [ ] **Step 5: Commit library documentation**

```bash
git add docs/design-rule-library.md docs/domains/frontend.md domains/frontend/README.md registry/skills/frontend.visual-design-polish tests/design-skill-contracts.test.ts
git commit -m "docs(frontend): connect skills to design knowledge library"
```

## Plan Verification

Run:

```bash
npm run build
node --test tests/frontend-design-library.test.ts tests/frontend-recipe-examples.test.ts tests/frontend-design-runtime.test.ts tests/design-skill-contracts.test.ts tests/domain-pack.test.ts
npm run validate:registry
npm run lint:skills
node src/domains/frontend/design/generate-example-assets.ts
git diff --exit-code -- domains/frontend/examples
```

Expected: every command exits `0`; eight recipes, 18 versioned rules, eight example packs, and 80 deterministic SVG assets are present.

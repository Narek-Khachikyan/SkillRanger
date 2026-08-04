import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  compareRecipeExamplePack,
  frontendRecipeIds,
  generateExampleAssets,
  loadDesignRuleLibrary,
  loadRecipeExamplePacks,
  renderExamplePlate,
  type ExampleScene,
} from "../src/domains/frontend/design/index.ts";
import { validateJsonSchema } from "../src/runtime/strict/json-schema.ts";

const copyExampleRoot = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-examples-"));
  await cp("domains/frontend/examples", root, { recursive: true });
  return root;
};

const mutatePack = async (
  root: string,
  recipeId: string,
  mutate: (source: Record<string, any>) => void,
) => {
  const file = path.join(root, recipeId, "example.json");
  const source = JSON.parse(await readFile(file, "utf8")) as Record<string, any>;
  mutate(source);
  await writeFile(file, JSON.stringify(source), "utf8");
};

test("ships complete good/bad desktop/mobile/state packs", async () => {
  const packs = await loadRecipeExamplePacks();
  assert.equal(packs.length, 8);
  let assetCount = 0;
  for (const pack of packs) {
    const keys = new Set(pack.scenes.map((scene) => `${scene.quality}:${scene.viewport}:${scene.state}`));
    for (const required of [
      "good:desktop:success", "bad:desktop:success", "good:mobile:success", "bad:mobile:success",
      "good:mobile:loading", "bad:mobile:loading", "good:mobile:empty", "bad:mobile:empty",
      "good:mobile:error", "bad:mobile:error",
    ]) assert.ok(keys.has(required), `${pack.recipeId} lacks ${required}`);
    assert.equal(pack.scenes.length, 10);
    assert.ok(pack.differenceExplanation.length >= 3);
    for (const scene of pack.scenes) {
      assert.ok((await stat(scene.assetPath)).size > 100);
      if (scene.quality === "good") assert.ok(scene.appliedRuleIds.length >= 6);
      else assert.ok(scene.violatedRuleIds.length >= 3);
      assetCount += 1;
    }
  }
  assert.equal(assetCount, 80);
});

test("packs satisfy the published schema and preserve provenance-backed relationships", async () => {
  const schema = JSON.parse(await readFile("domains/frontend/schemas/recipe-example.schema.json", "utf8"));
  const library = await loadDesignRuleLibrary();
  const rulesById = new Map(library.rules.map((rule) => [rule.id, rule]));
  const packs = await loadRecipeExamplePacks();

  for (const pack of packs) {
    const source = JSON.parse(await readFile(pack.sourcePath, "utf8"));
    assert.deepEqual(validateJsonSchema(schema, source), [], pack.recipeId);
    const explanation = pack.differenceExplanation.join(" ").toLowerCase();
    assert.match(explanation, /hierarchy|composition/);
    assert.match(explanation, /state|recovery|semantic/);
    assert.match(explanation, /mobile|responsive|recompos/);
    for (const scene of pack.scenes) {
      for (const ruleId of [...scene.appliedRuleIds, ...scene.violatedRuleIds]) {
        const rule = rulesById.get(ruleId);
        assert.ok(rule, `${pack.recipeId}/${scene.id} references ${ruleId}`);
        assert.ok(rule.provenance.every((entry) =>
          entry.source && entry.page && entry.state && (entry.reviewedAt || entry.capturedAt) &&
          entry.extractionMethod && entry.extractionSchema && entry.evidenceStatus,
        ));
      }
    }
  }
});

test("category packs encode their primary product relationships", async () => {
  const packs = new Map((await loadRecipeExamplePacks()).map((pack) => [pack.recipeId, pack]));
  const goodBlocks = (recipeId: string) => packs.get(recipeId)?.scenes
    .find(({ id }) => id === "good-desktop-success")?.blocks
    .map(({ kind, label }) => `${kind}:${label}`) ?? [];
  assert.deepEqual(goodBlocks("developer-tool"), [
    "action:Run command", "status:Failed step", "list:Log evidence", "action:Retry run",
  ]);
  assert.deepEqual(goodBlocks("e-commerce"), [
    "media:Selected variant", "status:Available", "copy:Price and cart summary", "action:Add to cart",
  ]);
  assert.deepEqual(goodBlocks("editorial-content"), [
    "heading:Current section", "list:Guide navigation", "copy:Source context", "action:Continue reading",
  ]);
});

test("a structured visual direction can compare its selected rules with the canonical pack", async () => {
  const pack = (await loadRecipeExamplePacks()).find(({ recipeId }) => recipeId === "developer-tool");
  assert.ok(pack);
  const comparison = compareRecipeExamplePack(pack, {
    recipeId: "developer-tool",
    selectedRuleIds: [
      "typography.role-contrast",
      "layout.action-evidence",
      "responsive.recompose-not-stack",
      "color.semantic-roles",
      "state.complete-primary-flow",
      "signature.product-data-grammar",
    ],
  });
  assert.equal(comparison.ok, true);
  assert.deepEqual(comparison.matchedRuleIds, comparison.selectedRuleIds);
  assert.equal(comparison.badReferenceRuleIds.length, 3);
  assert.ok(comparison.matchedViolationRuleIds.length >= 1);
  assert.deepEqual(comparison.findings, []);
});

test("rejects incomplete example packs at runtime", async () => {
  const root = await copyExampleRoot();
  try {
    const file = path.join(root, "consumer-discovery", "example.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    source.scenes.pop();
    await writeFile(file, JSON.stringify(source), "utf8");
    await assert.rejects(loadRecipeExamplePacks(root), /Invalid recipe example pack|schema rejected/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generator rejects assets that do not match the scene id", async () => {
  const root = await copyExampleRoot();
  try {
    const file = path.join(root, "operational-command-center", "example.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    source.scenes[0].asset = "example.json";
    await writeFile(file, JSON.stringify(source), "utf8");
    await assert.rejects(generateExampleAssets(root), /asset must match assets\/good-desktop-success\.svg|schema rejected/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unknown, incompatible, duplicate, missing, and non-neutral references", async () => {
  const cases: Array<{
    name: string;
    recipeId: string;
    mutate: (source: Record<string, any>) => void;
    assertion: RegExp;
  }> = [
    {
      name: "unknown rule",
      recipeId: "consumer-discovery",
      mutate: (source) => { source.scenes[0].appliedRuleIds[0] = "missing.rule"; },
      assertion: /Unknown design rule id/,
    },
    {
      name: "incompatible rule",
      recipeId: "marketing-landing",
      mutate: (source) => {
        source.scenes[1].violatedRuleIds = [
          "layout.list-detail", "typography.role-contrast", "state.complete-primary-flow",
        ];
      },
      assertion: /Incompatible design rule/,
    },
    {
      name: "duplicate rule",
      recipeId: "developer-tool",
      mutate: (source) => { source.scenes[0].appliedRuleIds.push(source.scenes[0].appliedRuleIds[0]); },
      assertion: /unique|duplicate|schema/i,
    },
    {
      name: "missing rule list",
      recipeId: "e-commerce",
      mutate: (source) => { delete source.scenes[0].appliedRuleIds; },
      assertion: /required|Invalid recipe example scene|schema/i,
    },
    {
      name: "non-neutral supplied copy",
      recipeId: "saas-workspace",
      mutate: (source) => { source.scenes[0].blocks[0].label = "Acme testimonial"; },
      assertion: /non-neutral scene copy/,
    },
    {
      name: "generic relationship explanation",
      recipeId: "consumer-discovery",
      mutate: (source) => {
        source.differenceExplanation = [
          "Good hierarchy and bad composition.",
          "Good states and bad recovery.",
          "Good mobile and bad stacking.",
        ];
      },
      assertion: /relationship explanation must refer to supplied scene material/,
    },
  ];

  for (const { name, recipeId, mutate, assertion } of cases) {
    const root = await copyExampleRoot();
    try {
      await mutatePack(root, recipeId, mutate);
      await assert.rejects(loadRecipeExamplePacks(root), assertion, name);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("rejects duplicate scene ids and missing assets", async () => {
  const duplicateRoot = await copyExampleRoot();
  try {
    await mutatePack(duplicateRoot, "operational-command-center", (source) => {
      source.scenes[1].id = source.scenes[0].id;
    });
    await assert.rejects(loadRecipeExamplePacks(duplicateRoot), /Duplicate example scene id/);
  } finally {
    await rm(duplicateRoot, { recursive: true, force: true });
  }

  const missingAssetRoot = await copyExampleRoot();
  try {
    await rm(path.join(missingAssetRoot, "consumer-discovery", "assets", "good-desktop-success.svg"));
    await assert.rejects(loadRecipeExamplePacks(missingAssetRoot), /asset/i);
  } finally {
    await rm(missingAssetRoot, { recursive: true, force: true });
  }
});

test("rebuilds missing assets deterministically with zero diff", async () => {
  const root = await copyExampleRoot();
  try {
    for (const recipeId of frontendRecipeIds) {
      await rm(path.join(root, recipeId, "assets"), { recursive: true, force: true });
    }
    const firstPaths = await generateExampleAssets(root);
    const first = await Promise.all(firstPaths.map(async (file) => [file, await readFile(file, "utf8")] as const));
    const secondPaths = await generateExampleAssets(root);
    const second = await Promise.all(secondPaths.map(async (file) => [file, await readFile(file, "utf8")] as const));
    assert.deepEqual(secondPaths, firstPaths);
    assert.deepEqual(second, first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects symlinked asset directories before generation can escape a pack", async () => {
  const root = await copyExampleRoot();
  const outside = await mkdtemp(path.join(tmpdir(), "skillranger-example-outside-"));
  try {
    await rm(path.join(root, "operational-command-center", "assets"), { recursive: true, force: true });
    try {
      await symlink(outside, path.join(root, "operational-command-center", "assets"), "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    await assert.rejects(generateExampleAssets(root), /symlink|escape/i);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("rejects a symlinked example root", async () => {
  const root = await copyExampleRoot();
  const aliasParent = await mkdtemp(path.join(tmpdir(), "skillranger-example-alias-"));
  const alias = path.join(aliasParent, "examples");
  try {
    try {
      await symlink(root, alias, "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    await assert.rejects(loadRecipeExamplePacks(alias), /real directory|symlink/i);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(aliasParent, { recursive: true, force: true });
  }
});

test("renders deterministic escaped semantic SVG plates", () => {
  const scene: ExampleScene = {
    id: "escape-check",
    quality: "bad",
    viewport: "mobile",
    state: "error",
    title: "Try <again>",
    primaryAction: "Try again",
    blocks: [{ kind: "status", label: "Offline & Unavailable", emphasis: 2 }],
    appliedRuleIds: [],
    violatedRuleIds: ["state.recovery-first", "color.semantic-roles", "layout.action-evidence"],
    asset: "assets/escape-check.svg",
  };
  const first = renderExamplePlate(scene);
  assert.equal(first, renderExamplePlate(scene));
  assert.match(first, /viewBox="0 0 390 844"/);
  assert.match(first, />ERROR</);
  assert.match(first, /Try &lt;again&gt;/);
  assert.match(first, /Offline &amp; Unavailable/);
  assert.doesNotMatch(first, /<script|className=|<div|<button|import\s/u);
  assert.doesNotMatch(first, /<again>/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  craftReferenceKinds,
  loadCraftCatalog,
  validateCraftCatalog,
  validateCraftEvidenceLadder,
  validateCraftMarkdownProvenance,
  type CraftCatalog,
} from "../src/domains/frontend/design/craft.ts";
import {
  designRuleFamilies,
  designRuleIds,
  loadDesignRuleLibrary,
  selectDesignRules,
} from "../src/domains/frontend/design/index.ts";
import { bundleFrontendCraft } from "../src/release/craft-bundle.ts";

const craftRoot = path.resolve("domains/frontend/craft");
const canonicalFiles = {
  "type-pairing": "type-pairings.md",
  "palette-recipe": "palette-recipes.md",
  "macrostructure": "macrostructures.md",
  "component-cookbook": "component-cookbooks.md",
} as const;

test("craft catalog declares the four reference kinds with present files", async () => {
  const { catalog, references } = await loadCraftCatalog(craftRoot);
  assert.deepEqual(Object.keys(catalog.categories), [...craftReferenceKinds]);
  assert.equal(catalog.schemaVersion, "1.0");
  assert.equal(catalog.id, "frontend-craft-catalog");
  for (const kind of craftReferenceKinds) {
    assert.equal(catalog.categories[kind], canonicalFiles[kind], kind);
    const file = await readFile(path.join(craftRoot, canonicalFiles[kind]), "utf8");
    assert.ok(file.trim().length > 0, `${canonicalFiles[kind]} must be non-empty`);
  }
  assert.deepEqual(
    references.map(({ kind, file }) => [kind, file]),
    craftReferenceKinds.map((kind) => [kind, canonicalFiles[kind]]),
  );
});

test("craft catalog and every reference carry the observed/inferred/assumed/unknown evidence ladder", async () => {
  const { catalog } = await loadCraftCatalog(craftRoot);
  const ladderKeys = ["observed", "inferred", "assumed", "unknown"];
  assert.deepEqual(Object.keys(catalog.provenance), ladderKeys);
  for (const key of ladderKeys) {
    assert.ok(Array.isArray(catalog.provenance[key]), key);
    for (const entry of catalog.provenance[key]) {
      assert.ok(entry.statement.trim().length > 0, `${key}: statement required`);
    }
  }
  for (const kind of craftReferenceKinds) {
    const markdown = await readFile(path.join(craftRoot, canonicalFiles[kind]), "utf8");
    assert.doesNotThrow(() => validateCraftMarkdownProvenance(markdown, canonicalFiles[kind]), kind);
  }
});

test("craft references are not rules: no rule ids, no families, no selection contract", async () => {
  const familyNames = new Set<string>(designRuleFamilies);
  const ruleIds = new Set<string>(designRuleIds);
  assert.ok(craftReferenceKinds.every((kind) => !familyNames.has(kind)), "craft kinds must be disjoint from rule families");
  assert.ok(craftReferenceKinds.every((kind) => !ruleIds.has(kind)), "craft kinds must be disjoint from rule ids");

  const library = await loadDesignRuleLibrary();
  assert.equal(library.rules.length, 18);
  assert.ok(library.rules.every((rule) => !craftReferenceKinds.includes(rule.family as never)));

  const selected = selectDesignRules(library, {
    recipeId: "e-commerce",
    families: [...designRuleFamilies],
  });
  assert.equal(selected.length, 6);
  assert.deepEqual(selected.map(({ family }) => family), [...designRuleFamilies]);

  const releaseManifest = JSON.parse(await readFile("domains/frontend/release.json", "utf8"));
  assert.equal(releaseManifest.ruleContract.ruleCount, 18);
  assert.equal(releaseManifest.ruleContract.families.length, 6);
  assert.ok(
    craftReferenceKinds.every((kind) => !releaseManifest.ruleContract.families.includes(kind)),
  );
  assert.ok(
    craftReferenceKinds.every((kind) => !releaseManifest.ruleContract.ruleIds.some((id: string) => id.includes(kind))),
  );
});

test("craft catalog rejects rule-contract fields and unknown keys", async () => {
  const catalog = JSON.parse(await readFile(path.join(craftRoot, "craft-catalog.json"), "utf8"));
  assert.throws(
    () => validateCraftCatalog({ ...catalog, ruleIds: ["typography.role-contrast"] }),
    /must not carry rule-contract fields/,
  );
  assert.throws(
    () => validateCraftCatalog({ ...catalog, family: "typography" }),
    /must not carry rule-contract fields/,
  );
  assert.throws(
    () => validateCraftCatalog({ ...catalog, selectedRuleIds: ["layout.action-evidence"] }),
    /must not carry rule-contract fields/,
  );
  assert.throws(
    () => validateCraftCatalog({ ...catalog, categories: { ...catalog.categories, "theme": "themes.md" } }),
    /exactly the four reference kinds/,
  );
  assert.throws(
    () => validateCraftCatalog({ ...catalog, schemaVersion: "1.1" }),
    /schemaVersion must be 1.0/,
  );
});

test("craft catalog rejects malformed evidence ladder entries", () => {
  assert.throws(
    () => validateCraftEvidenceLadder({ observed: [], inferred: [], assumed: [], unknown: [{ nope: true }] }, "catalog"),
    /Invalid craft evidence entry/,
  );
  assert.throws(
    () => validateCraftEvidenceLadder({ observed: [], inferred: [], assumed: [], unknown: [{ statement: "  " }] }, "catalog"),
    /non-empty statement/,
  );
  assert.throws(
    () => validateCraftEvidenceLadder({ observed: [], inferred: [], assumed: [] }, "catalog"),
    /evidence ladder/,
  );
  assert.throws(
    () => validateCraftEvidenceLadder({ observed: [], inferred: [], assumed: [], unknown: [], guessed: [] }, "catalog"),
    /evidence ladder/,
  );
});

const withCraftFixture = async (
  mutate: (root: string) => Promise<void> | void,
  assertion: RegExp,
) => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-craft-"));
  try {
    await cp(craftRoot, root, { recursive: true });
    await mutate(root);
    await assert.rejects(loadCraftCatalog(root), assertion);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("craft catalog loading rejects missing reference files", async () => {
  await withCraftFixture(async (root) => {
    await rm(path.join(root, "macrostructures.md"), { force: true });
  }, /macrostructures\.md/);
});

test("craft catalog loading rejects references without the provenance ladder", async () => {
  await withCraftFixture(async (root) => {
    const file = path.join(root, "type-pairings.md");
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace("## Provenance", "## Sources"), "utf8");
  }, /## Provenance/);
  await withCraftFixture(async (root) => {
    const file = path.join(root, "palette-recipes.md");
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace("### Unknown", "### Open Questions"), "utf8");
  }, /### Unknown/);
  await withCraftFixture(async (root) => {
    const file = path.join(root, "macrostructures.md");
    const text = await readFile(file, "utf8");
    const lines = text.split("\n");
    const unknownIndex = lines.findIndex((line) => line === "### Unknown");
    const replacement = [...lines.slice(0, unknownIndex), "### Unknown", "###"].join("\n");
    await writeFile(file, replacement, "utf8");
  }, /at least one evidence entry under ### Unknown/);
});

test("craft catalog loading rejects a category pointing outside the corpus", async () => {
  await withCraftFixture(async (root) => {
    const file = path.join(root, "craft-catalog.json");
    const catalog = JSON.parse(await readFile(file, "utf8"));
    catalog.categories["type-pairing"] = "../rules/typography.json";
    await writeFile(file, JSON.stringify(catalog), "utf8");
  }, /safe markdown reference file/);
  await withCraftFixture(async (root) => {
    const file = path.join(root, "craft-catalog.json");
    const catalog = JSON.parse(await readFile(file, "utf8"));
    catalog.categories["palette-recipe"] = "type-pairings.md";
    await writeFile(file, JSON.stringify(catalog), "utf8");
  }, /unique reference file/);
});

test("bundle:craft copies the catalog byte-identically into the skill package references", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-bundle-"));
  try {
    const target = path.join(root, "skill-package");
    const result = await bundleFrontendCraft({ craftRoot, skillPackageRoot: target });
    assert.equal(result.catalogIdentity.id, "frontend-craft-catalog");
    assert.deepEqual(result.files.sort(), [
      "references/craft/component-cookbooks.md",
      "references/craft/craft-catalog.json",
      "references/craft/macrostructures.md",
      "references/craft/palette-recipes.md",
      "references/craft/type-pairings.md",
    ]);
    const bundledDir = path.join(target, "references", "craft");
    for (const name of ["craft-catalog.json", ...Object.values(canonicalFiles)]) {
      assert.deepEqual(
        await readFile(path.join(bundledDir, name)),
        await readFile(path.join(craftRoot, name)),
        `${name} must be bundled byte-identically`,
      );
    }
    await writeFile(path.join(bundledDir, "stale-file.md"), "stale", "utf8");
    await bundleFrontendCraft({ craftRoot, skillPackageRoot: target });
    assert.deepEqual((await readdir(bundledDir)).sort(), [
      "component-cookbooks.md",
      "craft-catalog.json",
      "macrostructures.md",
      "palette-recipes.md",
      "type-pairings.md",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundle:craft refuses to bundle from an invalid corpus", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "skillranger-bundle-source-"));
  const target = await mkdtemp(path.join(tmpdir(), "skillranger-bundle-target-"));
  try {
    await cp(craftRoot, source, { recursive: true });
    const catalog = JSON.parse(await readFile(path.join(source, "craft-catalog.json"), "utf8"));
    delete catalog.provenance.unknown;
    await writeFile(path.join(source, "craft-catalog.json"), JSON.stringify(catalog), "utf8");
    await assert.rejects(
      bundleFrontendCraft({ craftRoot: source, skillPackageRoot: target }),
      /evidence ladder/,
    );
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test("craft catalog schema is published in the domain manifest and matches the catalog contract", async () => {
  const manifest = JSON.parse(await readFile("domains/frontend/domain.manifest.json", "utf8"));
  assert.ok(manifest.artifacts.schemas.includes("schemas/craft-catalog.schema.json"));
  const schema = JSON.parse(await readFile("domains/frontend/schemas/craft-catalog.schema.json", "utf8"));
  assert.equal(schema.$id, "https://skillranger.local/domains/frontend/craft-catalog.schema.json");
  assert.equal(schema.properties.schemaVersion.const, "1.0");
  assert.deepEqual(Object.keys(schema.properties.categories.properties), [...craftReferenceKinds]);
  assert.deepEqual(Object.keys(schema.properties.provenance.properties), ["observed", "inferred", "assumed", "unknown"]);
  const catalog = JSON.parse(await readFile(path.join(craftRoot, "craft-catalog.json"), "utf8")) as CraftCatalog;
  for (const key of ["schemaVersion", "id", "displayName", "description", "categories", "provenance"]) {
    assert.ok(Object.hasOwn(schema.properties, key), `schema missing ${key}`);
    assert.ok(Object.hasOwn(catalog, key), `catalog missing ${key}`);
  }
});

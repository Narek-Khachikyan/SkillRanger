import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  craftReferenceKinds,
  craftReferenceKindsV10,
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
import { frontendRecipeIds } from "../src/domains/frontend/design/catalog.ts";

const craftRoot = path.resolve("domains/frontend/craft");
const canonicalFiles = {
  "type-pairing": "type-pairings.md",
  "palette-recipe": "palette-recipes.md",
  "theme": "themes.md",
  "macrostructure": "macrostructures.md",
  "component-cookbook": "component-cookbooks.md",
} as const;

test("craft catalog declares the five reference kinds with present files", async () => {
  const { catalog, references } = await loadCraftCatalog(craftRoot);
  assert.deepEqual(Object.keys(catalog.categories), [...craftReferenceKinds]);
  assert.equal(catalog.schemaVersion, "1.1");
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
    () => validateCraftCatalog({ ...catalog, unknownTopLevel: true }),
    /Invalid craft catalog contract/,
  );
});

test("craft catalog validates schemaVersion against the kind set", async () => {
  const catalog = JSON.parse(await readFile(path.join(craftRoot, "craft-catalog.json"), "utf8"));
  assert.equal(catalog.schemaVersion, "1.1");
  const v11 = validateCraftCatalog(catalog);
  assert.deepEqual(Object.keys(v11.categories), [...craftReferenceKinds]);

  const v10Categories = Object.fromEntries(
    craftReferenceKindsV10.map((kind) => [kind, catalog.categories[kind]]),
  );
  const v10 = validateCraftCatalog({ ...catalog, schemaVersion: "1.0", categories: v10Categories });
  assert.deepEqual(Object.keys(v10.categories), [...craftReferenceKindsV10]);

  assert.throws(
    () => validateCraftCatalog({ ...catalog, schemaVersion: "1.0" }),
    /exactly the 4 reference kinds/,
  );
  const missingThemeCategories = Object.fromEntries(
    craftReferenceKinds.filter((kind) => kind !== "theme").map((kind) => [kind, catalog.categories[kind]]),
  );
  assert.throws(
    () => validateCraftCatalog({ ...catalog, categories: missingThemeCategories }),
    /theme must name a safe markdown reference file/,
  );
  assert.throws(
    () => validateCraftCatalog({ ...catalog, categories: { ...catalog.categories, "cookbook": "cookbooks.md" } }),
    /exactly the 5 reference kinds/,
  );
  assert.throws(
    () => validateCraftCatalog({ ...catalog, schemaVersion: "2.0" }),
    /schemaVersion must be 1.0 or 1.1/,
  );
});

test("schemaVersion 1.0 catalogs remain loadable as legacy without the theme kind", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-craft-v10-"));
  try {
    await cp(craftRoot, root, { recursive: true });
    const file = path.join(root, "craft-catalog.json");
    const catalog = JSON.parse(await readFile(file, "utf8"));
    const v10Categories = Object.fromEntries(
      craftReferenceKindsV10.map((kind) => [kind, catalog.categories[kind]]),
    );
    await writeFile(
      file,
      JSON.stringify({ ...catalog, schemaVersion: "1.0", categories: v10Categories }, null, 2),
      "utf8",
    );
    const { catalog: loaded, references } = await loadCraftCatalog(root);
    assert.equal(loaded.schemaVersion, "1.0");
    assert.deepEqual(
      references.map(({ kind }) => kind),
      [...craftReferenceKindsV10],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
      "references/craft/themes.md",
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
      "themes.md",
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
  assert.deepEqual(schema.oneOf.map((ref: { $ref: string }) => ref.$ref), ["#/$defs/catalogV10", "#/$defs/catalogV11"]);
  const v11Categories = schema.$defs.catalogV11.properties.categories;
  assert.deepEqual(Object.keys(v11Categories.properties), [...craftReferenceKinds]);
  assert.deepEqual(Object.keys(schema.$defs.catalogV10.properties.categories.properties), [...craftReferenceKindsV10]);
  assert.deepEqual(
    Object.keys(schema.$defs.provenance.properties),
    ["observed", "inferred", "assumed", "unknown"],
  );
  const catalog = JSON.parse(await readFile(path.join(craftRoot, "craft-catalog.json"), "utf8")) as CraftCatalog;
  for (const key of ["schemaVersion", "id", "displayName", "description", "categories", "provenance"]) {
    assert.ok(Object.hasOwn(schema.$defs.catalogV11.properties, key), `schema missing ${key}`);
    assert.ok(Object.hasOwn(catalog, key), `catalog missing ${key}`);
  }
});

type ThemeSection = {
  index: number;
  name: string;
  body: string[];
};

const parseThemeSections = (markdown: string): ThemeSection[] => {
  const lines = markdown.split("\n");
  const sections: ThemeSection[] = [];
  let current: ThemeSection | undefined;
  for (const line of lines) {
    const heading = line.match(/^### (\d+)\. (.+)$/);
    if (heading) {
      current = { index: Number(heading[1]), name: heading[2].trim(), body: [] };
      sections.push(current);
      continue;
    }
    if (current && line === "## Theme Grammar") {
      current = undefined;
      continue;
    }
    if (current) current.body.push(line);
  }
  return sections;
};

test("theme catalog ships 5-7 themes with OKLCH tokens, genre affinities, and per-theme bans", async () => {
  const markdown = await readFile(path.join(craftRoot, "themes.md"), "utf8");
  const sections = parseThemeSections(markdown);
  assert.ok(sections.length >= 5 && sections.length <= 7, `expected 5-7 themes, found ${sections.length}`);
  assert.deepEqual(
    sections.map(({ index }) => index),
    [...Array(sections.length).keys()].map((i) => i + 1),
    "theme headings must be sequentially numbered",
  );
  const names = sections.map(({ name }) => name);
  assert.equal(new Set(names).size, names.length, "theme names must be unique");

  const oklchPattern = /oklch\([0-9.]+ [0-9.]+ [0-9.]+\)/;
  const requiredTokenRoles = ["Canvas:", "Surface:", "Ink:", "Muted ink:", "Hairline:", "Accent:", "Accent ink:", "Status:"];
  for (const section of sections) {
    const body = section.body.join("\n");
    const tokenBlock = body.match(/-\s+\*\*Tokens:\*\*\n([\s\S]*?)(?=\n- \*\*Genre affinities:\*\*)/);
    assert.ok(tokenBlock, `${section.name} must declare a Tokens block`);
    for (const role of requiredTokenRoles) {
      assert.ok(tokenBlock[1].includes(role), `${section.name} tokens must include ${role}`);
    }
    const oklchMatches = tokenBlock[1].match(/oklch\([^)]+\)/g) ?? [];
    assert.ok(oklchMatches.length >= 9, `${section.name} must carry at least 9 OKLCH token values`);
    assert.ok(
      oklchMatches.every((value) => oklchPattern.test(value)),
      `${section.name} tokens must be OKLCH`,
    );

    const affinities = body.match(/-\s+\*\*Genre affinities:\*\* ([^\n]+)/);
    assert.ok(affinities, `${section.name} must declare genre affinities`);
    const affinityIds = affinities[1].match(/`([a-z-]+)`/g) ?? [];
    assert.ok(affinityIds.length > 0, `${section.name} affinities must name at least one recipe id`);
    for (const id of affinityIds) {
      assert.ok(
        frontendRecipeIds.includes(id.replaceAll("`", "")),
        `${section.name} affinity ${id} is not a bundled recipe id`,
      );
    }

    const bans = body.match(/-\s+\*\*Bans:\*\* ([^\n]+)/);
    assert.ok(bans, `${section.name} must declare per-theme bans`);
    assert.ok(bans[1].includes("no "), `${section.name} bans must be prohibitions`);

    const axes = body.match(/-\s+\*\*Theme axes:\*\* ([^\n]+)/);
    assert.ok(axes, `${section.name} must declare theme axes`);
    assert.ok(axes[1].includes("paperBand"), `${section.name} axes must declare paperBand`);
    assert.ok(axes[1].includes("displayStyle"), `${section.name} axes must declare displayStyle`);
    assert.ok(axes[1].includes("accentHue"), `${section.name} axes must declare accentHue`);
  }
});

test("theme catalog is extensible reference material with a provenance ladder", async () => {
  const markdown = await readFile(path.join(craftRoot, "themes.md"), "utf8");
  assert.doesNotThrow(() => validateCraftMarkdownProvenance(markdown, "themes.md"));
  assert.ok(markdown.includes("not a closed contract"), "themes.md must state the catalog is extensible");
  assert.ok(markdown.includes("identity-fingerprint"), "themes.md must defer enforcement to the identity fingerprint");
});

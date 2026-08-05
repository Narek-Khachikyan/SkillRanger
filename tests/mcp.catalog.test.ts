import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { callMcpTool, mcpTools } from "../src/mcp/tools.ts";
import {
  assertValidCatalogReceipt,
  inspectSkillCatalog,
  isCatalogReceiptValid,
  type SkillCatalogSourceOptions,
} from "../src/router/catalog.ts";
import { loadBundledRouterPacks } from "../src/domains/registry.ts";
import { loadLocalRegistry } from "../src/registry/index.ts";

type CatalogPage = {
  ok: true;
  schemaVersion: "skill-catalog/1.0";
  catalogDigest: string;
  domains: Array<{ domainId: string; displayName: string; description: string }>;
  skills: Array<{
    skillId: string;
    displayName: string;
    description: string;
    version: string;
    domains: string[];
    roles: string[];
    actions: string[];
    artifactTypes: string[];
    intentTags: string[];
    technologyTags: string[];
    qualityGoals: string[];
    requiredCapabilities: string[];
    riskLevel: string;
    supportedAgents: string[];
  }>;
  nextCursor: string | null;
  complete: boolean;
  catalogReceipt?: string;
};

const page = async (args: Record<string, unknown>) => {
  const result = await callMcpTool("inspect_skill_catalog", args);
  assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
  return result.structuredContent as CatalogPage;
};

test("MCP exposes an explicitly activated, read-only skill catalog", async () => {
  const definition = mcpTools.find(({ name }) => name === "inspect_skill_catalog");
  assert.ok(definition);
  assert.match(definition.description, /@skillranger/);
  assert.match(definition.description, /\/sr/);
  assert.match(definition.description, /nextCursor/);
  assert.equal(definition.annotations.readOnlyHint, true);
  assert.equal(definition.annotations.openWorldHint, false);

  const first = await page({ maxItems: 2, maxBytes: 100_000 });
  assert.equal(first.schemaVersion, "skill-catalog/1.0");
  assert.match(first.catalogDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(first.domains.map(({ domainId }) => domainId), ["frontend"]);
  assert.equal(first.complete, false);
  assert.equal(first.skills.length, 2);
  assert.equal(first.catalogReceipt, undefined);

  const pages = [first];
  let current = first;
  while (current.nextCursor !== null) {
    current = await page({
      cursor: current.nextCursor,
      expectedCatalogDigest: current.catalogDigest,
      maxItems: 2,
      maxBytes: 100_000,
    });
    pages.push(current);
  }

  const skills = pages.flatMap(({ skills: entries }) => entries);
  assert.equal(pages.at(-1)?.complete, true);
  assert.match(pages.at(-1)?.catalogReceipt ?? "", /^catalog-receipt\./);
  assert.equal(skills[0]?.skillId, "frontend.accessibility-review");
  assert.equal(skills.at(-1)?.skillId, "frontend.visual-design-polish");
  assert.equal(new Set(skills.map(({ skillId }) => skillId)).size, skills.length);
  assert.equal(skills.length, 18);
  assert.ok(skills.every(({ domains, roles, actions, requiredCapabilities }) =>
    domains.length > 0 && roles.length > 0 && actions.length > 0 && requiredCapabilities.length > 0));
});

test("catalog continuation requires the current digest", async () => {
  const first = await page({ maxItems: 1, maxBytes: 100_000 });
  const result = await callMcpTool("inspect_skill_catalog", {
    cursor: first.nextCursor,
    expectedCatalogDigest: "sha256:" + "0".repeat(64),
    maxItems: 1,
    maxBytes: 100_000,
  });
  assert.equal(result.isError, true);
  assert.equal((result.structuredContent as { code?: string }).code, "catalog-digest-mismatch");
});

test("catalog paging refuses an invalid cursor and a page that cannot fit", async () => {
  const first = await page({ maxItems: 1, maxBytes: 100_000 });
  const invalidCursor = await callMcpTool("inspect_skill_catalog", {
    cursor: `${first.nextCursor}tampered`,
    expectedCatalogDigest: first.catalogDigest,
    maxItems: 1,
    maxBytes: 100_000,
  });
  assert.equal(invalidCursor.isError, true);
  assert.equal((invalidCursor.structuredContent as { code?: string }).code, "catalog-cursor-invalid");

  const tooSmall = await callMcpTool("inspect_skill_catalog", { maxBytes: 1 });
  assert.equal(tooSmall.isError, true);
  assert.equal((tooSmall.structuredContent as { code?: string }).code, "catalog-page-limit-too-small");
});

test("a complete catalog page returns a digest-bound receipt", async () => {
  const first = await inspectSkillCatalog({ maxItems: 2, maxBytes: 256_000 });
  let result = first;
  while (!result.complete) {
    result = await inspectSkillCatalog({
      cursor: result.nextCursor!,
      expectedCatalogDigest: result.catalogDigest,
    });
  }
  assert.equal(result.complete, true);
  assert.equal(result.nextCursor, null);
  assert.ok(result.catalogReceipt);
  assert.equal(isCatalogReceiptValid(result.catalogReceipt, result.catalogDigest), true);
  assert.doesNotThrow(() => assertValidCatalogReceipt(result.catalogReceipt!, result.catalogDigest));
  assert.equal(isCatalogReceiptValid(`${result.catalogReceipt}tampered`, result.catalogDigest), false);
  assert.doesNotMatch(JSON.stringify(result), /SKILL\.md|execution\.contract|scripts/);
});

test("an unchained complete first page does not issue a catalog receipt", async () => {
  const result = await inspectSkillCatalog({ maxItems: 64, maxBytes: 256_000 });
  assert.equal(result.complete, true);
  assert.equal(result.catalogReceipt, undefined);
});

test("repeating the same page request gives deterministic boundaries", async () => {
  const first = await inspectSkillCatalog({ maxItems: 3, maxBytes: 100_000 });
  const repeated = await inspectSkillCatalog({ maxItems: 3, maxBytes: 100_000 });
  assert.deepEqual(repeated, first);
});

test("catalog inspection does not create project state", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-catalog-project-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "unconfigured-project" }));
  const before = await readdir(projectRoot);
  await callMcpTool("inspect_skill_catalog", { maxItems: 1, maxBytes: 100_000 });
  const after = await readdir(projectRoot);
  assert.deepEqual(after, before);
});

test("the catalog digest changes when a nomination card changes", async () => {
  const loaders: SkillCatalogSourceOptions["loaders"] = {
    loadSkills: async (root) => {
      const skills = await loadLocalRegistry(root);
      const first = skills[0];
      assert.ok(first);
      return skills.map((skill) => skill === first
        ? { ...skill, manifest: { ...skill.manifest, description: `${skill.manifest.description} changed` } }
        : skill);
    },
  };
  const original = await inspectSkillCatalog({ maxItems: 64, maxBytes: 256_000 });
  const changed = await inspectSkillCatalog({ maxItems: 64, maxBytes: 256_000 }, { loaders });
  assert.notEqual(changed.catalogDigest, original.catalogDigest);
  assert.notEqual(changed.skills[0]?.description, original.skills[0]?.description);
});

test("the catalog digest changes when Domain Pack routing metadata changes", async () => {
  const loaders: SkillCatalogSourceOptions["loaders"] = {
    loadDomains: async (root) => {
      const packs = await loadBundledRouterPacks(root);
      const frontend = packs.find(({ id }) => id === "frontend");
      assert.ok(frontend?.routing);
      return packs.map((pack) => pack.id === "frontend"
        ? { ...pack, routing: { ...pack.routing, intentTags: [...pack.routing.intentTags, "catalog-digest-test"] } }
        : pack);
    },
  };
  const original = await inspectSkillCatalog({ maxItems: 64, maxBytes: 256_000 });
  const changed = await inspectSkillCatalog({ maxItems: 64, maxBytes: 256_000 }, { loaders });
  assert.notEqual(changed.catalogDigest, original.catalogDigest);
});

test("an audit checksum failure fails catalog inspection closed", async () => {
  const result = await inspectSkillCatalog({ maxItems: 64, maxBytes: 256_000 }, {
    loaders: {
      auditSkill: async (skill) => ({
        skillId: skill.manifest.id,
        checksum: `sha256:${"0".repeat(64)}`,
        riskLevel: "low",
        securityScore: 1,
        findings: [],
      }),
    },
  }).then(() => undefined, (error: unknown) => error);
  assert.equal((result as { code?: string }).code, "catalog-integrity");
});

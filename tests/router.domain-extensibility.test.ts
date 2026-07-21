import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DomainPackManifest } from "../src/domains/types.ts";
import { buildRoutingContext, RoutingContextError } from "../src/router/context.ts";
import type { CanonicalSkillRoutingDocument } from "../src/router/metadata.ts";
import { prepareTask, RouterPrepareError } from "../src/router/prepare.ts";
import { coreRoutingVocabulary } from "../src/router/vocabulary/core.ts";
import { loadDomainRoutingVocabulary, type LoadedRouterPack } from "../src/router/vocabulary/load.ts";
import { routingVocabularyLimits } from "../src/router/vocabulary/validate.ts";

const routing = {
  aliases: ["alpha-alias"],
  intentTags: ["alpha-intent"],
  artifactTypes: ["alpha-artifact"],
  technologyTags: ["alpha-tech"],
  projectTags: [],
};

const manifest = (routingVocabulary = "routing.vocabulary.json"): DomainPackManifest => ({
  schemaVersion: "1.1",
  id: "alpha",
  displayName: "Alpha",
  version: "1.0.0",
  coreApi: "1.0",
  skillIdPrefix: "alpha.",
  capabilities: ["intent-routing"],
  artifacts: { intents: [], schemas: [], recipes: [], workflows: [], validators: [], routingVocabulary },
  ownership: [{ intent: "alpha-intent", primarySkill: "alpha.primary", supportingSkills: [] }],
  routing,
});

const vocabulary = (phrase = "alpha phrase") => ({
  schemaVersion: "routing-vocabulary/1.0" as const,
  owner: { kind: "domain" as const, id: "alpha" },
  entries: [{ kind: "artifact" as const, id: "alpha-artifact", locale: "en" as const, phrases: [phrase] }],
});

const skill: CanonicalSkillRoutingDocument = {
  skillId: "alpha.primary",
  domains: ["alpha"],
  canonical: {
    actions: ["create"],
    artifactTypes: ["alpha-artifact"],
    intentTags: ["alpha-intent"],
    technologyTags: ["alpha-tech"],
    qualityGoals: [],
  },
};

const contextFor = (pack: LoadedRouterPack) => buildRoutingContext({
  packs: [pack],
  skills: [skill],
  coreVocabulary: coreRoutingVocabulary,
  baseRegistryDigest: "registry",
});

test("standalone vocabulary path must resolve to a contained regular file within the size limit", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "skillranger-routing-loader-"));
  const outside = path.join(base, "outside.json");
  await writeFile(outside, JSON.stringify(vocabulary()));

  const cases = [
    { name: "missing", setup: async (root: string) => undefined, expected: "routing-vocabulary-path-invalid" },
    { name: "directory", setup: async (root: string) => mkdir(path.join(root, "routing.vocabulary.json")), expected: "routing-vocabulary-path-invalid" },
    { name: "oversized", setup: async (root: string) => writeFile(path.join(root, "routing.vocabulary.json"), "x".repeat(routingVocabularyLimits.maxFileBytes + 1)), expected: "routing-vocabulary-limit-exceeded" },
    { name: "escaping symlink", setup: async (root: string) => symlink(outside, path.join(root, "routing.vocabulary.json")), expected: "routing-vocabulary-path-invalid" },
  ] as const;

  for (const entry of cases) await t.test(entry.name, async () => {
    const root = await mkdtemp(path.join(base, `${entry.name.replaceAll(" ", "-")}-`));
    await entry.setup(root);
    await assert.rejects(loadDomainRoutingVocabulary({ root, manifest: manifest() }), (error: unknown) =>
      error instanceof Error && error.message === entry.expected);
  });
});

test("routing digests depend on semantic vocabulary, not JSON formatting, roots, or mtimes", async () => {
  const load = async (serialized: string, timestamp: number) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "skillranger-routing-digest-"));
    const file = path.join(root, "routing.vocabulary.json");
    await writeFile(file, serialized);
    await utimes(file, timestamp, timestamp);
    const loaded = await loadDomainRoutingVocabulary({ root, manifest: manifest() });
    assert.ok(loaded);
    return contextFor({ domainId: "alpha", routing, ownership: manifest().ownership, vocabulary: loaded.vocabulary, vocabularyBytes: loaded.bytes });
  };

  const compact = await load(JSON.stringify(vocabulary()), 1_000);
  const formatted = await load(JSON.stringify(vocabulary(), null, 2), 2_000);
  const changed = await load(JSON.stringify(vocabulary("different phrase")), 3_000);
  assert.equal(compact.vocabularyDigest, formatted.vocabularyDigest);
  assert.equal(compact.routingRegistryDigest, formatted.routingRegistryDigest);
  assert.notEqual(compact.vocabularyDigest, changed.vocabularyDigest);
  assert.notEqual(compact.routingRegistryDigest, changed.routingRegistryDigest);
});

test("v1.0 evidence resolves only when its owner-scoped canonical kind is unique", () => {
  const pack = (requiresEvidence: string[], intent = "alpha-intent"): LoadedRouterPack => ({
    domainId: "alpha",
    routing: { ...routing, intentTags: [intent] },
    ownership: [{ intent, primarySkill: "alpha.primary", supportingSkills: [], requiresEvidence }],
  });
  const unique = contextFor(pack(["alpha-intent"]));
  assert.deepEqual(unique.domains.get("alpha")?.ownership[0]?.requiresEvidence, [{
    kind: "intent",
    id: "alpha-intent",
    allowedSources: ["prompt-exact", "prompt-normalized"],
  }]);
  assert.throws(() => contextFor(pack(["missing"])), (error: unknown) =>
    error instanceof RoutingContextError && error.reason === "domain-evidence-reference-invalid");

  const ambiguousSkill = structuredClone(skill);
  ambiguousSkill.canonical.intentTags = ["page"];
  assert.throws(() => buildRoutingContext({
    packs: [pack(["page"], "page")],
    skills: [ambiguousSkill],
    coreVocabulary: coreRoutingVocabulary,
    baseRegistryDigest: "registry",
  }), (error: unknown) => error instanceof RoutingContextError && error.reason === "domain-evidence-reference-invalid");
});

test("prepare maps fixture vocabulary authoring failures to routing-integrity", async () => {
  const registryRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-routing-invalid-"));
  const packRoot = path.join(registryRoot, "backend-api");
  await mkdir(packRoot);
  const pack = JSON.parse(await readFile("tests/fixtures/router-packs/backend-api/pack.json", "utf8")) as {
    vocabulary: { owner: { id: string } };
  };
  pack.vocabulary.owner.id = "other-domain";
  await writeFile(path.join(packRoot, "pack.json"), JSON.stringify(pack));
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-routing-project-"));
  await assert.rejects(prepareTask({
    projectRoot,
    registry: { kind: "test-fixture", root: registryRoot },
    prompt: "Create an authentication API @skillranger",
    activation: { mode: "explicit" },
  }), (error: unknown) => error instanceof RouterPrepareError && error.code === "routing-integrity");
});

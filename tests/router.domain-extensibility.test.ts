import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DomainPackManifest } from "../src/domains/types.ts";
import { analyzeTask } from "../src/router/analyzer.ts";
import { buildRoutingContext, RoutingContextError } from "../src/router/context.ts";
import { loadRouterFixturePacks } from "../src/router/fixtures.ts";
import { canonicalSkillRoutingDocument, type CanonicalSkillRoutingDocument } from "../src/router/metadata.ts";
import { prepareTask, RouterPrepareError } from "../src/router/prepare.ts";
import { coreRoutingVocabulary } from "../src/router/vocabulary/core.ts";
import { adaptFixtureRoutingPacks, loadDomainRoutingVocabulary, type LoadedRouterPack } from "../src/router/vocabulary/load.ts";
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

test("fixture vocabularies route colloquial claims through the shared routing context", async () => {
  const packs = await loadRouterFixturePacks("tests/fixtures/router-packs");
  assert.deepEqual(packs.filter(({ schemaVersion }) => schemaVersion === "router-fixture-pack/1.1").map(({ domain }) => domain.id), [
    "backend-api", "database", "devops-platform", "mobile", "qa-testing",
  ]);
  const skills = packs.flatMap(({ skills: packSkills }) => packSkills);
  const routingContext = buildRoutingContext({
    packs: adaptFixtureRoutingPacks(packs),
    skills: skills.map(canonicalSkillRoutingDocument),
    coreVocabulary: coreRoutingVocabulary,
    baseRegistryDigest: "fixture-extensibility",
  });
  assert.deepEqual(routingContext.domains.get("backend-api")?.ownership.map(({ intent, primarySkill }) => ({ intent, primarySkill })), [
    { intent: "authentication", primarySkill: "backend.auth-implementation" },
  ]);
  assert.equal([...routingContext.domains.values()].reduce((sum, domain) => sum + domain.ownership.length, 0), 1);
  for (const id of ["api", "mobile-interface", "ci-pipeline"]) assert.equal(routingContext.creatableArtifactIds.has(id), true, id);

  const domains = packs.map(({ domain }) => domain);
  const signals = (prompt: string) => new Set(analyzeTask({ prompt, domains, skills, routingContext }).matchedSignals.map(({ kind, id }) => `${kind}:${id}`));
  const cases: Array<[string, string[]]> = [
    ["backend service endpoint", ["domain:backend-api", "artifact:api"]],
    ["ios и android с offline mode", ["domain:mobile", "intent:offline-feature"]],
    ["деплой pipeline как docker образ", ["intent:deployment", "artifact:ci-pipeline", "technology:docker"]],
    ["дай мне endpoint", ["action:create", "artifact:api"]],
    ["дай мне mobile app", ["action:create", "artifact:mobile-interface"]],
    ["дай мне pipeline", ["action:create", "artifact:ci-pipeline"]],
  ];
  for (const [prompt, expected] of cases) {
    const actual = signals(prompt);
    for (const signal of expected) assert.ok(actual.has(signal), `${prompt}: ${signal}`);
  }

  for (const [prompt, expected] of [
    ["implement api", "artifact:api"],
    ["create mobile-interface", "artifact:mobile-interface"],
    ["deploy ci-pipeline", "artifact:ci-pipeline"],
  ] as const) assert.ok(signals(prompt).has(expected), `${prompt}: ${expected}`);
  const explicitPhrases = packs.flatMap((pack) => pack.schemaVersion === "router-fixture-pack/1.1"
    ? pack.vocabulary?.entries.flatMap(({ phrases }) => phrases) ?? []
    : []);
  for (const canonicalId of ["api", "mobile-interface", "ci-pipeline"]) assert.equal(explicitPhrases.includes(canonicalId), false, canonicalId);
});

test("shared router code contains no fixture-domain branches", async () => {
  const source = (await Promise.all(["analyzer.ts", "resolver.ts", "composer.ts"].map((file) => readFile(path.join("src/router", file), "utf8")))).join("\n");
  assert.doesNotMatch(source, /backend-api|devops-platform|mobile-interface|ci-pipeline/);
});

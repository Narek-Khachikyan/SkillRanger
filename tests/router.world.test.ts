import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultDomainsRoot, defaultRegistryRoot } from "../src/paths.ts";
import { loadRouterFixturePacks } from "../src/router/fixtures.ts";
import { loadRoutingWorld, type RoutingWorldInput } from "../src/router/world.ts";

const project = () => mkdtemp(path.join(os.tmpdir(), "skillranger-world-"));
const fixtureRoot = path.resolve("tests/fixtures/router-packs");
const registryRoot = path.resolve("registry");
const sha256 = /^sha256:[a-f0-9]{64}$/;

const worldInput = async (overrides: Partial<RoutingWorldInput> = {}): Promise<RoutingWorldInput> => ({
  registry: { kind: "test-fixture", root: fixtureRoot },
  projectRoot: await project(),
  targetAgent: "codex",
  skillInputs: {},
  intent: undefined,
  installed: [],
  ...overrides,
});

test("replace mode substitutes fixture packs for the bundled world and loads no registry skills", async () => {
  const fixturePacks = await loadRouterFixturePacks(fixtureRoot);
  const world = await loadRoutingWorld(await worldInput());
  // All skills come from the fixture packs; no bundled registry skill is loaded.
  assert.ok(world.skills.length > 0);
  for (const skill of world.skills) {
    assert.equal(skill.skill, undefined, `${skill.id} must not carry a bundled registry skill`);
    assert.equal(skill.source, "test-fixture-registry");
  }
  const fixtureSkillIds = new Set(fixturePacks.flatMap((pack) => pack.skills.map((skill) => skill.id)));
  assert.deepEqual(new Set(world.skills.map((skill) => skill.id)), fixtureSkillIds);
  // Domains and routing packs come from the fixture packs.
  const fixtureDomainIds = fixturePacks.map((pack) => pack.domain.id);
  assert.deepEqual(world.domains.map((domain) => domain.id), fixtureDomainIds);
  assert.deepEqual(world.routingPacks.map((pack) => pack.domainId), fixtureDomainIds);
  // The base registry digest is a real digest, never a fake constant.
  assert.match(world.routingContext.routingRegistryDigest, sha256);
  assert.match(world.routingContext.vocabularyDigest, sha256);
});

test("replace mode with an explicit installed marking marks the matching fixture skill installed", async () => {
  const fixturePacks = await loadRouterFixturePacks(fixtureRoot);
  const installedSkillId = fixturePacks[0].skills[0].id;
  const installed = [{
    skillId: installedSkillId,
    version: "1.0.0",
    checksum: `sha256:${"a".repeat(64)}`,
    targetAgent: "codex",
    scope: "repo" as const,
    installedPath: `.agents/skills/${installedSkillId}`,
    source: { type: "curated" as const, registry: "local" as const, path: "skills/frontend" },
    audit: { riskLevel: "low" as const, securityScore: 1, findings: [] },
  }];
  const world = await loadRoutingWorld(await worldInput({ installed }));
  const marked = world.skills.find((skill) => skill.id === installedSkillId);
  assert.ok(marked, `expected ${installedSkillId} in loaded skills`);
  assert.equal(marked.source, "installed");
  assert.equal(marked.installed, true);
  const unmarked = world.skills.find((skill) => skill.id !== installedSkillId)!;
  assert.equal(unmarked.source, "test-fixture-registry");
  assert.equal(unmarked.installed, false);
});

test("bundled mode returns registry skills with the registry skill and installed-entry fields", async () => {
  const world = await loadRoutingWorld(await worldInput({
    registry: { kind: "bundled", root: registryRoot },
  }));
  assert.ok(world.skills.length > 0);
  const registrySkill = world.skills.find((skill) => skill.skill !== undefined);
  assert.ok(registrySkill, "bundled mode must load registry skills");
  assert.equal(registrySkill.skill?.manifest.id, registrySkill.id);
  assert.match(world.routingContext.routingRegistryDigest, sha256);
  // Domains come from the bundled domain packs, not the fixture packs.
  const bundledPacks = await import("../src/domains/registry.ts").then(({ loadBundledRouterPacks }) => loadBundledRouterPacks(defaultDomainsRoot));
  assert.deepEqual(world.domains.map((domain) => domain.id), bundledPacks.map((pack) => pack.id));
  assert.ok(defaultRegistryRoot.length > 0);
});

test("bundled mode honors the explicit installed marking for registry skills", async () => {
  const { cp, readdir, writeFile } = await import("node:fs/promises");
  const { loadLocalRegistry } = await import("../src/registry/index.ts");
  const root = await project();
  const registrySkills = await loadLocalRegistry(registryRoot);
  // Pick a skill whose package has no shared contracts, so the installed file set
  // is exactly the source package files plus the manifest with the lock checksum.
  const skill = registrySkills.find((candidate) => candidate.manifest.id.startsWith("frontend.") && (candidate.manifest.execution?.sharedContracts?.length ?? 0) === 0);
  assert.ok(skill, "bundled registry must contain a frontend skill without shared contracts");
  const installedPath = `.agents/skills/${skill.manifest.id}`;
  const installedRoot = path.join(root, installedPath);
  await mkdir(installedRoot, { recursive: true });
  const files = await readdir(skill.path, { withFileTypes: true });
  for (const entry of files) {
    await cp(path.join(skill.path, entry.name), path.join(installedRoot, entry.name), { recursive: true });
  }
  // The installed manifest is the in-memory manifest (which carries the checksum)
  // exactly like the real installer writes it.
  await writeFile(path.join(installedRoot, "skill.manifest.json"), `${JSON.stringify(skill.manifest, null, 2)}\n`);
  const installed = [{
    skillId: skill.manifest.id,
    version: skill.manifest.version,
    checksum: skill.checksum,
    targetAgent: "codex",
    scope: "repo" as const,
    installedPath,
    source: skill.manifest.source,
    audit: skill.audit,
  }];
  const world = await loadRoutingWorld(await worldInput({
    registry: { kind: "bundled", root: registryRoot },
    projectRoot: root,
    installed,
  }));
  const marked = world.skills.find((item) => item.skill?.manifest.id === skill.manifest.id);
  assert.ok(marked, `expected ${skill.manifest.id} in loaded skills`);
  assert.equal(marked.source, "installed");
  assert.equal(marked.installed, true);
  assert.equal(marked.entry?.installedPath, installedPath);
});

test("merge mode keeps the bundled world loaded and composes fixture domains and skills", async () => {
  const fixturePacks = await loadRouterFixturePacks(fixtureRoot);
  const bundledPacks = await import("../src/domains/registry.ts").then(({ loadBundledRouterPacks }) => loadBundledRouterPacks(defaultDomainsRoot));
  const world = await loadRoutingWorld(await worldInput({
    registry: { kind: "merge", root: registryRoot, fixtureRoot },
  }));
  // The bundled world stays loaded: registry skills carry the registry skill and
  // bundled domains not overridden by a fixture remain.
  const registrySkill = world.skills.find((skill) => skill.skill !== undefined);
  assert.ok(registrySkill, "merge mode must load bundled registry skills");
  assert.equal(registrySkill.skill?.manifest.id, registrySkill.id);
  // Fixture domains and skills compose with the bundled world.
  const fixtureDomainIds = new Set(fixturePacks.map((pack) => pack.domain.id));
  const fixtureSkillIds = new Set(fixturePacks.flatMap((pack) => pack.skills.map((skill) => skill.id)));
  assert.ok([...fixtureDomainIds].every((id) => world.domains.some((domain) => domain.id === id)));
  assert.ok([...fixtureSkillIds].every((id) => world.skills.some((skill) => skill.id === id)));
  // Bundled domains without a fixture override stay present.
  const overriddenBundled = bundledPacks.filter((pack) => !fixtureDomainIds.has(pack.id)).map((pack) => pack.id);
  assert.deepEqual(new Set(world.domains.map((domain) => domain.id)), new Set([...overriddenBundled, ...fixtureDomainIds]));
  // Routing packs compose from bundled plus fixture packs.
  assert.deepEqual(new Set(world.routingPacks.map((pack) => pack.domainId)), new Set(world.domains.map((domain) => domain.id)));
  assert.match(world.routingContext.routingRegistryDigest, sha256);
});

test("merge mode override-by-id: a fixture domain and skill with the same id win over the bundled entry", async () => {
  const bundledPacks = await import("../src/domains/registry.ts").then(({ loadBundledRouterPacks }) => loadBundledRouterPacks(defaultDomainsRoot));
  const bundledFrontend = bundledPacks.find((pack) => pack.id === "frontend");
  assert.ok(bundledFrontend, "bundled world must contain the frontend domain");
  const world = await loadRoutingWorld(await worldInput({
    registry: { kind: "merge", root: registryRoot, fixtureRoot },
  }));
  // The fixture frontend pack carries the extended routing tags (application-interface)
  // and overrides the bundled frontend domain by id.
  const frontend = world.domains.find((domain) => domain.id === "frontend");
  assert.ok(frontend, "frontend domain must be present in merge mode");
  assert.ok(frontend.routing.artifactTypes.includes("application-interface"), "fixture routing tags must win over bundled ones");
  assert.ok(frontend.routing.intentTags.includes("application-interface"));
  assert.notDeepEqual(frontend.routing, bundledFrontend.routing, "frontend routing must differ from the bundled default");
  // No bundled skill of the overridden frontend domain survives: only the fixture
  // frontend skills remain for the frontend domain.
  const frontendDomainSkills = world.skills.filter((skill) => skill.domains?.includes("frontend"));
  assert.ok(frontendDomainSkills.length > 0, "fixture frontend skills must be loaded");
  const fixtureFrontendSkillIds = new Set((await loadRouterFixturePacks(fixtureRoot)).find((pack) => pack.domain.id === "frontend")!.skills.map((skill) => skill.id));
  assert.deepEqual(new Set(frontendDomainSkills.map((skill) => skill.id)), fixtureFrontendSkillIds);
});

test("merge mode keeps the bundled routing context a real digest and honors installed marking", async () => {
  const fixturePacks = await loadRouterFixturePacks(fixtureRoot);
  const installedSkillId = fixturePacks[0].skills[0].id;
  const installed = [{
    skillId: installedSkillId,
    version: "1.0.0",
    checksum: `sha256:${"a".repeat(64)}`,
    targetAgent: "codex",
    scope: "repo" as const,
    installedPath: `.agents/skills/${installedSkillId}`,
    source: { type: "curated" as const, registry: "local" as const, path: "skills/frontend" },
    audit: { riskLevel: "low" as const, securityScore: 1, findings: [] },
  }];
  const world = await loadRoutingWorld(await worldInput({
    registry: { kind: "merge", root: registryRoot, fixtureRoot },
    installed,
  }));
  const marked = world.skills.find((skill) => skill.id === installedSkillId);
  assert.ok(marked, `expected ${installedSkillId} in loaded skills`);
  assert.equal(marked.source, "installed");
  assert.equal(marked.installed, true);
  assert.match(world.routingContext.routingRegistryDigest, sha256);
  assert.match(world.routingContext.vocabularyDigest, sha256);
});

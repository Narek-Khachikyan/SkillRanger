import { loadBundledRouterPacks, type BundledRouterPack } from "../domains/registry.ts";
import "../domains/bundled.ts";
import { defaultDomainsRoot } from "../paths.ts";
import { loadLocalRegistry } from "../registry/index.ts";
import type { InstalledSkill, RegistrySkill } from "../types.ts";
import type { TaskAnalyzerDomainMetadata } from "./analyzer.ts";
import type { RouterSkillMetadata } from "./composer.ts";
import { buildRoutingContext, type RoutingContext } from "./context.ts";
import { loadRouterFixturePacks, type RouterFixturePack } from "./fixtures.ts";
import { canonicalSkillRoutingDocument } from "./metadata.ts";
import { buildRouterSkillMetadata } from "./skill-metadata.ts";
import { routerRecordDigest } from "./store.ts";
import { coreRoutingVocabulary } from "./vocabulary/core.ts";
import { adaptFixtureRoutingPacks, loadBundledRoutingPacks, type LoadedRouterPack } from "./vocabulary/load.ts";

// The Routing world loader builds the shared core of the Routing pipeline input in
// exactly one place: router packs, router skill metadata (with production
// installed-marking semantics and the registry-skill/installed-entry fields source
// snapshots need), canonical routing documents, domain metadata, routing packs, and
// the routing context. Task preparation and router evaluations are adapters over it.
// Everything adapter-owned (router config, the enabled check, triggers, fingerprints,
// routing dates, limits, capabilities, catalog snapshots) stays outside this module.

export type RoutingWorldRegistry =
  | { kind: "bundled"; root: string }
  | { kind: "test-fixture"; root: string }
  // Merge mode keeps the bundled world loaded and composes fixture domains and
  // skills with it: a fixture entry with the same id overrides the bundled one
  // (override-by-id), everything else stays. root is the bundled registry root,
  // fixtureRoot is the fixture packs root.
  | { kind: "merge"; root: string; fixtureRoot: string };

export type RoutingWorldInput = {
  registry: RoutingWorldRegistry;
  domainsRoot?: string;
  projectRoot: string;
  targetAgent: string;
  skillInputs: Record<string, Record<string, unknown>>;
  intent?: string;
  // Explicit installed-skill marking (lockfile-driven in task preparation). It is an
  // explicit loader input so evaluation determinism never depends on the machine's
  // lockfile and so the loader never reads the project lockfile itself.
  installed: InstalledSkill[];
};

export type RoutingWorldSkill = RouterSkillMetadata & {
  skill?: RegistrySkill;
  installedRoot?: string;
  entry?: InstalledSkill;
};

export type RoutingWorld = {
  skills: RoutingWorldSkill[];
  domains: TaskAnalyzerDomainMetadata[];
  routingPacks: LoadedRouterPack[];
  routingContext: RoutingContext;
};

type WorldPack = { id: string; targetSurface?: string; routing: BundledRouterPack["routing"] };

const domainMetadata = (pack: WorldPack): TaskAnalyzerDomainMetadata => ({
  id: pack.id,
  ...(pack.targetSurface ? { targetSurface: pack.targetSurface } : {}),
  routing: pack.routing,
});

const fixturePackToWorldPack = (pack: RouterFixturePack): WorldPack => ({
  id: pack.domain.id,
  ...(pack.domain.targetSurface ? { targetSurface: pack.domain.targetSurface } : {}),
  routing: pack.domain.routing,
});

export const loadRoutingWorld = async (input: RoutingWorldInput): Promise<RoutingWorld> => {
  const domainsRoot = input.domainsRoot ?? defaultDomainsRoot;
  const kind = input.registry.kind;
  const replace = kind === "test-fixture";
  const merge = kind === "merge";
  const fixtureRoot = kind === "merge" ? input.registry.fixtureRoot : input.registry.root;
  const fixturePacks = (replace || merge) ? await loadRouterFixturePacks(fixtureRoot) : [];
  const bundledPacks = replace ? [] : await loadBundledRouterPacks(domainsRoot);
  const fixtureDomainIds = new Set(fixturePacks.map((pack) => pack.domain.id));
  const fixtureSkillIds = new Set(fixturePacks.flatMap((pack) => pack.skills.map((skill) => skill.id)));
  const packs: WorldPack[] = replace
    ? fixturePacks.map(fixturePackToWorldPack)
    : merge
      ? [
          ...bundledPacks.filter((pack) => !fixtureDomainIds.has(pack.id)),
          ...fixturePacks.map(fixturePackToWorldPack),
        ]
      : bundledPacks;
  const registrySkills = replace ? [] : await loadLocalRegistry(input.registry.root);
  const installedSkillIds = new Set(input.installed.map((entry) => entry.skillId));
  const fixtureMetadata = (replace || merge)
    ? (await Promise.all(fixturePacks.flatMap((pack) => pack.skills.map((skill) => buildRouterSkillMetadata({
      // Replace mode is a fully synthetic world: lockfile entries describe real
      // installed skills, so a fixture id colliding with one must never flip the
      // marking (pre-migration preparation hardcoded fixture skills to installed:
      // false). Merge mode keeps the explicit marking as the strict-installed
      // simulation contract: the eval passes its controlled installed list.
      source: { kind: "fixture", skill, installed: merge && installedSkillIds.has(skill.id) },
      projectRoot: input.projectRoot,
      targetAgent: input.targetAgent,
      inputs: input.skillInputs,
      intent: input.intent,
    }))))).map((built) => built!.metadata)
    : [];
  const builtRegistry = await Promise.all(registrySkills.map((skill) => buildRouterSkillMetadata({
    source: { kind: "registry", skill },
    projectRoot: input.projectRoot,
    targetAgent: input.targetAgent,
    inputs: input.skillInputs,
    intent: input.intent,
    installed: input.installed,
  })));
  const registryMetadata: RoutingWorldSkill[] = builtRegistry.flatMap((built, index) => {
    if (built === undefined) return [];
    const skill = registrySkills[index];
    return [{
      ...built.metadata,
      skill,
      ...(built.installedRoot !== undefined ? { installedRoot: built.installedRoot } : {}),
      ...(built.entry !== undefined ? { entry: built.entry } : {}),
    }];
  });
  // Override-by-id: in merge mode a fixture skill wins over a bundled skill with
  // the same id, and bundled skills of a fixture-overridden domain are dropped so
  // the fixture pack owns that domain.
  const skills = merge
    ? [
        ...registryMetadata.filter((skill) => !fixtureSkillIds.has(skill.id) && !skill.domains?.some((domain) => fixtureDomainIds.has(domain))),
        ...fixtureMetadata,
      ]
    : [...registryMetadata, ...fixtureMetadata];
  const routingPacks = replace
    ? adaptFixtureRoutingPacks(fixturePacks)
    : merge
      ? [
          ...(await loadBundledRoutingPacks(bundledPacks)).filter((pack) => !fixtureDomainIds.has(pack.domainId)),
          ...adaptFixtureRoutingPacks(fixturePacks),
        ]
      : await loadBundledRoutingPacks(bundledPacks);
  const routingContext = buildRoutingContext({
    packs: routingPacks,
    skills: skills.map(canonicalSkillRoutingDocument),
    coreVocabulary: coreRoutingVocabulary,
    // The base registry digest is always the real digest over the loaded records
    // (router metadata plus the registry-skill objects and installed-entry fields
    // they carry), computed here exactly once; no call site can substitute a fake
    // digest. Because it covers the full loaded records, digest values are only
    // comparable across runs built by this loader — evaluation registryDigests
    // never match pre-migration hand-rolled digests over metadata only.
    baseRegistryDigest: routerRecordDigest(skills),
  });
  return { skills, domains: packs.map(domainMetadata), routingPacks, routingContext };
};

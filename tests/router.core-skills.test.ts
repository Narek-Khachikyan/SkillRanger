import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getAdapter } from "../src/installers/codex.ts";
import { findSkill } from "../src/registry/index.ts";
import { loadLocalRegistry } from "../src/registry/index.ts";
import { analyzeTask } from "../src/router/analyzer.ts";
import { loadBundledRouterPacks } from "../src/domains/registry.ts";
import { defaultDomainsRoot } from "../src/paths.ts";
import { buildRoutingContext } from "../src/router/context.ts";
import { canonicalSkillRoutingDocument } from "../src/router/metadata.ts";
import { createRouterReader, prepareTask } from "../src/router/prepare.ts";
import { resolveDomains } from "../src/router/resolver.ts";
import type { RouterSkillMetadata } from "../src/router/composer.ts";
import { coreRoutingVocabulary } from "../src/router/vocabulary/core.ts";
import { loadBundledRoutingPacks } from "../src/router/vocabulary/load.ts";

const coreSkillIds = ["core.proportional-engineering", "core.universal-safety"];
const registry = path.resolve("registry");

const project = () => mkdtemp(path.join(os.tmpdir(), "skillranger-core-skills-"));

const prepareFrontend = (root: string, prompt: string, strict: boolean, skillInputs?: Record<string, Record<string, unknown>>) => prepareTask({
  projectRoot: root,
  registry: { kind: "bundled", root: registry },
  prompt,
  activation: { mode: "explicit" },
  targetAgent: "codex",
  strict,
  ...(skillInputs === undefined ? {} : { skillInputs }),
  capabilities: [{ id: "filesystem", source: "host-reported" }],
  routingDate: "2026-08-12",
});

const installPerformanceReview = async (root: string) => {
  const skill = await findSkill("frontend.performance-review", registry);
  assert.ok(skill);
  await getAdapter("codex").applyInstall(skill!, { projectRoot: root, targetAgent: "codex", scope: "repo", dryRun: false, mode: "copy" });
};

const readAllMandatory = async (root: string, routerRunId: string) => {
  const reader = createRouterReader(root, registry);
  const order: string[] = [];
  let revision = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const out = await reader.read({
      routerRunId,
      readRequestId: crypto.randomUUID(),
      expectedReadRevision: revision,
      mode: "mandatory-next",
    });
    order.push(out.skillId);
    revision = out.readRevision;
    if (out.readStatus.runMandatoryReadsComplete) break;
  }
  return order;
};

const bundledFixture = async () => {
  const packs = await loadBundledRouterPacks(defaultDomainsRoot);
  const routingPacks = await loadBundledRoutingPacks(packs);
  const skills = (await loadLocalRegistry(registry)).flatMap((loaded): RouterSkillMetadata[] => {
    const routing = loaded.manifest.routing;
    if (!routing?.roles || !routing.domains || !routing.actions || !routing.artifactTypes || !routing.intentTags || !routing.technologyTags || !routing.qualityGoals) return [];
    return [{
      id: loaded.manifest.id,
      displayName: loaded.manifest.displayName,
      version: loaded.manifest.version,
      riskLevel: loaded.manifest.riskLevel,
      roles: routing.roles,
      domains: routing.domains,
      actions: routing.actions,
      artifactTypes: routing.artifactTypes,
      intentTags: routing.intentTags,
      technologyTags: routing.technologyTags,
      qualityGoals: routing.qualityGoals,
      environmentSignals: routing.environmentSignals,
      requiredCapabilities: routing.requiredCapabilities,
      optionalCapabilities: routing.optionalCapabilities,
      complements: routing.complements,
      dependencies: loaded.manifest.dependencies,
      conflictsWith: loaded.manifest.conflictsWith,
      supersedes: loaded.manifest.supersedes,
      packageChecksum: loaded.checksum,
      source: "bundled-registry",
      auditPassed: true,
      qualityScore: loaded.manifest.qualityScore,
      securityScore: loaded.manifest.securityScore,
      freshnessDate: loaded.manifest.freshness?.lastReviewedAt,
    }];
  });
  const routingContext = buildRoutingContext({
    packs: routingPacks,
    skills: skills.map(canonicalSkillRoutingDocument),
    coreVocabulary: coreRoutingVocabulary,
    baseRegistryDigest: "core-interference-test",
  });
  const domains = packs.map((pack) => ({ id: pack.id, targetSurface: pack.id === "frontend" ? "web" : undefined, routing: pack.routing! }));
  return { skills, routingContext, domains };
};

test("a frontend task run always includes both core skills, first in router-level read order", async () => {
  const root = await project();
  const prepared = await prepareFrontend(root, "Make the page delightful @skillranger", false);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  const agentContextIds = prepared.selections.agentContext.map(({ skillId }) => skillId);
  assert.ok(coreSkillIds.every((skillId) => agentContextIds.includes(skillId)));
  assert.equal(prepared.requiredReads[0]?.skillId, "core.proportional-engineering");
  assert.equal(prepared.requiredReads[1]?.skillId, "core.universal-safety");
  assert.deepEqual(await readAllMandatory(root, prepared.run.routerRunId), [...coreSkillIds, prepared.selections.primary.skillId]);
});

test("a strict run creates with core skills present, without runtime ledgers or recommendations for them", async () => {
  const root = await project();
  await cp("fixtures/vite-react-ts", root, { recursive: true });
  await installPerformanceReview(root);

  const prepared = await prepareFrontend(root, "Review frontend performance risks @skillranger", true, {
    "frontend.performance-review": { mode: "risk-review", affectedFlows: ["initial load"] },
  });
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  const agentContextIds = prepared.selections.agentContext.map(({ skillId }) => skillId);
  assert.ok(coreSkillIds.every((skillId) => agentContextIds.includes(skillId)));
  assert.equal(prepared.requiredReads[0]?.skillId, "core.proportional-engineering");
  assert.equal(prepared.requiredReads[1]?.skillId, "core.universal-safety");

  const runtime = JSON.parse(await readFile(path.join(root, ".skillranger", "runs", `${prepared.run.runtimeRunId}.json`), "utf8")) as {
    schemaVersion?: string;
    skillLedgers?: Array<{ skillId: string }>;
    recommendations?: Array<{ skillId: string }>;
  };
  assert.equal(runtime.schemaVersion, "2.0");
  assert.deepEqual(runtime.skillLedgers?.map(({ skillId }) => skillId), ["frontend.performance-review"]);
  assert.ok(coreSkillIds.every((skillId) => (runtime.recommendations ?? []).every(({ skillId: candidate }) => candidate !== skillId)));
  assert.deepEqual(await readAllMandatory(root, prepared.run.routerRunId), [...coreSkillIds, "frontend.performance-review"]);
});

test("frontend.agents-md-bootstrap still occupies the agent-context slot alongside core skills", async () => {
  const root = await project();
  const prepared = await prepareFrontend(root, "Create a concise AGENTS.md for this frontend application. @skillranger", false);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;
  const agentContextIds = prepared.selections.agentContext.map(({ skillId }) => skillId);
  assert.ok(coreSkillIds.every((skillId) => agentContextIds.includes(skillId)));
  assert.ok(agentContextIds.includes("frontend.agents-md-bootstrap"));
});

test("core skills are always included in the limited deterministic fallback routing mode", async () => {
  const root = await project();
  const prepared = await prepareFrontend(root, "Implement a responsive web interface. @skillranger", false);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;
  assert.equal(prepared.routing.mode, "limited-deterministic-fallback");
  const agentContextIds = prepared.selections.agentContext.map(({ skillId }) => skillId);
  assert.ok(coreSkillIds.every((skillId) => agentContextIds.includes(skillId)));
});

test("the core domain pack vocabulary never interferes with frontend routing", async () => {
  const fixture = await bundledFixture();
  const analysis = analyzeTask({
    prompt: "Make the interface more polished",
    domains: fixture.domains,
    skills: fixture.skills,
    routingContext: fixture.routingContext,
  });
  assert.equal(analysis.profile.domains.some(({ id }) => id === "core"), false);

  const resolution = resolveDomains({
    profile: analysis.profile,
    domains: fixture.domains,
    skills: fixture.skills,
    fingerprint: { schemaVersion: "1.0", root: ".", projectTypes: [], languages: [], frameworks: [], styling: [], testing: [], infrastructure: [], dependencies: [], agentContext: { agentsMd: { present: false, paths: [] }, codexSkills: { present: false, paths: [] }, claudeSkills: { present: false, paths: [] } }, signals: [], tags: [], warnings: [] },
    availableDomainIds: fixture.domains.map(({ id }) => id),
    routingIntentTags: analysis.routingIntentTags,
    routingContext: fixture.routingContext,
    routingSignals: analysis.matchedSignals,
  });
  assert.equal(resolution.candidates.some(({ id }) => id === "core"), false);
});

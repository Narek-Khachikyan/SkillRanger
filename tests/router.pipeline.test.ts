import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { defaultDomainsRoot, defaultRegistryRoot } from "../src/paths.ts";
import { loadBundledRouterPacks } from "../src/domains/registry.ts";
import "../src/domains/bundled.ts";
import { loadLocalRegistry } from "../src/registry/index.ts";
import { loadRouterFixturePacks, type RouterFixturePack } from "../src/router/fixtures.ts";
import { buildRoutingContext } from "../src/router/context.ts";
import { canonicalSkillRoutingDocument } from "../src/router/metadata.ts";
import { defaultRouterLimits } from "../src/router/composer.ts";
import { buildSkillCatalog, inspectSkillCatalog } from "../src/router/catalog.ts";
import { buildRouterSkillMetadata } from "../src/router/skill-metadata.ts";
import { coreRoutingVocabulary } from "../src/router/vocabulary/core.ts";
import { adaptFixtureRoutingPacks, loadBundledRoutingPacks } from "../src/router/vocabulary/load.ts";
import { parseTrigger } from "../src/router/trigger.ts";
import { RoutingPipelineError, runRoutingPipeline, type RoutingPipelineInput } from "../src/router/pipeline.ts";
import type { TaskAnalyzerDomainMetadata } from "../src/router/analyzer.ts";
import type { ProjectFingerprint } from "../src/types.ts";

const fixtureRoot = path.resolve("tests/fixtures/router-packs");

const fingerprint = (): ProjectFingerprint => ({
  schemaVersion: "1.0",
  root: "/pipeline-test",
  projectTypes: [],
  languages: [],
  frameworks: [],
  styling: [],
  testing: [],
  infrastructure: [],
  dependencies: [],
  agentContext: {
    agentsMd: { present: false, paths: [] },
    codexSkills: { present: false, paths: [] },
    claudeSkills: { present: false, paths: [] },
  },
  signals: [],
  tags: [],
  warnings: [],
});

const domainMetadata = (domain: RouterFixturePack["domain"]): TaskAnalyzerDomainMetadata => ({
  id: domain.id,
  targetSurface: domain.id === "frontend" ? "web" : domain.id === "mobile" ? "mobile" : undefined,
  routing: domain.routing,
});

const fixtureInput = async (overrides: {
  prompt: string;
  strict?: boolean;
  capabilities?: string[];
  installed?: (skillId: string) => boolean;
  answers?: RoutingPipelineInput["answers"];
  semanticHints?: RoutingPipelineInput["semanticHints"];
} = {
  prompt: "Fix the authentication workflow @skillranger",
}): Promise<RoutingPipelineInput> => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const installed = overrides.installed ?? (() => false);
  const skills = (await Promise.all(packs.flatMap((pack) => pack.skills.map((skill) => buildRouterSkillMetadata({
    source: { kind: "fixture", skill, installed: installed(skill.id) },
    projectRoot: "/pipeline-test",
    targetAgent: "codex",
    inputs: {},
  }))))).map((built) => built!.metadata);
  const routingContext = buildRoutingContext({
    packs: adaptFixtureRoutingPacks(packs),
    skills: skills.map(canonicalSkillRoutingDocument),
    coreVocabulary: coreRoutingVocabulary,
    baseRegistryDigest: "pipeline-test",
  });
  const parsed = parseTrigger({ prompt: overrides.prompt, mode: "explicit" });
  assert.ok(parsed.activated, `prompt must activate: ${overrides.prompt}`);
  return {
    trigger: parsed,
    activation: { mode: "explicit" },
    skills,
    domains: packs.map(({ domain }) => domainMetadata(domain)),
    fingerprint: fingerprint(),
    routingContext,
    targetAgent: "codex",
    strict: overrides.strict ?? false,
    capabilities: overrides.capabilities ?? ["filesystem", "terminal"],
    routingDate: "2026-08-14",
    limits: defaultRouterLimits,
    ...(overrides.answers ? { answers: overrides.answers } : {}),
    ...(overrides.semanticHints ? { semanticHints: overrides.semanticHints } : {}),
  };
};

const pipelineError = (error: unknown, code: string, message?: RegExp) => (
  error instanceof RoutingPipelineError && error.code === code && (message ? message.test(error.message) : true)
);

test("a routing proposal and semantic hints are mutually exclusive at the input", async () => {
  const input = await fixtureInput({ prompt: "Fix the refresh token flow in NestJS @skillranger" });
  assert.throws(
    () => runRoutingPipeline({
      ...input,
      routingProposal: {
        schemaVersion: "routing-proposal/1.0",
        catalogDigest: `sha256:${"a".repeat(64)}`,
        catalogReceipt: "catalog-receipt.example",
        interpretation: { domains: ["frontend"], actions: ["implement"], artifactTypes: ["component"], intentTags: ["component-design"], technologyTags: ["react"], qualityGoals: ["accessibility"] },
        nominations: [{ skillId: "frontend.react-component-design", role: "primary", confidence: 0.9, evidenceText: "build a component" }],
      },
      semanticHints: { schemaVersion: "semantic-hints/1.0", signals: [] },
    }),
    (error: unknown) => pipelineError(error, "routing-proposal-invalid", /cannot be submitted together/),
  );
});

test("a routing proposal requires a preloaded catalog snapshot", async () => {
  const input = await fixtureInput({ prompt: "Fix the refresh token flow in NestJS @skillranger" });
  assert.throws(
    () => runRoutingPipeline({
      ...input,
      routingProposal: {
        schemaVersion: "routing-proposal/1.0",
        catalogDigest: `sha256:${"a".repeat(64)}`,
        catalogReceipt: "catalog-receipt.example",
        interpretation: { domains: ["frontend"], actions: ["implement"], artifactTypes: ["component"], intentTags: ["component-design"], technologyTags: ["react"], qualityGoals: ["accessibility"] },
        nominations: [{ skillId: "frontend.react-component-design", role: "primary", confidence: 0.9, evidenceText: "build a component" }],
      },
    }),
    (error: unknown) => pipelineError(error, "routing-proposal-invalid", /catalog snapshot/),
  );
});

test("a stale proposal catalog digest yields a catalog_refresh_required decision", async () => {
  const catalog = await buildSkillCatalog();
  const input = await fixtureInput({ prompt: "Fix the refresh token flow in NestJS @skillranger" });
  const decision = runRoutingPipeline({
    ...input,
    catalog,
      routingProposal: {
        schemaVersion: "routing-proposal/1.0",
        catalogDigest: `sha256:${"b".repeat(64)}`,
        catalogReceipt: "catalog-receipt.example",
        interpretation: { domains: ["frontend"], actions: ["implement"], artifactTypes: ["component"], intentTags: ["component-design"], technologyTags: ["react"], qualityGoals: ["accessibility"] },
        nominations: [{ skillId: "frontend.react-component-design", role: "primary", confidence: 0.9, evidenceText: "build a component" }],
      },
  });
  assert.equal(decision.outcome.status, "catalog_refresh_required");
  assert.equal(decision.outcome.reasonCode, "catalog-digest-mismatch");
  assert.equal(decision.outcome.currentCatalogDigest, catalog.digest);
  assert.equal(decision.outcome.nextTool, "inspect_skill_catalog");
  assert.equal(decision.mode, "limited-deterministic-fallback");
  assert.equal(decision.taskProfile, undefined);
  assert.deepEqual(decision.domains, []);
  assert.deepEqual(decision.warnings, []);
  assert.deepEqual(decision.continuation.ambiguousDomainIds, []);
});

test("a routed fallback decision carries selections, digests, and outcome-mapped domains", async () => {
  const input = await fixtureInput({ prompt: "Fix the refresh token flow in NestJS @skillranger" });
  const decision = runRoutingPipeline(input);
  assert.equal(decision.mode, "limited-deterministic-fallback");
  assert.equal(decision.outcome.status, "prepared");
  assert.equal(decision.outcome.primaryDomain, "backend-api");
  assert.equal(decision.outcome.selections.primary.skillId, "backend.auth-implementation");
  assert.ok(decision.outcome.selectedSkillIds.includes("backend.auth-implementation"));
  assert.equal(decision.domains.find(({ id }) => id === "backend-api")?.role, "primary");
  assert.ok(decision.digests.registryDigest.length > 0);
  assert.match(decision.digests.signalDigest, /^sha256:/);
  assert.match(decision.digests.vocabularyDigest, /^sha256:/);
  assert.match(decision.digests.semanticHintsDigest, /^sha256:/);
  assert.ok(decision.taskProfile);
  assert.equal(decision.routingProposal, undefined);
  assert.deepEqual(decision.continuation.ambiguousDomainIds, []);
  assert.deepEqual(decision.continuation.skillAmbiguityIds, []);
  assert.ok(Array.isArray(decision.rejections));
});

test("the decision is deterministic across repeated calls", async () => {
  const input = await fixtureInput({ prompt: "Fix the refresh token flow in NestJS @skillranger" });
  assert.deepEqual(runRoutingPipeline(input), runRoutingPipeline(input));
});

test("ambiguous domains yield a clarification question with eligibility", async () => {
  const input = await fixtureInput({ prompt: "Create a new application interface @skillranger" });
  const decision = runRoutingPipeline(input);
  assert.equal(decision.outcome.status, "clarification_required");
  const question = decision.outcome.clarification.questions[0];
  assert.equal(question.id, "primary-domain");
  const values = question.options.map(({ value }) => value);
  assert.ok(values.includes("frontend"));
  assert.ok(values.includes("mobile"));
  assert.deepEqual([...decision.continuation.ambiguousDomainIds].sort(), ["frontend", "mobile"].sort());
  assert.deepEqual(decision.continuation.skillAmbiguityIds, []);
});

test("a validated domain answer resolves the clarification into a prepared decision", async () => {
  const input = await fixtureInput({
    prompt: "Create a new application interface @skillranger",
    answers: [{ questionId: "primary-domain", value: "frontend" }],
  });
  const decision = runRoutingPipeline(input);
  assert.equal(decision.outcome.status, "prepared");
  assert.equal(decision.outcome.primaryDomain, "frontend");
  assert.equal(decision.outcome.selections.primary.skillId, "frontend.synthetic-interface");
});

test("an unsupported domain answer fails closed", async () => {
  const input = await fixtureInput({
    prompt: "Create a new application interface @skillranger",
    answers: [{ questionId: "primary-domain", value: "bogus-domain" }],
  });
  assert.throws(
    () => runRoutingPipeline(input),
    (error: unknown) => pipelineError(error, "clarification-answer-invalid", /available primary domain/),
  );
});

test("continuation answers without a clarification violate the input invariant", async () => {
  const input = await fixtureInput({
    prompt: "Fix the refresh token flow in NestJS @skillranger",
    answers: [{ questionId: "primary-domain", value: "frontend" }],
  });
  assert.throws(
    () => runRoutingPipeline(input),
    (error: unknown) => pipelineError(error, "continuation-invalid", /does not match a routing clarification/),
  );
});

test("multi-domain tasks decompose with their subtasks", async () => {
  const input = await fixtureInput({ prompt: "Исправь refresh token flow в NestJS и добавь integration tests @skillranger" });
  const decision = runRoutingPipeline(input);
  assert.equal(decision.outcome.status, "decomposition_required");
  assert.equal(decision.outcome.decomposition.subtasks.length, 2);
  assert.ok(decision.outcome.decomposition.subtasks.every(({ normalizedGoal }) => normalizedGoal.trim().length > 0));
});

test("unrelated tasks produce a no_matching_skills decision", async () => {
  const input = await fixtureInput({ prompt: "Напиши стихотворение о море @skillranger" });
  const decision = runRoutingPipeline(input);
  assert.equal(decision.outcome.status, "no_matching_skills");
  assert.ok(decision.outcome.suggestedAction.length > 0);
});

test("strict routing reports unmet strict requirements without naming the public outcome", async () => {
  const input = await fixtureInput({ prompt: "Fix the installed authentication workflow @skillranger", strict: true });
  const decision = runRoutingPipeline(input);
  assert.equal(decision.outcome.status, "strict-requirements-unmet");
  assert.ok(decision.outcome.missing.some(
    ({ skillId, requirement }) => skillId === "backend.auth-implementation" && requirement === "installed-skill",
  ));
});

test("installed strict skills route to a prepared strict decision", async () => {
  const input = await fixtureInput({
    prompt: "Fix the installed authentication workflow @skillranger",
    strict: true,
    installed: (skillId) => skillId === "backend.auth-implementation",
  });
  const decision = runRoutingPipeline(input);
  assert.equal(decision.outcome.status, "prepared");
  assert.equal(decision.outcome.selections.primary.skillId, "backend.auth-implementation");
});

test("instruction budget overflow surfaces the blocking budget outcome", async () => {
  const input = await fixtureInput({ prompt: "Use the oversized backend workflow @skillranger" });
  const decision = runRoutingPipeline(input);
  assert.equal(decision.outcome.status, "context_budget_exceeded");
  assert.ok(decision.outcome.requiredBytes > decision.outcome.allowedBytes);
});

test("analysis warnings aggregate into the decision", async () => {
  const input = await fixtureInput({ prompt: "Fix the refresh token flow in NestJS using Vulkan @skillranger" });
  const decision = runRoutingPipeline(input);
  assert.ok(decision.warnings.includes("unclassified-technology-signal"));
  assert.equal(decision.outcome.status, "prepared");
});

test("a valid routing proposal participates in a model-assisted decision", async () => {
  const bundledPacks = await loadBundledRouterPacks(defaultDomainsRoot);
  const routingPacks = await loadBundledRoutingPacks(bundledPacks);
  const skills = (await Promise.all((await loadLocalRegistry(defaultRegistryRoot)).map((skill) => buildRouterSkillMetadata({
    source: { kind: "registry", skill },
    projectRoot: process.cwd(),
    targetAgent: "codex",
    inputs: {},
  })))).filter((built): built is NonNullable<typeof built> => built !== undefined).map((built) => built.metadata);
  const routingContext = buildRoutingContext({
    packs: routingPacks,
    skills: skills.map(canonicalSkillRoutingDocument),
    coreVocabulary: coreRoutingVocabulary,
    baseRegistryDigest: "pipeline-assisted-test",
  });
  const catalog = await buildSkillCatalog();
  let page = await inspectSkillCatalog({ maxItems: 2, maxBytes: 256_000 });
  while (!page.complete) {
    page = await inspectSkillCatalog({ cursor: page.nextCursor!, expectedCatalogDigest: page.catalogDigest });
  }
  assert.ok(page.catalogReceipt);
  const parsed = parseTrigger({ prompt: "Please build a component with React @skillranger", mode: "explicit" });
  assert.ok(parsed.activated);
  const decision = runRoutingPipeline({
    trigger: parsed,
    activation: { mode: "explicit" },
    skills,
    domains: bundledPacks.map((pack) => ({ id: pack.id, targetSurface: pack.id === "frontend" ? "web" : undefined, routing: pack.routing })),
    fingerprint: fingerprint(),
    routingContext,
    targetAgent: "codex",
    strict: false,
    capabilities: ["filesystem", "terminal"],
    routingDate: "2026-08-14",
    limits: defaultRouterLimits,
    catalog,
    routingProposal: {
      schemaVersion: "routing-proposal/1.0",
      catalogDigest: catalog.digest,
      catalogReceipt: page.catalogReceipt,
      interpretation: {
        domains: ["frontend"],
        actions: ["implement"],
        artifactTypes: ["component"],
        intentTags: ["component-design"],
        technologyTags: ["react"],
        qualityGoals: ["accessibility"],
      },
      nominations: [{
        skillId: "frontend.react-component-design",
        role: "primary",
        confidence: 0.91,
        evidenceText: "build a component",
      }],
    },
  });
  assert.equal(decision.mode, "model-assisted");
  assert.equal(decision.outcome.status, "prepared");
  assert.equal(decision.outcome.selections.primary.skillId, "frontend.react-component-design");
  assert.ok(decision.routingProposal);
  assert.match(decision.routingProposal.proposalDigest, /^sha256:/);
  assert.deepEqual(decision.routingProposal.rejections, []);
});

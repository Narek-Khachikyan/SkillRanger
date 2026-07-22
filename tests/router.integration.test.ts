import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadBundledRouterPacks } from "../src/domains/registry.ts";
import { callMcpTool } from "../src/mcp/tools.ts";
import { initializeRouterContext } from "../src/mcp/router-context.ts";
import { defaultDomainsRoot } from "../src/paths.ts";
import { loadLocalRegistry } from "../src/registry/index.ts";
import { analyzeTask } from "../src/router/analyzer.ts";
import { retrieveSkillCandidates, type RouterSkillMetadata } from "../src/router/composer.ts";
import { buildRoutingContext } from "../src/router/context.ts";
import { canonicalSkillRoutingDocument } from "../src/router/metadata.ts";
import { prepareTask } from "../src/router/prepare.ts";
import { RouterStore } from "../src/router/store.ts";
import { coreRoutingVocabulary } from "../src/router/vocabulary/core.ts";
import { loadBundledRoutingPacks } from "../src/router/vocabulary/load.ts";

const project = () => mkdtemp(path.join(os.tmpdir(), "skillranger-router-integration-"));
const registry = path.resolve("registry");
const digest = (value: string) => `sha256:${value.repeat(64)}`;
const mcpRoot = project();

const frontendRouteFixture = async () => {
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
    baseRegistryDigest: "frontend-integration",
  });
  const domains = packs.map((pack) => ({ id: pack.id, targetSurface: pack.id === "frontend" ? "web" : undefined, routing: pack.routing! }));
  return { skills, routingContext, domains };
};

const routeFrontendPrompt = async (prompt: string) => {
  const fixture = await frontendRouteFixture();
  const analysis = analyzeTask({ prompt, domains: fixture.domains, skills: fixture.skills, routingContext: fixture.routingContext });
  const input = {
    profile: analysis.profile,
    requirements: analysis.requirements,
    skills: fixture.skills,
    selectedDomainIds: ["frontend"],
    primaryDomainId: "frontend",
    capabilities: ["filesystem", "terminal"],
    routingContext: fixture.routingContext,
    matchedSignals: analysis.matchedSignals,
    routingIntentTags: analysis.routingIntentTags,
    routingDate: "2026-07-21",
  };
  return { analysis, retrieved: retrieveSkillCandidates(input) };
};

test("MCP router rejects missing trigger without creating a run", async () => {
  const root = await mcpRoot;
  process.env.SKILLRANGER_PROJECT_ROOT = root;
  initializeRouterContext();
  const result = await callMcpTool("prepare_task", { prompt: "Create a page" });
  assert.equal(result.isError, true);
  assert.equal((result.structuredContent as { code: string }).code, "trigger-required");
  assert.deepEqual(await readdir(path.join(root, ".skillranger")).catch(() => []), []);
});

test("MCP router uses the fixed project root and rejects caller root injection", async () => {
  const root = await mcpRoot;
  const outside = await project();
  process.env.SKILLRANGER_PROJECT_ROOT = root;
  initializeRouterContext();
  const result = await callMcpTool("prepare_task", { prompt: "Create a page @skillranger", projectRoot: outside });
  assert.equal(result.isError, true);
  assert.equal((result.structuredContent as { code: string }).code, "project-root-unauthorized");
});

test("router persistence does not contain raw prompt canaries", async () => {
  const root = await project();
  const canary = "SECRET_CANARY_7f4c";
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: `Create a responsive web interface for ${canary} https://private.example/customer @skillranger`,
    activation: { mode: "explicit" },
  });
  assert.equal(result.status, "prepared");
  const routerRunId = result.status === "prepared" ? result.run.routerRunId : "";
  const source = await readFile(path.join(root, ".skillranger", "runs", "router", `${routerRunId}.json`), "utf8");
  assert.doesNotMatch(source, new RegExp(canary));
  assert.doesNotMatch(source, /private\.example/);
});

test("prepared lifecycle cannot begin before the server-controlled mandatory reads", async () => {
  const root = await project();
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Create a responsive web interface @skillranger",
    activation: { mode: "explicit" },
  });
  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") return;
  const before = await callMcpTool("begin_skill_run_execution", { projectRoot: root, runId: result.run.runtimeRunId });
  assert.equal(before.isError, true);
  assert.equal((before.structuredContent as { code: string }).code, "invalid-transition");
});

test("clarification returns no partial router or runtime files", async () => {
  const root = await project();
  const fixtureRoot = path.resolve("tests/fixtures/router-packs");
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "test-fixture", root: fixtureRoot },
    prompt: "Create a new application interface. @skillranger",
    activation: { mode: "explicit" },
  });
  assert.notEqual(result.status, "prepared");
  assert.deepEqual(await readdir(path.join(root, ".skillranger", "runs", "router")).catch(() => []), []);
});

test("identity key is owner-only and survives run pruning", async () => {
  const root = await project();
  const store = new RouterStore(root);
  const identity = await store.projectIdentity();
  assert.match(identity, /^sha256:[a-f0-9]{64}$/);
  const key = await readFile(path.join(root, ".skillranger", "identity.key"));
  assert.equal(key.byteLength, 32);
  await store.prune();
  assert.equal((await readFile(path.join(root, ".skillranger", "identity.key"))).equals(key), true);
});

test("colloquial cupcake request selects visual design with required motion coverage", async () => {
  const prompt = "дай мне сайт про кексы с красивым дизайном, анимациями и мобайл адаптацией";
  const result = await routeFrontendPrompt(prompt);
  const signals = new Set(result.analysis.requirements.map(({ kind, id }) => `${kind}:${id}`));
  for (const required of ["action:create", "artifact:web-interface", "intent:visual-design", "intent:motion-design", "intent:responsive-design"]) {
    assert.ok(signals.has(required), required);
  }
  assert.ok(result.retrieved.rejections.some(({ skillId, reason }) =>
    skillId === "frontend.design-to-code" && reason === "missing-required-evidence:intent:visual-reference"));
  const prepared = await prepareTask({
    projectRoot: await project(), registry: { kind: "bundled", root: registry }, prompt: `${prompt} @skillranger`, activation: { mode: "explicit" },
  });
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;
  assert.equal(prepared.selections.primary.skillId, "frontend.visual-design-polish");
  assert.ok(prepared.selections.companions.some(({ skillId }) => skillId === "frontend.motion-design"));
  assert.ok(prepared.selections.companions.find(({ skillId }) => skillId === "frontend.motion-design")?.reasons.includes("coverage-add:motion-design"));
  const selectedIds = [prepared.selections.primary, ...prepared.selections.companions].map(({ skillId }) => skillId);
  assert.equal(selectedIds.some((id) => id === "frontend.motion-audit" || id === "frontend.design-to-code"), false);
  const optional = prepared.selections.companions.filter(({ skillId }) => skillId !== "frontend.motion-design").map(({ skillId }) => skillId);
  assert.ok(optional.every((id) => ["frontend.tailwind-ui-polish", "frontend.accessibility-review"].includes(id)));
});

test("visual-reference phrases provide direct evidence while bare and negated nouns do not", async () => {
  for (const prompt of ["реализуй по макету из Figma", "build from this screenshot"]) {
    const result = await routeFrontendPrompt(prompt);
    const evidence = result.analysis.matchedSignals.find(({ kind, id }) => kind === "intent" && id === "visual-reference");
    assert.ok(evidence, prompt);
    assert.ok(evidence.source === "prompt-exact" || evidence.source === "prompt-normalized", prompt);
    assert.equal(evidence.evidenceEligible, true, prompt);
    assert.ok(result.retrieved.primaryCandidates.some(({ skill }) => skill.id === "frontend.design-to-code"), prompt);
  }

  for (const prompt of [
    "макет", "figma", "screenshot", "без скриншота", "без макета", "нет скриншота", "нет макета",
    "не используй этот скриншот", "не используй приложенный макет", "no screenshot", "without a screenshot",
    "without a mockup", "do not use this screenshot", "do not use the attached mockup",
  ]) {
    const result = await routeFrontendPrompt(prompt);
    assert.equal(result.analysis.matchedSignals.some(({ kind, id }) => kind === "intent" && id === "visual-reference"), false, prompt);
    assert.ok(result.retrieved.rejections.some(({ skillId, reason }) =>
      skillId === "frontend.design-to-code" && reason === "missing-required-evidence:intent:visual-reference"), prompt);
  }
});

test("Russian Bleach prompt selects visual design primary, motion and accessibility coverage, and excludes agents-md-bootstrap", async () => {
  const prompt = "Создай современный одностраничный сайт по Bleach с узнаваемым нешаблонным визуальным дизайном, атмосферными анимациями, интерактивными элементами, адаптивностью и доступностью. @skillranger";
  const prepared = await prepareTask({
    projectRoot: await project(),
    registry: { kind: "bundled", root: registry },
    prompt,
    activation: { mode: "explicit" },
  });
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  assert.equal(prepared.selections.primary.skillId, "frontend.visual-design-polish");
  const companionIds = prepared.selections.companions.map(({ skillId }) => skillId);
  const verificationIds = prepared.selections.verification.map(({ skillId }) => skillId);
  const agentContextIds = prepared.selections.agentContext.map(({ skillId }) => skillId);
  const selectedIds = [prepared.selections.primary.skillId, ...companionIds, ...verificationIds, ...agentContextIds];

  assert.ok(selectedIds.includes("frontend.motion-design"));
  assert.ok(selectedIds.includes("frontend.accessibility-review"));
  assert.equal(selectedIds.includes("frontend.agents-md-bootstrap"), false);
});

test("English Dragon Ball prompt selects visual design primary, motion and accessibility coverage, and excludes agents-md-bootstrap", async () => {
  const prompt = "Create a visually impressive responsive one-page Dragon Ball website. Avoid generic AI design. Add subtle hover and scroll interactions. Animations should be fast but not distracting. Respect prefers-reduced-motion. Ensure keyboard navigation, visible focus, semantic HTML and contrast. Maintain good Core Web Vitals. skillranger";
  const prepared = await prepareTask({
    projectRoot: await project(),
    registry: { kind: "bundled", root: registry },
    prompt,
    activation: { mode: "explicit" },
  });
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  assert.equal(prepared.selections.primary.skillId, "frontend.visual-design-polish");
  const companionIds = prepared.selections.companions.map(({ skillId }) => skillId);
  const verificationIds = prepared.selections.verification.map(({ skillId }) => skillId);
  const agentContextIds = prepared.selections.agentContext.map(({ skillId }) => skillId);
  const selectedIds = [prepared.selections.primary.skillId, ...companionIds, ...verificationIds, ...agentContextIds];

  assert.ok(selectedIds.includes("frontend.motion-design"));
  assert.ok(selectedIds.includes("frontend.accessibility-review"));
  assert.equal(selectedIds.includes("frontend.agents-md-bootstrap"), false);
});

test("Motion-first task retains motion-design as primary skill", async () => {
  const prompt = "Create a coordinated motion system for the existing frontend, including page transitions, interruption rules and reduced motion. skillranger";
  const prepared = await prepareTask({
    projectRoot: await project(),
    registry: { kind: "bundled", root: registry },
    prompt,
    activation: { mode: "explicit" },
  });
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  assert.equal(prepared.selections.primary.skillId, "frontend.motion-design");
});

test("Explicit AGENTS.md intent selects frontend.agents-md-bootstrap", async () => {
  const prompt = "Create a concise AGENTS.md for this frontend application with project commands, architecture notes and validation guidance. skillranger";
  const prepared = await prepareTask({
    projectRoot: await project(),
    registry: { kind: "bundled", root: registry },
    prompt,
    activation: { mode: "explicit" },
  });
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  const agentContextIds = prepared.selections.agentContext.map(({ skillId }) => skillId);
  assert.ok(agentContextIds.includes("frontend.agents-md-bootstrap"));
});

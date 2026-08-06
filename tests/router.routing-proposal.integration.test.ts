import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { callMcpTool, mcpTools } from "../src/mcp/tools.ts";
import { defaultRouterConfig } from "../src/config/index.ts";
import { initializeRouterContext } from "../src/mcp/router-context.ts";
import { buildSkillCatalog, inspectSkillCatalog } from "../src/router/catalog.ts";
import { prepareTask, RouterPrepareError } from "../src/router/prepare.ts";
import { RouterStore } from "../src/router/store.ts";
import { validateJsonSchema } from "../src/runtime/strict/json-schema.ts";

const registry = path.resolve("registry");
const temporaryProject = () => mkdtemp(path.join(os.tmpdir(), "skillranger-routing-proposal-"));

const runFiles = async (root: string) => ({
  runtime: (await readdir(path.join(root, ".skillranger", "runs")).catch(() => [])).filter((entry) => entry.endsWith(".json")),
  router: (await readdir(path.join(root, ".skillranger", "runs", "router")).catch(() => [])).filter((entry) => entry.endsWith(".json")),
});

const completeReceipt = async (now?: number, sourceOptions: { registryRoot?: string; domainsRoot?: string } = {}) => {
  const pageOptions = { maxItems: 2, maxBytes: 256_000 };
  const catalogOptions = now === undefined ? sourceOptions : { ...sourceOptions, now };
  let page = await inspectSkillCatalog(pageOptions, catalogOptions);
  while (!page.complete) {
    page = await inspectSkillCatalog({
      ...pageOptions,
      cursor: page.nextCursor!,
      expectedCatalogDigest: page.catalogDigest,
    }, catalogOptions);
  }
  assert.ok(page.catalogReceipt);
  return { digest: page.catalogDigest, receipt: page.catalogReceipt };
};

const createCrossDomainBundledFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillranger-cross-domain-proposal-"));
  const registryRoot = path.join(root, "registry");
  const domainsRoot = path.join(root, "domains");
  const sourceSkillRoot = path.resolve("registry/skills/frontend.react-component-design");
  await mkdir(path.join(registryRoot, "skills"), { recursive: true });
  await mkdir(domainsRoot, { recursive: true });

  const skills = [
    { id: "alpha.first", domain: "alpha", riskLevel: "high", roles: ["primary"], dependencies: [] },
    { id: "beta.second", domain: "beta", riskLevel: "low", roles: ["primary"], dependencies: ["gamma.dependency"] },
    { id: "gamma.dependency", domain: "gamma", riskLevel: "low", roles: ["companion"], dependencies: [] },
  ] as const;
  for (const skill of skills) {
    const skillRoot = path.join(registryRoot, "skills", skill.id);
    await cp(sourceSkillRoot, skillRoot, { recursive: true });
    const manifestPath = path.join(skillRoot, "skill.manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    const routing = manifest.routing as Record<string, unknown>;
    manifest.id = skill.id;
    manifest.name = skill.id.replaceAll(".", "-");
    manifest.displayName = skill.id;
    manifest.riskLevel = skill.riskLevel;
    manifest.dependencies = [...skill.dependencies];
    manifest.source = { ...(manifest.source as Record<string, unknown>), path: `./registry/skills/${skill.id}` };
    manifest.routing = {
      ...routing,
      category: `${skill.domain}-workflow`,
      roles: [...skill.roles],
      domains: [skill.domain],
      actions: ["implement"],
      artifactTypes: [`${skill.domain}-artifact`],
      intentTags: [`${skill.domain}-intent`],
      technologyTags: [`${skill.domain}-tech`],
      environmentSignals: [],
      qualityGoals: ["correctness"],
      requiredCapabilities: ["filesystem"],
      optionalCapabilities: [],
      complements: [],
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const skillFile = path.join(skillRoot, "SKILL.md");
    const skillText = await readFile(skillFile, "utf8");
    await writeFile(skillFile, skillText.replace(/^name: .*$/mu, `name: ${skill.id.replaceAll(".", "-")}`));
  }

  for (const skill of skills) {
    const manifest = {
      schemaVersion: "1.1",
      id: skill.domain,
      displayName: skill.domain,
      description: `${skill.domain} test domain.`,
      version: "1.0.0",
      coreApi: "1.0",
      skillIdPrefix: `${skill.domain}.`,
      capabilities: ["intent-routing"],
      artifacts: {
        intents: [],
        schemas: [],
        recipes: [],
        workflows: [],
        validators: [],
        routingVocabulary: "routing.vocabulary.json",
      },
      ownership: [{ intent: `${skill.domain}-intent`, primarySkill: skill.id, supportingSkills: [] }],
      routing: {
        aliases: [`${skill.domain}-surface`],
        intentTags: [`${skill.domain}-intent`],
        artifactTypes: [`${skill.domain}-artifact`],
        technologyTags: [`${skill.domain}-tech`],
        projectTags: [],
      },
    };
    const domainRoot = path.join(domainsRoot, skill.domain);
    await mkdir(domainRoot, { recursive: true });
    await writeFile(path.join(domainRoot, "domain.manifest.json"), JSON.stringify(manifest, null, 2));
    await writeFile(path.join(domainRoot, "routing.vocabulary.json"), JSON.stringify({
      schemaVersion: "routing-vocabulary/1.0",
      owner: { kind: "domain", id: skill.domain },
      entries: [{ kind: "intent", id: `${skill.domain}-intent`, locale: "en", phrases: [`${skill.domain} workflow`] }],
    }, null, 2));
  }
  return { root, registryRoot, domainsRoot };
};

const proposalFor = (catalogDigest: string, catalogReceipt: string, nominations = [{
  skillId: "frontend.motion-design",
  role: "primary",
  confidence: 0.99,
  evidenceText: "make the page delightful",
}]) => ({
  schemaVersion: "routing-proposal/1.0",
  catalogDigest,
  catalogReceipt,
  interpretation: {
    domains: ["frontend"],
    actions: ["implement"],
    artifactTypes: ["web-interface"],
    intentTags: ["motion-design"],
    technologyTags: ["react"],
    qualityGoals: ["visual-quality"],
  },
  nominations,
});

const structured = <T>(value: { structuredContent?: unknown }) => value.structuredContent as T;

test("prepare_task publishes the closed proposal shape and rejects legacy semantic hints", async () => {
  const definition = mcpTools.find(({ name }) => name === "prepare_task");
  assert.ok(definition);
  assert.match(definition.description, /explicit @skillranger, skillranger, or \/sr trigger/);
  assert.match(definition.description, /catalogReceipt/);
  assert.match(definition.description, /runMandatoryReadsComplete/);
  assert.match(definition.description, /skillranger setup/);
  assert.match(definition.description, /legacy SkillRanger server/);
  const readDefinition = mcpTools.find(({ name }) => name === "read_run_skill_file");
  assert.ok(readDefinition);
  assert.match(readDefinition.description, /prepare_task returns prepared/);
  assert.match(readDefinition.description, /runMandatoryReadsComplete/);
  const inputSchema = definition.inputSchema as { properties?: Record<string, unknown> };
  const proposalSchema = inputSchema.properties?.routingProposal as Record<string, unknown>;
  assert.equal(proposalSchema.additionalProperties, false);
  assert.deepEqual(proposalSchema.required, ["schemaVersion", "catalogDigest", "catalogReceipt", "interpretation", "nominations"]);
  assert.deepEqual((inputSchema.properties?.semanticHints as Record<string, unknown>), { type: "object" });

  const root = await temporaryProject();
  process.env.SKILLRANGER_PROJECT_ROOT = root;
  initializeRouterContext();
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const response = await callMcpTool("prepare_task", {
    prompt: "Please make the page delightful @skillranger",
    routingProposal: proposalFor(catalog.digest, binding.receipt),
    semanticHints: { schemaVersion: "semantic-hints/1.0", signals: [] },
  });
  assert.equal(response.isError, true);
  assert.equal(structured<{ code: string }>(response).code, "routing-proposal-invalid");
  assert.deepEqual(await runFiles(root), { runtime: [], router: [] });
});

test("an eligible nomination outranks lexical fallback and persists only the privacy projection", async () => {
  const fallbackRoot = await temporaryProject();
  const fallback = await prepareTask({
    projectRoot: fallbackRoot,
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
  });
  assert.equal(fallback.status, "prepared");
  if (fallback.status !== "prepared") return;
  assert.equal(fallback.selections.primary.skillId, "frontend.visual-design-polish");

  const root = await temporaryProject();
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal: proposalFor(catalog.digest, binding.receipt),
  });
  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") return;
  assert.equal(result.selections.primary.skillId, "frontend.motion-design");
  assert.ok(result.routing.routingProposal);
  assert.deepEqual(validateJsonSchema(mcpTools.find(({ name }) => name === "prepare_task")!.outputSchema!, result), []);
  assert.doesNotMatch(JSON.stringify(result.routing.routingProposal), /make the page delightful/i);

  const stored = await new RouterStore(root).read(result.run.routerRunId);
  assert.ok(stored.routing.routingProposal);
  assert.doesNotMatch(JSON.stringify(stored.routing.routingProposal), /make the page delightful/i);
  assert.equal(stored.routing.routingProposal?.nominations[0]?.skillId, "frontend.motion-design");
  assert.match(stored.routing.routingProposal?.nominations[0]?.evidenceDigest ?? "", /^sha256:/);
});

test("an eligible explicit exact choice outranks host nominations", async () => {
  const root = await temporaryProject();
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Please use frontend.react-component-design to make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal: proposalFor(catalog.digest, binding.receipt, [{
      skillId: "frontend.motion-design",
      role: "primary",
      confidence: 0.99,
      evidenceText: "make the page delightful",
    }]),
  });
  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") return;
  assert.equal(result.selections.primary.skillId, "frontend.react-component-design");
});

test("a hard-vetoed explicit exact choice fails closed without a replacement or partial run", async () => {
  const root = await temporaryProject();
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Please use frontend.design-to-code to make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal: proposalFor(catalog.digest, binding.receipt, [{
      skillId: "frontend.motion-design",
      role: "primary",
      confidence: 0.99,
      evidenceText: "make the page delightful",
    }]),
  });
  assert.equal(result.status, "no_matching_skills");
  if (result.status !== "no_matching_skills") return;
  assert.equal(result.reasonCode, "explicit-skill-choice-missing-required-evidence:intent:visual-reference");
  assert.deepEqual(await runFiles(root), { runtime: [], router: [] });
});

test("stale, expired, and invalid bindings return side-effect-free refresh outcomes", async () => {
  const catalog = await buildSkillCatalog();
  const current = await completeReceipt();
  const cases = [
    {
      name: "stale",
      proposal: proposalFor(`sha256:${"a".repeat(64)}`, current.receipt),
      reasonCode: "catalog-digest-mismatch",
    },
    {
      name: "expired",
      proposal: proposalFor(catalog.digest, (await completeReceipt(0)).receipt),
      reasonCode: "catalog-receipt-expired",
    },
    {
      name: "invalid",
      proposal: proposalFor(catalog.digest, "not-a-catalog-receipt"),
      reasonCode: "catalog-receipt-invalid",
    },
  ] as const;

  for (const item of cases) {
    const root = await temporaryProject();
    const result = await prepareTask({
      projectRoot: root,
      registry: { kind: "bundled", root: registry },
      prompt: "Please make the page delightful @skillranger",
      activation: { mode: "explicit" },
      targetAgent: "codex",
      routingProposal: item.proposal,
    });
    assert.equal(result.status, "catalog_refresh_required", item.name);
    if (result.status !== "catalog_refresh_required") continue;
    assert.equal(result.reasonCode, item.reasonCode);
    assert.equal(result.currentCatalogDigest, catalog.digest);
    assert.equal(result.nextTool, "inspect_skill_catalog");
    assert.deepEqual(validateJsonSchema(mcpTools.find(({ name }) => name === "prepare_task")!.outputSchema!, result), []);
    assert.deepEqual(await runFiles(root), { runtime: [], router: [] });
  }
});

test("invalid nominations are rejected individually and valid nominations still route", async () => {
  const root = await temporaryProject();
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal: proposalFor(catalog.digest, binding.receipt, [
      { skillId: "frontend.not-in-catalog", role: "primary", confidence: 0.8, evidenceText: "make the page delightful" },
      { skillId: "frontend.motion-design", role: "primary", confidence: 0.7, evidenceText: "make the page delightful" },
    ]),
  });
  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") return;
  assert.equal(result.selections.primary.skillId, "frontend.motion-design");
  assert.ok(result.warnings.includes("routing-proposal-rejected:frontend.not-in-catalog:skill-not-in-catalog"));
  assert.equal(result.routing.routingProposal?.rejections[0]?.skillId, "frontend.not-in-catalog");
  assert.equal(result.routing.routingProposal?.rejections[0]?.reasonCode, "skill-not-in-catalog");
});

test("a non-strict hard veto advances to the next valid primary nomination", async () => {
  const root = await temporaryProject();
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal: proposalFor(catalog.digest, binding.receipt, [
      { skillId: "frontend.design-to-code", role: "primary", confidence: 0.99, evidenceText: "make the page delightful" },
      { skillId: "frontend.motion-design", role: "primary", confidence: 0.8, evidenceText: "make the page delightful" },
    ]),
  });
  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") return;
  assert.equal(result.selections.primary.skillId, "frontend.motion-design");
  assert.ok(result.warnings.some((warning) => warning.startsWith("routing-proposal-rejected:frontend.design-to-code:")));
});

test("a cross-domain primary fallback carries dependency domains into the persisted run", async () => {
  const fixture = await createCrossDomainBundledFixture();
  const root = await temporaryProject();
  const catalog = await buildSkillCatalog({ registryRoot: fixture.registryRoot, domainsRoot: fixture.domainsRoot });
  const binding = await completeReceipt(undefined, { registryRoot: fixture.registryRoot, domainsRoot: fixture.domainsRoot });
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: fixture.registryRoot },
    prompt: "Please complete the shared task @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal: {
      schemaVersion: "routing-proposal/1.0",
      catalogDigest: catalog.digest,
      catalogReceipt: binding.receipt,
      interpretation: {
        domains: ["alpha"],
        actions: ["implement"],
        artifactTypes: [],
        intentTags: [],
        technologyTags: [],
        qualityGoals: [],
      },
      nominations: [
        { skillId: "alpha.first", role: "primary", confidence: 0.99, evidenceText: "shared task" },
        { skillId: "beta.second", role: "primary", confidence: 0.98, evidenceText: "shared task" },
      ],
    },
  }, { domainsRoot: fixture.domainsRoot });

  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") return;
  assert.equal(result.selections.primary.skillId, "beta.second");
  assert.ok(result.selections.companions.some(({ skillId }) => skillId === "gamma.dependency"));
  assert.equal(result.routing.domains.find(({ role }) => role === "primary")?.id, "beta");
  assert.equal((await new RouterStore(root).read(result.run.routerRunId)).routing.domains.find(({ role }) => role === "primary")?.id, "beta");
  const runtime = JSON.parse(await readFile(path.join(root, ".skillranger", "runs", `${result.run.runtimeRunId}.json`), "utf8")) as { domain: string };
  assert.equal(runtime.domain, "beta");
});

test("strict routing stops at the first nomination that passes routing vetoes", async () => {
  const root = await temporaryProject();
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    strict: true,
    routingProposal: proposalFor(catalog.digest, binding.receipt, [
      { skillId: "frontend.design-to-code", role: "primary", confidence: 0.99, evidenceText: "make the page delightful" },
      { skillId: "frontend.next-app-router-review", role: "primary", confidence: 0.8, evidenceText: "make the page delightful" },
    ]),
  });
  assert.equal(result.status, "strict_requirements_unmet");
  if (result.status !== "strict_requirements_unmet") return;
  assert.ok(result.missing.some(({ skillId, requirement }) => skillId === "frontend.next-app-router-review" && requirement === "installed-skill"));
  assert.ok(result.warnings.some((warning) => warning.startsWith("routing-proposal-rejected:frontend.design-to-code:")));
});

test("non-primary nomination roles cannot be promoted into the primary workflow", async () => {
  const root = await temporaryProject();
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal: proposalFor(catalog.digest, binding.receipt, [{
      skillId: "frontend.react-component-design",
      role: "companion",
      confidence: 0.9,
      evidenceText: "make the page delightful",
    }]),
  });
  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") return;
  assert.notEqual(result.selections.primary.skillId, "frontend.react-component-design");
  assert.ok(result.selections.companions.some(({ skillId }) => skillId === "frontend.react-component-design"));
});

test("declared primary ambiguity uses typed continuation and honors the selected nomination", async () => {
  const root = await temporaryProject();
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const routingProposal = {
    ...proposalFor(catalog.digest, binding.receipt, [
      { skillId: "frontend.motion-design", role: "primary", confidence: 0.9, evidenceText: "make the page delightful" },
      { skillId: "frontend.visual-design-polish", role: "primary", confidence: 0.89, evidenceText: "make the page delightful" },
    ]),
    ambiguity: { primarySkillIds: ["frontend.motion-design", "frontend.visual-design-polish"] },
  };
  const initial = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal,
  });
  assert.equal(initial.status, "clarification_required");
  if (initial.status !== "clarification_required") return;
  const question = initial.clarification.questions.find(({ id }) => id === "primary-skill");
  assert.ok(question);
  const selected = "frontend.visual-design-polish";
  assert.ok(question.options.some(({ value }) => value === selected));
  assert.deepEqual(await runFiles(root), { runtime: [], router: [] });

  const continued = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal,
    continuationToken: initial.continuationToken,
    clarificationAnswers: [{ questionId: question.id, value: selected }],
  });
  assert.equal(continued.status, "prepared");
  if (continued.status !== "prepared") return;
  assert.equal(continued.selections.primary.skillId, selected);
});

test("malformed or inconsistent ambiguity declarations fail before creating run state", async () => {
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const cases = [
    { primarySkillIds: ["frontend.motion-design"] },
    { primarySkillIds: ["frontend.motion-design", "frontend.not-in-catalog"] },
  ];
  for (const ambiguity of cases) {
    const root = await temporaryProject();
    await assert.rejects(
      () => prepareTask({
        projectRoot: root,
        registry: { kind: "bundled", root: registry },
        prompt: "Please make the page delightful @skillranger",
        activation: { mode: "explicit" },
        targetAgent: "codex",
        routingProposal: {
          ...proposalFor(catalog.digest, binding.receipt, [
            { skillId: "frontend.motion-design", role: "primary", confidence: 0.9, evidenceText: "make the page delightful" },
            { skillId: "frontend.visual-design-polish", role: "primary", confidence: 0.89, evidenceText: "make the page delightful" },
          ]),
          ambiguity,
        },
      }),
      (error: unknown) => error instanceof RouterPrepareError && error.code === "routing-proposal-invalid",
    );
    assert.deepEqual(await runFiles(root), { runtime: [], router: [] });
  }
});

test("an explicit exact user choice outranks a declared primary ambiguity", async () => {
  const root = await temporaryProject();
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Please use frontend.motion-design to make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal: {
      ...proposalFor(catalog.digest, binding.receipt, [
        { skillId: "frontend.visual-design-polish", role: "primary", confidence: 0.99, evidenceText: "make the page delightful" },
        { skillId: "frontend.motion-design", role: "primary", confidence: 0.51, evidenceText: "make the page delightful" },
      ]),
      ambiguity: { primarySkillIds: ["frontend.visual-design-polish", "frontend.motion-design"] },
    },
  });
  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") return;
  assert.equal(result.selections.primary.skillId, "frontend.motion-design");
});

test("without a declaration, nomination order wins and close confidence never creates ambiguity", async () => {
  const root = await temporaryProject();
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal: proposalFor(catalog.digest, binding.receipt, [
      { skillId: "frontend.motion-design", role: "primary", confidence: 0.51, evidenceText: "make the page delightful" },
      { skillId: "frontend.visual-design-polish", role: "primary", confidence: 0.99, evidenceText: "make the page delightful" },
    ]),
  });
  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") return;
  assert.equal(result.selections.primary.skillId, "frontend.motion-design");
});

test("an ineligible ambiguity choice is rejected before persisting run state", async () => {
  const root = await temporaryProject();
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  await assert.rejects(
    () => prepareTask({
      projectRoot: root,
      registry: { kind: "bundled", root: registry },
      prompt: "Please make the page delightful @skillranger",
      activation: { mode: "explicit" },
      targetAgent: "codex",
      routingProposal: {
        ...proposalFor(catalog.digest, binding.receipt, [
          { skillId: "frontend.design-to-code", role: "primary", confidence: 0.99, evidenceText: "make the page delightful" },
          { skillId: "frontend.motion-design", role: "primary", confidence: 0.8, evidenceText: "make the page delightful" },
        ]),
        ambiguity: { primarySkillIds: ["frontend.design-to-code", "frontend.motion-design"] },
      },
    }),
    (error: unknown) => error instanceof RouterPrepareError && error.code === "routing-proposal-invalid",
  );
  assert.deepEqual(await runFiles(root), { runtime: [], router: [] });
});

test("an ambiguity continuation cannot substitute another nomination after a selected-choice veto", async () => {
  const root = await temporaryProject();
  const config = structuredClone(defaultRouterConfig);
  config.router.maxInstructionBytes = 10_000;
  await writeFile(path.join(root, "skillranger.config.json"), JSON.stringify(config));
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const routingProposal = {
    ...proposalFor(catalog.digest, binding.receipt, [
      { skillId: "frontend.visual-design-polish", role: "primary", confidence: 0.9, evidenceText: "make the page delightful" },
      { skillId: "frontend.motion-design", role: "primary", confidence: 0.89, evidenceText: "make the page delightful" },
    ]),
    ambiguity: { primarySkillIds: ["frontend.visual-design-polish", "frontend.motion-design"] },
  };
  const initial = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal,
  });
  assert.equal(initial.status, "clarification_required");
  if (initial.status !== "clarification_required") return;

  const continued = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal,
    continuationToken: initial.continuationToken,
    clarificationAnswers: [{ questionId: "primary-skill", value: "frontend.visual-design-polish" }],
  });
  assert.equal(continued.status, "context_budget_exceeded");
  if (continued.status !== "context_budget_exceeded") return;
  assert.deepEqual(continued.blockingSkillIds, ["frontend.visual-design-polish"]);
  assert.deepEqual(await runFiles(root), { runtime: [], router: [] });
});

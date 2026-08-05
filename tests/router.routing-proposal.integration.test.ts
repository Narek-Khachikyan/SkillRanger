import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { callMcpTool, mcpTools } from "../src/mcp/tools.ts";
import { initializeRouterContext } from "../src/mcp/router-context.ts";
import { buildSkillCatalog, inspectSkillCatalog } from "../src/router/catalog.ts";
import { prepareTask } from "../src/router/prepare.ts";
import { RouterStore } from "../src/router/store.ts";
import { validateJsonSchema } from "../src/runtime/strict/json-schema.ts";

const registry = path.resolve("registry");
const temporaryProject = () => mkdtemp(path.join(os.tmpdir(), "skillranger-routing-proposal-"));

const runFiles = async (root: string) => ({
  runtime: (await readdir(path.join(root, ".skillranger", "runs")).catch(() => [])).filter((entry) => entry.endsWith(".json")),
  router: (await readdir(path.join(root, ".skillranger", "runs", "router")).catch(() => [])).filter((entry) => entry.endsWith(".json")),
});

const completeReceipt = async (now?: number) => {
  const pageOptions = { maxItems: 2, maxBytes: 256_000 };
  const sourceOptions = now === undefined ? {} : { now };
  let page = await inspectSkillCatalog(pageOptions, sourceOptions);
  while (!page.complete) {
    page = await inspectSkillCatalog({
      ...pageOptions,
      cursor: page.nextCursor!,
      expectedCatalogDigest: page.catalogDigest,
    }, sourceOptions);
  }
  assert.ok(page.catalogReceipt);
  return { digest: page.catalogDigest, receipt: page.catalogReceipt };
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

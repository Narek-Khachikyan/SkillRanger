import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getAdapter } from "../src/installers/codex.ts";
import { defaultRouterConfig } from "../src/config/index.ts";
import { initializeRouterContext } from "../src/mcp/router-context.ts";
import { callMcpTool, mcpTools } from "../src/mcp/tools.ts";
import { findSkill } from "../src/registry/index.ts";
import { buildSkillCatalog, inspectSkillCatalog } from "../src/router/catalog.ts";
import { deterministicRoutingKey, prepareTask, RouterPrepareError } from "../src/router/prepare.ts";
import { assertValidRouterRun, RouterStore, RouterStoreError, routerRecordDigest } from "../src/router/store.ts";
import {
  semanticRecallLimitedWarning,
  type DeterministicRoutingProjection,
  type PrepareTaskResult,
  type RouterRun,
} from "../src/router/types.ts";
import { validateJsonSchema } from "../src/runtime/strict/json-schema.ts";

const execFileAsync = promisify(execFile);
const registry = path.resolve("registry");
const fixtureRegistry = path.resolve("tests/fixtures/router-packs");

const temporaryProject = async (fixture?: "next-react-ts" | "vite-react-ts") => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillranger-provenance-"));
  if (fixture) await cp(path.join("fixtures", fixture), root, { recursive: true });
  return root;
};

const runFiles = async (root: string) => {
  const directory = path.join(root, ".skillranger", "runs");
  const runtime = (await readdir(directory).catch(() => [])).filter((entry) => entry.endsWith(".json"));
  const router = (await readdir(path.join(directory, "router")).catch(() => [])).filter((entry) => entry.endsWith(".json"));
  return { runtime, router };
};

const prepared = (result: PrepareTaskResult) => {
  assert.equal(result.status, "prepared", `expected prepared, received ${result.status}`);
  if (result.status !== "prepared") throw new Error(`Expected prepared, received ${result.status}`);
  return result;
};

const recallWarningCount = (warnings: string[]) => warnings.filter((warning) => warning === semanticRecallLimitedWarning).length;

const completeReceipt = async () => {
  const pageOptions = { maxItems: 2, maxBytes: 256_000 };
  let page = await inspectSkillCatalog(pageOptions);
  while (!page.complete) {
    page = await inspectSkillCatalog({ ...pageOptions, cursor: page.nextCursor!, expectedCatalogDigest: page.catalogDigest });
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

const install = async (root: string, skillId: string) => {
  const skill = await findSkill(skillId);
  assert.ok(skill);
  await getAdapter("codex").applyInstall(skill, {
    projectRoot: root,
    targetAgent: "codex",
    scope: "repo",
    dryRun: false,
    mode: "copy",
  });
};

const content = <T>(result: { structuredContent?: unknown }) => result.structuredContent as T;

const mcpRoot = await temporaryProject("next-react-ts");
process.env.SKILLRANGER_PROJECT_ROOT = mcpRoot;
initializeRouterContext();

test("fallback prepared outcomes report limited-deterministic-fallback with the deduplicated recall warning", async () => {
  const root = await temporaryProject("next-react-ts");
  const result = prepared(await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Create a responsive web interface @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
  }));
  assert.equal(result.schemaVersion, "router-result/1.1");
  assert.equal(result.routing.mode, "limited-deterministic-fallback");
  assert.equal(recallWarningCount(result.warnings), 1);
  assert.ok(result.routing.routingProposal === undefined);
});

test("every fallback routed outcome variant carries the mode and the recall warning", async () => {
  // prepared
  const preparedRoot = await temporaryProject("next-react-ts");
  const preparedResult = prepared(await prepareTask({
    projectRoot: preparedRoot,
    registry: { kind: "bundled", root: registry },
    prompt: "Create a responsive web interface @skillranger",
    activation: { mode: "explicit" },
  }));
  assert.equal(preparedResult.routing.mode, "limited-deterministic-fallback");
  assert.equal(recallWarningCount(preparedResult.warnings), 1);

  // clarification_required (ambiguous fixture registry)
  const ambiguousRegistry = await mkdtemp(path.join(os.tmpdir(), "skillranger-provenance-ambiguous-"));
  for (const domainId of ["frontend", "mobile"]) {
    const pack = JSON.parse(await readFile(path.join(fixtureRegistry, domainId, "pack.json"), "utf8")) as {
      domain: { targetSurface?: string };
    };
    if (domainId === "mobile") pack.domain.targetSurface = "native";
    const destination = path.join(ambiguousRegistry, domainId);
    await mkdir(destination);
    await writeFile(path.join(destination, "pack.json"), JSON.stringify(pack));
  }
  const clarification = await prepareTask({
    projectRoot: await temporaryProject(),
    registry: { kind: "replace", root: ambiguousRegistry },
    prompt: "Create a new application interface. @skillranger",
    activation: { mode: "explicit" },
  });
  assert.equal(clarification.status, "clarification_required");
  if (clarification.status !== "clarification_required") return;
  assert.equal(clarification.routing.mode, "limited-deterministic-fallback");
  assert.equal(recallWarningCount(clarification.warnings), 1);

  // decomposition_required
  const decomposition = await prepareTask({
    projectRoot: await temporaryProject(),
    registry: { kind: "replace", root: fixtureRegistry },
    prompt: "Migrate PostgreSQL and redesign the mobile application. @skillranger",
    activation: { mode: "explicit" },
  });
  assert.equal(decomposition.status, "decomposition_required");
  if (decomposition.status !== "decomposition_required") return;
  assert.equal(decomposition.routing.mode, "limited-deterministic-fallback");
  assert.equal(recallWarningCount(decomposition.warnings), 1);

  // no_matching_skills
  const noMatch = await prepareTask({
    projectRoot: await temporaryProject("next-react-ts"),
    registry: { kind: "bundled", root: registry },
    prompt: "Fix NestJS authentication and add integration tests. @skillranger",
    activation: { mode: "explicit" },
  });
  assert.equal(noMatch.status, "no_matching_skills");
  if (noMatch.status !== "no_matching_skills") return;
  assert.equal(noMatch.routing.mode, "limited-deterministic-fallback");
  assert.equal(recallWarningCount(noMatch.warnings), 1);

  // strict_requirements_unmet
  const strictUnmet = await prepareTask({
    projectRoot: await temporaryProject("next-react-ts"),
    registry: { kind: "bundled", root: registry },
    prompt: "Review bundle size, loading speed, and runtime performance @skillranger",
    activation: { mode: "explicit" },
    strict: true,
  });
  assert.equal(strictUnmet.status, "strict_requirements_unmet");
  if (strictUnmet.status !== "strict_requirements_unmet") return;
  assert.equal(strictUnmet.routing.mode, "limited-deterministic-fallback");
  assert.equal(recallWarningCount(strictUnmet.warnings), 1);

  // context_budget_exceeded (instruction budget below the required primary)
  const budgetRoot = await temporaryProject("next-react-ts");
  const config = structuredClone(defaultRouterConfig);
  config.router.maxInstructionBytes = 1_000;
  await writeFile(path.join(budgetRoot, "skillranger.config.json"), JSON.stringify(config));
  const budgetExceeded = await prepareTask({
    projectRoot: budgetRoot,
    registry: { kind: "bundled", root: registry },
    prompt: "Create a responsive web interface @skillranger",
    activation: { mode: "explicit" },
  });
  assert.equal(budgetExceeded.status, "context_budget_exceeded");
  if (budgetExceeded.status !== "context_budget_exceeded") return;
  assert.equal(budgetExceeded.routing.mode, "limited-deterministic-fallback");
  assert.equal(recallWarningCount(budgetExceeded.warnings), 1);
});

test("proposal-backed prepared outcomes report model-assisted without the recall warning", async () => {
  const root = await temporaryProject();
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const result = prepared(await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal: proposalFor(catalog.digest, binding.receipt),
  }));
  assert.equal(result.schemaVersion, "router-result/1.1");
  assert.equal(result.routing.mode, "model-assisted");
  assert.equal(recallWarningCount(result.warnings), 0);
  assert.equal(result.selections.primary.skillId, "frontend.motion-design");
  assert.ok(result.routing.routingProposal);
});

test("catalog refresh outcomes carry no routing state or mode and persist nothing", async () => {
  const root = await temporaryProject();
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    routingProposal: {
      ...proposalFor("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stale-receipt"),
      catalogReceipt: "stale-receipt",
    },
  });
  assert.equal(result.status, "catalog_refresh_required");
  if (result.status !== "catalog_refresh_required") return;
  assert.equal(result.schemaVersion, "router-result/1.1");
  assert.equal(result.reasonCode, "catalog-digest-mismatch");
  assert.equal(result.nextTool, "inspect_skill_catalog");
  assert.ok(!("routing" in result), "refresh outcomes must not fabricate routing state");
  assert.ok(!("warnings" in result));
  assert.deepEqual(await runFiles(root), { runtime: [], router: [] });
});

test("malformed or untrusted proposals return the precise error and never run fallback", async () => {
  // Malformed shape: a non-string role fails closed shape validation before any routing.
  const root = await temporaryProject("next-react-ts");
  await assert.rejects(
    () => prepareTask({
      projectRoot: root,
      registry: { kind: "bundled", root: registry },
      prompt: "Create a responsive web interface @skillranger",
      activation: { mode: "explicit" },
      routingProposal: {
        schemaVersion: "routing-proposal/1.0",
        catalogDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        catalogReceipt: "receipt",
        interpretation: { domains: ["frontend"], actions: ["create"], artifactTypes: ["web-interface"], intentTags: [], technologyTags: [], qualityGoals: [] },
        nominations: [{ skillId: "frontend.motion-design", role: 42, confidence: 0.9, evidenceText: "evidence" }],
      },
    }),
    (error) => error instanceof RouterPrepareError && error.code === "routing-proposal-invalid",
  );
  assert.deepEqual(await runFiles(root), { runtime: [], router: [] });

  // Untrusted content: interpretation referencing non-catalog metadata fails closed.
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const untrustedRoot = await temporaryProject("next-react-ts");
  await assert.rejects(
    () => prepareTask({
      projectRoot: untrustedRoot,
      registry: { kind: "bundled", root: registry },
      prompt: "Please make the page delightful @skillranger",
      activation: { mode: "explicit" },
      routingProposal: {
        ...proposalFor(catalog.digest, binding.receipt),
        interpretation: { domains: ["frontend"], actions: ["implement"], artifactTypes: ["web-interface"], intentTags: ["fabricated-tag"], technologyTags: ["react"], qualityGoals: ["visual-quality"] },
      },
    }),
    (error) => error instanceof RouterPrepareError && error.code === "routing-proposal-invalid",
  );
  assert.deepEqual(await runFiles(untrustedRoot), { runtime: [], router: [] });
});

test("routing mode participates directly in deterministic replay identity", async () => {
  const base = {
    routerAlgorithmVersion: "router/2.1" as const,
    routingDate: "2026-07-21",
    activation: { mode: "direct" as const },
    targetAgent: "codex",
    strict: false,
    capabilities: ["filesystem"],
    taskProfile: {
      schemaVersion: "task-profile/1.0" as const,
      normalizedGoal: "",
      locale: "en" as const,
      actions: [], artifactTypes: [], technologies: [], constraints: [], qualityGoals: [], acceptanceCriteria: [], domains: [], subtasks: [], evidence: [],
    },
    signalDigest: "sha256:a",
    semanticHintsDigest: "sha256:b",
    fingerprintDigest: "sha256:c",
    vocabularyDigest: "sha256:d",
    routingRegistryDigest: "sha256:e",
    configDigest: "sha256:f",
    domains: [],
    warnings: [],
  };
  const fallback: DeterministicRoutingProjection = { ...base, mode: "limited-deterministic-fallback", outcome: { status: "no_matching_skills", suggestedAction: "proceed" } };
  const assisted: DeterministicRoutingProjection = { ...base, mode: "model-assisted", outcome: { status: "no_matching_skills", suggestedAction: "proceed" } };
  const repeated: DeterministicRoutingProjection = { ...fallback };
  assert.notEqual(deterministicRoutingKey(fallback), deterministicRoutingKey(assisted));
  assert.equal(deterministicRoutingKey(fallback), deterministicRoutingKey(repeated));
});

test("identical inputs in different modes produce different keys; same-mode replays stay stable", async () => {
  const input = {
    registry: { kind: "bundled" as const, root: registry },
    prompt: "Create a responsive web interface @skillranger",
    activation: { mode: "explicit" as const },
    targetAgent: "codex",
    routingDate: "2026-07-21",
  };
  const [first, second] = await Promise.all([
    prepareTask({ ...input, projectRoot: await temporaryProject() }),
    prepareTask({ ...input, projectRoot: await temporaryProject() }),
  ]);
  assert.equal(first.status, "prepared");
  assert.equal(second.status, "prepared");
  if (first.status !== "prepared" || second.status !== "prepared") return;
  assert.equal(first.routing.mode, "limited-deterministic-fallback");
  assert.equal(first.routing.deterministicKey, second.routing.deterministicKey);

  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const assisted = prepared(await prepareTask({
    ...input,
    projectRoot: await temporaryProject(),
    routingProposal: proposalFor(catalog.digest, binding.receipt),
  }));
  assert.equal(assisted.routing.mode, "model-assisted");
  assert.notEqual(assisted.routing.deterministicKey, first.routing.deterministicKey);
});

test("CLI JSON and MCP expose the same shared core result contract", async () => {
  const cliRoot = await temporaryProject("next-react-ts");
  const { stdout } = await execFileAsync(process.execPath, [
    "src/cli/index.ts",
    "task",
    cliRoot,
    "--intent",
    "Create a responsive web interface",
    "--target",
    "codex",
    "--json",
  ], { cwd: path.resolve(".") });
  const cli = JSON.parse(stdout) as PrepareTaskResult;
  const mcp = content<PrepareTaskResult>(await callMcpTool("prepare_task", {
    prompt: "Create a responsive web interface @skillranger",
    targetAgent: "codex",
  }));
  assert.equal(cli.status, "prepared");
  assert.equal(mcp.status, "prepared");
  assert.equal(cli.schemaVersion, "router-result/1.1");
  assert.equal(mcp.schemaVersion, cli.schemaVersion);
  assert.equal(cli.routing.mode, "limited-deterministic-fallback");
  assert.equal(mcp.routing.mode, cli.routing.mode);
  const schema = mcpTools.find(({ name }) => name === "prepare_task")?.outputSchema;
  assert.ok(schema);
  assert.deepEqual(validateJsonSchema(schema, cli), []);
  assert.deepEqual(validateJsonSchema(schema, mcp), []);
});

test("the published router-result/1.1 schema requires mode in routed outcomes and forbids it on refresh", async () => {
  const toolSchema = JSON.parse(await readFile("schemas/router-tool-result.schema.json", "utf8")) as Record<string, unknown>;
  const taskSchema = JSON.parse(await readFile("schemas/task-routing-result.schema.json", "utf8")) as Record<string, unknown>;

  const root = await temporaryProject("next-react-ts");
  const fallback = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Create a responsive web interface @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
  });
  assert.deepEqual(validateJsonSchema(toolSchema, fallback), []);
  assert.deepEqual(validateJsonSchema(taskSchema, fallback), []);

  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const assisted = await prepareTask({
    projectRoot: await temporaryProject(),
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal: proposalFor(catalog.digest, binding.receipt),
  });
  assert.deepEqual(validateJsonSchema(toolSchema, assisted), []);

  const refresh = await prepareTask({
    projectRoot: await temporaryProject(),
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    routingProposal: {
      schemaVersion: "routing-proposal/1.0",
      catalogDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      catalogReceipt: "stale",
      interpretation: { domains: ["frontend"], actions: ["implement"], artifactTypes: ["web-interface"], intentTags: ["motion-design"], technologyTags: ["react"], qualityGoals: ["visual-quality"] },
      nominations: [{ skillId: "frontend.motion-design", role: "primary", confidence: 0.99, evidenceText: "make the page delightful" }],
    },
  });
  assert.deepEqual(validateJsonSchema(toolSchema, refresh), []);

  // A routed outcome without a mode is not a valid router-result/1.1 instance.
  const withoutMode = { ...fallback, routing: { ...fallback.routing, mode: undefined } };
  assert.ok(validateJsonSchema(toolSchema, withoutMode).length > 0);
  assert.ok(validateJsonSchema(taskSchema, withoutMode).length > 0);
  // An invented mode value is rejected.
  assert.ok(validateJsonSchema(toolSchema, { ...fallback, routing: { ...fallback.routing, mode: "fabricated-mode" } }).length > 0);
  // Legacy router-result/1.0 instances no longer validate as routed outcomes.
  assert.ok(validateJsonSchema(toolSchema, { ...fallback, schemaVersion: "router-result/1.0" }).length > 0);
  // Refresh outcomes must not fabricate a mode.
  assert.ok(validateJsonSchema(toolSchema, { ...refresh, routing: { mode: "limited-deterministic-fallback" } }).length > 0);
});

test("new RouterRun records persist the routing mode explicitly", async () => {
  const root = await temporaryProject("next-react-ts");
  const fallback = prepared(await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Create a responsive web interface @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
  }));
  const raw = JSON.parse(await readFile(
    path.join(root, ".skillranger", "runs", "router", `${fallback.run.routerRunId}.json`),
    "utf8",
  )) as { routing: { mode?: string } };
  assert.equal(raw.routing.mode, "limited-deterministic-fallback");

  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const assistedRoot = await temporaryProject();
  const assisted = prepared(await prepareTask({
    projectRoot: assistedRoot,
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal: proposalFor(catalog.digest, binding.receipt),
  }));
  const assistedRaw = JSON.parse(await readFile(
    path.join(assistedRoot, ".skillranger", "runs", "router", `${assisted.run.routerRunId}.json`),
    "utf8",
  )) as { routing: { mode?: string } };
  assert.equal(assistedRaw.routing.mode, "model-assisted");
});

test("legacy RouterRun records infer the mode without migration and reject invalid explicit modes", async () => {
  const root = await temporaryProject("next-react-ts");
  const preparedResult = prepared(await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Create a responsive web interface @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
  }));
  const runPath = path.join(root, ".skillranger", "runs", "router", `${preparedResult.run.routerRunId}.json`);
  const run = JSON.parse(await readFile(runPath, "utf8")) as RouterRun;
  const store = new RouterStore(root);

  // Legacy fallback-shaped record: no mode and no proposal.
  delete run.routing.mode;
  await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`);
  assert.equal((await store.read(run.routerRunId)).routing.mode, "limited-deterministic-fallback");
  // The on-disk record stays untouched by a plain read.
  assert.ok(!("mode" in (JSON.parse(await readFile(runPath, "utf8")) as { routing: Record<string, unknown> }).routing));
  // A writer-side update must not migrate the record: the inferred mode is stripped
  // before the write, so the legacy shape and the inference survive the update.
  await store.update(run.routerRunId, (current) => ({ ...current, state: "reading" }));
  const afterUpdate = JSON.parse(await readFile(runPath, "utf8")) as { routing: Record<string, unknown> };
  assert.ok(!("mode" in afterUpdate.routing), "legacy records must not gain an inferred mode through updates");
  assert.equal((await store.read(run.routerRunId)).routing.mode, "limited-deterministic-fallback");

  // Legacy proposal-backed record: no mode, but a persisted proposal infers model-assisted.
  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const assistedRoot = await temporaryProject();
  const assisted = prepared(await prepareTask({
    projectRoot: assistedRoot,
    registry: { kind: "bundled", root: registry },
    prompt: "Please make the page delightful @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal: proposalFor(catalog.digest, binding.receipt),
  }));
  const assistedPath = path.join(assistedRoot, ".skillranger", "runs", "router", `${assisted.run.routerRunId}.json`);
  const assistedRun = JSON.parse(await readFile(assistedPath, "utf8")) as RouterRun;
  delete assistedRun.routing.mode;
  await writeFile(assistedPath, `${JSON.stringify(assistedRun, null, 2)}\n`);
  assert.equal((await new RouterStore(assistedRoot).read(assisted.run.routerRunId)).routing.mode, "model-assisted");

  // An invalid explicit stored mode fails integrity validation.
  const invalidRoot = await temporaryProject("next-react-ts");
  const invalidPrepared = prepared(await prepareTask({
    projectRoot: invalidRoot,
    registry: { kind: "bundled", root: registry },
    prompt: "Create a responsive web interface @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
  }));
  const invalidPath = path.join(invalidRoot, ".skillranger", "runs", "router", `${invalidPrepared.run.routerRunId}.json`);
  const invalidRun = JSON.parse(await readFile(invalidPath, "utf8")) as RouterRun;
  invalidRun.routing.mode = "fabricated-mode" as RouterRun["routing"]["mode"];
  await writeFile(invalidPath, `${JSON.stringify(invalidRun, null, 2)}\n`);
  assert.throws(() => assertValidRouterRun(invalidRun), /routerRun\.routing\.mode/);
  await assert.rejects(
    () => new RouterStore(invalidRoot).read(invalidPrepared.run.routerRunId),
    (error) => error instanceof RouterStoreError && error.code === "run-integrity",
  );
});

test("journal recovery preserves compatibility inference for legacy RouterRun records", async () => {
  const root = await temporaryProject("next-react-ts");
  const result = prepared(await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Create a responsive web interface @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
  }));
  const routerPath = path.join(root, ".skillranger", "runs", "router", `${result.run.routerRunId}.json`);
  const runtimePath = path.join(root, ".skillranger", "runs", `${result.run.runtimeRunId}.json`);
  const routerRun = JSON.parse(await readFile(routerPath, "utf8")) as RouterRun;
  const runtimePayload = JSON.parse(await readFile(runtimePath, "utf8"));
  // Simulate a legacy journal written before routing mode existed.
  delete routerRun.routing.mode;
  await Promise.all([
    writeFile(routerPath, `${JSON.stringify(routerRun, null, 2)}\n`),
    (async () => { await import("node:fs/promises").then(({ unlink }) => unlink(runtimePath)); })(),
  ]);
  const journal = {
    schemaVersion: "router-journal/1.0",
    operationId: "op_provenance_recovery",
    routerRunId: result.run.routerRunId,
    runtimeRunId: result.run.runtimeRunId,
    payloadDigest: routerRecordDigest({ routerRun, runtimePayload }),
    intendedTransition: "create-runtime-and-router",
    createdAt: new Date().toISOString(),
    routerRun,
    runtimePayload,
  };
  await writeFile(path.join(root, ".skillranger", "runs", "router", `${result.run.routerRunId}.journal.json`), `${JSON.stringify(journal)}\n`);
  const runtime = {
    async read(runId: string) {
      try { return JSON.parse(await readFile(path.join(root, ".skillranger", "runs", `${runId}.json`), "utf8")); }
      catch { return undefined; }
    },
    async create(runId: string, value: unknown) { await writeFile(path.join(root, ".skillranger", "runs", `${runId}.json`), `${JSON.stringify(value, null, 2)}\n`); },
  };
  const store = new RouterStore(root, { runtime });
  assert.deepEqual((await store.recover()).recovered, [result.run.routerRunId]);
  const recovered = await store.read(result.run.routerRunId);
  assert.equal(recovered.routing.mode, "limited-deterministic-fallback");
  // A journaled read bridge must not migrate the recovered legacy record either:
  // the candidate is stripped before it is journaled and written.
  const bridged = await store.journaledUpdate({
    routerRun: { ...recovered, revision: recovered.revision + 1, state: "reading" },
    runtime,
    runtimePayload,
    applyRuntime: async () => {},
  });
  assert.equal(bridged.routing.mode, "limited-deterministic-fallback");
  const afterBridge = JSON.parse(await readFile(routerPath, "utf8")) as { routing: Record<string, unknown> };
  assert.ok(!("mode" in afterBridge.routing), "journaled updates must not migrate legacy records");
  assert.equal((await store.read(result.run.routerRunId)).routing.mode, "limited-deterministic-fallback");
});

test("fallback and proposal-backed lifecycle runs keep identical runtime schemas and read inventory", async () => {
  const fallbackRoot = await temporaryProject("next-react-ts");
  const fallback = prepared(await prepareTask({
    projectRoot: fallbackRoot,
    registry: { kind: "bundled", root: registry },
    prompt: "Review and fix accessibility in this web interface @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
  }));
  const fallbackPayload = JSON.parse(await readFile(path.join(fallbackRoot, ".skillranger", "runs", `${fallback.run.runtimeRunId}.json`), "utf8")) as {
    schemaVersion: string;
    skills?: unknown;
  };

  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const assistedRoot = await temporaryProject("next-react-ts");
  const assisted = prepared(await prepareTask({
    projectRoot: assistedRoot,
    registry: { kind: "bundled", root: registry },
    prompt: "Review and fix accessibility in this web interface @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    routingProposal: proposalFor(catalog.digest, binding.receipt, [
      { skillId: "frontend.accessibility-review", role: "primary", confidence: 0.99, evidenceText: "fix accessibility in this web interface" },
      { skillId: "frontend.design-to-code", role: "companion", confidence: 0.7, evidenceText: "fix accessibility in this web interface" },
    ]),
  }));
  const assistedPayload = JSON.parse(await readFile(path.join(assistedRoot, ".skillranger", "runs", `${assisted.run.runtimeRunId}.json`), "utf8")) as {
    schemaVersion: string;
    skills?: unknown;
  };

  assert.equal(fallback.run.runtime, "lifecycle-v1");
  assert.equal(assisted.run.runtime, "lifecycle-v1");
  assert.equal(fallbackPayload.schemaVersion, "1.0");
  assert.equal(assistedPayload.schemaVersion, "1.0");
  // In both modes the mandatory-read inventory is derived from the selected skill
  // sources: every read is mandatory and the read skillIds match the runtime payload
  // exactly, preserving instruction-delivery guarantees regardless of routing mode.
  for (const [result, payload] of [[fallback, fallbackPayload], [assisted, assistedPayload]] as const) {
    assert.ok(result.requiredReads.every(({ mandatory }) => mandatory));
    assert.deepEqual(
      [...new Set(result.requiredReads.map(({ skillId }) => skillId))].sort(),
      (payload as { selectedSkills: Array<{ skillId: string }> }).selectedSkills.map(({ skillId }) => skillId).sort(),
    );
    assert.equal(result.requiredReads.filter(({ skillId }, index, reads) => reads.findIndex((read) => read.skillId === skillId) === index).length, result.requiredReads.length);
  }
});

test("fallback and proposal-backed strict runs keep identical runtime schemas and skill ledgers", async () => {
  const fallbackRoot = await temporaryProject("vite-react-ts");
  await install(fallbackRoot, "frontend.performance-review");
  const fallback = prepared(await prepareTask({
    projectRoot: fallbackRoot,
    registry: { kind: "bundled", root: registry },
    prompt: "Review bundle size, loading speed, and runtime performance @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    strict: true,
    skillInputs: { "frontend.performance-review": { mode: "risk-review", affectedFlows: ["initial load"] } },
  }));

  const catalog = await buildSkillCatalog();
  const binding = await completeReceipt();
  const assistedRoot = await temporaryProject("vite-react-ts");
  await install(assistedRoot, "frontend.performance-review");
  const assisted = prepared(await prepareTask({
    projectRoot: assistedRoot,
    registry: { kind: "bundled", root: registry },
    prompt: "Review bundle size, loading speed, and runtime performance @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    strict: true,
    skillInputs: { "frontend.performance-review": { mode: "risk-review", affectedFlows: ["initial load"] } },
    routingProposal: proposalFor(catalog.digest, binding.receipt, [
      { skillId: "frontend.performance-review", role: "primary", confidence: 0.99, evidenceText: "review bundle size, loading speed, and runtime performance" },
    ]),
  }));

  const fallbackPayload = JSON.parse(await readFile(path.join(fallbackRoot, ".skillranger", "runs", `${fallback.run.runtimeRunId}.json`), "utf8")) as {
    schemaVersion: string;
    skillLedgers: unknown[];
  };
  const assistedPayload = JSON.parse(await readFile(path.join(assistedRoot, ".skillranger", "runs", `${assisted.run.runtimeRunId}.json`), "utf8")) as {
    schemaVersion: string;
    skillLedgers: unknown[];
  };

  assert.equal(fallback.run.runtime, "strict-v2");
  assert.equal(assisted.run.runtime, "strict-v2");
  assert.equal(fallbackPayload.schemaVersion, "2.0");
  assert.equal(assistedPayload.schemaVersion, "2.0");
  assert.equal(fallbackPayload.skillLedgers.length, 1);
  assert.deepEqual(fallbackPayload.skillLedgers, assistedPayload.skillLedgers);
  assert.deepEqual(
    fallback.requiredReads.map(({ skillId, path: readPath, mandatory }) => ({ skillId, path: readPath, mandatory })),
    assisted.requiredReads.map(({ skillId, path: readPath, mandatory }) => ({ skillId, path: readPath, mandatory })),
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getAdapter } from "../src/installers/codex.ts";
import { initializeRouterContext } from "../src/mcp/router-context.ts";
import { callMcpTool, mcpTools } from "../src/mcp/tools.ts";
import { findSkill } from "../src/registry/index.ts";
import { createRouterReader, prepareTask } from "../src/router/prepare.ts";
import { RouterReaderError } from "../src/router/reader.ts";
import { RouterStore, routerRecordDigest, type RouterRuntimeStore } from "../src/router/store.ts";
import type { PrepareTaskResult, ReadRunSkillFileResult } from "../src/router/types.ts";
import { SkillRunStore, type SkillRun } from "../src/runtime/skill-run/index.ts";
import type { VerificationReport } from "../src/runtime/types.ts";
import {
  beginStrictStep,
  completeStrictStep,
  readNextStrictChunk,
  StrictSkillRunStore,
  type SkillRunV2,
} from "../src/runtime/strict/index.ts";
import { validateJsonSchema } from "../src/runtime/strict/json-schema.ts";

const execFileAsync = promisify(execFile);
const registry = path.resolve("registry");
const fixtureRegistry = path.resolve("tests/fixtures/router-packs");
const temporaryProject = async (fixture?: "next-react-ts" | "vite-react-ts") => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillranger-router-e2e-"));
  if (fixture) await cp(path.join("fixtures", fixture), root, { recursive: true });
  return root;
};
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
const runFiles = async (root: string) => {
  const directory = path.join(root, ".skillranger", "runs");
  const runtime = (await readdir(directory).catch(() => [])).filter((entry) => entry.endsWith(".json"));
  const router = (await readdir(path.join(directory, "router")).catch(() => [])).filter((entry) => entry.endsWith(".json"));
  return { runtime, router };
};
const prepared = (result: PrepareTaskResult) => {
  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") throw new Error(`Expected prepared, received ${result.status}`);
  return result;
};
const content = <T>(result: { structuredContent: unknown }) => result.structuredContent as T;
const routerOutputSchema = (toolName: "prepare_task" | "read_run_skill_file") => {
  const schema = mcpTools.find(({ name }) => name === toolName)?.outputSchema;
  assert.ok(schema, `Missing ${toolName} output schema.`);
  return schema;
};

const mcpRoot = await temporaryProject("next-react-ts");
process.env.SKILLRANGER_PROJECT_ROOT = mcpRoot;
initializeRouterContext();

const readAllThroughMcp = async (result: ReturnType<typeof prepared>) => {
  let revision = 0;
  let firstRequest: { routerRunId: string; readRequestId: string; expectedReadRevision: number; mode: "mandatory-next" } | undefined;
  let firstResponse: ReadRunSkillFileResult | undefined;
  while (true) {
    const request = {
      routerRunId: result.run.routerRunId,
      readRequestId: randomUUID(),
      expectedReadRevision: revision,
      mode: "mandatory-next" as const,
    };
    const response = content<ReadRunSkillFileResult>(await callMcpTool("read_run_skill_file", request));
    assert.deepEqual(validateJsonSchema(routerOutputSchema("read_run_skill_file"), response), []);
    firstRequest ??= request;
    firstResponse ??= response;
    revision = response.readRevision;
    if (response.readStatus.runMandatoryReadsComplete) break;
  }
  assert.ok(firstRequest && firstResponse);
  const replay = content<ReadRunSkillFileResult>(await callMcpTool("read_run_skill_file", firstRequest));
  assert.equal(replay.content, firstResponse.content);
  assert.equal(replay.chunkChecksum, firstResponse.chunkChecksum);
  assert.equal(replay.readRevision, firstResponse.readRevision);
};

test("frontend lifecycle prepared/read/begin/complete/verify, unread gate, MCP explicit, and idempotent retry", async () => {
  const preparedResult = await callMcpTool("prepare_task", {
    prompt: "Review and fix accessibility in this web interface, then verify the result. @skillranger",
    targetAgent: "codex",
    hostCapabilities: ["browser", "screenshots"],
  });
  const preparedContent = content<PrepareTaskResult>(preparedResult);
  assert.deepEqual(validateJsonSchema(routerOutputSchema("prepare_task"), preparedContent), []);
  const result = prepared(preparedContent);
  assert.equal(result.activation.mode, "explicit");

  const unread = await callMcpTool("begin_skill_run_execution", { projectRoot: mcpRoot, runId: result.run.runtimeRunId });
  assert.equal(unread.isError, true);
  assert.equal((unread.structuredContent as { code: string }).code, "invalid-transition");

  await readAllThroughMcp(result);
  let runtime = content<SkillRun>(await callMcpTool("begin_skill_run_execution", { projectRoot: mcpRoot, runId: result.run.runtimeRunId }));
  assert.equal(runtime.state, "running");
  runtime = content<SkillRun>(await callMcpTool("complete_skill_run", {
    projectRoot: mcpRoot,
    runId: runtime.runId,
    status: "implemented",
    artifacts: [{ kind: "result", path: "artifacts/result.json", description: "Implemented accessibility fixes" }],
  }));
  const report: VerificationReport = {
    schemaVersion: "1.0",
    domain: "frontend",
    workflowId: "frontend-accessibility-review",
    iteration: 0,
    capabilityStatus: "ready",
    executionStatus: "implemented",
    verificationStatus: "passed",
    outcome: "verified",
    findings: [],
    gates: { hardPassed: true, criticalFindings: 0, highFindings: 0 },
    evidence: [{ kind: "test", path: "artifacts/result.json", description: "Accessibility checks passed" }],
    residualRisks: [],
  };
  runtime = content<SkillRun>(await callMcpTool("verify_skill_run", {
    projectRoot: mcpRoot,
    runId: runtime.runId,
    reportPath: "verification.json",
    report,
  }));
  assert.equal(runtime.state, "verified");
});

test("frontend MCP read_run_skill_file accepts UUID v7 request IDs", async () => {
  const preparedResult = await callMcpTool("prepare_task", {
    prompt: "Review and fix accessibility in this web interface, then verify the result. @skillranger",
    targetAgent: "codex",
    hostCapabilities: ["browser", "screenshots"],
  });
  const result = prepared(content<PrepareTaskResult>(preparedResult));
  const response = content<ReadRunSkillFileResult>(await callMcpTool("read_run_skill_file", {
    routerRunId: result.run.routerRunId,
    readRequestId: "018f2f3d-8e2a-7a4c-9d2f-123456789abc",
    expectedReadRevision: 0,
    mode: "mandatory-next",
  }));
  assert.equal(response.readRevision, 1);
  assert.equal(response.readRequestId, "018f2f3d-8e2a-7a4c-9d2f-123456789abc");
});

test("frontend landing runtime clarification follows mandatory reads and supports explicit assumptions", async () => {
  const prompt = "Создай тематический лендинг про Attack on Titan в духе аниме за одну прокрутку. Избегай AI-slop текста и дизайна.\n\n@skillranger";
  const preparedResult = await callMcpTool("prepare_task", { prompt, targetAgent: "codex" });
  const preparedContent = content<PrepareTaskResult>(preparedResult);
  assert.deepEqual(validateJsonSchema(routerOutputSchema("prepare_task"), preparedContent), []);
  const result = prepared(preparedContent);
  assert.equal(result.activation.trigger, "@skillranger");
  assert.ok(result.runtimeClarification?.questions.some(({ id }) => id === "primary-user-or-actor"));
  assert.ok(result.runtimeClarification?.questions.some(({ id }) => id === "primary-task-and-action"));

  const premature = await callMcpTool("resolve_skill_run_clarifications", {
    projectRoot: mcpRoot,
    runId: result.run.runtimeRunId,
    answers: [],
    declinedFields: ["primaryUserOrActor", "primaryTask", "primaryAction"],
    assumptions: ["Use a general audience.", "Use the requested landing page as the primary task.", "Use a neutral exploration action."],
  });
  assert.equal(premature.isError, true);
  assert.equal((premature.structuredContent as { code: string }).code, "invalid-transition");

  await readAllThroughMcp(result);
  const clarified = content<SkillRun>(await callMcpTool("resolve_skill_run_clarifications", {
    projectRoot: mcpRoot,
    runId: result.run.runtimeRunId,
    answers: [],
    declinedFields: ["primaryUserOrActor", "primaryTask", "primaryAction"],
    assumptions: ["Use a general audience.", "Use the requested landing page as the primary task.", "Use a neutral exploration action."],
  }));
  assert.equal(clarified.state, "clarified");
  assert.equal(clarified.clarification.status, "declined");
  const running = content<SkillRun>(await callMcpTool("begin_skill_run_execution", {
    projectRoot: mcpRoot,
    runId: result.run.runtimeRunId,
  }));
  assert.equal(running.state, "running");
});

const prepareStrictPerformance = async () => {
  const root = await temporaryProject("vite-react-ts");
  await install(root, "frontend.performance-review");
  const result = prepared(await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Review bundle size, loading speed, and runtime performance @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    strict: true,
    skillInputs: { "frontend.performance-review": { mode: "risk-review", affectedFlows: ["initial load"] } },
  }));
  return { root, result };
};

const strictStep = async (
  root: string,
  store: StrictSkillRunStore,
  run: SkillRunV2,
  evidence: Array<{ kind: string; value: unknown; validatedAs?: "output" }> = [],
) => {
  const skillId = "frontend.performance-review";
  const next = run.skillLedgers[0].steps.find(({ status }) => status === "pending");
  assert.ok(next);
  run = await store.update(run.runId, (current) => beginStrictStep(current, skillId, next.id));
  for (const [index, item] of evidence.entries()) {
    const source = path.join(root, "evidence", `${run.revision}-${index}-${item.kind}.json`);
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, typeof item.value === "string" ? item.value : `${JSON.stringify(item.value, null, 2)}\n`);
    run = await store.ingestEvidence(run.runId, {
      sourcePath: source,
      kind: item.kind,
      ...(item.validatedAs ? { validatedAs: item.validatedAs } : {}),
      attributions: [{ skillId, stepId: next.id, attempt: next.attempts.length + 1, relation: "produced", ruleIds: next.ruleIds }],
    });
  }
  return store.update(run.runId, (current) => completeStrictStep(current, skillId, next.id));
};

test("frontend strict installed/read/steps/finalize reaches verified", async () => {
  const { root, result } = await prepareStrictPerformance();
  const strictStore = new StrictSkillRunStore(root);
  const routerStore = new RouterStore(root);
  const reader = createRouterReader(root, registry, routerStore, {
    onMandatorySkillComplete: async ({ run, skillId }) => {
      await strictStore.update(run.runtime.runId, (current) => {
        let next = current;
        const ledger = () => next.skillLedgers.find(({ skillId: id }) => id === skillId)!;
        while (ledger().readReceipts.length !== ledger().contentChunks.length) next = readNextStrictChunk(next, skillId).run;
        return next;
      });
    },
  });
  let revision = 0;
  while (true) {
    const response = await reader.read({ routerRunId: result.run.routerRunId, readRequestId: randomUUID(), expectedReadRevision: revision, mode: "mandatory-next" });
    revision = response.readRevision;
    if (response.readStatus.runMandatoryReadsComplete) break;
  }
  let run = await strictStore.read(result.run.runtimeRunId);
  assert.equal(run.state, "ready");
  run = await strictStep(root, strictStore, run, [{ kind: "affected-flow-inventory", value: "initial load\n" }]);
  run = await strictStep(root, strictStore, run, [{ kind: "static-performance-review", value: "reviewed\n" }]);
  run = await strictStep(root, strictStore, run);
  run = await strictStep(root, strictStore, run, [{
    kind: "performance-report",
    validatedAs: "output",
    value: {
      mode: "risk-review",
      findings: [{ affectedFlow: "initial load", dimension: "LCP", basis: "risk", impact: "high", confidence: "medium", behavior: "Hero delivery may delay paint", evidence: [], expectedBenefit: "Earlier LCP", tradeoff: "Potential preload bytes" }],
      measurementsInspected: [],
      measurementGaps: ["Capture before/after LCP traces for the initial load flow"],
      residualRisks: [],
    },
  }]);
  run = await strictStep(root, strictStore, run, [{ kind: "verification-input", value: { measurements: [] } }]);
  run = await strictStore.verifySkill(run.runId, "frontend.performance-review");
  assert.equal(run.skillLedgers[0].outcome, "used");
  assert.equal((await strictStore.finalizeRun(run.runId)).state, "verified");
});

test("strict not installed and missing capabilities return normal outcomes without partial runs", async () => {
  const strictRoot = await temporaryProject("vite-react-ts");
  const strictResult = await prepareTask({
    projectRoot: strictRoot,
    registry: { kind: "bundled", root: registry },
    prompt: "Review bundle size and frontend performance @skillranger",
    activation: { mode: "explicit" },
    targetAgent: "codex",
    strict: true,
    skillInputs: { "frontend.performance-review": { mode: "risk-review", affectedFlows: ["initial load"] } },
  });
  assert.equal(strictResult.status, "strict_requirements_unmet");
  if (strictResult.status === "strict_requirements_unmet") assert.ok(strictResult.missing.some(({ requirement }) => requirement === "installed-skill"));
  assert.deepEqual(await runFiles(strictRoot), { runtime: [], router: [] });

  const capabilityRoot = await temporaryProject();
  const capabilityResult = await prepareTask({
    projectRoot: capabilityRoot,
    registry: { kind: "test-fixture", root: fixtureRegistry },
    prompt: "Implement authentication without terminal access. @skillranger",
    activation: { mode: "explicit" },
    strict: true,
  });
  assert.equal(capabilityResult.status, "strict_requirements_unmet");
  if (capabilityResult.status === "strict_requirements_unmet") assert.ok(capabilityResult.missing.some(({ requirement }) => requirement === "capability"));
  assert.deepEqual(await runFiles(capabilityRoot), { runtime: [], router: [] });
});

test("clarification continuation creates both records only after a valid answer", async () => {
  const root = await temporaryProject();
  const ambiguousRegistry = await mkdtemp(path.join(os.tmpdir(), "skillranger-router-fixtures-"));
  await cp(fixtureRegistry, ambiguousRegistry, { recursive: true });
  const mobilePackPath = path.join(ambiguousRegistry, "mobile", "pack.json");
  const mobilePack = JSON.parse(await readFile(mobilePackPath, "utf8"));
  mobilePack.domain.targetSurface = "native";
  await writeFile(mobilePackPath, `${JSON.stringify(mobilePack, null, 2)}\n`);
  const input = {
    projectRoot: root,
    registry: { kind: "test-fixture" as const, root: ambiguousRegistry },
    prompt: "Create a new application interface. @skillranger",
    activation: { mode: "explicit" as const },
    routingDate: "2026-07-19",
    capabilities: [{ id: "terminal", source: "host-reported" as const }],
  };
  const initial = await prepareTask(input);
  assert.equal(initial.status, "clarification_required", JSON.stringify(initial.routing.domains));
  assert.deepEqual(await runFiles(root), { runtime: [], router: [] });
  if (initial.status !== "clarification_required") return;
  const question = initial.clarification.questions[0];
  const value = question.options.find((option) => option.value === "mobile")?.value ?? question.options[0].value;
  const continued = prepared(await prepareTask({
    ...input,
    continuationToken: initial.continuationToken,
    clarificationAnswers: [{ questionId: question.id, value }],
  }));
  const files = await runFiles(root);
  assert.deepEqual(files.runtime, [`${continued.run.runtimeRunId}.json`]);
  assert.deepEqual(files.router, [`${continued.run.routerRunId}.json`]);
});

test("decomposition and production no-match create no partial router or runtime record", async () => {
  const decompositionRoot = await temporaryProject();
  const decomposition = await prepareTask({
    projectRoot: decompositionRoot,
    registry: { kind: "test-fixture", root: fixtureRegistry },
    prompt: "Migrate PostgreSQL and redesign the mobile application. @skillranger",
    activation: { mode: "explicit" },
  });
  assert.equal(decomposition.status, "decomposition_required");
  assert.deepEqual(await runFiles(decompositionRoot), { runtime: [], router: [] });

  const noMatchRoot = await temporaryProject("next-react-ts");
  const noMatch = await prepareTask({
    projectRoot: noMatchRoot,
    registry: { kind: "bundled", root: registry },
    prompt: "Fix NestJS authentication and add integration tests. @skillranger",
    activation: { mode: "explicit" },
  });
  assert.equal(noMatch.status, "no_matching_skills");
  assert.deepEqual(await runFiles(noMatchRoot), { runtime: [], router: [] });
});

test("synthetic multi-domain routing preserves primary and supporting domains", async () => {
  const root = await temporaryProject();
  const result = prepared(await prepareTask({
    projectRoot: root,
    registry: { kind: "test-fixture", root: fixtureRegistry },
    prompt: "Fix the authentication API and add its integration tests. @skillranger",
    activation: { mode: "explicit" },
    capabilities: [{ id: "terminal", source: "host-reported" }],
  }));
  assert.equal(result.routing.domains.filter(({ role }) => role === "primary").length, 1);
  assert.ok(result.routing.domains.some(({ id }) => id === "backend-api"));
  assert.ok(result.routing.domains.some(({ id }) => id === "qa-testing"));
});

test("stale checksum blocks a prepared source read without advancing revision", async () => {
  const { root, result } = await prepareStrictPerformance();
  const routerStore = new RouterStore(root);
  const run = await routerStore.read(result.run.routerRunId);
  const source = run.sourceInventory[0];
  assert.equal(source.locator.kind, "installed");
  if (source.locator.kind !== "installed") return;
  await appendFile(path.join(root, source.locator.installedPath, "SKILL.md"), "\nstale mutation\n");
  await assert.rejects(
    () => createRouterReader(root, registry, routerStore).read({ routerRunId: run.routerRunId, readRequestId: randomUUID(), expectedReadRevision: 0, mode: "mandatory-next" }),
    (error) => error instanceof RouterReaderError && error.code === "stale-skill-checksum",
  );
  assert.equal((await routerStore.read(run.routerRunId)).readRevision, 0);
});

test("CLI direct and MCP explicit both return the canonical core result contract", async () => {
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
  assert.equal(cli.schemaVersion, "router-result/1.0");
  assert.equal(mcp.schemaVersion, cli.schemaVersion);
  assert.equal(cli.activation.mode, "direct");
  assert.equal(mcp.activation.mode, "explicit");
  assert.equal(cli.routing.routerAlgorithmVersion, mcp.routing.routerAlgorithmVersion);
});

test("journal recovery completes an interrupted prepared create with preallocated IDs", async () => {
  const root = await temporaryProject("next-react-ts");
  const result = prepared(await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Create a responsive web interface @skillranger",
    activation: { mode: "explicit" },
  }));
  const routerPath = path.join(root, ".skillranger", "runs", "router", `${result.run.routerRunId}.json`);
  const runtimePath = path.join(root, ".skillranger", "runs", `${result.run.runtimeRunId}.json`);
  const routerRun = JSON.parse(await readFile(routerPath, "utf8"));
  const runtimePayload = JSON.parse(await readFile(runtimePath, "utf8"));
  await Promise.all([unlink(routerPath), unlink(runtimePath)]);
  const journal = {
    schemaVersion: "router-journal/1.0",
    operationId: "op_e2e_interrupted",
    routerRunId: result.run.routerRunId,
    runtimeRunId: result.run.runtimeRunId,
    payloadDigest: routerRecordDigest({ routerRun, runtimePayload }),
    intendedTransition: "create-runtime-and-router",
    createdAt: new Date().toISOString(),
    routerRun,
    runtimePayload,
  };
  await writeFile(path.join(root, ".skillranger", "runs", "router", `${result.run.routerRunId}.journal.json`), `${JSON.stringify(journal)}\n`);
  const skillStore = new SkillRunStore(root);
  const runtime: RouterRuntimeStore = {
    async read(runId) { return skillStore.read(runId).catch((error) => error instanceof Error && "code" in error && error.code === "run-not-found" ? undefined : Promise.reject(error)); },
    async create(_runId, value) { await skillStore.create(value as SkillRun); },
  };
  const store = new RouterStore(root, { runtime });
  assert.deepEqual((await store.recover()).recovered, [result.run.routerRunId]);
  assert.equal((await store.read(result.run.routerRunId)).runtime.runId, result.run.runtimeRunId);
  assert.equal((await skillStore.read(result.run.runtimeRunId)).runId, result.run.runtimeRunId);
});

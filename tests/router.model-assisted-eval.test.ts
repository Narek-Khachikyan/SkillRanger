import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { callMcpTool } from "../src/mcp/tools.ts";
import { initializeRouterContext } from "../src/mcp/router-context.ts";
import {
  evaluateModelAssistedRouter,
  loadRoutingProposalBenchmarkFixtures,
  loadRoutingProposalContractFixtures,
} from "../src/evals/router/model-assisted.ts";
import { buildSkillCatalog, inspectSkillCatalog } from "../src/router/catalog.ts";
import { createRouterReader, prepareTask } from "../src/router/prepare.ts";
import { RouterStore } from "../src/router/store.ts";
import type { PrepareTaskResult, ReadRunSkillFileResult } from "../src/router/types.ts";

const structured = <T>(value: { structuredContent?: unknown }) => value.structuredContent as T;

test("the frozen routing-proposal contract corpus covers every accepted boundary", async () => {
  const fixture = await loadRoutingProposalContractFixtures("evals/router/contracts.json");
  assert.deepEqual(
    [...new Set(fixture.cases.map(({ kind }) => kind))].sort(),
    [
      "ambiguity",
      "catalog",
      "hard-veto",
      "item-rejection",
      "precedence",
      "privacy-replay",
      "proposal-absent",
      "proposal-grounding",
      "proposal-ownership",
      "refresh",
      "strict",
    ],
  );
  assert.equal(fixture.schemaVersion, "router-eval-contracts/1.0");
});

test("the model-assisted benchmark is captured-proposal-only and meets its promotion bar", async () => {
  const fixture = await loadRoutingProposalBenchmarkFixtures("evals/router/model-assisted.json");
  assert.equal(fixture.schemaVersion, "router-model-assisted/1.0");
  assert.ok(fixture.cases.some(({ source }) => source === "implicit-intent"));
  assert.ok(fixture.cases.some(({ source }) => source === "hard-paraphrase"));
  assert.ok(fixture.cases.some(({ source }) => source === "russian-paraphrase"));

  const report = await evaluateModelAssistedRouter(process.cwd());
  assert.equal(report.execution, "captured-proposals-only");
  assert.equal(report.promotion.verdict, "promotable");
  assert.equal(report.promotion.blockingReasons.length, 0);
  assert.equal(report.benchmark.metrics.caseFailures, 0);
  assert.ok(report.benchmark.metrics.vocabularyMissRecovery >= 0.8);
  assert.equal(report.benchmark.metrics.forbiddenSelectionRate, 0);
  assert.equal(report.benchmark.metrics.privacyLeakageCount, 0);
  assert.equal(report.benchmark.metrics.hardVetoFailures, 0);
  assert.equal(report.benchmark.metrics.invalidProposalFallbackNotWorse, true);
  assert.equal(report.benchmark.metrics.absentProposalFallbackUnchanged, true);
  assert.equal(report.benchmark.metrics.deterministicReplay, true);
  assert.equal(report.contracts.passed, report.contracts.caseCount);
  assert.equal(report.thresholds.roleAwareFullSetRecall, 0.9);
  assert.equal(report.benchmark.metrics.roleAwareFullSetRecall, 1);
  assert.equal(report.benchmark.metrics.rolePrimaryRecall, 1);
  assert.equal(report.benchmark.metrics.roleCompanionRecall, 1);
  assert.equal(report.benchmark.metrics.roleVerificationRecall, 1);
  assert.ok(report.benchmark.metrics.roleAwareCaseCount >= 3);
  const roleAwareResults = report.benchmark.results.filter(({ recall }) => recall !== undefined);
  assert.ok(roleAwareResults.length >= 3);
  for (const result of roleAwareResults) {
    assert.deepEqual(result.recall?.missedRoles, []);
    assert.equal(result.recall?.fullSet, 1);
    assert.equal(result.assisted.routingMode, "model-assisted");
    assert.equal(result.assisted.warnings.includes("semantic-recall-limited"), false);
    assert.equal(result.fallback.routingMode, "limited-deterministic-fallback");
    assert.equal(result.fallback.warnings.includes("semantic-recall-limited"), true);
  }
  const absent = report.benchmark.results.find(({ proposalMode }) => proposalMode === "absent");
  assert.equal(absent?.assisted.routingMode, "limited-deterministic-fallback");
  assert.equal(absent?.assisted.warnings.includes("semantic-recall-limited"), true);
  const malformed = report.benchmark.results.find(({ proposalMode }) => proposalMode === "malformed");
  assert.equal(malformed?.assisted.routingMode, undefined);
  const stale = report.benchmark.results.find(({ proposalMode }) => proposalMode === "stale");
  assert.equal(stale?.assisted.routingMode, undefined);
});

test("the benchmark fixture declares bilingual role-aware expected selections", async () => {
  const fixture = await loadRoutingProposalBenchmarkFixtures("evals/router/model-assisted.json");
  const motionSet = {
    primary: ["frontend.motion-design"],
    companion: ["frontend.interaction-polish"],
    verification: ["frontend.motion-audit"],
  };
  const direct = fixture.cases.find(({ id }) => id === "direct-english-motion-workflow");
  assert.ok(direct);
  assert.equal(direct.source, "implicit-intent");
  assert.deepEqual(direct.expected.roleAssignments, motionSet);
  assert.equal(direct.expected.primarySkillId, "frontend.motion-design");
  assert.equal(direct.proposal?.nominations.filter(({ role }) => role === "companion").length, 1);
  assert.equal(direct.proposal?.nominations.filter(({ role }) => role === "verification").length, 1);

  const indirect = fixture.cases.find(({ id }) => id === "indirect-russian-motion-workflow");
  assert.ok(indirect);
  assert.equal(indirect.source, "russian-paraphrase");
  assert.deepEqual(indirect.expected.roleAssignments, motionSet);
  assert.equal(indirect.expected.primarySkillId, "frontend.motion-design");
  assert.ok(/[А-Яа-яЁё]/.test(indirect.prompt));
  assert.equal(indirect.proposal?.nominations.length, 3);

  const generic = fixture.cases.find(({ id }) => id === "generic-site-workflow-stays-lean");
  assert.ok(generic);
  assert.deepEqual(generic.expected.roleAssignments, {
    primary: ["frontend.visual-design-polish"],
    companion: [],
    verification: [],
  });
  assert.equal(generic.expected.primarySkillId, "frontend.visual-design-polish");
  assert.deepEqual(generic.expected.forbiddenSkillIds, ["frontend.motion-design", "frontend.interaction-polish"]);
  assert.equal(generic.proposal?.nominations.some(({ skillId }) => skillId.startsWith("frontend.motion")), false);
});

test("role-aware full-set recall cannot be satisfied by a primary-only match", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillranger-role-recall-"));
  try {
    await mkdir(path.join(root, "evals", "router"), { recursive: true });
    await symlink(path.resolve("registry"), path.join(root, "registry"), "dir");
    await symlink(path.resolve("domains"), path.join(root, "domains"), "dir");
    await writeFile(path.join(root, "evals", "router", "contracts.json"), await readFile(path.resolve("evals", "router", "contracts.json")));
    await writeFile(path.join(root, "evals", "router", "model-assisted.json"), JSON.stringify({
      schemaVersion: "router-model-assisted/1.0",
      cases: [{
        id: "primary-only-visual-nomination",
        source: "implicit-intent",
        vocabularyMiss: true,
        prompt: "Update the marketing site content and layout @skillranger",
        strict: false,
        capabilities: ["filesystem", "terminal"],
        proposalMode: "current",
        proposal: {
          schemaVersion: "routing-proposal/1.0",
          catalogDigest: "$catalogDigest",
          catalogReceipt: "$catalogReceipt",
          interpretation: {
            domains: ["frontend"],
            actions: ["modify"],
            artifactTypes: ["page"],
            intentTags: ["visual-design"],
            technologyTags: ["react"],
            qualityGoals: ["visual-quality"],
          },
          nominations: [{
            skillId: "frontend.visual-design-polish",
            role: "primary",
            confidence: 0.88,
            evidenceText: "Update the marketing site content and layout",
          }],
        },
        expected: {
          status: "prepared",
          primarySkillId: "frontend.visual-design-polish",
          fallbackStatus: "no_matching_skills",
          allowedSkillIds: ["frontend.visual-design-polish", "frontend.motion-audit"],
          forbiddenSkillIds: [],
          roleAssignments: {
            primary: ["frontend.visual-design-polish"],
            companion: ["frontend.tailwind-ui-polish"],
            verification: ["frontend.motion-audit"],
          },
        },
      }],
    }));

    const report = await evaluateModelAssistedRouter(root);
    const result = report.benchmark.results[0];
    assert.equal(result.passed, false);
    assert.equal(result.recall?.fullSet, 0.667);
    assert.equal(result.recall?.primary, 1);
    assert.equal(result.recall?.companion, 0);
    assert.equal(result.recall?.verification, 1);
    assert.deepEqual(result.recall?.missedRoles, ["companion"]);
    assert.deepEqual(result.recall?.observed.companion, []);
    assert.deepEqual(result.recall?.expected.companion, ["frontend.tailwind-ui-polish"]);
    assert.equal(result.assisted.primarySkillId, "frontend.visual-design-polish");
    assert.equal(report.promotion.verdict, "blocked");
    assert.ok(report.promotion.blockingReasons.includes("benchmark-case-failed"));
    assert.ok(report.promotion.blockingReasons.includes("role-aware-full-set-recall-below-0.90"));
    assert.equal(report.benchmark.metrics.roleCompanionRecall, 0);
    assert.equal(report.benchmark.metrics.roleAwareFullSetRecall, 0.667);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the benchmark fixture loader rejects malformed role-aware assignments", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillranger-role-fixture-"));
  try {
    const baseCase = {
      id: "malformed-role-assignments",
      source: "implicit-intent",
      vocabularyMiss: true,
      prompt: "Design polished motion for the interface @skillranger",
      strict: false,
      capabilities: ["filesystem"],
      proposalMode: "current",
      proposal: {
        schemaVersion: "routing-proposal/1.0",
        catalogDigest: "$catalogDigest",
        catalogReceipt: "$catalogReceipt",
        interpretation: {
          domains: ["frontend"],
          actions: ["design"],
          artifactTypes: ["animation"],
          intentTags: ["motion-design"],
          technologyTags: ["react"],
          qualityGoals: ["visual-quality"],
        },
        nominations: [{
          skillId: "frontend.motion-design",
          role: "primary",
          confidence: 0.9,
          evidenceText: "Design polished motion for the interface",
        }],
      },
      expected: {
        status: "prepared",
        allowedSkillIds: ["frontend.motion-design"],
        forbiddenSkillIds: [],
      },
    };
    const fixturePath = path.join(root, "model-assisted.json");
    const writeFixture = (expected: Record<string, unknown>) => writeFile(fixturePath, JSON.stringify({
      schemaVersion: "router-model-assisted/1.0",
      cases: [{ ...baseCase, expected: { ...baseCase.expected, ...expected } }],
    }));

    await writeFixture({ roleAssignments: { primary: "frontend.motion-design", companion: [], verification: [] } });
    await assert.rejects(
      () => loadRoutingProposalBenchmarkFixtures(fixturePath),
      /roleAssignments\.primary/,
    );

    await writeFixture({ roleAssignments: { primary: [], companion: [], verification: [], extra: [] } });
    await assert.rejects(
      () => loadRoutingProposalBenchmarkFixtures(fixturePath),
      /roleAssignments\.extra/,
    );

    await writeFixture({ roleAssignments: { primary: [], companion: [] } });
    await assert.rejects(
      () => loadRoutingProposalBenchmarkFixtures(fixturePath),
      /roleAssignments\.verification/,
    );

    await writeFixture({ roleAssignments: { primary: ["frontend.motion-design"], companion: ["Frontend.Motion"], verification: [] } });
    await assert.rejects(
      () => loadRoutingProposalBenchmarkFixtures(fixturePath),
      /roleAssignments\.companion\[0\]/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a captured proposal still follows the mandatory-read ledger", async () => {
  const benchmark = await loadRoutingProposalBenchmarkFixtures("evals/router/model-assisted.json");
  const captured = benchmark.cases.find(({ id }) => id === "implicit-motion-language");
  assert.ok(captured?.proposal);
  const firstPage = await inspectSkillCatalog({ maxItems: 2, maxBytes: 256_000 });
  let page = firstPage;
  while (!page.complete) {
    page = await inspectSkillCatalog({ cursor: page.nextCursor!, expectedCatalogDigest: page.catalogDigest });
  }
  assert.ok(page.catalogReceipt);
  const catalog = await buildSkillCatalog();
  const proposal = structuredClone(captured.proposal);
  proposal.catalogDigest = catalog.digest;
  proposal.catalogReceipt = page.catalogReceipt;
  const root = await mkdtemp(path.join(os.tmpdir(), "skillranger-model-assisted-read-"));
  try {
    const prepared = await prepareTask({
      projectRoot: root,
      registry: { kind: "bundled", root: path.resolve("registry") },
      prompt: captured.prompt,
      activation: { mode: "explicit" },
      targetAgent: "codex",
      capabilities: captured.capabilities.map((id) => ({ id, source: "host-reported" as const })),
      routingDate: "2026-07-19",
      routingProposal: proposal,
    });
    assert.equal(prepared.status, "prepared");
    if (prepared.status !== "prepared") return;
    const store = new RouterStore(root);
    const reader = createRouterReader(root, path.resolve("registry"), store);
    let readRevision = 0;
    let lastRead: Awaited<ReturnType<typeof reader.read>> | undefined;
    for (let attempt = 0; attempt < prepared.requiredReads.length * 4 + 4; attempt += 1) {
      lastRead = await reader.read({
        routerRunId: prepared.run.routerRunId,
        readRequestId: randomUUID(),
        expectedReadRevision: readRevision,
        mode: "mandatory-next",
      });
      readRevision = lastRead.readRevision;
      if (lastRead.readStatus.runMandatoryReadsComplete) break;
    }
    assert.equal(lastRead?.readStatus.runMandatoryReadsComplete, true);
    const persisted = await store.read(prepared.run.routerRunId);
    assert.equal(persisted.state, "ready");
    assert.equal(persisted.readRevision, readRevision);
    assert.ok(persisted.readLedger.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("proposal-backed preparation preserves lifecycle evidence gates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillranger-model-assisted-runtime-"));
  const previousProjectRoot = process.env.SKILLRANGER_PROJECT_ROOT;
  process.env.SKILLRANGER_PROJECT_ROOT = root;
  initializeRouterContext();
  try {
    const pageOptions = { maxItems: 2, maxBytes: 256_000 };
    let page = await inspectSkillCatalog(pageOptions);
    while (!page.complete) page = await inspectSkillCatalog({ ...pageOptions, cursor: page.nextCursor!, expectedCatalogDigest: page.catalogDigest });
    assert.ok(page.catalogReceipt);
    const catalog = await buildSkillCatalog();
    const prompt = "Review and fix accessibility in this web interface, then verify the result. @skillranger";
    const routingProposal = {
      schemaVersion: "routing-proposal/1.0" as const,
      catalogDigest: catalog.digest,
      catalogReceipt: page.catalogReceipt,
      interpretation: {
        domains: ["frontend"],
        actions: ["review"],
        artifactTypes: ["web-interface"],
        intentTags: ["accessibility"],
        technologyTags: ["react"],
        qualityGoals: ["accessibility"],
      },
      nominations: [{
        skillId: "frontend.accessibility-review",
        role: "primary",
        confidence: 0.95,
        evidenceText: "Review and fix accessibility in this web interface, then verify the result",
      }],
    };
    const preparedResponse = await callMcpTool("prepare_task", {
      prompt,
      targetAgent: "codex",
      hostCapabilities: ["browser", "screenshots", "filesystem", "terminal"],
      routingProposal,
    });
    assert.equal(preparedResponse.isError, false);
    const prepared = structured<PrepareTaskResult>(preparedResponse);
    assert.equal(prepared.status, "prepared");
    if (prepared.status !== "prepared") return;

    const unread = await callMcpTool("begin_skill_run_execution", { projectRoot: root, runId: prepared.run.runtimeRunId });
    assert.equal(unread.isError, true);
    let readRevision = 0;
    let readResult: ReadRunSkillFileResult | undefined;
    for (let attempt = 0; attempt < prepared.requiredReads.length * 4 + 4; attempt += 1) {
      readResult = structured<ReadRunSkillFileResult>(await callMcpTool("read_run_skill_file", {
        routerRunId: prepared.run.routerRunId,
        readRequestId: randomUUID(),
        expectedReadRevision: readRevision,
        mode: "mandatory-next",
      }));
      readRevision = readResult.readRevision;
      if (readResult.readStatus.runMandatoryReadsComplete) break;
    }
    assert.equal(readResult?.readStatus.runMandatoryReadsComplete, true);
    const running = structured<{ state: string }>(await callMcpTool("begin_skill_run_execution", { projectRoot: root, runId: prepared.run.runtimeRunId }));
    assert.equal(running.state, "running");
    await mkdir(path.join(root, "artifacts"), { recursive: true });
    await writeFile(path.join(root, "artifacts", "result.json"), "ok\n");
    await callMcpTool("complete_skill_run", {
      projectRoot: root,
      runId: prepared.run.runtimeRunId,
      status: "implemented",
      artifacts: [{ kind: "result", path: "artifacts/result.json", description: "Accessibility fixes" }],
    });
    const verified = structured<{ state: string }>(await callMcpTool("verify_skill_run", {
      projectRoot: root,
      runId: prepared.run.runtimeRunId,
      reportPath: "verification.json",
      report: {
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
      },
    }));
    assert.equal(verified.state, "verified");
  } finally {
    if (previousProjectRoot === undefined) delete process.env.SKILLRANGER_PROJECT_ROOT;
    else process.env.SKILLRANGER_PROJECT_ROOT = previousProjectRoot;
    await rm(root, { recursive: true, force: true });
  }
});

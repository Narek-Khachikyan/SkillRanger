import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findSkill } from "../src/registry/index.ts";
import { getAdapter } from "../src/installers/codex.ts";
import {
  StrictSkillRunStore, beginStrictStep, completeStrictStep,
  readNextStrictChunk, startPreparedStrictSkillRun, type SkillRunV2,
} from "../src/runtime/strict/index.ts";

const install = async (root: string, skillId: string) => {
  const skill = await findSkill(skillId); assert.ok(skill);
  await getAdapter("codex").applyInstall(skill, { projectRoot: root, targetAgent: "codex", scope: "repo", dryRun: false, mode: "copy" });
};
const readAll = async (store: StrictSkillRunStore, run: SkillRunV2) => {
  while (run.state === "reading") {
    const unread = run.skillLedgers.find((ledger) => ledger.readReceipts.length < ledger.contentChunks.length);
    if (!unread) break;
    run = await store.update(run.runId, (current) => readNextStrictChunk(current, unread.skillId).run);
  }
  return run;
};
const step = async (root: string, store: StrictSkillRunStore, run: SkillRunV2, skillId: string, evidence: Array<{ kind: string; value: unknown; sourcePath?: string; validatedAs?: "output" | "critic-report" }> = []) => {
  const ledger = run.skillLedgers.find((entry) => entry.skillId === skillId)!;
  const next = ledger.steps.find(({ status }) => status === "pending")!;
  run = await store.update(run.runId, (current) => beginStrictStep(current, skillId, next.id));
  const activeStep = run.skillLedgers.find((entry) => entry.skillId === skillId)!.steps.find(({ id }) => id === next.id)!;
  const currentAttempt = activeStep.attempts.at(-1)!.attempt;
  for (const [index, item] of evidence.entries()) {
    const source = item.sourcePath
      ? path.join(root, item.sourcePath)
      : path.join(root, "evidence", `${run.revision}-${index}-${item.kind}.json`);
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, typeof item.value === "string" ? item.value : `${JSON.stringify(item.value, null, 2)}\n`);
    run = await store.ingestEvidence(run.runId, {
      sourcePath: source, kind: item.kind, ...(item.validatedAs ? { validatedAs: item.validatedAs } : {}),
      attributions: [{ skillId, stepId: next.id, attempt: currentAttempt, relation: "produced", ruleIds: next.ruleIds }],
    });
  }
  return store.update(run.runId, (current) => completeStrictStep(current, skillId, next.id));
};

const performanceReport = (mode: "risk-review" | "validate-change", measurementsInspected: string[]) => ({
  mode, findings: [{ affectedFlow: "initial load", dimension: "LCP", basis: mode === "risk-review" ? "risk" : "measured", impact: "high", confidence: "medium", behavior: "Hero delivery may delay paint", evidence: mode === "risk-review" ? [] : ["trace.json"], expectedBenefit: "Earlier LCP", tradeoff: "Potential preload bytes" }],
  measurementsInspected, measurementGaps: mode === "risk-review" ? ["Capture before/after LCP traces for the initial load flow"] : [], residualRisks: [],
});

const preparePerformance = async (mode: "risk-review" | "validate-change", measurements: string[]) => {
  const root = await mkdtemp(path.join(os.tmpdir(), `strict-performance-${mode}-`));
  await cp("fixtures/vite-react-ts", root, { recursive: true }); await install(root, "frontend.performance-review");
  let run = await startPreparedStrictSkillRun({ projectRoot: root, registryRoot: path.resolve("registry"), targetAgent: "codex", domain: "frontend", intent: "Review frontend performance", skillInputs: { "frontend.performance-review": { mode, affectedFlows: ["initial load"] } } });
  const store = new StrictSkillRunStore(root); run = await readAll(store, run);
  run = await step(root, store, run, "frontend.performance-review", [{ kind: "affected-flow-inventory", value: "initial load\n" }]);
  run = await step(root, store, run, "frontend.performance-review", [{ kind: "static-performance-review", value: "reviewed\n" }]);
  run = await step(root, store, run, "frontend.performance-review");
  run = await step(root, store, run, "frontend.performance-review", [{ kind: "performance-report", value: performanceReport(mode, measurements), validatedAs: "output" }]);
  run = await step(root, store, run, "frontend.performance-review", [{ kind: "verification-input", value: { measurements } }]);
  return { store, run };
};

test("performance risk-review verifies hypotheses with an exact measurement gap", async () => {
  const { store, run: prepared } = await preparePerformance("risk-review", []);
  const run = await store.verifySkill(prepared.runId, "frontend.performance-review");
  assert.equal(run.skillLedgers[0].outcome, "used");
  assert.equal((await store.finalizeRun(run.runId)).state, "verified");
});

test("performance validate-change enters bounded report repair without before/after evidence", async () => {
  const { store, run: prepared } = await preparePerformance("validate-change", ["after trace"]);
  const run = await store.verifySkill(prepared.runId, "frontend.performance-review");
  assert.equal(run.state, "repair-required");
  assert.equal(run.skillLedgers[0].repairRequests.length, 1);
});

test("Tailwind pilot records critic evidence, repairs a hard gate, rechecks fresh viewports, and verifies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-tailwind-e2e-"));
  await cp("fixtures/next-react-ts", root, { recursive: true }); await install(root, "frontend.tailwind-ui-polish"); await install(root, "frontend.visual-design-polish");
  const skillId = "frontend.tailwind-ui-polish";
  let run = await startPreparedStrictSkillRun({ projectRoot: root, registryRoot: path.resolve("registry"), targetAgent: "codex", domain: "frontend", intent: "Polish existing Tailwind UI", skillInputs: { [skillId]: { brief: {}, existingDirection: { source: "approved" }, capabilityProfile: "standard" } }, hostCapabilities: ["browser", "screenshots"] });
  const store = new StrictSkillRunStore(root); run = await readAll(store, run);
  run = await step(root, store, run, skillId, [{ kind: "project-archetype", value: "tailwind\n" }]);
  run = await step(root, store, run, skillId, [{ kind: "browser-screenshot-before", value: "before\n" }]);
  run = await step(root, store, run, skillId, [
    { kind: "implementation-diff", value: '+ <div className={`p-4 bg-${color}-600`}>Save</div>\n' },
    { kind: "implementation-diff", value: { checks: { "no-dynamic-tailwind-classes": true }, diff: '+ <div className="bg-brand-600">Save</div>' } },
  ]);
  run = await step(root, store, run, skillId, [{ kind: "browser-screenshot-initial", value: "initial\n" }]);
  const screenshotArtifactId = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-initial")!.artifactId;
  run = await step(root, store, run, skillId, [{
    kind: "critic-report",
    validatedAs: "critic-report",
    value: {
      schemaVersion: "2.0",
      skillId,
      criticInvocationId: "critic-2",
      executorInvocationId: "executor-1",
      outcome: "findings",
      evidenceArtifactIds: [screenshotArtifactId],
      findings: [{
        id: "critical-1",
        ruleId: run.skillLedgers[0].contract.rules[0].id,
        severity: "critical",
        message: "The verified surface is still broken.",
        evidenceArtifactIds: [screenshotArtifactId],
        remediation: "Repair and recapture the surface.",
      }],
    },
  }]);
  const initialWidths = [390, 768, 1440];
  run = await step(root, store, run, skillId, initialWidths.map((width) => ({
    kind: `browser-screenshot-${width}`,
    value: `browser-screenshot-${width}\n`,
    sourcePath: `evidence/initial-${width}.png`,
  })));

  const initialObservations = initialWidths.map((width, index) => ({
    viewport: { width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 },
    state: "default",
    screenshotPath: `evidence/initial-${width}.png`,
    horizontalOverflow: false,
    clippedControls: [],
    unreachableActions: [],
    stickyOverlaps: [],
    consoleErrors: [],
    keyboardTraps: [],
    invisibleFocus: [],
    criticalAxeViolations: index === 0 ? ["button-name"] : [],
    reducedMotionVerified: true,
  }));
  run = await step(root, store, run, skillId, [{ kind: "verification-input", value: { observations: initialObservations } }]);
  run = await step(root, store, run, skillId, [{ kind: "skill-output", validatedAs: "output", value: { outcome: "verified", classification: "hierarchy", changes: ["polished"], verification: {}, residualRisks: [] } }]);
  run = await store.verifySkill(run.runId, skillId);
  assert.equal(run.state, "repair-required");
  await assert.rejects(store.finalizeRun(run.runId), (error: unknown) => error instanceof Error && "code" in error && error.code === "run-not-finalizable");
  const firstReport = run.skillLedgers[0].verificationReports.at(-1)!;
  assert.deepEqual(firstReport.gateResults.find(({ gateId }) => gateId === "core/gate/critic-findings"), {
    gateId: "core/gate/critic-findings",
    passed: false,
    level: "hard",
    message: "Critic reported 1 unresolved finding(s).",
  });
  assert.ok(run.skillLedgers[0].repairRequests[0].gateIds.includes("core/gate/critic-findings"));
  const browserGateIds = new Set(run.skillLedgers[0].contract.gates
    .filter(({ evaluator }) => evaluator.type === "validator" && evaluator.validatorId === "frontend/browser-hard-gates")
    .map(({ id }) => id));
  const browserResults = firstReport.gateResults.filter(({ gateId }) => browserGateIds.has(gateId));
  assert.equal(browserResults.length, 7);
  assert.equal(browserResults.find(({ gateId }) => gateId.endsWith("/focus-visible"))?.passed, false);
  assert.ok(browserResults
    .filter(({ gateId }) => !gateId.endsWith("/focus-visible"))
    .every(({ passed }) => passed));
  assert.equal(firstReport.gateResults.find(({ gateId }) => gateId.endsWith("/no-dynamic-tailwind-classes"))?.passed, false);
  run = await step(root, store, run, skillId, [{ kind: "implementation-diff", value: '+ <div className="bg-brand-600 text-on-brand">Save</div>\n' }]);
  const repairKinds = ["browser-screenshot-390", "browser-screenshot-768", "browser-screenshot-1440"];
  run = await step(root, store, run, skillId, repairKinds.map((kind, index) => ({ kind, value: `${kind}-fresh\n`, sourcePath: `evidence/${[390, 768, 1440][index]}.png` })));
  const freshTw390Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-390")!.artifactId;
  const freshTw768Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-768")!.artifactId;
  const freshTw1440Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-1440")!.artifactId;
  const observations = [390, 768, 1440].map((width) => ({
    viewport: { width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 },
    state: "default",
    screenshotPath: `evidence/${width}.png`,
    horizontalOverflow: false,
    clippedControls: [],
    unreachableActions: [],
    stickyOverlaps: [],
    consoleErrors: [],
    keyboardTraps: [],
    invisibleFocus: [],
    criticalAxeViolations: [],
    reducedMotionVerified: true,
  }));
  run = await step(root, store, run, skillId, [
    { kind: "verification-input", value: { observations } },
    {
      kind: "critic-report",
      validatedAs: "critic-report",
      value: {
        schemaVersion: "2.0",
        skillId,
        criticInvocationId: "critic-3",
        executorInvocationId: "executor-1",
        outcome: "clean",
        evidenceArtifactIds: [freshTw390Id, freshTw768Id, freshTw1440Id],
        findings: [],
      },
    },
  ]);
  run = await step(root, store, run, skillId, [{ kind: "skill-output", validatedAs: "output", value: { outcome: "verified", classification: "hierarchy", changes: ["repaired"], verification: {}, residualRisks: [] } }]);
  run = await store.verifySkill(run.runId, skillId);
  assert.equal(run.skillLedgers[0].outcome, "used");
  assert.deepEqual(run.skillLedgers[0].verificationReports.at(-1)!.gateResults.find(({ gateId }) => gateId === "core/gate/critic-findings"), {
    gateId: "core/gate/critic-findings",
    passed: true,
    level: "hard",
  });
  assert.equal((await store.finalizeRun(run.runId)).state, "verified");
});

test("Visual design strict run blocks unresolved AI-slop findings, requires bounded repair and fresh screenshots, then verifies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-visual-e2e-"));
  await cp("fixtures/next-react-ts", root, { recursive: true });
  await install(root, "frontend.visual-design-polish");
  await install(root, "frontend.tailwind-ui-polish");
  const skillId = "frontend.visual-design-polish";

  let run = await startPreparedStrictSkillRun({
    projectRoot: root,
    registryRoot: path.resolve("registry"),
    targetAgent: "codex",
    domain: "frontend",
    intent: "visual direction redesign hierarchy generic",
    skillInputs: {
      [skillId]: {
        brief: { title: "Aquaculture Hero" },
        capabilityProfile: "standard",
        changeClass: "material",
      },
      "frontend.tailwind-ui-polish": {
        brief: {},
        capabilityProfile: "standard",
        existingDirection: { source: "approved" },
      },
    },
    hostCapabilities: ["browser", "screenshots"],
  });

  const store = new StrictSkillRunStore(root);
  run = await readAll(store, run);

  // Step 1: collect product evidence
  run = await step(root, store, run, skillId, [{ kind: "product-evidence-ledger", value: "evidence\n" }]);

  // Step 2: define structured direction
  run = await step(root, store, run, skillId, [{ kind: "design-direction", value: "direction\n" }]);

  // Step 3: implement direction
  run = await step(root, store, run, skillId, [{ kind: "implementation-diff", value: "+ <div>Hero</div>\n" }]);

  // Step 4: capture initial evidence (390, 768, 1440)
  run = await step(root, store, run, skillId, [
    { kind: "browser-screenshot-initial-390", value: "initial-390\n", sourcePath: "evidence/initial-390.png" },
    { kind: "browser-screenshot-initial-768", value: "initial-768\n", sourcePath: "evidence/initial-768.png" },
    { kind: "browser-screenshot-initial-1440", value: "initial-1440\n", sourcePath: "evidence/initial-1440.png" },
  ]);

  const initial390Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-initial-390")!.artifactId;
  const initial768Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-initial-768")!.artifactId;
  const initial1440Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-initial-1440")!.artifactId;
  const initialArtifactIds = [initial390Id, initial768Id, initial1440Id];

  run = await step(root, store, run, skillId, [{
    kind: "critic-report",
    validatedAs: "critic-report",
    value: {
      schemaVersion: "2.0",
      skillId,
      criticInvocationId: "critic-99",
      executorInvocationId: "executor-1",
      outcome: "findings",
      evidenceArtifactIds: initialArtifactIds,
      findings: [{
        id: "finding-1",
        ruleId: `${skillId}/rule/no-unresolved-ai-slop`,
        severity: "high",
        message: "Hero looks like generic SaaS landing.",
        evidenceArtifactIds: [initial390Id],
        remediation: "Replace generic cards with aquaculture domain layout.",
      }],
    },
  }]);

  run = await step(root, store, run, skillId, [
    { kind: "browser-screenshot-390", value: "recheck-390\n", sourcePath: "evidence/recheck-390.png" },
    { kind: "browser-screenshot-768", value: "recheck-768\n", sourcePath: "evidence/recheck-768.png" },
    { kind: "browser-screenshot-1440", value: "recheck-1440\n", sourcePath: "evidence/recheck-1440.png" },
  ]);

  const recheck390Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-390")!.artifactId;
  const recheck768Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-768")!.artifactId;
  const recheck1440Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-1440")!.artifactId;
  const recheckArtifactIds = [recheck390Id, recheck768Id, recheck1440Id];

  run = await step(root, store, run, skillId, [{
    kind: "critic-report",
    validatedAs: "critic-report",
    value: {
      schemaVersion: "2.0",
      skillId,
      criticInvocationId: "critic-99b",
      executorInvocationId: "executor-1",
      outcome: "findings",
      evidenceArtifactIds: recheckArtifactIds,
      findings: [{
        id: "finding-1",
        ruleId: `${skillId}/rule/no-unresolved-ai-slop`,
        severity: "high",
        message: "Hero looks like generic SaaS landing.",
        evidenceArtifactIds: [recheck390Id],
        remediation: "Replace generic cards with aquaculture domain layout.",
      }],
    },
  }]);

  const initialObservations = [390, 768, 1440].map((width) => ({
    viewport: { width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 },
    state: "default",
    screenshotPath: `evidence/recheck-${width}.png`,
    horizontalOverflow: false,
    clippedControls: [],
    unreachableActions: [],
    stickyOverlaps: [],
    consoleErrors: [],
    keyboardTraps: [],
    invisibleFocus: [],
    criticalAxeViolations: [],
    reducedMotionVerified: true,
  }));

  run = await step(root, store, run, skillId, [{ kind: "verification-input", value: { observations: initialObservations } }]);

  run = await step(root, store, run, skillId, [{
    kind: "skill-output",
    validatedAs: "output",
    value: {
      implementationOutcome: "implemented",
      verificationState: "pending-runtime-verification",
      artifacts: { brief: "b", recipe: "r", direction: "d", verification: "v" },
      changes: ["changed hero"],
      residualRisks: [],
    },
  }]);

  run = await store.verifySkill(run.runId, skillId);
  assert.equal(run.state, "repair-required");
  assert.equal(run.skillLedgers[0].repairRequests.length, 1);
  assert.ok(run.skillLedgers[0].repairRequests[0].gateIds.includes("core/gate/critic-findings"));
  await assert.rejects(store.finalizeRun(run.runId), (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "run-not-finalizable");

  run = await step(root, store, run, skillId, [{ kind: "implementation-diff", value: '+ <div className="domain-aquaculture">Fresh Hero</div>\n' }]);

  const freshWidths = [390, 768, 1440];
  run = await step(root, store, run, skillId, freshWidths.map((width) => ({
    kind: width === 390 ? "browser-screenshot-390" : width === 768 ? "browser-screenshot-768" : "browser-screenshot-1440",
    value: `fresh-screenshot-${width}\n`,
    sourcePath: `evidence/fresh-${width}.png`,
  })));

  const fresh390Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-390")!.artifactId;
  const fresh768Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-768")!.artifactId;
  const fresh1440Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-1440")!.artifactId;
  const freshArtifactIds = [fresh390Id, fresh768Id, fresh1440Id];

  run = await step(root, store, run, skillId, [{
    kind: "critic-report",
    validatedAs: "critic-report",
    value: {
      schemaVersion: "2.0",
      skillId,
      criticInvocationId: "critic-fresh-1",
      executorInvocationId: "executor-1",
      outcome: "clean",
      evidenceArtifactIds: freshArtifactIds,
      findings: [],
    },
  }]);

  const freshObservations = freshWidths.map((width) => ({
    viewport: { width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 },
    state: "default",
    screenshotPath: `evidence/fresh-${width}.png`,
    horizontalOverflow: false,
    clippedControls: [],
    unreachableActions: [],
    stickyOverlaps: [],
    consoleErrors: [],
    keyboardTraps: [],
    invisibleFocus: [],
    criticalAxeViolations: [],
    reducedMotionVerified: true,
  }));
  run = await step(root, store, run, skillId, [{ kind: "verification-input", value: { observations: freshObservations } }]);

  run = await step(root, store, run, skillId, [{
    kind: "skill-output",
    validatedAs: "output",
    value: {
      implementationOutcome: "implemented",
      verificationState: "pending-runtime-verification",
      artifacts: { brief: "b", recipe: "r", direction: "d", verification: "v" },
      changes: ["repaired hero"],
      residualRisks: [],
    },
  }]);

  run = await store.verifySkill(run.runId, skillId);
  assert.equal(run.skillLedgers[0].outcome, "used");

  const twId = "frontend.tailwind-ui-polish";
  run = await step(root, store, run, twId, [{ kind: "project-archetype", value: "tailwind\n" }]);
  run = await step(root, store, run, twId, [{ kind: "browser-screenshot-before", value: "before\n" }]);
  run = await step(root, store, run, twId, [
    { kind: "implementation-diff", value: { checks: { "no-dynamic-tailwind-classes": true }, diff: '+ <div className="bg-brand-600">Save</div>' } },
  ]);
  run = await step(root, store, run, twId, [{ kind: "browser-screenshot-initial", value: "initial\n" }]);
  const tw390InitialId = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-initial")!.artifactId;

  run = await step(root, store, run, twId, [{
    kind: "critic-report",
    validatedAs: "critic-report",
    value: {
      schemaVersion: "2.0",
      skillId: twId,
      criticInvocationId: "critic-tw",
      executorInvocationId: "executor-tw",
      outcome: "clean",
      evidenceArtifactIds: [tw390InitialId],
      findings: [],
    },
  }]);
  const twWidths = [390, 768, 1440];
  run = await step(root, store, run, twId, twWidths.map((width) => ({
    kind: `browser-screenshot-${width}`,
    value: `browser-screenshot-${width}\n`,
    sourcePath: `evidence/tw-initial-${width}.png`,
  })));
  const twObservations = twWidths.map((width) => ({
    viewport: { width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 },
    state: "default",
    screenshotPath: `evidence/tw-initial-${width}.png`,
    horizontalOverflow: false, clippedControls: [], unreachableActions: [], stickyOverlaps: [], consoleErrors: [], keyboardTraps: [], invisibleFocus: [], criticalAxeViolations: [], reducedMotionVerified: true,
  }));
  run = await step(root, store, run, twId, [{ kind: "verification-input", value: { observations: twObservations } }]);
  run = await step(root, store, run, twId, [{ kind: "skill-output", validatedAs: "output", value: { outcome: "verified", classification: "hierarchy", changes: ["polished"], verification: {}, residualRisks: [] } }]);
  run = await store.verifySkill(run.runId, twId);
  assert.equal(run.skillLedgers[1].outcome, "used");

  assert.equal((await store.finalizeRun(run.runId)).state, "verified");
});

test("Visual design strict run rejects same-actor critic report", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-visual-same-actor-"));
  await cp("fixtures/next-react-ts", root, { recursive: true });
  await install(root, "frontend.visual-design-polish");
  await install(root, "frontend.tailwind-ui-polish");
  const skillId = "frontend.visual-design-polish";

  let run = await startPreparedStrictSkillRun({
    projectRoot: root,
    registryRoot: path.resolve("registry"),
    targetAgent: "codex",
    domain: "frontend",
    intent: "visual direction redesign hierarchy generic",
    skillInputs: {
      [skillId]: { brief: {}, capabilityProfile: "standard", changeClass: "material" },
      "frontend.tailwind-ui-polish": { brief: {}, capabilityProfile: "standard", existingDirection: { source: "approved" } },
    },
    hostCapabilities: ["browser", "screenshots"],
  });

  const store = new StrictSkillRunStore(root);
  run = await readAll(store, run);
  run = await step(root, store, run, skillId, [{ kind: "product-evidence-ledger", value: "evidence\n" }]);
  run = await step(root, store, run, skillId, [{ kind: "design-direction", value: "direction\n" }]);
  run = await step(root, store, run, skillId, [{ kind: "implementation-diff", value: "+ <div>Hero</div>\n" }]);
  run = await step(root, store, run, skillId, [
    { kind: "browser-screenshot-initial-390", value: "initial-390\n" },
    { kind: "browser-screenshot-initial-768", value: "initial-768\n" },
    { kind: "browser-screenshot-initial-1440", value: "initial-1440\n" },
  ]);

  const initial390Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-initial-390")!.artifactId;

  await assert.rejects(
    step(root, store, run, skillId, [{
      kind: "critic-report",
      validatedAs: "critic-report",
      value: {
        schemaVersion: "2.0",
        skillId,
        criticInvocationId: "same-actor-1",
        executorInvocationId: "same-actor-1",
        outcome: "clean",
        evidenceArtifactIds: [initial390Id],
        findings: [],
      },
    }]),
    (error: unknown) => error instanceof Error && error.message.includes("Critic invocation must be independent"),
  );
});

test("Visual design strict run rejects clean critic report missing screenshot evidence artifact IDs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-visual-no-evidence-ids-"));
  await cp("fixtures/next-react-ts", root, { recursive: true });
  await install(root, "frontend.visual-design-polish");
  await install(root, "frontend.tailwind-ui-polish");
  const skillId = "frontend.visual-design-polish";

  let run = await startPreparedStrictSkillRun({
    projectRoot: root,
    registryRoot: path.resolve("registry"),
    targetAgent: "codex",
    domain: "frontend",
    intent: "visual direction redesign hierarchy generic",
    skillInputs: {
      [skillId]: { brief: {}, capabilityProfile: "standard", changeClass: "material" },
      "frontend.tailwind-ui-polish": { brief: {}, capabilityProfile: "standard", existingDirection: { source: "approved" } },
    },
    hostCapabilities: ["browser", "screenshots"],
  });

  const store = new StrictSkillRunStore(root);
  run = await readAll(store, run);

  run = await step(root, store, run, skillId, [{ kind: "product-evidence-ledger", value: "e\n" }]);
  run = await step(root, store, run, skillId, [{ kind: "design-direction", value: "d\n" }]);
  run = await step(root, store, run, skillId, [{ kind: "implementation-diff", value: "+ <div>Hero</div>\n" }]);
  run = await step(root, store, run, skillId, [
    { kind: "browser-screenshot-initial-390", value: "i390\n" },
    { kind: "browser-screenshot-initial-768", value: "i768\n" },
    { kind: "browser-screenshot-initial-1440", value: "i1440\n" },
  ]);

  // Reject report with empty or missing evidenceArtifactIds
  await assert.rejects(
    step(root, store, run, skillId, [{
      kind: "critic-report",
      validatedAs: "critic-report",
      value: {
        schemaVersion: "2.0",
        skillId,
        criticInvocationId: "critic-200",
        executorInvocationId: "executor-1",
        outcome: "clean",
        evidenceArtifactIds: [],
        findings: [],
      },
    }]),
    (error: unknown) => error instanceof Error && error.message.includes("evidenceArtifactIds must be a non-empty array"),
  );
});

test("Visual design strict run blocks verification if fresh screenshots are not re-critiqued with clean report after repair", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-visual-no-recritic-"));
  await cp("fixtures/next-react-ts", root, { recursive: true });
  await install(root, "frontend.visual-design-polish");
  await install(root, "frontend.tailwind-ui-polish");
  const skillId = "frontend.visual-design-polish";

  let run = await startPreparedStrictSkillRun({
    projectRoot: root,
    registryRoot: path.resolve("registry"),
    targetAgent: "codex",
    domain: "frontend",
    intent: "visual direction redesign hierarchy generic",
    skillInputs: {
      [skillId]: { brief: {}, capabilityProfile: "standard", changeClass: "material" },
      "frontend.tailwind-ui-polish": { brief: {}, capabilityProfile: "standard", existingDirection: { source: "approved" } },
    },
    hostCapabilities: ["browser", "screenshots"],
  });

  const store = new StrictSkillRunStore(root);
  run = await readAll(store, run);

  run = await step(root, store, run, skillId, [{ kind: "product-evidence-ledger", value: "e\n" }]);
  run = await step(root, store, run, skillId, [{ kind: "design-direction", value: "d\n" }]);
  run = await step(root, store, run, skillId, [{ kind: "implementation-diff", value: "+ <div>Hero</div>\n" }]);
  run = await step(root, store, run, skillId, [
    { kind: "browser-screenshot-initial-390", value: "i390\n" },
    { kind: "browser-screenshot-initial-768", value: "i768\n" },
    { kind: "browser-screenshot-initial-1440", value: "i1440\n" },
  ]);

  const initial390Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-initial-390")!.artifactId;
  const initial768Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-initial-768")!.artifactId;
  const initial1440Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-initial-1440")!.artifactId;

  run = await step(root, store, run, skillId, [{
    kind: "critic-report",
    validatedAs: "critic-report",
    value: {
      schemaVersion: "2.0",
      skillId,
      criticInvocationId: "critic-1",
      executorInvocationId: "executor-1",
      outcome: "findings",
      evidenceArtifactIds: [initial390Id, initial768Id, initial1440Id],
      findings: [{
        id: "f-1",
        ruleId: `${skillId}/rule/no-unresolved-ai-slop`,
        severity: "high",
        message: "AI slop detected.",
        evidenceArtifactIds: [initial390Id],
        remediation: "Fix layout.",
      }],
    },
  }]);

  run = await step(root, store, run, skillId, [
    { kind: "browser-screenshot-390", value: "r390\n" },
    { kind: "browser-screenshot-768", value: "r768\n" },
    { kind: "browser-screenshot-1440", value: "r1440\n" },
  ]);
  const r390Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-390")!.artifactId;
  const r768Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-768")!.artifactId;
  const r1440Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-1440")!.artifactId;

  run = await step(root, store, run, skillId, [{
    kind: "critic-report",
    validatedAs: "critic-report",
    value: {
      schemaVersion: "2.0",
      skillId,
      criticInvocationId: "critic-1b",
      executorInvocationId: "executor-1",
      outcome: "findings",
      evidenceArtifactIds: [r390Id, r768Id, r1440Id],
      findings: [{
        id: "f-1",
        ruleId: `${skillId}/rule/no-unresolved-ai-slop`,
        severity: "high",
        message: "AI slop detected.",
        evidenceArtifactIds: [r390Id],
        remediation: "Fix layout.",
      }],
    },
  }]);

  run = await step(root, store, run, skillId, [{ kind: "verification-input", value: { observations: [] } }]);
  run = await step(root, store, run, skillId, [{
    kind: "skill-output",
    validatedAs: "output",
    value: {
      implementationOutcome: "implemented",
      verificationState: "pending-runtime-verification",
      artifacts: { brief: "b", recipe: "r", direction: "d", verification: "v" },
      changes: ["changed hero"],
      residualRisks: [],
    },
  }]);

  run = await store.verifySkill(run.runId, skillId);
  assert.equal(run.state, "repair-required");

  // Perform repair but submit another report with findings instead of clean
  run = await step(root, store, run, skillId, [{ kind: "implementation-diff", value: "+ <div>Fix</div>\n" }]);
  run = await step(root, store, run, skillId, [
    { kind: "browser-screenshot-390", value: "fresh390\n" },
    { kind: "browser-screenshot-768", value: "fresh768\n" },
    { kind: "browser-screenshot-1440", value: "fresh1440\n" },
  ]);
  const fresh390Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-390")!.artifactId;
  const fresh768Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-768")!.artifactId;
  const fresh1440Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-1440")!.artifactId;

  // Submit critic report STILL reporting findings after repair
  run = await step(root, store, run, skillId, [{
    kind: "critic-report",
    validatedAs: "critic-report",
    value: {
      schemaVersion: "2.0",
      skillId,
      criticInvocationId: "critic-2",
      executorInvocationId: "executor-1",
      outcome: "findings",
      evidenceArtifactIds: [fresh390Id, fresh768Id, fresh1440Id],
      findings: [{
        id: "f-2",
        ruleId: `${skillId}/rule/no-unresolved-ai-slop`,
        severity: "high",
        message: "AI slop still present after repair.",
        evidenceArtifactIds: [fresh390Id],
        remediation: "Redesign hero.",
      }],
    },
  }]);
  run = await step(root, store, run, skillId, [{ kind: "verification-input", value: { observations: [] } }]);
  run = await step(root, store, run, skillId, [{
    kind: "skill-output",
    validatedAs: "output",
    value: {
      implementationOutcome: "implemented",
      verificationState: "pending-runtime-verification",
      artifacts: { brief: "b", recipe: "r", direction: "d", verification: "v" },
      changes: ["attempted repair"],
      residualRisks: [],
    },
  }]);

  run = await store.verifySkill(run.runId, skillId);
  assert.equal(run.state, "repair-required");
  assert.notEqual(run.skillLedgers[0].outcome, "used");
});

test("Visual design strict run rejects finding with empty evidenceArtifactIds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-visual-empty-finding-evidence-"));
  await cp("fixtures/next-react-ts", root, { recursive: true });
  await install(root, "frontend.visual-design-polish");
  await install(root, "frontend.tailwind-ui-polish");
  const skillId = "frontend.visual-design-polish";

  let run = await startPreparedStrictSkillRun({
    projectRoot: root,
    registryRoot: path.resolve("registry"),
    targetAgent: "codex",
    domain: "frontend",
    intent: "visual direction redesign hierarchy generic",
    skillInputs: {
      [skillId]: { brief: {}, capabilityProfile: "standard", changeClass: "material" },
      "frontend.tailwind-ui-polish": { brief: {}, capabilityProfile: "standard", existingDirection: { source: "approved" } },
    },
    hostCapabilities: ["browser", "screenshots"],
  });

  const store = new StrictSkillRunStore(root);
  run = await readAll(store, run);

  run = await step(root, store, run, skillId, [{ kind: "product-evidence-ledger", value: "e\n" }]);
  run = await step(root, store, run, skillId, [{ kind: "design-direction", value: "d\n" }]);
  run = await step(root, store, run, skillId, [{ kind: "implementation-diff", value: "+ <div>Hero</div>\n" }]);
  run = await step(root, store, run, skillId, [
    { kind: "browser-screenshot-initial-390", value: "i390\n" },
    { kind: "browser-screenshot-initial-768", value: "i768\n" },
    { kind: "browser-screenshot-initial-1440", value: "i1440\n" },
  ]);

  const initial390Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-initial-390")!.artifactId;
  const initial768Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-initial-768")!.artifactId;
  const initial1440Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-initial-1440")!.artifactId;

  await assert.rejects(
    step(root, store, run, skillId, [{
      kind: "critic-report",
      validatedAs: "critic-report",
      value: {
        schemaVersion: "2.0",
        skillId,
        criticInvocationId: "critic-empty-finding-evidence",
        executorInvocationId: "executor-1",
        outcome: "findings",
        evidenceArtifactIds: [initial390Id, initial768Id, initial1440Id],
        findings: [{
          id: "f-1",
          ruleId: `${skillId}/rule/no-unresolved-ai-slop`,
          severity: "high",
          message: "Empty finding evidence.",
          evidenceArtifactIds: [],
          remediation: "Add evidence.",
        }],
      },
    }]),
    (error: unknown) => error instanceof Error && error.message.includes("Critic finding 0 is invalid"),
  );
});

test("Visual design strict run rejects finding referencing non-screenshot evidence artifact", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-visual-non-screenshot-finding-"));
  await cp("fixtures/next-react-ts", root, { recursive: true });
  await install(root, "frontend.visual-design-polish");
  await install(root, "frontend.tailwind-ui-polish");
  const skillId = "frontend.visual-design-polish";

  let run = await startPreparedStrictSkillRun({
    projectRoot: root,
    registryRoot: path.resolve("registry"),
    targetAgent: "codex",
    domain: "frontend",
    intent: "visual direction redesign hierarchy generic",
    skillInputs: {
      [skillId]: { brief: {}, capabilityProfile: "standard", changeClass: "material" },
      "frontend.tailwind-ui-polish": { brief: {}, capabilityProfile: "standard", existingDirection: { source: "approved" } },
    },
    hostCapabilities: ["browser", "screenshots"],
  });

  const store = new StrictSkillRunStore(root);
  run = await readAll(store, run);

  run = await step(root, store, run, skillId, [{ kind: "product-evidence-ledger", value: "non-screenshot evidence\n" }]);
  const nonScreenshotId = run.artifacts.findLast(({ kind }) => kind === "product-evidence-ledger")!.artifactId;

  run = await step(root, store, run, skillId, [{ kind: "design-direction", value: "d\n" }]);
  run = await step(root, store, run, skillId, [{ kind: "implementation-diff", value: "+ <div>Hero</div>\n" }]);
  run = await step(root, store, run, skillId, [
    { kind: "browser-screenshot-initial-390", value: "i390\n" },
    { kind: "browser-screenshot-initial-768", value: "i768\n" },
    { kind: "browser-screenshot-initial-1440", value: "i1440\n" },
  ]);

  const initial390Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-initial-390")!.artifactId;
  const initial768Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-initial-768")!.artifactId;
  const initial1440Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-initial-1440")!.artifactId;

  // Submit critic report where finding references nonScreenshotId instead of a required screenshot artifact
  run = await step(root, store, run, skillId, [{
    kind: "critic-report",
    validatedAs: "critic-report",
    value: {
      schemaVersion: "2.0",
      skillId,
      criticInvocationId: "critic-non-screenshot-finding",
      executorInvocationId: "executor-1",
      outcome: "findings",
      evidenceArtifactIds: [initial390Id, initial768Id, initial1440Id, nonScreenshotId],
      findings: [{
        id: "f-1",
        ruleId: `${skillId}/rule/no-unresolved-ai-slop`,
        severity: "high",
        message: "Finding references ledger instead of screenshot.",
        evidenceArtifactIds: [nonScreenshotId],
        remediation: "Reference screenshot.",
      }],
    },
  }]);

  run = await step(root, store, run, skillId, [
    { kind: "browser-screenshot-390", value: "r390\n" },
    { kind: "browser-screenshot-768", value: "r768\n" },
    { kind: "browser-screenshot-1440", value: "r1440\n" },
  ]);
  const r390Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-390")!.artifactId;
  const r768Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-768")!.artifactId;
  const r1440Id = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-1440")!.artifactId;

  run = await step(root, store, run, skillId, [{
    kind: "critic-report",
    validatedAs: "critic-report",
    value: {
      schemaVersion: "2.0",
      skillId,
      criticInvocationId: "critic-r1",
      executorInvocationId: "executor-1",
      outcome: "clean",
      evidenceArtifactIds: [r390Id, r768Id, r1440Id],
      findings: [],
    },
  }]);

  run = await step(root, store, run, skillId, [{ kind: "verification-input", value: { observations: [] } }]);
  run = await step(root, store, run, skillId, [{
    kind: "skill-output",
    validatedAs: "output",
    value: {
      implementationOutcome: "implemented",
      verificationState: "pending-runtime-verification",
      artifacts: { brief: "b", recipe: "r", direction: "d", verification: "v" },
      changes: ["changed hero"],
      residualRisks: [],
    },
  }]);

  run = await store.verifySkill(run.runId, skillId);
  assert.equal(run.state, "repair-required");
  const failedGate = run.skillLedgers[0].verificationReports[0].gateResults.find(({ gateId }) => gateId === "core/gate/critic-findings");
  assert.ok(failedGate?.message?.includes("does not reference a required screenshot artifact"));
});

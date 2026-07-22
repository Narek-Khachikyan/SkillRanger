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
  run = await step(root, store, run, skillId, [{ kind: "verification-input", value: { observations } }]);
  run = await step(root, store, run, skillId, [{ kind: "skill-output", validatedAs: "output", value: { outcome: "verified", classification: "hierarchy", changes: ["repaired"], verification: {}, residualRisks: [] } }]);
  run = await store.verifySkill(run.runId, skillId);
  assert.equal(run.skillLedgers[0].outcome, "used", JSON.stringify(run.skillLedgers[0].verificationReports.at(-1)));
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

  const initialScreenshotArtifactId = run.artifacts.findLast(({ kind }) => kind === "browser-screenshot-initial-390")!.artifactId;

  // Step 5: independent critic report with high finding
  run = await step(root, store, run, skillId, [{
    kind: "critic-report",
    validatedAs: "critic-report",
    value: {
      schemaVersion: "2.0",
      skillId,
      criticInvocationId: "critic-99",
      executorInvocationId: "executor-1",
      outcome: "findings",
      findings: [{
        id: "finding-1",
        ruleId: `${skillId}/rule/no-unresolved-ai-slop`,
        severity: "high",
        message: "Hero looks like generic SaaS landing.",
        evidenceArtifactIds: [initialScreenshotArtifactId],
        remediation: "Replace generic cards with aquaculture domain layout.",
      }],
    },
  }]);

  // Step 6: capture recheck evidence
  run = await step(root, store, run, skillId, [
    { kind: "browser-screenshot-390", value: "recheck-390\n", sourcePath: "evidence/recheck-390.png" },
    { kind: "browser-screenshot-768", value: "recheck-768\n", sourcePath: "evidence/recheck-768.png" },
    { kind: "browser-screenshot-1440", value: "recheck-1440\n", sourcePath: "evidence/recheck-1440.png" },
  ]);

  // Step 8: final verify input
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

  // Step 9: final report (output)
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

  // Execute verifySkill -> should fail with repair-required due to unresolved critic finding
  run = await store.verifySkill(run.runId, skillId);
  assert.equal(run.state, "repair-required");
  assert.equal(run.skillLedgers[0].repairRequests.length, 1);
  assert.ok(run.skillLedgers[0].repairRequests[0].gateIds.includes("core/gate/critic-findings"));
  await assert.rejects(store.finalizeRun(run.runId), (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "run-not-finalizable");

  // Perform repair iteration:
  run = await step(root, store, run, skillId, [{ kind: "implementation-diff", value: '+ <div className="domain-aquaculture">Fresh Hero</div>\n' }]);

  const freshWidths = [390, 768, 1440];
  run = await step(root, store, run, skillId, freshWidths.map((width) => ({
    kind: width === 390 ? "browser-screenshot-390" : width === 768 ? "browser-screenshot-768" : "browser-screenshot-1440",
    value: `fresh-screenshot-${width}\n`,
    sourcePath: `evidence/fresh-${width}.png`,
  })));

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
  run = await step(root, store, run, twId, [{
    kind: "critic-report",
    validatedAs: "critic-report",
    value: {
      schemaVersion: "2.0",
      skillId: twId,
      criticInvocationId: "critic-tw",
      executorInvocationId: "executor-tw",
      outcome: "clean",
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
    { kind: "browser-screenshot-initial-390", value: "initial-390\n", sourcePath: "evidence/initial-390.png" },
    { kind: "browser-screenshot-initial-768", value: "initial-768\n", sourcePath: "evidence/initial-768.png" },
    { kind: "browser-screenshot-initial-1440", value: "initial-1440\n", sourcePath: "evidence/initial-1440.png" },
  ]);

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
        findings: [],
      },
    }]),
    (error: unknown) => error instanceof Error && error.message.includes("Critic invocation must be independent"),
  );
});

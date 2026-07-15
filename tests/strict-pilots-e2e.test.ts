import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findSkill } from "../src/registry/index.ts";
import { getAdapter } from "../src/installers/codex.ts";
import {
  StrictSkillRunStore, beginStrictStep, completeStrictStep, finalizeStrictRun,
  readNextStrictChunk, startPreparedStrictSkillRun, type SkillRunV2,
} from "../src/runtime/strict/index.ts";

const install = async (root: string, skillId: string) => {
  const skill = await findSkill(skillId); assert.ok(skill);
  await getAdapter("codex").applyInstall(skill, { projectRoot: root, targetAgent: "codex", scope: "repo", dryRun: false, mode: "copy" });
};
const readAll = async (store: StrictSkillRunStore, run: SkillRunV2, skillId: string) => {
  while (run.state === "reading") run = await store.update(run.runId, (current) => readNextStrictChunk(current, skillId).run);
  return run;
};
const step = async (root: string, store: StrictSkillRunStore, run: SkillRunV2, skillId: string, evidence: Array<{ kind: string; value: unknown; sourcePath?: string; validatedAs?: "output" | "critic-report" }> = []) => {
  const ledger = run.skillLedgers.find((entry) => entry.skillId === skillId)!;
  const next = ledger.steps.find(({ status }) => status === "pending")!;
  run = await store.update(run.runId, (current) => beginStrictStep(current, skillId, next.id));
  for (const [index, item] of evidence.entries()) {
    const source = item.sourcePath
      ? path.join(root, item.sourcePath)
      : path.join(root, "evidence", `${run.revision}-${index}-${item.kind}.json`);
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, typeof item.value === "string" ? item.value : `${JSON.stringify(item.value, null, 2)}\n`);
    run = await store.ingestEvidence(run.runId, {
      sourcePath: source, kind: item.kind, ...(item.validatedAs ? { validatedAs: item.validatedAs } : {}),
      attributions: [{ skillId, stepId: next.id, attempt: next.attempts.length + 1, relation: "produced", ruleIds: next.ruleIds }],
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
  const store = new StrictSkillRunStore(root); run = await readAll(store, run, "frontend.performance-review");
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
  assert.equal(finalizeStrictRun(run).state, "verified");
});

test("performance validate-change enters bounded report repair without before/after evidence", async () => {
  const { store, run: prepared } = await preparePerformance("validate-change", ["after trace"]);
  const run = await store.verifySkill(prepared.runId, "frontend.performance-review");
  assert.equal(run.state, "repair-required");
  assert.equal(run.skillLedgers[0].repairRequests.length, 1);
});

test("Tailwind pilot records critic evidence, repairs a hard gate, rechecks fresh viewports, and verifies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-tailwind-e2e-"));
  await cp("fixtures/next-react-ts", root, { recursive: true }); await install(root, "frontend.tailwind-ui-polish");
  const skillId = "frontend.tailwind-ui-polish";
  let run = await startPreparedStrictSkillRun({ projectRoot: root, registryRoot: path.resolve("registry"), targetAgent: "codex", domain: "frontend", intent: "Polish existing Tailwind UI", skillInputs: { [skillId]: { brief: {}, existingDirection: { source: "approved" }, capabilityProfile: "standard" } }, hostCapabilities: ["browser", "screenshots"] });
  const store = new StrictSkillRunStore(root); run = await readAll(store, run, skillId);
  run = await step(root, store, run, skillId, [{ kind: "project-archetype", value: "tailwind\n" }]);
  run = await step(root, store, run, skillId, [{ kind: "browser-screenshot-before", value: "before\n" }]);
  run = await step(root, store, run, skillId, [{ kind: "implementation-diff", value: { checks: { "no-dynamic-tailwind-classes": true }, diff: "+ <div className={`p-4 bg-${color}-600`}>Save</div>" } }]);
  run = await step(root, store, run, skillId, [{ kind: "browser-screenshot-initial", value: "initial\n" }]);
  run = await step(root, store, run, skillId, [{ kind: "critic-report", validatedAs: "critic-report", value: { schemaVersion: "2.0", skillId, criticInvocationId: "critic-2", executorInvocationId: "executor-1", outcome: "clean", findings: [] } }]);
  run = await step(root, store, run, skillId, ["browser-screenshot-390", "browser-screenshot-768", "browser-screenshot-1440"].map((kind) => ({ kind, value: `${kind}\n` })));
  const browserChecks = { "required-states-covered": true, "no-horizontal-overflow": true, "no-clipped-controls": true, "no-sticky-overlap": true, "focus-visible": true, "no-runtime-console-errors": true, "reduced-motion-verified": true };
  run = await step(root, store, run, skillId, [{ kind: "verification-input", value: { checks: browserChecks } }]);
  run = await step(root, store, run, skillId, [{ kind: "skill-output", validatedAs: "output", value: { outcome: "verified", classification: "hierarchy", changes: ["polished"], verification: {}, residualRisks: [] } }]);
  run = await store.verifySkill(run.runId, skillId);
  assert.equal(run.state, "repair-required");
  const firstReport = run.skillLedgers[0].verificationReports.at(-1)!;
  const browserGateIds = new Set(run.skillLedgers[0].contract.gates
    .filter(({ evaluator }) => evaluator.type === "validator" && evaluator.validatorId === "frontend/browser-hard-gates")
    .map(({ id }) => id));
  const browserResults = firstReport.gateResults.filter(({ gateId }) => browserGateIds.has(gateId));
  assert.equal(browserResults.length, 7);
  assert.ok(browserResults.every(({ passed, message }) => !passed && /valid browser observations/i.test(message ?? "")));
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
  assert.equal(run.skillLedgers[0].outcome, "used");
  assert.equal(finalizeStrictRun(run).state, "verified");
});

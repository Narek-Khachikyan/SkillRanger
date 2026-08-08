import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  StrictSkillRunError,
  StrictSkillRunStore,
  beginStrictStep,
  buildTrustedValidatorRegistry,
  completeStrictStep,
  createContentChunks,
  createStrictSkillRun,
  deriveStrictValidatorResults,
  readNextStrictChunk,
  type EvidenceArtifact,
  type ExecutionContractV2,
  type SkillLedger,
  type SkillRunV2,
  type ValidatorEvaluationContext,
} from "../src/runtime/strict/index.ts";
import {
  browserArtifacts,
  browserContract,
  browserGateResult,
  browserGateSlugs,
  browserObservation,
  browserResultsFor,
  createBrowserGateRun,
} from "./helpers/browser-gate-fixtures.ts";
import {
  createTailwindSourceRun,
  tailwindContract,
  tailwindGateResult,
  tailwindGateSlugs,
  tailwindRepairContract,
  tailwindResultsFor,
  tailwindSkillId,
} from "./helpers/tailwind-source-fixtures.ts";

const sha = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const skillId = "frontend.domain-validators-test";
const performanceGateSlugs = [
  "finding-dimension-present",
  "measured-claim-has-artifact",
  "before-after-required-for-win",
  "unmeasured-claims-labeled-risk",
  "exact-missing-measurement",
  "priority-confidence-present",
  "no-false-performance-win",
];
const contract: ExecutionContractV2 = {
  schemaVersion: "2.0",
  skillId,
  contractVersion: "2.0.0",
  inputSchema: "input.schema.json",
  outputSchema: "output.schema.json",
  mustRead: ["SKILL.md"],
  applicability: { op: "tag", value: "frontend" },
  prerequisites: [],
  maxRepairIterations: 1,
  rules: [{ id: `${skillId}/rule/evidence`, description: "Record evidence." }],
  steps: [{ id: `${skillId}/step/collect`, type: "collect", requiredEvidenceKinds: ["report"], ruleIds: [`${skillId}/rule/evidence`] }],
  gates: performanceGateSlugs.map((slug) => ({
    id: `${skillId}/gate/${slug}`,
    level: "hard" as const,
    evaluator: { type: "validator" as const, validatorId: "frontend/performance-claims" },
    ruleIds: [`${skillId}/rule/evidence`],
  })),
};

const riskReviewReport = {
  mode: "risk-review",
  findings: [{
    affectedFlow: "initial load", dimension: "LCP", basis: "risk", impact: "high", confidence: "medium",
    behavior: "Hero delivery may delay paint", evidence: [], expectedBenefit: "Earlier LCP",
    tradeoff: "Potential preload bytes",
  }],
  measurementsInspected: [],
  measurementGaps: ["Capture before/after LCP traces for the initial load flow"],
  residualRisks: [],
};
const measuredChangeReport = {
  mode: "validate-change",
  findings: [{
    affectedFlow: "initial load", dimension: "LCP", basis: "measured", impact: "high", confidence: "medium",
    behavior: "Hero delivery may delay paint", evidence: ["trace.json"], expectedBenefit: "Earlier LCP",
    tradeoff: "Potential preload bytes",
  }],
  measurementsInspected: ["before trace", "after trace"],
  measurementGaps: [],
  residualRisks: [],
};

const fixtureRun = (executionContract = contract, runId = "run_domain_validators") => createStrictSkillRun({
  runId, domain: "frontend", targetAgent: "codex", locale: "en",
  intent: { sha256: sha("validators"), normalizedGoal: "validate performance claims" }, now: "2026-07-15T10:00:00.000Z",
  selectedSkills: [{
    skillId: executionContract.skillId, role: "primary", mandatory: true, version: "1.0.0",
    packageChecksum: sha("package"), contractChecksum: sha(JSON.stringify(executionContract)), contract: executionContract,
    schemaSnapshots: { input: { type: "object" }, output: { type: "object" } },
    schemaChecksums: { input: sha(JSON.stringify({ type: "object" })), output: sha(JSON.stringify({ type: "object" })) },
    contentChunks: createContentChunks("SKILL.md", "# Validator Test\n"), applicable: true, unmetPrerequisites: [],
  }],
});

const evaluator = () => {
  const registry = buildTrustedValidatorRegistry([{ skillId: contract.skillId }]);
  const resolved = registry.resolveValidator("frontend/performance-claims");
  assert.ok(resolved, "frontend/performance-claims must resolve through the trusted registry");
  return resolved;
};

const contextFor = (ledger: SkillLedger, output: unknown, gateId: string): ValidatorEvaluationContext => ({
  projectRoot: "/project",
  ledger,
  artifacts: [],
  artifactBytes: new Map(),
  output,
  gateId,
});

const resultsFor = (ledger: SkillLedger, output: unknown) => Object.fromEntries(
  contract.gates.map((gate) => [gate.id.slice(gate.id.lastIndexOf("/") + 1), evaluator()(contextFor(ledger, output, gate.id))]),
);

const failedGateIds = (results: Record<string, { passed: boolean }>) =>
  Object.entries(results).filter(([, result]) => !result.passed).map(([gate]) => gate);

test("valid risk-review evidence passes every performance gate through the domain validator seam", () => {
  const results = resultsFor(fixtureRun().skillLedgers[0], riskReviewReport);
  assert.deepEqual(failedGateIds(results), []);
});

test("valid measured validate-change evidence with before/after measurements passes every performance gate", () => {
  const results = resultsFor(fixtureRun().skillLedgers[0], measuredChangeReport);
  assert.deepEqual(failedGateIds(results), []);
});

test("findings without a flow and dimension fail only finding-dimension-present", () => {
  const results = resultsFor(fixtureRun().skillLedgers[0], {
    ...riskReviewReport,
    findings: [{ basis: "risk", impact: "high", confidence: "medium", tradeoff: "bytes" }],
  });
  assert.deepEqual(failedGateIds(results), ["finding-dimension-present"]);
});

test("measured claims without attached artifacts fail only measured-claim-has-artifact", () => {
  const results = resultsFor(fixtureRun().skillLedgers[0], {
    ...measuredChangeReport,
    findings: [{
      affectedFlow: "initial load", dimension: "LCP", basis: "measured", impact: "high", confidence: "medium",
      behavior: "faster", evidence: [], expectedBenefit: "Earlier paint", tradeoff: "bytes",
    }],
  });
  assert.deepEqual(failedGateIds(results), ["measured-claim-has-artifact"]);
});

test("findings without priority and confidence fields fail only priority-confidence-present", () => {
  const results = resultsFor(fixtureRun().skillLedgers[0], {
    ...riskReviewReport,
    findings: [{ affectedFlow: "initial load", dimension: "LCP", basis: "risk" }],
  });
  assert.deepEqual(failedGateIds(results), ["priority-confidence-present"]);
});

test("claims that are neither measured nor labeled risk fail only unmeasured-claims-labeled-risk", () => {
  const results = resultsFor(fixtureRun().skillLedgers[0], {
    ...riskReviewReport,
    findings: [{
      affectedFlow: "initial load", dimension: "LCP", basis: "opinion", impact: "high", confidence: "medium",
      behavior: "feels slower", evidence: [], expectedBenefit: "Faster", tradeoff: "bytes",
    }],
  });
  assert.deepEqual(failedGateIds(results), ["unmeasured-claims-labeled-risk"]);
});

test("incomplete performance output fails every performance gate with the existing message", () => {
  const ledger = fixtureRun().skillLedgers[0];
  for (const incomplete of [undefined, [], "not a report"]) {
    const results = resultsFor(ledger, incomplete);
    assert.deepEqual(failedGateIds(results), performanceGateSlugs);
    for (const slug of performanceGateSlugs) {
      assert.equal(results[slug].message, `Performance report failed ${slug}.`);
    }
  }
});

test("causally insufficient validate-change evidence fails only the before/after and false-win gates", () => {
  const results = resultsFor(fixtureRun().skillLedgers[0], {
    ...measuredChangeReport,
    measurementsInspected: ["after trace"],
  });
  assert.deepEqual(failedGateIds(results), ["before-after-required-for-win", "no-false-performance-win"]);
});

test("risk claims without an exact measurement gap fail only exact-missing-measurement", () => {
  const results = resultsFor(fixtureRun().skillLedgers[0], {
    ...riskReviewReport,
    measurementGaps: [],
  });
  assert.deepEqual(failedGateIds(results), ["exact-missing-measurement"]);
});

test("an unrecognized performance gate slug fails closed", () => {
  const result = evaluator()(contextFor(fixtureRun().skillLedgers[0], riskReviewReport, `${skillId}/gate/unexpected`));
  assert.deepEqual(result, { passed: false, message: "Performance report failed unexpected." });
});

const stageReport = async (root: string, store: StrictSkillRunStore, report: unknown, stagedAsOutput = true) => {
  const source = path.join(root, "report.json");
  await writeFile(source, `${JSON.stringify(report)}\n`);
  let run = beginStrictStep(
    readNextStrictChunk(fixtureRun(), contract.skillId).run,
    contract.skillId,
    contract.steps[0].id,
  );
  await store.create(run);
  run = await store.ingestEvidence(run.runId, {
    sourcePath: source,
    kind: "report",
    ...(stagedAsOutput ? { validatedAs: "output" } : {}),
    attributions: [{
      skillId: contract.skillId,
      stepId: contract.steps[0].id,
      attempt: 1,
      relation: "produced",
      ruleIds: contract.rules.map(({ id }) => id),
    }],
  });
  return store.update(run.runId, (current) => completeStrictStep(current, contract.skillId, contract.steps[0].id));
};

test("deriveStrictValidatorResults keys domain validator results by gate id through the integrity seam", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "domain-validators-derive-"));
  const store = new StrictSkillRunStore(root);
  const run = await stageReport(root, store, riskReviewReport);

  const derivation = await deriveStrictValidatorResults(root, run, run.skillLedgers[0]);
  assert.equal(derivation.artifactIntegrity.passed, true);
  for (const gate of contract.gates) {
    assert.equal(derivation.validatorResults[gate.id].passed, true, gate.id);
  }
});

test("missing performance evidence fails every declared gate through the domain validator seam", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "domain-validators-missing-"));
  const store = new StrictSkillRunStore(root);
  const run = await stageReport(root, store, {}, false);

  const derivation = await deriveStrictValidatorResults(root, run, run.skillLedgers[0]);
  for (const gate of contract.gates) {
    assert.equal(derivation.validatorResults[gate.id].passed, false, gate.id);
    assert.match(derivation.validatorResults[gate.id].message ?? "", /^Performance report failed .+\.$/);
  }
  await assert.rejects(
    store.verifySkill(run.runId, contract.skillId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "hard-gate-failed",
  );
  assert.equal((await store.read(run.runId)).state, "verifying");
});

test("verification and finalization re-derive identical performance gate results across independent stores", async () => {
  const firstRoot = await mkdtemp(path.join(os.tmpdir(), "domain-validators-parity-a-"));
  const secondRoot = await mkdtemp(path.join(os.tmpdir(), "domain-validators-parity-b-"));
  const firstStore = new StrictSkillRunStore(firstRoot);
  const secondStore = new StrictSkillRunStore(secondRoot);
  const first = await stageReport(firstRoot, firstStore, measuredChangeReport);
  const second = await stageReport(secondRoot, secondStore, measuredChangeReport);

  const firstReport = (await firstStore.verifySkill(first.runId, contract.skillId))
    .skillLedgers[0].verificationReports.at(-1)!;
  const secondReport = (await secondStore.verifySkill(second.runId, contract.skillId))
    .skillLedgers[0].verificationReports.at(-1)!;

  assert.equal(firstReport.hardPassed, true);
  assert.equal(firstReport.hardPassed, secondReport.hardPassed);
  assert.equal(firstReport.gateResults.filter(({ gateId }) => gateId.startsWith(`${skillId}/gate/`)).length, contract.gates.length);
  assert.deepEqual(firstReport.gateResults, secondReport.gateResults);
  assert.equal((await firstStore.finalizeRun(first.runId)).state, "verified");
  assert.equal((await secondStore.finalizeRun(second.runId)).state, "verified");
});

test("independently persisted runs re-derive identical failed gate results for identical incomplete evidence", async () => {
  const firstRoot = await mkdtemp(path.join(os.tmpdir(), "domain-validators-fail-parity-a-"));
  const secondRoot = await mkdtemp(path.join(os.tmpdir(), "domain-validators-fail-parity-b-"));
  const firstStore = new StrictSkillRunStore(firstRoot);
  const secondStore = new StrictSkillRunStore(secondRoot);
  const first = await stageReport(firstRoot, firstStore, {}, false);
  const second = await stageReport(secondRoot, secondStore, {}, false);

  const firstDerivation = await deriveStrictValidatorResults(firstRoot, first, first.skillLedgers[0]);
  const secondDerivation = await deriveStrictValidatorResults(secondRoot, second, second.skillLedgers[0]);
  assert.deepEqual(firstDerivation.validatorResults, secondDerivation.validatorResults);
  assert.deepEqual(
    failedGateIds(firstDerivation.validatorResults).map((gateId) => gateId.slice(gateId.lastIndexOf("/") + 1)),
    performanceGateSlugs,
  );
  for (const slug of performanceGateSlugs) {
    assert.equal(firstDerivation.validatorResults[`${skillId}/gate/${slug}`].message, `Performance report failed ${slug}.`);
  }
});


test("derives browser gates only from closed observations bound to screenshot evidence", () => {
  const observations = [390, 768, 1440].map(browserObservation);
  const ledger = createBrowserGateRun().skillLedgers[0];
  const valid = browserResultsFor(ledger, { observations }, browserArtifacts);
  assert.equal(Object.keys(valid).length, 7);
  assert.ok(Object.values(valid).every(({ passed }) => passed));

  const forged = browserResultsFor(ledger, { checks: { "required-states-covered": true } }, browserArtifacts);
  // The rejection now carries the contract itself, so an agent can correct the shape instead of
  // resubmitting self-declared pass flags. Every gate must state the identical contract, naming
  // the closed observation keys.
  const forgedMessages = new Set(Object.values(forged).map(({ message }) => message));
  assert.equal(forgedMessages.size, 1);
  const [forgedMessage] = [...forgedMessages];
  assert.ok(Object.values(forged).every(({ passed }) => !passed));
  assert.match(forgedMessage ?? "", /must be exactly \{ observations: \[\.\.\.\] \}/);
  assert.match(forgedMessage ?? "", /horizontalOverflow/);
  assert.match(forgedMessage ?? "", /reducedMotionVerified/);
  assert.match(forgedMessage ?? "", /Self-declared pass flags are not accepted/);

  const unbound = browserResultsFor(ledger, {
    observations: observations.map((item, index) => index === 0 ? { ...item, screenshotPath: "evidence/unbound.png" } : item),
  }, browserArtifacts);
  assert.ok(Object.values(unbound).every(({ passed, message }) => !passed && /not bound/i.test(message ?? "")));

  const openShape = browserResultsFor(ledger, {
    observations: [{ ...observations[0], callerApproved: true }, ...observations.slice(1)],
  }, browserArtifacts);
  assert.ok(Object.values(openShape).every(({ passed }) => !passed));
});

test("strict browser gates require rendered action and observed change evidence", () => {
  const ledger = createBrowserGateRun().skillLedgers[0];
  const valid = [390, 768, 1440].map(browserObservation);
  for (const observations of [
    valid.map((item, index) => index === 0 ? { ...item, stateRendered: false } : item),
    valid.map((item, index) => index === 0 ? { ...item, action: "" } : item),
    valid.map((item, index) => index === 0
      ? { ...item, changes: [{ locator: "#active-state", before: "same", after: "same" }] }
      : item),
  ]) {
    const results = browserResultsFor(ledger, { observations }, browserArtifacts);
    assert.ok(Object.values(results).every(({ passed }) => !passed));
  }
});

test("strict browser gates consume the canonical extended UI evidence shape", () => {
  const ledger = createBrowserGateRun().skillLedgers[0];
  const observations = [390, 768, 1440].map((width) => ({
    ...browserObservation(width),
    overlaps: [],
    focusOrderViolations: [],
    contrastViolations: [],
    mechanicalSnapshot: browserObservation(390).mechanicalSnapshot,
  }));
  const valid = browserResultsFor(ledger, { observations }, browserArtifacts);
  assert.ok(Object.values(valid).every(({ passed }) => passed));

  const weakened = browserResultsFor(ledger, {
    observations: observations.map((observation, index) => index === 0
      ? { ...observation, overlaps: ["#panel"] }
      : observation),
  }, browserArtifacts);
  assert.equal(weakened["no-clipped-controls"].passed, false);

  const missingViewport = browserResultsFor(ledger, { observations: observations.slice(0, 2) }, browserArtifacts);
  assert.equal(missingViewport["required-states-covered"].passed, false);

  const desynchronized = browserResultsFor(ledger, {
    observations: observations.map((observation, index) => index === 0
      ? {
          ...observation,
          stateSynchronization: {
            status: "mismatch",
            path: "#active-state -> #summary",
            observations: ["#active-state=next", "#summary=previous"],
            action: observation.action,
            changes: observation.changes,
          },
        }
      : observation),
  }, browserArtifacts);
  assert.equal(desynchronized["required-states-covered"].passed, false);

  const missingState = browserResultsFor(ledger, {
    observations,
    requiredStates: ["default", "empty"],
  }, browserArtifacts);
  assert.equal(missingState["required-states-covered"].passed, false);
});

test("rejects root checks beside otherwise valid browser observations", () => {
  const observations = [390, 768, 1440].map(browserObservation);
  const results = browserResultsFor(createBrowserGateRun().skillLedgers[0], {
    observations,
    checks: { "required-states-covered": true },
  }, browserArtifacts);
  assert.ok(Object.values(results).every(({ passed, message }) => !passed && /closed shape/i.test(message ?? "")));
});

test("rejects reuse of one screenshot across required browser viewports", () => {
  const observations = [390, 768, 1440].map((width) => ({
    ...browserObservation(width),
    screenshotPath: "evidence/shared.png",
  }));
  const artifacts = [390, 768, 1440].map((width) => ({
    kind: `browser-screenshot-${width}`,
    sourcePath: "evidence/shared.png",
  })) as EvidenceArtifact[];

  const results = browserResultsFor(createBrowserGateRun().skillLedgers[0], { observations }, artifacts);
  assert.ok(Object.values(results).every(({ passed, message }) => !passed && /distinct screenshot/i.test(message ?? "")));
});

test("binds each browser observation viewport to its screenshot artifact kind", () => {
  const observations = [390, 768, 1440].map(browserObservation);
  const mismatched = browserArtifacts.map((artifact, index) => ({
    ...artifact,
    kind: `browser-screenshot-${[768, 390, 1440][index]}`,
  }));

  const results = browserResultsFor(createBrowserGateRun().skillLedgers[0], { observations }, mismatched);
  assert.ok(Object.values(results).every(({ passed, message }) => !passed && /not bound/i.test(message ?? "")));
});

test("fails the accessibility hard gate for a critical axe violation", () => {
  const observations = [390, 768, 1440].map(browserObservation);
  observations[0].criticalAxeViolations = ["button-name"];

  const results = browserResultsFor(createBrowserGateRun().skillLedgers[0], { observations }, browserArtifacts);
  assert.equal(results["focus-visible"].passed, false);
  assert.ok(Object.entries(results)
    .filter(([gate]) => gate !== "focus-visible")
    .every(([, result]) => result.passed));
});

test("console, sticky overlap, and reduced-motion findings fail only their own gates", () => {
  const consoleObservations = [390, 768, 1440].map(browserObservation);
  consoleObservations[0].consoleErrors = ["TypeError: undefined is not an object"];
  const consoleResults = browserResultsFor(createBrowserGateRun().skillLedgers[0], { observations: consoleObservations }, browserArtifacts);
  assert.equal(consoleResults["no-runtime-console-errors"].passed, false);
  assert.ok(Object.entries(consoleResults)
    .filter(([gate]) => gate !== "no-runtime-console-errors")
    .every(([, result]) => result.passed));

  const stickyObservations = [390, 768, 1440].map(browserObservation).map((observation, index) => index === 0
    ? { ...observation, stickyOverlaps: ["#header over #content"] }
    : observation);
  const stickyResults = browserResultsFor(createBrowserGateRun().skillLedgers[0], { observations: stickyObservations }, browserArtifacts);
  assert.equal(stickyResults["no-sticky-overlap"].passed, false);
  assert.ok(Object.entries(stickyResults)
    .filter(([gate]) => gate !== "no-sticky-overlap")
    .every(([, result]) => result.passed));

  const motionObservations = [390, 768, 1440].map(browserObservation).map((observation, index) => index === 0
    ? { ...observation, reducedMotionVerified: false }
    : observation);
  const motionResults = browserResultsFor(createBrowserGateRun().skillLedgers[0], { observations: motionObservations }, browserArtifacts);
  assert.equal(motionResults["reduced-motion-verified"].passed, false);
  assert.ok(Object.entries(motionResults)
    .filter(([gate]) => gate !== "reduced-motion-verified")
    .every(([, result]) => result.passed));
});

test("required states declared by the run brief input apply through the domain validator seam", () => {
  const observations = [390, 768, 1440].map(browserObservation);
  const covered = browserResultsFor(createBrowserGateRun({ brief: { surface: { requiredStates: ["default"] } } }).skillLedgers[0], { observations }, browserArtifacts);
  assert.ok(Object.values(covered).every(({ passed }) => passed));

  const missingState = browserResultsFor(createBrowserGateRun({ brief: { surface: { requiredStates: ["default", "empty"] } } }).skillLedgers[0], { observations }, browserArtifacts);
  assert.equal(missingState["required-states-covered"].passed, false);
  assert.ok(Object.entries(missingState)
    .filter(([gate]) => gate !== "required-states-covered")
    .every(([, result]) => result.passed));
});

test("an unrecognized browser gate slug fails closed", () => {
  const observations = [390, 768, 1440].map(browserObservation);
  const result = browserGateResult(createBrowserGateRun().skillLedgers[0], { observations }, browserArtifacts, `${skillId}/gate/unexpected`);
  assert.deepEqual(result, { passed: false, message: "Browser hard gate unexpected is not a certifying gate." });
});

test("missing or malformed browser evidence fails every gate with the closed shape contract", () => {
  const ledger = createBrowserGateRun().skillLedgers[0];
  for (const verificationInput of [undefined, {}, [], "not browser evidence"]) {
    const results = browserResultsFor(ledger, verificationInput, browserArtifacts);
    assert.deepEqual(failedGateIds(results), browserGateSlugs);
    for (const slug of browserGateSlugs) {
      assert.match(results[slug].message ?? "", /must be exactly \{ observations: \[\.\.\.\] \}/);
    }
  }
});

test("deriveStrictValidatorResults keys browser gate results by gate id through the integrity seam", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "domain-validators-browser-derive-"));
  const store = new StrictSkillRunStore(root);
  const observations = [390, 768, 1440].map(browserObservation);
  let run = beginStrictStep(
    readNextStrictChunk(createBrowserGateRun(), browserContract.skillId).run,
    browserContract.skillId,
    browserContract.steps[0].id,
  );
  await store.create(run);
  for (const width of [390, 768, 1440]) {
    const source = path.join(root, "evidence", `${width}.png`);
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, `browser-screenshot-${width}\n`);
    run = await store.ingestEvidence(run.runId, {
      sourcePath: source,
      kind: `browser-screenshot-${width}`,
      attributions: [{
        skillId: browserContract.skillId,
        stepId: browserContract.steps[0].id,
        attempt: 1,
        relation: "produced",
        ruleIds: browserContract.rules.map(({ id }) => id),
      }],
    });
  }
  const inputSource = path.join(root, "verification-input.json");
  await writeFile(inputSource, `${JSON.stringify({ observations })}\n`);
  run = await store.ingestEvidence(run.runId, {
    sourcePath: inputSource,
    kind: "verification-input",
    attributions: [{
      skillId: browserContract.skillId,
      stepId: browserContract.steps[0].id,
      attempt: 1,
      relation: "produced",
      ruleIds: browserContract.rules.map(({ id }) => id),
    }],
  });
  run = await store.update(run.runId, (current) => completeStrictStep(current, browserContract.skillId, browserContract.steps[0].id));

  const derivation = await deriveStrictValidatorResults(root, run, run.skillLedgers[0]);
  assert.equal(derivation.artifactIntegrity.passed, true);
  for (const gate of browserContract.gates) {
    assert.equal(derivation.validatorResults[gate.id].passed, true, gate.id);
  }
});

const stageDiff = async (
  root: string,
  store: StrictSkillRunStore,
  run: SkillRunV2,
  stepId: string,
  content: string,
) => {
  const source = path.join(root, "evidence", `${run.revision}-${stepId.slice(stepId.lastIndexOf("/") + 1)}.patch`);
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, content);
  const step = run.skillLedgers[0].steps.find(({ id }) => id === stepId)!;
  const attempt = step.attempts.at(-1)!.attempt;
  return store.ingestEvidence(run.runId, {
    sourcePath: source,
    kind: "implementation-diff",
    attributions: [{
      skillId: tailwindSkillId,
      stepId,
      attempt,
      relation: "produced",
      ruleIds: tailwindContract.rules.map(({ id }) => id),
    }],
  });
};

const stageValidDiff = async (root: string, store: StrictSkillRunStore) => {
  let run = beginStrictStep(
    readNextStrictChunk(createTailwindSourceRun(), tailwindSkillId).run,
    tailwindSkillId,
    tailwindContract.steps[0].id,
  );
  await store.create(run);
  run = await stageDiff(root, store, run, tailwindContract.steps[0].id, '+ <div className="bg-brand-600 text-on-brand">Save</div>\n');
  return store.update(run.runId, (current) => completeStrictStep(current, tailwindSkillId, tailwindContract.steps[0].id));
};

test("valid static source-review evidence passes every tailwind source gate through the domain validator seam", () => {
  const results = tailwindResultsFor(createTailwindSourceRun().skillLedgers[0], ['+ <div className="bg-brand-600 text-on-brand">Save</div>']);
  assert.deepEqual(failedGateIds(results), []);
});

test("dynamic Tailwind class evidence fails only no-dynamic-tailwind-classes", () => {
  const results = tailwindResultsFor(createTailwindSourceRun().skillLedgers[0], ['<div className={`p-4 bg-${color}-600`}>Save</div>']);
  assert.deepEqual(failedGateIds(results), ["no-dynamic-tailwind-classes"]);
});

test("raw color evidence fails only raw-colors-reviewed", () => {
  const results = tailwindResultsFor(createTailwindSourceRun().skillLedgers[0], ['<div className="bg-red-500">Save</div>']);
  assert.deepEqual(failedGateIds(results), ["raw-colors-reviewed"]);
});

test("repeated conflicting class bundles fail only repeated-class-bundles-reviewed", () => {
  const results = tailwindResultsFor(createTailwindSourceRun().skillLedgers[0], ['+ <div className="block flex">Save</div>']);
  assert.deepEqual(failedGateIds(results), ["repeated-class-bundles-reviewed"]);
});

test("an unrecognized tailwind gate slug fails closed", () => {
  const result = tailwindGateResult(createTailwindSourceRun().skillLedgers[0], ['+ <div className="bg-brand-600">Save</div>'], `${skillId}/gate/unexpected`);
  assert.deepEqual(result, { passed: false, message: "Tailwind source check failed unexpected." });
});

test("missing or malformed source-review evidence fails every tailwind gate with the staged-evidence contract", () => {
  const ledger = createTailwindSourceRun().skillLedgers[0];
  for (const sourceReview of [undefined, [], "", "not staged evidence"]) {
    const results = tailwindResultsFor(ledger, sourceReview);
    assert.deepEqual(failedGateIds(results), tailwindGateSlugs);
    for (const slug of tailwindGateSlugs) {
      assert.equal(results[slug].message, "No implementation diff evidence was staged.");
    }
  }
});

test("deriveStrictValidatorResults keys tailwind source results by gate id through the integrity seam", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "domain-validators-tailwind-derive-"));
  const store = new StrictSkillRunStore(root);
  let run = beginStrictStep(
    readNextStrictChunk(createTailwindSourceRun(), tailwindSkillId).run,
    tailwindSkillId,
    tailwindContract.steps[0].id,
  );
  await store.create(run);
  run = await stageDiff(root, store, run, tailwindContract.steps[0].id, '+ <div className="bg-brand-600 text-on-brand">Save</div>\n');
  run = await store.update(run.runId, (current) => completeStrictStep(current, tailwindSkillId, tailwindContract.steps[0].id));

  const derivation = await deriveStrictValidatorResults(root, run, run.skillLedgers[0]);
  assert.equal(derivation.artifactIntegrity.passed, true);
  for (const gate of tailwindContract.gates) {
    assert.equal(derivation.validatorResults[gate.id].passed, true, gate.id);
  }
});

test("missing implementation-diff evidence fails every tailwind gate through the domain validator seam", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "domain-validators-tailwind-missing-"));
  const store = new StrictSkillRunStore(root);
  let run = beginStrictStep(
    readNextStrictChunk(createTailwindSourceRun(), tailwindSkillId).run,
    tailwindSkillId,
    tailwindContract.steps[0].id,
  );
  await store.create(run);
  run = await store.update(run.runId, (current) => completeStrictStep(current, tailwindSkillId, tailwindContract.steps[0].id));

  const derivation = await deriveStrictValidatorResults(root, run, run.skillLedgers[0]);
  for (const gate of tailwindContract.gates) {
    assert.equal(derivation.validatorResults[gate.id].passed, false, gate.id);
    assert.equal(derivation.validatorResults[gate.id].message, "No implementation diff evidence was staged.");
  }
  await assert.rejects(
    store.verifySkill(run.runId, tailwindSkillId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "hard-gate-failed",
  );
  assert.equal((await store.read(run.runId)).state, "verifying");
});

test("stale source-review evidence from a superseded attempt cannot fail the re-derived tailwind gates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "domain-validators-tailwind-stale-"));
  const store = new StrictSkillRunStore(root);
  const implementStep = tailwindRepairContract.steps[0].id;
  const repairStep = tailwindRepairContract.steps[1].id;
  let run = beginStrictStep(
    readNextStrictChunk(createTailwindSourceRun(tailwindRepairContract), tailwindSkillId).run,
    tailwindSkillId,
    implementStep,
  );
  await store.create(run);
  run = await stageDiff(root, store, run, implementStep, '+ <div className={`p-4 bg-${color}-600`}>Save</div>\n');
  run = await store.update(run.runId, (current) => completeStrictStep(current, tailwindSkillId, implementStep));

  run = await store.verifySkill(run.runId, tailwindSkillId);
  assert.equal(run.state, "repair-required");
  assert.equal(run.skillLedgers[0].repairRequests.length, 1);

  run = await store.update(run.runId, (current) => beginStrictStep(current, tailwindSkillId, repairStep));
  run = await stageDiff(root, store, run, repairStep, '+ <div className="bg-brand-600 text-on-brand">Save</div>\n');
  run = await store.update(run.runId, (current) => completeStrictStep(current, tailwindSkillId, repairStep));

  run = await store.verifySkill(run.runId, tailwindSkillId);
  assert.equal(run.skillLedgers[0].outcome, "used");
  const latest = run.skillLedgers[0].verificationReports.at(-1)!;
  for (const gate of tailwindContract.gates) {
    assert.equal(latest.gateResults.find(({ gateId }) => gateId === gate.id)?.passed, true, gate.id);
  }
  assert.equal((await store.finalizeRun(run.runId)).state, "verified");
});

test("verification and finalization re-derive identical tailwind gate results across independent stores", async () => {
  const firstRoot = await mkdtemp(path.join(os.tmpdir(), "domain-validators-tailwind-parity-a-"));
  const secondRoot = await mkdtemp(path.join(os.tmpdir(), "domain-validators-tailwind-parity-b-"));
  const firstStore = new StrictSkillRunStore(firstRoot);
  const secondStore = new StrictSkillRunStore(secondRoot);
  const first = await stageValidDiff(firstRoot, firstStore);
  const second = await stageValidDiff(secondRoot, secondStore);

  const firstReport = (await firstStore.verifySkill(first.runId, tailwindSkillId))
    .skillLedgers[0].verificationReports.at(-1)!;
  const secondReport = (await secondStore.verifySkill(second.runId, tailwindSkillId))
    .skillLedgers[0].verificationReports.at(-1)!;

  assert.equal(firstReport.hardPassed, true);
  assert.equal(firstReport.hardPassed, secondReport.hardPassed);
  assert.equal(firstReport.gateResults.filter(({ gateId }) => gateId.startsWith(`${tailwindSkillId}/gate/`)).length, tailwindContract.gates.length);
  assert.deepEqual(firstReport.gateResults, secondReport.gateResults);
  assert.equal((await firstStore.finalizeRun(first.runId)).state, "verified");
  assert.equal((await secondStore.finalizeRun(second.runId)).state, "verified");
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rename, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  StrictSkillRunError,
  StrictSkillRunStore,
  beginStrictStep,
  completeStrictStep,
  createContentChunks,
  createStrictSkillRun,
  deriveStrictValidatorResults,
  readNextStrictChunk,
  assertValidStrictSkillRun,
  type EvidenceArtifact,
  type ExecutionContractV2,
  type SkillRunV2,
} from "../src/runtime/strict/index.ts";
import { deriveBrowserGateResults, deriveTailwindSourceResults } from "../src/runtime/strict/frontend-evidence.ts";
import { internalContainedFileReadHooks } from "../src/runtime/strict/contained-file.ts";

const sha = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const contract: ExecutionContractV2 = {
  schemaVersion: "2.0", skillId: "frontend.store-test", contractVersion: "2.0.0",
  inputSchema: "input.schema.json", outputSchema: "output.schema.json", mustRead: ["SKILL.md"],
  applicability: { op: "tag", value: "frontend" }, prerequisites: [], maxRepairIterations: 1,
  rules: [{ id: "frontend.store-test/rule/evidence", description: "Record evidence." }],
  steps: [{ id: "frontend.store-test/step/collect", type: "collect", requiredEvidenceKinds: ["report"], ruleIds: ["frontend.store-test/rule/evidence"] }],
  gates: [
    { id: "frontend.store-test/gate/report", level: "hard", evaluator: { type: "evidence-present", evidenceKind: "report" }, ruleIds: ["frontend.store-test/rule/evidence"] },
    { id: "frontend.store-test/gate/output", level: "hard", evaluator: { type: "schema-valid", schema: "output" }, ruleIds: ["frontend.store-test/rule/evidence"] },
  ],
};

const domainValidatorContract: ExecutionContractV2 = {
  ...contract,
  gates: [...contract.gates, {
    id: "frontend.store-test/gate/domain-validator",
    level: "hard",
    evaluator: { type: "validator", validatorId: "frontend/performance-claims" },
    ruleIds: ["frontend.store-test/rule/evidence"],
  }],
};

const tailwindValidatorContract: ExecutionContractV2 = {
  ...contract,
  steps: [
    ...contract.steps,
    {
      id: "frontend.store-test/step/repair",
      type: "repair",
      requiredEvidenceKinds: ["repair-diff"],
      ruleIds: ["frontend.store-test/rule/evidence"],
      repairable: true,
    },
  ],
  gates: [...contract.gates, {
    id: "frontend.store-test/gate/focus-visible",
    level: "hard",
    evaluator: { type: "validator", validatorId: "frontend/browser-hard-gates" },
    ruleIds: ["frontend.store-test/rule/evidence"],
  }],
};

const criticRepairContract: ExecutionContractV2 = {
  ...contract,
  maxRepairIterations: 1,
  steps: [
    { id: "frontend.store-test/step/critic", type: "critic", requiredEvidenceKinds: ["critic-report"], ruleIds: ["frontend.store-test/rule/evidence"] },
    { id: "frontend.store-test/step/repair", type: "repair", requiredEvidenceKinds: ["repair-diff"], ruleIds: ["frontend.store-test/rule/evidence"], repairable: true },
    { id: "frontend.store-test/step/report", type: "report", requiredEvidenceKinds: ["report"], ruleIds: ["frontend.store-test/rule/evidence"] },
  ],
};

const criticValidatorContract: ExecutionContractV2 = {
  ...criticRepairContract,
  gates: [...criticRepairContract.gates, {
    id: "frontend.store-test/gate/critic-validator",
    level: "hard",
    evaluator: { type: "validator", validatorId: "frontend/performance-claims" },
    ruleIds: ["frontend.store-test/rule/evidence"],
  }],
};

const fixtureRun = (executionContract = contract) => createStrictSkillRun({
  runId: "run_strict_store", domain: "frontend", targetAgent: "codex", locale: "en",
  intent: { sha256: sha("store"), normalizedGoal: "store evidence" }, now: "2026-07-15T10:00:00.000Z",
  selectedSkills: [{
    skillId: executionContract.skillId, role: "primary", mandatory: true, version: "1.0.0",
    packageChecksum: sha("package"), contractChecksum: sha(JSON.stringify(executionContract)), contract: executionContract,
    schemaSnapshots: { input: { type: "object" }, output: { type: "object" } },
    schemaChecksums: { input: sha(JSON.stringify({ type: "object" })), output: sha(JSON.stringify({ type: "object" })) },
    contentChunks: createContentChunks("SKILL.md", "# Store Test\n"), applicable: true, unmetPrerequisites: [],
  }],
});

const stageCompletedEvidence = async (
  root: string,
  store: StrictSkillRunStore,
  executionContract = contract,
) => {
  const source = path.join(root, "report.json");
  await writeFile(source, "{}\n");
  let run = beginStrictStep(
    readNextStrictChunk(fixtureRun(executionContract), executionContract.skillId).run,
    executionContract.skillId,
    executionContract.steps[0].id,
  );
  await store.create(run);
  run = await store.ingestEvidence(run.runId, {
    sourcePath: source,
    kind: "report",
    validatedAs: "output",
    attributions: [{
      skillId: executionContract.skillId,
      stepId: executionContract.steps[0].id,
      attempt: 1,
      relation: "produced",
      ruleIds: executionContract.rules.map(({ id }) => id),
    }],
  });
  return store.update(run.runId, (current) => completeStrictStep(current, executionContract.skillId, executionContract.steps[0].id));
};

const criticReport = (outcome: "clean" | "findings", id: string) => ({
  schemaVersion: "2.0",
  skillId: criticRepairContract.skillId,
  criticInvocationId: `critic-${id}`,
  executorInvocationId: `executor-${id}`,
  outcome,
  findings: outcome === "clean" ? [] : [{
    id: `finding-${id}`,
    ruleId: criticRepairContract.rules[0].id,
    severity: "critical",
    message: "The verified surface is still broken.",
    evidenceArtifactIds: [`evidence-${id}`],
    remediation: "Repair and recapture the surface.",
  }],
});

const completeStoreStep = async (
  root: string,
  store: StrictSkillRunStore,
  run: ReturnType<typeof fixtureRun>,
  stepId: string,
  evidence: Array<{ kind: string; value: unknown; validatedAs?: "output" | "critic-report" }>,
) => {
  run = await store.update(run.runId, (current) => beginStrictStep(current, criticRepairContract.skillId, stepId));
  for (const [index, item] of evidence.entries()) {
    const sourcePath = path.join(root, `${run.revision}-${index}-${item.kind}.json`);
    await writeFile(sourcePath, `${JSON.stringify(item.value)}\n`);
    const step = run.skillLedgers[0].steps.find(({ id }) => id === stepId)!;
    run = await store.ingestEvidence(run.runId, {
      sourcePath,
      kind: item.kind,
      ...(item.validatedAs === undefined ? {} : { validatedAs: item.validatedAs }),
      attributions: [{
        skillId: criticRepairContract.skillId,
        stepId,
        attempt: step.attempts.at(-1)!.attempt,
        relation: "produced",
        ruleIds: step.ruleIds,
      }],
    });
  }
  return store.update(run.runId, (current) => completeStrictStep(current, criticRepairContract.skillId, stepId));
};

const redirectArtifactParentOutsideRoot = async (root: string, run: Awaited<ReturnType<typeof stageCompletedEvidence>>) => {
  const artifactParent = path.dirname(path.join(root, run.artifacts[0].path));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "strict-evidence-outside-"));
  const outsideArtifacts = path.join(outsideRoot, "artifacts");
  await rename(artifactParent, outsideArtifacts);
  await symlink(outsideArtifacts, artifactParent, "dir");
};

const browserObservation = (width: number) => ({
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
});
const browserArtifacts = [390, 768, 1440].map((width) => ({
  kind: `browser-screenshot-${width}`,
  sourcePath: `evidence/${width}.png`,
})) as EvidenceArtifact[];

test("derives browser gates only from closed observations bound to screenshot evidence", () => {
  const observations = [390, 768, 1440].map(browserObservation);
  const valid = deriveBrowserGateResults({ observations }, browserArtifacts);
  assert.equal(Object.keys(valid).length, 7);
  assert.ok(Object.values(valid).every(({ passed }) => passed));

  const forged = deriveBrowserGateResults({ checks: { "required-states-covered": true } }, browserArtifacts);
  assert.ok(Object.values(forged).every(({ passed, message }) => !passed && /valid browser observations/i.test(message ?? "")));

  const unbound = deriveBrowserGateResults({ observations: observations.map((item, index) => index === 0 ? { ...item, screenshotPath: "evidence/unbound.png" } : item) }, browserArtifacts);
  assert.ok(Object.values(unbound).every(({ passed, message }) => !passed && /not bound/i.test(message ?? "")));

  const openShape = deriveBrowserGateResults({ observations: [{ ...observations[0], callerApproved: true }, ...observations.slice(1)] }, browserArtifacts);
  assert.ok(Object.values(openShape).every(({ passed }) => !passed));
});

test("rejects root checks beside otherwise valid browser observations", () => {
  const observations = [390, 768, 1440].map(browserObservation);

  const results = deriveBrowserGateResults({ observations, checks: { "required-states-covered": true } }, browserArtifacts);

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

  const results = deriveBrowserGateResults({ observations }, artifacts);

  assert.ok(Object.values(results).every(({ passed, message }) => !passed && /distinct screenshot/i.test(message ?? "")));
});

test("binds each browser observation viewport to its screenshot artifact kind", () => {
  const observations = [390, 768, 1440].map(browserObservation);
  const mismatched = browserArtifacts.map((artifact, index) => ({
    ...artifact,
    kind: `browser-screenshot-${[768, 390, 1440][index]}`,
  }));

  const results = deriveBrowserGateResults({ observations }, mismatched);

  assert.ok(Object.values(results).every(({ passed, message }) => !passed && /not bound/i.test(message ?? "")));
});

test("fails the accessibility hard gate for a critical axe violation", () => {
  const observations = [390, 768, 1440].map(browserObservation);
  observations[0].criticalAxeViolations = ["button-name"];

  const results = deriveBrowserGateResults({ observations }, browserArtifacts);

  assert.equal(results["focus-visible"].passed, false);
  assert.ok(Object.entries(results)
    .filter(([gate]) => gate !== "focus-visible")
    .every(([, result]) => result.passed));
});

test("derives Tailwind source gates from staged source text instead of checks claims", () => {
  const dynamic = deriveTailwindSourceResults('const checks = { "no-dynamic-tailwind-classes": true }; <div className={`p-4 bg-${color}-600`}>');
  assert.equal(dynamic["no-dynamic-tailwind-classes"].passed, false);

  const staticSource = deriveTailwindSourceResults('+ <div className="bg-brand-600 text-on-brand">Save</div>');
  assert.equal(staticSource["no-dynamic-tailwind-classes"].passed, true);
  assert.equal(staticSource["repeated-class-bundles-reviewed"].passed, true);

  const conflicting = deriveTailwindSourceResults('+ <div className="block flex">Save</div>');
  assert.equal(conflicting["repeated-class-bundles-reviewed"].passed, false);
});

test("detects dynamic Tailwind templates in first and later class positions", () => {
  const first = deriveTailwindSourceResults('<div className={`bg-${color}-600`}>Save</div>');
  const later = deriveTailwindSourceResults('<div className={`p-4 bg-${color}-600`}>Save</div>');

  assert.equal(first["no-dynamic-tailwind-classes"].passed, false);
  assert.equal(later["no-dynamic-tailwind-classes"].passed, false);
});

test("traces dynamic Tailwind templates and concatenation through class variables", () => {
  const template = deriveTailwindSourceResults([
    "const classes = `bg-${color}-600`;",
    "const card = <div className={classes}>Save</div>;",
  ].join("\n"));
  const concatenation = deriveTailwindSourceResults([
    "const classes = \"bg-\" + color + \"-600\";",
    "const card = <div class={classes}>Save</div>;",
  ].join("\n"));

  assert.equal(template["no-dynamic-tailwind-classes"].passed, false);
  assert.equal(concatenation["no-dynamic-tailwind-classes"].passed, false);
});

test("traces a dynamic Tailwind post-declaration assignment before the className sink", () => {
  const results = deriveTailwindSourceResults([
    "let classes;",
    "classes = `bg-${color}-600`;",
    "const card = <div className={classes}>Save</div>;",
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("traces the latest pre-sink assignment through aliases, conditionals, and composition", () => {
  const results = deriveTailwindSourceResults([
    "const generated = `bg-${color}-600`;",
    "let alias;",
    "alias = generated;",
    "let conditional;",
    "conditional = active ? \"bg-brand-500\" : alias;",
    "let classes;",
    "classes = cn(\"p-4\", conditional);",
    "const card = <div className={classes}>Save</div>;",
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("does not resolve assignments after a className sink or from a disjoint scope", () => {
  const afterSink = deriveTailwindSourceResults([
    "let classes = \"bg-brand-500\";",
    "const card = <div className={classes}>Save</div>;",
    "classes = `bg-${color}-600`;",
  ].join("\n"));
  const disjoint = deriveTailwindSourceResults([
    "let classes = \"bg-brand-500\";",
    "if (active) {",
    "  let classes;",
    "  classes = `bg-${color}-600`;",
    "}",
    "const card = <div className={classes}>Save</div>;",
  ].join("\n"));

  assert.equal(afterSink["no-dynamic-tailwind-classes"].passed, true);
  assert.equal(disjoint["no-dynamic-tailwind-classes"].passed, true);
});

test("uses the latest assignment before the className sink", () => {
  const results = deriveTailwindSourceResults([
    "let classes;",
    "classes = `bg-${color}-600`;",
    "classes = \"bg-brand-500\";",
    "const card = <div className={classes}>Save</div>;",
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, true);
});

test("traces a dynamic Tailwind template through a className alias chain", () => {
  const results = deriveTailwindSourceResults([
    "const generated = `bg-${color}-600`;",
    "const alias = generated;",
    "const classes = alias;",
    "const card = <div className={classes}>Save</div>;",
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("traces a dynamic Tailwind template through a className conditional branch", () => {
  const results = deriveTailwindSourceResults([
    "const generated = `bg-${color}-600`;",
    "const classes = active ? \"bg-brand-500\" : generated;",
    "const card = <div className={classes}>Save</div>;",
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("traces dynamic Tailwind variables passed to class composition helpers", () => {
  const results = deriveTailwindSourceResults([
    "const generated = `bg-${color}-600`;",
    "const classes = cn(\"p-4\", generated);",
    "const card = <div className={classes}>Save</div>;",
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("accepts static class variables, aliases, conditionals, and composition arguments", () => {
  const results = deriveTailwindSourceResults([
    "const base = \"bg-brand-500\";",
    "const alias = base;",
    "const conditional = active ? alias : \"bg-brand-600\";",
    "const classes = cn(\"p-4\", conditional);",
    "const card = <div className={classes}>Save</div>;",
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, true);
});

test("resolves same-named static class bindings in disjoint lexical scopes", () => {
  const results = deriveTailwindSourceResults([
    "function PrimaryCard() {",
    "  const classes = \"bg-brand-500\";",
    "  return <div className={classes}>Primary</div>;",
    "}",
    "function SecondaryCard() {",
    "  const classes = \"bg-brand-600\";",
    "  return <div className={classes}>Secondary</div>;",
    "}",
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, true);
});

test("treats function and arrow parameters as lexical class-value shadows", () => {
  const functionParameter = deriveTailwindSourceResults([
    "const classes = `bg-${color}-600`;",
    "function Card(classes) {",
    "  return <div className={classes}>Save</div>;",
    "}",
  ].join("\n"));
  const arrowParameter = deriveTailwindSourceResults([
    "const classes = `bg-${color}-600`;",
    "const Card = (classes) => <div className={classes}>Save</div>;",
  ].join("\n"));

  assert.equal(functionParameter["no-dynamic-tailwind-classes"].passed, true);
  assert.equal(arrowParameter["no-dynamic-tailwind-classes"].passed, true);
});

test("still rejects a dynamic local assignment to a shadowing parameter", () => {
  const results = deriveTailwindSourceResults([
    "const classes = \"bg-brand-500\";",
    "function Card(classes) {",
    "  classes = `bg-${color}-600`;",
    "  return <div className={classes}>Save</div>;",
    "}",
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("traces dynamic defaults on function and arrow parameters", () => {
  const functionDefault = deriveTailwindSourceResults([
    "const classes = \"bg-brand-500\";",
    "function Card(classes = `bg-${color}-600`) {",
    "  return <div className={classes}>Save</div>;",
    "}",
  ].join("\n"));
  const arrowDefault = deriveTailwindSourceResults([
    "const classes = \"bg-brand-500\";",
    "const Card = (classes = `bg-${color}-600`) => <div className={classes}>Save</div>;",
  ].join("\n"));

  assert.equal(functionDefault["no-dynamic-tailwind-classes"].passed, false);
  assert.equal(arrowDefault["no-dynamic-tailwind-classes"].passed, false);
});

test("treats a catch parameter as a lexical class-value shadow", () => {
  const results = deriveTailwindSourceResults([
    "const classes = `bg-${color}-600`;",
    "try { render(); } catch (classes) {",
    "  render(<div className={classes}>Fallback</div>);",
    "}",
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, true);
});

test("treats a simple loop binding as a lexical class-value shadow", () => {
  const results = deriveTailwindSourceResults([
    "const classes = `bg-${color}-600`;",
    "for (const classes of variants) {",
    "  cards.push(<div className={classes}>Variant</div>);",
    "}",
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, true);
});

test("ignores className-like text inside quoted strings", () => {
  const results = deriveTailwindSourceResults([
    "const generated = `bg-${color}-600`;",
    "const example = '<div className={generated}>Example</div>';",
    "const card = <div className=\"bg-brand-500\">Save</div>;",
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, true);
});

test("ignores className-like text inside comments", () => {
  const results = deriveTailwindSourceResults([
    "const generated = `bg-${color}-600`;",
    "// <div className={generated}>Example</div>",
    "/* className={generated} */",
    "const card = <div className=\"bg-brand-500\">Save</div>;",
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, true);
});

test("ignores className and helper references inside regex literals", () => {
  const results = deriveTailwindSourceResults([
    "const generated = `bg-${color}-600`;",
    "const markupPattern = /<div className={generated}>/;",
    "const helperPattern = /cn(generated)/;",
    "const card = <div className=\"bg-brand-500\">Save</div>;",
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, true);
});

test("traces conditional class branches without treating the control as a class value", () => {
  const staticBranches = deriveTailwindSourceResults([
    "const active = `bg-${color}-600`;",
    "const classes = active ? \"bg-brand-500\" : \"bg-brand-600\";",
    "const card = <div className={classes}>Save</div>;",
  ].join("\n"));
  const dynamicBranch = deriveTailwindSourceResults([
    "const active = true;",
    "const generated = `bg-${color}-600`;",
    "const classes = active ? \"bg-brand-500\" : generated;",
    "const card = <div className={classes}>Save</div>;",
  ].join("\n"));

  assert.equal(staticBranches["no-dynamic-tailwind-classes"].passed, true);
  assert.equal(dynamicBranch["no-dynamic-tailwind-classes"].passed, false);
});

test("does not treat unrelated dynamic strings as class values", () => {
  const results = deriveTailwindSourceResults([
    "const analyticsLabel = `bg-${color}-600`;",
    "const card = <div className=\"bg-brand-500\">Save</div>;",
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, true);
});

test("fails closed when class-value aliases form a cycle", () => {
  const results = deriveTailwindSourceResults([
    "const first = second;",
    "const second = first;",
    "const card = <div className={first}>Save</div>;",
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("validates only added content in a unified implementation diff", () => {
  const results = deriveTailwindSourceResults(`diff --git a/Card.tsx b/Card.tsx
--- a/Card.tsx
+++ b/Card.tsx
@@ -1 +1 @@
-<div className={\`p-4 bg-\${color}-600\`}>Save</div>
+<div className="bg-brand-600">Save</div>
`);

  assert.equal(results["no-dynamic-tailwind-classes"].passed, true);
});

test("keeps parsing added diff payload after an increment expression", () => {
  const results = deriveTailwindSourceResults(`diff --git a/Card.tsx b/Card.tsx
--- a/Card.tsx
+++ b/Card.tsx
@@ -0,0 +1,2 @@
+++ counter;
+<div className={\`p-4 bg-\${color}-600\`}>Save</div>
`);

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("falls back to whole-source validation for arbitrary diff marker lines", () => {
  const results = deriveTailwindSourceResults(`diff --git a/Card.tsx b/Card.tsx
--- a/Card.tsx
+++ b/Card.tsx
@@ -1 +1 @@
-<div className={\`bg-\${color}-600\`}>Save</div>
\\ arbitrary marker
+<div className="bg-brand-600">Save</div>
`);

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("rejects a no-newline marker before its affected diff side is exhausted", () => {
  const results = deriveTailwindSourceResults(`diff --git a/Card.tsx b/Card.tsx
--- a/Card.tsx
+++ b/Card.tsx
@@ -1,2 +1 @@
-<div className={\`bg-\${color}-600\`}>Save</div>
\\ No newline at end of file
-<span>Old</span>
+<div className="bg-brand-600">Save</div>
`);

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("accepts quoted Git and space-containing unified diff paths", () => {
  const quotedGit = deriveTailwindSourceResults(`diff --git "a/components/My Card.tsx" "b/components/My Card.tsx"
--- "a/components/My Card.tsx"
+++ "b/components/My Card.tsx"
@@ -1 +1 @@
-<div className={\`bg-\${color}-600\`}>Save</div>
+<div className="bg-brand-600">Save</div>
`);
  const standardUnified = deriveTailwindSourceResults(`--- old/components/My Card.tsx\t2026-07-15
+++ new/components/My Card.tsx\t2026-07-15
@@ -1 +1 @@
-<div className={\`bg-\${color}-600\`}>Save</div>
+<div className="bg-brand-600">Save</div>
`);

  assert.equal(quotedGit["no-dynamic-tailwind-classes"].passed, true);
  assert.equal(standardUnified["no-dynamic-tailwind-classes"].passed, true);
});

test("falls back to whole-source validation for diff-like ordinary source", () => {
  const results = deriveTailwindSourceResults(`/*
--- a/Card.tsx
+++ b/Card.tsx
@@ -1 +1 @@
*/
const card = <div className={\`p-4 bg-\${color}-600\`}>Save</div>;
`);

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("derives the raw color advisory from staged source text", () => {
  const results = deriveTailwindSourceResults('<div className="bg-red-500">Save</div>');

  assert.equal(results["raw-colors-reviewed"].passed, false);
});

test("detects dynamic Tailwind construction inside class composition calls", () => {
  const results = deriveTailwindSourceResults('const classes = cn("p-4", `bg-${color}-600`);');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("detects dynamic Tailwind concatenation inside class composition calls", () => {
  const results = deriveTailwindSourceResults('const classes = cn("bg-" + color + "-500");');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("detects dynamic Tailwind construction after a variant prefix", () => {
  const results = deriveTailwindSourceResults('<div className={`hover:bg-${color}-600`}>Save</div>');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("accepts conditional interpolation of complete static Tailwind tokens", () => {
  const results = deriveTailwindSourceResults('<div className={`${active ? "bg-red-500" : "bg-blue-500"}`}>Save</div>');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, true);
});

test("rejects a whole-token dynamic Tailwind variable interpolation", () => {
  const results = deriveTailwindSourceResults('<div className={`${computedClass}`}>Save</div>');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("rejects a whole-token dynamic Tailwind call interpolation", () => {
  const results = deriveTailwindSourceResults('<div className={`${getClass()}`}>Save</div>');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("keeps a class expression range open across regex closing braces", () => {
  const results = deriveTailwindSourceResults('<div className={/\\}/.test(color) ? `${computedClass}` : "bg-brand-500"}>Save</div>');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("keeps class range open for regex after an if statement head", () => {
  const results = deriveTailwindSourceResults('<div className={(() => { if (x) /\\}/.test(y); return "bg-brand-500"; })() ? `${computedClass}` : "bg-brand-500"} />');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("keeps class range open for regex after a while statement head", () => {
  const results = deriveTailwindSourceResults('<div className={(() => { while (x) /\\}/.test(y); return "bg-brand-500"; })() ? `${computedClass}` : "bg-brand-500"} />');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("keeps class range open for regex after else", () => {
  const results = deriveTailwindSourceResults('<div className={(() => { if (x) y(); else /\\}/.test(y); return "bg-brand-500"; })() ? `${computedClass}` : "bg-brand-500"} />');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("keeps ordinary division expressions out of regex-literal handling", () => {
  const results = deriveTailwindSourceResults('<div className={(() => { const ratio = total / count / scale; return ratio ? "bg-brand-500" : "bg-brand-600"; })()} />');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, true);
});

test("keeps division after a postfix increment out of regex-literal handling", () => {
  const results = deriveTailwindSourceResults('<div className={(() => { let counter = 1; counter++ / count; return "bg-brand-500"; })()} />');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, true);
});

test("keeps division after a postfix decrement out of regex-literal handling", () => {
  const results = deriveTailwindSourceResults('<div className={(() => { let counter = 1; counter-- / count; return "bg-brand-500"; })()} />');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, true);
});

test("rejects conditional interpolation of Tailwind token fragments", () => {
  const results = deriveTailwindSourceResults('<div className={`bg-${active ? "red" : "blue"}-500`}>Save</div>');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("parses balanced braces in dynamic Tailwind interpolation expressions", () => {
  const results = deriveTailwindSourceResults('<div className={`bg-${({ color }).color}-500`}>Save</div>');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("does not fail open on regex literals inside dynamic Tailwind interpolation", () => {
  const results = deriveTailwindSourceResults('<div className={`bg-${/\\{/.test(color) ? "red" : "blue"}-500`}>Save</div>');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("fails closed for an unparseable multiline class template", () => {
  const results = deriveTailwindSourceResults([
    '<div className={',
    '  `bg-${(() => { return /\\{/.test(color) ? "red" : "blue"; })()}-500`',
    '}></div>',
  ].join("\n"));

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("ignores dynamic-looking templates outside class expressions", () => {
  const results = deriveTailwindSourceResults('const cacheKey = `bg-${color}-600`; const message = `text-${status}-500`;');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, true);
});

test("rejects the same dynamic templates inside class composition", () => {
  const results = deriveTailwindSourceResults('const classes = cn(`bg-${color}-600`, `text-${status}-500`);');

  assert.equal(results["no-dynamic-tailwind-classes"].passed, false);
});

test("strict store writes atomically and rejects a tampered persisted content snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-store-"));
  const store = new StrictSkillRunStore(root);
  const run = fixtureRun();
  await store.create(run);
  assert.deepEqual(await store.read(run.runId), run);

  const runPath = path.join(root, ".skillranger", "runs", `${run.runId}.json`);
  const tampered = JSON.parse(await readFile(runPath, "utf8"));
  tampered.skillLedgers[0].contentChunks[0].content = "mutated";
  await writeFile(runPath, `${JSON.stringify(tampered)}\n`);
  await assert.rejects(store.read(run.runId), (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity");
});

test("does not reclaim an old strict lock owned by a live process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-live-lock-"));
  const store = new StrictSkillRunStore(root);
  const run = fixtureRun();
  await store.create(run);
  const lockPath = path.join(root, ".skillranger", "runs", `${run.runId}.lock`);
  await writeFile(lockPath, JSON.stringify({ token: "live-owner", pid: process.pid }));
  const old = new Date(Date.now() - 31_000);
  await utimes(lockPath, old, old);

  let entered = false;
  const pending = store.update(run.runId, (current) => {
    entered = true;
    return readNextStrictChunk(current, contract.skillId).run;
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(entered, false);
  await unlink(lockPath);
  await pending;
  assert.equal(entered, true);
});

test("reclaims an old strict lock owned by a dead process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-dead-lock-"));
  const store = new StrictSkillRunStore(root);
  const run = fixtureRun();
  await store.create(run);
  const lockPath = path.join(root, ".skillranger", "runs", `${run.runId}.lock`);
  await writeFile(lockPath, JSON.stringify({ token: "dead-owner", pid: 999_999 }));
  const old = new Date(Date.now() - 31_000);
  await utimes(lockPath, old, old);

  const updated = await store.update(run.runId, (current) => readNextStrictChunk(current, contract.skillId).run);

  assert.equal(updated.revision, 1);
  await assert.rejects(readFile(lockPath, "utf8"), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "ENOENT"
  ));
});

test("serializes concurrent strict chunk updates without losing either receipt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-concurrent-lock-"));
  const store = new StrictSkillRunStore(root);
  const run = fixtureRun();
  run.skillLedgers[0].contentChunks = createContentChunks("SKILL.md", "a\nb\n", 2);
  await store.create(run);

  const updates = await Promise.all([
    store.update(run.runId, (current) => readNextStrictChunk(current, contract.skillId).run),
    store.update(run.runId, (current) => readNextStrictChunk(current, contract.skillId).run),
  ]);

  const persisted = await store.read(run.runId);
  assert.deepEqual(new Set(updates.map(({ revision }) => revision)), new Set([1, 2]));
  assert.deepEqual(persisted.skillLedgers[0].readReceipts.map(({ ordinal }) => ordinal), [0, 1]);
  assert.equal(persisted.revision, run.revision + 2);
});

test("rejects a persisted used outcome without completed steps and verification", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-forged-used-"));
  const store = new StrictSkillRunStore(root);
  const run = fixtureRun();
  await store.create(run);

  const runPath = path.join(root, ".skillranger", "runs", `${run.runId}.json`);
  const forged = JSON.parse(await readFile(runPath, "utf8"));
  forged.skillLedgers[0].state = "used";
  forged.skillLedgers[0].outcome = "used";
  await writeFile(runPath, `${JSON.stringify(forged)}\n`);

  await assert.rejects(
    store.read(run.runId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
  );
});

test("ingests immutable evidence and binds it to the active step", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-evidence-"));
  const source = path.join(root, "reports", "report.json");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, "{}\n");
  const store = new StrictSkillRunStore(root);
  let run = fixtureRun();
  run = readNextStrictChunk(run, contract.skillId).run;
  run = beginStrictStep(run, contract.skillId, contract.steps[0].id);
  await store.create(run);

  run = await store.ingestEvidence(run.runId, {
    sourcePath: source,
    kind: "report",
    validatedAs: "output",
    attributions: [{ skillId: contract.skillId, stepId: contract.steps[0].id, attempt: 1, relation: "produced", ruleIds: contract.rules.map(({ id }) => id) }],
  });
  const artifact = run.artifacts[0];
  assert.equal(artifact.sha256, sha("{}\n"));
  await writeFile(source, "mutated source\n");
  assert.equal(await readFile(path.join(root, artifact.path), "utf8"), "{}\n");
});

test("rejects evidence whose parent symlink escapes the project root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-evidence-parent-link-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "strict-evidence-outside-"));
  const linkedParent = path.join(root, "linked-reports");
  const source = path.join(linkedParent, "report.json");
  await writeFile(path.join(outside, "report.json"), "{}\n");
  await symlink(outside, linkedParent);
  const store = new StrictSkillRunStore(root);
  let run = beginStrictStep(
    readNextStrictChunk(fixtureRun(), contract.skillId).run,
    contract.skillId,
    contract.steps[0].id,
  );
  await store.create(run);

  await assert.rejects(store.ingestEvidence(run.runId, {
    sourcePath: source,
    kind: "report",
    attributions: [{
      skillId: contract.skillId,
      stepId: contract.steps[0].id,
      attempt: 1,
      relation: "produced",
      ruleIds: contract.rules.map(({ id }) => id),
    }],
  }), (error: unknown) => error instanceof StrictSkillRunError && error.code === "artifact-integrity");
});

test("rejects ingestion when the opened source pathname is replaced during the read", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-evidence-inode-race-"));
  const source = path.join(root, "report.json");
  await writeFile(source, "{}\n");
  const store = new StrictSkillRunStore(root);
  const run = beginStrictStep(
    readNextStrictChunk(fixtureRun(), contract.skillId).run,
    contract.skillId,
    contract.steps[0].id,
  );
  await store.create(run);
  internalContainedFileReadHooks.ingestion = async (target) => {
    assert.equal(target, source);
    await rename(target, `${target}.opened`);
    await writeFile(target, "{}\n");
  };

  try {
    await assert.rejects(store.ingestEvidence(run.runId, {
      sourcePath: source,
      kind: "report",
      attributions: [{
        skillId: contract.skillId,
        stepId: contract.steps[0].id,
        attempt: 1,
        relation: "produced",
        ruleIds: contract.rules.map(({ id }) => id),
      }],
    }), (error: unknown) => error instanceof StrictSkillRunError && error.code === "artifact-integrity");
  } finally {
    delete internalContainedFileReadHooks.ingestion;
  }
});

test("retains a shared evidence blob when one concurrent update fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-evidence-shared-digest-"));
  const firstSource = path.join(root, "first.json");
  const secondSource = path.join(root, "second.json");
  await writeFile(firstSource, "{}\n");
  await writeFile(secondSource, "{}\n");
  let firstUpdateReachedResolve!: () => void;
  let secondUpdateFinishedResolve!: () => void;
  const firstUpdateReached = new Promise<void>((resolve) => { firstUpdateReachedResolve = resolve; });
  const secondUpdateFinished = new Promise<void>((resolve) => { secondUpdateFinishedResolve = resolve; });

  class CoordinatedStrictStore extends StrictSkillRunStore {
    private updateCalls = 0;

    override async update(
      runId: string,
      apply: (run: SkillRunV2) => SkillRunV2 | Promise<SkillRunV2>,
    ) {
      const call = ++this.updateCalls;
      if (call === 1) {
        firstUpdateReachedResolve();
        await secondUpdateFinished;
        throw new StrictSkillRunError("run-integrity", "Injected first update failure.");
      }
      try {
        return await super.update(runId, apply);
      } finally {
        secondUpdateFinishedResolve();
      }
    }
  }

  const store = new CoordinatedStrictStore(root);
  const run = beginStrictStep(
    readNextStrictChunk(fixtureRun(), contract.skillId).run,
    contract.skillId,
    contract.steps[0].id,
  );
  await store.create(run);
  const input = (sourcePath: string) => ({
    sourcePath,
    kind: "report",
    attributions: [{
      skillId: contract.skillId,
      stepId: contract.steps[0].id,
      attempt: 1,
      relation: "produced" as const,
      ruleIds: contract.rules.map(({ id }) => id),
    }],
  });

  const first = store.ingestEvidence(run.runId, input(firstSource));
  await firstUpdateReached;
  const second = store.ingestEvidence(run.runId, input(secondSource));
  const [firstResult, secondResult] = await Promise.allSettled([first, second]);

  assert.equal(firstResult.status, "rejected");
  assert.equal(secondResult.status, "fulfilled");
  const persisted = await store.read(run.runId);
  assert.equal(persisted.artifacts.length, 1);
  const artifact = persisted.artifacts[0];
  assert.equal(await readFile(path.join(root, artifact.path), "utf8"), "{}\n");
  const derivation = await deriveStrictValidatorResults(root, persisted, persisted.skillLedgers[0]);
  assert.equal(derivation.artifactIntegrity.passed, true);
});

test("rejects evidence falsely declared as schema-validated", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-evidence-schema-"));
  const source = path.join(root, "invalid.json");
  await writeFile(source, "not json\n");
  const store = new StrictSkillRunStore(root);
  let run = fixtureRun();
  run = beginStrictStep(readNextStrictChunk(run, contract.skillId).run, contract.skillId, contract.steps[0].id);
  await store.create(run);
  await assert.rejects(store.ingestEvidence(run.runId, {
    sourcePath: source, kind: "report", validatedAs: "output",
    attributions: [{ skillId: contract.skillId, stepId: contract.steps[0].id, attempt: 1, relation: "produced", ruleIds: contract.rules.map(({ id }) => id) }],
  }), (error: unknown) => error instanceof StrictSkillRunError && error.code === "artifact-integrity");
});

test("derives verification gates inside the runtime from immutable artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-verify-runtime-"));
  const source = path.join(root, "report.json");
  await writeFile(source, "{}\n");
  const store = new StrictSkillRunStore(root);
  let run = beginStrictStep(readNextStrictChunk(fixtureRun(), contract.skillId).run, contract.skillId, contract.steps[0].id);
  await store.create(run);
  run = await store.ingestEvidence(run.runId, {
    sourcePath: source, kind: "report", validatedAs: "output",
    attributions: [{ skillId: contract.skillId, stepId: contract.steps[0].id, attempt: 1, relation: "produced", ruleIds: contract.rules.map(({ id }) => id) }],
  });
  run = await store.update(run.runId, (current) => completeStrictStep(current, contract.skillId, contract.steps[0].id));
  run = await store.verifySkill(run.runId, contract.skillId);
  assert.equal(run.skillLedgers[0].outcome, "used");
  assert.equal(run.skillLedgers[0].verificationReports[0].hardPassed, true);
});

test("honest store verification and store-owned finalization persist a verified run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-finalize-honest-"));
  const store = new StrictSkillRunStore(root);
  const verified = await store.verifySkill((await stageCompletedEvidence(root, store)).runId, contract.skillId);

  const finalized = await store.finalizeRun(verified.runId);

  assert.equal(finalized.state, "verified");
  assert.deepEqual(await store.read(finalized.runId), finalized);
});

test("generic store updates cannot persist a caller-constructed verified state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-finalize-authority-"));
  const store = new StrictSkillRunStore(root);
  const verified = await store.verifySkill((await stageCompletedEvidence(root, store)).runId, contract.skillId);

  await assert.rejects(
    store.update(verified.runId, (current) => ({
      ...current,
      state: "verified",
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    })),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
  );
  assert.equal((await store.read(verified.runId)).state, "verifying");
});

test("store finalization rejects a used report whose artifact disappeared after verification", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-finalize-missing-"));
  const store = new StrictSkillRunStore(root);
  const verified = await store.verifySkill((await stageCompletedEvidence(root, store)).runId, contract.skillId);
  await unlink(path.join(root, verified.artifacts[0].path));

  await assert.rejects(
    store.finalizeRun(verified.runId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "artifact-integrity",
  );
});

test("store finalization rejects a structurally valid forged passing report for a runtime-failing gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-finalize-forged-gate-"));
  const store = new StrictSkillRunStore(root);
  const prepared = await stageCompletedEvidence(root, store, tailwindValidatorContract);
  const forged = structuredClone(prepared);
  const ledger = forged.skillLedgers[0];
  ledger.verificationReports.push({
    schemaVersion: "2.0",
    skillId: ledger.skillId,
    iteration: 0,
    generatedAt: new Date().toISOString(),
    gateResults: ledger.contract.gates.map((gate) => ({ gateId: gate.id, passed: true, level: gate.level })),
    hardPassed: true,
    evidenceIds: ledger.steps.flatMap((step) => step.attempts.at(-1)?.evidenceIds ?? []),
  });
  ledger.state = "used";
  ledger.outcome = "used";
  forged.state = "verifying";
  assert.doesNotThrow(() => assertValidStrictSkillRun(forged));
  await writeFile(path.join(root, ".skillranger", "runs", `${forged.runId}.json`), `${JSON.stringify(forged)}\n`);

  await assert.rejects(
    store.finalizeRun(forged.runId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
  );
});

test("caller constructor callbacks cannot make a failing Tailwind gate pass", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-tailwind-authority-"));
  const StoreWithLegacyCallback = StrictSkillRunStore as unknown as new (
    projectRoot: string,
    callbacks: Record<string, () => { passed: boolean }>,
  ) => StrictSkillRunStore;
  const store = new StoreWithLegacyCallback(root, {
    "frontend/browser-hard-gates": () => ({ passed: true }),
  });
  const run = await stageCompletedEvidence(root, store, tailwindValidatorContract);

  const verified = await store.verifySkill(run.runId, tailwindValidatorContract.skillId);

  assert.equal(verified.state, "repair-required");
  assert.equal(verified.skillLedgers[0].verificationReports[0].gateResults
    .find(({ gateId }) => gateId.endsWith("/focus-visible"))?.passed, false);
});

test("strict store reload rejects parseable non-RFC3339 and impossible persisted timestamps", async (t) => {
  const timestamps = [
    "March 1, 2026 12:00:00 GMT",
    "2026-02-30T12:00:00Z",
    "2026-07-16T08:00:59.1234+04:00",
  ];
  const targets = [
    (run: SkillRunV2, value: string) => { run.createdAt = value; },
    (run: SkillRunV2, value: string) => { run.updatedAt = value; },
    (run: SkillRunV2, value: string) => { run.skillLedgers[0].readReceipts[0].deliveredAt = value; },
    (run: SkillRunV2, value: string) => { run.skillLedgers[0].steps[0].attempts[0].startedAt = value; },
    (run: SkillRunV2, value: string) => { run.skillLedgers[0].steps[0].attempts[0].completedAt = value; },
    (run: SkillRunV2, value: string) => { run.skillLedgers[0].verificationReports[0].generatedAt = value; },
  ];
  for (const [timestampIndex, timestamp] of timestamps.entries()) {
    assert.ok(Number.isFinite(Date.parse(timestamp)), timestamp);
    for (const [targetIndex, mutate] of targets.entries()) {
      await t.test(`${timestamp} target ${targetIndex}`, async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), `strict-timestamp-${timestampIndex}-${targetIndex}-`));
        const store = new StrictSkillRunStore(root);
        const verified = await store.verifySkill(
          (await stageCompletedEvidence(root, store)).runId,
          contract.skillId,
        );
        const runPath = path.join(root, ".skillranger", "runs", `${verified.runId}.json`);
        const forged = JSON.parse(await readFile(runPath, "utf8")) as SkillRunV2;
        mutate(forged, timestamp);
        await writeFile(runPath, `${JSON.stringify(forged)}\n`);

        await assert.rejects(
          store.read(verified.runId),
          (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
        );
      });
    }
  }
});

test("strict store reload preserves no-fraction and 1-3 digit fractional RFC3339 offsets", async () => {
  const timestamps = [
    "2026-07-16T08:00:59+04:00",
    "2026-07-16T08:00:59.1+04:00",
    "2026-07-16T08:00:59.12+04:00",
    "2026-07-16T08:00:59.123+04:00",
  ];
  for (const [index, timestamp] of timestamps.entries()) {
    const root = await mkdtemp(path.join(os.tmpdir(), `strict-timestamp-valid-${index}-`));
    const store = new StrictSkillRunStore(root);
    const verified = await store.verifySkill(
      (await stageCompletedEvidence(root, store)).runId,
      contract.skillId,
    );
    const runPath = path.join(root, ".skillranger", "runs", `${verified.runId}.json`);
    const persisted = JSON.parse(await readFile(runPath, "utf8")) as SkillRunV2;
    persisted.createdAt = timestamp;
    persisted.updatedAt = timestamp;
    persisted.skillLedgers[0].readReceipts[0].deliveredAt = timestamp;
    persisted.skillLedgers[0].steps[0].attempts[0].startedAt = timestamp;
    persisted.skillLedgers[0].steps[0].attempts[0].completedAt = timestamp;
    persisted.skillLedgers[0].verificationReports[0].generatedAt = timestamp;
    await writeFile(runPath, `${JSON.stringify(persisted)}\n`);

    assert.deepEqual(await store.read(verified.runId), persisted);
  }
});

test("strict store reload rejects reversed root and completed-attempt chronology", async (t) => {
  const mutations = [
    (run: SkillRunV2) => {
      run.createdAt = "2026-07-16T08:00:00.001Z";
      run.updatedAt = "2026-07-16T08:00:00.000Z";
    },
    (run: SkillRunV2) => {
      run.skillLedgers[0].steps[0].attempts[0].startedAt = "2026-07-16T08:00:00.001+04:00";
      run.skillLedgers[0].steps[0].attempts[0].completedAt = "2026-07-16T08:00:00.000+04:00";
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    await t.test(`chronology target ${index}`, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), `strict-chronology-${index}-`));
      const store = new StrictSkillRunStore(root);
      const verified = await store.verifySkill(
        (await stageCompletedEvidence(root, store)).runId,
        contract.skillId,
      );
      const runPath = path.join(root, ".skillranger", "runs", `${verified.runId}.json`);
      const forged = JSON.parse(await readFile(runPath, "utf8")) as SkillRunV2;
      mutate(forged);
      await writeFile(runPath, `${JSON.stringify(forged)}\n`);

      await assert.rejects(
        store.read(verified.runId),
        (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
      );
    });
  }
});

test("strict store reload rejects duplicate evidence ids inside one attempt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-attempt-duplicate-evidence-"));
  const store = new StrictSkillRunStore(root);
  const completed = await stageCompletedEvidence(root, store);
  const runPath = path.join(root, ".skillranger", "runs", `${completed.runId}.json`);
  const forged = JSON.parse(await readFile(runPath, "utf8")) as SkillRunV2;
  const evidenceIds = forged.skillLedgers[0].steps[0].attempts[0].evidenceIds;
  evidenceIds.push(evidenceIds[0]);
  await writeFile(runPath, `${JSON.stringify(forged)}\n`);

  await assert.rejects(
    store.read(completed.runId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
  );
});

test("strict store reload rejects leap seconds outside the runtime date-time subset", async () => {
  const timestamps = [
    "2026-07-16T08:00:60Z",
    "2016-12-31T23:59:60Z",
  ];
  const targets = [
    (run: SkillRunV2, value: string) => { run.skillLedgers[0].steps[0].attempts[0].startedAt = value; },
    (run: SkillRunV2, value: string) => { run.skillLedgers[0].steps[0].attempts[0].completedAt = value; },
    (run: SkillRunV2, value: string) => { run.skillLedgers[0].verificationReports[0].generatedAt = value; },
  ];
  for (const [timestampIndex, timestamp] of timestamps.entries()) {
    for (const [targetIndex, mutate] of targets.entries()) {
      const root = await mkdtemp(path.join(os.tmpdir(), `strict-leap-second-${timestampIndex}-${targetIndex}-`));
      const store = new StrictSkillRunStore(root);
      const verified = await store.verifySkill(
        (await stageCompletedEvidence(root, store)).runId,
        contract.skillId,
      );
      const runPath = path.join(root, ".skillranger", "runs", `${verified.runId}.json`);
      const forged = JSON.parse(await readFile(runPath, "utf8")) as SkillRunV2;
      mutate(forged, timestamp);
      await writeFile(runPath, `${JSON.stringify(forged)}\n`);

      await assert.rejects(
        store.read(verified.runId),
        (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
        `${timestamp} target ${targetIndex}`,
      );
    }
  }
});

test("a findings report produced after completed repair consumes the exhausted budget", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-critic-causal-"));
  const store = new StrictSkillRunStore(root);
  let run = readNextStrictChunk(fixtureRun(criticRepairContract), criticRepairContract.skillId).run;
  await store.create(run);
  run = await completeStoreStep(root, store, run, criticRepairContract.steps[0].id, [{
    kind: "critic-report",
    value: criticReport("findings", "initial"),
    validatedAs: "critic-report",
  }]);
  run = await completeStoreStep(root, store, run, criticRepairContract.steps[2].id, [{
    kind: "report",
    value: {},
    validatedAs: "output",
  }]);
  run = await store.verifySkill(run.runId, criticRepairContract.skillId);
  assert.equal(run.state, "repair-required");

  run = await completeStoreStep(root, store, run, criticRepairContract.steps[1].id, [{
    kind: "repair-diff",
    value: { repaired: true },
  }]);
  run = await completeStoreStep(root, store, run, criticRepairContract.steps[2].id, [
    { kind: "report", value: { repaired: true }, validatedAs: "output" },
    { kind: "critic-report", value: criticReport("findings", "after-repair"), validatedAs: "critic-report" },
  ]);
  run = await store.verifySkill(run.runId, criticRepairContract.skillId);

  const ledger = run.skillLedgers[0];
  assert.equal(run.state, "blocked");
  assert.equal(ledger.outcome, "blocked");
  assert.equal(ledger.repairIterations, 1);
  assert.equal(ledger.verificationReports.at(-1)!.gateResults.find(({ gateId }) => gateId === "core/gate/critic-findings")?.passed, false);
});

test("submillisecond timestamps are rejected before critic causality can collapse ordering", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-critic-timestamps-"));
  const store = new StrictSkillRunStore(root);
  let run = readNextStrictChunk(fixtureRun(criticRepairContract), criticRepairContract.skillId).run;
  await store.create(run);
  run = await completeStoreStep(root, store, run, criticRepairContract.steps[0].id, [{
    kind: "critic-report",
    value: criticReport("findings", "timestamp"),
    validatedAs: "critic-report",
  }]);
  run = await completeStoreStep(root, store, run, criticRepairContract.steps[2].id, [{
    kind: "report",
    value: {},
    validatedAs: "output",
  }]);
  run = await store.verifySkill(run.runId, criticRepairContract.skillId);
  run = await completeStoreStep(root, store, run, criticRepairContract.steps[1].id, [{
    kind: "repair-diff",
    value: { repaired: true },
  }]);
  run = await completeStoreStep(root, store, run, criticRepairContract.steps[2].id, [{
    kind: "report",
    value: { repaired: true },
    validatedAs: "output",
  }]);

  const runPath = path.join(root, ".skillranger", "runs", `${run.runId}.json`);
  const forged = JSON.parse(await readFile(runPath, "utf8"));
  const sourceReport = forged.skillLedgers[0].verificationReports[0];
  const repairAttempt = forged.skillLedgers[0].steps[1].attempts[0];
  sourceReport.generatedAt = "2026-07-16T08:00:00.1234Z";
  repairAttempt.startedAt = "2026-07-16T08:00:00.1235Z";
  repairAttempt.completedAt = "2026-07-16T08:00:00.1235Z";
  assert.equal(Date.parse(sourceReport.generatedAt), Date.parse(repairAttempt.startedAt));
  await writeFile(runPath, `${JSON.stringify(forged)}\n`);
  await assert.rejects(
    store.verifySkill(run.runId, criticRepairContract.skillId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
  );
});

test("a clean critic report cannot hide findings from the same current attempt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-critic-duplicate-"));
  const store = new StrictSkillRunStore(root);
  let run = readNextStrictChunk(fixtureRun(criticRepairContract), criticRepairContract.skillId).run;
  await store.create(run);
  run = await completeStoreStep(root, store, run, criticRepairContract.steps[0].id, [
    { kind: "critic-report", value: criticReport("findings", "duplicate"), validatedAs: "critic-report" },
    { kind: "critic-report", value: criticReport("clean", "duplicate-clean"), validatedAs: "critic-report" },
  ]);
  run = await completeStoreStep(root, store, run, criticRepairContract.steps[2].id, [{
    kind: "report",
    value: {},
    validatedAs: "output",
  }]);
  run = await store.verifySkill(run.runId, criticRepairContract.skillId);

  assert.equal(run.state, "repair-required");
  assert.equal(run.skillLedgers[0].verificationReports[0].gateResults.find(({ gateId }) => gateId === "core/gate/critic-findings")?.passed, false);
});

test("a clean critic report from another current step cannot hide findings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-critic-multi-source-"));
  const store = new StrictSkillRunStore(root);
  let run = readNextStrictChunk(fixtureRun(criticRepairContract), criticRepairContract.skillId).run;
  await store.create(run);
  run = await completeStoreStep(root, store, run, criticRepairContract.steps[0].id, [{
    kind: "critic-report",
    value: criticReport("findings", "critic-step"),
    validatedAs: "critic-report",
  }]);
  run = await completeStoreStep(root, store, run, criticRepairContract.steps[2].id, [
    { kind: "report", value: {}, validatedAs: "output" },
    { kind: "critic-report", value: criticReport("clean", "report-step"), validatedAs: "critic-report" },
  ]);
  run = await store.verifySkill(run.runId, criticRepairContract.skillId);

  assert.equal(run.state, "repair-required");
  assert.equal(run.skillLedgers[0].verificationReports[0].gateResults.find(({ gateId }) => gateId === "core/gate/critic-findings")?.passed, false);
});

test("validator observation exposes the canonical critic-step report without result authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-critic-canonical-"));
  const store = new StrictSkillRunStore(root);
  let run = readNextStrictChunk(fixtureRun(criticValidatorContract), criticValidatorContract.skillId).run;
  await store.create(run);
  run = await completeStoreStep(root, store, run, criticValidatorContract.steps[0].id, [{
    kind: "critic-report",
    value: criticReport("findings", "canonical"),
    validatedAs: "critic-report",
  }]);
  run = await completeStoreStep(root, store, run, criticValidatorContract.steps[2].id, [
    { kind: "report", value: {}, validatedAs: "output" },
    { kind: "critic-report", value: criticReport("clean", "non-canonical"), validatedAs: "critic-report" },
  ]);
  let observedCriticReport: unknown;
  const derivation = await deriveStrictValidatorResults(root, run, run.skillLedgers[0], ({ gateId, evidence }) => {
    if (gateId === "frontend.store-test/gate/critic-validator") observedCriticReport = evidence.criticReport;
  });
  assert.equal(
    typeof observedCriticReport === "object"
      && observedCriticReport !== null
      && "outcome" in observedCriticReport
      && observedCriticReport.outcome,
    "findings",
  );
  assert.equal(derivation.validatorResults["frontend.store-test/gate/critic-validator"].passed, false);

  run = await store.verifySkill(run.runId, criticValidatorContract.skillId);

  const gates = run.skillLedgers[0].verificationReports[0].gateResults;
  assert.equal(gates.find(({ gateId }) => gateId === "frontend.store-test/gate/critic-validator")?.passed, false);
  assert.equal(gates.find(({ gateId }) => gateId === "core/gate/critic-findings")?.passed, false);
});

test("rejects a persisted used report with critic evidence and its system gate deleted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-critic-report-forgery-"));
  const store = new StrictSkillRunStore(root);
  let run = readNextStrictChunk(fixtureRun(criticRepairContract), criticRepairContract.skillId).run;
  await store.create(run);
  run = await completeStoreStep(root, store, run, criticRepairContract.steps[0].id, [{
    kind: "critic-report",
    value: criticReport("clean", "persisted"),
    validatedAs: "critic-report",
  }]);
  run = await completeStoreStep(root, store, run, criticRepairContract.steps[2].id, [{
    kind: "report",
    value: {},
    validatedAs: "output",
  }]);
  run = await store.verifySkill(run.runId, criticRepairContract.skillId);
  assert.equal(run.skillLedgers[0].outcome, "used");

  const runPath = path.join(root, ".skillranger", "runs", `${run.runId}.json`);
  const forged = JSON.parse(await readFile(runPath, "utf8"));
  const ledger = forged.skillLedgers[0];
  const report = ledger.verificationReports.at(-1);
  const criticArtifactIds = new Set(forged.artifacts
    .filter((artifact: EvidenceArtifact) => artifact.validatedAs === "critic-report")
    .map((artifact: EvidenceArtifact) => artifact.artifactId));
  report.evidenceIds = report.evidenceIds.filter((id: string) => !criticArtifactIds.has(id));
  report.gateResults = report.gateResults.filter(({ gateId }: { gateId: string }) => gateId !== "core/gate/critic-findings");
  report.hardPassed = true;
  await writeFile(runPath, `${JSON.stringify(forged)}\n`);

  await assert.rejects(
    store.read(run.runId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
  );
});

test("rejects changed evidence even when the contract omits an integrity gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-evidence-mutated-"));
  const source = path.join(root, "report.json");
  await writeFile(source, "{}\n");
  const store = new StrictSkillRunStore(root);
  let run = beginStrictStep(readNextStrictChunk(fixtureRun(), contract.skillId).run, contract.skillId, contract.steps[0].id);
  await store.create(run);
  run = await store.ingestEvidence(run.runId, {
    sourcePath: source,
    kind: "report",
    validatedAs: "output",
    attributions: [{ skillId: contract.skillId, stepId: contract.steps[0].id, attempt: 1, relation: "produced", ruleIds: contract.rules.map(({ id }) => id) }],
  });
  await writeFile(path.join(root, run.artifacts[0].path), "changed\n");
  run = await store.update(run.runId, (current) => completeStrictStep(current, contract.skillId, contract.steps[0].id));

  await assert.rejects(
    store.verifySkill(run.runId, contract.skillId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "artifact-integrity",
  );
});

test("fails verification when an artifact pathname is replaced during the read", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-verify-inode-race-"));
  const store = new StrictSkillRunStore(root);
  const run = await stageCompletedEvidence(root, store);
  const artifactPath = path.join(root, run.artifacts[0].path);
  const artifactBytes = await readFile(artifactPath);
  internalContainedFileReadHooks.verification = async (target) => {
    assert.equal(target, artifactPath);
    await rename(target, `${target}.opened`);
    await writeFile(target, artifactBytes);
  };

  try {
    const derivation = await deriveStrictValidatorResults(root, run, run.skillLedgers[0]);
    assert.equal(derivation.artifactIntegrity.passed, false);
  } finally {
    delete internalContainedFileReadHooks.verification;
  }
});

test("observes a built-in domain validator only after artifact integrity passes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-domain-validator-"));
  let calls = 0;
  const store = new StrictSkillRunStore(root);
  const run = await stageCompletedEvidence(root, store, domainValidatorContract);

  const derivation = await deriveStrictValidatorResults(root, run, run.skillLedgers[0], (observation) => {
    calls += 1;
    (observation.result as { passed: boolean }).passed = true;
  });

  assert.equal(calls, 1);
  assert.equal(derivation.validatorResults["frontend.store-test/gate/domain-validator"].passed, false);
});

test("rejects an artifact reached through an escaping parent symlink before validator observation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-parent-link-"));
  let calls = 0;
  const store = new StrictSkillRunStore(root);
  const run = await stageCompletedEvidence(root, store, domainValidatorContract);
  await redirectArtifactParentOutsideRoot(root, run);

  const derivation = await deriveStrictValidatorResults(root, run, run.skillLedgers[0], () => { calls += 1; });
  assert.equal(derivation.artifactIntegrity.passed, false);
  assert.equal(calls, 0);
});

test("rejects symlink evidence before creating an artifact", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-evidence-link-"));
  const real = path.join(root, "real.txt");
  const link = path.join(root, "link.txt");
  await writeFile(real, "evidence");
  await symlink(real, link);
  const store = new StrictSkillRunStore(root);
  let run = fixtureRun();
  run = readNextStrictChunk(run, contract.skillId).run;
  run = beginStrictStep(run, contract.skillId, contract.steps[0].id);
  await store.create(run);

  await assert.rejects(store.ingestEvidence(run.runId, {
    sourcePath: link, kind: "report",
    attributions: [{ skillId: contract.skillId, stepId: contract.steps[0].id, attempt: 1, relation: "produced", ruleIds: contract.rules.map(({ id }) => id) }],
  }), (error: unknown) => error instanceof StrictSkillRunError && error.code === "artifact-integrity");
});

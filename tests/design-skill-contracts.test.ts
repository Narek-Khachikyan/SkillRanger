import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const readSkill = (name: string) =>
  readFile(path.resolve("registry/skills", `frontend.${name}`, "SKILL.md"), "utf8");

test("visual skills declare a verification outcome when browser evidence is unavailable", async () => {
  for (const name of [
    "visual-design-polish",
    "design-to-code",
    "tailwind-ui-polish",
    "interaction-polish",
  ]) {
    assert.match(await readSkill(name), /## Verification Outcome/);
  }
});

test("visual critic is read-only and code-free", async () => {
  const root = path.resolve("registry/skills/frontend.visual-critic");
  const manifest = JSON.parse(await readFile(path.join(root, "skill.manifest.json"), "utf8"));
  const skill = await readFile(path.join(root, "SKILL.md"), "utf8");
  const output = JSON.parse(await readFile(path.join(root, "output.schema.json"), "utf8"));

  assert.equal(manifest.id, "frontend.visual-critic");
  assert.equal(manifest.name, "visual-critic");
  assert.deepEqual(manifest.routing, { lane: "qa", category: "visual-critic" });
  assert.deepEqual(manifest.permissions, {
    filesystem: ["read-project"],
    writes: [],
    network: false,
    shell: false,
  });
  assert.deepEqual(manifest.scripts, []);
  assert.deepEqual(manifest.execution, {
    contractVersion: "1.0",
    inputSchema: "input.schema.json",
    outputSchema: "output.schema.json",
    workflow: "workflow.json",
    gates: "gates.json",
    evals: "evals.json",
    modelProfiles: ["constrained", "standard", "advanced"],
  });
  assert.match(manifest.description, /after .*rendered variants? or screenshots? (exist|are available)/i);
  assert.match(skill, /must not write or propose JSX, CSS, HTML, diffs, shell commands, or source edits/i);
  assert.match(skill, /refuse implementation requests/i);
  assert.match(skill, /owning implementation skill/i);
  assert.equal(output.properties.containsImplementationCode.const, false);
});

test("visual critic contracts enforce the complete evidence-first review", async () => {
  const root = path.resolve("registry/skills/frontend.visual-critic");
  const skill = await readFile(path.join(root, "SKILL.md"), "utf8");
  const gates = JSON.parse(await readFile(path.join(root, "gates.json"), "utf8"));
  const evals = JSON.parse(await readFile(path.join(root, "evals.json"), "utf8"));
  const requiredSequence = [
    /validate input artifact ids/i,
    /inspect every declared viewport and state screenshot/i,
    /score all ten criteria/i,
    /flag AI slop with evidence/i,
    /compare variants/i,
    /select one or reject all/i,
    /emit bounded findings/i,
  ];
  let cursor = -1;
  for (const pattern of requiredSequence) {
    const match = skill.slice(cursor + 1).search(pattern);
    assert.notEqual(match, -1, `missing or misordered instruction: ${pattern}`);
    cursor += match + 1;
  }

  assert.deepEqual(gates.hard, [
    "same-actor",
    "missing-candidate-evidence",
    "incomplete-scorecard",
    "critic-code-output",
    "invalid-selection",
  ]);
  assert.equal(evals.cases.filter((entry: { expected: string }) => entry.expected === "should-trigger").length, 1);
  assert.match(evals.cases.find((entry: { expected: string }) => entry.expected === "should-trigger").prompt, /two rendered variants/i);
  assert.equal(evals.cases.filter((entry: { expected: string }) => entry.expected === "should-not-trigger").length, 1);
  assert.match(evals.cases.find((entry: { expected: string }) => entry.expected === "should-not-trigger").prompt, /implement .*page/i);
  assert.ok(evals.taskAssertions.some((assertion: string) => /code-free report/i.test(assertion)));
});

test("material design workflows call critic after initial evidence", async () => {
  for (const file of [
    "domains/frontend/workflows/design-generation.workflow.json",
    "registry/skills/frontend.visual-design-polish/workflow.json",
    "registry/skills/frontend.design-to-code/workflow.json",
  ]) {
    const workflow = JSON.parse(await readFile(file, "utf8"));
    const ids = workflow.steps.map((step: string | { id: string }) =>
      typeof step === "string" ? step : step.id
    );
    assert.notEqual(ids.indexOf("capture-initial-evidence"), -1, `${file}: missing initial evidence`);
    assert.notEqual(ids.indexOf("independent-visual-critique"), -1, `${file}: missing independent critic`);
    assert.notEqual(ids.indexOf("bounded-repair"), -1, `${file}: missing bounded repair`);
    assert.ok(ids.indexOf("capture-initial-evidence") < ids.indexOf("independent-visual-critique"));
    assert.ok(ids.indexOf("independent-visual-critique") < ids.indexOf("bounded-repair"));
  }
});

test("design skills carry the anti-slop decision contracts", async () => {
  assert.match(await readSkill("visual-design-polish"), /## Scope Triage/);
  assert.match(await readSkill("visual-design-polish"), /## Evidence Ledger/);
  assert.match(await readSkill("design-to-code"), /## Reference Intake/);
  assert.match(await readSkill("design-system"), /## Systemization Gate/);
  assert.match(await readSkill("tailwind-ui-polish"), /## Project Archetype/);
  assert.match(await readSkill("ux-critique"), /## Evidence Ledger/);
});

test("motion skills declare a verification outcome", async () => {
  for (const name of ["motion-design", "motion-audit"]) {
    assert.match(await readSkill(name), /## Verification Outcome/);
  }
});

test("design skills carry positive direction rules beyond anti-slop keywords", async () => {
  const entries = await readdir(path.resolve("registry/skills"), {
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name.replace("frontend.", "");
    const text = await readSkill(name);
    const hasAntiSlop = /\b(anti.slop|generic|avoid|reject|do not|must not)\b/i.test(text);
    const hasPositiveDirection = /\b(prefer|use|choose|start from|keep|preserve)\b/i.test(text);
    if (hasAntiSlop) {
      assert.ok(
        hasPositiveDirection,
        `${name}: anti-slop gate without positive direction (must also guide what TO do)`,
      );
    }
  }
});

test("design skills encode product-specific genericity safeguards", async () => {
  const text = await readSkill("visual-design-polish");
  assert.match(text, /product\S*\s+(subject|audience|domain)/i);
  assert.match(text, /\bdesign\s+(variance|tension|constraints)\b/i);
  assert.ok(/## Design Constraints/.test(text) || /## Decision Rules/.test(text));
});

test("design-to-code has reference ethics and positive translation rules", async () => {
  const text = await readSkill("design-to-code");
  assert.match(text, /## Ethical Reference Handling/);
  assert.match(text, /## Decision Rules/);
  assert.match(text, /\bpreserve\b/i);
  assert.match(text, /\breusable attributes?\b/i);
});

test("motion design carries positive choreography rules, not only anti-slop", async () => {
  const text = await readSkill("motion-design");
  assert.match(text, /## Motion Direction And Choreography/);
  assert.match(text, /\bproduct-specific\s+rhythm\b/i);
  assert.match(text, /\bsemantic\s+motion\b/i);
});

test("design-system carries positive extraction rules, not only anti-drift", async () => {
  const text = await readSkill("design-system");
  assert.match(text, /## Token Architecture/);
  assert.match(text, /## Distinctiveness Without Drift/);
  assert.match(text, /\bpreserve\s+(distinctive|product)/i);
});

test("ux-critique carries positive flow-first gate, not only anti-slop checks", async () => {
  const text = await readSkill("ux-critique");
  assert.match(text, /## Flow First Gate/);
  assert.match(text, /## UX Copy Rules/);
});

test("constrained skill profiles forbid arbitrary JSX before structured direction", async () => {
  for (const file of [
    "registry/skills/frontend.visual-design-polish/workflow.json",
    "registry/skills/frontend.tailwind-ui-polish/workflow.json",
  ]) {
    const workflow = JSON.parse(await readFile(file, "utf8"));
    assert.ok(workflow.profileInstructions.constrained.some((line: string) => line.includes("structured direction")));
    assert.ok(workflow.profileInstructions.constrained.some((line: string) => line.includes("verified patterns")));
    assert.ok(workflow.profileInstructions.constrained.some((line: string) => line.includes("mandatory corrective pass")));
  }
});

test("skill workflows enforce policy, bounded repair, and fresh viewport rechecks", async () => {
  for (const file of [
    "registry/skills/frontend.visual-design-polish/workflow.json",
    "registry/skills/frontend.tailwind-ui-polish/workflow.json",
  ]) {
    const workflow = JSON.parse(await readFile(file, "utf8"));
    const ids: string[] = workflow.steps;
    const implementationStep = file.includes("tailwind-ui-polish") ? "implement-bounded-fix" : "implement";
    const critiqueStep = file.includes("tailwind-ui-polish") ? "independent-critique" : "independent-visual-critique";
    const before = (left: string, right: string) => {
      assert.notEqual(ids.indexOf(left), -1, `${file}: missing ${left}`);
      assert.notEqual(ids.indexOf(right), -1, `${file}: missing ${right}`);
      assert.ok(ids.indexOf(left) < ids.indexOf(right), `${file}: ${left} must precede ${right}`);
    };

    before("resolve-execution-policy", "define-structured-direction");
    before("define-structured-direction", implementationStep);
    before(critiqueStep, "bounded-repair");
    before("bounded-repair", "capture-recheck-evidence-390");
    before("capture-recheck-evidence-390", "capture-recheck-evidence-768");
    before("capture-recheck-evidence-768", "capture-recheck-evidence-1440");
    before("capture-recheck-evidence-1440", "final-verify");
    before("final-verify", "final-report");
  }
});

test("repair-loop documentation requires equal-or-higher-severity regression checks", async () => {
  const repairLoop = await readFile("docs/repair-loop.md", "utf8");
  assert.match(repairLoop, /equal-or-higher-severity regression/i);
  assert.doesNotMatch(repairLoop, /new critical or high regression/i);
});

test("visual design skill references the canonical rule and example libraries", async () => {
  const skill = await readFile("registry/skills/frontend.visual-design-polish/SKILL.md", "utf8");
  const rules = await readFile("registry/skills/frontend.visual-design-polish/references/visual-rules.md", "utf8");
  const examples = await readFile("registry/skills/frontend.visual-design-polish/references/evidence-examples.md", "utf8");
  assert.match(skill, /selected rule ids/i);
  assert.match(rules, /domains\/frontend\/rules\/index\.json/);
  assert.match(examples, /domains\/frontend\/examples\/<recipe-id>\/example\.json/);
});

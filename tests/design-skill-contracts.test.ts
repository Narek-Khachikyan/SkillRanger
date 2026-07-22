import test from "node:test";
import assert from "node:assert/strict";
import { resolveWorkflowStepIds, type WorkflowDefinition } from "../src/runtime/index.ts";
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
  assert.equal(manifest.routing.lane, "qa");
  assert.equal(manifest.routing.category, "visual-critic");
  assert.deepEqual(manifest.routing.roles, ["verification", "companion"]);
  assert.deepEqual(manifest.routing.domains, ["frontend"]);
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

test("material design workflows encode all post-critique policy branches", async () => {
  const domainFile = "domains/frontend/workflows/design-generation.workflow.json";
  const domainWorkflow = JSON.parse(await readFile(domainFile, "utf8"));
  const byId = new Map(
    domainWorkflow.steps.map((step: { id: string }) => [step.id, step]),
  );
  const selectedGate = byId.get("require-selected-variant-or-block-no-acceptable-variant");
  const repairRequested = byId.get("repair-requested");
  const boundedRepair = byId.get("bounded-repair");
  const noRepair = byId.get("no-repair-needed");
  const recheck = byId.get("capture-recheck-evidence");
  const finalAudit = byId.get("final-audit");

  assert.equal(selectedGate?.gate, "critic-outcome-selected");
  assert.equal(repairRequested?.gate, "constrained-or-repair-findings");
  assert.ok(boundedRepair?.requires.includes(".design/repair-request.json"));
  assert.equal(noRepair?.gate, "standard-or-advanced-zero-repair-findings");
  assert.ok(boundedRepair?.produces.includes(".design/accepted-selection.json"));
  assert.ok(noRepair?.produces.includes(".design/accepted-selection.json"));
  assert.ok(recheck?.requires.includes(".design/accepted-selection.json"));
  assert.ok(finalAudit?.requires.includes(".design/recheck-evidence.json"));

  for (const file of [
    "registry/skills/frontend.visual-design-polish/workflow.json",
    "registry/skills/frontend.design-to-code/workflow.json",
  ]) {
    const workflow = JSON.parse(await readFile(file, "utf8"));
    const steps: string[] = workflow.steps;
    for (const id of [
      "require-selected-variant-or-block-no-acceptable-variant",
      "repair-requested",
      "bounded-repair",
      "no-repair-needed",
      "capture-recheck-evidence",
      "final-audit",
    ]) {
      assert.ok(steps.includes(id), `${file}: missing ${id}`);
    }
    assert.ok(workflow.profileInstructions.constrained.some((line: string) =>
      /no-acceptable-variant.*block/i.test(line) && /repair-requested/i.test(line)
    ));
    for (const profile of ["standard", "advanced"]) {
      assert.ok(workflow.profileInstructions[profile].some((line: string) =>
        /repair findings.*repair-requested/i.test(line) && /zero repair findings.*no-repair-needed/i.test(line)
      ));
    }
  }
});

test("workflow branch resolver executes one critic decision path and converges", async () => {
  for (const file of [
    "domains/frontend/workflows/design-generation.workflow.json",
    "registry/skills/frontend.visual-design-polish/workflow.json",
    "registry/skills/frontend.design-to-code/workflow.json",
  ]) {
    const raw = JSON.parse(await readFile(file, "utf8"));
    const workflow = {
      ...raw,
      requiredCapabilities: raw.requiredCapabilities ?? [],
      steps: raw.steps.map((step: string | WorkflowDefinition["steps"][number]) =>
        typeof step === "string" ? { id: step, type: "validate", requires: [], produces: [] } : step),
    } as WorkflowDefinition;
    const constrainedRepair = resolveWorkflowStepIds(workflow, { criticOutcome: "selected", profile: "constrained", repairFindingCount: 0 });
    const standardRepair = resolveWorkflowStepIds(workflow, { criticOutcome: "selected", profile: "standard", repairFindingCount: 2 });
    const noRepair = resolveWorkflowStepIds(workflow, { criticOutcome: "selected", profile: "standard", repairFindingCount: 0 });
    const rejected = resolveWorkflowStepIds(workflow, { criticOutcome: "no-acceptable-variant", profile: "standard", repairFindingCount: 0 });
    assert.equal(constrainedRepair.includes("bounded-repair"), true, file);
    assert.equal(standardRepair.includes("bounded-repair"), true, file);
    assert.equal(noRepair.includes("no-repair-needed"), true, file);
    assert.equal(rejected.includes("block-no-acceptable-variant"), true, file);
    assert.equal(rejected.includes("require-selected-variant-or-block-no-acceptable-variant"), false, file);
    assert.equal(constrainedRepair.includes("require-selected-variant-or-block-no-acceptable-variant"), true, file);
    assert.equal(noRepair.includes("require-selected-variant-or-block-no-acceptable-variant"), true, file);
    assert.deepEqual(
      rejected.slice(rejected.indexOf("independent-visual-critique") + 1),
      ["block-no-acceptable-variant"],
      file,
    );
    for (const path of [constrainedRepair, standardRepair, noRepair]) {
      assert.equal(path.filter((id) => ["bounded-repair", "no-repair-needed", "block-no-acceptable-variant"].includes(id)).length, 1, file);
      assert.ok(path.includes("capture-recheck-evidence"), file);
      assert.ok(path.includes("final-audit"), file);
    }
    assert.equal(rejected.includes("capture-recheck-evidence"), false, file);
  }
});

test("domain and registry critic schemas retain overlapping strictness parity", async () => {
  const [domain, registry] = await Promise.all([
    readFile("domains/frontend/schemas/visual-critic-report.schema.json", "utf8"),
    readFile("registry/skills/frontend.visual-critic/output.schema.json", "utf8"),
  ]).then((texts) => texts.map(JSON.parse));
  for (const field of ["candidateVariantIds", "evidenceIds", "comparisons"]) {
    assert.equal(domain.properties[field].minItems, registry.properties[field].minItems, field);
  }
  assert.deepEqual(domain.allOf, registry.allOf);
  assert.equal(domain.$defs.comparison.properties.strengths.items.minLength, 1);
  assert.equal(domain.$defs.verificationFinding.properties.id.minLength, 1);
});

test("visual critic output schema binds selection id to outcome", async () => {
  const schema = JSON.parse(
    await readFile("registry/skills/frontend.visual-critic/output.schema.json", "utf8"),
  );
  assert.deepEqual(schema.allOf, [
    {
      if: { properties: { outcome: { const: "selected" } }, required: ["outcome"] },
      then: { required: ["selectedVariantId"] },
    },
    {
      if: { properties: { outcome: { const: "no-acceptable-variant" } }, required: ["outcome"] },
      then: { not: { required: ["selectedVariantId"] } },
    },
  ]);

  const acceptsSelectionCondition = (instance: Record<string, unknown>) =>
    schema.allOf.every((branch: {
      if: { properties: { outcome: { const: string } } };
      then: { required?: string[]; not?: { required: string[] } };
    }) => {
      if (instance.outcome !== branch.if.properties.outcome.const) return true;
      if (branch.then.required) {
        return branch.then.required.every((key) => Object.hasOwn(instance, key));
      }
      return branch.then.not?.required.every((key) => !Object.hasOwn(instance, key)) ?? true;
    });

  assert.equal(acceptsSelectionCondition({ outcome: "selected", selectedVariantId: "v1" }), true);
  assert.equal(acceptsSelectionCondition({ outcome: "selected" }), false);
  assert.equal(acceptsSelectionCondition({ outcome: "no-acceptable-variant" }), true);
  assert.equal(
    acceptsSelectionCondition({ outcome: "no-acceptable-variant", selectedVariantId: "v1" }),
    false,
  );
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

test("visual-design-polish manifest and contract meet strict execution contract v2 specifications", async () => {
  const root = path.resolve("registry/skills/frontend.visual-design-polish");
  const manifest = JSON.parse(await readFile(path.join(root, "skill.manifest.json"), "utf8"));
  const contract = JSON.parse(await readFile(path.join(root, "execution.contract.json"), "utf8"));
  const outputSchema = JSON.parse(await readFile(path.join(root, "output.schema.json"), "utf8"));

  assert.equal(manifest.execution.contractVersion, "2.0");
  assert.equal(manifest.execution.contract, "execution.contract.json");

  assert.equal(contract.schemaVersion, "2.0");
  assert.equal(contract.skillId, "frontend.visual-design-polish");
  assert.equal(contract.contractVersion, "2.0.0");
  assert.ok(contract.mustRead.includes("SKILL.md"));

  assert.deepEqual(contract.applicability, {
    op: "input",
    path: "changeClass",
    equals: "material",
  });

  const caps = contract.prerequisites
    .filter((p: { kind: string }) => p.kind === "capability")
    .map((p: { capability: string }) => p.capability);
  assert.ok(caps.includes("browser"));
  assert.ok(caps.includes("screenshots"));

  const criticStep = contract.steps.find((s: { type: string }) => s.type === "critic");
  assert.ok(criticStep);
  assert.ok(criticStep.requiredEvidenceKinds.includes("critic-report"));

  const repairStep = contract.steps.find((s: { type: string }) => s.type === "repair");
  assert.ok(repairStep);
  assert.equal(repairStep.repairable, true);

  assert.ok(contract.mustRead.includes("references/shared/frontend--visual-verification.md"), "mustRead must include shared visual-verification contract");

  const stepIds = contract.steps.map((s: { id: string }) => s.id);
  const initialIdx = stepIds.findIndex((id: string) => id.includes("capture-initial-evidence"));
  const criticIdx = stepIds.findIndex((id: string) => id.includes("independent-visual-critic"));
  const repairIdx = stepIds.findIndex((id: string) => id.includes("bounded-repair"));
  const recheckIdx = stepIds.findIndex((id: string) => id.includes("capture-recheck-evidence"));
  const recheckCriticIdx = stepIds.findIndex((id: string) => id.includes("recheck-visual-critic"));
  const verifyIdx = stepIds.findIndex((id: string) => id.includes("final-verify"));

  assert.ok(initialIdx !== -1 && initialIdx < criticIdx, "initial screenshots must precede critic");
  assert.ok(criticIdx !== -1 && criticIdx < repairIdx, "critic must precede repair");
  assert.ok(repairIdx !== -1 && repairIdx < recheckIdx, "recheck screenshots must follow repair");
  assert.ok(recheckIdx !== -1 && recheckIdx < recheckCriticIdx, "recheck critic must follow recheck screenshots");
  assert.ok(recheckCriticIdx !== -1 && recheckCriticIdx < verifyIdx, "recheck critic must precede final verification");

  assert.equal(outputSchema.properties?.outcome, undefined);
  assert.equal(outputSchema.properties?.implementationOutcome !== undefined, true);
  assert.ok(contract.maxRepairIterations >= 1 && contract.maxRepairIterations <= 5);

  const skillMd = await readFile("registry/skills/frontend.visual-design-polish/SKILL.md", "utf8");
  assert.doesNotMatch(skillMd, /explicit verification outcome.*verified/i);
});

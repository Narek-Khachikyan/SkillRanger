import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertValidExecutionContract,
  evaluateApplicability,
  validateJsonSchema,
  type ExecutionContractV2,
} from "../src/runtime/strict/index.ts";
import { findSkill } from "../src/registry/index.ts";

const contract = (): ExecutionContractV2 => ({
  schemaVersion: "2.0",
  skillId: "frontend.test-skill",
  contractVersion: "2.0.0",
  inputSchema: "input.schema.json",
  outputSchema: "output.schema.json",
  mustRead: ["SKILL.md", "references/checklist.md"],
  applicability: {
    op: "all",
    conditions: [
      { op: "tag", value: "frontend" },
      { op: "signal", collection: "styling", name: "tailwindcss", minConfidence: 0.5 },
    ],
  },
  prerequisites: [{ id: "browser-ready", kind: "capability", capability: "browser", requiredStatus: "ready" }],
  steps: [{
    id: "frontend.test-skill/step/inspect",
    type: "collect",
    requiredEvidenceKinds: ["inspection-report"],
    ruleIds: ["frontend.test-skill/rule/inspect-first"],
  }],
  rules: [{ id: "frontend.test-skill/rule/inspect-first", description: "Inspect before changing files." }],
  gates: [{
    id: "frontend.test-skill/gate/report-present",
    level: "hard",
    evaluator: { type: "evidence-present", evidenceKind: "inspection-report" },
    ruleIds: ["frontend.test-skill/rule/inspect-first"],
  }],
  maxRepairIterations: 2,
});

test("validates strict input and output data with the bundled closed JSON schemas", async () => {
  const schema = JSON.parse(await readFile("registry/skills/frontend.performance-review/output.schema.json", "utf8"));
  const valid = {
    mode: "risk-review", findings: [{ affectedFlow: "initial load", dimension: "LCP", basis: "risk", impact: "high", confidence: "medium", behavior: "Hero may be late", evidence: [], expectedBenefit: "Earlier paint", tradeoff: "More preload bytes" }],
    measurementsInspected: [], measurementGaps: ["Capture an LCP trace"], residualRisks: [],
  };
  assert.deepEqual(validateJsonSchema(schema, valid), []);
  assert.match(validateJsonSchema(schema, { ...valid, surprise: true }).join("\n"), /additional property/i);
  assert.match(validateJsonSchema(schema, { ...valid, findings: [{ ...valid.findings[0], affectedFlow: undefined }] }).join("\n"), /affectedFlow/i);
});

test("validates a closed strict execution contract with canonical ids", async () => {
  assert.doesNotThrow(() => assertValidExecutionContract(contract()));
  const schema = JSON.parse(await readFile("schemas/execution-contract-v2.schema.json", "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "schemaVersion", "skillId", "contractVersion", "inputSchema", "outputSchema",
    "mustRead", "applicability", "prerequisites", "steps", "rules", "gates",
    "maxRepairIterations",
  ]);
});

test("rejects non-canonical ids, unknown rule references, and unregistered validators", () => {
  const invalid = contract();
  invalid.steps[0].id = "inspect";
  invalid.steps[0].ruleIds = ["frontend.test-skill/rule/missing"];
  invalid.gates[0].evaluator = { type: "validator", validatorId: "skill-package/arbitrary-code" };

  assert.throws(
    () => assertValidExecutionContract(invalid),
    /canonical|unknown rule|validator/i,
  );
});

test("reserves only the runtime-owned critic system gate id from core contracts", () => {
  const core = JSON.parse(
    JSON.stringify(contract()).replaceAll("frontend.test-skill", "core"),
  ) as ExecutionContractV2;
  core.gates[0].id = "core/gate/critic-findings";
  assert.throws(
    () => assertValidExecutionContract(core),
    /reserved|runtime/i,
  );

  core.gates[0].id = "core/gate/custom";
  assert.doesNotThrow(() => assertValidExecutionContract(core));
});

test("evaluates applicability only from allowlisted fingerprint and input predicates", () => {
  const value = contract().applicability;
  assert.equal(evaluateApplicability(value, {
    fingerprint: {
      schemaVersion: "1.0", root: "/project", projectTypes: [], languages: [], frameworks: [],
      styling: [{ name: "tailwindcss", confidence: 0.9, evidence: ["package.json"] }],
      testing: [], infrastructure: [],
      agentContext: {
        agentsMd: { present: false, paths: [] }, codexSkills: { present: false, paths: [] },
        claudeSkills: { present: false, paths: [] },
      },
      signals: [], tags: ["frontend"], warnings: [],
    },
    input: {},
  }), true);
  assert.equal(evaluateApplicability(value, {
    fingerprint: {
      schemaVersion: "1.0", root: "/project", projectTypes: [], languages: [], frameworks: [], styling: [],
      testing: [], infrastructure: [],
      agentContext: {
        agentsMd: { present: false, paths: [] }, codexSkills: { present: false, paths: [] },
        claudeSkills: { present: false, paths: [] },
      },
      signals: [], tags: ["frontend"], warnings: [],
    },
    input: {},
  }), false);
});

test("loads the two pilot contracts as checksum-bound registry data", async () => {
  const tailwind = await findSkill("frontend.tailwind-ui-polish");
  const performance = await findSkill("frontend.performance-review");

  assert.equal(tailwind?.manifest.execution?.contractVersion, "2.0");
  assert.equal(tailwind?.executionContract?.skillId, tailwind?.manifest.id);
  assert.equal(tailwind?.executionContract?.maxRepairIterations, 3);
  assert.ok(tailwind?.executionContract?.mustRead.includes("references/mechanical-rules.md"));
  assert.ok(tailwind?.executionContract?.gates.some(({ id }) => id === "frontend.tailwind-ui-polish/gate/no-horizontal-overflow"));

  assert.equal(performance?.manifest.execution?.contractVersion, "2.0");
  assert.equal(performance?.executionContract?.skillId, performance?.manifest.id);
  assert.equal(performance?.executionContract?.maxRepairIterations, 1);
  assert.ok(performance?.executionContract?.gates.some(({ id }) => id === "frontend.performance-review/gate/measured-claim-has-artifact"));
});

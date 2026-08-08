import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildTrustedValidatorRegistry,
  createContentChunks,
  createStrictSkillRun,
  type ExecutionContractV2,
  type SkillLedger,
  type ValidatorEvaluationContext,
} from "../../src/runtime/strict/index.ts";

const sha = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
export const tailwindSkillId = "frontend.tailwind-source-fixture";
export const tailwindGateSlugs = [
  "no-dynamic-tailwind-classes",
  "raw-colors-reviewed",
  "repeated-class-bundles-reviewed",
];
const implementStep = { id: `${tailwindSkillId}/step/implement`, type: "implement" as const, requiredEvidenceKinds: [] as string[], ruleIds: [`${tailwindSkillId}/rule/evidence`] };
export const tailwindContract: ExecutionContractV2 = {
  schemaVersion: "2.0", skillId: tailwindSkillId, contractVersion: "2.0.0",
  inputSchema: "input.schema.json", outputSchema: "output.schema.json", mustRead: ["SKILL.md"],
  applicability: { op: "tag", value: "frontend" }, prerequisites: [], maxRepairIterations: 1,
  rules: [{ id: `${tailwindSkillId}/rule/evidence`, description: "Record evidence." }],
  steps: [implementStep],
  gates: tailwindGateSlugs.map((slug) => ({
    id: `${tailwindSkillId}/gate/${slug}`,
    level: "hard" as const,
    evaluator: { type: "validator" as const, validatorId: "frontend/tailwind-source" },
    ruleIds: [`${tailwindSkillId}/rule/evidence`],
  })),
};
export const tailwindRepairContract: ExecutionContractV2 = {
  ...tailwindContract,
  steps: [
    implementStep,
    { id: `${tailwindSkillId}/step/bounded-repair`, type: "repair" as const, requiredEvidenceKinds: [] as string[], ruleIds: [`${tailwindSkillId}/rule/evidence`] },
  ],
};

export const createTailwindSourceRun = (executionContract = tailwindContract) => createStrictSkillRun({
  runId: "run_tailwind_source", domain: "frontend", targetAgent: "codex", locale: "en",
  intent: { sha256: sha("tailwind"), normalizedGoal: "validate source review evidence" }, now: "2026-07-15T10:00:00.000Z",
  selectedSkills: [{
    skillId: executionContract.skillId, role: "primary", mandatory: true, version: "1.0.0",
    packageChecksum: sha("package"), contractChecksum: sha(JSON.stringify(executionContract)), contract: executionContract,
    schemaSnapshots: { input: { type: "object" }, output: { type: "object" } },
    schemaChecksums: { input: sha(JSON.stringify({ type: "object" })), output: sha(JSON.stringify({ type: "object" })) },
    contentChunks: createContentChunks("SKILL.md", "# Tailwind Source Test\n"), applicable: true, unmetPrerequisites: [],
  }],
});

export const tailwindGateResult = (
  ledger: SkillLedger,
  sourceReview: unknown,
  gateId: string,
): { passed: boolean; message?: string } => {
  const registry = buildTrustedValidatorRegistry([{ skillId: ledger.skillId }]);
  const evaluator = registry.resolveValidator("frontend/tailwind-source");
  assert.ok(evaluator, "frontend/tailwind-source must resolve through the trusted registry");
  const context: ValidatorEvaluationContext = {
    projectRoot: "/project",
    ledger,
    artifacts: [],
    artifactBytes: new Map(),
    sourceReview,
    gateId,
  };
  return evaluator(context);
};

export const tailwindResultsFor = (
  ledger: SkillLedger,
  sourceReview: unknown,
): Record<string, { passed: boolean; message?: string }> => Object.fromEntries(
  tailwindContract.gates.map((gate) => [
    gate.id.slice(gate.id.lastIndexOf("/") + 1),
    tailwindGateResult(ledger, sourceReview, gate.id),
  ]),
);

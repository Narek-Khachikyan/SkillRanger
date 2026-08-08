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
import type { EvidenceArtifact } from "../../src/runtime/strict/types.ts";

const sha = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
export const browserSkillId = "frontend.browser-gate-fixture";
export const browserGateSlugs = [
  "required-states-covered",
  "no-horizontal-overflow",
  "no-clipped-controls",
  "no-sticky-overlap",
  "focus-visible",
  "no-runtime-console-errors",
  "reduced-motion-verified",
];
export const browserContract: ExecutionContractV2 = {
  schemaVersion: "2.0", skillId: browserSkillId, contractVersion: "2.0.0",
  inputSchema: "input.schema.json", outputSchema: "output.schema.json", mustRead: ["SKILL.md"],
  applicability: { op: "tag", value: "frontend" }, prerequisites: [], maxRepairIterations: 1,
  rules: [{ id: `${browserSkillId}/rule/evidence`, description: "Record evidence." }],
  steps: [{ id: `${browserSkillId}/step/capture`, type: "collect", requiredEvidenceKinds: ["browser-screenshot-390"], ruleIds: [`${browserSkillId}/rule/evidence`] }],
  gates: browserGateSlugs.map((slug) => ({
    id: `${browserSkillId}/gate/${slug}`,
    level: "hard" as const,
    evaluator: { type: "validator" as const, validatorId: "frontend/browser-hard-gates" },
    ruleIds: [`${browserSkillId}/rule/evidence`],
  })),
};
export const emptyMechanicalSnapshot = {
  spacingContexts: [], colors: [], radii: [], shadows: [], cards: [], typography: [], textBlocks: [],
  touchTargets: [],
};
export const browserObservation = (width: number) => ({
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
  mechanicalSnapshot: emptyMechanicalSnapshot,
  stateRendered: true,
  action: "Select the captured state",
  changes: [{ locator: "#active-state", before: "previous", after: `viewport-${width}` }],
});
export const browserArtifacts = [390, 768, 1440].map((width) => ({
  kind: `browser-screenshot-${width}`,
  sourcePath: `evidence/${width}.png`,
})) as EvidenceArtifact[];

export const createBrowserGateRun = (input?: Record<string, unknown>) => createStrictSkillRun({
  runId: "run_browser_gates", domain: "frontend", targetAgent: "codex", locale: "en",
  intent: { sha256: sha("browser"), normalizedGoal: "validate browser evidence" }, now: "2026-07-15T10:00:00.000Z",
  selectedSkills: [{
    skillId: browserSkillId, role: "primary", mandatory: true, version: "1.0.0",
    packageChecksum: sha("package"), contractChecksum: sha(JSON.stringify(browserContract)), contract: browserContract,
    schemaSnapshots: { input: { type: "object" }, output: { type: "object" } },
    schemaChecksums: { input: sha(JSON.stringify({ type: "object" })), output: sha(JSON.stringify({ type: "object" })) },
    contentChunks: createContentChunks("SKILL.md", "# Browser Gate Test\n"), applicable: true, unmetPrerequisites: [],
    ...(input === undefined ? {} : { input }),
  }],
});

export const browserGateResult = (
  ledger: SkillLedger,
  verificationInput: unknown,
  artifacts: readonly EvidenceArtifact[],
  gateId: string,
): { passed: boolean; message?: string } => {
  const registry = buildTrustedValidatorRegistry([{ skillId: ledger.skillId }]);
  const evaluator = registry.resolveValidator("frontend/browser-hard-gates");
  assert.ok(evaluator, "frontend/browser-hard-gates must resolve through the trusted registry");
  const context: ValidatorEvaluationContext = {
    projectRoot: "/project",
    ledger,
    artifacts,
    artifactBytes: new Map(),
    verificationInput,
    gateId,
  };
  return evaluator(context);
};

export const browserResultsFor = (
  ledger: SkillLedger,
  verificationInput: unknown,
  artifacts: readonly EvidenceArtifact[],
): Record<string, { passed: boolean; message?: string }> => Object.fromEntries(
  browserContract.gates.map((gate) => [
    gate.id.slice(gate.id.lastIndexOf("/") + 1),
    browserGateResult(ledger, verificationInput, artifacts, gate.id),
  ]),
);

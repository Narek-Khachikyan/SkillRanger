import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDomainPack } from "../domains/registry.ts";
import type { Recommendation } from "../types.ts";
import { createSkillRun, reduceSkillRun } from "../runtime/skill-run/reducer.ts";
import { SkillRunStore, type SkillRun } from "../runtime/skill-run/index.ts";
import { StrictSkillRunStore, type SkillRunV2 } from "../runtime/strict/index.ts";
import { RouterSourceReader, type RouterSourceReaderOptions } from "./reader.ts";
import { RouterStore, routerRecordDigest } from "./store.ts";
import type {
  PrepareTaskCommon,
  PrepareTaskResult,
  PreparedSkillSelection,
  RuntimeClarificationSummary,
} from "./types.ts";

// The router-runtime bridge: the one module where the router's three runtime
// adapter sites live together — lifecycle payload construction (including the
// recommendations shim with synthetic scores for lifecycle policy, moved
// unchanged), the runtime-store dispatch (schemaVersion routing between the
// lifecycle-v1 and strict-v2 stores), and the mandatory-read bridge that serves
// prepared skill chunks. Task preparation and the read surface consume these
// through the small RouterRuntimeBridge interface instead of building inline
// adapters; router-runtime coupling is visible in this one place.

export class RouterPrepareError extends Error {
  readonly code: "trigger-required" | "empty-intent" | "intent-too-large" | "router-disabled" | "target-agent-unresolved" | "project-root-unauthorized" | "continuation-invalid" | "continuation-expired" | "clarification-answer-invalid" | "capability-invalid" | "router-config-invalid" | "routing-integrity" | "semantic-hint-invalid" | "routing-proposal-invalid" | "raw-intent-confirmation-required";

  constructor(code: RouterPrepareError["code"], message: string) {
    super(message);
    this.name = "RouterPrepareError";
    this.code = code;
  }
}

const digest = (value: unknown) => routerRecordDigest(value);

const recommendationsFor = (selections: { primary: PreparedSkillSelection; environment: PreparedSkillSelection[]; companions: PreparedSkillSelection[]; verification: PreparedSkillSelection[]; agentContext: PreparedSkillSelection[] }) => [
  selections.primary,
  ...selections.environment,
  ...selections.companions,
  ...selections.verification,
  ...selections.agentContext,
].map((selection, index) => ({
  skillId: selection.skillId,
  displayName: selection.displayName,
  role: selection.role === "primary" ? "primary" as const : "companion" as const,
  score: selection.score,
  reasons: selection.reasons,
  riskLevel: "low" as const,
  verification: { status: selection.verificationStatus === "guidance-only" ? "unverified" as const : "ready" as const, missingCapabilities: [] },
  scoreBreakdown: { stackMatch: 0, userIntentMatch: 0, qualityScore: 0, effectiveQualityScore: 0, securityScore: 0, freshnessScore: 0, compatibilityScore: 1, duplicatePenalty: 0, evaluationPenalty: 0, laneAdjustment: 0, skillAdjustment: 0, finalScore: selection.score },
  ...(index === 0 ? {} : {}),
})) as unknown as Recommendation[];

const assertRequiredPhaseOwnersSelected = (
  policy: { artifacts?: Record<string, unknown> } | undefined,
  selectedSkillIds: Set<string>,
) => {
  const phasePlan = policy?.artifacts?.phasePlan as { entries?: Array<{ status: string; ownerSkillId: string; phase: string }> } | undefined;
  if (!phasePlan?.entries) return;

  const missing = phasePlan.entries.filter(
    ({ status, ownerSkillId }) =>
      status === "required" && !selectedSkillIds.has(ownerSkillId),
  );

  if (missing.length === 0) return;

  throw new RouterPrepareError(
    "routing-integrity",
    `Required phase owners are not selected: ${missing.map(({ phase, ownerSkillId }) => `${phase}:${ownerSkillId}`).join(",")}.`,
  );
};

export type LifecyclePayloadInput = {
  runtimeRunId: string;
  domain: string;
  targetAgent: string;
  prompt: string;
  rawPrompt?: string;
  policyIntent?: string;
  profile: PrepareTaskCommon["taskProfile"];
  selections: PrepareTaskResult & { status: "prepared" };
  rawIntentPersistence?: boolean;
  coreOutputContracts: Record<string, string[]>;
};

const createLifecyclePayload = async (input: LifecyclePayloadInput): Promise<{ payload: SkillRun; runtimeClarification?: RuntimeClarificationSummary }> => {
  const pack = getDomainPack(input.domain);
  const recommendations = recommendationsFor(input.selections.selections);
  const policy = pack?.runPolicy?.evaluate({ intent: input.policyIntent ?? input.prompt, recommendations });
  const selectedSkills = [
    input.selections.selections.primary,
    ...input.selections.selections.environment,
    ...input.selections.selections.companions,
    ...input.selections.selections.verification,
    ...input.selections.selections.agentContext,
  ].map((selection) => ({
    skillId: selection.skillId,
    role: selection.role === "primary" ? "primary" as const : "companion" as const,
    version: selection.version,
    checksum: selection.packageChecksum,
    mandatory: true,
  }));
  const selectedSkillIds = new Set(selectedSkills.map(({ skillId }) => skillId));
  assertRequiredPhaseOwnersSelected(policy, selectedSkillIds);
  // ADR 0008: always-on guidance skill output contracts travel inside the persisted policy, so the
  // lifecycle verification gate needs no registry access to enforce them.
  const basePolicy = policy ?? {
    lifecycleRequired: true,
    mandatorySkillIds: selectedSkills.map(({ skillId }) => skillId),
    clarification: { required: false, questions: [] },
    verificationRequired: false,
  };
  const contractedPolicy = Object.keys(input.coreOutputContracts).length === 0
    ? basePolicy
    : {
        ...basePolicy,
        artifacts: { ...(basePolicy.artifacts ?? {}), coreOutputContracts: input.coreOutputContracts },
      };
  const created = createSkillRun({
    runId: input.runtimeRunId,
    domain: input.domain,
    targetAgent: input.targetAgent,
    locale: input.profile.locale,
    intent: { sha256: digest(input.profile.normalizedGoal), normalizedGoal: input.profile.normalizedGoal, ...(input.rawIntentPersistence ? { raw: input.rawPrompt ?? input.prompt } : {}) },
    policy: contractedPolicy,
  });
  return {
    payload: reduceSkillRun(created, { type: "select-skills", skills: selectedSkills }),
    ...(contractedPolicy.clarification.required ? {
      runtimeClarification: {
        questions: contractedPolicy.clarification.questions,
      },
    } : {}),
  };
};

export type RouterRuntimeBridgeStore = {
  read(runId: string): Promise<unknown | undefined>;
  create(runId: string, value: unknown): Promise<void>;
  replace(runId: string, value: unknown): Promise<void>;
};

export const createRouterRuntimeStore = (projectRoot: string): RouterRuntimeBridgeStore => ({
  async read(runId: string) {
    const file = path.join(projectRoot, ".skillranger", "runs", `${runId}.json`);
    try { return JSON.parse(await readFile(file, "utf8")) as unknown; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  },
  async create(runId: string, value: unknown) {
    if ((value as { schemaVersion?: string }).schemaVersion === "2.0") await new StrictSkillRunStore(projectRoot).create(value as SkillRunV2);
    else await new SkillRunStore(projectRoot).create(value as SkillRun);
    if ((value as { runId?: string }).runId !== runId) throw new RouterPrepareError("routing-integrity", "Runtime ID does not match the preallocated journal ID.");
  },
  async replace(runId: string, value: unknown) {
    if ((value as { schemaVersion?: string }).schemaVersion === "2.0") await new StrictSkillRunStore(projectRoot).replace(runId, value as SkillRunV2);
    else await new SkillRunStore(projectRoot).replace(runId, value as SkillRun);
  },
});

export const createRouterReader = (
  projectRoot: string,
  registryRoot: string,
  store = new RouterStore(projectRoot),
  options: RouterSourceReaderOptions = {},
) => new RouterSourceReader(projectRoot, store, { bundledRegistryRoot: registryRoot, ...options });

export interface RouterRuntimeBridge {
  createLifecyclePayload(input: LifecyclePayloadInput): Promise<{ payload: SkillRun; runtimeClarification?: RuntimeClarificationSummary }>;
  createRuntimeStore(): RouterRuntimeBridgeStore;
  createReader(store?: RouterStore, options?: RouterSourceReaderOptions): RouterSourceReader;
}

export const createRouterRuntimeBridge = (projectRoot: string, registryRoot: string): RouterRuntimeBridge => ({
  createLifecyclePayload: (input) => createLifecyclePayload(input),
  createRuntimeStore: () => createRouterRuntimeStore(projectRoot),
  createReader: (store, options) => createRouterReader(projectRoot, registryRoot, store, options),
});

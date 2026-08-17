import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  buildSkillCatalog,
  inspectSkillCatalog,
  type SkillCatalogPage,
  type SkillCatalogSnapshot,
} from "../../router/catalog.ts";
import { parseTrigger } from "../../router/trigger.ts";
import { type RouterSkillMetadata } from "../../router/composer.ts";
import { assertValidCatalogReceipt } from "../../router/catalog.ts";
import {
  RoutingPipelineError,
  type RoutingPipelineDecision,
  type RoutingPipelineErrorCode,
} from "../../router/pipeline.ts";
import { runRoutingEntry } from "../../router/entry.ts";
import { semanticRecallLimitedWarning, type RoutingMode } from "../../router/types.ts";
import { canonicalizeJson } from "../../router/store.ts";
import { routerEvalRoutingDate } from "../../router/fixtures.ts";
import { loadRoutingWorld } from "../../router/world.ts";
import type { RoutingProposalInput } from "../../router/routing-proposal.ts";
import type { ProjectFingerprint } from "../../types.ts";
import { canonicalSkillId, emptyFingerprint, privacyLeakageCountFor, publicOutcomeStatus, skillIndexById } from "./helpers.ts";

const contractSchemaVersion = "router-eval-contracts/1.0" as const;
const benchmarkSchemaVersion = "router-model-assisted/1.0" as const;
const canonicalIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const contractKinds = new Set([
  "catalog",
  "proposal-grounding",
  "proposal-ownership",
  "item-rejection",
  "precedence",
  "hard-veto",
  "strict",
  "ambiguity",
  "refresh",
  "privacy-replay",
  "proposal-absent",
] as const);
type EvaluatedStatus = "prepared" | "clarification_required" | "decomposition_required" | "no_matching_skills" | "strict_requirements_unmet" | "context_budget_exceeded" | "catalog_refresh_required" | "error";
// The evaluation error vocabulary is the routing pipeline's own error-code set;
// the harness never duplicates adapter-level error codes it cannot produce.
type EvaluationErrorCode = RoutingPipelineErrorCode | "evaluation-error";
const routingPipelineErrorCodes = new Set<RoutingPipelineErrorCode>([
  "routing-proposal-invalid",
  "semantic-hint-invalid",
  "clarification-answer-invalid",
  "continuation-invalid",
]);
const benchmarkSources = new Set(["implicit-intent", "hard-paraphrase", "russian-paraphrase"] as const);
const proposalModes = new Set(["current", "absent", "malformed", "stale"] as const);
const resultStatuses = new Set<EvaluatedStatus>([
  "prepared",
  "clarification_required",
  "decomposition_required",
  "no_matching_skills",
  "strict_requirements_unmet",
  "context_budget_exceeded",
  "catalog_refresh_required",
  "error",
] as const);

export type RoutingProposalContractKind =
  | "catalog"
  | "proposal-grounding"
  | "proposal-ownership"
  | "item-rejection"
  | "precedence"
  | "hard-veto"
  | "strict"
  | "ambiguity"
  | "refresh"
  | "privacy-replay"
  | "proposal-absent";

export type CapturedRoutingProposal = {
  schemaVersion: "routing-proposal/1.0";
  catalogDigest: string;
  catalogReceipt: string;
  interpretation: {
    domains: string[];
    actions: string[];
    artifactTypes: string[];
    intentTags: string[];
    technologyTags: string[];
    qualityGoals: string[];
  };
  nominations: Array<{
    skillId: string;
    role: string;
    confidence: number;
    evidenceText: string;
  }>;
  ambiguity?: { primarySkillIds: string[] };
};

export type RoutingProposalContractCase = {
  id: string;
  kind: RoutingProposalContractKind;
  prompt?: string;
  proposal?: CapturedRoutingProposal;
  strict?: boolean;
  capabilities?: string[];
  expected: Record<string, unknown>;
};

export type RoutingProposalContractFixture = {
  schemaVersion: typeof contractSchemaVersion;
  catalog: {
    expectedDomainIds: string[];
    expectedSkillIds: string[];
    pageMaxItems: number;
  };
  cases: RoutingProposalContractCase[];
};

export type ModelAssistedBenchmarkSource = "implicit-intent" | "hard-paraphrase" | "russian-paraphrase";
export type ModelAssistedProposalMode = "current" | "absent" | "malformed" | "stale";

export type RoleAwareRole = "primary" | "companion" | "verification";

export type RoleAwareSelections = {
  primary: string[];
  companion: string[];
  verification: string[];
};

export type RoleRecallCounts = Record<RoleAwareRole, { matched: number; expectedCount: number }>;

export type RoleRecall = {
  fullSet: number;
  primary: number;
  companion: number;
  verification: number;
  missedRoles: RoleAwareRole[];
  expected: RoleAwareSelections;
  observed: RoleAwareSelections;
  // Raw per-role matched/expected counts, carried so aggregates can sum them
  // without re-deriving per-case recall from the observed selections.
  counts: RoleRecallCounts;
};

export type ModelAssistedBenchmarkExpected = {
  status: EvaluatedStatus;
  primarySkillId?: string;
  fallbackStatus?: EvaluatedStatus;
  fallbackPrimarySkillId?: string;
  fallbackUnchanged?: boolean;
  fallbackNotWorse?: boolean;
  malformedRejected?: boolean;
  catalogIntegrityException?: boolean;
  errorCode?: EvaluationErrorCode;
  allowedSkillIds: string[];
  forbiddenSkillIds: string[];
  requiredSkillIds?: string[];
  roleAssignments?: RoleAwareSelections;
};

export type ModelAssistedBenchmarkCase = {
  id: string;
  source: ModelAssistedBenchmarkSource;
  vocabularyMiss: boolean;
  prompt: string;
  strict: boolean;
  capabilities: string[];
  proposalMode: ModelAssistedProposalMode;
  proposal?: CapturedRoutingProposal;
  expected: ModelAssistedBenchmarkExpected;
};

export type ModelAssistedBenchmarkFixture = {
  schemaVersion: typeof benchmarkSchemaVersion;
  cases: ModelAssistedBenchmarkCase[];
};

type CatalogBinding = {
  catalogDigest: string;
  catalogReceipt: string;
};

type PreparedEvaluation = {
  status: EvaluatedStatus;
  primarySkillId?: string;
  selectedSkillIds: string[];
  selectedSkillIdsByRole: RoleAwareSelections;
  selectedSkillCount: number;
  instructionBytes: number;
  warnings: string[];
  reasonCode?: string;
  errorCode?: EvaluationErrorCode;
  runFileCount: number;
  privacyLeakageCount: number;
  deterministicKey?: string;
  questionIds: string[];
  routingMode?: RoutingMode;
};

type CatalogEvaluation = {
  domainsOnFirstPage: boolean;
  skillsExactlyOnce: boolean;
  canonicalOrder: boolean;
  completeReceipt: boolean;
  multiplePages: boolean;
  pageSizesBounded: boolean;
  cursorChainValid: boolean;
  deterministicReplay: boolean;
};

export const modelAssistedEvalThresholds = {
  vocabularyMissRecovery: 0.8,
  benchmarkCaseFailures: 0,
  irrelevantSelectionRate: 0,
  forbiddenSelectionRate: 0,
  privacyLeakageCount: 0,
  hardVetoFailures: 0,
  malformedProposalRejectionRate: 1,
  invalidProposalFallbackNotWorse: true,
  absentProposalFallbackUnchanged: true,
  deterministicReplay: true,
  contractFailures: 0,
  roleAwareFullSetRecall: 0.9,
} as const;

export type ModelAssistedEvalReport = {
  schemaVersion: "router-model-assisted-eval/1.0";
  execution: "captured-proposals-only";
  thresholds: typeof modelAssistedEvalThresholds;
  deterministicCorpusRegression: boolean;
  contracts: {
    schemaVersion: "router-contract-eval/1.0";
    caseCount: number;
    passed: number;
    failed: number;
    results: Array<{
      id: string;
      kind: RoutingProposalContractKind;
      passed: boolean;
      observed?: Record<string, unknown>;
      errorCode?: EvaluationErrorCode;
    }>;
  };
  benchmark: {
    schemaVersion: "router-model-assisted-benchmark/1.0";
    caseCount: number;
    results: Array<{
      id: string;
      source: ModelAssistedBenchmarkSource;
      proposalMode: ModelAssistedProposalMode;
      passed: boolean;
      fallback: Omit<PreparedEvaluation, "privacyLeakageCount">;
      assisted: Omit<PreparedEvaluation, "privacyLeakageCount">;
      fallbackUnchanged: boolean;
      fallbackNotWorse: boolean;
      privacyLeakageCount: number;
      forbiddenSelectedSkillIds: string[];
      irrelevantSelectedSkillIds: string[];
      deterministicReplay: boolean;
      recall?: RoleRecall;
    }>;
    metrics: {
      caseFailures: number;
      primaryAccuracy: number;
      vocabularyMissRecovery: number;
      irrelevantSelectionRate: number;
      forbiddenSelectionRate: number;
      averageSelectedSkillCount: number;
      instructionByteCost: number;
      averageInstructionByteCost: number;
      malformedProposalFallbackBehavior: number;
      invalidProposalFallbackNotWorse: boolean;
      absentProposalFallbackUnchanged: boolean;
      hardVetoFailures: number;
      privacyLeakageCount: number;
      deterministicReplay: boolean;
      roleAwareCaseCount: number;
      roleAwareFullSetRecall: number;
      rolePrimaryRecall: number;
      roleCompanionRecall: number;
      roleVerificationRecall: number;
    };
  };
  promotion: {
    verdict: "promotable" | "blocked";
    blockingReasons: string[];
  };
};

const fail = (message: string): never => {
  throw new Error(message);
};

const contractExpectedFields: Record<RoutingProposalContractKind, { required: string[]; optional: string[] }> = {
  catalog: { required: ["domainsOnFirstPage", "skillsExactlyOnce", "canonicalOrder", "completeReceipt", "multiplePages", "pageSizesBounded", "cursorChainValid", "deterministicReplay"], optional: [] },
  "proposal-grounding": { required: ["acceptedSkillIds", "rejections"], optional: [] },
  "proposal-ownership": { required: ["errorCode", "noPersistence"], optional: [] },
  "item-rejection": { required: ["acceptedSkillIds", "rejections"], optional: [] },
  precedence: { required: ["fallbackPrimarySkillId", "assistedStatus", "assistedPrimarySkillId", "noPersistenceOnFailure"], optional: [] },
  "hard-veto": { required: ["assistedStatus", "noForbiddenSelection"], optional: ["assistedPrimarySkillId", "reasonCode", "noPersistence"] },
  strict: { required: ["assistedStatus", "noPersistenceOnFailure"], optional: ["assistedPrimarySkillId", "rejectedSkillId", "missingSkillId", "doesNotSubstitute"] },
  ambiguity: { required: ["assistedStatus", "noPersistence", "questionId"], optional: [] },
  refresh: { required: ["assistedStatus", "reasonCode", "noPersistence", "refreshStatus", "recoveredPrimarySkillId"], optional: [] },
  "privacy-replay": { required: ["assistedStatus", "assistedPrimarySkillId", "privacyLeakageCount", "deterministicReplay"], optional: [] },
  "proposal-absent": { required: ["fallbackPrimarySkillId", "assistedStatus", "assistedPrimarySkillId", "unchanged"], optional: [] },
};

const record = (value: unknown, at: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${at} must be an object.`);
  return value as Record<string, unknown>;
};

const exactKeys = (value: Record<string, unknown>, required: string[], optional: string[], at: string) => {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) fail(`${at}.${unknown} is not allowed.`);
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (missing) fail(`${at}.${missing} is required.`);
};

const stringValue = (value: unknown, at: string, nonEmpty = true): string => {
  if (typeof value !== "string" || (nonEmpty && value.length === 0)) fail(`${at} must be a non-empty string.`);
  return value as string;
};

const canonicalId = (value: unknown, at: string) => {
  const result = stringValue(value, at);
  if (!canonicalIdPattern.test(result)) fail(`${at} must be a canonical ID.`);
  return result;
};

const stringArray = (value: unknown, at: string, ids = false): string[] => {
  if (!Array.isArray(value)) fail(`${at} must be an array.`);
  const result = (value as unknown[]).map((item, index) => ids ? canonicalId(item, `${at}[${index}]`) : stringValue(item, `${at}[${index}]`));
  if (new Set(result).size !== result.length) fail(`${at} must contain unique values.`);
  return result;
};

const bool = (value: unknown, at: string): boolean => {
  if (typeof value !== "boolean") fail(`${at} must be a boolean.`);
  return value as boolean;
};

// The captured proposal is fixture data, not a validated routing proposal: only
// its JSON envelope is checked here. Shape (schema, limits, canonical ids) and
// semantics (catalog binding, owner scoping, nomination rules) are validated by
// the routing pipeline itself on every proposal-backed evaluation, so the
// harness never duplicates the pipeline's proposal validators.
const validateCapturedProposal = (value: unknown, at: string): CapturedRoutingProposal => {
  const proposal = record(value, at);
  exactKeys(proposal, ["schemaVersion", "catalogDigest", "catalogReceipt", "interpretation", "nominations"], ["ambiguity"], at);
  if (proposal.schemaVersion !== "routing-proposal/1.0") fail(`${at}.schemaVersion is invalid.`);
  return structuredClone(value) as CapturedRoutingProposal;
};

const readJson = async (filePath: string) => {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Could not read router evaluation fixture ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const loadRoutingProposalContractFixtures = async (filePath: string): Promise<RoutingProposalContractFixture> => {
  const root = record(await readJson(filePath), "router contract fixture");
  exactKeys(root, ["schemaVersion", "catalog", "cases"], [], "router contract fixture");
  if (root.schemaVersion !== contractSchemaVersion) fail("router contract fixture has an unsupported schemaVersion.");
  const catalog = record(root.catalog, "router contract fixture.catalog");
  exactKeys(catalog, ["expectedDomainIds", "expectedSkillIds", "pageMaxItems"], [], "router contract fixture.catalog");
  const expectedDomainIds = stringArray(catalog.expectedDomainIds, "router contract fixture.catalog.expectedDomainIds", true);
  const expectedSkillIds = stringArray(catalog.expectedSkillIds, "router contract fixture.catalog.expectedSkillIds", true);
  if (typeof catalog.pageMaxItems !== "number" || !Number.isSafeInteger(catalog.pageMaxItems) || catalog.pageMaxItems < 1) fail("router contract fixture.catalog.pageMaxItems must be a positive integer.");
  if (!Array.isArray(root.cases) || root.cases.length === 0) fail("router contract fixture.cases must not be empty.");
  const cases = (root.cases as unknown[]).map((rawCase, index) => {
    const value = record(rawCase, `router contract fixture.cases[${index}]`);
    exactKeys(value, ["id", "kind", "expected"], ["prompt", "proposal", "strict", "capabilities"], `router contract fixture.cases[${index}]`);
    const id = canonicalId(value.id, `router contract fixture.cases[${index}].id`);
    if (typeof value.kind !== "string" || !contractKinds.has(value.kind as RoutingProposalContractKind)) fail(`router contract fixture.cases[${index}].kind is invalid.`);
    const kind = value.kind as RoutingProposalContractKind;
    const prompt = value.prompt === undefined ? undefined : stringValue(value.prompt, `router contract fixture.cases[${index}].prompt`);
    const proposal = value.proposal === undefined ? undefined : validateCapturedProposal(value.proposal, `router contract fixture.cases[${index}].proposal`);
    if (value.strict !== undefined) bool(value.strict, `router contract fixture.cases[${index}].strict`);
    const capabilities = value.capabilities === undefined ? undefined : stringArray(value.capabilities, `router contract fixture.cases[${index}].capabilities`, true);
    const expected = record(value.expected, `router contract fixture.cases[${index}].expected`);
    const expectedFields = contractExpectedFields[kind as RoutingProposalContractKind];
    exactKeys(expected, expectedFields.required, expectedFields.optional, `router contract fixture.cases[${index}].expected`);
    if (kind !== "catalog" && prompt === undefined) fail(`router contract fixture.cases[${index}].prompt is required for ${kind}.`);
    if (kind !== "proposal-absent" && kind !== "catalog" && proposal === undefined) fail(`router contract fixture.cases[${index}].proposal is required for ${kind}.`);
    return { id, kind, ...(prompt === undefined ? {} : { prompt }), ...(proposal === undefined ? {} : { proposal }), ...(value.strict === undefined ? {} : { strict: value.strict as boolean }), ...(capabilities === undefined ? {} : { capabilities }), expected: structuredClone(expected) };
  });
  if (new Set(cases.map(({ id }) => id)).size !== cases.length) fail("router contract fixture case IDs must be unique.");
  return { schemaVersion: contractSchemaVersion, catalog: { expectedDomainIds, expectedSkillIds, pageMaxItems: catalog.pageMaxItems as number }, cases };
};

const parseRoleAwareSelections = (value: unknown, at: string): RoleAwareSelections => {
  const selections = record(value, at);
  exactKeys(selections, ["primary", "companion", "verification"], [], at);
  return {
    primary: stringArray(selections.primary, `${at}.primary`, true),
    companion: stringArray(selections.companion, `${at}.companion`, true),
    verification: stringArray(selections.verification, `${at}.verification`, true),
  };
};

export const loadRoutingProposalBenchmarkFixtures = async (filePath: string): Promise<ModelAssistedBenchmarkFixture> => {
  const root = record(await readJson(filePath), "router model-assisted fixture");
  exactKeys(root, ["schemaVersion", "cases"], [], "router model-assisted fixture");
  if (root.schemaVersion !== benchmarkSchemaVersion) fail("router model-assisted fixture has an unsupported schemaVersion.");
  if (!Array.isArray(root.cases) || root.cases.length === 0) fail("router model-assisted fixture.cases must not be empty.");
  const cases = (root.cases as unknown[]).map((rawCase, index) => {
    const value = record(rawCase, `router model-assisted fixture.cases[${index}]`);
    exactKeys(value, ["id", "source", "vocabularyMiss", "prompt", "strict", "capabilities", "proposalMode", "expected"], ["proposal"], `router model-assisted fixture.cases[${index}]`);
    const id = canonicalId(value.id, `router model-assisted fixture.cases[${index}].id`);
    if (typeof value.source !== "string" || !benchmarkSources.has(value.source as ModelAssistedBenchmarkSource)) fail(`router model-assisted fixture.cases[${index}].source is invalid.`);
    const source = value.source as ModelAssistedBenchmarkSource;
    const vocabularyMiss = bool(value.vocabularyMiss, `router model-assisted fixture.cases[${index}].vocabularyMiss`);
    const prompt = stringValue(value.prompt, `router model-assisted fixture.cases[${index}].prompt`);
    const strict = bool(value.strict, `router model-assisted fixture.cases[${index}].strict`);
    const capabilities = stringArray(value.capabilities, `router model-assisted fixture.cases[${index}].capabilities`, true);
    if (typeof value.proposalMode !== "string" || !proposalModes.has(value.proposalMode as ModelAssistedProposalMode)) fail(`router model-assisted fixture.cases[${index}].proposalMode is invalid.`);
    const proposalMode = value.proposalMode as ModelAssistedProposalMode;
    const proposal = value.proposal === undefined ? undefined : validateCapturedProposal(value.proposal, `router model-assisted fixture.cases[${index}].proposal`);
    if (proposalMode === "absent" && proposal !== undefined) fail(`router model-assisted fixture.cases[${index}] must omit proposal in absent mode.`);
    if (proposalMode !== "absent" && proposal === undefined) fail(`router model-assisted fixture.cases[${index}] requires proposal in ${proposalMode} mode.`);
    const expectedRecord = record(value.expected, `router model-assisted fixture.cases[${index}].expected`);
    exactKeys(expectedRecord, ["status", "allowedSkillIds", "forbiddenSkillIds"], ["primarySkillId", "fallbackStatus", "fallbackPrimarySkillId", "fallbackUnchanged", "fallbackNotWorse", "malformedRejected", "catalogIntegrityException", "errorCode", "requiredSkillIds", "roleAssignments"], `router model-assisted fixture.cases[${index}].expected`);
    const status = stringValue(expectedRecord.status, `router model-assisted fixture.cases[${index}].expected.status`);
    if (!resultStatuses.has(status as EvaluatedStatus)) fail(`router model-assisted fixture.cases[${index}].expected.status is invalid.`);
    const fallbackStatus = expectedRecord.fallbackStatus === undefined ? undefined : stringValue(expectedRecord.fallbackStatus, `router model-assisted fixture.cases[${index}].expected.fallbackStatus`);
    if (fallbackStatus !== undefined && !resultStatuses.has(fallbackStatus as EvaluatedStatus)) fail(`router model-assisted fixture.cases[${index}].expected.fallbackStatus is invalid.`);
    const errorCode = expectedRecord.errorCode === undefined ? undefined : stringValue(expectedRecord.errorCode, `router model-assisted fixture.cases[${index}].expected.errorCode`);
    if (errorCode !== undefined && errorCode !== "evaluation-error" && !routingPipelineErrorCodes.has(errorCode as RoutingPipelineErrorCode)) fail(`router model-assisted fixture.cases[${index}].expected.errorCode is invalid.`);
    const allowedSkillIds = stringArray(expectedRecord.allowedSkillIds, `router model-assisted fixture.cases[${index}].expected.allowedSkillIds`, true);
    const forbiddenSkillIds = stringArray(expectedRecord.forbiddenSkillIds, `router model-assisted fixture.cases[${index}].expected.forbiddenSkillIds`, true);
    const expected: ModelAssistedBenchmarkExpected = {
      status: status as EvaluatedStatus,
      allowedSkillIds,
      forbiddenSkillIds,
      ...(expectedRecord.primarySkillId === undefined ? {} : { primarySkillId: canonicalId(expectedRecord.primarySkillId, `router model-assisted fixture.cases[${index}].expected.primarySkillId`) }),
      ...(fallbackStatus === undefined ? {} : { fallbackStatus: fallbackStatus as EvaluatedStatus }),
      ...(expectedRecord.fallbackPrimarySkillId === undefined ? {} : { fallbackPrimarySkillId: canonicalId(expectedRecord.fallbackPrimarySkillId, `router model-assisted fixture.cases[${index}].expected.fallbackPrimarySkillId`) }),
      ...(expectedRecord.fallbackUnchanged === undefined ? {} : { fallbackUnchanged: bool(expectedRecord.fallbackUnchanged, `router model-assisted fixture.cases[${index}].expected.fallbackUnchanged`) }),
      ...(expectedRecord.fallbackNotWorse === undefined ? {} : { fallbackNotWorse: bool(expectedRecord.fallbackNotWorse, `router model-assisted fixture.cases[${index}].expected.fallbackNotWorse`) }),
      ...(expectedRecord.malformedRejected === undefined ? {} : { malformedRejected: bool(expectedRecord.malformedRejected, `router model-assisted fixture.cases[${index}].expected.malformedRejected`) }),
      ...(expectedRecord.catalogIntegrityException === undefined ? {} : { catalogIntegrityException: bool(expectedRecord.catalogIntegrityException, `router model-assisted fixture.cases[${index}].expected.catalogIntegrityException`) }),
      ...(expectedRecord.roleAssignments === undefined ? {} : { roleAssignments: parseRoleAwareSelections(expectedRecord.roleAssignments, `router model-assisted fixture.cases[${index}].expected.roleAssignments`) }),
      ...(expectedRecord.requiredSkillIds === undefined ? {} : { requiredSkillIds: stringArray(expectedRecord.requiredSkillIds, `router model-assisted fixture.cases[${index}].expected.requiredSkillIds`, true) }),
      ...(errorCode === undefined ? {} : { errorCode: errorCode as EvaluationErrorCode }),
    };
    return { id, source, vocabularyMiss, prompt, strict, capabilities, proposalMode, ...(proposal === undefined ? {} : { proposal }), expected };
  });
  if (new Set(cases.map(({ id }) => id)).size !== cases.length) fail("router model-assisted fixture case IDs must be unique.");
  return { schemaVersion: benchmarkSchemaVersion, cases };
};

const sourceOptions = (root: string) => ({
  registryRoot: path.join(root, "registry"),
  domainsRoot: path.join(root, "domains"),
});

// The preloaded-metadata input contract is shared with production: the Routing
// world loader builds router packs, skill metadata, routing packs, and the
// routing context once per distinct case intent (deduplicated below, so the
// fallback/assisted/replay decisions of one case share a single world build);
// the catalog snapshot loads once per evaluation run (catalog snapshots stay
// adapter-owned). Evaluations then route through the Routing entry — the same
// deep entry as task preparation — and consume the routing decision with no
// disk persistence.
type LoadedEvalInput = {
  binding: CatalogBinding;
  catalog: SkillCatalogSnapshot;
};

type BuiltEvalMetadata = {
  world: Awaited<ReturnType<typeof loadRoutingWorld>>;
  fingerprint: ProjectFingerprint;
  skillById: Map<string, RouterSkillMetadata>;
};

// The world is intent-dependent (domain routing policies apply per-case intent
// adjustments to each skill's metadata), so it can never be hoisted to a single
// run-wide load; it is instead built once per distinct intent within the run.
// Every decision call of one case shares the same normalized intent, so without
// this dedup the full registry/pack/metadata/context rebuild would repeat once
// per decision call — a real regression against the once-per-case contract.
const evalMetadataCache = new Map<string, Promise<BuiltEvalMetadata>>();

const buildEvalMetadata = (root: string, intent: string): Promise<BuiltEvalMetadata> => {
  const key = `${root}\0${intent}`;
  const cached = evalMetadataCache.get(key);
  if (cached !== undefined) return cached;
  // Model-assisted evals enter through the same Routing world loader as task
  // preparation and the golden evaluations, with the case's normalized intent;
  // installed marking stays an explicit empty input so determinism never
  // depends on the machine's lockfile.
  const built = loadRoutingWorld({
    registry: { kind: "bundled", root: sourceOptions(root).registryRoot },
    projectRoot: root,
    targetAgent: "codex",
    skillInputs: {},
    intent,
    installed: [],
  }).then((world) => ({
    world,
    fingerprint: emptyFingerprint(root),
    skillById: skillIndexById(world.skills),
  }));
  evalMetadataCache.set(key, built);
  return built;
};

const collectCatalog = async (root: string, maxItems: number, now: number) => {
  const options = sourceOptions(root);
  const pages: SkillCatalogPage[] = [];
  let page = await inspectSkillCatalog({ maxItems, maxBytes: 256_000 }, { ...options, now });
  pages.push(page);
  while (!page.complete) {
    page = await inspectSkillCatalog({ cursor: page.nextCursor!, expectedCatalogDigest: page.catalogDigest }, { ...options, now });
    pages.push(page);
  }
  const snapshot = await buildSkillCatalog(options);
  return { pages, snapshot };
};

const currentCatalogBinding = async (root: string): Promise<CatalogBinding> => {
  const now = Date.now();
  const { pages } = await collectCatalog(root, 2, now);
  const page = pages.at(-1);
  if (page === undefined) throw new Error("complete catalog evaluation did not produce a page.");
  const receipt = page.catalogReceipt;
  if (receipt === undefined) throw new Error("complete catalog evaluation did not produce a receipt.");
  assertValidCatalogReceipt(receipt, page.catalogDigest, { expectedItemCount: pages.reduce((sum, item) => sum + item.skills.length, 0), now });
  return { catalogDigest: page.catalogDigest, catalogReceipt: receipt };
};

const loadEvalInput = async (root: string): Promise<LoadedEvalInput> => ({
  binding: await currentCatalogBinding(root),
  catalog: await buildSkillCatalog(sourceOptions(root)),
});

const materializeProposal = (captured: CapturedRoutingProposal, binding: CatalogBinding): RoutingProposalInput => {
  const value = structuredClone(captured) as unknown as Record<string, unknown>;
  if (value.catalogDigest === "$catalogDigest") value.catalogDigest = binding.catalogDigest;
  if (value.catalogDigest === "$staleCatalogDigest") value.catalogDigest = `sha256:${"0".repeat(64)}`;
  if (value.catalogReceipt === "$catalogReceipt") value.catalogReceipt = binding.catalogReceipt;
  return value as unknown as RoutingProposalInput;
};

const statusFor = (status: RoutingPipelineDecision["outcome"]["status"]): EvaluatedStatus =>
  publicOutcomeStatus(status) as EvaluatedStatus;

const roleAwareRoles: readonly RoleAwareRole[] = ["primary", "companion", "verification"];

const emptyRoleSelections = (): RoleAwareSelections => ({ primary: [], companion: [], verification: [] });

const summarizeDecision = (prompt: string, decision: RoutingPipelineDecision, skillById: Map<string, RouterSkillMetadata>): PreparedEvaluation => {
  const outcome = decision.outcome;
  const refresh = outcome.status === "catalog_refresh_required";
  const selections = outcome.status === "prepared" ? outcome.selections : undefined;
  const selectedSkillIds = outcome.status === "prepared" ? outcome.selectedSkillIds : [];
  const selectedSkillIdsByRole: RoleAwareSelections = selections
    ? {
        primary: [selections.primary.skillId],
        companion: selections.companions.map(({ skillId }) => skillId),
        verification: selections.verification.map(({ skillId }) => skillId),
      }
    : emptyRoleSelections();
  const serialized = JSON.stringify(decision);
  return {
    status: statusFor(outcome.status),
    ...(selections ? { primarySkillId: selections.primary.skillId } : {}),
    selectedSkillIds,
    selectedSkillIdsByRole,
    selectedSkillCount: selectedSkillIds.length,
    instructionBytes: selectedSkillIds.reduce((sum, skillId) => sum + (skillById.get(canonicalSkillId(skillId))?.instructionBytes ?? 0), 0),
    // Warnings come from the decision as produced by the pipeline, which owns
    // the stable semantic-recall-limited warning for fallback routed outcomes;
    // refresh outcomes carry no routing shape at all.
    warnings: refresh ? [] : [...new Set(decision.warnings)],
    ...(outcome.status === "no_matching_skills" || refresh ? { reasonCode: outcome.reasonCode } : {}),
    // Evaluations never touch disk: the no-persistence property holds by
    // construction, and the run file count is always zero.
    runFileCount: 0,
    privacyLeakageCount: privacyLeakageCountFor(prompt, serialized),
    ...(refresh ? {} : { routingMode: decision.mode }),
    questionIds: outcome.status === "clarification_required" ? outcome.clarification.questions.map(({ id }) => id) : [],
  };
};

const errorCodeFor = (error: unknown): EvaluationErrorCode => {
  if (error instanceof RoutingPipelineError) return error.code;
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && routingPipelineErrorCodes.has(code as RoutingPipelineErrorCode)
    ? code as RoutingPipelineErrorCode
    : "evaluation-error";
};

const runDecision = async (root: string, input: {
  prompt: string;
  strict?: boolean;
  capabilities?: string[];
  proposal?: CapturedRoutingProposal;
}, loaded: LoadedEvalInput): Promise<PreparedEvaluation> => {
  try {
    const parsed = parseTrigger({ prompt: input.prompt, mode: "explicit" });
    if (!parsed.activated) throw new Error(`evaluation prompt is not explicitly activated: ${parsed.reason}`);
    const proposal = input.proposal === undefined ? undefined : materializeProposal(input.proposal, loaded.binding);
    const metadata = await buildEvalMetadata(root, parsed.normalizedIntent);
    // The entry owns capability normalization and pipeline input assembly with
    // production semantics; the eval passes the raw fixture capability list.
    const decision = runRoutingEntry({
      world: metadata.world,
      fingerprint: metadata.fingerprint,
      trigger: parsed,
      activation: { mode: "explicit" },
      targetAgent: "codex",
      strict: input.strict ?? false,
      capabilities: input.capabilities ?? [],
      routingDate: routerEvalRoutingDate,
      ...(proposal === undefined ? {} : { catalog: loaded.catalog, routingProposal: proposal }),
    });
    return summarizeDecision(input.prompt, decision, metadata.skillById);
  } catch (error) {
    return {
      status: "error",
      selectedSkillIds: [],
      selectedSkillIdsByRole: emptyRoleSelections(),
      selectedSkillCount: 0,
      instructionBytes: 0,
      warnings: [],
      errorCode: errorCodeFor(error),
      runFileCount: 0,
      privacyLeakageCount: privacyLeakageCountFor(input.prompt, JSON.stringify(String(error))),
      questionIds: [],
    };
  }
};

const comparable = (result: PreparedEvaluation) => canonicalizeJson({
  status: result.status,
  primarySkillId: result.primarySkillId,
  selectedSkillIds: result.selectedSkillIds,
  instructionBytes: result.instructionBytes,
  warnings: result.warnings,
  reasonCode: result.reasonCode,
  errorCode: result.errorCode,
  deterministicKey: result.deterministicKey,
  questionIds: result.questionIds,
});

const runCatalogContract = async (root: string, fixture: RoutingProposalContractFixture): Promise<CatalogEvaluation> => {
  const now = Date.now();
  const first = await collectCatalog(root, fixture.catalog.pageMaxItems, now);
  const replay = await collectCatalog(root, fixture.catalog.pageMaxItems, now);
  const pages = first.pages;
  const skillIds = pages.flatMap(({ skills }) => skills.map(({ skillId }) => skillId));
  const replayIds = replay.pages.flatMap(({ skills }) => skills.map(({ skillId }) => skillId));
  const finalPage = pages.at(-1);
  const expectedSkills = fixture.catalog.expectedSkillIds;
  const expectedDomains = fixture.catalog.expectedDomainIds;
  const domainsOnFirstPage = canonicalizeJson(pages[0]?.domains.map(({ domainId }) => domainId) ?? []) === canonicalizeJson(expectedDomains) && pages.slice(1).every(({ domains }) => domains.length === 0);
  const skillsExactlyOnce = skillIds.length === expectedSkills.length && new Set(skillIds).size === skillIds.length && canonicalizeJson([...skillIds].sort()) === canonicalizeJson([...expectedSkills].sort());
  const canonicalOrder = canonicalizeJson(skillIds) === canonicalizeJson([...skillIds].sort()) && pages.every(({ skills }) => canonicalizeJson(skills.map(({ skillId }) => skillId)) === canonicalizeJson([...skills].map(({ skillId }) => skillId).sort()));
  const page = finalPage;
  if (page === undefined) throw new Error("catalog evaluation did not reach a complete receipt page.");
  const receipt = page.catalogReceipt;
  if (receipt === undefined) throw new Error("catalog evaluation did not reach a complete receipt page.");
  const completeReceipt = Boolean(page.complete && receipt);
  if (completeReceipt) assertValidCatalogReceipt(receipt, page.catalogDigest, { expectedItemCount: skillIds.length, now });
  const multiplePages = pages.length > 1;
  const pageSizesBounded = multiplePages && pages.every(({ skills }) => skills.length > 0 && skills.length <= fixture.catalog.pageMaxItems);
  const cursorChainValid = multiplePages &&
    pages.slice(0, -1).every(({ complete, nextCursor }) => !complete && typeof nextCursor === "string" && nextCursor.length > 0) &&
    page.complete && page.nextCursor === null && page.catalogReceipt !== undefined;
  const deterministicReplay = canonicalizeJson(first.pages) === canonicalizeJson(replay.pages) && canonicalizeJson(skillIds) === canonicalizeJson(replayIds);
  return { domainsOnFirstPage, skillsExactlyOnce, canonicalOrder, completeReceipt, multiplePages, pageSizesBounded, cursorChainValid, deterministicReplay };
};

const contractExpected = (kind: RoutingProposalContractKind, expected: Record<string, unknown>, observed: Record<string, unknown>) => {
  switch (kind) {
    case "catalog":
      return Object.entries(expected).every(([key, value]) => observed[key] === value);
    case "proposal-grounding":
    case "item-rejection":
      return canonicalizeJson(observed.acceptedSkillIds) === canonicalizeJson(expected.acceptedSkillIds) && canonicalizeJson(observed.rejections) === canonicalizeJson(expected.rejections);
    case "proposal-ownership":
      return observed.errorCode === expected.errorCode && observed.noPersistence === expected.noPersistence;
    case "precedence":
    case "hard-veto":
    case "strict":
    case "ambiguity":
    case "refresh":
    case "privacy-replay":
    case "proposal-absent":
      return Object.entries(expected).every(([key, value]) => canonicalizeJson(observed[key]) === canonicalizeJson(value));
  }
};

// Grounding and item-rejection contracts observe the pipeline's own proposal
// validation output: the validated projection rides inside the routing decision
// (accepted nominations and rejection reasons), so the harness never calls the
// proposal validators directly. This pass is the hardcoded always-with-catalog
// shape of the entry: non-strict and proposal-backed by construction.
const runProposalGrounding = async (root: string, prompt: string, capabilities: string[] | undefined, proposal: CapturedRoutingProposal, loaded: LoadedEvalInput) => {
  const parsed = parseTrigger({ prompt, mode: "explicit" });
  if (!parsed.activated) throw new Error(`evaluation prompt is not explicitly activated: ${parsed.reason}`);
  const metadata = await buildEvalMetadata(root, parsed.normalizedIntent);
  const decision = runRoutingEntry({
    world: metadata.world,
    fingerprint: metadata.fingerprint,
    trigger: parsed,
    activation: { mode: "explicit" },
    targetAgent: "codex",
    strict: false,
    capabilities: capabilities ?? [],
    routingDate: routerEvalRoutingDate,
    catalog: loaded.catalog,
    routingProposal: materializeProposal(proposal, loaded.binding),
  });
  if (decision.outcome.status === "catalog_refresh_required") throw new Error(`${prompt} grounding run requested a catalog refresh.`);
  return {
    acceptedSkillIds: decision.routingProposal?.nominations.map(({ skillId }) => skillId) ?? [],
    rejections: decision.routingProposal?.rejections ?? [],
  };
};

const runContractCase = async (root: string, fixture: RoutingProposalContractFixture, item: RoutingProposalContractCase, loaded: LoadedEvalInput) => {
  const expected = item.expected;
  try {
    if (item.kind === "catalog") {
      const observed = await runCatalogContract(root, fixture);
      return { id: item.id, kind: item.kind, passed: contractExpected(item.kind, expected, observed), observed: observed as unknown as Record<string, unknown> };
    }
    const prompt = item.prompt;
    if (prompt === undefined) throw new Error(`${item.id} has no prompt.`);
    if (item.kind === "proposal-grounding" || item.kind === "item-rejection") {
      const proposal = item.proposal;
      if (proposal === undefined) throw new Error(`${item.id} has no proposal.`);
      const observed = await runProposalGrounding(root, prompt, item.capabilities, proposal, loaded);
      return { id: item.id, kind: item.kind, passed: contractExpected(item.kind, expected, observed), observed };
    }
    if (item.kind === "proposal-ownership") {
      const proposal = item.proposal;
      if (proposal === undefined) throw new Error(`${item.id} has no proposal.`);
      const prepared = await runDecision(root, { prompt, strict: item.strict, capabilities: item.capabilities, proposal }, loaded);
      const observed = { errorCode: prepared.errorCode, noPersistence: prepared.runFileCount === 0 };
      return { id: item.id, kind: item.kind, passed: contractExpected(item.kind, expected, observed), observed };
    }
    if (item.kind === "proposal-absent") {
      const fallback = await runDecision(root, { prompt, strict: item.strict, capabilities: item.capabilities }, loaded);
      const assisted = await runDecision(root, { prompt, strict: item.strict, capabilities: item.capabilities }, loaded);
      const observed = { fallbackPrimarySkillId: fallback.primarySkillId, assistedStatus: assisted.status, assistedPrimarySkillId: assisted.primarySkillId, unchanged: comparable(fallback) === comparable(assisted) };
      return { id: item.id, kind: item.kind, passed: contractExpected(item.kind, expected, observed), observed };
    }
    const proposal = item.proposal;
    if (proposal === undefined) throw new Error(`${item.id} has no proposal.`);
    const fallback = await runDecision(root, { prompt, strict: item.strict, capabilities: item.capabilities }, loaded);
    const assisted = await runDecision(root, { prompt, strict: item.strict, capabilities: item.capabilities, proposal }, loaded);
    const observed: Record<string, unknown> = {
      fallbackPrimarySkillId: fallback.primarySkillId,
      assistedStatus: assisted.status,
      assistedPrimarySkillId: assisted.primarySkillId,
      noPersistenceOnFailure: assisted.status === "prepared" || assisted.runFileCount === 0,
      rejectedSkillId: item.kind === "strict" && !item.strict ? proposal.nominations[0]?.skillId : undefined,
      missingSkillId: assisted.status === "strict_requirements_unmet" ? assisted.selectedSkillIds[0] ?? proposal.nominations[0]?.skillId : undefined,
      doesNotSubstitute: assisted.status !== "prepared" || assisted.primarySkillId === proposal.nominations[0]?.skillId,
      noPersistence: assisted.runFileCount === 0,
      reasonCode: assisted.reasonCode,
      questionId: assisted.questionIds[0],
      privacyLeakageCount: assisted.privacyLeakageCount,
      deterministicReplay: false,
    };
    if (item.kind === "refresh") {
      const refreshedProposal = structuredClone(proposal);
      refreshedProposal.catalogDigest = "$catalogDigest";
      const refreshed = await runDecision(root, { prompt, strict: item.strict, capabilities: item.capabilities, proposal: refreshedProposal }, loaded);
      observed.refreshStatus = refreshed.status;
      observed.recoveredPrimarySkillId = refreshed.primarySkillId;
    }
    if (item.kind === "hard-veto") {
      observed.noForbiddenSelection = !assisted.selectedSkillIds.includes("frontend.design-to-code");
    }
    if (item.kind === "privacy-replay") {
      const replay = await runDecision(root, { prompt, strict: item.strict, capabilities: item.capabilities, proposal }, loaded);
      observed.deterministicReplay = comparable(assisted) === comparable(replay);
    }
    return { id: item.id, kind: item.kind, passed: contractExpected(item.kind, expected, observed), observed };
  } catch (error) {
    return { id: item.id, kind: item.kind, passed: false, errorCode: errorCodeFor(error) };
  }
};

export const evaluateRoutingProposalContracts = async (root = process.cwd()): Promise<ModelAssistedEvalReport["contracts"]> => {
  const fixture = await loadRoutingProposalContractFixtures(path.join(root, "evals", "router", "contracts.json"));
  const loaded = await loadEvalInput(root);
  const results: ModelAssistedEvalReport["contracts"]["results"] = [];
  for (const item of fixture.cases) results.push(await runContractCase(root, fixture, item, loaded));
  return {
    schemaVersion: "router-contract-eval/1.0",
    caseCount: results.length,
    passed: results.filter(({ passed }) => passed).length,
    failed: results.filter(({ passed }) => !passed).length,
    results,
  };
};

const outcomeNotWorse = (fallback: PreparedEvaluation, assisted: PreparedEvaluation) => {
  if (assisted.status === "error") return false;
  if (fallback.status === "prepared") {
    return assisted.status === "prepared" &&
      assisted.primarySkillId === fallback.primarySkillId &&
      fallback.selectedSkillIds.every((skillId) => assisted.selectedSkillIds.includes(skillId));
  }
  return true;
};

const rounded3 = (value: number) => Number(value.toFixed(3));

const roleRatio = (matched: number, expectedCount: number) => expectedCount === 0 ? 1 : rounded3(matched / expectedCount);

const fullSetRatio = (counts: RoleRecallCounts) => {
  const expectedTotal = roleAwareRoles.reduce((sum, role) => sum + counts[role].expectedCount, 0);
  const matchedTotal = roleAwareRoles.reduce((sum, role) => sum + counts[role].matched, 0);
  return expectedTotal === 0 ? 1 : rounded3(matchedTotal / expectedTotal);
};

const roleRecallCounts = (expected: RoleAwareSelections, observed: RoleAwareSelections): RoleRecallCounts => {
  const counts = {} as RoleRecallCounts;
  for (const role of roleAwareRoles) {
    counts[role] = {
      matched: expected[role].filter((skillId) => observed[role].includes(skillId)).length,
      expectedCount: expected[role].length,
    };
  }
  return counts;
};

const computeRoleRecall = (expected: RoleAwareSelections, observed: RoleAwareSelections): RoleRecall => {
  const counts = roleRecallCounts(expected, observed);
  return {
    fullSet: fullSetRatio(counts),
    primary: roleRatio(counts.primary.matched, counts.primary.expectedCount),
    companion: roleRatio(counts.companion.matched, counts.companion.expectedCount),
    verification: roleRatio(counts.verification.matched, counts.verification.expectedCount),
    missedRoles: roleAwareRoles.filter((role) => counts[role].expectedCount > 0 && counts[role].matched < counts[role].expectedCount),
    expected: structuredClone(expected),
    observed: structuredClone(observed),
    counts,
  };
};

const benchmarkExpectedMatch = (expected: ModelAssistedBenchmarkExpected, assisted: PreparedEvaluation) => {
  if (assisted.status !== expected.status) return false;
  if (expected.primarySkillId !== undefined && assisted.primarySkillId !== expected.primarySkillId) return false;
  if (expected.errorCode !== undefined && assisted.errorCode !== expected.errorCode) return false;
  return true;
};

const benchmarkFallbackMatch = (expected: ModelAssistedBenchmarkExpected, fallback: PreparedEvaluation) => (
  (expected.fallbackStatus === undefined || fallback.status === expected.fallbackStatus) &&
  (expected.fallbackPrimarySkillId === undefined || fallback.primarySkillId === expected.fallbackPrimarySkillId)
);

const runBenchmarkCase = async (root: string, item: ModelAssistedBenchmarkCase, loaded: LoadedEvalInput, alwaysIncludedSkillIds: ReadonlySet<string>) => {
  const fallback = await runDecision(root, { prompt: item.prompt, strict: item.strict, capabilities: item.capabilities }, loaded);
  const assisted = await runDecision(root, { prompt: item.prompt, strict: item.strict, capabilities: item.capabilities, proposal: item.proposal }, loaded);
  const replay = await runDecision(root, { prompt: item.prompt, strict: item.strict, capabilities: item.capabilities, proposal: item.proposal }, loaded);
  const forbidden = assisted.selectedSkillIds.filter((skillId) => item.expected.forbiddenSkillIds.includes(skillId));
  // Core (universal) skills are always-on guidance in every prepared run, so
  // they can never be irrelevant selections; only task selections count here.
  const irrelevant = assisted.selectedSkillIds.filter((skillId) => !item.expected.allowedSkillIds.includes(skillId) && !alwaysIncludedSkillIds.has(skillId));
  const fallbackUnchanged = comparable(fallback) === comparable(assisted);
  const fallbackNotWorse = outcomeNotWorse(fallback, assisted);
  const deterministicReplay = comparable(assisted) === comparable(replay);
  const catalogIntegrityCheckPassed = item.expected.catalogIntegrityException === undefined || !item.expected.catalogIntegrityException ||
    (assisted.status === "catalog_refresh_required" && assisted.runFileCount === 0);
  const fallbackModeHonest = fallback.routingMode === "limited-deterministic-fallback" && fallback.warnings.includes(semanticRecallLimitedWarning);
  const assistedModeHonest = item.proposalMode === "current"
    ? assisted.routingMode === "model-assisted" && !assisted.warnings.includes(semanticRecallLimitedWarning)
    : item.proposalMode === "absent"
      ? assisted.routingMode === "limited-deterministic-fallback" && assisted.warnings.includes(semanticRecallLimitedWarning)
      : assisted.routingMode === undefined;
  const recall = item.expected.roleAssignments !== undefined && assisted.status === "prepared"
    ? computeRoleRecall(item.expected.roleAssignments, assisted.selectedSkillIdsByRole)
    : undefined;
  const recallMatch = recall === undefined || recall.fullSet === 1;
  const requiredSkillIdsMatch = (item.expected.requiredSkillIds ?? []).every((skillId) => assisted.selectedSkillIds.includes(skillId));
  const passed = benchmarkExpectedMatch(item.expected, assisted) &&
    benchmarkFallbackMatch(item.expected, fallback) &&
    forbidden.length === 0 &&
    irrelevant.length === 0 &&
    requiredSkillIdsMatch &&
    (!item.expected.fallbackUnchanged || fallbackUnchanged) &&
    (!item.expected.fallbackNotWorse || fallbackNotWorse) &&
    (!item.expected.malformedRejected || (assisted.status === "error" && assisted.runFileCount === 0)) &&
    catalogIntegrityCheckPassed &&
    fallbackModeHonest &&
    assistedModeHonest &&
    recallMatch;
  const { privacyLeakageCount, ...fallbackWithoutPrivacy } = fallback;
  const { privacyLeakageCount: assistedPrivacyLeakageCount, ...assistedWithoutPrivacy } = assisted;
  return {
    id: item.id,
    source: item.source,
    proposalMode: item.proposalMode,
    passed,
    fallback: fallbackWithoutPrivacy,
    assisted: assistedWithoutPrivacy,
    fallbackUnchanged,
    fallbackNotWorse,
    privacyLeakageCount: privacyLeakageCount + assistedPrivacyLeakageCount,
    forbiddenSelectedSkillIds: forbidden,
    irrelevantSelectedSkillIds: irrelevant,
    deterministicReplay,
    ...(recall === undefined ? {} : { recall }),
  };
};

export const evaluateRoutingProposalBenchmark = async (root = process.cwd()): Promise<ModelAssistedEvalReport["benchmark"]> => {
  const fixture = await loadRoutingProposalBenchmarkFixtures(path.join(root, "evals", "router", "model-assisted.json"));
  const loaded = await loadEvalInput(root);
  // Always-on core (universal) skills are derived from the live catalog so a
  // future core skill never needs an eval-code change.
  const alwaysIncludedSkillIds = new Set(loaded.catalog.skills.filter(({ domains }) => domains.includes("core")).map(({ skillId }) => skillId));
  const results: ModelAssistedEvalReport["benchmark"]["results"] = [];
  for (const item of fixture.cases) results.push(await runBenchmarkCase(root, item, loaded, alwaysIncludedSkillIds));
  const primaryCases = fixture.cases.filter(({ expected }) => expected.primarySkillId !== undefined);
  const vocabularyCases = fixture.cases.filter(({ vocabularyMiss }) => vocabularyMiss);
  const selectedCount = results.reduce((sum, result) => sum + result.assisted.selectedSkillCount, 0);
  const instructionByteCost = results.reduce((sum, result) => sum + result.assisted.instructionBytes, 0);
  const selectedTotal = results.reduce((sum, result) => sum + result.assisted.selectedSkillCount, 0);
  const irrelevantTotal = results.reduce((sum, result) => sum + result.irrelevantSelectedSkillIds.length, 0);
  const forbiddenTotal = results.reduce((sum, result) => sum + result.forbiddenSelectedSkillIds.length, 0);
  const forbiddenDenominator = fixture.cases.reduce((sum, item) => sum + item.expected.forbiddenSkillIds.length, 0);
  const primaryAccuracy = primaryCases.length === 0 ? 0 : Number((primaryCases.filter((item) => results.find(({ id }) => id === item.id)?.assisted.primarySkillId === item.expected.primarySkillId).length / primaryCases.length).toFixed(3));
  const vocabularyMissRecovery = vocabularyCases.length === 0 ? 0 : Number((vocabularyCases.filter((item) => results.find(({ id }) => id === item.id)?.assisted.status === "prepared" && results.find(({ id }) => id === item.id)?.assisted.primarySkillId === item.expected.primarySkillId).length / vocabularyCases.length).toFixed(3));
  const malformedCases = results.filter(({ proposalMode }) => proposalMode === "malformed");
  const invalidCases = fixture.cases.filter(({ expected }) => expected.fallbackNotWorse);
  const absentCases = fixture.cases.filter(({ expected }) => expected.fallbackUnchanged);
  const invalidResults = results.filter(({ id }) => invalidCases.some((item) => item.id === id));
  const absentResults = results.filter(({ id }) => absentCases.some((item) => item.id === id));
  const roleCases = fixture.cases.filter(({ expected }) => expected.roleAssignments !== undefined);
  const roleAwareCaseCount = roleCases.length;
  // The aggregate consumes each case's computed recall counts instead of re-deriving
  // per-case recall from the observed selections; a role-declaring case that did not
  // produce a prepared selection set counts its expected skills as missed.
  const roleAwareCounts = (() => {
    const totals = {} as RoleRecallCounts;
    for (const role of roleAwareRoles) totals[role] = { matched: 0, expectedCount: 0 };
    const recallById = new Map(results.map(({ id, recall }) => [id, recall]));
    for (const item of roleCases) {
      const expected = item.expected.roleAssignments;
      if (expected === undefined) continue;
      const recall = recallById.get(item.id);
      if (recall !== undefined) {
        for (const role of roleAwareRoles) {
          totals[role].matched += recall.counts[role].matched;
          totals[role].expectedCount += recall.counts[role].expectedCount;
        }
      } else {
        for (const role of roleAwareRoles) totals[role].expectedCount += expected[role].length;
      }
    }
    return totals;
  })();
  const roleRecallAggregate = (role: RoleAwareRole): number =>
    roleRatio(roleAwareCounts[role].matched, roleAwareCounts[role].expectedCount);
  const roleAwareFullSetRecall = fullSetRatio(roleAwareCounts);
  const metrics = {
    caseFailures: results.filter(({ passed }) => !passed).length,
    primaryAccuracy,
    vocabularyMissRecovery,
    irrelevantSelectionRate: selectedTotal === 0 ? 0 : Number((irrelevantTotal / selectedTotal).toFixed(3)),
    forbiddenSelectionRate: forbiddenDenominator === 0 ? 0 : Number((forbiddenTotal / forbiddenDenominator).toFixed(3)),
    averageSelectedSkillCount: Number((selectedCount / Math.max(results.length, 1)).toFixed(3)),
    instructionByteCost,
    averageInstructionByteCost: Number((instructionByteCost / Math.max(results.length, 1)).toFixed(3)),
    malformedProposalFallbackBehavior: malformedCases.length === 0 ? 1 : Number((malformedCases.filter(({ passed }) => passed).length / malformedCases.length).toFixed(3)),
    invalidProposalFallbackNotWorse: invalidResults.length === invalidCases.length && invalidResults.every(({ fallbackNotWorse }) => fallbackNotWorse),
    absentProposalFallbackUnchanged: absentResults.length === absentCases.length && absentResults.every(({ fallbackUnchanged }) => fallbackUnchanged),
    hardVetoFailures: results.filter(({ id, forbiddenSelectedSkillIds }) => {
      const item = fixture.cases.find((candidate) => candidate.id === id);
      return (item?.expected.forbiddenSkillIds.length ?? 0) > 0 && forbiddenSelectedSkillIds.length > 0;
    }).length,
    privacyLeakageCount: results.reduce((sum, result) => sum + result.privacyLeakageCount, 0),
    deterministicReplay: results.every(({ deterministicReplay }) => deterministicReplay),
    roleAwareCaseCount,
    roleAwareFullSetRecall,
    rolePrimaryRecall: roleRecallAggregate("primary"),
    roleCompanionRecall: roleRecallAggregate("companion"),
    roleVerificationRecall: roleRecallAggregate("verification"),
  };
  return {
    schemaVersion: "router-model-assisted-benchmark/1.0",
    caseCount: results.length,
    results,
    metrics,
  };
};

export const evaluateModelAssistedRouter = async (root = process.cwd(), options: { deterministicCorpusRegression?: boolean } = {}): Promise<ModelAssistedEvalReport> => {
  const contracts = await evaluateRoutingProposalContracts(root);
  const benchmark = await evaluateRoutingProposalBenchmark(root);
  const deterministicCorpusRegression = options.deterministicCorpusRegression ?? true;
  const blockingReasons: string[] = [];
  if (!deterministicCorpusRegression) blockingReasons.push("deterministic-corpus-regression");
  if (contracts.failed > modelAssistedEvalThresholds.contractFailures) blockingReasons.push("contract-evaluation-failed");
  if (benchmark.metrics.caseFailures > modelAssistedEvalThresholds.benchmarkCaseFailures) blockingReasons.push("benchmark-case-failed");
  if (benchmark.metrics.vocabularyMissRecovery < modelAssistedEvalThresholds.vocabularyMissRecovery) blockingReasons.push("vocabulary-miss-recovery-below-0.80");
  if (benchmark.metrics.irrelevantSelectionRate > modelAssistedEvalThresholds.irrelevantSelectionRate) blockingReasons.push("irrelevant-selection-rate-nonzero");
  if (benchmark.metrics.forbiddenSelectionRate > modelAssistedEvalThresholds.forbiddenSelectionRate) blockingReasons.push("forbidden-selection-rate-nonzero");
  if (benchmark.metrics.privacyLeakageCount > modelAssistedEvalThresholds.privacyLeakageCount) blockingReasons.push("privacy-leakage-detected");
  if (benchmark.metrics.hardVetoFailures > modelAssistedEvalThresholds.hardVetoFailures) blockingReasons.push("hard-veto-failed");
  if (benchmark.metrics.malformedProposalFallbackBehavior < modelAssistedEvalThresholds.malformedProposalRejectionRate) blockingReasons.push("malformed-proposal-not-rejected");
  if (benchmark.metrics.invalidProposalFallbackNotWorse !== modelAssistedEvalThresholds.invalidProposalFallbackNotWorse) blockingReasons.push("invalid-proposal-regressed-fallback");
  if (benchmark.metrics.absentProposalFallbackUnchanged !== modelAssistedEvalThresholds.absentProposalFallbackUnchanged) blockingReasons.push("proposal-absent-result-changed");
  if (benchmark.metrics.deterministicReplay !== modelAssistedEvalThresholds.deterministicReplay) blockingReasons.push("proposal-replay-nondeterministic");
  if (benchmark.metrics.roleAwareFullSetRecall < modelAssistedEvalThresholds.roleAwareFullSetRecall) blockingReasons.push("role-aware-full-set-recall-below-0.90");
  return {
    schemaVersion: "router-model-assisted-eval/1.0",
    execution: "captured-proposals-only",
    thresholds: modelAssistedEvalThresholds,
    deterministicCorpusRegression,
    contracts,
    benchmark,
    promotion: { verdict: blockingReasons.length === 0 ? "promotable" : "blocked", blockingReasons },
  };
};

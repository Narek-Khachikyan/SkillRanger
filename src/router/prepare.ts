import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadRouterConfig, type RouterConfig } from "../config/index.ts";
import { agents } from "../installers/agents.ts";
import { getDomainPack, loadBundledRouterPacks, type BundledRouterPack } from "../domains/registry.ts";
import "../domains/bundled.ts";
import { defaultDomainsRoot } from "../paths.ts";
import { loadLocalRegistry } from "../registry/index.ts";
import type { InstalledSkill, ProjectFingerprint, Recommendation, RegistrySkill } from "../types.ts";
import { scanProject } from "../scanner/index.ts";
import { loadRouterFixturePacks } from "./fixtures.ts";
import { buildRoutingContext, RoutingContextError } from "./context.ts";
import { canonicalSkillRoutingDocument } from "./metadata.ts";
import { coreRoutingVocabulary } from "./vocabulary/core.ts";
import { adaptFixtureRoutingPacks, loadBundledRoutingPacks } from "./vocabulary/load.ts";
import { RoutingVocabularyValidationError } from "./vocabulary/validate.ts";
import { validateSemanticHints } from "./semantic-hints.ts";
import { analyzeTask } from "./analyzer.ts";
import { primarySkillAmbiguityQuestionId, resolveDeclaredPrimarySkillClarification, resolveNomination, type ResolvedNomination } from "./nomination-resolution.ts";
import { composeSkillSet, defaultRouterLimits, type RouterSkillMetadata } from "./composer.ts";
import type { RetrieveSkillCandidatesInput } from "./retrieval.ts";
import { createRetrievalBoundary } from "./retrieval-boundary.ts";
import { createContinuationToken, validateContinuation, type RouterClarificationQuestion } from "./continuation.ts";
import { defaultRouterThresholds, normalizeDomainAlias, resolveDomains } from "./resolver.ts";
import { parseTrigger } from "./trigger.ts";
import { buildSkillCatalog, SkillCatalogError } from "./catalog.ts";
import { computeSourcePackageChecksum, createSkillSourceSnapshots, RouterSourceReader } from "./reader.ts";
import { detectExplicitSkillChoice, RoutingProposalError, validateRoutingProposal, validateRoutingProposalCatalogBinding, validateRoutingProposalShape, type ValidatedRoutingProposal } from "./routing-proposal.ts";
import { RouterStore, routerRecordDigest } from "./store.ts";
import type {
  DomainCandidate,
  DeterministicRoutingOutcome,
  DeterministicRoutingProjection,
  PrepareTaskCommon,
  PrepareTaskCoreInput,
  PrepareTaskResult,
  PreparedSkillSelection,
  RoutingMode,
  RouterRun,
  RuntimeRunReference,
  RuntimeClarificationSummary,
  SkillSourceSnapshot,
} from "./types.ts";
import { buildRouterSkillMetadata } from "./skill-metadata.ts";
import { semanticRecallLimitedWarning } from "./types.ts";
import { createSkillRun, reduceSkillRun } from "../runtime/skill-run/reducer.ts";
import { SkillRunStore, type SkillRun } from "../runtime/skill-run/index.ts";
import { createPreparedStrictSkillRun } from "../runtime/strict/service.ts";
import { StrictSkillRunError, StrictSkillRunStore, type SkillRunV2 } from "../runtime/strict/index.ts";
import { assertInstalledMatches } from "../runtime/strict/service.ts";
export const routerAlgorithmVersion = "router/2.1" as const;
export const deterministicRoutingKey = (projection: DeterministicRoutingProjection) => routerRecordDigest(projection);

export class RouterPrepareError extends Error {
  readonly code: "trigger-required" | "empty-intent" | "intent-too-large" | "router-disabled" | "target-agent-unresolved" | "project-root-unauthorized" | "continuation-invalid" | "continuation-expired" | "clarification-answer-invalid" | "capability-invalid" | "router-config-invalid" | "routing-integrity" | "semantic-hint-invalid" | "routing-proposal-invalid" | "raw-intent-confirmation-required";

  constructor(code: RouterPrepareError["code"], message: string) {
    super(message);
    this.name = "RouterPrepareError";
    this.code = code;
  }
}

const canonical = (value: string) => value.normalize("NFKC").trim().toLowerCase();
const digest = (value: unknown) => routerRecordDigest(value);
const targetPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;

const capabilityIds = (capabilities: PrepareTaskCoreInput["capabilities"] = []) => {
  const values = (capabilities ?? []).map(({ id }) => canonical(id));
  if (values.some((value) => !targetPattern.test(value)) || new Set(values).size !== values.length) {
    throw new RouterPrepareError("capability-invalid", "Capabilities must be unique canonical IDs.");
  }
  return values.sort();
};

const domainMetadata = (pack: { id: string; targetSurface?: string; routing: BundledRouterPack["routing"] }) => ({
  id: pack.id,
  ...(pack.targetSurface ? { targetSurface: pack.targetSurface } : {}),
  routing: pack.routing,
});

const skillMetadata = async (
  projectRoot: string,
  targetAgent: string,
  skill: RegistrySkill,
  inputs: Record<string, Record<string, unknown>>,
  intent?: string,
): Promise<PreparedMetadata | undefined> => {
  const built = await buildRouterSkillMetadata({
    source: { kind: "registry", skill },
    projectRoot,
    targetAgent,
    inputs,
    intent,
  });
  if (!built) return undefined;
  return { ...built.metadata, skill, installedRoot: built.installedRoot, entry: built.entry };
};

type PreparedMetadata = RouterSkillMetadata & { skill: RegistrySkill; installedRoot?: string; entry?: InstalledSkill };

const routingFingerprintDigest = (fingerprint: ProjectFingerprint) => digest({
  schemaVersion: fingerprint.schemaVersion,
  ...(fingerprint.packageManager ? { packageManager: { name: fingerprint.packageManager.name, confidence: fingerprint.packageManager.confidence } } : {}),
  projectTypes: fingerprint.projectTypes.map(({ type, confidence }) => ({ type, confidence })),
  languages: fingerprint.languages.map(({ name, confidence }) => ({ name, confidence })),
  frameworks: fingerprint.frameworks.map(({ name, confidence }) => ({ name, confidence })),
  styling: fingerprint.styling.map(({ name, confidence }) => ({ name, confidence })),
  testing: fingerprint.testing.map(({ name, confidence, type }) => ({ name, confidence, ...(type ? { type } : {}) })),
  infrastructure: fingerprint.infrastructure.map(({ name, confidence }) => ({ name, confidence })),
  dependencies: [...(fingerprint.dependencies ?? [])].sort(),
  agentContext: {
    agentsMd: fingerprint.agentContext.agentsMd.present,
    codexSkills: fingerprint.agentContext.codexSkills.present,
    claudeSkills: fingerprint.agentContext.claudeSkills.present,
  },
  signals: [...fingerprint.signals].sort(),
  tags: [...fingerprint.tags].sort(),
  warnings: [...fingerprint.warnings].sort(),
});

const displayProject = (fingerprint: ProjectFingerprint) => ({
  displayRoot: ".",
  fingerprintDigest: routingFingerprintDigest(fingerprint),
  projectTypes: fingerprint.projectTypes.map(({ type }) => type),
  languages: fingerprint.languages.map(({ name }) => name),
  frameworks: fingerprint.frameworks.map(({ name }) => name),
});

const questionFor = (domains: DomainCandidate[]): RouterClarificationQuestion[] => [{
  id: "primary-domain",
  text: "Which target surface should be the primary workflow?",
  options: domains.map(({ id }) => ({ value: canonical(id), label: id })),
}];

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

const createLifecyclePayload = async (input: {
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
}): Promise<{ payload: SkillRun; runtimeClarification?: RuntimeClarificationSummary }> => {
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

const requiredReadsFor = (inventory: SkillSourceSnapshot[]) => inventory.flatMap((snapshot) => snapshot.files.filter(({ mandatory }) => mandatory)).map((file, order) => ({ order, skillId: inventory.find(({ files }) => files.includes(file))?.skillId ?? "", path: file.path, checksum: file.checksum, bytes: file.bytes, mandatory: true as const }));

const common = (input: {
  activation: PrepareTaskCommon["activation"];
  profile: PrepareTaskCommon["taskProfile"];
  fingerprint: ProjectFingerprint;
  targetAgent: string;
  domains: DomainCandidate[];
  routingDate: string;
  registryDigest: string;
  configDigest: string;
  warnings: string[];
  strict: boolean;
  capabilities: string[];
  signalDigest: string;
  vocabularyDigest: string;
  semanticHintsDigest: string;
  routingProposal?: ValidatedRoutingProposal;
  outcome: DeterministicRoutingOutcome;
}): PrepareTaskCommon => {
  // A routed outcome is model-assisted only when a validated routing proposal actually
  // participates. Every other routed outcome is limited deterministic fallback and must
  // carry the stable recall warning in the canonical deduplicated warning collection.
  const mode: RoutingMode = input.routingProposal ? "model-assisted" : "limited-deterministic-fallback";
  const warnings = [...new Set([
    ...input.warnings,
    ...(mode === "limited-deterministic-fallback" ? [semanticRecallLimitedWarning] : []),
  ])];
  return {
    ok: true,
    schemaVersion: "router-result/1.1",
    activation: input.activation,
    taskProfile: input.profile,
    project: displayProject(input.fingerprint),
    routing: {
      mode,
      targetAgent: input.targetAgent,
      domains: input.domains,
      deterministicKey: deterministicRoutingKey({
        routerAlgorithmVersion,
        routingDate: input.routingDate,
        activation: input.activation,
        mode,
        targetAgent: input.targetAgent,
        strict: input.strict,
        capabilities: [...input.capabilities].sort(),
        taskProfile: input.profile,
        signalDigest: input.signalDigest,
        semanticHintsDigest: input.semanticHintsDigest,
        fingerprintDigest: routingFingerprintDigest(input.fingerprint),
        vocabularyDigest: input.vocabularyDigest,
        routingRegistryDigest: input.registryDigest,
        configDigest: input.configDigest,
        ...(input.routingProposal ? { routingProposalDigest: input.routingProposal.proposalDigest } : {}),
        domains: input.domains,
        outcome: input.outcome,
        warnings,
      }),
      routerAlgorithmVersion,
      routingDate: input.routingDate,
      registryDigest: input.registryDigest,
      configDigest: input.configDigest,
      ...(input.routingProposal ? { routingProposal: input.routingProposal.projection } : {}),
    },
    warnings,
  };
};

const applyClarification = (domainId: string, domains: DomainCandidate[]) => domains.map((domain) => ({ ...domain, role: domain.id === domainId ? "primary" as const : "supporting" as const }));

export const prepareTask = async (
  input: PrepareTaskCoreInput,
  options: { domainsRoot?: string } = {},
): Promise<PrepareTaskResult> => {
  const domainsRoot = options.domainsRoot ?? defaultDomainsRoot;
  let configResult;
  try {
    configResult = await loadRouterConfig(input.projectRoot);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: unknown }).code === "router-config-invalid") {
      throw new RouterPrepareError("router-config-invalid", "Router configuration is invalid.");
    }
    throw error;
  }
  const config: RouterConfig = configResult.config;
  if (!config.router.enabled) throw new RouterPrepareError("router-disabled", "Universal Prompt Router is disabled by project configuration.");
  const targetAgent = canonical(input.targetAgent?.trim() || config.defaultTargetAgent);
  // Naming the accepted IDs here is the difference between a caller correcting itself and a caller
  // guessing again: "gemini" and "claude" are the obvious wrong guesses for gemini-cli and claude-code.
  if (!targetPattern.test(targetAgent) || !Object.hasOwn(agents, targetAgent)) {
    throw new RouterPrepareError(
      "target-agent-unresolved",
      `Target agent is not a supported canonical ID. Supported IDs: ${Object.keys(agents).sort().join(", ")}.`,
    );
  }
  const strict = input.strict ?? config.router.strictByDefault;
  const capabilities = capabilityIds([
    { id: "filesystem", source: "server-observed" as const },
    ...(input.capabilities ?? []).filter(({ id }) => canonical(id) !== "filesystem"),
  ]);
  const parsed = parseTrigger({ prompt: input.prompt, mode: input.activation.mode, maxIntentBytes: Math.min(config.router.maxIntentBytes, 64_000) });
  if (!parsed.activated) throw new RouterPrepareError(
    parsed.reason,
    parsed.reason === "trigger-required"
      ? "Start the prompt with @skillranger or /sr.\nExample: @skillranger проверь мобильное управление"
      : `Cannot prepare task: ${parsed.reason}.`,
  );
  if (Boolean(input.continuationToken) !== Boolean(input.clarificationAnswers)) {
    throw new RouterPrepareError("continuation-invalid", "Continuation token and clarification answers must be supplied together.");
  }

  let routingProposal: ValidatedRoutingProposal | undefined;
  let catalogSnapshot: Awaited<ReturnType<typeof buildSkillCatalog>> | undefined;
  let shapedProposal: ReturnType<typeof validateRoutingProposalShape> | undefined;
  if (input.routingProposal !== undefined && input.semanticHints !== undefined) {
    throw new RouterPrepareError("routing-proposal-invalid", "routingProposal and semanticHints cannot be submitted together.");
  }
  if (input.routingProposal !== undefined) {
    if (input.registry.kind !== "bundled") {
      throw new RouterPrepareError("routing-proposal-invalid", "routingProposal requires the trusted bundled catalog.");
    }
    try {
      shapedProposal = validateRoutingProposalShape(input.routingProposal);
    } catch (error) {
      if (error instanceof RoutingProposalError) throw new RouterPrepareError(error.code, error.message);
      throw error;
    }
    try {
      catalogSnapshot = await buildSkillCatalog({ registryRoot: input.registry.root, domainsRoot });
    } catch (error) {
      if (error instanceof SkillCatalogError) throw new RouterPrepareError("routing-integrity", "The trusted catalog could not be validated.");
      throw error;
    }
    try {
      const refresh = validateRoutingProposalCatalogBinding({ proposal: shapedProposal, catalog: catalogSnapshot });
      if (refresh) return { ok: true, schemaVersion: "router-result/1.1", ...refresh };
    } catch (error) {
      if (error instanceof RoutingProposalError) throw new RouterPrepareError(error.code, error.message);
      throw error;
    }
  }

  const routingDate = input.routingDate ?? new Date().toISOString().slice(0, 10);
  const catalogSkill = (skillId: string) => catalogSnapshot?.skills.find(({ skillId: id }) => id === skillId);
  const fingerprint = await scanProject(input.projectRoot);
  const fixturePacks = input.registry.kind === "test-fixture" ? await loadRouterFixturePacks(input.registry.root) : [];
  const packs = input.registry.kind === "test-fixture"
    ? fixturePacks.map(({ domain }) => ({ id: domain.id, displayName: domain.displayName, ...(domain.targetSurface ? { targetSurface: domain.targetSurface } : {}), version: "fixture", coreApi: "fixture", skillIdPrefix: `${domain.id}.`, capabilities: ["intent-routing"] as const, artifacts: { intents: [], schemas: [], recipes: [], workflows: [], validators: [] }, ownership: [], routing: domain.routing, root: input.registry.root }))
    : await loadBundledRouterPacks(domainsRoot);
  const skills = input.registry.kind === "test-fixture"
    ? []
    : await loadLocalRegistry(input.registry.root);
  const fixtureMetadata = (await Promise.all(fixturePacks.flatMap((pack) => pack.skills.map((skill) => buildRouterSkillMetadata({
    source: { kind: "fixture", skill, installed: false },
    projectRoot: input.projectRoot,
    targetAgent,
    inputs: input.skillInputs ?? {},
    intent: parsed.normalizedIntent,
  }))))).map((built) => built!.metadata);
  const metadata = (await Promise.all(skills.map((skill) => skillMetadata(input.projectRoot, targetAgent, skill, input.skillInputs ?? {}, parsed.normalizedIntent))))
    .filter((skill): skill is PreparedMetadata => skill !== undefined);
  const allMetadata = [...metadata, ...fixtureMetadata] as RouterSkillMetadata[];
  const canonicalSkills = allMetadata.map(canonicalSkillRoutingDocument);
  let routingContext;
  try {
    const routingPacks = input.registry.kind === "test-fixture"
      ? adaptFixtureRoutingPacks(fixturePacks)
      : await loadBundledRoutingPacks(packs as BundledRouterPack[]);
    routingContext = buildRoutingContext({
      packs: routingPacks,
      skills: canonicalSkills,
      coreVocabulary: coreRoutingVocabulary,
      baseRegistryDigest: digest(allMetadata),
    });
  } catch (error) {
    if (error instanceof RoutingContextError || error instanceof RoutingVocabularyValidationError ||
      (error instanceof Error && error.message.startsWith("routing-vocabulary-"))) {
      throw new RouterPrepareError("routing-integrity", "Routing vocabulary or ownership metadata is invalid.");
    }
    throw error;
  }
  if (catalogSnapshot && shapedProposal) {
    try {
      const ownerChecked = validateRoutingProposal({
        proposal: shapedProposal,
        prompt: parsed.normalizedIntent,
        catalog: catalogSnapshot,
        routingContext,
      });
      if ("status" in ownerChecked) return { ok: true, schemaVersion: "router-result/1.1", ...ownerChecked };
      routingProposal = ownerChecked;
    } catch (error) {
      if (error instanceof RoutingProposalError) throw new RouterPrepareError(error.code, error.message);
      throw error;
    }
  }
  const domains = packs.map(domainMetadata);
  const semanticHints = validateSemanticHints({ semanticHints: input.semanticHints, prompt: parsed.normalizedIntent, context: routingContext });
  if (semanticHints.issues.length > 0) throw new RouterPrepareError("semantic-hint-invalid", "Semantic routing hints are invalid.");
  const analysis = analyzeTask({ prompt: parsed.normalizedIntent, domains, skills: allMetadata, routingContext, semanticSignals: [...semanticHints.signals, ...(routingProposal?.semanticSignals ?? [])] });
  const registryDigest = routingContext.routingRegistryDigest;
  let routingWarnings = [
    ...analysis.warnings,
    ...(routingProposal?.rejections.map(({ skillId, reasonCode }) =>
      `routing-proposal-rejected:${skillId ?? "unknown"}:${reasonCode}`) ?? []),
  ];
  const activation = { mode: input.activation.mode, ...(parsed.trigger === undefined ? {} : { trigger: parsed.trigger }) };
  const resultCommon = (resultDomains: DomainCandidate[], outcome: DeterministicRoutingOutcome) => common({
    activation,
    profile: analysis.profile,
    fingerprint,
    targetAgent,
    domains: resultDomains,
    routingDate,
    registryDigest,
    configDigest: configResult.digest,
    warnings: routingWarnings,
    strict,
    capabilities,
    signalDigest: analysis.signalDigest,
    vocabularyDigest: routingContext.vocabularyDigest,
    semanticHintsDigest: semanticHints.digest,
    routingProposal,
    outcome,
  });
  const promptProjection = { actions: analysis.profile.actions, artifactTypes: analysis.profile.artifactTypes, technologies: analysis.profile.technologies, qualityGoals: analysis.profile.qualityGoals, acceptanceCriteria: analysis.profile.acceptanceCriteria, domains: analysis.profile.domains.map(({ id }) => id), subtasks: analysis.profile.subtasks };
  const explicitSkillId = routingProposal
    ? detectExplicitSkillChoice(parsed.normalizedIntent, allMetadata.map(({ id }) => id))
    : undefined;
  const declaredNominations = routingProposal?.nominations.map(({ skillId, role }) => ({ skillId, role })) ?? [];
  // The declared nomination order below (with the explicit choice first) is the
  // continuation binding projection; it must stay byte-identical to the legacy
  // contract. The resolved nomination carries the effective orders for
  // composition, including any ambiguity-answer permutation.
  const nominationOrder = [
    ...(explicitSkillId ? [explicitSkillId] : []),
    ...(routingProposal?.nominations.map(({ skillId }) => skillId) ?? []),
  ];
  const declaredResolution = resolveNomination({ explicitSkillId, declaredNominations });
  const nominatedSkillIds = declaredResolution?.nominatedSkillIds ?? [];
  const primaryNominationOrder = declaredResolution?.primaryNominationOrder ?? [];
  const nominatedPrimarySkillIds = declaredResolution?.nominatedPrimarySkillIds ?? [];
  const resolution = resolveDomains({ profile: analysis.profile, domains, skills: allMetadata, fingerprint, availableDomainIds: packs.map(({ id }) => id), thresholds: defaultRouterThresholds, routingIntentTags: analysis.routingIntentTags, routingContext, routingSignals: analysis.matchedSignals });
  const declaredAmbiguityIds = routingProposal?.ambiguity?.primarySkillIds ?? [];
  // A continuation answer only permutes the primary nomination order (the selected
  // nomination moves to the front), so the domain union below is permutation-invariant
  // across clarification calls and matches the historical composition input.
  const skillById = new Map(allMetadata.map((skill) => [canonical(skill.id), skill]));
  const nominatedPrimaryDomains: string[] = [];
  const visitedNominatedSkills = new Set<string>();
  const pendingNominatedSkills = [...primaryNominationOrder];
  while (pendingNominatedSkills.length > 0) {
    const skillId = pendingNominatedSkills.shift()!;
    const normalizedSkillId = canonical(skillId);
    if (visitedNominatedSkills.has(normalizedSkillId)) continue;
    visitedNominatedSkills.add(normalizedSkillId);
    const skill = skillById.get(normalizedSkillId);
    if (!skill) continue;
    nominatedPrimaryDomains.push(...skill.domains);
    pendingNominatedSkills.push(...(skill.dependencies ?? []));
  }
  const routingCandidates = [...resolution.candidates];
  const routingCandidateIds = new Set(routingCandidates.map(({ id }) => canonical(id)));
  for (const domainId of nominatedPrimaryDomains) {
    const normalizedDomainId = canonical(domainId);
    if (routingCandidateIds.has(normalizedDomainId)) continue;
    routingCandidateIds.add(normalizedDomainId);
    routingCandidates.push({ id: domainId, confidence: 0.75, role: "supporting", available: true, reasons: ["proposal-domain-binding"], evidence: [] });
  }
  const firstPrimaryNomination = routingProposal?.nominations.find(({ role }) => role === "primary");
  const firstPrimaryNominationDomain = firstPrimaryNomination
    ? catalogSkill(firstPrimaryNomination.skillId)?.domains[0]
    : undefined;
  const probeSelectedPrimary = routingProposal && firstPrimaryNominationDomain ? firstPrimaryNominationDomain : resolution.primaryDomainId;
  // The single unified retrieval input for the boundary factory: the probe and
  // any explicit rebuild request different primary domains, strict flags, and
  // nomination resolutions from the same builder, so the two calls can never
  // hand-align divergent retrieval inputs again.
  const retrievalBoundaryInput = (primaryDomainId: string | undefined, strict: boolean, nomination: ResolvedNomination | undefined): RetrieveSkillCandidatesInput => ({
    profile: analysis.profile,
    requirements: analysis.requirements,
    skills: allMetadata,
    targetAgent,
    capabilities,
    strict,
    installedSkillIds: allMetadata.filter(({ installed }) => installed).map(({ id }) => id),
    selectedDomainIds: routingCandidates.map(({ id }) => id),
    primaryDomainId,
    fingerprint,
    routingDate,
    routingIntentTags: analysis.routingIntentTags,
    routingContext,
    matchedSignals: analysis.matchedSignals,
    ...(nomination ? { nominatedSkillIds: nomination.nominatedSkillIds, nominatedPrimarySkillIds: nomination.nominatedPrimarySkillIds, nominatedRoles: nomination.nominatedRoles } : {}),
    maxSelectedRisk: config.router.maxSelectedRisk,
  });
  // One boundary serves the probe and composition: the production factory owns
  // the single unified retrieval input construction and binds the eligibility
  // fact projection to the result it stored, so the facts the declared-ambiguity
  // clarification decision sees can never disagree with the retrieval that
  // composition consumes.
  const probeBoundary = declaredAmbiguityIds.length > 0 && !explicitSkillId
    ? createRetrievalBoundary(retrievalBoundaryInput(probeSelectedPrimary, false, declaredResolution))
    : undefined;
  const nominatedPrimaryFacts = probeBoundary?.eligibilityFacts(nominatedPrimarySkillIds) ?? [];
  // The cohesive nomination decision owns declared-ambiguity eligibility, the typed
  // closed-option question, and the answer's effect on the effective nomination
  // order. The continuation module owns token signing, expiry, replay protection,
  // and integrity validation; only the validated answer value reaches this decision.
  // The same input is reused for the answer pass inside the continuation block; the
  // binding must be built from the no-answer pass before the token is validated.
  const ambiguityClarificationInput = {
    declaredAmbiguityIds,
    explicitSkillId,
    eligibilityFacts: nominatedPrimaryFacts,
    declaredNominations,
    displayNameFor: (skillId: string) => catalogSkill(skillId)?.displayName,
  };
  const ambiguityClarification = resolveDeclaredPrimarySkillClarification(ambiguityClarificationInput);
  if (ambiguityClarification.kind === "ambiguity-ineligible") {
    throw new RouterPrepareError(
      "routing-proposal-invalid",
      `Declared primary ambiguity choices are not eligible primary nominations: ${ambiguityClarification.ineligibleSkillIds.join(", ")}.`,
    );
  }
  const skillAmbiguityIds = ambiguityClarification.kind === "clarification-required"
    ? ambiguityClarification.eligibleSkillIds
    : [];
  const projectIdentity = await new RouterStore(input.projectRoot).projectIdentity();
  const continuationBinding = {
    fingerprintDigest: digest(fingerprint),
    registryDigest,
    configDigest: configResult.digest,
    routingDate,
    targetAgent,
    strict,
    capabilities,
    promptProjection,
    routingProjection: {
      domains: resolution.ambiguousDomainIds,
      ...(routingProposal ? { routingProposalDigest: routingProposal.proposalDigest, nominationOrder, skillAmbiguityIds } : {}),
    },
    projectIdentity,
    routerAlgorithmVersion,
    signalDigest: analysis.signalDigest,
    vocabularyDigest: routingContext.vocabularyDigest,
    semanticHintsDigest: semanticHints.digest,
  };
  routingWarnings = [...new Set([...routingWarnings, ...resolution.warnings])];
  if (input.continuationToken && !resolution.clarificationRequired && skillAmbiguityIds.length === 0) {
    throw new RouterPrepareError("continuation-invalid", "Continuation input does not match a routing clarification.");
  }
  const skillAmbiguityQuestion = ambiguityClarification.kind === "clarification-required"
    ? ambiguityClarification.question
    : undefined;
  const questions = [
    ...(resolution.clarificationRequired ? questionFor(resolution.ambiguousDomainIds.map((id) => resolution.candidates.find((candidate) => candidate.id === id)!).filter(Boolean)) : []),
    ...(skillAmbiguityQuestion ? [skillAmbiguityQuestion] : []),
  ];
  let selectedPrimary = resolution.primaryDomainId;
  let resolvedNomination = declaredResolution;
  if (questions.length > 0) {
    if (!input.continuationToken || !input.clarificationAnswers) {
      const token = createContinuationToken(continuationBinding, questions);
      const clarification = { questions };
      return { ...resultCommon(resolution.candidates, { status: "clarification_required", clarification }), status: "clarification_required", clarification, continuationToken: token.token, expiresAt: token.expiresAt };
    }
    try {
      const validated = validateContinuation({ token: input.continuationToken, answers: input.clarificationAnswers, binding: continuationBinding, questions });
      const domainAnswer = validated.answers.find(({ questionId }) => questionId === "primary-domain");
      if (resolution.clarificationRequired) {
        selectedPrimary = normalizeDomainAlias(domainAnswer?.value ?? "", domains);
        if (!selectedPrimary || !resolution.ambiguousDomainIds.includes(selectedPrimary)) throw new RouterPrepareError("clarification-answer-invalid", "Clarification answer does not identify an available primary domain.");
      }
      const skillAnswer = validated.answers.find(({ questionId }) => questionId === primarySkillAmbiguityQuestionId);
      if (skillAmbiguityIds.length > 0) {
        // The answer pass reuses the no-answer decision input; any outcome other
        // than an accepted answer fails closed, matching the guarantee that no run
        // state is created before a valid choice is resolved.
        const appliedClarification = resolveDeclaredPrimarySkillClarification({
          ...ambiguityClarificationInput,
          answer: skillAnswer?.value,
        });
        if (appliedClarification.kind !== "answer-accepted") {
          throw new RouterPrepareError("clarification-answer-invalid", "Clarification answer does not identify an available nominated skill.");
        }
        resolvedNomination = appliedClarification.resolvedNomination;
      }
    } catch (error) {
      if (error instanceof RouterPrepareError) throw error;
      const code = (error as { code?: string }).code === "continuation-expired" ? "continuation-expired" : (error as { code?: string }).code === "clarification-answer-invalid" ? "clarification-answer-invalid" : "continuation-invalid";
      throw new RouterPrepareError(code, "Continuation token or clarification answers are invalid.");
    }
  }
  // A continuation answer permutes the resolution (the selected nomination becomes
  // the required primary); without one the declared resolution is the effective
  // one. The proposal-assisted path consumes this decision for both the
  // primary-domain binding and composition instead of reconstructing the same
  // projection from the raw explicit choice and answer sources.
  const proposalPrimarySkillId = resolvedNomination?.requiredPrimarySkillId ?? firstPrimaryNomination?.skillId;
  const proposalPrimaryDomain = proposalPrimarySkillId
    ? catalogSkill(proposalPrimarySkillId)?.domains[0]
    : undefined;
  if (routingProposal && proposalPrimaryDomain) selectedPrimary = proposalPrimaryDomain;
  if (!selectedPrimary) {
    const outcome = { status: "no_matching_skills" as const, suggestedAction: "Proceed without a SkillRanger workflow or add an audited domain pack." };
    return { ...resultCommon(resolution.candidates, outcome), ...outcome };
  }
  if (analysis.profile.subtasks.length >= 2) {
    const outcome = { status: "decomposition_required" as const, decomposition: { subtasks: analysis.profile.subtasks } };
    return { ...resultCommon(resolution.candidates, outcome), ...outcome };
  }
  // The ambiguity probe is the existing candidate retrieval, aligned to the composition
  // retrieval input: the same nomination sets, roles, domains, and primary domain. The
  // probe boundary's result is reused by composition instead of running a second
  // eligibility pass. The only axis that can diverge between the probe and the final
  // primary domain is a continuation answer selecting a nomination that names another
  // domain; reuse is skipped then and the boundary is rebuilt explicitly through the
  // same factory. Composition always receives a boundary: without a probe it is built
  // here for the effective primary domain and nomination resolution, so the boundary
  // factory is the only retrieval construction site.
  const reuseProbeRetrieval = probeBoundary !== undefined && probeSelectedPrimary !== undefined && canonical(probeSelectedPrimary) === canonical(selectedPrimary);
  const boundary = reuseProbeRetrieval
    ? probeBoundary
    : createRetrievalBoundary(retrievalBoundaryInput(selectedPrimary, strict, resolvedNomination));
  const composed = composeSkillSet({
    profile: analysis.profile,
    requirements: analysis.requirements,
    skills: allMetadata,
    primaryDomainId: selectedPrimary,
    capabilities,
    strict,
    installedSkillIds: allMetadata.filter(({ installed }) => installed).map(({ id }) => id),
    fingerprint,
    routingContext,
    resolvedNomination,
    boundary,
    limits: { ...defaultRouterLimits, maxSelectedRisk: config.router.maxSelectedRisk, maxEnvironmentSkills: config.router.maxEnvironmentSkills, maxTaskCompanions: config.router.maxTaskCompanions, maxVerificationSkills: config.router.maxVerificationSkills, maxAgentContextSkills: config.router.maxAgentContextSkills, maxCoreSkills: config.router.maxCoreSkills, maxTotalSelectedSkills: config.router.maxTotalSelectedSkills, maxInstructionBytes: config.router.maxInstructionBytes, maxAdditionalReadBytes: config.router.maxAdditionalReadBytes, maxSingleFileBytes: config.router.maxSingleFileBytes },
  });
  if (routingProposal) {
    const nominatedIdsForWarnings = new Set(nominatedSkillIds);
    routingWarnings = [...new Set([
      ...routingWarnings,
      ...composed.rejections
        .filter(({ skillId }) => nominatedIdsForWarnings.has(skillId))
        .map(({ skillId, reason }) => `routing-proposal-rejected:${skillId}:${reason}`),
    ])];
  }
  const composedPrimaryDomain = composed.status === "prepared"
    ? composed.composed.primary.skill.domains.find((domainId) => canonical(domainId) === canonical(selectedPrimary)) ??
      composed.composed.primary.skill.domains.find((domainId) => routingCandidateIds.has(canonical(domainId))) ??
      composed.composed.primary.skill.domains[0] ??
      selectedPrimary
    : selectedPrimary;
  const resultDomains = applyClarification(composedPrimaryDomain, routingCandidates);
  if (composed.status !== "prepared") {
    if (composed.status === "decomposition_required") {
      const outcome = { status: composed.status, decomposition: { subtasks: composed.subtasks } };
      return { ...resultCommon(resultDomains, outcome), ...outcome };
    }
    if (composed.status === "strict_requirements_unmet") {
      const outcome = { status: composed.status, missing: composed.missing, installationSuggestions: composed.missing.filter(({ requirement }) => requirement === "installed-skill").map(({ skillId }) => ({ skillId, reason: "The selected strict workflow is not installed for this target agent.", nextTool: "plan_skill_install" as const })) };
      return { ...resultCommon(resultDomains, outcome), ...outcome };
    }
    if (composed.status === "context_budget_exceeded") {
      const outcome = { status: composed.status, requiredBytes: composed.requiredBytes, allowedBytes: composed.allowedBytes, blockingSkillIds: composed.blockingSkillIds };
      return { ...resultCommon(resultDomains, outcome), ...outcome };
    }
    const outcome = { status: "no_matching_skills" as const, suggestedAction: "Proceed without a SkillRanger workflow or add an audited domain pack.", ...(composed.reasonCode ? { reasonCode: composed.reasonCode } : {}) };
    return { ...resultCommon(resultDomains, outcome), ...outcome };
  }
  const selectedSkillIds = new Set(composed.composed.all.map(({ skill }) => skill.id));
  const unselectedInput = Object.keys(input.skillInputs ?? {}).find((skillId) => !selectedSkillIds.has(skillId));
  if (unselectedInput) throw new RouterPrepareError("routing-integrity", `Skill input was supplied for an unselected skill: ${unselectedInput}.`);
  const selections = composed.composed.selections;
  const base = resultCommon(resultDomains, { status: "prepared", selections });
  const selectedMetadata = composed.composed.all.map(({ skill }) => metadata.find(({ id }) => id === skill.id)!).filter(Boolean);
  const mandatoryPaths = (item: PreparedMetadata) => strict ? (item.contractMustRead?.length ? item.contractMustRead : ["SKILL.md"]) : ["SKILL.md"];
  const sourceInputs = await Promise.all(selectedMetadata.map(async (item) => {
    const sourceRoot = item.installedRoot ?? item.skill.path;
    return {
    skillId: item.id,
    source: item.source!,
    version: item.version,
    packageChecksum: await computeSourcePackageChecksum(sourceRoot),
    auditDigest: item.auditDigest!,
    sourceRoot,
    authorizedRoot: item.installedRoot ? input.projectRoot : input.registry.root,
    locator: item.installedRoot ? { kind: "installed" as const, targetAgent, installedPath: item.entry!.installedPath } : { kind: "bundled-registry" as const, skillId: item.id },
    mandatoryPaths: mandatoryPaths(item),
    };
  }));
  const sourceInventory = await createSkillSourceSnapshots(sourceInputs);
  await Promise.all(selectedMetadata.flatMap((item) => item.installedRoot && item.entry
    ? [assertInstalledMatches(item.skill, item.installedRoot, item.entry.checksum)]
    : []));
  const reads = requiredReadsFor(sourceInventory);
  const runtimeRunId = `run_${randomUUID()}`;
  const runtime: RuntimeRunReference = { kind: strict ? "strict-v2" : "lifecycle-v1", runId: runtimeRunId };
  const verificationCapabilities = [...new Set(selectedMetadata.flatMap(({ verificationRequiredCapabilities }) => verificationRequiredCapabilities ?? []))];
  const missingVerificationCapabilities = verificationCapabilities.filter((capability) => !capabilities.includes(canonical(capability)));
  const verificationRequired = analysis.profile.acceptanceCriteria.length > 0 || verificationCapabilities.length > 0 || selections.verification.length > 0;
  const provisionalBase = { ...base, status: "prepared" as const, selections, requiredReads: reads, run: { routerRunId: `route_${randomUUID().replaceAll("-", "").slice(0, 16)}`, runtimeRunId, runtime: runtime.kind, strict, readRevision: 0 }, verification: { required: verificationRequired, available: verificationRequired && missingVerificationCapabilities.length === 0, missingCapabilities: missingVerificationCapabilities, expectedEvidenceKinds: analysis.profile.acceptanceCriteria } };
  let runtimeClarification: RuntimeClarificationSummary | undefined;
  let runtimePayload: SkillRun | SkillRunV2;
  if (strict) {
    try {
      runtimePayload = await createPreparedStrictSkillRun({ projectRoot: input.projectRoot, targetAgent, domain: composedPrimaryDomain, intent: parsed.normalizedIntent, rawIntent: input.prompt, normalizedGoal: analysis.profile.normalizedGoal, runtimeRunId, selections, metadata: selectedMetadata, fingerprint, skillInputs: input.skillInputs ?? {}, capabilities, storeRawIntent: input.rawIntentPersistence === "explicitly-authorized" });
    } catch (error) {
      if (error instanceof StrictSkillRunError && error.code === "strict-contract-missing" && error.details?.reason === "validator-ownership") {
        const outcome = {
          status: "strict_requirements_unmet" as const,
          missing: [{ skillId: typeof error.details.skillId === "string" ? error.details.skillId : undefined, requirement: "strict-contract-v2" as const }],
          installationSuggestions: [],
        };
        return { ...resultCommon(resultDomains, outcome), ...outcome };
      }
      throw error;
    }
    const blocked = runtimePayload.skillLedgers.filter(({ outcome }) => outcome === "blocked");
    if (blocked.length > 0) {
      const outcome = {
        status: "strict_requirements_unmet" as const,
        missing: blocked.flatMap(({ skillId, applicability, contract }) => applicability.unmetPrerequisites.map((id) => ({
          skillId,
          requirement: contract.prerequisites.find((prerequisite) => prerequisite.id === id)?.kind === "input" ? "skill-input" as const : "capability" as const,
        }))),
        installationSuggestions: [],
      };
      return { ...resultCommon(resultDomains, outcome), ...outcome };
    }
  } else {
    // ADR 0008: every selected skill that declares an output contract contributes its required
    // report fields; today only the always-on core (universal) skills declare one.
    const coreOutputContracts: Record<string, string[]> = {};
    for (const item of selectedMetadata) {
      const fields = item.skill.manifest.outputContract?.requiredReportFields;
      if (fields && fields.length > 0) coreOutputContracts[item.id] = fields;
    }
    const lifecycle = await createLifecyclePayload({ runtimeRunId, domain: composedPrimaryDomain, targetAgent, prompt: analysis.profile.normalizedGoal, rawPrompt: input.prompt, policyIntent: parsed.normalizedIntent, profile: analysis.profile, selections: provisionalBase, rawIntentPersistence: input.rawIntentPersistence === "explicitly-authorized", coreOutputContracts });
    runtimePayload = lifecycle.payload;
    runtimeClarification = lifecycle.runtimeClarification;
  }
  const routerRun: RouterRun = {
    schemaVersion: "router-run/1.0",
    routerRunId: provisionalBase.run.routerRunId,
    revision: 0,
    readRevision: 0,
    state: "prepared",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    projectIdentity,
    taskProfile: analysis.profile,
    routing: {
      ...base.routing,
      fingerprintDigest: base.project.fingerprintDigest,
      ...(routingProposal ? { routingProposal: routingProposal.projection } : {}),
    },
    selections,
    sourceInventory,
    readLedger: [],
    runtime,
  };
  const runtimeStore = createRouterRuntimeStore(input.projectRoot);
  const store = new RouterStore(input.projectRoot, { runtime: runtimeStore });
  await store.journaledCreate({ routerRun, runtimePayload, runtime: runtimeStore });
  return runtimeClarification ? { ...provisionalBase, runtimeClarification } : provisionalBase;
};

export const createRouterRuntimeStore = (projectRoot: string) => ({
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
  options: ConstructorParameters<typeof RouterSourceReader>[2] = {},
) => new RouterSourceReader(projectRoot, store, { bundledRegistryRoot: registryRoot, ...options });

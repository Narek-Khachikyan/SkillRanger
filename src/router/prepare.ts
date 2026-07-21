import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { loadRouterConfig, type RouterConfig } from "../config/index.ts";
import { agents } from "../installers/agents.ts";
import { loadBundledRouterPacks, type BundledRouterPack } from "../domains/registry.ts";
import "../domains/bundled.ts";
import { getDomainPack } from "../domains/registry.ts";
import { auditSkill } from "../audit/index.ts";
import { readLockfile } from "../lockfile/index.ts";
import { defaultDomainsRoot } from "../paths.ts";
import { loadLocalRegistry } from "../registry/index.ts";
import type { ProjectFingerprint, Recommendation, RegistrySkill } from "../types.ts";
import { scanProject } from "../scanner/index.ts";
import { loadRouterFixturePacks } from "./fixtures.ts";
import { buildRoutingContext, RoutingContextError } from "./context.ts";
import { canonicalSkillRoutingDocument } from "./metadata.ts";
import { coreRoutingVocabulary } from "./vocabulary/core.ts";
import { adaptFixtureRoutingPacks, loadBundledRoutingPacks } from "./vocabulary/load.ts";
import { RoutingVocabularyValidationError } from "./vocabulary/validate.ts";
import { validateSemanticHints } from "./semantic-hints.ts";
import { analyzeTask } from "./analyzer.ts";
import { composeSkillSet, defaultRouterLimits, type RouterSkillMetadata } from "./composer.ts";
import { createContinuationToken, validateContinuation, type RouterClarificationQuestion } from "./continuation.ts";
import { defaultRouterThresholds, normalizeDomainAlias, resolveDomains } from "./resolver.ts";
import { parseTrigger } from "./trigger.ts";
import { computeSourcePackageChecksum, createSkillSourceSnapshots, RouterSourceReader } from "./reader.ts";
import { RouterStore, routerRecordDigest } from "./store.ts";
import type {
  DomainCandidate,
  DeterministicRoutingOutcome,
  DeterministicRoutingProjection,
  PrepareTaskCommon,
  PrepareTaskCoreInput,
  PrepareTaskResult,
  PreparedSkillSelection,
  RouterRun,
  RuntimeRunReference,
  RuntimeClarificationSummary,
  SkillSourceSnapshot,
} from "./types.ts";
import { createSkillRun, reduceSkillRun } from "../runtime/skill-run/reducer.ts";
import { SkillRunStore, type SkillRun } from "../runtime/skill-run/index.ts";
import { createPreparedStrictSkillRun } from "../runtime/strict/service.ts";
import { StrictSkillRunStore, type SkillRunV2 } from "../runtime/strict/index.ts";
import { assertInstalledMatches } from "../runtime/strict/service.ts";

export const routerAlgorithmVersion = "router/2.0" as const;
export const deterministicRoutingKey = (projection: DeterministicRoutingProjection) => routerRecordDigest(projection);

export class RouterPrepareError extends Error {
  readonly code: "trigger-required" | "empty-intent" | "intent-too-large" | "router-disabled" | "target-agent-unresolved" | "project-root-unauthorized" | "continuation-invalid" | "continuation-expired" | "clarification-answer-invalid" | "capability-invalid" | "router-config-invalid" | "routing-integrity" | "semantic-hint-invalid" | "raw-intent-confirmation-required";

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

const installedEntryFor = async (projectRoot: string, skillId: string, targetAgent: string) => {
  const lockfile = await readLockfile(projectRoot);
  return lockfile.installed.find((entry) => entry.skillId === skillId && entry.targetAgent === targetAgent && entry.scope === "repo");
};

const safeInstalledRoot = async (projectRoot: string, installedPath: string) => {
  const root = await realpath(projectRoot);
  const resolved = path.resolve(root, installedPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return undefined;
  let current = root;
  for (const component of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const componentInfo = await lstat(current).catch(() => undefined);
    if (!componentInfo) return undefined;
    if (componentInfo.isSymbolicLink()) return undefined;
  }
  const info = await lstat(resolved).catch(() => undefined);
  if (!info?.isDirectory() || info.isSymbolicLink()) return undefined;
  return resolved;
};

const skillMetadata = async (
  projectRoot: string,
  targetAgent: string,
  skill: RegistrySkill,
  strict: boolean,
  inputs: Record<string, Record<string, unknown>>,
  capabilities: string[],
): Promise<PreparedMetadata | undefined> => {
  const routing = skill.manifest.routing;
  if (!routing?.roles || !routing.domains || !routing.actions || !routing.artifactTypes || !routing.intentTags || !routing.technologyTags || !routing.qualityGoals) return undefined;
  const audit = await auditSkill(skill);
  const entry = await installedEntryFor(projectRoot, skill.manifest.id, targetAgent);
  const installedRoot = entry ? await safeInstalledRoot(projectRoot, entry.installedPath) : undefined;
  const installed = Boolean(entry && installedRoot && entry.checksum === skill.checksum && await assertInstalledMatches(skill, installedRoot, entry.checksum).then(() => true).catch(() => false));
  const contract = skill.executionContract;
  const contractInputAccepted = contract
    ? (await import("../runtime/strict/json-schema.ts")).validateJsonSchema(
      JSON.parse(await readFile(path.join(skill.path, contract.inputSchema), "utf8")) as Record<string, unknown>,
      inputs[skill.manifest.id] ?? {},
    ).length === 0
    : false;
  const requiredCapabilities = [...new Set([
    ...(routing.requiredCapabilities ?? []),
    ...(skill.manifest.verification?.requiredCapabilities ?? []),
  ])];
  return {
    id: skill.manifest.id,
    displayName: skill.manifest.displayName,
    version: skill.manifest.version,
    riskLevel: skill.manifest.riskLevel,
    domains: routing.domains,
    roles: routing.roles,
    actions: routing.actions,
    artifactTypes: routing.artifactTypes,
    intentTags: routing.intentTags,
    technologyTags: routing.technologyTags,
    qualityGoals: routing.qualityGoals,
    environmentSignals: routing.environmentSignals,
    requiredCapabilities,
    routingRequiredCapabilities: routing.requiredCapabilities ?? [],
    verificationRequiredCapabilities: skill.manifest.verification?.requiredCapabilities ?? [],
    strictPrerequisiteCapabilities: contract?.prerequisites.flatMap((prerequisite) => prerequisite.kind === "capability" ? [prerequisite.capability] : []) ?? [],
    optionalCapabilities: routing.optionalCapabilities,
    complements: routing.complements,
    dependencies: skill.manifest.dependencies,
    conflictsWith: skill.manifest.conflictsWith,
    supersedes: skill.manifest.supersedes,
    packageChecksum: skill.checksum,
    source: installed ? "installed" as const : "bundled-registry" as const,
    installed,
    lockfileMatch: installed,
    installedFileSetMatch: installed,
    auditPassed: audit.riskLevel !== "high" && audit.riskLevel !== "block" && audit.checksum === skill.checksum,
    auditDigest: digest(audit),
    strictContract: contract ? "valid" as const : "missing" as const,
    contractInputAccepted,
    contractMustRead: contract?.mustRead,
    instructionBytes: Buffer.byteLength(await readFile(skill.skillPath), "utf8"),
    qualityScore: skill.manifest.qualityScore,
    securityScore: skill.manifest.securityScore,
    freshnessDate: skill.manifest.freshness?.lastReviewedAt,
    supportedTargets: [...new Set([
      ...skill.manifest.supportedAgents,
      ...Object.entries(skill.manifest.compatibility ?? {})
        .filter(([, compatibility]) => compatibility.level !== "unsupported")
        .map(([agent]) => agent),
    ])],
    skill,
    ...(installedRoot && installed ? { installedRoot } : {}),
    entry,
  };
};

type PreparedMetadata = RouterSkillMetadata & { skill: RegistrySkill; installedRoot?: string; entry?: Awaited<ReturnType<typeof installedEntryFor>> };

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
  const created = createSkillRun({
    runId: input.runtimeRunId,
    domain: input.domain,
    targetAgent: input.targetAgent,
    locale: input.profile.locale,
    intent: { sha256: digest(input.profile.normalizedGoal), normalizedGoal: input.profile.normalizedGoal, ...(input.rawIntentPersistence ? { raw: input.rawPrompt ?? input.prompt } : {}) },
    policy: policy ?? { lifecycleRequired: true, mandatorySkillIds: selectedSkills.map(({ skillId }) => skillId), clarification: { required: false, questions: [] }, verificationRequired: false },
  });
  return {
    payload: reduceSkillRun(created, { type: "select-skills", skills: selectedSkills }),
    ...(policy?.clarification.required ? {
      runtimeClarification: {
        questions: policy.clarification.questions,
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
  outcome: DeterministicRoutingOutcome;
}): PrepareTaskCommon => ({
  ok: true,
  schemaVersion: "router-result/1.0",
  activation: input.activation,
  taskProfile: input.profile,
  project: displayProject(input.fingerprint),
  routing: {
    targetAgent: input.targetAgent,
    domains: input.domains,
    deterministicKey: deterministicRoutingKey({
      routerAlgorithmVersion,
      routingDate: input.routingDate,
      activation: input.activation,
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
      domains: input.domains,
      outcome: input.outcome,
      warnings: [...new Set(input.warnings)],
    }),
    routerAlgorithmVersion,
    routingDate: input.routingDate,
    registryDigest: input.registryDigest,
    configDigest: input.configDigest,
  },
  warnings: [...new Set(input.warnings)],
});

const applyClarification = (domainId: string, domains: DomainCandidate[]) => domains.map((domain) => ({ ...domain, role: domain.id === domainId ? "primary" as const : "supporting" as const }));

export const prepareTask = async (input: PrepareTaskCoreInput): Promise<PrepareTaskResult> => {
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
  if (!targetPattern.test(targetAgent) || !Object.hasOwn(agents, targetAgent)) throw new RouterPrepareError("target-agent-unresolved", "Target agent is not a supported canonical ID.");
  const strict = input.strict ?? config.router.strictByDefault;
  const capabilities = capabilityIds([
    { id: "filesystem", source: "server-observed" as const },
    ...(input.capabilities ?? []).filter(({ id }) => canonical(id) !== "filesystem"),
  ]);
  const parsed = parseTrigger({ prompt: input.prompt, mode: input.activation.mode, maxIntentBytes: Math.min(config.router.maxIntentBytes, 64_000) });
  if (!parsed.activated) throw new RouterPrepareError(parsed.reason, parsed.reason === "trigger-required" ? "The explicit @skillranger, skillranger, or /sr trigger is required." : `Cannot prepare task: ${parsed.reason}.`);
  if (Boolean(input.continuationToken) !== Boolean(input.clarificationAnswers)) {
    throw new RouterPrepareError("continuation-invalid", "Continuation token and clarification answers must be supplied together.");
  }

  const routingDate = input.routingDate ?? new Date().toISOString().slice(0, 10);
  const fingerprint = await scanProject(input.projectRoot);
  const fixturePacks = input.registry.kind === "test-fixture" ? await loadRouterFixturePacks(input.registry.root) : [];
  const packs = input.registry.kind === "test-fixture"
    ? fixturePacks.map(({ domain }) => ({ id: domain.id, displayName: domain.displayName, ...(domain.targetSurface ? { targetSurface: domain.targetSurface } : {}), version: "fixture", coreApi: "fixture", skillIdPrefix: `${domain.id}.`, capabilities: ["intent-routing"] as const, artifacts: { intents: [], schemas: [], recipes: [], workflows: [], validators: [] }, ownership: [], routing: domain.routing, root: input.registry.root }))
    : await loadBundledRouterPacks(defaultDomainsRoot);
  const skills = input.registry.kind === "test-fixture"
    ? []
    : await loadLocalRegistry(input.registry.root);
  const fixtureMetadata = fixturePacks.flatMap((pack) => pack.skills.map((skill) => ({
    ...skill,
    packageChecksum: digest(skill.id),
    source: "test-fixture-registry" as const,
    installed: false,
    lockfileMatch: false,
    installedFileSetMatch: false,
    auditPassed: true,
    auditDigest: digest({ skillId: skill.id, fixture: true }),
    strictContract: skill.strictContract === "valid" ? "valid" as const : skill.strictContract === "missing" ? "missing" as const : "input-required" as const,
    contractInputAccepted: false,
    contractMustRead: ["SKILL.md"],
  })));
  const metadata = (await Promise.all(skills.map((skill) => skillMetadata(input.projectRoot, targetAgent, skill, strict, input.skillInputs ?? {}, capabilities))))
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
  const domains = packs.map(domainMetadata);
  const semanticHints = validateSemanticHints({ semanticHints: input.semanticHints, prompt: parsed.normalizedIntent, context: routingContext });
  if (semanticHints.issues.length > 0) throw new RouterPrepareError("semantic-hint-invalid", "Semantic routing hints are invalid.");
  const analysis = analyzeTask({ prompt: parsed.normalizedIntent, domains, skills: allMetadata, routingContext, semanticSignals: semanticHints.signals });
  const registryDigest = routingContext.routingRegistryDigest;
  let routingWarnings = analysis.warnings;
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
    outcome,
  });
  const projectIdentity = await new RouterStore(input.projectRoot).projectIdentity();
  const promptProjection = { actions: analysis.profile.actions, artifactTypes: analysis.profile.artifactTypes, technologies: analysis.profile.technologies, qualityGoals: analysis.profile.qualityGoals, acceptanceCriteria: analysis.profile.acceptanceCriteria, domains: analysis.profile.domains.map(({ id }) => id), subtasks: analysis.profile.subtasks };
  const resolution = resolveDomains({ profile: analysis.profile, domains, skills: allMetadata, fingerprint, availableDomainIds: packs.map(({ id }) => id), thresholds: defaultRouterThresholds, routingIntentTags: analysis.routingIntentTags, routingContext, routingSignals: analysis.matchedSignals });
  routingWarnings = [...new Set([...routingWarnings, ...resolution.warnings])];
  if (input.continuationToken && !resolution.clarificationRequired) {
    throw new RouterPrepareError("continuation-invalid", "Continuation input does not match a routing clarification.");
  }
  const questions = resolution.clarificationRequired ? questionFor(resolution.ambiguousDomainIds.map((id) => resolution.candidates.find((candidate) => candidate.id === id)!).filter(Boolean)) : [];
  let selectedPrimary = resolution.primaryDomainId;
  if (resolution.clarificationRequired) {
    if (!input.continuationToken || !input.clarificationAnswers) {
      const token = createContinuationToken({ fingerprintDigest: digest(fingerprint), registryDigest, configDigest: configResult.digest, routingDate, targetAgent, strict, capabilities, promptProjection, routingProjection: { domains: resolution.ambiguousDomainIds }, projectIdentity }, questions);
      const clarification = { questions };
      return { ...resultCommon(resolution.candidates, { status: "clarification_required", clarification }), status: "clarification_required", clarification, continuationToken: token.token, expiresAt: token.expiresAt };
    }
    try {
      const validated = validateContinuation({ token: input.continuationToken, answers: input.clarificationAnswers, binding: { fingerprintDigest: digest(fingerprint), registryDigest, configDigest: configResult.digest, routingDate, targetAgent, strict, capabilities, promptProjection, routingProjection: { domains: resolution.ambiguousDomainIds }, projectIdentity }, questions });
      selectedPrimary = normalizeDomainAlias(validated.answers[0]?.value ?? "", domains);
      if (!selectedPrimary || !resolution.ambiguousDomainIds.includes(selectedPrimary)) throw new RouterPrepareError("clarification-answer-invalid", "Clarification answer does not identify an available primary domain.");
    } catch (error) {
      if (error instanceof RouterPrepareError) throw error;
      const code = (error as { code?: string }).code === "continuation-expired" ? "continuation-expired" : (error as { code?: string }).code === "clarification-answer-invalid" ? "clarification-answer-invalid" : "continuation-invalid";
      throw new RouterPrepareError(code, "Continuation token or clarification answers are invalid.");
    }
  }
  if (!selectedPrimary) {
    const outcome = { status: "no_matching_skills" as const, suggestedAction: "Proceed without a SkillRanger workflow or add an audited domain pack." };
    return { ...resultCommon(resolution.candidates, outcome), ...outcome };
  }
  const composed = composeSkillSet({
    profile: analysis.profile,
    skills: allMetadata,
    selectedDomainIds: resolution.candidates.map(({ id }) => id),
    primaryDomainId: selectedPrimary,
    targetAgent,
    capabilities,
    strict,
    installedSkillIds: allMetadata.filter(({ installed }) => installed).map(({ id }) => id),
    skillInputs: input.skillInputs,
    fingerprint,
    routingDate,
    routingIntentTags: analysis.routingIntentTags,
    routingContext,
    limits: { ...defaultRouterLimits, maxSelectedRisk: config.router.maxSelectedRisk, maxEnvironmentSkills: config.router.maxEnvironmentSkills, maxTaskCompanions: config.router.maxTaskCompanions, maxVerificationSkills: config.router.maxVerificationSkills, maxAgentContextSkills: config.router.maxAgentContextSkills, maxTotalSelectedSkills: config.router.maxTotalSelectedSkills, maxInstructionBytes: config.router.maxInstructionBytes, maxAdditionalReadBytes: config.router.maxAdditionalReadBytes, maxSingleFileBytes: config.router.maxSingleFileBytes },
  });
  const resultDomains = applyClarification(selectedPrimary, resolution.candidates);
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
    const outcome = { status: "no_matching_skills" as const, suggestedAction: "Proceed without a SkillRanger workflow or add an audited domain pack." };
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
    runtimePayload = await createPreparedStrictSkillRun({ projectRoot: input.projectRoot, targetAgent, domain: selectedPrimary, intent: parsed.normalizedIntent, rawIntent: input.prompt, normalizedGoal: analysis.profile.normalizedGoal, runtimeRunId, selections, metadata: selectedMetadata, fingerprint, skillInputs: input.skillInputs ?? {}, capabilities, storeRawIntent: input.rawIntentPersistence === "explicitly-authorized" });
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
    const lifecycle = await createLifecyclePayload({ runtimeRunId, domain: selectedPrimary, targetAgent, prompt: analysis.profile.normalizedGoal, rawPrompt: input.prompt, policyIntent: parsed.normalizedIntent, profile: analysis.profile, selections: provisionalBase, rawIntentPersistence: input.rawIntentPersistence === "explicitly-authorized" });
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
    routing: { ...base.routing, fingerprintDigest: base.project.fingerprintDigest },
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

import { randomUUID } from "node:crypto";
import { loadRouterConfig, type RouterConfig } from "../config/index.ts";
import { agents } from "../installers/agents.ts";
import { defaultDomainsRoot } from "../paths.ts";
import { readLockfile } from "../lockfile/index.ts";
import type { InstalledSkill, ProjectFingerprint, RegistrySkill } from "../types.ts";
import { scanProject } from "../scanner/index.ts";
import { RoutingContextError } from "./context.ts";
import { RoutingVocabularyValidationError } from "./vocabulary/validate.ts";
import { canonical } from "./canonical.ts";
import { createContinuationToken, validateContinuation, type ContinuationBinding } from "./continuation.ts";
import { parseTrigger } from "./trigger.ts";
import { buildSkillCatalog, SkillCatalogError } from "./catalog.ts";
import { computeSourcePackageChecksum, createSkillSourceSnapshots } from "./reader.ts";
import { RouterStore, routerRecordDigest } from "./store.ts";
import type { RoutingProposalProjection } from "./routing-proposal.ts";
import { loadRoutingWorld, type RoutingWorld } from "./world.ts";
import {
  routerAlgorithmVersion,
  RoutingPipelineError,
  type RoutingPipelineDecision,
} from "./pipeline.ts";
import { createRouterRuntimeBridge } from "./runtime-bridge.ts";
import { RouterPrepareError } from "./errors.ts";
import { normalizeCapabilities, runRoutingEntry, type RoutingEntryInput } from "./entry.ts";
import type {
  DeterministicRoutingOutcome,
  DeterministicRoutingProjection,
  DomainCandidate,
  PrepareTaskCommon,
  PrepareTaskCoreInput,
  PrepareTaskResult,
  RoutingMode,
  RouterRun,
  RuntimeRunReference,
  RuntimeClarificationSummary,
  SkillSourceSnapshot,
} from "./types.ts";
import type { SkillRun } from "../runtime/skill-run/index.ts";
import { createPreparedStrictSkillRun } from "../runtime/strict/service.ts";
import { StrictSkillRunError, type SkillRunV2 } from "../runtime/strict/index.ts";
import { assertInstalledMatches } from "../runtime/strict/service.ts";
import type { RouterLimits, RouterSkillMetadata } from "./composer.ts";
import { defaultRouterLimits } from "./composer.ts";

export { routerAlgorithmVersion } from "./pipeline.ts";
export { RouterPrepareError } from "./errors.ts";
export const deterministicRoutingKey = (projection: DeterministicRoutingProjection) => routerRecordDigest(projection);

const digest = (value: unknown) => routerRecordDigest(value);
const targetPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;

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
  mode: RoutingMode;
  routingProposal?: RoutingProposalProjection;
  outcome: DeterministicRoutingOutcome;
}): PrepareTaskCommon => {
  // A routed outcome is model-assisted only when a validated routing proposal actually
  // participates. Every other routed outcome is limited deterministic fallback, and the
  // pipeline decision already carries the stable recall warning as a fact about the
  // decision; this adapter only shapes the decision onto the public result.
  const mode = input.mode;
  const warnings = [...new Set(input.warnings)];
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
      ...(input.routingProposal ? { routingProposal: input.routingProposal } : {}),
    },
    warnings,
  };
};

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
  // The Routing entry owns capability normalization (canonical form, deduplication,
  // filesystem always present and first); this adapter maps the host-reported
  // capabilities into the canonical id list the entry accepts. Validating through
  // the entry's definition keeps the same early capability-invalid contract.
  const capabilities = normalizeCapabilities((input.capabilities ?? []).map(({ id }) => id));
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
  // The pipeline asserts proposal/semantic-hints mutual exclusion on its input; this
  // pre-check preserves the error precedence and avoids building the catalog for a
  // request that can never route.
  if (input.routingProposal !== undefined && input.semanticHints !== undefined) {
    throw new RouterPrepareError("routing-proposal-invalid", "routingProposal and semanticHints cannot be submitted together.");
  }

  let catalogSnapshot: Awaited<ReturnType<typeof buildSkillCatalog>> | undefined;
  if (input.routingProposal !== undefined) {
    if (input.registry.kind !== "bundled") {
      throw new RouterPrepareError("routing-proposal-invalid", "routingProposal requires the trusted bundled catalog.");
    }
    try {
      catalogSnapshot = await buildSkillCatalog({ registryRoot: input.registry.root, domainsRoot });
    } catch (error) {
      if (error instanceof SkillCatalogError) throw new RouterPrepareError("routing-integrity", "The trusted catalog could not be validated.");
      throw error;
    }
  }

  const routingDate = input.routingDate ?? new Date().toISOString().slice(0, 10);
  const fingerprint = await scanProject(input.projectRoot);
  // Installed marking is an explicit Routing world loader input: task preparation
  // passes lockfile-driven marking, so the loader never reads the lockfile itself
  // and evaluation determinism never depends on the machine.
  const installedMarking = (await readLockfile(input.projectRoot)).installed;
  let world: RoutingWorld;
  try {
    world = await loadRoutingWorld({
      registry: input.registry,
      domainsRoot,
      projectRoot: input.projectRoot,
      targetAgent,
      skillInputs: input.skillInputs ?? {},
      intent: parsed.normalizedIntent,
      installed: installedMarking,
    });
  } catch (error) {
    if (error instanceof RoutingContextError || error instanceof RoutingVocabularyValidationError ||
      (error instanceof Error && error.message.startsWith("routing-vocabulary-"))) {
      throw new RouterPrepareError("routing-integrity", "Routing vocabulary or ownership metadata is invalid.");
    }
    throw error;
  }
  const metadata = world.skills.filter((item): item is PreparedMetadata => item.skill !== undefined);
  const limits: RouterLimits = {
    ...defaultRouterLimits,
    maxSelectedRisk: config.router.maxSelectedRisk,
    maxEnvironmentSkills: config.router.maxEnvironmentSkills,
    maxTaskCompanions: config.router.maxTaskCompanions,
    maxVerificationSkills: config.router.maxVerificationSkills,
    maxAgentContextSkills: config.router.maxAgentContextSkills,
    maxCoreSkills: config.router.maxCoreSkills,
    maxTotalSelectedSkills: config.router.maxTotalSelectedSkills,
    maxInstructionBytes: config.router.maxInstructionBytes,
    maxAdditionalReadBytes: config.router.maxAdditionalReadBytes,
    maxSingleFileBytes: config.router.maxSingleFileBytes,
  };
  // The whole routing decision is delegated to the Routing entry: the entry
  // assembles the pipeline input from the preloaded world and these adapter-owned
  // handles, and owns the shared decision-shaping rules. This adapter only shapes
  // the decision onto the public preparation result.
  const entryInput: RoutingEntryInput = {
    world,
    fingerprint,
    trigger: parsed,
    activation: input.activation,
    targetAgent,
    strict,
    capabilities,
    routingDate,
    limits,
    ...(catalogSnapshot ? { catalog: catalogSnapshot } : {}),
    ...(input.routingProposal !== undefined ? { routingProposal: input.routingProposal } : {}),
    ...(input.semanticHints !== undefined ? { semanticHints: input.semanticHints } : {}),
  };
  const pipelineCall = async (answers?: RoutingEntryInput["answers"]) => {
    try {
      return runRoutingEntry(answers === undefined ? entryInput : { ...entryInput, answers });
    } catch (error) {
      if (error instanceof RoutingPipelineError) throw new RouterPrepareError(error.code as RouterPrepareError["code"], error.message);
      throw error;
    }
  };
  let decision = await pipelineCall();
  if (decision.outcome.status === "catalog_refresh_required") {
    return { ok: true, schemaVersion: "router-result/1.1", ...decision.outcome };
  }
  const activation = { mode: input.activation.mode, ...(parsed.trigger === undefined ? {} : { trigger: parsed.trigger }) };
  const resultCommon = (outcome: DeterministicRoutingOutcome): PrepareTaskCommon => common({
    activation,
    profile: decision.taskProfile!,
    fingerprint,
    targetAgent,
    domains: decision.domains,
    routingDate,
    registryDigest: decision.digests.registryDigest,
    configDigest: configResult.digest,
    warnings: decision.warnings,
    strict,
    capabilities,
    signalDigest: decision.digests.signalDigest,
    vocabularyDigest: decision.digests.vocabularyDigest,
    semanticHintsDigest: decision.digests.semanticHintsDigest,
    mode: decision.mode,
    routingProposal: decision.routingProposal,
    outcome,
  });
  if (input.continuationToken && decision.outcome.status !== "clarification_required") {
    throw new RouterPrepareError("continuation-invalid", "Continuation input does not match a routing clarification.");
  }
  let projectIdentity: string | undefined;
  const projectIdentityFor = async () => projectIdentity ??= await new RouterStore(input.projectRoot).projectIdentity();
  if (decision.outcome.status === "clarification_required") {
    const promptProjection = { actions: decision.taskProfile!.actions, artifactTypes: decision.taskProfile!.artifactTypes, technologies: decision.taskProfile!.technologies, qualityGoals: decision.taskProfile!.qualityGoals, acceptanceCriteria: decision.taskProfile!.acceptanceCriteria, domains: decision.taskProfile!.domains.map(({ id }) => id), subtasks: decision.taskProfile!.subtasks };
    // The continuation module owns token signing, expiry, replay protection, and
    // integrity validation; only the validated answer value reaches the pipeline.
    // The binding is built from the no-answer decision, which is also what the
    // answer pass re-derives, so the two calls can never hand-align differently.
    const continuationBinding: ContinuationBinding = {
      fingerprintDigest: digest(fingerprint),
      registryDigest: decision.digests.registryDigest,
      configDigest: configResult.digest,
      routingDate,
      targetAgent,
      strict,
      capabilities,
      promptProjection,
      routingProjection: {
        domains: decision.continuation.ambiguousDomainIds,
        ...(decision.routingProposal ? { routingProposalDigest: decision.routingProposal.proposalDigest, nominationOrder: decision.continuation.nominationOrder, skillAmbiguityIds: decision.continuation.skillAmbiguityIds } : {}),
      },
      projectIdentity: await projectIdentityFor(),
      routerAlgorithmVersion,
      signalDigest: decision.digests.signalDigest,
      vocabularyDigest: decision.digests.vocabularyDigest,
      semanticHintsDigest: decision.digests.semanticHintsDigest,
    };
    if (!input.continuationToken || !input.clarificationAnswers) {
      const token = createContinuationToken(continuationBinding, decision.outcome.clarification.questions);
      const clarification = { questions: decision.outcome.clarification.questions };
      return { ...resultCommon({ status: "clarification_required", clarification }), status: "clarification_required", clarification, continuationToken: token.token, expiresAt: token.expiresAt };
    }
    try {
      const validated = validateContinuation({ token: input.continuationToken, answers: input.clarificationAnswers, binding: continuationBinding, questions: decision.outcome.clarification.questions });
      decision = await pipelineCall(validated.answers);
    } catch (error) {
      if (error instanceof RoutingPipelineError) throw new RouterPrepareError(error.code as RouterPrepareError["code"], error.message);
      if (error instanceof RouterPrepareError) throw error;
      const code = (error as { code?: string }).code === "continuation-expired" ? "continuation-expired" : (error as { code?: string }).code === "clarification-answer-invalid" ? "clarification-answer-invalid" : "continuation-invalid";
      throw new RouterPrepareError(code, "Continuation token or clarification answers are invalid.");
    }
  }
  const outcome = decision.outcome;
  // Unreachable on the answer pass (a validated continuation implies the no-answer
  // decision was clarification_required, and the same proposal re-validates), but
  // the type system requires the refresh case to be handled here too.
  if (outcome.status === "catalog_refresh_required") {
    return { ok: true, schemaVersion: "router-result/1.1", ...outcome };
  }
  // Also unreachable: an answered pass resolves the no-answer questions or fails
  // closed, so a decision that still asks for clarification cannot surface here.
  if (outcome.status === "clarification_required") {
    throw new RouterPrepareError("continuation-invalid", "Continuation answers did not resolve the routing clarification.");
  }
  if (outcome.status === "no_matching_skills") {
    const result: DeterministicRoutingOutcome = { status: outcome.status, suggestedAction: outcome.suggestedAction, ...(outcome.reasonCode ? { reasonCode: outcome.reasonCode } : {}) };
    return { ...resultCommon(result), ...result };
  }
  if (outcome.status === "decomposition_required") {
    const result: DeterministicRoutingOutcome = { status: outcome.status, decomposition: outcome.decomposition };
    return { ...resultCommon(result), ...result };
  }
  if (outcome.status === "strict-requirements-unmet") {
    // The unmet-strict-requirements outcome is produced here from the pipeline's
    // decision output; the pipeline never names or shapes it itself.
    const result: DeterministicRoutingOutcome = {
      status: "strict_requirements_unmet",
      missing: outcome.missing,
      installationSuggestions: outcome.missing.filter(({ requirement }) => requirement === "installed-skill").map(({ skillId }) => ({ skillId, reason: "The selected strict workflow is not installed for this target agent.", nextTool: "plan_skill_install" as const })),
    };
    return { ...resultCommon(result), ...result };
  }
  if (outcome.status === "context_budget_exceeded") {
    const result: DeterministicRoutingOutcome = { status: outcome.status, requiredBytes: outcome.requiredBytes, allowedBytes: outcome.allowedBytes, blockingSkillIds: outcome.blockingSkillIds };
    return { ...resultCommon(result), ...result };
  }
  const selectedSkillIds = new Set(outcome.selectedSkillIds);
  const unselectedInput = Object.keys(input.skillInputs ?? {}).find((skillId) => !selectedSkillIds.has(skillId));
  if (unselectedInput) throw new RouterPrepareError("routing-integrity", `Skill input was supplied for an unselected skill: ${unselectedInput}.`);
  const selections = outcome.selections;
  const composedPrimaryDomain = outcome.primaryDomain;
  const base = resultCommon({ status: "prepared", selections });
  const selectedMetadata = outcome.selectedSkillIds.map((skillId) => metadata.find(({ id }) => id === skillId)!).filter(Boolean);
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
  const verificationRequired = decision.taskProfile!.acceptanceCriteria.length > 0 || verificationCapabilities.length > 0 || selections.verification.length > 0;
  const provisionalBase = { ...base, status: "prepared" as const, selections, requiredReads: reads, run: { routerRunId: `route_${randomUUID().replaceAll("-", "").slice(0, 16)}`, runtimeRunId, runtime: runtime.kind, strict, readRevision: 0 }, verification: { required: verificationRequired, available: verificationRequired && missingVerificationCapabilities.length === 0, missingCapabilities: missingVerificationCapabilities, expectedEvidenceKinds: decision.taskProfile!.acceptanceCriteria } };
  let runtimeClarification: RuntimeClarificationSummary | undefined;
  let runtimePayload: SkillRun | SkillRunV2;
  // The router-runtime bridge owns lifecycle payload construction, runtime-store
  // dispatch, and the mandatory-read bridge; preparation consumes it instead of
  // building inline adapters.
  const bridge = createRouterRuntimeBridge(input.projectRoot, input.registry.root);
  if (strict) {
    try {
      runtimePayload = await createPreparedStrictSkillRun({ projectRoot: input.projectRoot, targetAgent, domain: composedPrimaryDomain, intent: parsed.normalizedIntent, rawIntent: input.prompt, normalizedGoal: decision.taskProfile!.normalizedGoal, runtimeRunId, selections, metadata: selectedMetadata, fingerprint, skillInputs: input.skillInputs ?? {}, capabilities, storeRawIntent: input.rawIntentPersistence === "explicitly-authorized" });
    } catch (error) {
      if (error instanceof StrictSkillRunError && error.code === "strict-contract-missing" && error.details?.reason === "validator-ownership") {
        const outcome: DeterministicRoutingOutcome = {
          status: "strict_requirements_unmet",
          missing: [{ skillId: typeof error.details.skillId === "string" ? error.details.skillId : undefined, requirement: "strict-contract-v2" as const }],
          installationSuggestions: [],
        };
        return { ...resultCommon(outcome), ...outcome };
      }
      throw error;
    }
    const blocked = runtimePayload.skillLedgers.filter(({ outcome }) => outcome === "blocked");
    if (blocked.length > 0) {
      const outcome: DeterministicRoutingOutcome = {
        status: "strict_requirements_unmet",
        missing: blocked.flatMap(({ skillId, applicability, contract }) => applicability.unmetPrerequisites.map((id) => ({
          skillId,
          requirement: contract.prerequisites.find((prerequisite) => prerequisite.id === id)?.kind === "input" ? "skill-input" as const : "capability" as const,
        }))),
        installationSuggestions: [],
      };
      return { ...resultCommon(outcome), ...outcome };
    }
  } else {
    // ADR 0008: every selected skill that declares an output contract contributes its required
    // report fields; today only the always-on core (universal) skills declare one.
    const coreOutputContracts: Record<string, string[]> = {};
    for (const item of selectedMetadata) {
      const fields = item.skill.manifest.outputContract?.requiredReportFields;
      if (fields && fields.length > 0) coreOutputContracts[item.id] = fields;
    }
    const lifecycle = await bridge.createLifecyclePayload({ runtimeRunId, domain: composedPrimaryDomain, targetAgent, prompt: decision.taskProfile!.normalizedGoal, rawPrompt: input.prompt, policyIntent: parsed.normalizedIntent, profile: decision.taskProfile!, selections: provisionalBase, rawIntentPersistence: input.rawIntentPersistence === "explicitly-authorized", coreOutputContracts });
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
    projectIdentity: await projectIdentityFor(),
    taskProfile: decision.taskProfile!,
    routing: {
      ...base.routing,
      fingerprintDigest: base.project.fingerprintDigest,
      ...(decision.routingProposal ? { routingProposal: decision.routingProposal } : {}),
    },
    selections,
    sourceInventory,
    readLedger: [],
    runtime,
  };
  const runtimeStore = bridge.createRuntimeStore();
  const store = new RouterStore(input.projectRoot, { runtime: runtimeStore });
  await store.journaledCreate({ routerRun, runtimePayload, runtime: runtimeStore });
  return runtimeClarification ? { ...provisionalBase, runtimeClarification } : provisionalBase;
};

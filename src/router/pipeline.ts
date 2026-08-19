import type { ProjectFingerprint } from "../types.ts";
import type { TaskAnalyzerDomainMetadata } from "./analyzer.ts";
import { analyzeTask } from "./analyzer.ts";
import { canonical, skillIndexById } from "./canonical.ts";
import type { SkillCatalogSnapshot } from "./catalog.ts";
import {
  composeSkillSet,
  type CandidateRejection,
  type RouterLimits,
  type RouterSkillMetadata,
} from "./composer.ts";
import type { RoutingContext } from "./context.ts";
import type { ContinuationAnswer, RouterClarificationQuestion } from "./continuation.ts";
import {
  primarySkillAmbiguityQuestionId,
  resolveDeclaredPrimarySkillClarification,
  resolveNomination,
  type ResolvedNomination,
} from "./nomination-resolution.ts";
import { createRetrievalBoundary } from "./retrieval-boundary.ts";
import type { RetrieveSkillCandidatesInput } from "./retrieval.ts";
import { defaultRouterThresholds, normalizeDomainAlias, resolveDomains } from "./resolver.ts";
import {
  detectExplicitSkillChoice,
  RoutingProposalError,
  validateRoutingProposal,
  validateRoutingProposalCatalogBinding,
  validateRoutingProposalShape,
  type RoutingProposalInput,
  type RoutingProposalProjection,
  type RoutingProposalRefresh,
  type ValidatedRoutingProposal,
} from "./routing-proposal.ts";
import { validateSemanticHints } from "./semantic-hints.ts";
import type { MatchedRoutingSignal } from "./vocabulary/match.ts";
import type {
  DomainCandidate,
  PreparedSelections,
  RouterClarification,
  RoutingMode,
  SemanticHintsInput,
  TaskProfile,
  TaskSubtask,
  TriggerParseResult,
} from "./types.ts";
import { limitedDeterministicFallbackMode, modelAssistedMode, semanticRecallLimitedWarning } from "./types.ts";

// The routing algorithm version. It identifies the deterministic routing decision
// (trigger handling, proposal validation, analysis, nomination resolution, domain
// resolution, retrieval boundary, composition, outcome mapping) and travels with
// the algorithm wherever the algorithm lives — here, in the routing pipeline.
export const routerAlgorithmVersion = "router/2.1" as const;

// The routing decision is deterministic and in-memory: no disk, no continuation
// tokens, no strict feasibility I/O. Task preparation and router evaluations are
// adapters over it; continuation-token issuance, the deterministic persistence
// key, and strict feasibility stay outside the pipeline.

export type RoutingPipelineInput = {
  // Trigger info: the parsed trigger result. The adapter parses the trigger (it
  // owns the raw prompt and the config intent budget) and rejects unactivated
  // triggers before the call; the Extract below keeps that invariant at the type
  // level, so the pipeline never sees an unactivated trigger.
  trigger: Extract<TriggerParseResult, { activated: true }>;
  activation: { mode: "explicit" | "direct" };
  // Preloaded router skill metadata, built through the canonical factory. All
  // registry, pack, audit, and lockfile loading happens before the call.
  skills: RouterSkillMetadata[];
  domains: TaskAnalyzerDomainMetadata[];
  fingerprint: ProjectFingerprint;
  routingContext: RoutingContext;
  targetAgent: string;
  strict: boolean;
  capabilities: string[];
  routingDate: string;
  limits: RouterLimits;
  // Preloaded catalog snapshot, required exactly when a routing proposal is
  // submitted (asserted as an input invariant).
  catalog?: SkillCatalogSnapshot;
  // A routing proposal or semantic hints — mutually exclusive, asserted here.
  routingProposal?: RoutingProposalInput;
  semanticHints?: SemanticHintsInput;
  // Validated clarification answers, supplied only on the continuation pass of a
  // previously returned clarification decision. Token integrity and answer-shape
  // validation stay in the adapter; the pipeline applies the values.
  answers?: ContinuationAnswer[];
};

export type RoutingPipelineOutcome =
  | RoutingProposalRefresh
  | { status: "prepared"; selections: PreparedSelections; selectedSkillIds: string[]; primaryDomain: string }
  | { status: "clarification_required"; clarification: RouterClarification }
  | { status: "decomposition_required"; decomposition: { subtasks: TaskSubtask[] } }
  | { status: "no_matching_skills"; suggestedAction: string; reasonCode?: string }
  | {
      // Composition reports that strict eligibility is not met. The public
      // strict_requirements_unmet outcome (with installation suggestions) is
      // produced by the adapter from this decision output, never by the pipeline.
      status: "strict-requirements-unmet";
      missing: Array<{
        skillId: string;
        requirement: "installed-skill" | "lockfile-match" | "strict-contract-v2" | "skill-input" | "capability";
      }>;
    }
  | { status: "context_budget_exceeded"; requiredBytes: number; allowedBytes: number; blockingSkillIds: string[] };

export type RoutingPipelineDecision = {
  schemaVersion: "routing-decision/1.0";
  // The provenance class of the routed outcome: model-assisted only when a
  // validated routing proposal participated.
  mode: RoutingMode;
  outcome: RoutingPipelineOutcome;
  // The canonical deduplicated warning collection. Every routed decision in
  // limited-deterministic fallback mode carries the stable
  // semantic-recall-limited warning as a fact about the decision itself,
  // produced here in the pipeline; adapters never add it by hand. Refresh
  // outcomes short-circuit before any routed decision and keep no warnings.
  warnings: string[];
  // The analysis signal projection: the matched vocabulary signals and the
  // canonical routing intent tags that produced the task profile. Adapters
  // that assert recall (router evaluations) consume it without re-running
  // analysis; task preparation ignores it.
  signals: {
    matchedSignals: MatchedRoutingSignal[];
    routingIntentTags: string[];
  };
  // Absent only for catalog_refresh_required outcomes, which carry no routed
  // task profile at all.
  taskProfile?: TaskProfile;
  // The outcome-mapped domain candidates exactly as the public preparation
  // result carries them (roles applied for prepared outcomes).
  domains: DomainCandidate[];
  digests: {
    registryDigest: string;
    signalDigest: string;
    vocabularyDigest: string;
    semanticHintsDigest: string;
  };
  routingProposal?: RoutingProposalProjection;
  // The clarification eligibility projection the adapter binds into a
  // continuation token: ambiguous domain ids, the declared nomination order
  // (explicit choice first), and the eligible skill ambiguity ids.
  continuation: {
    ambiguousDomainIds: string[];
    nominationOrder: string[];
    skillAmbiguityIds: string[];
  };
  // Composition rejection reasons; empty when no composition ran.
  rejections: CandidateRejection[];
};

export type RoutingPipelineErrorCode =
  | "routing-proposal-invalid"
  | "semantic-hint-invalid"
  | "clarification-answer-invalid"
  | "continuation-invalid";

export class RoutingPipelineError extends Error {
  readonly code: RoutingPipelineErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: RoutingPipelineErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "RoutingPipelineError";
    this.code = code;
    this.details = details;
  }
}

// The canonical skill-index lookup is pipeline-shared: ids are matched
// canonically, so proposal-supplied ids that vary in case still resolve to the
// same metadata entry. Evaluations build their own one-line index over the
// same metadata.

const noMatchSuggestedAction = "Proceed without a SkillRanger workflow or add an audited domain pack.";

const questionFor = (domains: DomainCandidate[]): RouterClarificationQuestion[] => [{
  id: "primary-domain",
  text: "Which target surface should be the primary workflow?",
  options: domains.map(({ id }) => ({ value: canonical(id), label: id })),
}];

const applyClarification = (domainId: string, domains: DomainCandidate[]) => domains.map((domain) => ({ ...domain, role: domain.id === domainId ? "primary" as const : "supporting" as const }));

const decisionFor = (input: {
  mode: RoutingMode;
  outcome: RoutingPipelineOutcome;
  warnings: string[];
  profile?: TaskProfile;
  domains: DomainCandidate[];
  digests: RoutingPipelineDecision["digests"];
  signals: RoutingPipelineDecision["signals"];
  routingProposal?: ValidatedRoutingProposal;
  continuation: RoutingPipelineDecision["continuation"];
  rejections: CandidateRejection[];
}): RoutingPipelineDecision => ({
  schemaVersion: "routing-decision/1.0",
  mode: input.mode,
  outcome: input.outcome,
  warnings: input.warnings,
  ...(input.profile ? { taskProfile: input.profile } : {}),
  domains: input.domains,
  digests: input.digests,
  signals: input.signals,
  ...(input.routingProposal ? { routingProposal: input.routingProposal.projection } : {}),
  continuation: input.continuation,
  rejections: input.rejections,
});

// The routing pipeline: one deterministic, in-memory decision from a preloaded
// input object. Trigger parsing, registry/pack/audit/lockfile loading, catalog
// building, and routing-context compilation happen before the call; continuation
// tokens, persistence, and strict feasibility stay outside.
export const runRoutingPipeline = (input: RoutingPipelineInput): RoutingPipelineDecision => {
  // Input invariants: a routing proposal and semantic hints are mutually
  // exclusive, and a routing proposal requires a preloaded catalog snapshot.
  if (input.routingProposal !== undefined && input.semanticHints !== undefined) {
    throw new RoutingPipelineError("routing-proposal-invalid", "routingProposal and semanticHints cannot be submitted together.");
  }
  if (input.routingProposal !== undefined && input.catalog === undefined) {
    throw new RoutingPipelineError("routing-proposal-invalid", "routingProposal requires a preloaded skill catalog snapshot.");
  }

  // Proposal validation: shape, catalog binding, then semantics. Each step can
  // short-circuit with a catalog-refresh decision or fail the routing.
  let routingProposal: ValidatedRoutingProposal | undefined;
  if (input.routingProposal !== undefined) {
    let shapedProposal: ReturnType<typeof validateRoutingProposalShape>;
    try {
      shapedProposal = validateRoutingProposalShape(input.routingProposal);
    } catch (error) {
      if (error instanceof RoutingProposalError) throw new RoutingPipelineError(error.code, error.message, error.details);
      throw error;
    }
    try {
      const refresh = validateRoutingProposalCatalogBinding({ proposal: shapedProposal, catalog: input.catalog! });
      if (refresh) return refreshDecision(refresh);
    } catch (error) {
      if (error instanceof RoutingProposalError) throw new RoutingPipelineError(error.code, error.message, error.details);
      throw error;
    }
    try {
      const ownerChecked = validateRoutingProposal({
        proposal: shapedProposal,
        prompt: input.trigger.normalizedIntent,
        catalog: input.catalog!,
        routingContext: input.routingContext,
      });
      if ("status" in ownerChecked) return refreshDecision(ownerChecked);
      routingProposal = ownerChecked;
    } catch (error) {
      if (error instanceof RoutingProposalError) throw new RoutingPipelineError(error.code, error.message, error.details);
      throw error;
    }
  }

  const semanticHints = validateSemanticHints({ semanticHints: input.semanticHints, prompt: input.trigger.normalizedIntent, context: input.routingContext });
  if (semanticHints.issues.length > 0) throw new RoutingPipelineError("semantic-hint-invalid", "Semantic routing hints are invalid.");

  const analysis = analyzeTask({
    prompt: input.trigger.normalizedIntent,
    domains: input.domains,
    skills: input.skills,
    routingContext: input.routingContext,
    semanticSignals: [...semanticHints.signals, ...(routingProposal?.semanticSignals ?? [])],
  });
  const digests: RoutingPipelineDecision["digests"] = {
    registryDigest: input.routingContext.routingRegistryDigest,
    signalDigest: analysis.signalDigest,
    vocabularyDigest: input.routingContext.vocabularyDigest,
    semanticHintsDigest: semanticHints.digest,
  };
  const mode: RoutingMode = routingProposal ? modelAssistedMode : limitedDeterministicFallbackMode;
  const signals: RoutingPipelineDecision["signals"] = {
    matchedSignals: analysis.matchedSignals,
    routingIntentTags: analysis.routingIntentTags,
  };
  // A fallback-mode routed decision carries the stable semantic-recall-limited
  // warning as a fact about the decision: the mode says the decision is
  // fallback, and the warning says its semantic recall is limited. Refresh
  // outcomes short-circuit before this point, so they never carry the warning.
  let routingWarnings = [
    ...analysis.warnings,
    ...(routingProposal?.rejections.map(({ skillId, reasonCode }) =>
      `routing-proposal-rejected:${skillId ?? "unknown"}:${reasonCode}`) ?? []),
    ...(mode === limitedDeterministicFallbackMode ? [semanticRecallLimitedWarning] : []),
  ];
  const installedSkillIds = input.skills.filter(({ installed }) => installed).map(({ id }) => id);

  const catalogSkill = (skillId: string) => input.catalog?.skills.find(({ skillId: id }) => id === skillId);
  const explicitSkillId = routingProposal
    ? detectExplicitSkillChoice(input.trigger.normalizedIntent, input.skills.map(({ id }) => id))
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
  const resolution = resolveDomains({
    profile: analysis.profile,
    domains: input.domains,
    skills: input.skills,
    fingerprint: input.fingerprint,
    availableDomainIds: input.domains.map(({ id }) => id),
    thresholds: defaultRouterThresholds,
    routingIntentTags: analysis.routingIntentTags,
    routingContext: input.routingContext,
    routingSignals: analysis.matchedSignals,
  });
  const declaredAmbiguityIds = routingProposal?.ambiguity?.primarySkillIds ?? [];
  // A continuation answer only permutes the primary nomination order (the selected
  // nomination moves to the front), so the domain union below is permutation-invariant
  // across clarification calls and matches the historical composition input.
  const skillById = skillIndexById(input.skills);
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
    skills: input.skills,
    targetAgent: input.targetAgent,
    capabilities: input.capabilities,
    strict,
    installedSkillIds,
    selectedDomainIds: routingCandidates.map(({ id }) => id),
    primaryDomainId,
    fingerprint: input.fingerprint,
    routingDate: input.routingDate,
    routingIntentTags: analysis.routingIntentTags,
    routingContext: input.routingContext,
    matchedSignals: analysis.matchedSignals,
    ...(nomination ? { nominatedSkillIds: nomination.nominatedSkillIds, nominatedPrimarySkillIds: nomination.nominatedPrimarySkillIds, nominatedRoles: nomination.nominatedRoles } : {}),
    maxSelectedRisk: input.limits.maxSelectedRisk,
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
  const ambiguityClarificationInput = {
    declaredAmbiguityIds,
    explicitSkillId,
    eligibilityFacts: nominatedPrimaryFacts,
    declaredNominations,
    displayNameFor: (skillId: string) => catalogSkill(skillId)?.displayName,
  };
  const ambiguityClarification = resolveDeclaredPrimarySkillClarification(ambiguityClarificationInput);
  if (ambiguityClarification.kind === "ambiguity-ineligible") {
    throw new RoutingPipelineError(
      "routing-proposal-invalid",
      `Declared primary ambiguity choices are not eligible primary nominations: ${ambiguityClarification.ineligibleSkillIds.join(", ")}.`,
    );
  }
  const skillAmbiguityIds = ambiguityClarification.kind === "clarification-required"
    ? ambiguityClarification.eligibleSkillIds
    : [];
  routingWarnings = [...new Set([...routingWarnings, ...resolution.warnings])];
  if (input.answers !== undefined && !resolution.clarificationRequired && skillAmbiguityIds.length === 0) {
    throw new RoutingPipelineError("continuation-invalid", "Continuation input does not match a routing clarification.");
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
  if (questions.length > 0 && input.answers !== undefined) {
    // The answer pass reuses the no-answer decision input; any outcome other
    // than an accepted answer fails closed, matching the guarantee that no run
    // state is created before a valid choice is resolved.
    const domainAnswer = input.answers.find(({ questionId }) => questionId === "primary-domain");
    if (resolution.clarificationRequired) {
      selectedPrimary = normalizeDomainAlias(domainAnswer?.value ?? "", input.domains);
      if (!selectedPrimary || !resolution.ambiguousDomainIds.includes(selectedPrimary)) throw new RoutingPipelineError("clarification-answer-invalid", "Clarification answer does not identify an available primary domain.");
    }
    const skillAnswer = input.answers.find(({ questionId }) => questionId === primarySkillAmbiguityQuestionId);
    if (skillAmbiguityIds.length > 0) {
      const appliedClarification = resolveDeclaredPrimarySkillClarification({
        ...ambiguityClarificationInput,
        answer: skillAnswer?.value,
      });
      if (appliedClarification.kind !== "answer-accepted") {
        throw new RoutingPipelineError("clarification-answer-invalid", "Clarification answer does not identify an available nominated skill.");
      }
      resolvedNomination = appliedClarification.resolvedNomination;
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
  if (questions.length > 0 && input.answers === undefined) {
    const clarification = { questions };
    return decisionFor({
      mode,
      outcome: { status: "clarification_required", clarification },
      warnings: routingWarnings,
      profile: analysis.profile,
      domains: resolution.candidates,
      digests,
      signals,
      routingProposal,
      continuation: { ambiguousDomainIds: resolution.ambiguousDomainIds, nominationOrder, skillAmbiguityIds },
      rejections: [],
    });
  }
  if (!selectedPrimary) {
    const outcome = { status: "no_matching_skills" as const, suggestedAction: noMatchSuggestedAction };
    return decisionFor({
      mode,
      outcome,
      warnings: routingWarnings,
      profile: analysis.profile,
      domains: resolution.candidates,
      digests,
      signals,
      routingProposal,
      continuation: { ambiguousDomainIds: resolution.ambiguousDomainIds, nominationOrder, skillAmbiguityIds },
      rejections: [],
    });
  }
  if (analysis.profile.subtasks.length >= 2) {
    const outcome = { status: "decomposition_required" as const, decomposition: { subtasks: analysis.profile.subtasks } };
    return decisionFor({
      mode,
      outcome,
      warnings: routingWarnings,
      profile: analysis.profile,
      domains: resolution.candidates,
      digests,
      signals,
      routingProposal,
      continuation: { ambiguousDomainIds: resolution.ambiguousDomainIds, nominationOrder, skillAmbiguityIds },
      rejections: [],
    });
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
    : createRetrievalBoundary(retrievalBoundaryInput(selectedPrimary, input.strict, resolvedNomination));
  const composed = composeSkillSet({
    profile: analysis.profile,
    requirements: analysis.requirements,
    skills: input.skills,
    primaryDomainId: selectedPrimary,
    capabilities: input.capabilities,
    strict: input.strict,
    installedSkillIds,
    fingerprint: input.fingerprint,
    routingContext: input.routingContext,
    resolvedNomination,
    boundary,
    limits: input.limits,
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
  // The routed primary domain is the composed primary skill's own domain: the
  // skill's domain matching the selected primary, else its domain among the
  // routed candidates, else its first domain, else the selected primary itself.
  let composedPrimaryDomain = selectedPrimary;
  if (composed.status === "prepared") {
    const primarySkillDomains = composed.composed.primary.skill.domains;
    composedPrimaryDomain = primarySkillDomains.find((domainId) => canonical(domainId) === canonical(selectedPrimary))
      ?? primarySkillDomains.find((domainId) => routingCandidateIds.has(canonical(domainId)))
      ?? primarySkillDomains[0]
      ?? selectedPrimary;
  }
  const resultDomains = applyClarification(composedPrimaryDomain, routingCandidates);
  const continuation = { ambiguousDomainIds: resolution.ambiguousDomainIds, nominationOrder, skillAmbiguityIds };
  const base = {
    mode,
    warnings: routingWarnings,
    profile: analysis.profile,
    digests,
    signals,
    routingProposal,
    continuation,
    rejections: composed.rejections,
  };
  if (composed.status === "decomposition_required") {
    const outcome: RoutingPipelineOutcome = { status: composed.status, decomposition: { subtasks: composed.subtasks } };
    return decisionFor({ ...base, outcome, domains: resultDomains });
  }
  if (composed.status === "strict_requirements_unmet") {
    const outcome: RoutingPipelineOutcome = { status: "strict-requirements-unmet", missing: composed.missing };
    return decisionFor({ ...base, outcome, domains: resultDomains });
  }
  if (composed.status === "context_budget_exceeded") {
    const outcome: RoutingPipelineOutcome = { status: composed.status, requiredBytes: composed.requiredBytes, allowedBytes: composed.allowedBytes, blockingSkillIds: composed.blockingSkillIds };
    return decisionFor({ ...base, outcome, domains: resultDomains });
  }
  if (composed.status === "no_matching_skills") {
    const outcome: RoutingPipelineOutcome = { status: composed.status, suggestedAction: noMatchSuggestedAction, ...(composed.reasonCode ? { reasonCode: composed.reasonCode } : {}) };
    return decisionFor({ ...base, outcome, domains: resultDomains });
  }
  const outcome: RoutingPipelineOutcome = {
    status: "prepared",
    selections: composed.composed.selections,
    selectedSkillIds: composed.composed.all.map(({ skill }) => skill.id),
    primaryDomain: composedPrimaryDomain,
  };
  return decisionFor({ ...base, outcome, domains: resultDomains });
};

const refreshDecision = (refresh: RoutingProposalRefresh): RoutingPipelineDecision => decisionFor({
  mode: limitedDeterministicFallbackMode,
  outcome: refresh,
  warnings: [],
  domains: [],
  digests: { registryDigest: "", signalDigest: "", vocabularyDigest: "", semanticHintsDigest: "" },
  signals: { matchedSignals: [], routingIntentTags: [] },
  continuation: { ambiguousDomainIds: [], nominationOrder: [], skillAmbiguityIds: [] },
  rejections: [],
});

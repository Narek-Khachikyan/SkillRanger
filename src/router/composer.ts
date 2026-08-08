import type { ProjectFingerprint, RegistrySkill } from "../types.ts";
import type { RoutingContext } from "./context.ts";
import { resolveDomainPackForSkill } from "../domains/registry.ts";
import { orderScoredCandidates, scoreFreshness, scoreSharedFeatures } from "../recommender/scoring.ts";
import type {
  DomainCandidate,
  PreparedSelections,
  PreparedSkillSelection,
  RouterSkillRole,
  RouterSelectableRisk,
  TaskAction,
  TaskProfile,
  TaskSubtask,
} from "./types.ts";
import type { TaskAnalyzerSkillMetadata } from "./analyzer.ts";
import { actionCompatibilityScore, scoreActionCompatibility } from "./action-compatibility.ts";
import {
  actionRequirementCovered,
  calculateRequirementCoverage,
  dedupeRequirements,
  effectiveRequirementWeight,
  requirementKey,
} from "./coverage.ts";
import { collectAvailableEvidence, evaluateRequiredEvidence, requiredEvidenceForCandidate } from "./evidence.ts";
import {
  buildNominatedPrimaryEligibilityFacts,
  explicitSkillChoiceReasonCode,
  resolvePrimaryArbitration,
  type NominatedPrimaryEligibilityFacts,
  type ResolvedNomination,
} from "./nomination-resolution.ts";
import type { CanonicalRequirement } from "./requirements.ts";
import type { MatchedRoutingSignal } from "./vocabulary/match.ts";

export type RouterLimits = {
  maxSelectedRisk: RouterSelectableRisk;
  maxEnvironmentSkills: number;
  maxTaskCompanions: number;
  maxVerificationSkills: number;
  maxAgentContextSkills: number;
  maxTotalSelectedSkills: number;
  maxInstructionBytes: number;
  maxAdditionalReadBytes: number;
  maxSingleFileBytes: number;
  chunkBytes: number;
};

export const defaultRouterLimits: RouterLimits = {
  maxSelectedRisk: "medium",
  maxEnvironmentSkills: 2,
  maxTaskCompanions: 2,
  maxVerificationSkills: 2,
  maxAgentContextSkills: 1,
  maxTotalSelectedSkills: 7,
  maxInstructionBytes: 120_000,
  maxAdditionalReadBytes: 80_000,
  maxSingleFileBytes: 256_000,
  chunkBytes: 16_384,
};

export type RouterSkillMetadata = TaskAnalyzerSkillMetadata & {
  id: string;
  displayName: string;
  version: string;
  riskLevel: RouterSelectableRisk | "high" | "block";
  packageChecksum?: string;
  source?: "installed" | "bundled-registry" | "test-fixture-registry";
  auditPassed?: boolean;
  supportedTargets?: string[];
  targetAgents?: string[];
  strictContract?: "valid" | "missing" | "input-required";
  installed?: boolean;
  score?: number;
  requiredCapabilities?: string[];
  routingRequiredCapabilities?: string[];
  verificationRequiredCapabilities?: string[];
  strictPrerequisiteCapabilities?: string[];
  optionalCapabilities?: string[];
  complements?: string[];
  dependencies?: string[];
  conflictsWith?: string[];
  supersedes?: string[];
  instructionBytes?: number;
  environmentSignals?: string[];
  applicabilitySignal?: { collection: string; name: string; minConfidence: number };
  securityScore?: number;
  qualityScore?: number;
  freshnessDate?: string;
  evaluationPenalty?: number;
  compatibilityScore?: number;
  laneAdjustment?: number;
  skillAdjustment?: number;
  auditDigest?: string;
  lockfileMatch?: boolean;
  installedFileSetMatch?: boolean;
  contractInputAccepted?: boolean;
  contractMustRead?: string[];
};

export type RouterCandidate = {
  skill: RouterSkillMetadata;
  score: number;
  eligibleRoles: RouterSkillRole[];
  reasons: string[];
  missingCapabilities: string[];
  missingOptionalCapabilities: string[];
  verificationStatus: "ready" | "guidance-only" | "not-required";
};

export type SelectedRouterCandidate = RouterCandidate & { role: RouterSkillRole };

export type RetrieveSkillCandidatesInput = {
  profile: TaskProfile;
  requirements?: CanonicalRequirement[];
  skills: RouterSkillMetadata[];
  targetAgent?: string;
  capabilities?: Iterable<string>;
  strict?: boolean;
  installedSkillIds?: Iterable<string>;
  selectedDomainIds?: Iterable<string>;
  primaryDomainId?: string;
  primaryThreshold?: number;
  fingerprint?: ProjectFingerprint;
  skillInputs?: Record<string, Record<string, unknown>>;
  deferRequiredCapabilities?: boolean;
  routingContext?: RoutingContext;
  matchedSignals?: MatchedRoutingSignal[];
  routingDate?: string;
  routingIntentTags?: string[];
  maxSelectedRisk?: RouterSelectableRisk;
  nominatedSkillIds?: Iterable<string>;
  nominatedPrimarySkillIds?: Iterable<string>;
  nominatedRoles?: ReadonlyMap<string, "primary" | "companion" | "verification">;
};

export type CandidateRejection = {
  skillId: string;
  reason: string;
};

export type RetrieveSkillCandidatesResult = {
  candidates: RouterCandidate[];
  primaryCandidates: RouterCandidate[];
  rejections: CandidateRejection[];
};

export type ComposeSkillSetInput = Omit<RetrieveSkillCandidatesInput, "nominatedSkillIds" | "nominatedPrimarySkillIds" | "nominatedRoles"> & {
  resolvedNomination?: ResolvedNomination;
  candidates?: RouterCandidate[];
  retrievalResult?: RetrieveSkillCandidatesResult;
  // Precomputed eligibility facts for the nominated primaries, produced by the
  // retrieval owner from the same retrieval result (e.g. the ambiguity probe).
  // When supplied together with retrievalResult, they replace the recomputed
  // projection so eligibility is never derived twice from the same result.
  nominatedPrimaryEligibilityFacts?: NominatedPrimaryEligibilityFacts[];
  domainCandidates?: DomainCandidate[];
  fingerprint?: ProjectFingerprint;
  limits?: Partial<RouterLimits>;
};

export type ComposedSkillSet = {
  primary: SelectedRouterCandidate;
  environment: SelectedRouterCandidate[];
  companions: SelectedRouterCandidate[];
  verification: SelectedRouterCandidate[];
  agentContext: SelectedRouterCandidate[];
  all: SelectedRouterCandidate[];
  selections: PreparedSelections;
  warnings: string[];
  instructionBytes: number;
};

export type ComposeSkillSetResult =
  | { status: "prepared"; composed: ComposedSkillSet; rejections: CandidateRejection[] }
  | { status: "no_matching_skills"; reasonCode: string; rejections: CandidateRejection[] }
  | { status: "decomposition_required"; subtasks: TaskSubtask[]; rejections: CandidateRejection[] }
  | { status: "strict_requirements_unmet"; missing: Array<{ skillId: string; requirement: "installed-skill" | "lockfile-match" | "strict-contract-v2" | "skill-input" | "capability" }>; rejections: CandidateRejection[] }
  | { status: "context_budget_exceeded"; requiredBytes: number; allowedBytes: number; blockingSkillIds: string[]; rejections: CandidateRejection[] };

const canonical = (value: string) => value.normalize("NFKC").trim().toLowerCase();
const unique = (values: Iterable<string>) => new Set([...values].map(canonical));
const intersectionSize = (left: Iterable<string>, right: Iterable<string>) => {
  const rightSet = unique(right);
  return [...unique(left)].filter((value) => rightSet.has(value)).length;
};
const sorted = <T extends { skill: RouterSkillMetadata; score: number }>(items: T[]) => orderScoredCandidates(
  items,
  (candidate) => candidate.score,
  (candidate) => candidate.skill.id,
  (candidate) => candidate.skill.qualityScore ?? 0,
);

const sortedPrimary = <T extends RouterCandidate>(items: T[], requirements: CanonicalRequirement[] = [], routingContext?: RoutingContext, nominationOrder?: ReadonlyMap<string, number>) => [...items].sort((left, right) =>
  (nominationOrder?.get(canonical(left.skill.id)) ?? Number.POSITIVE_INFINITY) - (nominationOrder?.get(canonical(right.skill.id)) ?? Number.POSITIVE_INFINITY) ||
  right.score - left.score ||
  (right.skill.skillAdjustment ?? 0) - (left.skill.skillAdjustment ?? 0) ||
  calculateRequirementCoverage({ requirements, skill: right.skill, routingContext }).coveredWeight - calculateRequirementCoverage({ requirements, skill: left.skill, routingContext }).coveredWeight ||
  (right.skill.qualityScore ?? 0) - (left.skill.qualityScore ?? 0) ||
  left.skill.id.localeCompare(right.skill.id));

const orderMap = (skillIds: Iterable<string>) => new Map([...new Set([...skillIds].map(canonical))].map((skillId, index) => [skillId, index]));

const roleOrder: RouterSkillRole[] = ["primary", "environment", "companion", "verification", "agent-context"];
const rolesFor = (skill: RouterSkillMetadata) => roleOrder.filter((role) => skill.roles?.includes(role));

const environmentSignalMatches = (fingerprint: ProjectFingerprint | undefined, signal: string) => {
  if (!fingerprint) return false;
  const separator = signal.indexOf(":");
  if (separator < 1) return false;
  const operator = signal.slice(0, separator);
  const operand = signal.slice(separator + 1).toLowerCase();
  const values = operator === "dependency"
    ? fingerprint.dependencies ?? []
    : operator === "framework"
      ? fingerprint.frameworks.map(({ name }) => name)
      : operator === "language"
        ? fingerprint.languages.map(({ name }) => name)
        : operator === "testing"
          ? fingerprint.testing.map(({ name }) => name)
          : operator === "infrastructure"
            ? fingerprint.infrastructure.map(({ name }) => name)
            : fingerprint.signals;
  if (operator === "file") {
    const pattern = new RegExp(`^${operand.replace(/[.+^${}()|[\\]\\]/g, "\\\\$&").replaceAll("*", ".*").replaceAll("?", ".")}$`, "i");
    return values.some((value) => pattern.test(value));
  }
  return values.some((value) => value.toLowerCase() === operand);
};

const applicabilitySignalMatches = (fingerprint: ProjectFingerprint | undefined, signal: RouterSkillMetadata["applicabilitySignal"]) => {
  if (!fingerprint || !signal) return false;
  const values = signal.collection === "projectTypes" ? fingerprint.projectTypes
    : signal.collection === "languages" ? fingerprint.languages
      : signal.collection === "frameworks" ? fingerprint.frameworks
        : signal.collection === "styling" ? fingerprint.styling
          : signal.collection === "testing" ? fingerprint.testing
            : signal.collection === "infrastructure" ? fingerprint.infrastructure : [];
  return values.some((value) => {
    const name = "name" in value ? value.name : value.type;
    return name.toLowerCase() === signal.name.toLowerCase() && value.confidence >= signal.minConfidence;
  });
};

const hasExplicitTechnologyIntent = (profile: TaskProfile, technology: string) =>
  profile.technologies.some((value) => canonical(value) === canonical(technology))
  || new RegExp(`\\b${technology.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")}\\b`, "i").test(profile.normalizedGoal);

const scoreSkill = (profile: TaskProfile, skill: RouterSkillMetadata, selectedDomains: Set<string>, fingerprint?: ProjectFingerprint, routingDate = "1970-01-01", routingIntentTags: string[] = []) => {
  const domainMatch = skill.domains.some((domain) => selectedDomains.has(canonical(domain))) ? 1 : 0;
  const actionMatches = profile.actions.filter((requested) => skill.actions.some((supported) => actionCompatibilityScore(requested, supported) > 0));
  const artifactMatch = intersectionSize(profile.artifactTypes, skill.artifactTypes);
  const technologyMatch = intersectionSize(profile.technologies, skill.technologyTags);
  const intentSignals = unique([
    ...profile.evidence.filter(({ source }) => source === "prompt").map(({ id }) => id),
    ...profile.qualityGoals,
    ...routingIntentTags,
  ]);
  const intentMatch = intersectionSize(
    intentSignals,
    [...skill.intentTags, ...skill.qualityGoals],
  );
  const actionScore = scoreActionCompatibility({ requestedActions: profile.actions, skillActions: skill.actions });
  const artifactScore = profile.artifactTypes.length === 0 ? 0 : Math.min(1, artifactMatch / profile.artifactTypes.length);
  const technologyScore = profile.technologies.length === 0 ? 0 : Math.min(1, technologyMatch / profile.technologies.length);
  const intentScore = intentSignals.size === 0 ? 0 : Math.min(1, intentMatch / intentSignals.size);
  const requestedScores = [
    ...(profile.actions.length > 0 ? [actionScore] : []),
    ...(profile.artifactTypes.length > 0 ? [artifactScore] : []),
    ...(profile.technologies.length > 0 ? [technologyScore] : []),
    ...(intentSignals.size > 0 ? [intentScore] : []),
  ];
  const userIntentMatch = requestedScores.length === 0
    ? 0
    : requestedScores.reduce((sum, value) => sum + value, 0) / requestedScores.length;
  const environmentMatch = (skill.environmentSignals ?? []).length === 0
    ? 0
    : (skill.environmentSignals ?? []).filter((signal) => environmentSignalMatches(fingerprint, signal)).length / (skill.environmentSignals ?? []).length;
  const score = skill.score ?? scoreSharedFeatures({
    stackMatch: Math.max(domainMatch, technologyScore, environmentMatch),
    userIntentMatch,
    effectiveQualityScore: skill.qualityScore ?? 0.5,
    securityScore: skill.securityScore ?? 0.5,
    freshnessScore: scoreFreshness(skill.freshnessDate, routingDate),
    compatibilityScore: skill.compatibilityScore ?? 1,
    duplicatePenalty: 0,
    evaluationPenalty: skill.evaluationPenalty ?? 0,
    laneAdjustment: skill.laneAdjustment ?? 0,
    skillAdjustment: skill.skillAdjustment ?? 0,
  });
  const reasons = [
    ...(domainMatch ? skill.domains.filter((id) => selectedDomains.has(canonical(id))).map((id) => `domain-match:${id}`) : []),
    ...[...unique(actionMatches)].map((id) => `action-match:${id}`),
    ...(artifactMatch ? [...unique(profile.artifactTypes)].filter((id) => unique(skill.artifactTypes).has(id)).map((id) => `artifact-match:${id}`) : []),
    ...(technologyMatch ? [...unique(profile.technologies)].filter((id) => unique(skill.technologyTags).has(id)).map((id) => `technology-match:${id}`) : []),
    ...(environmentMatch > 0 ? [`environment-match:${skill.id}`] : []),
    ...(intentMatch ? [...unique(profile.qualityGoals)].filter((id) => unique([...skill.intentTags, ...skill.qualityGoals]).has(id)).map((id) => `quality-goal-match:${id}`) : []),
  ];
  return { score, reasons: reasons.length > 0 ? reasons : [`domain-match:${skill.domains[0] ?? "unknown"}`] };
};

const compatibleTarget = (skill: RouterSkillMetadata, targetAgent: string) => {
  const targets = skill.supportedTargets ?? skill.targetAgents;
  return targets && targets.length > 0
    ? targets.some((target) => canonical(target) === canonical(targetAgent))
    : true;
};

const requiredCapabilities = (skill: RouterSkillMetadata) => skill.requiredCapabilities ?? [];
const optionalCapabilities = (skill: RouterSkillMetadata) => skill.optionalCapabilities ?? [];

export const retrieveSkillCandidates = (input: RetrieveSkillCandidatesInput): RetrieveSkillCandidatesResult => {
  const targetAgent = input.targetAgent ?? "codex";
  const capabilities = unique(input.capabilities ?? []);
  const installed = unique(input.installedSkillIds ?? []);
  const selectedDomains = unique(input.selectedDomainIds ?? input.profile.domains.filter(({ available }) => available).map(({ id }) => id));
  const primaryDomainId = input.primaryDomainId ? canonical(input.primaryDomainId) : undefined;
  const threshold = input.primaryThreshold ?? 0.60;
  const nominatedPrimarySkillIds = unique(input.nominatedPrimarySkillIds ?? input.nominatedSkillIds ?? []);
  const availableEvidence = collectAvailableEvidence({ matchedSignals: input.matchedSignals ?? [] });
  const rejections: CandidateRejection[] = [];
  const candidates = input.skills.flatMap((skill) => {
    let eligibleRoles = rolesFor(skill);
    if (eligibleRoles.length === 0) { rejections.push({ skillId: skill.id, reason: "router-metadata-incomplete" }); return []; }
    const domainMatch = skill.domains.some((domain) => selectedDomains.has(canonical(domain)));
    const nominatedPrimary = nominatedPrimarySkillIds.has(canonical(skill.id));
    // A catalog-bound primary nomination is already prompt-grounded and may name a
    // domain that lexical routing did not detect. Keep all other eligibility gates
    // intact, but do not let the lexical domain filter erase the nomination before
    // ordered hard-veto fallback can consider it.
    if (!domainMatch && !nominatedPrimary) { rejections.push({ skillId: skill.id, reason: "domain-mismatch" }); return []; }
    if (primaryDomainId && eligibleRoles.includes("primary") && !nominatedPrimary && !skill.domains.some((domain) => canonical(domain) === primaryDomainId)) {
      eligibleRoles = eligibleRoles.filter((role) => role !== "primary");
      if (eligibleRoles.length === 0) { rejections.push({ skillId: skill.id, reason: "primary-domain-mismatch" }); return []; }
    }
    const hasAgentsMdSignal = Boolean(
      input.routingIntentTags?.includes("agents-md-bootstrap") ||
      input.matchedSignals?.some((signal) =>
        /agents\.md|agent instructions|agent context|coding agent guidance|инструкции для агента|контекст агента/i.test(signal.phrase) ||
        signal.id.includes("agents-md")
      ) ||
      (input.profile.normalizedGoal && /agents\.md|agent instructions|agent context|coding agent guidance|инструкции для агента|контекст агента/i.test(input.profile.normalizedGoal))
    );
    if (skill.id === "frontend.agents-md-bootstrap" && !hasAgentsMdSignal) {
      rejections.push({ skillId: skill.id, reason: "agents-md-intent-required" });
      return [];
    }
    if (!input.strict && skill.applicabilitySignal
      && !applicabilitySignalMatches(input.fingerprint, skill.applicabilitySignal)
      && ![skill.applicabilitySignal.name, ...skill.technologyTags]
        .some((technology) => hasExplicitTechnologyIntent(input.profile, technology))) {
      eligibleRoles = eligibleRoles.filter((role) => role !== "primary" && role !== "companion");
      if (eligibleRoles.length === 0) {
        rejections.push({ skillId: skill.id, reason: "environment-signal-unmet" });
        return [];
      }
    }
    if (input.routingContext && (eligibleRoles.includes("primary") || eligibleRoles.includes("companion"))) {
      const evidence = evaluateRequiredEvidence({
        required: requiredEvidenceForCandidate({
          routingContext: input.routingContext,
          candidateId: skill.id,
          candidateDomainIds: skill.domains,
        }),
        available: availableEvidence,
      });
      if (!evidence.allowed) {
        evidence.reasons.forEach((reason) => rejections.push({ skillId: skill.id, reason }));
        return [];
      }
    }
    const maxRisk = input.maxSelectedRisk ?? "medium";
    if (skill.riskLevel === "high" || skill.riskLevel === "block" || (maxRisk === "low" && skill.riskLevel === "medium")) { rejections.push({ skillId: skill.id, reason: "risk-blocked" }); return []; }
    if (skill.auditPassed === false) { rejections.push({ skillId: skill.id, reason: "audit-failed" }); return []; }
    if (!compatibleTarget(skill, targetAgent)) { rejections.push({ skillId: skill.id, reason: "target-incompatible" }); return []; }
    if (input.strict && (!installed.has(skill.id) || skill.installed === false)) { rejections.push({ skillId: skill.id, reason: "strict-installed-only" }); return []; }
    if (input.strict && (
      skill.strictContract !== "valid" ||
      skill.lockfileMatch === false ||
      skill.installedFileSetMatch === false ||
      skill.contractInputAccepted === false
    )) { rejections.push({ skillId: skill.id, reason: "strict-contract-v2" }); return []; }
    const missing = requiredCapabilities(skill).filter((capability) => !capabilities.has(canonical(capability)));
    const missingRouting = (skill.routingRequiredCapabilities ?? requiredCapabilities(skill)).filter((capability) => !capabilities.has(canonical(capability)));
    const missingVerification = (skill.verificationRequiredCapabilities ?? []).filter((capability) => !capabilities.has(canonical(capability)));
    const missingOptional = optionalCapabilities(skill).filter((capability) => !capabilities.has(canonical(capability)));
    if (missingRouting.length > 0 && eligibleRoles.some((role) => role !== "verification") && !input.deferRequiredCapabilities) { rejections.push({ skillId: skill.id, reason: "required-capability-missing" }); return []; }
    const scored = scoreSkill(input.profile, skill, selectedDomains, input.fingerprint, input.routingDate, input.routingIntentTags);
    const nominatedRole = input.nominatedRoles?.get(canonical(skill.id));
    if (nominatedRole !== undefined) {
      eligibleRoles = eligibleRoles.filter((role) => role === nominatedRole);
      if (eligibleRoles.length === 0) { rejections.push({ skillId: skill.id, reason: "nominated-role-ineligible" }); return []; }
    }
    if (eligibleRoles.includes("primary") && scored.score < threshold && !nominatedPrimarySkillIds.has(canonical(skill.id))) {
      eligibleRoles = eligibleRoles.filter((role) => role !== "primary");
      if (eligibleRoles.length === 0) { rejections.push({ skillId: skill.id, reason: "primary-score-below-threshold" }); return []; }
    }
    const verificationStatus: RouterCandidate["verificationStatus"] = missingVerification.length > 0
      ? "guidance-only"
      : eligibleRoles.includes("verification") || (skill.verificationRequiredCapabilities?.length ?? 0) > 0
        ? "ready"
        : "not-required";
    return [{
      skill,
      score: Number(scored.score.toFixed(3)),
      eligibleRoles,
      reasons: scored.reasons,
      missingCapabilities: missing,
      missingOptionalCapabilities: missingOptional,
      verificationStatus,
    }];
  });
  const ordered = sorted(candidates);
  return {
    candidates: ordered,
    primaryCandidates: sortedPrimary(ordered.filter(({ eligibleRoles }) => eligibleRoles.includes("primary")), input.requirements, input.routingContext),
    rejections,
  };
};

const symmetricConflict = (left: RouterSkillMetadata, right: RouterSkillMetadata) =>
  (left.conflictsWith ?? []).some((id) => canonical(id) === canonical(right.id)) ||
  (right.conflictsWith ?? []).some((id) => canonical(id) === canonical(left.id));

const hasCycle = (root: RouterSkillMetadata, byId: Map<string, RouterSkillMetadata>) => {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    const skill = byId.get(canonical(id));
    if (!skill) return true;
    visiting.add(id);
    if ((skill.dependencies ?? []).some(visit)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return visit(root.id);
};

const dependencyClosure = (root: RouterCandidate, byId: Map<string, RouterCandidate>) => {
  const closure: RouterCandidate[] = [];
  const seen = new Set<string>();
  const visit = (candidate: RouterCandidate): string | undefined => {
    if (seen.has(candidate.skill.id)) return undefined;
    seen.add(candidate.skill.id);
    for (const dependencyId of candidate.skill.dependencies ?? []) {
      const dependency = byId.get(canonical(dependencyId));
      if (!dependency) return dependencyId;
      const missing = visit(dependency);
      if (missing) return missing;
      closure.push(dependency);
    }
    return undefined;
  };
  const missing = visit(root);
  return { closure: [...new Map(closure.map((candidate) => [candidate.skill.id, candidate])).values()], missing };
};

const superseded = <T extends { skill: RouterSkillMetadata }>(selected: T[], primaryId?: string): T[] => {
  const supersededIds = new Set(selected.flatMap(({ skill }) => skill.supersedes ?? []).map(canonical));
  return selected.filter(({ skill }) => {
    if (primaryId && canonical(skill.id) === canonical(primaryId)) return true;
    return !supersededIds.has(canonical(skill.id));
  });
};

const toSelection = (candidate: RouterCandidate, role: RouterSkillRole): PreparedSkillSelection => ({
  skillId: candidate.skill.id,
  displayName: candidate.skill.displayName,
  role,
  domains: candidate.skill.domains,
  version: candidate.skill.version,
  packageChecksum: candidate.skill.packageChecksum ?? "",
  score: candidate.score,
  source: candidate.skill.source ?? "test-fixture-registry",
  reasons: candidate.reasons,
  verificationStatus: candidate.verificationStatus,
});

const decomposition = (profile: TaskProfile, candidates: RouterCandidate[], allSkills: RouterSkillMetadata[] = []) => {
  if (profile.subtasks.length < 2) return undefined;
  const primaryCandidates = [
    ...candidates.filter(({ eligibleRoles }) => eligibleRoles.includes("primary")),
    ...allSkills.filter((skill) => skill.roles?.includes("primary")).map((skill) => ({
      skill,
      score: 0,
      eligibleRoles: ["primary" as const],
      reasons: [],
      missingCapabilities: [],
      missingOptionalCapabilities: [],
      verificationStatus: "not-required" as const,
    })),
  ];
  const oneWorkflowCoversAll = primaryCandidates.some(({ skill }) => profile.subtasks.every((subtask) => (
    subtask.candidateDomainIds.some((id) => skill.domains.some((domain) => canonical(domain) === canonical(id))) &&
    subtask.actions.every((action) => actionRequirementCovered(action, skill.actions)) &&
    subtask.artifactTypes.every((artifact) => skill.artifactTypes.includes(artifact))
  )));
  if (oneWorkflowCoversAll) return undefined;
  const candidateDomains = new Set(primaryCandidates.flatMap(({ skill }) => skill.domains.map(canonical)));
  const coveredSubtasks = profile.subtasks.filter((subtask) => subtask.candidateDomainIds.some((id) => candidateDomains.has(canonical(id))));
  if (coveredSubtasks.length >= 2 && new Set(coveredSubtasks.flatMap(({ candidateDomainIds }) => candidateDomainIds.map(canonical))).size > 1) return profile.subtasks;
  if (primaryCandidates.length === 0 && new Set(profile.subtasks.flatMap(({ candidateDomainIds }) => candidateDomainIds.map(canonical))).size > 1) return profile.subtasks;
  if (coveredSubtasks.length < 2) return undefined;
  const domainGroups = new Set(profile.subtasks.flatMap(({ candidateDomainIds }) => candidateDomainIds.map(canonical)));
  return domainGroups.size >= 2 ? profile.subtasks : undefined;
};

const verificationRelevant = (profile: TaskProfile, skill: RouterSkillMetadata) => {
  const vocabulary = unique([
    ...skill.actions,
    ...skill.artifactTypes,
    ...skill.intentTags,
    ...skill.qualityGoals,
  ]);
  const criteriaSignals: Record<string, string[]> = {
    "tests-pass": ["test", "verify", "testing", "test-suite", "integration-test", "correctness", "coverage"],
    "static-analysis-pass": ["verify", "static-analysis", "correctness"],
    "security-gates-pass": ["verify", "security", "security-review"],
    "accessibility-gates-pass": ["verify", "accessibility"],
    "performance-measured": ["verify", "performance", "benchmark"],
    "schema-valid": ["verify", "schema", "database-schema"],
    "deployment-smoke-pass": ["verify", "deploy", "deployment", "smoke-test"],
  };
  return (
    profile.acceptanceCriteria.some((criterion) => (criteriaSignals[criterion] ?? [criterion]).some((signal) => vocabulary.has(signal))) ||
    profile.qualityGoals.some((goal) => vocabulary.has(goal))
  );
};

export const assignSelectedRole = (input: {
  candidate: RouterCandidate;
  requestedRole: Exclude<RouterSkillRole, "primary">;
  profile: TaskProfile;
  fingerprint?: ProjectFingerprint;
}): Exclude<RouterSkillRole, "primary"> | undefined => {
  if (!input.candidate.eligibleRoles.includes(input.requestedRole)) return undefined;
  if (input.requestedRole === "verification" && !verificationRelevant(input.profile, input.candidate.skill)) return undefined;
  return input.requestedRole;
};

const strictMissing = (selected: RouterCandidate[], input: ComposeSkillSetInput) => {
  if (!input.strict) return [];
  const installed = unique(input.installedSkillIds ?? []);
  const missing: Array<{ skillId: string; requirement: "installed-skill" | "lockfile-match" | "strict-contract-v2" | "skill-input" | "capability" }> = [];
  for (const candidate of selected) {
    const skill = candidate.skill;
    if (!installed.has(canonical(skill.id)) || skill.installed === false || skill.source !== "installed") missing.push({ skillId: skill.id, requirement: "installed-skill" });
    if (skill.lockfileMatch !== true || skill.installedFileSetMatch !== true) missing.push({ skillId: skill.id, requirement: "lockfile-match" });
    if (skill.strictContract !== "valid" || !skill.contractMustRead?.length) missing.push({ skillId: skill.id, requirement: "strict-contract-v2" });
    if (skill.contractInputAccepted !== true) missing.push({ skillId: skill.id, requirement: "skill-input" });
    const required = [...new Set([...(skill.routingRequiredCapabilities ?? skill.requiredCapabilities ?? []), ...(skill.strictPrerequisiteCapabilities ?? [])])];
    if (required.some((capability) => !unique(input.capabilities ?? []).has(canonical(capability)))) missing.push({ skillId: skill.id, requirement: "capability" });
  }
  return missing.filter((item, index, all) => all.findIndex((other) => other.skillId === item.skillId && other.requirement === item.requirement) === index);
};

const applyNominatedRoles = (result: RetrieveSkillCandidatesResult, nominatedRoles: ResolvedNomination["nominatedRoles"] | undefined): RetrieveSkillCandidatesResult => {
  if (!nominatedRoles) return result;
  const rejections = [...result.rejections];
  const candidates = result.candidates.flatMap((candidate) => {
    const nominatedRole = nominatedRoles.get(canonical(candidate.skill.id));
    if (nominatedRole === undefined) return [candidate];
    const eligibleRoles = candidate.eligibleRoles.filter((role) => role === nominatedRole);
    if (eligibleRoles.length === 0) {
      rejections.push({ skillId: candidate.skill.id, reason: "nominated-role-ineligible" });
      return [];
    }
    return [{ ...candidate, eligibleRoles }];
  });
  return {
    candidates,
    primaryCandidates: candidates.filter(({ eligibleRoles }) => eligibleRoles.includes("primary")),
    rejections,
  };
};

export const composeSkillSet = (input: ComposeSkillSetInput): ComposeSkillSetResult => {
  const limits = { ...defaultRouterLimits, ...input.limits };
  const nomination = input.resolvedNomination;
  const nominationOrder = orderMap(nomination?.nominationOrder ?? []);
  const nominatedPrimarySkillIds = unique(nomination?.nominatedPrimarySkillIds ?? []);
  const proposalDrivenStrictRetrieval = Boolean(input.strict && nominatedPrimarySkillIds.size > 0);
  const requiredPrimarySkillId = nomination?.requiredPrimarySkillId ? canonical(nomination.requiredPrimarySkillId) : undefined;
  const nominatedRoles = nomination?.nominatedRoles;
  const retrievalInput: RetrieveSkillCandidatesInput = {
    ...input,
    maxSelectedRisk: limits.maxSelectedRisk,
    ...(nomination
      ? {
        nominatedSkillIds: nomination.nominatedSkillIds,
        nominatedPrimarySkillIds,
        nominatedRoles: nomination.nominatedRoles,
      }
      : {}),
  };
  const retrieved = applyNominatedRoles(input.retrievalResult
    ?? (input.candidates
      ? { candidates: input.candidates, primaryCandidates: input.candidates.filter(({ eligibleRoles }) => eligibleRoles.includes("primary")), rejections: [] }
      : retrieveSkillCandidates(input.strict
        ? { ...retrievalInput, strict: false, deferRequiredCapabilities: !proposalDrivenStrictRetrieval }
        : retrievalInput)), nominatedRoles);
  const byId = new Map(retrieved.candidates.map((candidate) => [canonical(candidate.skill.id), candidate]));
  const registryById = new Map(input.skills.map((skill) => [canonical(skill.id), skill]));
  const eligibilityFacts = input.nominatedPrimaryEligibilityFacts
    ?? buildNominatedPrimaryEligibilityFacts({
      retrieval: retrieved,
      skillIds: nomination ? nomination.nominationOrder : [],
    });
  const explicitPrimaryFailure = (reason: string): ComposeSkillSetResult => ({
    status: "no_matching_skills",
    reasonCode: explicitSkillChoiceReasonCode(reason),
    rejections: retrieved.rejections,
  });
  let explicitBaseRejectionReason: string | undefined;
  if (requiredPrimarySkillId) {
    const rejection = retrieved.rejections.find(({ skillId }) => canonical(skillId) === requiredPrimarySkillId);
    if (rejection) explicitBaseRejectionReason = rejection.reason;
    else {
      const explicitCandidate = retrieved.candidates.find(({ skill }) => canonical(skill.id) === requiredPrimarySkillId);
      if (!explicitCandidate) explicitBaseRejectionReason = "candidate-not-found";
      else if (!explicitCandidate.eligibleRoles.includes("primary")) explicitBaseRejectionReason = "primary-role-ineligible";
    }
  }
  const explicitResolution = resolvePrimaryArbitration({
    explicitSkillId: requiredPrimarySkillId,
    baseRejectionReason: explicitBaseRejectionReason,
    eligibilityFacts,
    primaryNominationOrder: nomination
      ? nomination.primaryNominationOrder.length > 0 ? nomination.primaryNominationOrder : nomination.nominationOrder
      : [],
  });
  if (explicitResolution.kind === "explicit-choice-blocked") {
    return explicitPrimaryFailure(explicitResolution.baseRejectionReason);
  }
  // One decision supplies the complete effective primary order: the explicit
  // choice ranks first, eligible non-explicit nominations rank in declared
  // order, and deterministic (score then lexical) fallback applies when the
  // decision carries no order. No nomination-order policy is re-derived here.
  const effectivePrimaryNominationOrder = explicitResolution.kind === "deterministic-fallback"
    ? undefined
    : orderMap(explicitResolution.primaryOrder);
  const sortedPrimaryCandidates = sortedPrimary(retrieved.primaryCandidates, input.requirements, input.routingContext, effectivePrimaryNominationOrder);
  const primaryCandidates = sortedPrimaryCandidates;
  const requiredDecomposition = decomposition(input.profile, retrieved.candidates, input.skills);
  if (requiredDecomposition) return { status: "decomposition_required", subtasks: requiredDecomposition, rejections: retrieved.rejections };
  if (primaryCandidates.length === 0) {
    if (requiredPrimarySkillId) {
      return explicitPrimaryFailure(retrieved.rejections.find(({ skillId }) => canonical(skillId) === requiredPrimarySkillId)?.reason ?? "ineligible");
    }
    const subtasks = decomposition(input.profile, retrieved.candidates, input.skills);
    return subtasks
      ? { status: "decomposition_required", subtasks, rejections: retrieved.rejections }
      : { status: "no_matching_skills", reasonCode: "no-primary-candidate", rejections: retrieved.rejections };
  }

  primaryLoop: for (const primary of primaryCandidates) {
    if (hasCycle(primary.skill, registryById)) {
      retrieved.rejections.push({ skillId: primary.skill.id, reason: "dependency-cycle" });
      if (requiredPrimarySkillId === canonical(primary.skill.id)) return explicitPrimaryFailure("dependency-cycle");
      continue;
    }
    const closure = dependencyClosure(primary, byId);
    if (closure.missing) {
      retrieved.rejections.push({ skillId: primary.skill.id, reason: "missing-dependency" });
      if (requiredPrimarySkillId === canonical(primary.skill.id)) return explicitPrimaryFailure("missing-dependency");
      continue;
    }
    const required = [primary, ...closure.closure];
    if (required.some(({ skill }) => skill.riskLevel === "high" || skill.riskLevel === "block" || skill.auditPassed === false)) {
      retrieved.rejections.push({ skillId: primary.skill.id, reason: "dependency-blocked" });
      if (requiredPrimarySkillId === canonical(primary.skill.id)) return explicitPrimaryFailure("dependency-blocked");
      continue;
    }
    const assignedRequired: SelectedRouterCandidate[] = [{ ...primary, role: "primary" }];
    for (const dependency of closure.closure) {
      const role = (["environment", "companion", "verification", "agent-context"] as const)
        .find((requestedRole) => assignSelectedRole({ candidate: dependency, requestedRole, profile: input.profile, fingerprint: input.fingerprint }));
      if (!role) {
        retrieved.rejections.push({ skillId: primary.skill.id, reason: "dependency-role-unassignable" });
        if (requiredPrimarySkillId === canonical(primary.skill.id)) return explicitPrimaryFailure("dependency-role-unassignable");
        continue primaryLoop;
      }
      assignedRequired.push({ ...dependency, role });
    }
    const dedupedRequired = superseded([...new Map(assignedRequired.map((candidate) => [candidate.skill.id, candidate])).values()], primary.skill.id);
    if (!dedupedRequired.some(({ role }) => role === "primary")) {
      retrieved.rejections.push({ skillId: primary.skill.id, reason: "primary-superseded" });
      if (requiredPrimarySkillId === canonical(primary.skill.id)) return explicitPrimaryFailure("primary-superseded");
      continue;
    }
    if (dedupedRequired.some((left, index) => dedupedRequired.slice(index + 1).some((right) => symmetricConflict(left.skill, right.skill)))) {
      retrieved.rejections.push({ skillId: primary.skill.id, reason: "skill-conflict" });
      if (requiredPrimarySkillId === canonical(primary.skill.id)) return explicitPrimaryFailure("skill-conflict");
      continue;
    }
    const selectedIds = new Set(dedupedRequired.map(({ skill }) => skill.id));
    const warnings: string[] = [];
    const optional = (role: RouterSkillRole) => retrieved.candidates
      .filter(({ eligibleRoles, skill }) => eligibleRoles.includes(role) && !selectedIds.has(skill.id) && (!input.strict || skill.source === "installed" || nominatedRoles?.get(canonical(skill.id)) === role))
      .sort((left, right) => {
        const leftNomination = nominationOrder.get(canonical(left.skill.id));
        const rightNomination = nominationOrder.get(canonical(right.skill.id));
        if (leftNomination !== undefined || rightNomination !== undefined) {
          const nominationDelta = (leftNomination ?? Number.POSITIVE_INFINITY) - (rightNomination ?? Number.POSITIVE_INFINITY);
          if (nominationDelta !== 0) return nominationDelta;
        }
        if (role === "verification") {
          const leftCover = calculateRequirementCoverage({ requirements: explicitRequirements, skill: left.skill, routingContext: input.routingContext }).covered.length;
          const rightCover = calculateRequirementCoverage({ requirements: explicitRequirements, skill: right.skill, routingContext: input.routingContext }).covered.length;
          if (rightCover !== leftCover) return rightCover - leftCover;
        }
        return right.score - left.score || left.skill.id.localeCompare(right.skill.id);
      });
    const add = (candidate: RouterCandidate, role: Exclude<RouterSkillRole, "primary">) => {
      if (selectedIds.has(candidate.skill.id)) return "already-selected" as const;
      if ([...dedupedRequired].some(({ skill }) => symmetricConflict(skill, candidate.skill))) return "skill-conflict" as const;
      dedupedRequired.push({ ...candidate, role });
      selectedIds.add(candidate.skill.id);
      return undefined;
    };
    for (const candidate of optional("environment").slice(0, limits.maxEnvironmentSkills)) add(candidate, "environment");
    const conflictingComplement = optional("companion").some(({ skill }) =>
      (primary.skill.complements ?? []).some((id) => canonical(id) === canonical(skill.id)) && symmetricConflict(primary.skill, skill));
    if (conflictingComplement) {
      retrieved.rejections.push({ skillId: primary.skill.id, reason: "skill-conflict" });
      if (requiredPrimarySkillId === canonical(primary.skill.id)) return explicitPrimaryFailure("skill-conflict");
      continue;
    }
    const explicitRequirements = dedupeRequirements(input.requirements ?? []).filter(({ requirementClass }) => requirementClass === "explicit");
    const nominatedCompanionIds = new Set([...nominatedRoles ?? []]
      .filter(([, role]) => role === "companion")
      .map(([skillId]) => canonical(skillId)));
    for (const candidate of optional("companion").filter(({ skill }) => nominatedCompanionIds.has(canonical(skill.id)))) {
      if (dedupedRequired.filter(({ role }) => role === "companion").length >= limits.maxTaskCompanions) {
        retrieved.rejections.push({ skillId: candidate.skill.id, reason: "role-limit" });
        continue;
      }
      const rejection = add(candidate, "companion");
      if (rejection && rejection !== "already-selected") retrieved.rejections.push({ skillId: candidate.skill.id, reason: rejection });
    }
    const totalExplicitWeight = explicitRequirements.reduce((sum, requirement) => sum + effectiveRequirementWeight(requirement), 0);
    const requestedActions = dedupeRequirements(input.requirements ?? [])
      .filter(({ kind, requirementClass }) => kind === "action" && requirementClass !== "context");
    const primaryDomain = canonical(primary.skill.domains.find((domain) => canonical(domain) === canonical(input.primaryDomainId ?? "")) ?? primary.skill.domains[0] ?? input.primaryDomainId ?? "");
    const coverageKeys = (selectedCandidates: SelectedRouterCandidate[]) => new Set(selectedCandidates.flatMap((selectedCandidate) =>
      calculateRequirementCoverage({ requirements: explicitRequirements, skill: selectedCandidate.skill, routingContext: input.routingContext }).covered.map(requirementKey)));
    while (totalExplicitWeight > 0 && dedupedRequired.filter(({ role }) => role === "companion").length < limits.maxTaskCompanions) {
      const alreadyCovered = coverageKeys(dedupedRequired);
      const ranked = optional("companion").flatMap((candidate) => {
        if (!candidate.skill.domains.some((domain) => canonical(domain) === primaryDomain)) return [];
        if (requestedActions.length > 0 && !requestedActions.some((requirement) => actionRequirementCovered(requirement.id as TaskAction, candidate.skill.actions))) return [];
        if (dedupedRequired.some(({ skill }) => symmetricConflict(skill, candidate.skill))) return [];
        if (dedupedRequired.some(({ skill }) =>
          (skill.supersedes ?? []).some((id) => canonical(id) === canonical(candidate.skill.id)) ||
          (candidate.skill.supersedes ?? []).some((id) => canonical(id) === canonical(skill.id)))) return [];
        const coverage = calculateRequirementCoverage({ requirements: explicitRequirements, skill: candidate.skill, routingContext: input.routingContext });
        const newlyCovered = coverage.covered.filter((requirement) => !alreadyCovered.has(requirementKey(requirement)));
        const overlap = coverage.covered.filter((requirement) => alreadyCovered.has(requirementKey(requirement)));
        const newWeight = newlyCovered.reduce((sum, requirement) => sum + effectiveRequirementWeight(requirement), 0);
        const marginalCoverage = newWeight / totalExplicitWeight;
        if (marginalCoverage < 0.15) return [];
        const overlapPenalty = overlap.reduce((sum, requirement) => sum + effectiveRequirementWeight(requirement), 0) / totalExplicitWeight;
        const complementBonus = (primary.skill.complements ?? []).some((id) => canonical(id) === canonical(candidate.skill.id))
          ? 0.08
          : (candidate.skill.complements ?? []).some((id) => canonical(id) === canonical(primary.skill.id)) ? 0.04 : 0;
        return [{ candidate, newlyCovered, newWeight, companionScore: 0.65 * candidate.score + 0.27 * marginalCoverage + complementBonus - 0.10 * overlapPenalty }];
      }).sort((left, right) =>
        right.companionScore - left.companionScore ||
        right.newWeight - left.newWeight ||
        right.candidate.score - left.candidate.score ||
        (right.candidate.skill.qualityScore ?? 0) - (left.candidate.skill.qualityScore ?? 0) ||
        left.candidate.skill.id.localeCompare(right.candidate.skill.id));
      const best = ranked[0];
      if (!best) break;
      const selectedCompanion = { ...best.candidate, reasons: [...new Set([
        ...best.candidate.reasons,
        ...best.newlyCovered.map((requirement) => `coverage-add:${requirement.id}`),
      ])] };
      add(selectedCompanion, "companion");
    }
    const nominatedVerificationIds = new Set([...nominatedRoles ?? []]
      .filter(([, role]) => role === "verification")
      .map(([skillId]) => canonical(skillId)));
    for (const candidate of optional("verification")) {
      if (dedupedRequired.filter(({ role }) => role === "verification").length >= limits.maxVerificationSkills) {
        if (nominatedVerificationIds.has(canonical(candidate.skill.id))) retrieved.rejections.push({ skillId: candidate.skill.id, reason: "role-limit" });
        continue;
      }
      if (!assignSelectedRole({ candidate, requestedRole: "verification", profile: input.profile, fingerprint: input.fingerprint })) {
        if (nominatedVerificationIds.has(canonical(candidate.skill.id))) retrieved.rejections.push({ skillId: candidate.skill.id, reason: "nominated-role-ineligible" });
        continue;
      }
      const rejection = add(candidate, "verification");
      if (rejection && rejection !== "already-selected" && nominatedVerificationIds.has(canonical(candidate.skill.id))) {
        retrieved.rejections.push({ skillId: candidate.skill.id, reason: rejection });
      }
    }
    for (const candidate of optional("agent-context").slice(0, limits.maxAgentContextSkills)) add(candidate, "agent-context");
    const protectedIds = new Set([primary.skill.id, ...closure.closure.map(({ skill }) => skill.id)]);
    const selected = superseded(dedupedRequired, primary.skill.id);
    const selectedIdsAfterSupersession = new Set(selected.map(({ skill }) => canonical(skill.id)));
    for (const candidate of dedupedRequired) {
      if (!selectedIdsAfterSupersession.has(canonical(candidate.skill.id)) && nominatedRoles?.has(canonical(candidate.skill.id))) {
        retrieved.rejections.push({ skillId: candidate.skill.id, reason: "superseded" });
      }
    }
    const removableRoles: RouterSkillRole[] = ["agent-context", "companion", "environment", "verification"];
    const removeWeakest = (reason: "skill-limit" | "context-budget-exceeded") => {
      for (const role of removableRoles) {
        if (role === "verification" && input.profile.acceptanceCriteria.length > 0) continue;
        const index = selected
          .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
          .filter(({ candidate }) => candidate.role === role && !protectedIds.has(candidate.skill.id))
          .sort((left, right) => left.candidate.score - right.candidate.score || right.candidate.skill.id.localeCompare(left.candidate.skill.id))[0]?.candidateIndex;
        if (index !== undefined) {
          const [removed] = selected.splice(index, 1);
          if (removed && nominatedRoles?.has(canonical(removed.skill.id))) {
            retrieved.rejections.push({ skillId: removed.skill.id, reason });
          }
          return true;
        }
      }
      return false;
    };
    while (selected.length > limits.maxTotalSelectedSkills && removeWeakest("skill-limit")) { /* remove optional skills in normative order */ }
    if (selected.length > limits.maxTotalSelectedSkills) {
      retrieved.rejections.push({ skillId: primary.skill.id, reason: "skill-limit" });
      if (requiredPrimarySkillId === canonical(primary.skill.id)) return explicitPrimaryFailure("skill-limit");
      continue;
    }
    let requiredBytes = selected.reduce((sum, candidate) => sum + (candidate.skill.instructionBytes ?? 0), 0);
    while (requiredBytes > limits.maxInstructionBytes && removeWeakest("context-budget-exceeded")) {
      requiredBytes = selected.reduce((sum, candidate) => sum + (candidate.skill.instructionBytes ?? 0), 0);
    }
    if (requiredBytes > limits.maxInstructionBytes) {
      const blockingSkillIds = selected.filter(({ skill }) => protectedIds.has(skill.id)).map(({ skill }) => skill.id);
      const nominatedPrimary = nominatedPrimarySkillIds.has(canonical(primary.skill.id));
      if (!nominatedPrimary || requiredPrimarySkillId === canonical(primary.skill.id)) {
        return { status: "context_budget_exceeded", requiredBytes, allowedBytes: limits.maxInstructionBytes, blockingSkillIds, rejections: retrieved.rejections };
      }
      retrieved.rejections.push({ skillId: primary.skill.id, reason: "context-budget-exceeded" });
      continue;
    }
    const missing = strictMissing(selected, input);
    if (missing.length > 0) return { status: "strict_requirements_unmet", missing, rejections: retrieved.rejections };
    for (const candidate of selected) for (const capability of candidate.missingOptionalCapabilities) warnings.push(`capability-missing:${capability}`);
    const finalCovered = coverageKeys(selected);
    for (const requirement of explicitRequirements) {
      if (effectiveRequirementWeight(requirement) >= 0.6 && !finalCovered.has(requirementKey(requirement))) warnings.push(`uncovered-requirement:${requirement.kind}:${requirement.id}`);
    }
    const byRole = (role: RouterSkillRole) => selected.filter((candidate) => candidate.role === role);
    const selectedPrimary = selected.find(({ role }) => role === "primary")!;
    const composed: ComposedSkillSet = {
      primary: selectedPrimary,
      environment: byRole("environment"),
      companions: byRole("companion"),
      verification: byRole("verification"),
      agentContext: byRole("agent-context"),
      all: selected,
      selections: {
        primary: toSelection(selectedPrimary, "primary"),
        environment: byRole("environment").map((candidate) => toSelection(candidate, "environment")),
        companions: byRole("companion").map((candidate) => toSelection(candidate, "companion")),
        verification: byRole("verification").map((candidate) => toSelection(candidate, "verification")),
        agentContext: byRole("agent-context").map((candidate) => toSelection(candidate, "agent-context")),
      },
      warnings: [...new Set(warnings)],
      instructionBytes: requiredBytes,
    };
    return { status: "prepared", composed, rejections: retrieved.rejections };
  }
  if (requiredPrimarySkillId) return explicitPrimaryFailure("candidate-constraints-unsatisfied");
  return { status: "no_matching_skills", reasonCode: "candidate-constraints-unsatisfied", rejections: retrieved.rejections };
};

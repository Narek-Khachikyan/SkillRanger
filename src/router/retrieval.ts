import type { ProjectFingerprint } from "../types.ts";
import type { RoutingContext } from "./context.ts";
import { orderScoredCandidates, scoreFreshness, scoreSharedFeatures } from "../recommender/scoring.ts";
import type { RouterSelectableRisk, RouterSkillRole, TaskAction, TaskProfile } from "./types.ts";
import type { TaskAnalyzerSkillMetadata } from "./analyzer.ts";
import { actionCompatibilityScore, scoreActionCompatibility } from "./action-compatibility.ts";
import { calculateRequirementCoverage } from "./coverage.ts";
import { collectAvailableEvidence, evaluateRequiredEvidence, requiredEvidenceForCandidate } from "./evidence.ts";
import type { NominatedPrimaryEligibilityFacts } from "./nomination-resolution.ts";
import type { CanonicalRequirement } from "./requirements.ts";
import type { MatchedRoutingSignal } from "./vocabulary/match.ts";
import { canonical } from "./canonical.ts";

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

// The retrieval boundary's projection of one retrieval result into bounded
// eligibility facts for the primary nomination decision. Rejection precedence:
// an explicit candidate rejection carries its reason; a candidate that reached
// the candidate set without primary eligibility is `primary-role-ineligible`;
// anything else is `candidate-not-found`. Facts are derived only from the
// retrieval result, so they can never disagree with the retrieval they describe.
export const buildNominatedPrimaryEligibilityFacts = (input: {
  retrieval: RetrieveSkillCandidatesResult;
  skillIds: Iterable<string>;
}): NominatedPrimaryEligibilityFacts[] => {
  const primaryEligibleIds = new Set(input.retrieval.primaryCandidates.map(({ skill }) => canonical(skill.id)));
  const seen = new Set<string>();
  const facts: NominatedPrimaryEligibilityFacts[] = [];
  for (const rawSkillId of input.skillIds) {
    const skillId = canonical(rawSkillId);
    if (seen.has(skillId)) continue;
    seen.add(skillId);
    const primaryRoleEligible = primaryEligibleIds.has(skillId);
    const baseRejectionReason = primaryRoleEligible
      ? undefined
      : input.retrieval.rejections.find(({ skillId: rejectedSkillId }) => canonical(rejectedSkillId) === skillId)?.reason
        ?? (input.retrieval.candidates.some(({ skill }) => canonical(skill.id) === skillId)
          ? "primary-role-ineligible"
          : "candidate-not-found");
    facts.push({ skillId, primaryRoleEligible, ...(baseRejectionReason === undefined ? {} : { baseRejectionReason }) });
  }
  return facts;
};

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

export const sortedPrimary = <T extends RouterCandidate>(items: T[], requirements: CanonicalRequirement[] = [], routingContext?: RoutingContext, nominationOrder?: ReadonlyMap<string, number>) => [...items].sort((left, right) =>
  (nominationOrder?.get(canonical(left.skill.id)) ?? Number.POSITIVE_INFINITY) - (nominationOrder?.get(canonical(right.skill.id)) ?? Number.POSITIVE_INFINITY) ||
  right.score - left.score ||
  (right.skill.skillAdjustment ?? 0) - (left.skill.skillAdjustment ?? 0) ||
  calculateRequirementCoverage({ requirements, skill: right.skill, routingContext }).coveredWeight - calculateRequirementCoverage({ requirements, skill: left.skill, routingContext }).coveredWeight ||
  (right.skill.qualityScore ?? 0) - (left.skill.qualityScore ?? 0) ||
  left.skill.id.localeCompare(right.skill.id));

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

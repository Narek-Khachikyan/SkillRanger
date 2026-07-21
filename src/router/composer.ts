import type { ProjectFingerprint, RegistrySkill } from "../types.ts";
import type { RoutingContext } from "./context.ts";
import { orderScoredCandidates, scoreFreshness, scoreSharedFeatures } from "../recommender/scoring.ts";
import type {
  DomainCandidate,
  PreparedSelections,
  PreparedSkillSelection,
  RouterSkillRole,
  RouterSelectableRisk,
  TaskProfile,
  TaskSubtask,
} from "./types.ts";
import type { TaskAnalyzerSkillMetadata } from "./analyzer.ts";
import { actionCompatibilityScore, scoreActionCompatibility } from "./action-compatibility.ts";
import { actionRequirementCovered } from "./coverage.ts";
import { collectAvailableEvidence, evaluateRequiredEvidence, requiredEvidenceForCandidate } from "./evidence.ts";
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

export type ComposeSkillSetInput = RetrieveSkillCandidatesInput & {
  candidates?: RouterCandidate[];
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
  const availableEvidence = collectAvailableEvidence({ matchedSignals: input.matchedSignals ?? [] });
  const rejections: CandidateRejection[] = [];
  const candidates = input.skills.flatMap((skill) => {
    let eligibleRoles = rolesFor(skill);
    if (eligibleRoles.length === 0) { rejections.push({ skillId: skill.id, reason: "router-metadata-incomplete" }); return []; }
    const domainMatch = skill.domains.some((domain) => selectedDomains.has(canonical(domain)));
    if (!domainMatch) { rejections.push({ skillId: skill.id, reason: "domain-mismatch" }); return []; }
    if (primaryDomainId && eligibleRoles.includes("primary") && !skill.domains.some((domain) => canonical(domain) === primaryDomainId)) {
      eligibleRoles = eligibleRoles.filter((role) => role !== "primary");
      if (eligibleRoles.length === 0) { rejections.push({ skillId: skill.id, reason: "primary-domain-mismatch" }); return []; }
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
    if (eligibleRoles.includes("primary") && scored.score < threshold) {
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
    primaryCandidates: ordered.filter(({ eligibleRoles }) => eligibleRoles.includes("primary")),
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
  return profile.acceptanceCriteria.some((criterion) => (criteriaSignals[criterion] ?? [criterion]).some((signal) => vocabulary.has(signal)));
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

export const composeSkillSet = (input: ComposeSkillSetInput): ComposeSkillSetResult => {
  const limits = { ...defaultRouterLimits, ...input.limits };
  const retrieved = input.candidates
    ? { candidates: input.candidates, primaryCandidates: input.candidates.filter(({ eligibleRoles }) => eligibleRoles.includes("primary")), rejections: [] }
    : retrieveSkillCandidates(input.strict
      ? { ...input, strict: false, deferRequiredCapabilities: true, maxSelectedRisk: limits.maxSelectedRisk }
      : { ...input, maxSelectedRisk: limits.maxSelectedRisk });
  const byId = new Map(retrieved.candidates.map((candidate) => [canonical(candidate.skill.id), candidate]));
  const registryById = new Map(input.skills.map((skill) => [canonical(skill.id), skill]));
  const primaryCandidates = sorted(retrieved.primaryCandidates);
  const requiredDecomposition = decomposition(input.profile, retrieved.candidates, input.skills);
  if (requiredDecomposition) return { status: "decomposition_required", subtasks: requiredDecomposition, rejections: retrieved.rejections };
  if (primaryCandidates.length === 0) {
    const subtasks = decomposition(input.profile, retrieved.candidates, input.skills);
    return subtasks
      ? { status: "decomposition_required", subtasks, rejections: retrieved.rejections }
      : { status: "no_matching_skills", reasonCode: "no-primary-candidate", rejections: retrieved.rejections };
  }

  primaryLoop: for (const primary of primaryCandidates) {
    if (hasCycle(primary.skill, registryById)) {
      retrieved.rejections.push({ skillId: primary.skill.id, reason: "dependency-cycle" });
      continue;
    }
    const closure = dependencyClosure(primary, byId);
    if (closure.missing) {
      retrieved.rejections.push({ skillId: primary.skill.id, reason: "missing-dependency" });
      continue;
    }
    const required = [primary, ...closure.closure];
    if (required.some(({ skill }) => skill.riskLevel === "high" || skill.riskLevel === "block" || skill.auditPassed === false)) {
      retrieved.rejections.push({ skillId: primary.skill.id, reason: "dependency-blocked" });
      continue;
    }
    const assignedRequired: SelectedRouterCandidate[] = [{ ...primary, role: "primary" }];
    for (const dependency of closure.closure) {
      const role = (["environment", "companion", "verification", "agent-context"] as const)
        .find((requestedRole) => assignSelectedRole({ candidate: dependency, requestedRole, profile: input.profile, fingerprint: input.fingerprint }));
      if (!role) {
        retrieved.rejections.push({ skillId: primary.skill.id, reason: "dependency-role-unassignable" });
        continue primaryLoop;
      }
      assignedRequired.push({ ...dependency, role });
    }
    const dedupedRequired = superseded([...new Map(assignedRequired.map((candidate) => [candidate.skill.id, candidate])).values()], primary.skill.id);
    if (!dedupedRequired.some(({ role }) => role === "primary")) {
      retrieved.rejections.push({ skillId: primary.skill.id, reason: "primary-superseded" });
      continue;
    }
    if (dedupedRequired.some((left, index) => dedupedRequired.slice(index + 1).some((right) => symmetricConflict(left.skill, right.skill)))) {
      retrieved.rejections.push({ skillId: primary.skill.id, reason: "skill-conflict" });
      continue;
    }
    const selectedIds = new Set(dedupedRequired.map(({ skill }) => skill.id));
    const warnings: string[] = [];
    const optional = (role: RouterSkillRole) => retrieved.candidates
      .filter(({ eligibleRoles, skill }) => eligibleRoles.includes(role) && !selectedIds.has(skill.id) && (!input.strict || skill.source === "installed"))
      .sort((left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id));
    const add = (candidate: RouterCandidate, role: Exclude<RouterSkillRole, "primary">) => {
      if (selectedIds.has(candidate.skill.id)) return;
      if ([...dedupedRequired].some(({ skill }) => symmetricConflict(skill, candidate.skill))) return;
      dedupedRequired.push({ ...candidate, role });
      selectedIds.add(candidate.skill.id);
    };
    for (const candidate of optional("environment").slice(0, limits.maxEnvironmentSkills)) add(candidate, "environment");
    const complements = new Set(retrieved.candidates.filter(({ skill }) => (primary.skill.complements ?? []).some((id) => canonical(id) === canonical(skill.id))).map(({ skill }) => skill.id));
    let explicitConflict = false;
    for (const candidate of optional("companion").filter(({ skill }) => complements.has(skill.id))) {
      if (dedupedRequired.filter(({ role }) => role === "companion").length >= limits.maxTaskCompanions) break;
      if (symmetricConflict(candidate.skill, primary.skill)) {
        explicitConflict = true;
        continue;
      }
      candidate.reasons = [...new Set([...candidate.reasons, `complements:${candidate.skill.id}`])];
      add(candidate, "companion");
    }
    if (explicitConflict) {
      retrieved.rejections.push({ skillId: primary.skill.id, reason: "skill-conflict" });
      continue;
    }
    for (const candidate of optional("verification")) {
      if (dedupedRequired.filter(({ role }) => role === "verification").length >= limits.maxVerificationSkills) break;
      if (assignSelectedRole({ candidate, requestedRole: "verification", profile: input.profile, fingerprint: input.fingerprint })) add(candidate, "verification");
    }
    for (const candidate of optional("agent-context").slice(0, limits.maxAgentContextSkills)) add(candidate, "agent-context");
    const protectedIds = new Set([primary.skill.id, ...closure.closure.map(({ skill }) => skill.id)]);
    const selected = superseded(dedupedRequired, primary.skill.id);
    const removableRoles: RouterSkillRole[] = ["agent-context", "companion", "environment", "verification"];
    const removeWeakest = () => {
      for (const role of removableRoles) {
        if (role === "verification" && input.profile.acceptanceCriteria.length > 0) continue;
        const index = selected
          .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
          .filter(({ candidate }) => candidate.role === role && !protectedIds.has(candidate.skill.id))
          .sort((left, right) => left.candidate.score - right.candidate.score || right.candidate.skill.id.localeCompare(left.candidate.skill.id))[0]?.candidateIndex;
        if (index !== undefined) { selected.splice(index, 1); return true; }
      }
      return false;
    };
    while (selected.length > limits.maxTotalSelectedSkills && removeWeakest()) { /* remove optional skills in normative order */ }
    if (selected.length > limits.maxTotalSelectedSkills) {
      retrieved.rejections.push({ skillId: primary.skill.id, reason: "skill-limit" });
      continue;
    }
    let requiredBytes = selected.reduce((sum, candidate) => sum + (candidate.skill.instructionBytes ?? 0), 0);
    while (requiredBytes > limits.maxInstructionBytes && removeWeakest()) {
      requiredBytes = selected.reduce((sum, candidate) => sum + (candidate.skill.instructionBytes ?? 0), 0);
    }
    if (requiredBytes > limits.maxInstructionBytes) {
      const blockingSkillIds = selected.filter(({ skill }) => protectedIds.has(skill.id)).map(({ skill }) => skill.id);
      return { status: "context_budget_exceeded", requiredBytes, allowedBytes: limits.maxInstructionBytes, blockingSkillIds, rejections: retrieved.rejections };
    }
    const missing = strictMissing(selected, input);
    if (missing.length > 0) return { status: "strict_requirements_unmet", missing, rejections: retrieved.rejections };
    for (const candidate of selected) for (const capability of candidate.missingOptionalCapabilities) warnings.push(`capability-missing:${capability}`);
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
  return { status: "no_matching_skills", reasonCode: "candidate-constraints-unsatisfied", rejections: retrieved.rejections };
};

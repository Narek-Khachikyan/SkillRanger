import type { ProjectFingerprint } from "../types.ts";
import type {
  DomainCandidate,
  TaskProfile,
  TaskSignalEvidence,
} from "./types.ts";
import type {
  TaskAnalyzerDomainMetadata,
  TaskAnalyzerSkillMetadata,
} from "./analyzer.ts";

export const defaultRouterThresholds = {
  primaryDomain: 0.45,
  supportingDomain: 0.40,
  ambiguityDelta: 0.05,
  primarySkill: 0.60,
  companionSkill: 0.54,
  verificationSkill: 0.52,
  environmentSkill: 0.50,
} as const;

export type RouterDomainResolverInput = {
  profile: TaskProfile;
  domains: TaskAnalyzerDomainMetadata[];
  skills: TaskAnalyzerSkillMetadata[];
  fingerprint?: ProjectFingerprint;
  availableDomainIds?: Iterable<string>;
  eligiblePrimaryDomainIds?: Iterable<string>;
  thresholds?: Partial<typeof defaultRouterThresholds>;
  routingIntentTags?: string[];
};

export type DomainScore = {
  id: string;
  projectMatch: number;
  taskIntentMatch: number;
  artifactMatch: number;
  technologyMatch: number;
  semanticScore: number;
  available: boolean;
  hasEligiblePrimary: boolean;
  reasons: string[];
  evidence: TaskSignalEvidence[];
};

export type DomainResolution = {
  candidates: DomainCandidate[];
  scores: DomainScore[];
  primaryDomainId?: string;
  supportingDomainIds: string[];
  ambiguousDomainIds: string[];
  clarificationRequired: boolean;
};

const canonical = (value: string) => value.normalize("NFKC").trim().toLowerCase();

const unique = (values: Iterable<string>) => [...new Set([...values].map(canonical))];

type WeightedVocabulary = { value: string; weight: number }[];

const weightedMatch = (signals: string[], vocabulary: WeightedVocabulary) => {
  const signalSet = new Set(signals.map(canonical));
  return vocabulary.reduce((best, entry) => signalSet.has(canonical(entry.value)) ? Math.max(best, entry.weight) : best, 0);
};

const evidenceFor = (
  profile: TaskProfile,
  kind: TaskSignalEvidence["kind"],
  ids: string[],
) => profile.evidence.filter((item) =>
  item.kind === kind && ids.some((id) => canonical(id) === canonical(item.id))
);

const domainEvidence = (domain: TaskAnalyzerDomainMetadata, profile: TaskProfile, fingerprint?: ProjectFingerprint) => {
  const aliases = [domain.id, ...domain.routing.aliases, ...domain.routing.intentTags];
  const promptDomainEvidence = profile.evidence.filter((item) =>
    item.kind === "domain" && aliases.some((alias) => canonical(alias) === canonical(item.id)),
  );
  const fingerprintDomainEvidence = profile.evidence.filter((item) =>
    item.source === "fingerprint" && item.kind === "domain" && domain.routing.projectTags.some((tag) => canonical(tag) === canonical(item.id)),
  );
  const artifacts = evidenceFor(profile, "artifact", domain.routing.artifactTypes);
  const technologies = evidenceFor(profile, "technology", domain.routing.technologyTags);
  const fromFingerprint = fingerprint
    ? [
      ...fingerprint.languages,
      ...fingerprint.frameworks,
      ...fingerprint.testing,
      ...fingerprint.infrastructure,
    ].filter(({ name }) => domain.routing.technologyTags.some((tag) => canonical(tag) === canonical(name)))
      .map(({ name }) => ({ source: "fingerprint" as const, kind: "technology" as const, id: name }))
    : [];
  return [...promptDomainEvidence, ...fingerprintDomainEvidence, ...artifacts, ...technologies, ...fromFingerprint]
    .filter((item, index, all) => all.findIndex((other) => `${other.source}:${other.kind}:${other.id}` === `${item.source}:${item.kind}:${item.id}`) === index);
};

const scoreDomain = (
  domain: TaskAnalyzerDomainMetadata,
  input: RouterDomainResolverInput,
  available: Set<string>,
  eligiblePrimary: Set<string>,
): DomainScore => {
  const profile = input.profile;
  const fingerprint = input.fingerprint;
  const projectSignals = fingerprint
    ? [
      ...fingerprint.projectTypes.map(({ type }) => type),
      ...fingerprint.languages.map(({ name }) => name),
      ...fingerprint.frameworks.map(({ name }) => name),
      ...fingerprint.testing.map(({ name }) => name),
      ...fingerprint.infrastructure.map(({ name }) => name),
      ...fingerprint.tags,
    ]
    : [];
  const projectMatch = fingerprint && projectSignals.length > 0
    ? weightedMatch(projectSignals, domain.routing.projectTags.map((value) => ({ value, weight: 1 })))
    : 0;
  const taskSignals = [
    ...profile.actions,
    ...profile.qualityGoals,
    ...profile.constraints,
    ...profile.acceptanceCriteria,
    ...profile.artifactTypes,
    ...profile.technologies,
    ...profile.evidence.filter(({ source }) => source === "prompt").map(({ id }) => id),
  ];
  const domainSkills = input.skills
    .filter(({ domains }) => domains.some((id) => canonical(id) === canonical(domain.id)))
  const skillSignals = domainSkills.flatMap(({ intentTags, artifactTypes, technologyTags, qualityGoals }) => [
      ...intentTags,
      ...artifactTypes,
      ...technologyTags,
      ...qualityGoals,
    ]);
  const qualitySkillSignals = domainSkills.flatMap(({ qualityGoals }) => qualityGoals);
  const taskIntentMatch = Math.max(
    profile.domains.some(({ id, evidence }) => canonical(id) === canonical(domain.id) && evidence.some(({ source }) => source === "prompt")) ? 1 : 0,
    weightedMatch(taskSignals, [
      { value: domain.id, weight: 1 },
      ...domain.routing.intentTags.map((value) => ({ value, weight: 1 })),
      ...domain.routing.aliases.map((value) => ({ value, weight: 0.7 })),
    ]),
    weightedMatch(input.routingIntentTags ?? [], domain.routing.intentTags.map((value) => ({ value, weight: 1 }))),
    weightedMatch(profile.qualityGoals, qualitySkillSignals.map((value) => ({ value, weight: 1 }))),
  );
  const artifactMatch = weightedMatch(profile.artifactTypes, domain.routing.artifactTypes.map((value) => ({ value, weight: 1 })));
  const technologyMatch = weightedMatch(profile.technologies, domain.routing.technologyTags.map((value) => ({ value, weight: 1 })));
  const profileDomainConfidence = profile.domains.find(({ id }) => canonical(id) === canonical(domain.id))?.confidence ?? 0;
  const semanticScore = Math.max(
    0.45 * projectMatch + 0.30 * taskIntentMatch + 0.15 * artifactMatch + 0.10 * technologyMatch,
    profileDomainConfidence,
  );
  const hasEligiblePrimary = eligiblePrimary.has(domain.id);
  const reasons: string[] = [];
  if (taskIntentMatch > 0) reasons.push(`domain-match:${domain.id}`);
  const action = profile.actions.find((id) => domainSkills.some(({ actions }) => actions.includes(id)));
  if (action) reasons.push(`action-match:${action}`);
  if (projectMatch > 0) reasons.push(`environment-match:${domain.id}`);
  const artifact = profile.artifactTypes.find((id) => domain.routing.artifactTypes.some((tag) => canonical(tag) === canonical(id)));
  if (artifact) reasons.push(`artifact-match:${artifact}`);
  const technology = profile.technologies.find((id) => domain.routing.technologyTags.some((tag) => canonical(tag) === canonical(id)));
  if (technology) reasons.push(`technology-match:${technology}`);
  const quality = profile.qualityGoals.find((id) => skillSignals.some((tag) => canonical(tag) === canonical(id)));
  if (quality) reasons.push(`quality-goal-match:${quality}`);
  return {
    id: domain.id,
    projectMatch,
    taskIntentMatch,
    artifactMatch,
    technologyMatch,
    semanticScore,
    available: available.has(domain.id),
    hasEligiblePrimary,
    reasons,
    evidence: domainEvidence(domain, profile, fingerprint),
  };
};

const toCandidate = (score: DomainScore, role: "primary" | "supporting"): DomainCandidate => ({
  id: score.id,
  confidence: Number(score.semanticScore.toFixed(3)),
  role,
  available: score.available,
  reasons: score.reasons,
  evidence: score.evidence,
});

export const resolveDomains = (input: RouterDomainResolverInput): DomainResolution => {
  const thresholds = { ...defaultRouterThresholds, ...input.thresholds };
  const available = new Set(unique(input.availableDomainIds ?? input.domains.map(({ id }) => id)));
  const eligiblePrimary = new Set(unique(input.eligiblePrimaryDomainIds ?? input.skills
    .filter(({ roles }) => roles?.includes("primary") === true)
    .flatMap(({ domains }) => domains)));
  const scores = input.domains
    .map((domain) => scoreDomain(domain, input, available, eligiblePrimary))
    .sort((left, right) => right.semanticScore - left.semanticScore || left.id.localeCompare(right.id));
  const eligible = scores.filter(({ available: isAvailable }) => isAvailable);
  const primaryPool = eligible.filter(({ semanticScore, hasEligiblePrimary, taskIntentMatch }) =>
    hasEligiblePrimary && semanticScore + Number.EPSILON >= thresholds.primaryDomain &&
    taskIntentMatch > 0,
  );
  const top = primaryPool[0];
  const second = primaryPool[1];
  const projectEvidence = (top?.projectMatch ?? 0) > 0 || (second?.projectMatch ?? 0) > 0;
  const topDomain = input.domains.find(({ id }) => id === top?.id);
  const secondDomain = input.domains.find(({ id }) => id === second?.id);
  const incompatibleSurfaces = top && second && topDomain?.targetSurface !== undefined && secondDomain?.targetSurface !== undefined
    ? canonical(topDomain.targetSurface) !== canonical(secondDomain.targetSurface)
    : false;
  const ambiguousDomainIds = top && second && incompatibleSurfaces && top.semanticScore - second.semanticScore <= thresholds.ambiguityDelta && !projectEvidence
    ? [top.id, second.id]
    : [];
  const supportingDomainIds = eligible
    .filter(({ id, semanticScore }) => id !== top?.id && semanticScore + Number.EPSILON >= thresholds.supportingDomain)
    .map(({ id }) => id);
  const primaryDomainId = ambiguousDomainIds.length > 0 ? undefined : top?.id;
  const candidates = scores
    .filter(({ id, semanticScore, available: isAvailable }) =>
      isAvailable && (semanticScore + Number.EPSILON >= thresholds.supportingDomain || ambiguousDomainIds.includes(id)),
    )
    .map((score) => toCandidate(score, score.id === primaryDomainId ? "primary" : "supporting"));
  return {
    candidates,
    scores,
    primaryDomainId,
    supportingDomainIds,
    ambiguousDomainIds,
    clarificationRequired: ambiguousDomainIds.length > 0,
  };
};

export const normalizeDomainAlias = (value: string, domains: TaskAnalyzerDomainMetadata[]) => {
  const normalized = canonical(value);
  return domains.find((domain) =>
    [domain.id, ...domain.routing.aliases].some((alias) => canonical(alias) === normalized),
  )?.id;
};

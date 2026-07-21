import type { ProjectFingerprint } from "../types.ts";
import type { RoutingContext } from "./context.ts";
import { buildCanonicalRequirements, routingSignalDigest, type CanonicalRequirement, type InternalRoutingSignal } from "./requirements.ts";
import { inferRequestFrameActions } from "./request-frame.ts";
import { matchRoutingVocabulary, type MatchedRoutingSignal } from "./vocabulary/match.ts";
import { normalizeRoutingText, type NormalizedText } from "./vocabulary/normalize.ts";
import type {
  TaskAction,
  TaskLocale,
  TaskProfile,
  TaskSignalEvidence,
  TaskSubtask,
  RouterSkillRole,
} from "./types.ts";

export type TaskAnalyzerDomainMetadata = {
  id: string;
  targetSurface?: string;
  routing: {
    aliases: string[];
    intentTags: string[];
    artifactTypes: string[];
    technologyTags: string[];
    projectTags: string[];
  };
};

export type TaskAnalyzerSkillMetadata = {
  domains: string[];
  roles?: RouterSkillRole[];
  actions: TaskAction[];
  artifactTypes: string[];
  intentTags: string[];
  technologyTags: string[];
  qualityGoals: string[];
  environmentSignals?: string[];
};

export type AnalyzeTaskInput = {
  prompt: string;
  domains: TaskAnalyzerDomainMetadata[];
  skills: TaskAnalyzerSkillMetadata[];
  fingerprint?: ProjectFingerprint;
  routingContext: RoutingContext;
};

export type TaskAnalysisResult = {
  profile: TaskProfile;
  warnings: string[];
  routingIntentTags: string[];
  requirements: CanonicalRequirement[];
  matchedSignals: MatchedRoutingSignal[];
  signalDigest: string;
};

const signalKindOrder = ["domain", "action", "artifact", "intent", "technology", "quality", "constraint", "acceptance"] as const;
const canonical = (value: string) => value.normalize("NFKC").toLocaleLowerCase("und").replaceAll("ё", "е");
const unique = <T>(items: T[], key: (item: T) => string) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};
const detectLocale = (source: string): TaskLocale => {
  const hasEnglish = /\p{Script=Latin}/u.test(source);
  const hasRussian = /\p{Script=Cyrillic}/u.test(source);
  if (hasEnglish && hasRussian) return "mixed";
  if (hasRussian) return "ru";
  if (hasEnglish) return "en";
  return "unknown";
};

const fingerprintSignalNames = (fingerprint: ProjectFingerprint | undefined) => fingerprint ? [
  ...fingerprint.languages.map(({ name, confidence }) => ({ name, confidence })),
  ...fingerprint.frameworks.map(({ name, confidence }) => ({ name, confidence })),
  ...fingerprint.testing.map(({ name, confidence }) => ({ name, confidence })),
  ...fingerprint.infrastructure.map(({ name, confidence }) => ({ name, confidence })),
  ...fingerprint.tags.map((name) => ({ name, confidence: 0.5 })),
] : [];

const fingerprintSignals = (
  fingerprint: ProjectFingerprint | undefined,
  domains: TaskAnalyzerDomainMetadata[],
  context: RoutingContext,
): InternalRoutingSignal[] => {
  const names = fingerprintSignalNames(fingerprint).map(({ name, confidence }) => ({ name: canonical(name), confidence }));
  const technologyOwners = new Map<string, string[]>();
  for (const [ownerKey, allowlists] of context.ownerAllowlists) {
    if (!ownerKey.startsWith("domain:")) continue;
    const owner = ownerKey.slice("domain:".length);
    for (const id of allowlists.technologyIds) technologyOwners.set(id, [...(technologyOwners.get(id) ?? []), owner]);
  }
  const technologies = [...technologyOwners].flatMap(([id, ownerIds]) => {
    const matches = names.filter(({ name }) => name === canonical(id));
    if (!matches.length) return [];
    return [{ kind: "technology" as const, id, source: "fingerprint" as const, evidenceEligible: false, ownerIds: [...new Set(ownerIds)].sort(), confidence: Math.max(...matches.map(({ confidence }) => confidence)) }];
  });
  const domainSignals = domains.flatMap((domain) => {
    const matches = names.filter(({ name }) => domain.routing.projectTags.some((tag) => canonical(tag) === name));
    if (!matches.length) return [];
    return [{ kind: "domain" as const, id: domain.id, source: "fingerprint" as const, evidenceEligible: false, ownerIds: [domain.id], confidence: Math.max(...matches.map(({ confidence }) => confidence)) }];
  });
  return [...technologies, ...domainSignals];
};

const idsInOrder = (signals: Array<Pick<MatchedRoutingSignal, "kind" | "id" | "start">>, kind: MatchedRoutingSignal["kind"]) =>
  unique(signals.filter((signal) => signal.kind === kind).sort((left, right) => left.start - right.start || left.id.localeCompare(right.id)), ({ id }) => id).map(({ id }) => id);

const domainIdsForPrompt = (
  signals: MatchedRoutingSignal[],
  domains: TaskAnalyzerDomainMetadata[],
) => domains.flatMap((domain) => {
  const relevant = signals.filter((signal) =>
    (signal.kind === "domain" && signal.id === domain.id) ||
    (signal.kind === "artifact" && domain.routing.artifactTypes.includes(signal.id)) ||
    (signal.kind === "technology" && domain.routing.technologyTags.includes(signal.id)) ||
    (signal.kind === "intent" && domain.routing.intentTags.includes(signal.id)));
  return relevant.length ? [{ id: domain.id, index: Math.min(...relevant.map(({ start }) => start)) }] : [];
}).sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));

const normalizedGoal = (input: { actions: string[]; artifacts: string[]; technologies: string[]; quality: string[] }) =>
  [...input.actions, ...input.artifacts, ...input.technologies, ...input.quality].join(" ");

const segmentSubtasks = (
  text: NormalizedText,
  signals: MatchedRoutingSignal[],
  protectedBoundaryIndexes: number[],
  domains: TaskAnalyzerDomainMetadata[],
): TaskSubtask[] => {
  const boundaries = text.boundaries.filter((_, index) => !protectedBoundaryIndexes.includes(index))
    .map(({ tokenIndex }) => tokenIndex).filter((value, index, all) => index === 0 || value !== all[index - 1]);
  const ranges = [0, ...boundaries, text.tokens.length]
    .slice(0, -1).map((start, index) => ({ start, end: [0, ...boundaries, text.tokens.length][index + 1] }))
    .filter(({ start, end }) => end > start);
  const candidates = ranges.flatMap((range) => {
    const normalizedStart = text.tokens[range.start]?.normalizedStart ?? 0;
    const normalizedEnd = text.tokens[range.end - 1]?.normalizedEnd ?? normalizedStart;
    const segmentSignals = signals.filter(({ start, end }) => start >= normalizedStart && end <= normalizedEnd);
    const actions = idsInOrder(segmentSignals, "action") as TaskAction[];
    const artifactTypes = idsInOrder(segmentSignals, "artifact");
    if (!actions.length && !artifactTypes.length) return [];
    const technologies = idsInOrder(segmentSignals, "technology");
    const quality = idsInOrder(segmentSignals, "quality");
    const intentIds = idsInOrder(segmentSignals, "intent");
    const candidateDomainIds = domainIdsForPrompt(segmentSignals, domains).map(({ id }) => id);
    return [{ actions, artifactTypes, technologies, quality, intentIds, candidateDomainIds }];
  });
  if (candidates.length < 2) return [];
  const used = new Map<string, number>();
  return candidates.map((candidate) => {
    const base = `${candidate.candidateDomainIds[0] ?? candidate.artifactTypes[0] ?? "task"}-${candidate.actions[0] ?? "work"}`.slice(0, 128);
    const occurrence = (used.get(base) ?? 0) + 1;
    used.set(base, occurrence);
    return {
      id: occurrence === 1 ? base : `${base}-${occurrence}`.slice(0, 128),
      normalizedGoal: [
        ...candidate.actions,
        ...candidate.artifactTypes,
        ...candidate.technologies,
        ...candidate.quality,
        ...candidate.intentIds.map((id) => `intent:${id}`),
      ].join(" "),
      actions: candidate.actions,
      artifactTypes: candidate.artifactTypes,
      candidateDomainIds: candidate.candidateDomainIds,
    };
  });
};

const hasUnknownTechnology = (source: string, signals: MatchedRoutingSignal[]) => {
  const candidate = /(?:\busing\b|\bwith\b|\bна\b|\bиспользуя\b)\s+([\p{L}\p{N}][\p{L}\p{N}._+-]*)/iu.exec(source);
  if (!candidate || /^(?:the|a|an|без|no)$/iu.test(candidate[1])) return false;
  const normalized = canonical(candidate[1]);
  return !signals.some(({ kind, id }) => kind === "technology" && canonical(id) === normalized);
};

export const analyzeTask = ({
  prompt,
  domains,
  fingerprint,
  routingContext,
}: AnalyzeTaskInput): TaskAnalysisResult => {
  const text = normalizeRoutingText(prompt);
  const matched = matchRoutingVocabulary({ text, vocabulary: routingContext.compiledVocabulary });
  const inferred = inferRequestFrameActions({
    text,
    matchedSignals: matched.signals,
    suppressions: matched.suppressions,
    creatableArtifactIds: routingContext.creatableArtifactIds,
  });
  const matchedSignals = [...matched.signals, ...inferred].sort((left, right) =>
    left.start - right.start || left.end - right.end || signalKindOrder.indexOf(left.kind) - signalKindOrder.indexOf(right.kind) || left.id.localeCompare(right.id));
  const fingerprintContext = fingerprintSignals(fingerprint, domains, routingContext);
  const internalSignals: InternalRoutingSignal[] = [...matchedSignals, ...fingerprintContext].map((signal) => ({
    kind: signal.kind,
    id: signal.id,
    source: signal.source,
    evidenceEligible: signal.evidenceEligible,
    ownerIds: [...signal.ownerIds],
    confidence: signal.confidence,
  }));
  const requirements = buildCanonicalRequirements(internalSignals);
  const promptDomains = domainIdsForPrompt(matchedSignals, domains);
  const projectDomains = fingerprintContext.filter(({ kind }) => kind === "domain").map(({ id }) => id);
  const domainIds = unique([
    ...promptDomains.map(({ id }) => id),
    ...projectDomains,
  ], (id) => id);

  const promptTechnologies = idsInOrder(matchedSignals, "technology");
  const fingerprintTechnologies = fingerprintContext.filter(({ kind }) => kind === "technology").map(({ id }) => id);
  const actions = idsInOrder(matchedSignals, "action") as TaskAction[];
  const artifacts = idsInOrder(matchedSignals, "artifact");
  const technologies = unique([...promptTechnologies, ...fingerprintTechnologies], (id) => id);
  const qualityGoals = idsInOrder(matchedSignals, "quality");
  const constraints = idsInOrder(matchedSignals, "constraint");
  const acceptanceCriteria = idsInOrder(matchedSignals, "acceptance");
  const routingIntentTags = unique(matchedSignals.filter(({ kind }) => kind === "intent").flatMap((signal) => {
    const mapped = signal.ownerIds.flatMap((ownerId) => routingContext.domains.get(ownerId)?.intentMappings.get(signal.id)?.skillIntentIds ?? []);
    return [signal.id, ...mapped];
  }), (id) => id).sort();

  const profileEvidence = unique<TaskSignalEvidence>([
    ...matchedSignals.flatMap((signal): TaskSignalEvidence[] => signal.kind === "intent" ? [] : [{
      source: signal.source === "host-semantic" ? "config" : "prompt",
      kind: signal.kind,
      id: signal.id,
    }]),
    ...fingerprintContext.flatMap((signal): TaskSignalEvidence[] => signal.kind === "technology" || signal.kind === "domain"
      ? [{ source: "fingerprint", kind: signal.kind, id: signal.id }]
      : []),
    ...promptDomains.map(({ id }): TaskSignalEvidence => ({ source: "prompt", kind: "domain", id })),
  ], (item) => `${item.source}:${item.kind}:${item.id}`);

  const profile: TaskProfile = {
    schemaVersion: "task-profile/1.0",
    normalizedGoal: normalizedGoal({ actions, artifacts, technologies, quality: qualityGoals }),
    locale: detectLocale(prompt),
    actions,
    artifactTypes: artifacts,
    technologies,
    constraints,
    qualityGoals,
    acceptanceCriteria,
    domains: domainIds.map((id, index) => {
      const promptMatched = promptDomains.some((candidate) => candidate.id === id);
      const projectMatched = projectDomains.includes(id);
      return {
        id,
        confidence: promptMatched && projectMatched ? 1 : promptMatched ? 0.7 : 0.45,
        role: index === 0 ? "primary" as const : "supporting" as const,
        available: domains.some((domain) => domain.id === id),
        reasons: [`domain-match:${id}`, ...(projectMatched ? [`environment-match:${id}`] : [])],
        evidence: profileEvidence.filter((item) => item.kind === "domain" && item.id === id),
      };
    }),
    subtasks: segmentSubtasks(text, matchedSignals, matched.protectedBoundaryIndexes, domains),
    evidence: profileEvidence,
  };
  return {
    profile,
    warnings: hasUnknownTechnology(text.normalized, matchedSignals) ? ["unclassified-technology-signal"] : [],
    routingIntentTags,
    requirements,
    matchedSignals,
    signalDigest: routingSignalDigest(internalSignals),
  };
};

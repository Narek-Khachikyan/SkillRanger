import "../domains/bundled.ts";
import { listDomainPacks, resolveDomainPackForSkill } from "../domains/registry.ts";
import type {
  ProjectFingerprint,
  Recommendation,
  RegistrySkill,
  SkillLane,
} from "../types.ts";
import {
  buildSkillFeatureVector,
  orderSkillCandidates,
  orderScoredCandidates,
  scoreFreshness,
  scoreSkillCandidate,
  scoreSharedFeatures,
  type BuildSkillFeatureVectorInput,
  type SkillFeatureVector,
  type SharedScoreFeatures,
} from "./scoring.ts";

export {
  buildSkillFeatureVector,
  orderSkillCandidates,
  orderScoredCandidates,
  scoreFreshness,
  scoreSkillCandidate,
  scoreSharedFeatures,
  type BuildSkillFeatureVectorInput,
  type SkillFeatureVector,
  type SharedScoreFeatures,
} from "./scoring.ts";

export type RecommendSkillsOptions = {
  targetAgent?: string;
  userIntent?: string;
  lane?: SkillLane;
  limitPerLane?: number;
  hostCapabilities?: string[];
  domainId?: string;
  routingDate?: string;
};

const fallbackLane = (skill: RegistrySkill): SkillLane => {
  if (skill.manifest.id.includes("agents-md")) return "agent-context";
  if (skill.manifest.taskTags.some((tag) => ["testing", "e2e-testing", "qa", "debugging"].includes(tag))) {
    return "qa";
  }
  if (
    skill.manifest.taskTags.some((tag) =>
      ["visual-design", "design-system", "design-to-code", "interaction-polish", "ux", "styling"].includes(tag),
    )
  ) {
    return "design";
  }
  if (skill.manifest.stackTags.includes("nextjs")) return "framework";
  return "implementation";
};

export const groupRecommendationsByLane = (recommendations: Recommendation[]) => {
  const groups: Array<{ lane: SkillLane; recommendations: Recommendation[] }> = [];
  const groupIndex = new Map<SkillLane, number>();
  for (const recommendation of recommendations) {
    const lane = recommendation.lane ?? "implementation";
    const existingIndex = groupIndex.get(lane);
    if (existingIndex === undefined) {
      groupIndex.set(lane, groups.length);
      groups.push({ lane, recommendations: [recommendation] });
    } else {
      groups[existingIndex].recommendations.push(recommendation);
    }
  }
  return groups;
};

const currentUtcDate = () => new Date().toISOString().slice(0, 10);

export const recommendSkills = (
  fingerprint: ProjectFingerprint,
  skills: RegistrySkill[],
  options: RecommendSkillsOptions = {},
): Recommendation[] => {
  const targetAgent = options.targetAgent ?? "codex";
  const routingDate = options.routingDate ?? currentUtcDate();
  const requestedDomain = options.domainId
    ? listDomainPacks().find((pack) => pack.manifest.id === options.domainId)
    : undefined;
  if (options.domainId && !requestedDomain) return [];

  const rankedRecommendations = skills.flatMap((skill) => {
    const domainPack = resolveDomainPackForSkill(skill.manifest.id);
    if (requestedDomain && domainPack?.manifest.id !== requestedDomain.manifest.id) return [];
    if (domainPack?.routing.rejectIntent(options.userIntent)) return [];
    const lane = skill.manifest.routing?.lane ?? fallbackLane(skill);
    const compatibility = skill.manifest.compatibility?.[targetAgent];
    const compatibilityLevel = compatibility?.level;
    const supported = compatibilityLevel === undefined
      ? skill.manifest.supportedAgents.includes(targetAgent)
      : compatibilityLevel !== "unsupported";
    if (!supported) return [];
    const stackMatch = skill.manifest.stackTags.length === 0
      ? 0
      : skill.manifest.stackTags.filter((tag) => fingerprint.tags.includes(tag)).length / skill.manifest.stackTags.length;
    if (skill.manifest.stackTags.length > 0 && stackMatch === 0) return [];
    if (domainPack && !domainPack.routing.includeSkill(fingerprint, skill, options.userIntent)) return [];

    const featureInput: BuildSkillFeatureVectorInput = {
      fingerprint,
      skill,
      targetAgent,
      userIntent: options.userIntent,
      hostCapabilities: options.hostCapabilities,
      routingDate,
      lane,
      laneAdjustment: domainPack?.routing.laneAdjustment(lane, options.userIntent) ?? 0,
      skillAdjustment: domainPack?.routing.skillAdjustment(skill, options.userIntent) ?? 0,
    };
    const features: SkillFeatureVector = buildSkillFeatureVector(featureInput);
    return [scoreSkillCandidate(features)];
  });

  const orderedRecommendations = orderSkillCandidates(rankedRecommendations);
  const laneRecommendations = options.lane
    ? orderedRecommendations.filter((recommendation) => recommendation.lane === options.lane)
    : orderedRecommendations;
  const limitedRecommendations =
    typeof options.limitPerLane === "number" && Number.isInteger(options.limitPerLane) && options.limitPerLane > 0
      ? groupRecommendationsByLane(laneRecommendations).flatMap((group) =>
          group.recommendations.slice(0, options.limitPerLane),
        )
      : laneRecommendations;
  if (options.userIntent?.trim()) {
    const primaryDomain = limitedRecommendations[0]
      ? resolveDomainPackForSkill(limitedRecommendations[0].skillId)
      : undefined;
    return primaryDomain ? primaryDomain.routing.compose(limitedRecommendations) : limitedRecommendations;
  }
  return limitedRecommendations;
};

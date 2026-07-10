import "../domains/bundled.ts";
import { listDomainPacks, resolveDomainPackForSkill } from "../domains/registry.ts";
import type {
  ProjectFingerprint,
  Recommendation,
  RegistrySkill,
  SkillLane,
} from "../types.ts";

export type RecommendSkillsOptions = {
  targetAgent?: string;
  userIntent?: string;
  lane?: SkillLane;
  limitPerLane?: number;
  hostCapabilities?: string[];
  domainId?: string;
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

const tokenize = (input: string) =>
  new Set(
    input
      .toLowerCase()
      .split(/[^\p{L}\p{N}+.#-]+/u)
      .map((part) => part.trim())
      .map((part) => part.replace(/^[.,:;!?()[\]{}"']+|[.,:;!?()[\]{}"']+$/g, ""))
      .filter(Boolean),
  );

const overlapScore = (left: string[], right: string[]) => {
  if (right.length === 0) return 0;
  const leftSet = new Set(left.map((item) => item.toLowerCase()));
  const hits = right.filter((item) => leftSet.has(item.toLowerCase())).length;
  return hits / right.length;
};

const freshnessScore = (date?: string) => {
  if (!date) return 0.5;
  const reviewed = Date.parse(date);
  if (Number.isNaN(reviewed)) return 0.5;
  const ageDays = (Date.now() - reviewed) / 86_400_000;
  if (ageDays <= 180) return 1;
  if (ageDays <= 540) return 0.75;
  return 0.45;
};

const fieldTokens = (values: string[]) => tokenize(values.join(" "));

const intentScore = (skill: RegistrySkill, intent?: string) => {
  if (!intent) return 0.5;
  const tokens = tokenize(intent);
  if (tokens.size === 0) return 0.5;
  const identityTokens = fieldTokens([
    skill.manifest.id,
    skill.manifest.name,
    skill.manifest.displayName,
  ]);
  const taskTokens = fieldTokens(skill.manifest.taskTags);
  const stackTokens = fieldTokens(skill.manifest.stackTags);
  const descriptionTokens = fieldTokens([skill.manifest.description]);
  let score = 0;
  for (const token of tokens) {
    if (identityTokens.has(token)) score += 1;
    else if (taskTokens.has(token)) score += 0.55;
    else if (stackTokens.has(token)) score += 0.45;
    else if (descriptionTokens.has(token)) score += 0.25;
  }
  return score / tokens.size;
};

const compatibilityScore = (skill: RegistrySkill, targetAgent: string) => {
  const compatibility = skill.manifest.compatibility?.[targetAgent];
  if (!compatibility) return skill.manifest.supportedAgents.includes(targetAgent) ? 1 : 0;
  if (compatibility.level === "native") return 1;
  if (compatibility.level === "packageable") return 0.65;
  if (compatibility.level === "convertible") return 0.45;
  return 0;
};

const verificationFor = (skill: RegistrySkill, hostCapabilities: Set<string>) => {
  const verification = skill.manifest.verification;
  if (!verification) return { status: "ready" as const, missingCapabilities: [] };
  const missingCapabilities = verification.requiredCapabilities.filter(
    (capability) => !hostCapabilities.has(capability),
  );
  return {
    status: missingCapabilities.length === 0 ? "ready" as const : verification.fallback,
    missingCapabilities,
  };
};

const evaluationConfidence = (skill: RegistrySkill) => {
  switch (skill.manifest.evaluation?.status) {
    case "curated": return 1;
    case "task-eval": return 0.7;
    case "trigger-eval": return 0.25;
    case "real-project-smoke": return 0.25;
    default: return 0.25;
  }
};

const effectiveQualityScore = (skill: RegistrySkill) => {
  const editorialScore = clamp(skill.manifest.qualityScore);
  const confidence = evaluationConfidence(skill);
  const confidenceAdjusted = 0.5 + (editorialScore - 0.5) * confidence;
  const benchmarkScore = skill.manifest.evaluation?.score;
  if (
    ["task-eval", "curated"].includes(skill.manifest.evaluation?.status ?? "none") &&
    benchmarkScore !== undefined
  ) {
    return clamp((confidenceAdjusted + benchmarkScore) / 2);
  }
  return clamp(confidenceAdjusted);
};

const evaluationPenalty = (skill: RegistrySkill) => {
  switch (skill.manifest.evaluation?.status) {
    case "curated": return 0;
    case "task-eval": return 0.01;
    case "trigger-eval": return 0.02;
    case "real-project-smoke": return 0.02;
    default: return 0.03;
  }
};

const rounded = (value: number) => Number(value.toFixed(3));

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

export const recommendSkills = (
  fingerprint: ProjectFingerprint,
  skills: RegistrySkill[],
  options: RecommendSkillsOptions = {},
): Recommendation[] => {
  const targetAgent = options.targetAgent ?? "codex";
  const requestedDomain = options.domainId
    ? listDomainPacks().find((pack) => pack.manifest.id === options.domainId)
    : undefined;
  if (options.domainId && !requestedDomain) return [];
  const hostCapabilities = new Set(
    (options.hostCapabilities ?? []).map((capability) => capability.toLowerCase()),
  );

  const rankedRecommendations = skills.flatMap((skill) => {
    const domainPack = resolveDomainPackForSkill(skill.manifest.id);
    if (requestedDomain && domainPack?.manifest.id !== requestedDomain.manifest.id) return [];
    if (domainPack?.routing.rejectIntent(options.userIntent)) return [];
    const stackMatch = overlapScore(fingerprint.tags, skill.manifest.stackTags);
    const userIntentMatch = intentScore(skill, options.userIntent);
    const hasEvaluationEvidence = skill.manifest.evaluation?.status === "curated";
    const qualityScore = clamp(skill.manifest.qualityScore);
    const scoredQuality = effectiveQualityScore(skill);
    const unverifiedEvaluationPenalty = evaluationPenalty(skill);
    const securityScore = clamp(skill.manifest.securityScore);
    const freshScore = freshnessScore(skill.manifest.freshness?.lastReviewedAt);
    const agentCompatibilityScore = compatibilityScore(skill, targetAgent);
    const lane = skill.manifest.routing?.lane ?? fallbackLane(skill);
    if (agentCompatibilityScore === 0) return [];
    if (skill.manifest.stackTags.length > 0 && stackMatch === 0) return [];
    if (domainPack && !domainPack.routing.includeSkill(fingerprint, skill, options.userIntent)) return [];

    const duplicatePenalty =
      fingerprint.agentContext.codexSkills.present && skill.manifest.supportedAgents.includes("codex")
        ? 0.2
        : 0;
    const laneAdjustment = domainPack?.routing.laneAdjustment(lane, options.userIntent) ?? 0;
    const skillAdjustment = domainPack?.routing.skillAdjustment(skill, options.userIntent) ?? 0;
    const verification = verificationFor(skill, hostCapabilities);
    const score =
      0.3 * stackMatch +
      0.2 * userIntentMatch +
      0.15 * scoredQuality +
      0.15 * securityScore +
      0.08 * freshScore +
      0.07 * agentCompatibilityScore -
      0.02 * duplicatePenalty -
      unverifiedEvaluationPenalty +
      laneAdjustment +
      skillAdjustment;

    const reasons: string[] = [];
    const matchedStackTags = skill.manifest.stackTags.filter((tag) => fingerprint.tags.includes(tag));
    for (const tag of skill.manifest.stackTags) {
      if (fingerprint.tags.includes(tag)) reasons.push(`${tag} detected`);
    }
    if (agentCompatibilityScore === 1) reasons.push(`supports ${targetAgent}`);
    if (options.userIntent && userIntentMatch > 0.7) reasons.push("matches user intent");
    if (skillAdjustment > 0) reasons.push("specialized intent boost");
    if (laneAdjustment > 0) {
      reasons.push(options.userIntent ? `${lane} lane matches intent` : `${lane} lane matches detected stack`);
    }
    if (verification.missingCapabilities.length > 0) {
      reasons.push(`verified completion needs ${verification.missingCapabilities.join(", ")}`);
    }
    if (!hasEvaluationEvidence) reasons.push("evaluation evidence missing; ranking penalty applied");
    if (skill.manifest.riskLevel === "low") reasons.push("low-risk instruction-only skill");
    if (!fingerprint.agentContext.codexSkills.present) reasons.push("no similar repo-local skill directory detected");

    return [{
      skillId: skill.manifest.id,
      displayName: skill.manifest.displayName,
      lane,
      category: skill.manifest.routing?.category,
      score: rounded(score),
      scoreBreakdown: {
        stackMatch: rounded(stackMatch),
        userIntentMatch: rounded(userIntentMatch),
        qualityScore: rounded(qualityScore),
        effectiveQualityScore: rounded(scoredQuality),
        securityScore: rounded(securityScore),
        freshnessScore: rounded(freshScore),
        compatibilityScore: rounded(agentCompatibilityScore),
        duplicatePenalty: rounded(duplicatePenalty),
        evaluationPenalty: rounded(unverifiedEvaluationPenalty),
        laneAdjustment: rounded(laneAdjustment),
        skillAdjustment: rounded(skillAdjustment),
        finalScore: rounded(score),
      },
      riskLevel: skill.manifest.riskLevel,
      verification,
      reasons: [
        ...reasons,
        matchedStackTags.length > 0
          ? `score driven by stack match ${stackMatch.toFixed(2)} (${matchedStackTags.join(", ")})`
          : "score driven by baseline quality/security/freshness",
      ].slice(0, 6),
    }];
  })
    .filter((recommendation) => recommendation.score > 0.25)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.scoreBreakdown.qualityScore - a.scoreBreakdown.qualityScore ||
        a.skillId.localeCompare(b.skillId),
    );

  const laneRecommendations = options.lane
    ? rankedRecommendations.filter((recommendation) => recommendation.lane === options.lane)
    : rankedRecommendations;
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

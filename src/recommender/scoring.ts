import type {
  ProjectFingerprint,
  Recommendation,
  RegistrySkill,
  SkillLane,
} from "../types.ts";

export type SkillFeatureVector = {
  skill: RegistrySkill;
  targetAgent: string;
  lane: SkillLane;
  hasUserIntent: boolean;
  fingerprintAgentContextPresent: boolean;
  stackMatch: number;
  userIntentMatch: number;
  qualityScore: number;
  effectiveQualityScore: number;
  securityScore: number;
  freshnessScore: number;
  compatibilityScore: number;
  duplicatePenalty: number;
  evaluationPenalty: number;
  laneAdjustment: number;
  skillAdjustment: number;
  verification: Recommendation["verification"];
  hasEvaluationEvidence: boolean;
  matchedStackTags: string[];
};

export type SharedScoreFeatures = Pick<SkillFeatureVector,
  | "stackMatch"
  | "userIntentMatch"
  | "effectiveQualityScore"
  | "securityScore"
  | "freshnessScore"
  | "compatibilityScore"
  | "duplicatePenalty"
  | "evaluationPenalty"
  | "laneAdjustment"
  | "skillAdjustment"
>;

export const scoreSharedFeatures = (features: SharedScoreFeatures) => {
  const score =
    0.3 * features.stackMatch +
    0.2 * features.userIntentMatch +
    0.15 * features.effectiveQualityScore +
    0.15 * features.securityScore +
    0.08 * features.freshnessScore +
    0.07 * features.compatibilityScore -
    0.02 * features.duplicatePenalty -
    features.evaluationPenalty +
    features.laneAdjustment +
    features.skillAdjustment;
  return Number(score.toFixed(3));
};

export type BuildSkillFeatureVectorInput = {
  fingerprint: ProjectFingerprint;
  skill: RegistrySkill;
  targetAgent: string;
  userIntent?: string;
  hostCapabilities?: Iterable<string>;
  routingDate: string;
  lane: SkillLane;
  laneAdjustment?: number;
  skillAdjustment?: number;
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

export const scoreFreshness = (date: string | undefined, routingDate: string) => {
  if (!date) return 0.5;
  const reviewed = Date.parse(date);
  const routed = Date.parse(`${routingDate}T00:00:00.000Z`);
  if (Number.isNaN(reviewed) || Number.isNaN(routed)) return 0.5;
  const ageDays = (routed - reviewed) / 86_400_000;
  if (ageDays <= 180) return 1;
  if (ageDays <= 540) return 0.75;
  return 0.45;
};

export const orderScoredCandidates = <T>(
  candidates: T[],
  score: (candidate: T) => number,
  identity: (candidate: T) => string,
  quality: (candidate: T) => number = () => 0,
) => [...candidates].sort((left, right) =>
  score(right) - score(left) || quality(right) - quality(left) || identity(left).localeCompare(identity(right)),
);

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

export const buildSkillFeatureVector = (
  input: BuildSkillFeatureVectorInput,
): SkillFeatureVector => {
  const hostCapabilities = new Set(
    [...(input.hostCapabilities ?? [])].map((capability) => capability.toLowerCase()),
  );
  const stackMatch = overlapScore(input.fingerprint.tags, input.skill.manifest.stackTags);
  return {
    skill: input.skill,
    targetAgent: input.targetAgent,
    lane: input.lane,
    hasUserIntent: Boolean(input.userIntent),
    fingerprintAgentContextPresent: input.fingerprint.agentContext.codexSkills.present,
    stackMatch,
    userIntentMatch: intentScore(input.skill, input.userIntent),
    qualityScore: clamp(input.skill.manifest.qualityScore),
    effectiveQualityScore: effectiveQualityScore(input.skill),
    securityScore: clamp(input.skill.manifest.securityScore),
    freshnessScore: scoreFreshness(input.skill.manifest.freshness?.lastReviewedAt, input.routingDate),
    compatibilityScore: compatibilityScore(input.skill, input.targetAgent),
    duplicatePenalty:
      input.fingerprint.agentContext.codexSkills.present && input.skill.manifest.supportedAgents.includes("codex")
        ? 0.2
        : 0,
    evaluationPenalty: evaluationPenalty(input.skill),
    laneAdjustment: input.laneAdjustment ?? 0,
    skillAdjustment: input.skillAdjustment ?? 0,
    verification: verificationFor(input.skill, hostCapabilities),
    hasEvaluationEvidence: input.skill.manifest.evaluation?.status === "curated",
    matchedStackTags: input.skill.manifest.stackTags.filter((tag) => input.fingerprint.tags.includes(tag)),
  };
};

export const scoreSkillCandidate = (features: SkillFeatureVector): Recommendation => {
  const score = scoreSharedFeatures(features);

  const reasons: string[] = [];
  for (const tag of features.skill.manifest.stackTags) {
    if (features.matchedStackTags.includes(tag)) reasons.push(`${tag} detected`);
  }
  if (features.compatibilityScore === 1) reasons.push(`supports ${features.targetAgent}`);
  if (features.hasUserIntent && features.userIntentMatch > 0.7) reasons.push("matches user intent");
  if (features.skillAdjustment > 0) reasons.push("specialized intent boost");
  if (features.laneAdjustment > 0) {
    reasons.push(features.hasUserIntent
      ? `${features.lane} lane matches intent`
      : `${features.lane} lane matches detected stack`);
  }
  if (features.verification.missingCapabilities.length > 0) {
    reasons.push(`verified completion needs ${features.verification.missingCapabilities.join(", ")}`);
  }
  if (!features.hasEvaluationEvidence) reasons.push("evaluation evidence missing; ranking penalty applied");
  if (features.skill.manifest.riskLevel === "low") reasons.push("low-risk instruction-only skill");
  if (!features.fingerprintAgentContextPresent) reasons.push("no similar repo-local skill directory detected");

  return {
    skillId: features.skill.manifest.id,
    displayName: features.skill.manifest.displayName,
    lane: features.lane,
    category: features.skill.manifest.routing?.category,
    score: rounded(score),
    scoreBreakdown: {
      stackMatch: rounded(features.stackMatch),
      userIntentMatch: rounded(features.userIntentMatch),
      qualityScore: rounded(features.qualityScore),
      effectiveQualityScore: rounded(features.effectiveQualityScore),
      securityScore: rounded(features.securityScore),
      freshnessScore: rounded(features.freshnessScore),
      compatibilityScore: rounded(features.compatibilityScore),
      duplicatePenalty: rounded(features.duplicatePenalty),
      evaluationPenalty: rounded(features.evaluationPenalty),
      laneAdjustment: rounded(features.laneAdjustment),
      skillAdjustment: rounded(features.skillAdjustment),
      finalScore: rounded(score),
    },
    riskLevel: features.skill.manifest.riskLevel,
    verification: features.verification,
    reasons: [
      ...reasons,
      features.matchedStackTags.length > 0
        ? `score driven by stack match ${features.stackMatch.toFixed(2)} (${features.matchedStackTags.join(", ")})`
        : "score driven by baseline quality/security/freshness",
    ].slice(0, 6),
  };
};

export const orderSkillCandidates = (recommendations: Recommendation[]) =>
  orderScoredCandidates(
    recommendations.filter((recommendation) => recommendation.score > 0.25),
    (recommendation) => recommendation.score,
    (recommendation) => recommendation.skillId,
    (recommendation) => recommendation.scoreBreakdown.qualityScore,
  );

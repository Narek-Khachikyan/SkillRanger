import type { SetupAgentType } from "../installers/agents.ts";
import type { Recommendation } from "../types.ts";

export type SetupTargetRecommendations = Readonly<{
  targetAgent: SetupAgentType;
  recommendations: Recommendation[];
}>;

export const summarizeSetupRecommendations = (
  sets: SetupTargetRecommendations[],
) => {
  const bestBySkillId = new Map<string, Recommendation>();
  const targetsBySkillId = new Map<string, SetupAgentType[]>();

  for (const { targetAgent, recommendations } of sets) {
    for (const recommendation of recommendations) {
      const current = bestBySkillId.get(recommendation.skillId);
      if (!current || recommendation.score > current.score) {
        bestBySkillId.set(recommendation.skillId, recommendation);
      }
      const targets = targetsBySkillId.get(recommendation.skillId) ?? [];
      if (!targets.includes(targetAgent)) targets.push(targetAgent);
      targetsBySkillId.set(recommendation.skillId, targets);
    }
  }

  return {
    recommendations: [...bestBySkillId.values()].sort(
      (left, right) => right.score - left.score || left.skillId.localeCompare(right.skillId),
    ),
    targetsBySkillId,
    targetsWithoutRecommendations: sets
      .filter(({ recommendations }) => recommendations.length === 0)
      .map(({ targetAgent }) => targetAgent),
  };
};

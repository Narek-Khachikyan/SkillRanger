import { actionCompatibilityScore } from "./action-compatibility.ts";
import type { TaskAnalyzerSkillMetadata } from "./analyzer.ts";
import type { RoutingContext } from "./context.ts";
import type { CanonicalRequirement } from "./requirements.ts";
import type { TaskAction } from "./types.ts";

export const actionRequirementCovered = (requested: TaskAction, skillActions: TaskAction[]) =>
  skillActions.some((supported) => supported === requested || actionCompatibilityScore(requested, supported) >= 0.85);

export type RequirementCoverage = {
  covered: CanonicalRequirement[];
  uncovered: CanonicalRequirement[];
  coveredWeight: number;
  totalWeight: number;
  ratio: number;
  reasonCodes: string[];
};

const canonical = (value: string) => value.normalize("NFKC").trim().toLowerCase();
export const requirementKey = (requirement: Pick<CanonicalRequirement, "kind" | "id">) => `${requirement.kind}:${canonical(requirement.id)}`;
export const effectiveRequirementWeight = (requirement: CanonicalRequirement) => {
  if (!Number.isFinite(requirement.baseWeight) || !Number.isFinite(requirement.confidence) || requirement.baseWeight < 0 || requirement.confidence < 0) {
    throw new TypeError("requirement-weight-invalid");
  }
  return requirement.baseWeight * requirement.confidence;
};

export const dedupeRequirements = (requirements: CanonicalRequirement[]) => {
  const byKey = new Map<string, CanonicalRequirement>();
  const classOrder = { explicit: 0, inferred: 1, context: 2 } as const;
  for (const requirement of requirements) {
    effectiveRequirementWeight(requirement);
    const key = requirementKey(requirement);
    const current = byKey.get(key);
    if (!current || classOrder[requirement.requirementClass] < classOrder[current.requirementClass] ||
      (requirement.requirementClass === current.requirementClass && effectiveRequirementWeight(requirement) > effectiveRequirementWeight(current))) {
      byKey.set(key, requirement);
    }
  }
  return [...byKey.values()].sort((left, right) => requirementKey(left).localeCompare(requirementKey(right)));
};

const intentIdsFor = (requirement: CanonicalRequirement, skill: TaskAnalyzerSkillMetadata, routingContext?: RoutingContext) => {
  const ids = new Set([canonical(requirement.id)]);
  for (const domainId of skill.domains) {
    for (const id of routingContext?.domains.get(domainId)?.intentMappings.get(requirement.id)?.skillIntentIds ?? []) ids.add(canonical(id));
  }
  return ids;
};

const requirementCovered = (requirement: CanonicalRequirement, skill: TaskAnalyzerSkillMetadata, routingContext?: RoutingContext) => {
  switch (requirement.kind) {
    case "action": return actionRequirementCovered(requirement.id as TaskAction, skill.actions);
    case "artifact": return skill.artifactTypes.some((id) => canonical(id) === canonical(requirement.id));
    case "technology": return skill.technologyTags.some((id) => canonical(id) === canonical(requirement.id));
    case "quality": return skill.qualityGoals.some((id) => canonical(id) === canonical(requirement.id));
    case "intent": {
      const ids = intentIdsFor(requirement, skill, routingContext);
      return skill.intentTags.some((id) => ids.has(canonical(id)));
    }
  }
};

export const calculateRequirementCoverage = (input: {
  requirements: CanonicalRequirement[];
  skill: TaskAnalyzerSkillMetadata;
  routingContext?: RoutingContext;
}): RequirementCoverage => {
  const requirements = dedupeRequirements(input.requirements);
  const covered = requirements.filter((requirement) => requirementCovered(requirement, input.skill, input.routingContext));
  const coveredKeys = new Set(covered.map(requirementKey));
  const uncovered = requirements.filter((requirement) => !coveredKeys.has(requirementKey(requirement)));
  const coveredWeight = covered.reduce((sum, requirement) => sum + effectiveRequirementWeight(requirement), 0);
  const totalWeight = requirements.reduce((sum, requirement) => sum + effectiveRequirementWeight(requirement), 0);
  return {
    covered,
    uncovered,
    coveredWeight,
    totalWeight,
    ratio: totalWeight === 0 ? 0 : coveredWeight / totalWeight,
    reasonCodes: covered.map((requirement) => `coverage:${requirement.kind}:${requirement.id}`),
  };
};

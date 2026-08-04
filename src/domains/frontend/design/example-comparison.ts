import { loadDesignRuleLibrarySync } from "./library.ts";
import { designRuleFamilies } from "./library-types.ts";
import type { LoadedRecipeExamplePack, RecipeExampleComparison } from "./example-types.ts";
import type { DesignDirection } from "./types.ts";

export const compareRecipeExamplePack = (
  pack: LoadedRecipeExamplePack,
  direction: Pick<DesignDirection, "recipeId" | "selectedRuleIds">,
): RecipeExampleComparison => {
  const selectedRuleIds = [...(direction.selectedRuleIds ?? [])];
  const referenceScene = pack.scenes.find((scene) =>
    scene.quality === "good" && scene.viewport === "desktop" && scene.state === "success",
  );
  const badReferenceScene = pack.scenes.find((scene) =>
    scene.quality === "bad" && scene.viewport === "desktop" && scene.state === "success",
  );
  const referenceRuleIds = referenceScene?.appliedRuleIds ?? [];
  const badReferenceRuleIds = badReferenceScene?.violatedRuleIds ?? [];
  const matchedRuleIds = selectedRuleIds.filter((id) => referenceRuleIds.includes(id));
  const matchedViolationRuleIds = selectedRuleIds.filter((id) => badReferenceRuleIds.includes(id));
  const findings: string[] = [];
  const library = loadDesignRuleLibrarySync();

  if (pack.recipeId !== direction.recipeId) findings.push("Recipe example pack does not match the design direction recipe.");
  if (selectedRuleIds.length !== designRuleFamilies.length || new Set(selectedRuleIds).size !== selectedRuleIds.length) {
    findings.push("Design direction must select six unique rules before example comparison.");
  }
  if (!referenceScene || !badReferenceScene) findings.push("The pack must provide good and bad desktop success reference scenes.");
  for (const ruleId of selectedRuleIds) {
    const rule = library.rules.find((candidate) => candidate.id === ruleId);
    if (!rule) findings.push(`Selected rule is not in the design rule library: ${ruleId}`);
    else if (!rule.recipeIds.includes("*") && !rule.recipeIds.includes(direction.recipeId)) {
      findings.push(`Selected rule is incompatible with ${direction.recipeId}: ${ruleId}`);
    }
    if (!referenceRuleIds.includes(ruleId)) findings.push(`Selected rule is not demonstrated by the good reference scene: ${ruleId}`);
  }
  return {
    ok: findings.length === 0,
    recipeId: pack.recipeId,
    selectedRuleIds,
    referenceRuleIds,
    badReferenceRuleIds,
    matchedRuleIds,
    matchedViolationRuleIds,
    findings,
  };
};

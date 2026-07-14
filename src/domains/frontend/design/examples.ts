import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultDomainsRoot } from "../../../paths.ts";
import { frontendRecipeIds } from "./catalog.ts";
import { loadDesignRuleLibrary } from "./library.ts";
import type { LoadedRecipeExamplePack, RecipeExamplePack } from "./example-types.ts";

export const defaultExamplesRoot = path.join(defaultDomainsRoot, "frontend", "examples");

const contained = (root: string, relativePath: string, label: string) => {
  const resolved = path.resolve(root, relativePath);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes example pack: ${relativePath}`);
  }
  return resolved;
};

export const loadRecipeExamplePacks = async (
  examplesRoot = defaultExamplesRoot,
): Promise<LoadedRecipeExamplePack[]> => {
  const root = path.resolve(examplesRoot);
  const ruleIds = new Set((await loadDesignRuleLibrary()).rules.map(({ id }) => id));
  return Promise.all(frontendRecipeIds.map(async (recipeId) => {
    const packRoot = contained(root, recipeId, "Recipe example directory");
    const sourcePath = contained(packRoot, "example.json", "Recipe example source");
    const pack = JSON.parse(await readFile(sourcePath, "utf8")) as RecipeExamplePack;
    if (pack.schemaVersion !== "1.0" || pack.recipeId !== recipeId || !Array.isArray(pack.scenes)) {
      throw new Error(`Invalid recipe example pack: ${recipeId}`);
    }
    const sceneIds = new Set<string>();
    const scenes = pack.scenes.map((scene) => {
      if (sceneIds.has(scene.id)) throw new Error(`Duplicate example scene id in ${recipeId}: ${scene.id}`);
      sceneIds.add(scene.id);
      for (const ruleId of [...scene.appliedRuleIds, ...scene.violatedRuleIds]) {
        if (!ruleIds.has(ruleId)) throw new Error(`Unknown design rule id in ${recipeId}: ${ruleId}`);
      }
      return {
        ...scene,
        assetPath: contained(packRoot, scene.asset, "Recipe example asset"),
      };
    });
    return { ...pack, sourcePath, scenes };
  }));
};

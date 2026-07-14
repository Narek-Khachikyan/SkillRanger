import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultDomainsRoot } from "../../../paths.ts";
import { frontendRecipeIds } from "./catalog.ts";
import { loadDesignRuleLibrary } from "./library.ts";
import type { ExampleScene, LoadedRecipeExamplePack, RecipeExamplePack } from "./example-types.ts";

export const defaultExamplesRoot = path.join(defaultDomainsRoot, "frontend", "examples");

const contained = (root: string, relativePath: string, label: string) => {
  const resolved = path.resolve(root, relativePath);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes example pack: ${relativePath}`);
  }
  return resolved;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isNonEmptyString);

const requiredSceneKeys = [
  "good:desktop:success", "bad:desktop:success", "good:mobile:success", "bad:mobile:success",
  "good:mobile:loading", "bad:mobile:loading", "good:mobile:empty", "bad:mobile:empty",
  "good:mobile:error", "bad:mobile:error",
] as const;

const scenarios: Record<string, { scenario: string; object: string; action: string }> = {
  "operational-command-center": { scenario: "Incident queue with stale and assigned states", object: "incident", action: "Triage incident" },
  "consumer-discovery": { scenario: "Saved reading catalogue with filters", object: "title", action: "Save title" },
  "developer-tool": { scenario: "Repository run diagnostics", object: "run", action: "Inspect failure" },
  "editorial-content": { scenario: "Sourced implementation guide", object: "section", action: "Continue reading" },
  "marketing-landing": { scenario: "Product capability explanation with supplied proof slot", object: "capability", action: "Request access" },
  "saas-workspace": { scenario: "Team project task list with permissions", object: "task", action: "Update status" },
  "e-commerce": { scenario: "Product comparison with availability and fulfillment", object: "product", action: "Add to cart" },
  "mobile-consumer-app": { scenario: "Daily habit check-in with offline recovery", object: "check-in", action: "Mark complete" },
};

const sceneKeys = [
  "id", "quality", "viewport", "state", "title", "primaryAction", "blocks",
  "appliedRuleIds", "violatedRuleIds", "asset",
] as const;

const validateScene = (
  value: unknown,
  recipeId: string,
  rulesById: Map<string, { family: string; recipeIds: string[] }>,
): ExampleScene => {
  if (!isRecord(value) || !hasOnlyKeys(value, sceneKeys)) throw new Error(`Invalid recipe example scene: ${recipeId}`);
  const qualityValid = value.quality === "good" || value.quality === "bad";
  const viewportValid = value.viewport === "desktop" || value.viewport === "mobile";
  const stateValid = value.state === "success" || value.state === "loading" || value.state === "empty" || value.state === "error";
  const blocksValid = Array.isArray(value.blocks) && value.blocks.length > 0 && value.blocks.every((block) =>
    isRecord(block) && hasOnlyKeys(block, ["kind", "label", "emphasis"]) &&
    ["heading", "copy", "action", "list", "media", "status"].includes(String(block.kind)) &&
    isNonEmptyString(block.label) && [1, 2, 3].includes(Number(block.emphasis)));
  if (
    !isNonEmptyString(value.id) || !/^[a-z0-9-]+$/.test(value.id) ||
    !qualityValid || !viewportValid || !stateValid ||
    !isNonEmptyString(value.title) || !isNonEmptyString(value.primaryAction) || !blocksValid ||
    !isStringArray(value.appliedRuleIds) || !isStringArray(value.violatedRuleIds) ||
    !isNonEmptyString(value.asset)
  ) throw new Error(`Invalid recipe example scene: ${recipeId}`);

  const expectedAsset = `assets/${value.id}.svg`;
  if (value.asset !== expectedAsset) throw new Error(`Example scene asset must match ${expectedAsset}`);
  const scene = value as unknown as ExampleScene;
  const referencedRules = [...scene.appliedRuleIds, ...scene.violatedRuleIds].map((id) => rulesById.get(id));
  if (referencedRules.some((rule) => !rule)) throw new Error(`Unknown design rule id in ${recipeId}`);
  if (scene.quality === "good") {
    const families = new Set(scene.appliedRuleIds.map((id) => rulesById.get(id)?.family));
    const incompatible = scene.appliedRuleIds.some((id) => {
      const rule = rulesById.get(id);
      return !rule || (!rule.recipeIds.includes("*") && !rule.recipeIds.includes(recipeId));
    });
    if (families.size !== 6 || incompatible || scene.violatedRuleIds.length !== 0) {
      throw new Error(`Good example scene must apply one compatible rule from every family: ${recipeId}/${scene.id}`);
    }
  } else if (new Set(scene.violatedRuleIds).size < 3) {
    throw new Error(`Bad example scene must violate at least three rules: ${recipeId}/${scene.id}`);
  }
  return scene;
};

const validatePack = (
  value: unknown,
  recipeId: string,
  rulesById: Map<string, { family: string; recipeIds: string[] }>,
): RecipeExamplePack => {
  if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "recipeId", "productScenario", "differenceExplanation", "scenes"]) ||
    value.schemaVersion !== "1.0" || value.recipeId !== recipeId ||
    value.productScenario !== scenarios[recipeId]?.scenario ||
    !isStringArray(value.differenceExplanation) || value.differenceExplanation.length < 3 ||
    !Array.isArray(value.scenes) || value.scenes.length !== 10) {
    throw new Error(`Invalid recipe example pack: ${recipeId}`);
  }
  const scenes = value.scenes.map((scene) => validateScene(scene, recipeId, rulesById));
  const combinations = scenes.map((scene) => `${scene.quality}:${scene.viewport}:${scene.state}`);
  if (new Set(combinations).size !== 10 || requiredSceneKeys.some((key) => !combinations.includes(key))) {
    throw new Error(`Invalid recipe example pack state matrix: ${recipeId}`);
  }
  const allowedLabels = new Set([
    scenarios[recipeId].object, scenarios[recipeId].action,
    "Loading", "Nothing here yet", "Try again", "Unavailable", "Permission required", "Offline",
  ]);
  if (scenes.some((scene) =>
    [scene.title, scene.primaryAction, ...scene.blocks.map(({ label }) => label)]
      .some((label) => !allowedLabels.has(label)))) {
    throw new Error(`Recipe example pack contains non-neutral scene copy: ${recipeId}`);
  }
  return { ...(value as unknown as RecipeExamplePack), scenes };
};

export const loadRecipeExamplePacks = async (
  examplesRoot = defaultExamplesRoot,
): Promise<LoadedRecipeExamplePack[]> => {
  const root = path.resolve(examplesRoot);
  const rulesById = new Map((await loadDesignRuleLibrary()).rules.map((rule) => [rule.id, rule]));
  return Promise.all(frontendRecipeIds.map(async (recipeId) => {
    const packRoot = contained(root, recipeId, "Recipe example directory");
    const sourcePath = contained(packRoot, "example.json", "Recipe example source");
    const pack = validatePack(JSON.parse(await readFile(sourcePath, "utf8")) as unknown, recipeId, rulesById);
    const sceneIds = new Set<string>();
    const scenes = pack.scenes.map((scene) => {
      if (sceneIds.has(scene.id)) throw new Error(`Duplicate example scene id in ${recipeId}: ${scene.id}`);
      sceneIds.add(scene.id);
      return {
        ...scene,
        assetPath: contained(packRoot, scene.asset, "Recipe example asset"),
      };
    });
    return { ...pack, sourcePath, scenes };
  }));
};

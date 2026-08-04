import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { defaultDomainsRoot } from "../../../paths.ts";
import { frontendRecipeIds } from "./catalog.ts";
import { loadDesignRuleLibrary } from "./library.ts";
import { designRuleFamilies } from "./library-types.ts";
import type { ExampleScene, LoadedRecipeExamplePack, RecipeExamplePack } from "./example-types.ts";

export const defaultExamplesRoot = path.join(defaultDomainsRoot, "frontend", "examples");

const contained = (root: string, relativePath: string, label: string) => {
  const resolved = path.resolve(root, relativePath);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes example pack: ${relativePath}`);
  }
  return resolved;
};

const assertNoSymlinkComponents = async (root: string, target: string, label: string) => {
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escaped example pack.`);
  }
  let current = root;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const info = await lstat(current).catch(() => undefined);
    if (info?.isSymbolicLink()) {
      throw new Error(`${label} contains a symlink component: ${path.relative(root, current)}`);
    }
  }
};

const safeContained = async (
  root: string,
  relativePath: string,
  label: string,
  requireRegularFile = false,
) => {
  const resolved = contained(root, relativePath, label);
  await assertNoSymlinkComponents(root, resolved, label);
  if (requireRegularFile) {
    const info = await lstat(resolved).catch(() => undefined);
    if (!info?.isFile()) throw new Error(`${label} must be a regular file: ${relativePath}`);
  }
  return resolved;
};

const expectedExampleAsset = (sceneId: string) => `assets/${sceneId}.svg`;

export const resolveExampleAssetPath = async (
  packRoot: string,
  scene: Pick<ExampleScene, "id" | "asset">,
  requireRegularFile = false,
) => {
  const expectedAsset = expectedExampleAsset(scene.id);
  if (scene.asset !== expectedAsset) throw new Error(`Example scene asset must match ${expectedAsset}`);
  return safeContained(packRoot, scene.asset, "Recipe example asset", requireRegularFile);
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

const explanationStopWords = new Set([
  "good", "bad", "the", "and", "a", "an", "of", "as", "to", "with", "from", "its", "their",
  "this", "that", "keep", "keeps", "preserving", "preserve", "through", "visible", "into", "one",
  "primary", "generic", "states", "state", "mobile", "desktop", "composition", "hierarchy", "roles",
  "recovery", "action", "product", "object", "meaning", "sequence", "context", "evidence", "source",
  "current", "same",
]);

const contentTokens = (value: string) => new Set(
  value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !explanationStopWords.has(token)),
);

const explanationTopics = [
  /good.*(?:hierarchy|composition).*bad/i,
  /good.*(?:state|recovery|semantic).*bad/i,
  /good.*(?:mobile|responsive|recompos).*bad/i,
] as const;

const requiredSceneKeys = [
  "good:desktop:success", "bad:desktop:success", "good:mobile:success", "bad:mobile:success",
  "good:mobile:loading", "bad:mobile:loading", "good:mobile:empty", "bad:mobile:empty",
  "good:mobile:error", "bad:mobile:error",
] as const;

const scenarios: Record<string, { scenario: string; object: string; action: string; labels?: string[] }> = {
  "operational-command-center": { scenario: "Incident queue with stale and assigned states", object: "incident", action: "Triage incident" },
  "consumer-discovery": { scenario: "Saved reading catalogue with filters", object: "title", action: "Save title" },
  "developer-tool": {
    scenario: "Repository run diagnostics", object: "run", action: "Inspect failure",
    labels: ["Run command", "Failed step", "Log evidence", "Retry run"],
  },
  "editorial-content": {
    scenario: "Sourced implementation guide", object: "section", action: "Continue reading",
    labels: ["Current section", "Guide navigation", "Source context"],
  },
  "marketing-landing": { scenario: "Product capability explanation with supplied proof slot", object: "capability", action: "Request access" },
  "saas-workspace": { scenario: "Team project task list with permissions", object: "task", action: "Update status" },
  "e-commerce": {
    scenario: "Product comparison with availability and fulfillment", object: "product", action: "Add to cart",
    labels: ["Selected variant", "Available", "Price and cart summary"],
  },
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

  if (typeof value.id !== "string" || typeof value.asset !== "string") {
    throw new Error(`Invalid recipe example scene: ${recipeId}`);
  }
  if (value.asset !== expectedExampleAsset(value.id)) {
    throw new Error(`Example scene asset must match ${expectedExampleAsset(value.id)}`);
  }
  const scene = value as unknown as ExampleScene;
  const allRuleIds = [...scene.appliedRuleIds, ...scene.violatedRuleIds];
  if (new Set(allRuleIds).size !== allRuleIds.length) {
    throw new Error(`Duplicate design rule reference in ${recipeId}/${scene.id}`);
  }
  const referencedRules = allRuleIds.map((id) => rulesById.get(id));
  if (referencedRules.some((rule) => !rule)) throw new Error(`Unknown design rule id in ${recipeId}`);
  const incompatible = allRuleIds.find((id) => {
    const rule = rulesById.get(id);
    return !rule || (!rule.recipeIds.includes("*") && !rule.recipeIds.includes(recipeId));
  });
  if (incompatible) {
    throw new Error(`Incompatible design rule reference in ${recipeId}/${scene.id}: ${incompatible}`);
  }
  if (scene.quality === "good") {
    const families = new Set(scene.appliedRuleIds.map((id) => rulesById.get(id)?.family));
    if (
      scene.appliedRuleIds.length !== designRuleFamilies.length ||
      families.size !== designRuleFamilies.length ||
      scene.violatedRuleIds.length !== 0
    ) {
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
  const differenceExplanation = isRecord(value) && isStringArray(value.differenceExplanation)
    ? value.differenceExplanation
    : undefined;
  if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "recipeId", "productScenario", "differenceExplanation", "scenes"]) ||
    value.schemaVersion !== "1.0" || value.recipeId !== recipeId ||
    value.productScenario !== scenarios[recipeId]?.scenario ||
    !differenceExplanation || differenceExplanation.length < 3 ||
    !Array.isArray(value.scenes) || value.scenes.length !== 10) {
    throw new Error(`Invalid recipe example pack: ${recipeId}`);
  }
  if (!explanationTopics.every((topic) => differenceExplanation.some((entry) => topic.test(entry)))) {
    throw new Error(`Recipe example pack must explain hierarchy, state recovery, and mobile relationships: ${recipeId}`);
  }
  const sceneIds = new Set<string>();
  for (const rawScene of value.scenes) {
    if (isRecord(rawScene) && typeof rawScene.id === "string") {
      if (sceneIds.has(rawScene.id)) throw new Error(`Duplicate example scene id in ${recipeId}: ${rawScene.id}`);
      sceneIds.add(rawScene.id);
    }
  }
  const scenes = value.scenes.map((scene) => validateScene(scene, recipeId, rulesById));
  const sceneContentTokens = contentTokens(scenes.flatMap((scene) => [
    scene.title,
    scene.primaryAction,
    ...scene.blocks.map(({ label }) => label),
  ]).join(" "));
  const evidenceBackedExplanations = differenceExplanation.filter((entry) =>
    [...contentTokens(entry)].some((token) => sceneContentTokens.has(token)),
  );
  if (evidenceBackedExplanations.length < 2) {
    throw new Error(`Recipe example pack relationship explanation must refer to supplied scene material: ${recipeId}`);
  }
  const combinations = scenes.map((scene) => `${scene.quality}:${scene.viewport}:${scene.state}`);
  if (new Set(combinations).size !== 10 || requiredSceneKeys.some((key) => !combinations.includes(key))) {
    throw new Error(`Invalid recipe example pack state matrix: ${recipeId}`);
  }
  const allowedLabels = new Set([
    scenarios[recipeId].object, scenarios[recipeId].action, ...(scenarios[recipeId].labels ?? []),
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
  options: { requireAssets?: boolean } = {},
): Promise<LoadedRecipeExamplePack[]> => {
  const requestedRoot = path.resolve(examplesRoot);
  const rootInfo = await lstat(requestedRoot).catch(() => undefined);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("Recipe examples root must be a real directory.");
  }
  const root = await realpath(requestedRoot);
  const library = await loadDesignRuleLibrary();
  const rulesById = new Map(library.rules.map((rule) => [rule.id, rule]));
  const requireAssets = options.requireAssets !== false;
  return Promise.all(frontendRecipeIds.map(async (recipeId) => {
    const packRoot = await safeContained(root, recipeId, "Recipe example directory");
    const packInfo = await lstat(packRoot).catch(() => undefined);
    if (!packInfo?.isDirectory()) throw new Error(`Recipe example directory must be a directory: ${recipeId}`);
    const sourcePath = await safeContained(packRoot, "example.json", "Recipe example source", true);
    const pack = validatePack(JSON.parse(await readFile(sourcePath, "utf8")) as unknown, recipeId, rulesById);
    const scenes = await Promise.all(pack.scenes.map(async (scene) => {
      return {
        ...scene,
        assetPath: await resolveExampleAssetPath(packRoot, scene, requireAssets),
      };
    }));
    return { ...pack, sourcePath, scenes };
  }));
};

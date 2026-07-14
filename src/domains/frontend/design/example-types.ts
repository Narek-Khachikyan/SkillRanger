export type ExampleScene = {
  id: string;
  quality: "good" | "bad";
  viewport: "desktop" | "mobile";
  state: "success" | "loading" | "empty" | "error";
  title: string;
  primaryAction: string;
  blocks: Array<{
    kind: "heading" | "copy" | "action" | "list" | "media" | "status";
    label: string;
    emphasis: 1 | 2 | 3;
  }>;
  appliedRuleIds: string[];
  violatedRuleIds: string[];
  asset: string;
};

export type RecipeExamplePack = {
  schemaVersion: "1.0";
  recipeId: string;
  productScenario: string;
  differenceExplanation: string[];
  scenes: ExampleScene[];
};

export type LoadedExampleScene = ExampleScene & { assetPath: string };
export type LoadedRecipeExamplePack = Omit<RecipeExamplePack, "scenes"> & {
  sourcePath: string;
  scenes: LoadedExampleScene[];
};

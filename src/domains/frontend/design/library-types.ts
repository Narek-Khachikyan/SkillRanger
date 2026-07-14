export type DesignRuleFamily =
  | "typography"
  | "layout"
  | "responsive"
  | "color"
  | "state"
  | "signature-move";

export type DesignRule = {
  schemaVersion: "1.0";
  id: string;
  version: "1.0.0";
  family: DesignRuleFamily;
  name: string;
  recipeIds: string[];
  preconditions: string[];
  intent: string;
  constraints: string[];
  rolesConsumed: string[];
  responsiveBehavior: string[];
  accessibility: string[];
  antiPatterns: string[];
  verification: string[];
  provenance: Array<{ source: string; reviewedAt: string }>;
};

export type DesignRuleIndex = {
  schemaVersion: "1.0";
  files: Record<DesignRuleFamily, string>;
};

export type DesignRuleLibrary = {
  index: DesignRuleIndex;
  rules: DesignRule[];
};

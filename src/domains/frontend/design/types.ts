import type { VerificationFinding, VerificationReport } from "../../../runtime/types.ts";

export type EvidenceEntry = {
  statement: string;
  source?: string;
};

export type DesignBrief = {
  schemaVersion: "1.0";
  product: {
    domain: string;
    primaryUserOrActor: string;
    primaryTask: string;
    contentTypes: string[];
    usageFrequency: "rare" | "occasional" | "frequent" | "continuous" | "unknown";
    stakes: string[];
  };
  surface: {
    type: string;
    primaryAction: string;
    supportedViewports: number[];
    requiredStates: string[];
  };
  direction: {
    requestedTone: string[];
    antiGoals: string[];
    existingDirection: string;
  };
  evidence: {
    observed: EvidenceEntry[];
    inferred: EvidenceEntry[];
    assumed: EvidenceEntry[];
    unknown: EvidenceEntry[];
  };
};

export type DesignRecipe = {
  schemaVersion: "1.0";
  id: string;
  name: string;
  appropriateWhen: string[];
  inappropriateWhen: string[];
  domainSignals: string[];
  layoutModels: string[];
  densityRange: string[];
  hierarchyStrategies: string[];
  mobileStrategy: string[];
  requiredStates: string[];
  signatureMovePatterns: string[];
  forbiddenDefaults: string[];
  validationRules: string[];
};

export type DesignDirection = {
  schemaVersion: "1.0";
  recipeId: string;
  selectedRuleIds?: string[];
  thesis: string;
  productReason: string;
  axes: {
    density: "compact" | "balanced" | "spacious" | "editorial";
    hierarchy: "action-first" | "data-first" | "narrative-first" | "exception-first";
    composition: "structured-list" | "grid" | "split-pane" | "timeline" | "table" | "editorial-grid";
    material: "flat" | "bordered" | "layered" | "tactile" | "document-like";
    motionIntensity: "none" | "low" | "medium" | "high";
    expressionLevel: "restrained" | "balanced" | "expressive";
  };
  typographyRoles: Record<string, string>;
  colorRoles: Record<string, string>;
  signatureMove: string;
  rejectedDefaults: string[];
  destructiveCritique: string;
};

export type BrowserObservation = {
  schemaVersion: "1.0";
  viewport: { width: number; height: number };
  route: string;
  state: string;
  horizontalOverflow: boolean;
  clippedControls: string[];
  unreachableActions: string[];
  stickyOverlaps: string[];
  consoleErrors: string[];
  keyboardTraps: string[];
  invisibleFocus: string[];
  criticalAxeViolations: string[];
  reducedMotionVerified: boolean;
  screenshotPath?: string;
};

export type DesignValidationResult = {
  findings: VerificationFinding[];
  report: VerificationReport;
};

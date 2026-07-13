import type { VerificationFinding } from "../../../runtime/types.ts";

export type DesignChangeMode = "repair" | "refine" | "explore" | "reimagine";
export type EffectiveDesignChangeMode = DesignChangeMode;
export type DesignCapabilityProfile = "constrained" | "standard" | "advanced";

export type DesignCapabilityConstraints = {
  id: string;
  maxVariants: 1 | 2 | 3;
  allowedRecipeIds?: string[];
  maxCompositionFreedom: "preserve" | "recipe-layouts" | "free";
  maxPrimitiveFreedom: "existing-only" | "local-variants" | "new-primitives";
  implementationStrategy: "verified-patterns-only" | "patterns-preferred" | "free";
};

export type DesignExecutionPolicy = {
  schemaVersion: "1.0";
  requestedMode: DesignChangeMode;
  effectiveMode: EffectiveDesignChangeMode;
  profile: DesignCapabilityProfile;
  capabilityClassId: string;
  downgradeReasons: string[];
  variantLimit: 1 | 2 | 3;
  recipeSelection: "top-only" | "ranked-set" | "open-with-evidence";
  allowedRecipeIds: string[];
  freedoms: {
    composition: "preserve" | "recipe-layouts" | "free";
    visualLanguage: "preserve" | "rule-bound" | "free";
    primitives: "existing-only" | "local-variants" | "new-primitives";
    tokens: "existing-only" | "role-library" | "new-role-system";
    motion: "preserve" | "bounded" | "free";
  };
  implementationStrategy: DesignCapabilityConstraints["implementationStrategy"];
  requiredRuleFamilies: Array<"typography" | "layout" | "responsive" | "color" | "state" | "signature-move">;
  structuredDirectionRequired: true;
  independentCriticRequired: true;
  repairRequired: true;
  maxRepairIterations: 1 | 2 | 3 | 4 | 5;
  requiredViewports: [390, 768, 1440];
  requiredStates: string[];
};

export type DesignChangeCategory =
  | "spacing" | "typography" | "color-role" | "responsive-layout"
  | "state-presentation" | "focus" | "motion" | "local-primitive"
  | "composition" | "copy" | "behavior";

export type ProtectedInvariant = {
  kind: "behavior" | "content" | "art-direction" | "public-api" | "state" | "accessibility" | "route";
  description: string;
};

export type RepairPassCriterion = {
  findingId: string;
  code: string;
  expected: string;
  evidenceKinds: Array<"screenshot" | "browser-check" | "mechanical-check" | "test">;
};

export type BoundedRepairRequest = {
  schemaVersion: "1.0";
  id: string;
  workflowId: string;
  targetVariantId: string;
  sourceEvidenceId: string;
  iteration: number;
  maxIterations: number;
  stopReason?: "hard-gates-passed" | "iteration-limit" | "blocked";
  findings: VerificationFinding[];
  allowedFiles: string[];
  allowedChanges: DesignChangeCategory[];
  protectedInvariants: ProtectedInvariant[];
  passCriteria: RepairPassCriterion[];
};

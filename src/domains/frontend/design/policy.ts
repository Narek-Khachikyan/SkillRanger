import type { VerificationFinding } from "../../../runtime/types.ts";
import type {
  DesignCapabilityConstraints,
  DesignCapabilityProfile,
  DesignChangeMode,
  DesignExecutionPolicy,
} from "./policy-types.ts";
import type { DesignDirection } from "./types.ts";
import { loadDesignRuleLibrarySync } from "./library.ts";

const compositionRank = { preserve: 0, "recipe-layouts": 1, free: 2 } as const;
const primitiveRank = { "existing-only": 0, "local-variants": 1, "new-primitives": 2 } as const;
const implementationStrategyRank = { "verified-patterns-only": 0, "patterns-preferred": 1, free: 2 } as const;

const strictest = <T extends string>(left: T, right: T, rank: Record<T, number>) =>
  rank[left] <= rank[right] ? left : right;

const configuredCapability: Record<DesignCapabilityProfile, DesignCapabilityConstraints> = {
  constrained: {
    id: "configured-constrained",
    maxVariants: 1,
    maxCompositionFreedom: "preserve",
    maxPrimitiveFreedom: "existing-only",
    implementationStrategy: "verified-patterns-only",
  },
  standard: {
    id: "configured-standard",
    maxVariants: 2,
    maxCompositionFreedom: "recipe-layouts",
    maxPrimitiveFreedom: "local-variants",
    implementationStrategy: "patterns-preferred",
  },
  advanced: {
    id: "configured-advanced",
    maxVariants: 3,
    maxCompositionFreedom: "free",
    maxPrimitiveFreedom: "new-primitives",
    implementationStrategy: "free",
  },
};

export const resolveDesignExecutionPolicy = (input: {
  mode: DesignChangeMode;
  profile?: DesignCapabilityProfile;
  capability?: DesignCapabilityConstraints;
  rankedRecipeIds: string[];
  requiredStates?: string[];
}): DesignExecutionPolicy => {
  if (input.rankedRecipeIds.length === 0) {
    throw new Error("policy resolution requires at least one ranked recipe");
  }

  const profile = input.profile ?? "constrained";
  const downgradeReasons: string[] = [];
  let effectiveMode = input.mode;
  if (profile === "constrained" && (input.mode === "explore" || input.mode === "reimagine")) {
    effectiveMode = "refine";
    downgradeReasons.push(`${input.mode} requires more freedom than constrained allows`);
  } else if (profile === "standard" && input.mode === "reimagine") {
    effectiveMode = "explore";
    downgradeReasons.push("reimagine requires advanced capability");
  }

  const profileVariantLimit: 1 | 2 | 3 = effectiveMode === "repair" || effectiveMode === "refine"
    ? 1
    : profile === "advanced" || profile === "standard" ? 3 : 1;
  const capability = input.capability ?? (input.profile
    ? configuredCapability[profile]
    : { ...configuredCapability.constrained, id: "unknown-constrained-default" });
  const allowedByCapability = capability.allowedRecipeIds?.filter((id) => input.rankedRecipeIds.includes(id));
  if (capability.allowedRecipeIds !== undefined && allowedByCapability?.length === 0) {
    throw new Error("capability allowedRecipeIds do not include any ranked recipe");
  }
  const recipePool = allowedByCapability ?? input.rankedRecipeIds;
  const variantLimit = Math.min(
    profileVariantLimit,
    configuredCapability[profile].maxVariants,
    capability.maxVariants,
  ) as 1 | 2 | 3;
  const profileComposition = profile === "advanced" ? "free" : profile === "standard" ? "recipe-layouts" : "preserve";
  const profilePrimitives = profile === "advanced" ? "new-primitives" : profile === "standard" ? "local-variants" : "existing-only";

  return {
    schemaVersion: "1.0",
    requestedMode: input.mode,
    effectiveMode,
    profile,
    capabilityClassId: capability.id,
    downgradeReasons,
    variantLimit,
    recipeSelection: variantLimit === 1 ? "top-only" : profile === "advanced" ? "open-with-evidence" : "ranked-set",
    allowedRecipeIds: recipePool.slice(0, variantLimit),
    freedoms: {
      composition: strictest(profileComposition, capability.maxCompositionFreedom, compositionRank),
      visualLanguage: profile === "constrained" ? "preserve" : profile === "standard" ? "rule-bound" : "free",
      primitives: strictest(profilePrimitives, capability.maxPrimitiveFreedom, primitiveRank),
      tokens: profile === "constrained" ? "existing-only" : profile === "standard" ? "role-library" : "new-role-system",
      motion: profile === "constrained" ? "preserve" : profile === "standard" ? "bounded" : "free",
    },
    implementationStrategy: strictest(
      configuredCapability[profile].implementationStrategy,
      capability.implementationStrategy,
      implementationStrategyRank,
    ),
    requiredRuleFamilies: ["typography", "layout", "responsive", "color", "state", "signature-move"],
    structuredDirectionRequired: true,
    independentCriticRequired: true,
    repairRequired: true,
    maxRepairIterations: 3,
    requiredViewports: [390, 768, 1440],
    requiredStates: [...new Set(["loading", "empty", "error", "success", ...(input.requiredStates ?? [])])],
  };
};

const finding = (input: {
  code: string;
  message: string;
  evidence: string[];
  remediation: string;
}): VerificationFinding => ({
  id: input.code,
  source: "frontend.design-policy",
  severity: "high",
  gate: "hard",
  autofixable: false,
  ...input,
});

export const validateImplementationPrerequisites = (input: {
  policy: DesignExecutionPolicy;
  directions: DesignDirection[];
  selectedRuleIds: string[];
  implementationKind: string;
}): VerificationFinding[] => {
  const findings: VerificationFinding[] = [];
  if (input.directions.length !== input.policy.variantLimit) {
    findings.push(finding({
      code: "structured-direction-missing",
      message: `Expected ${input.policy.variantLimit} structured design direction(s), received ${input.directions.length}.`,
      evidence: input.directions.map((direction) => direction.recipeId),
      remediation: "Create one structured direction for every allowed variant.",
    }));
  }

  const disallowedRecipeIds = input.directions
    .map((direction) => direction.recipeId)
    .filter((recipeId) => !input.policy.allowedRecipeIds.includes(recipeId));
  if (disallowedRecipeIds.length > 0) {
    findings.push(finding({
      code: "disallowed-recipe-selection",
      message: "A structured direction uses a recipe outside the resolved policy.",
      evidence: disallowedRecipeIds,
      remediation: "Select directions only from policy.allowedRecipeIds.",
    }));
  }

  const selectedRules = loadDesignRuleLibrarySync().rules.filter((rule) => input.selectedRuleIds.includes(rule.id));
  const selectedFamilies = new Set(selectedRules.map(({ family }) => family));
  const selectedRulesComplete = input.selectedRuleIds.length === input.policy.requiredRuleFamilies.length &&
    new Set(input.selectedRuleIds).size === input.policy.requiredRuleFamilies.length &&
    selectedRules.length === input.policy.requiredRuleFamilies.length &&
    input.policy.requiredRuleFamilies.every((family) => selectedFamilies.has(family));
  if (input.policy.implementationStrategy === "verified-patterns-only" && !selectedRulesComplete) {
    findings.push(finding({
      code: "verified-pattern-selection-missing",
      message: "Verified-patterns-only implementation requires one selected rule from every required family.",
      evidence: input.selectedRuleIds,
      remediation: "Select six unique verified rules covering typography, layout, responsive, color, state, and signature-move.",
    }));
  }
  if (input.policy.implementationStrategy === "verified-patterns-only" && input.implementationKind === "arbitrary-jsx-css") {
    findings.push(finding({
      code: "implementation-strategy-violation",
      message: "Arbitrary JSX/CSS is not allowed under the verified-patterns-only strategy.",
      evidence: [input.implementationKind],
      remediation: "Implement with the selected verified patterns.",
    }));
  }
  return findings;
};

import {
  resolveDesignExecutionPolicy,
  type DesignBrief,
  type DesignDirection,
  type DesignVariantMetadata,
  type UiCaptureEntry,
  type UiEvidenceBundle,
  type VisualCriticReport,
  type VisualRun,
} from "../../src/domains/frontend/design/index.ts";

export const makeBrief = (input: {
  requiredStates?: string[];
  supportedViewports?: number[];
} = {}): DesignBrief => ({
  schemaVersion: "1.0",
  product: {
    domain: "developer run diagnostics", primaryUserOrActor: "Repository maintainer",
    primaryTask: "Inspect a failed run", contentTypes: ["run", "log", "command"],
    usageFrequency: "frequent", stakes: [],
  },
  surface: {
    type: "developer tool", primaryAction: "Inspect failure",
    supportedViewports: input.supportedViewports ?? [390, 768, 1440],
    requiredStates: input.requiredStates ?? ["loading", "empty", "error", "success"],
  },
  direction: { requestedTone: ["clear"], antiGoals: ["generic SaaS"], existingDirection: "repository UI" },
  evidence: {
    observed: [{ statement: "The fixture contains run and log records.", source: "test fixture" }],
    inferred: [], assumed: [], unknown: [],
  },
});


export const makeBundle = (input: {
  id: string;
  variantId: string;
  sourceIdentity: string;
  captures?: UiCaptureEntry[];
}): UiEvidenceBundle => ({
  schemaVersion: "1.0",
  id: input.id,
  variantId: input.variantId,
  iteration: input.id === "e1" ? 0 : 1,
  sourceIdentity: input.sourceIdentity,
  route: "/runs",
  capturedAt: input.id === "e1" ? "2026-07-14T00:00:00Z" : "2026-07-14T00:01:00Z",
  requiredViewports: [390, 768, 1440],
  requiredStates: ["loading", "empty", "error", "success"],
  captures: input.captures ?? [390, 768, 1440].flatMap((width) =>
    ["loading", "empty", "error", "success"].map((state) => {
      const screenshotPath = `/tmp/${input.id}/${width}-${state}.png`;
      return {
        viewport: { width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 },
        state,
        screenshotPath,
        observation: {
          schemaVersion: "1.0", viewport: { width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 },
          route: "/runs", state, horizontalOverflow: false, clippedControls: [], unreachableActions: [],
          stickyOverlaps: [], consoleErrors: [], keyboardTraps: [], invisibleFocus: [],
          criticalAxeViolations: [], reducedMotionVerified: true, screenshotPath,
        },
        checks: [],
      };
    }),
  ),
  adapterCapabilities: ["browser", "screenshots"],
});

export const makeVerificationInput = (overrides: {
  initialEvidence: UiEvidenceBundle;
  recheckEvidence: UiEvidenceBundle;
}) => {
  const policy = resolveDesignExecutionPolicy({
    mode: "refine", profile: "standard", rankedRecipeIds: ["developer-tool"],
  });
  const criticReport: VisualCriticReport = {
    schemaVersion: "1.0", id: "c1", generatorActorId: "g1", criticActorId: "c1",
    candidateVariantIds: ["v1"], evidenceIds: [overrides.initialEvidence.id],
    comparisons: [{
      variantId: "v1",
      scores: {
        "product-specificity": 0.8, hierarchy: 0.8, composition: 0.8, typography: 0.8,
        "color-roles": 0.8, "state-quality": 0.8, "responsive-transformation": 0.8,
        accessibility: 0.8, "implementation-coherence": 0.8, "ai-slop-risk": 0.8,
      },
      strengths: ["The run state drives hierarchy."], weaknesses: [], aiSlopFindings: [],
    }],
    outcome: "selected", selectedVariantId: "v1", repairFindings: [], confidence: 0.8,
    residualUncertainty: [], containsImplementationCode: false,
  };
  return {
    workflowId: "frontend.design-generation",
    policy,
    visualRun: {
      schemaVersion: "1.0", id: "run-1", policyPath: ".design/execution-policy.json",
      state: "final-audited", variantIds: ["v1"], selectedVariantId: "v1",
      artifacts: {
        initialEvidenceId: overrides.initialEvidence.id, critiqueId: "c1",
        recheckEvidenceId: overrides.recheckEvidence.id,
      },
      history: [{ state: "final-audited", at: "2026-07-14T00:02:00Z" }],
    } as VisualRun,
    variant: {
      schemaVersion: "1.0", id: "v1", recipeId: "developer-tool",
      directionPath: ".design/variants/v1/direction.json", ruleIds: ["layout.list-detail"],
      createdOrder: 1, generatorActorId: "g1", implementationArtifact: "git-diff:abc",
      evidenceIds: [overrides.initialEvidence.id, overrides.recheckEvidence.id],
    } as DesignVariantMetadata,
    brief: makeBrief(),
    direction: {
      schemaVersion: "1.0", recipeId: "developer-tool", thesis: "Run state leads the diagnostic flow.",
      productReason: "Maintainers must find the failing step before copying a command.",
      axes: {
        density: "compact", hierarchy: "exception-first", composition: "split-pane",
        material: "bordered", motionIntensity: "low", expressionLevel: "restrained",
      },
      typographyRoles: { heading: "sans-semibold", body: "sans", code: "mono" },
      colorRoles: { failure: "destructive", success: "positive", surface: "background" },
      signatureMove: "The failed step anchors log and command context.",
      rejectedDefaults: ["decorative metric cards"],
      destructiveCritique: "The split pane must collapse into list-detail at 390px.",
    } as DesignDirection,
    initialEvidence: overrides.initialEvidence,
    recheckEvidence: overrides.recheckEvidence,
    criticReport,
    boundedRepairFindings: [],
    artifactExists: () => true,
  };
};

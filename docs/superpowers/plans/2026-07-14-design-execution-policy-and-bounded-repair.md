# Design Execution Policy And Bounded Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce change modes, capability profiles, structured-direction prerequisites, and measurable bounded repair without breaking current frontend design artifacts.

**Architecture:** New frontend-only policy and repair artifacts sit beside the existing strict `DesignBrief`, `DesignDirection`, `RepairRequest`, and `VerificationReport` contracts. A pure resolver combines requested mode, selected profile, empirical capability constraints, and recipe ranking by always choosing the stricter freedom. A frontend bounded-repair service wraps normalized verification findings with explicit file scopes, semantic allowances, protected invariants, and regression-aware completion checks.

**Tech Stack:** TypeScript 6, Node.js 24 built-ins, Node test runner, JSON Schema 2020-12, existing frontend design and runtime verification modules.

## Global Constraints

- Preserve schema version `1.0` compatibility for `DesignBrief`, `DesignDirection`, `RepairRequest`, and `VerificationReport`.
- Unknown capability selects `constrained`; model provider and model name are not policy inputs.
- `repair` and `refine` use exactly one direction.
- `standard` `explore` uses two or three variants; `standard` `reimagine` is downgraded to `explore`.
- `constrained` `explore` and `reimagine` are downgraded to `refine`.
- Every profile requires structured direction, independent critique, repair handling, `390/768/1440` evidence, and final verification.
- Only `advanced` may create new primitive families or free composition grammar.
- Bounded repair must reject out-of-scope files, protected-invariant changes, stale evidence, and equal-or-higher-severity regressions.
- Use TDD for every task and commit only the files listed for that task.

---

### Task 1: Canonical policy types and schemas

**Files:**
- Create: `src/domains/frontend/design/policy-types.ts`
- Create: `domains/frontend/schemas/design-execution-policy.schema.json`
- Create: `domains/frontend/schemas/bounded-repair-request.schema.json`
- Modify: `src/domains/frontend/design/index.ts`
- Modify: `domains/frontend/domain.manifest.json`
- Test: `tests/frontend-design-policy.test.ts`

**Interfaces:**
- Produces: `DesignChangeMode`, `EffectiveDesignChangeMode`, `DesignCapabilityProfile`, `DesignCapabilityConstraints`, `DesignExecutionPolicy`, `DesignChangeCategory`, `ProtectedInvariant`, `RepairPassCriterion`, and `BoundedRepairRequest`.
- Consumes: `VerificationFinding` from `src/runtime/types.ts`; no later-plan types.

- [ ] **Step 1: Write the failing type-shape and manifest tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type {
  BoundedRepairRequest,
  DesignExecutionPolicy,
} from "../src/domains/frontend/design/index.ts";

test("exports the frontend policy and bounded repair contracts", () => {
  const policy: DesignExecutionPolicy = {
    schemaVersion: "1.0",
    requestedMode: "explore",
    effectiveMode: "explore",
    profile: "standard",
    capabilityClassId: "benchmark-medium",
    downgradeReasons: [],
    variantLimit: 2,
    recipeSelection: "ranked-set",
    allowedRecipeIds: ["saas-workspace", "operational-command-center"],
    freedoms: {
      composition: "recipe-layouts",
      visualLanguage: "rule-bound",
      primitives: "local-variants",
      tokens: "role-library",
      motion: "bounded",
    },
    implementationStrategy: "patterns-preferred",
    requiredRuleFamilies: ["typography", "layout", "responsive", "color", "state", "signature-move"],
    structuredDirectionRequired: true,
    independentCriticRequired: true,
    repairRequired: true,
    maxRepairIterations: 3,
    requiredViewports: [390, 768, 1440],
    requiredStates: ["loading", "empty", "error", "success"],
  };
  assert.equal(policy.variantLimit, 2);

  const repair: BoundedRepairRequest = {
    schemaVersion: "1.0",
    id: "repair-1",
    workflowId: "frontend.design-generation",
    targetVariantId: "variant-a",
    sourceEvidenceId: "evidence-1",
    iteration: 1,
    maxIterations: 3,
    findings: [],
    allowedFiles: ["src/App.tsx"],
    allowedChanges: ["spacing"],
    protectedInvariants: [{ kind: "behavior", description: "Checkout still submits once." }],
    passCriteria: [],
  };
  assert.equal(repair.allowedChanges[0], "spacing");
});

test("publishes both schemas in the frontend domain manifest", async () => {
  const manifest = JSON.parse(await readFile("domains/frontend/domain.manifest.json", "utf8"));
  assert.ok(manifest.artifacts.schemas.includes("schemas/design-execution-policy.schema.json"));
  assert.ok(manifest.artifacts.schemas.includes("schemas/bounded-repair-request.schema.json"));
});
```

- [ ] **Step 2: Run the focused test and verify the missing-export failure**

Run: `node --test tests/frontend-design-policy.test.ts`

Expected: FAIL with `does not provide an export named 'DesignExecutionPolicy'` or a TypeScript build failure for the missing module.

- [ ] **Step 3: Define the exact policy and repair types**

```ts
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
```

Export the module from `src/domains/frontend/design/index.ts`. Add both schema paths to the manifest. The JSON schemas must set `additionalProperties: false`, require every non-optional field above, constrain viewport items with `prefixItems` constants `390`, `768`, and `1440`, and constrain `maxRepairIterations` to integers `1..5`.

- [ ] **Step 4: Run schema and type tests**

Run: `node --test tests/frontend-design-policy.test.ts && npm run build`

Expected: PASS; TypeScript accepts both example artifacts and the manifest lists both schemas.

- [ ] **Step 5: Commit the contracts**

```bash
git add src/domains/frontend/design/policy-types.ts src/domains/frontend/design/index.ts domains/frontend/schemas/design-execution-policy.schema.json domains/frontend/schemas/bounded-repair-request.schema.json domains/frontend/domain.manifest.json tests/frontend-design-policy.test.ts
git commit -m "feat(frontend): define design execution policy contracts"
```

---

### Task 2: Strict policy resolver and implementation prerequisite gate

**Files:**
- Create: `src/domains/frontend/design/policy.ts`
- Modify: `src/domains/frontend/design/index.ts`
- Test: `tests/frontend-design-policy.test.ts`
- Modify: `docs/model-capability-profiles.md`

**Interfaces:**
- Consumes: `DesignCapabilityConstraints`, `DesignChangeMode`, `DesignCapabilityProfile`, `DesignDirection`, and ranked recipe ids.
- Produces: `resolveDesignExecutionPolicy(input): DesignExecutionPolicy` and `validateImplementationPrerequisites(input): VerificationFinding[]`.

- [ ] **Step 1: Add the failing mode/profile matrix tests**

```ts
import {
  resolveDesignExecutionPolicy,
  validateImplementationPrerequisites,
} from "../src/domains/frontend/design/index.ts";

const ranked = ["saas-workspace", "operational-command-center", "developer-tool"];

test("constrained downgrades exploration and forces one recipe", () => {
  const policy = resolveDesignExecutionPolicy({ mode: "reimagine", profile: "constrained", rankedRecipeIds: ranked });
  assert.equal(policy.effectiveMode, "refine");
  assert.equal(policy.variantLimit, 1);
  assert.deepEqual(policy.allowedRecipeIds, ["saas-workspace"]);
  assert.equal(policy.implementationStrategy, "verified-patterns-only");
  assert.equal(policy.freedoms.primitives, "existing-only");
});

test("standard explores two variants but keeps repair singular", () => {
  assert.equal(resolveDesignExecutionPolicy({ mode: "explore", profile: "standard", rankedRecipeIds: ranked }).variantLimit, 2);
  assert.equal(resolveDesignExecutionPolicy({ mode: "repair", profile: "standard", rankedRecipeIds: ranked }).variantLimit, 1);
  assert.equal(resolveDesignExecutionPolicy({ mode: "reimagine", profile: "standard", rankedRecipeIds: ranked }).effectiveMode, "explore");
});

test("advanced allows free composition and new primitives", () => {
  const policy = resolveDesignExecutionPolicy({ mode: "reimagine", profile: "advanced", rankedRecipeIds: ranked });
  assert.equal(policy.effectiveMode, "reimagine");
  assert.equal(policy.freedoms.composition, "free");
  assert.equal(policy.freedoms.primitives, "new-primitives");
});

test("empirical capability constraints can only reduce freedom", () => {
  const policy = resolveDesignExecutionPolicy({
    mode: "reimagine",
    profile: "advanced",
    rankedRecipeIds: ranked,
    capability: {
      id: "unstable-sample",
      maxVariants: 1,
      allowedRecipeIds: ["developer-tool"],
      maxCompositionFreedom: "recipe-layouts",
      maxPrimitiveFreedom: "existing-only",
      implementationStrategy: "verified-patterns-only",
    },
  });
  assert.equal(policy.variantLimit, 1);
  assert.deepEqual(policy.allowedRecipeIds, ["developer-tool"]);
  assert.equal(policy.freedoms.composition, "recipe-layouts");
});

test("blocks arbitrary JSX before a direction and verified pattern selection", () => {
  const policy = resolveDesignExecutionPolicy({ mode: "refine", profile: "constrained", rankedRecipeIds: ranked });
  const findings = validateImplementationPrerequisites({
    policy,
    directions: [],
    selectedRuleIds: [],
    implementationKind: "arbitrary-jsx-css",
  });
  assert.deepEqual(findings.map(({ code }) => code), [
    "structured-direction-missing",
    "verified-pattern-selection-missing",
    "implementation-strategy-violation",
  ]);
});
```

- [ ] **Step 2: Run the matrix tests and confirm resolver imports fail**

Run: `node --test tests/frontend-design-policy.test.ts`

Expected: FAIL because `resolveDesignExecutionPolicy` and `validateImplementationPrerequisites` are not exported.

- [ ] **Step 3: Implement the deterministic resolver**

```ts
const compositionRank = { preserve: 0, "recipe-layouts": 1, free: 2 } as const;
const primitiveRank = { "existing-only": 0, "local-variants": 1, "new-primitives": 2 } as const;
const strictest = <T extends string>(left: T, right: T, rank: Record<T, number>) =>
  rank[left] <= rank[right] ? left : right;

export const resolveDesignExecutionPolicy = (input: {
  mode: DesignChangeMode;
  profile?: DesignCapabilityProfile;
  capability?: DesignCapabilityConstraints;
  rankedRecipeIds: string[];
  requiredStates?: string[];
}): DesignExecutionPolicy => {
  if (input.rankedRecipeIds.length === 0) throw new Error("policy resolution requires at least one ranked recipe");
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
  const configuredCapability: Record<DesignCapabilityProfile, DesignCapabilityConstraints> = {
    constrained: {
      id: "configured-constrained", maxVariants: 1,
      maxCompositionFreedom: "preserve", maxPrimitiveFreedom: "existing-only",
      implementationStrategy: "verified-patterns-only",
    },
    standard: {
      id: "configured-standard", maxVariants: 2,
      maxCompositionFreedom: "recipe-layouts", maxPrimitiveFreedom: "local-variants",
      implementationStrategy: "patterns-preferred",
    },
    advanced: {
      id: "configured-advanced", maxVariants: 3,
      maxCompositionFreedom: "free", maxPrimitiveFreedom: "new-primitives",
      implementationStrategy: "free",
    },
  };
  const capability = input.capability ?? (input.profile
    ? configuredCapability[profile]
    : { ...configuredCapability.constrained, id: "unknown-constrained-default" });
  const profileComposition = profile === "advanced" ? "free" : profile === "standard" ? "recipe-layouts" : "preserve";
  const profilePrimitives = profile === "advanced" ? "new-primitives" : profile === "standard" ? "local-variants" : "existing-only";
  const allowedByCapability = capability.allowedRecipeIds?.filter((id) => input.rankedRecipeIds.includes(id));
  const recipePool = allowedByCapability?.length ? allowedByCapability : input.rankedRecipeIds;
  const variantLimit = Math.min(profileVariantLimit, capability.maxVariants) as 1 | 2 | 3;

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
    implementationStrategy: capability.implementationStrategy,
    requiredRuleFamilies: ["typography", "layout", "responsive", "color", "state", "signature-move"],
    structuredDirectionRequired: true,
    independentCriticRequired: true,
    repairRequired: true,
    maxRepairIterations: 3,
    requiredViewports: [390, 768, 1440],
    requiredStates: [...new Set(["loading", "empty", "error", "success", ...(input.requiredStates ?? [])])],
  };
};
```

Implement `validateImplementationPrerequisites` as a pure function that emits hard `VerificationFinding` values from source `frontend.design-policy`: one finding when direction count differs from `variantLimit`, one when any direction uses a disallowed recipe, one when `selectedRuleIds` is empty under `verified-patterns-only`, and one when `implementationKind === "arbitrary-jsx-css"` under that strategy. Keep the exact codes used by the tests.

- [ ] **Step 4: Run focused and compatibility checks**

Run: `node --test tests/frontend-design-policy.test.ts tests/frontend-design-runtime.test.ts && npm run build`

Expected: PASS; existing frontend runtime tests remain unchanged.

- [ ] **Step 5: Document effective-mode precedence and commit**

Update `docs/model-capability-profiles.md` with the exact downgrade matrix exercised by the tests and state that capability evidence only reduces freedom.

```bash
git add src/domains/frontend/design/policy.ts src/domains/frontend/design/index.ts tests/frontend-design-policy.test.ts docs/model-capability-profiles.md
git commit -m "feat(frontend): resolve bounded design execution policy"
```

---

### Task 3: Bounded repair creation and completion validation

**Files:**
- Create: `src/domains/frontend/design/repair.ts`
- Modify: `src/domains/frontend/design/index.ts`
- Test: `tests/frontend-bounded-repair.test.ts`

**Interfaces:**
- Consumes: `DesignExecutionPolicy`, `VerificationReport`, target/evidence ids, allowed file paths, change categories, and protected invariants.
- Produces: `createBoundedRepairRequest(input): BoundedRepairRequest` and `validateBoundedRepairCompletion(input): VerificationFinding[]`.

- [ ] **Step 1: Write failing scope, criteria, regression, and stale-evidence tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  createBoundedRepairRequest,
  validateBoundedRepairCompletion,
  resolveDesignExecutionPolicy,
} from "../src/domains/frontend/design/index.ts";
import { createVerificationReport } from "../src/runtime/verification.ts";

const policy = resolveDesignExecutionPolicy({ mode: "repair", profile: "constrained", rankedRecipeIds: ["developer-tool"] });
const original = createVerificationReport({
  domain: "frontend",
  workflowId: "frontend.design-generation",
  capabilityStatus: "ready",
  executionStatus: "implemented",
  verificationStatus: "failed",
  findings: [{
    id: "overflow-1", code: "horizontal-overflow", source: "frontend.browser",
    severity: "critical", gate: "hard", message: "Table overflows at 390px.", evidence: ["#runs"],
    affectedSurface: "/runs@390:success", remediation: "Recompose the table for mobile.", autofixable: false,
  }],
});

test("creates criteria directly from normalized findings", () => {
  const request = createBoundedRepairRequest({
    id: "repair-1", policy, report: original, targetVariantId: "v1", sourceEvidenceId: "e1",
    allowedFiles: ["src/Runs.tsx"], allowedChanges: ["responsive-layout"],
    protectedInvariants: [{ kind: "behavior", description: "Run selection remains deep-linkable." }],
  });
  assert.deepEqual(request.passCriteria, [{
    findingId: "overflow-1",
    code: "horizontal-overflow",
    expected: "No critical or high horizontal-overflow finding remains on /runs@390:success.",
    evidenceKinds: ["screenshot", "browser-check"],
  }]);
});

test("rejects file scope, invariant, stale evidence, and equal-severity regressions", () => {
  const request = createBoundedRepairRequest({
    id: "repair-1", policy, report: original, targetVariantId: "v1", sourceEvidenceId: "e1",
    allowedFiles: ["src/Runs.tsx"], allowedChanges: ["responsive-layout"],
    protectedInvariants: [{ kind: "behavior", description: "Run selection remains deep-linkable." }],
  });
  const recheck = createVerificationReport({
    domain: "frontend", workflowId: "frontend.design-generation", iteration: 1,
    capabilityStatus: "ready", executionStatus: "implemented", verificationStatus: "failed",
    findings: [{
      id: "focus-1", code: "invisible-focus", source: "frontend.browser", severity: "critical", gate: "hard",
      message: "Focus disappeared.", evidence: ["button"], remediation: "Restore focus.", autofixable: false,
    }],
  });
  assert.deepEqual(validateBoundedRepairCompletion({
    request, recheckReport: recheck, recheckEvidenceId: "e1",
    changedFiles: ["src/Runs.tsx", "src/api.ts"],
    appliedChanges: ["responsive-layout", "behavior"],
    violatedInvariants: ["Run selection remains deep-linkable."],
  }).map(({ code }) => code), [
    "repair-evidence-stale", "repair-file-scope-violation", "repair-change-scope-violation",
    "repair-protected-invariant-violation", "repair-regression",
  ]);
});
```

- [ ] **Step 2: Run the repair tests and verify the missing-module failure**

Run: `node --test tests/frontend-bounded-repair.test.ts`

Expected: FAIL because the bounded repair functions are not exported.

- [ ] **Step 3: Implement normalized creation and deterministic completion checks**

```ts
const evidenceKindsFor = (code: string): RepairPassCriterion["evidenceKinds"] => {
  if (/overflow|overlap|focus|contrast|touch|keyboard|motion/.test(code)) return ["screenshot", "browser-check"];
  if (/spacing|color|radii|shadow|card|typography|measure/.test(code)) return ["screenshot", "mechanical-check"];
  return ["test"];
};

export const createBoundedRepairRequest = (input: {
  id: string;
  policy: DesignExecutionPolicy;
  report: VerificationReport;
  targetVariantId: string;
  sourceEvidenceId: string;
  allowedFiles: string[];
  allowedChanges: DesignChangeCategory[];
  protectedInvariants: ProtectedInvariant[];
}): BoundedRepairRequest => {
  const stopReason = input.report.outcome === "blocked" ? "blocked"
    : input.report.iteration >= input.policy.maxRepairIterations ? "iteration-limit"
    : undefined;
  const findings = normalizeFindings(input.report.findings);
  return {
    schemaVersion: "1.0",
    id: input.id,
    workflowId: input.report.workflowId,
    targetVariantId: input.targetVariantId,
    sourceEvidenceId: input.sourceEvidenceId,
    iteration: input.report.iteration + (stopReason ? 0 : 1),
    maxIterations: input.policy.maxRepairIterations,
    ...(stopReason ? { stopReason } : {}),
    findings,
    allowedFiles: [...new Set(input.allowedFiles)].sort(),
    allowedChanges: [...new Set(input.allowedChanges)],
    protectedInvariants: input.protectedInvariants,
    passCriteria: findings.map((finding) => ({
      findingId: finding.id,
      code: finding.code,
      expected: `No critical or high ${finding.code} finding remains on ${finding.affectedSurface ?? "global"}.`,
      evidenceKinds: evidenceKindsFor(finding.code),
    })),
  };
};
```

`validateBoundedRepairCompletion` must emit findings in this fixed order: stale evidence, file scope, semantic change scope, protected invariant, unresolved targeted finding, equal-or-higher-severity regression. Treat a finding as targeted by `id`; treat a regression as a recheck critical/high finding whose id did not exist in the source request. Return an empty array only when all criteria pass and `recheckEvidenceId !== sourceEvidenceId`.

- [ ] **Step 4: Run focused and generic repair-loop regression tests**

Run: `node --test tests/frontend-bounded-repair.test.ts tests/frontend-design-runtime.test.ts`

Expected: PASS; existing generic `createRepairRequest` and `executeRepairLoop` behavior is unchanged.

- [ ] **Step 5: Commit bounded repair**

```bash
git add src/domains/frontend/design/repair.ts src/domains/frontend/design/index.ts tests/frontend-bounded-repair.test.ts
git commit -m "feat(frontend): formalize bounded visual repair"
```

---

### Task 4: Workflow, skill profile, and repair documentation integration

**Files:**
- Modify: `domains/frontend/workflows/design-generation.workflow.json`
- Modify: `domains/frontend/workflows/design-to-code.workflow.json`
- Modify: `registry/skills/frontend.visual-design-polish/workflow.json`
- Modify: `registry/skills/frontend.tailwind-ui-polish/workflow.json`
- Modify: `registry/skills/frontend.visual-design-polish/SKILL.md`
- Modify: `registry/skills/frontend.tailwind-ui-polish/SKILL.md`
- Modify: `docs/repair-loop.md`
- Test: `tests/design-skill-contracts.test.ts`
- Test: `tests/frontend-run-policy.test.ts`

**Interfaces:**
- Consumes: policy and bounded repair artifact paths from Tasks 1–3.
- Produces: workflow ordering and skill instructions that require policy resolution before direction/implementation and bounded repair before final report.

- [ ] **Step 1: Add failing workflow-order and profile wording tests**

```ts
test("material workflows resolve policy and bounded repair explicitly", async () => {
  for (const file of [
    "domains/frontend/workflows/design-generation.workflow.json",
    "domains/frontend/workflows/design-to-code.workflow.json",
  ]) {
    const workflow = JSON.parse(await readFile(file, "utf8"));
    const ids = workflow.steps.map((step: { id: string }) => step.id);
    assert.ok(ids.indexOf("resolve-execution-policy") < ids.indexOf("define-direction"));
    assert.ok(ids.indexOf("validate-implementation-prerequisites") < ids.indexOf("implement"));
    assert.ok(ids.indexOf("bounded-repair") < ids.indexOf("report"));
  }
});

test("constrained skill profiles forbid arbitrary JSX before structured direction", async () => {
  for (const file of [
    "registry/skills/frontend.visual-design-polish/workflow.json",
    "registry/skills/frontend.tailwind-ui-polish/workflow.json",
  ]) {
    const workflow = JSON.parse(await readFile(file, "utf8"));
    assert.ok(workflow.profileInstructions.constrained.some((line: string) => line.includes("structured direction")));
    assert.ok(workflow.profileInstructions.constrained.some((line: string) => line.includes("verified patterns")));
    assert.ok(workflow.profileInstructions.constrained.some((line: string) => line.includes("mandatory corrective pass")));
  }
});
```

- [ ] **Step 2: Run contract tests and verify the new workflow ids are absent**

Run: `node --test tests/design-skill-contracts.test.ts tests/frontend-run-policy.test.ts`

Expected: FAIL on the missing `resolve-execution-policy`, `validate-implementation-prerequisites`, or `bounded-repair` step.

- [ ] **Step 3: Update workflow order and exact profile instructions**

Use this material workflow order in both domain workflows:

```json
[
  "collect-evidence",
  "validate-brief",
  "resolve-execution-policy",
  "select-recipe",
  "define-direction",
  "validate-direction",
  "validate-implementation-prerequisites",
  "implement",
  "capture-initial-evidence",
  "critique",
  "bounded-repair",
  "capture-recheck-evidence",
  "final-verify",
  "report"
]
```

For each skill workflow, use these exact constrained instructions: `Resolve one top recipe and one structured direction.`, `Implement only from existing primitives and verified patterns.`, and `Run one mandatory corrective pass followed by fresh evidence.` Standard instructions must limit exploration to `2–3` recipe-compatible variants. Advanced instructions must allow new primitives only with product evidence and destructive critique.

Update both SKILL.md files to name the four modes and state that `repair` cannot broaden art direction. Replace the generic repair paragraph in `docs/repair-loop.md` with the `BoundedRepairRequest` artifact fields and completion rules from Task 3.

- [ ] **Step 4: Run skill, domain, and release-compatible tests**

Run: `node --test tests/design-skill-contracts.test.ts tests/frontend-run-policy.test.ts tests/domain-pack.test.ts && npm run lint:skills && npm run build`

Expected: PASS with no manifest, workflow, or skill lint regression.

- [ ] **Step 5: Commit workflow integration**

```bash
git add domains/frontend/workflows registry/skills/frontend.visual-design-polish registry/skills/frontend.tailwind-ui-polish docs/repair-loop.md tests/design-skill-contracts.test.ts tests/frontend-run-policy.test.ts
git commit -m "docs(frontend): enforce policy and bounded repair workflow"
```

## Plan Verification

Run:

```bash
npm run build
node --test tests/frontend-design-policy.test.ts tests/frontend-bounded-repair.test.ts tests/frontend-design-runtime.test.ts tests/design-skill-contracts.test.ts tests/frontend-run-policy.test.ts tests/domain-pack.test.ts
npm run validate:registry
npm run lint:skills
```

Expected: every command exits `0`; constrained, standard, and advanced matrix tests pass; existing version `1.0` design/runtime tests remain green.

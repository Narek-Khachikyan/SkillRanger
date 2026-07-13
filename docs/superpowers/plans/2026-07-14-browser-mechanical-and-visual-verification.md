# Browser, Mechanical, And Visual Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture immutable UI evidence at `390px`, `768px`, and `1440px`, detect browser/accessibility/runtime/mechanical failures, and verify the complete visual correction lifecycle from fresh evidence.

**Architecture:** `UiEvidenceBundle` wraps unchanged `BrowserObservation` records with richer locator-backed checks and mechanical snapshots. A capture planner expands every required state across the fixed viewport matrix, while a refactored safe adapter runner supplies raw JSON to both legacy observations and new evidence capture. Pure mechanical evaluators convert measurements into deterministic findings. Final visual verification validates artifact identity, matrix completeness, critic/repair ordering, regressions, and hard gates before delegating outcome calculation to the existing verification runtime.

**Tech Stack:** TypeScript 6, Node.js 24 `child_process`/filesystem/crypto built-ins, Node test runner, JSON Schema 2020-12, host-supplied browser adapter.

## Global Constraints

- Preserve `BrowserObservation` and `VerificationReport` schema version `1.0`.
- New material captures always require widths `390`, `768`, and `1440`.
- Baseline states are `loading`, `empty`, `error`, and `success`; recipe-specific states are additive.
- Do not treat `overflow-x-hidden` as evidence that overflow is fixed.
- Every finding must include viewport, state, locator or affected surface, measured value when applicable, expected rule, and remediation.
- Console errors, keyboard traps, invisible focus, critical contrast, critical accessibility, overlap, unreachable actions, and reduced-motion failures are hard gates.
- Mechanical checks are deterministic candidate checks; subjective taste remains the critic's responsibility.
- Browser adapters run through `spawn` with `shell: false`, contained output paths, timeouts, and one JSON object per capture.
- Recheck evidence must reference the selected variant and a source identity newer than or different from initial evidence.
- Use TDD for every task and commit only the files listed for that task.

---

### Task 1: UI evidence bundle and fixed capture matrix

**Files:**
- Create: `src/domains/frontend/design/evidence-types.ts`
- Create: `src/domains/frontend/design/evidence-plan.ts`
- Create: `domains/frontend/schemas/ui-evidence-bundle.schema.json`
- Modify: `src/domains/frontend/design/index.ts`
- Modify: `domains/frontend/domain.manifest.json`
- Create: `tests/helpers/frontend-visual-fixtures.ts`
- Test: `tests/frontend-ui-evidence.test.ts`

**Interfaces:**
- Produces: `UiCheckCode`, `UiCheckResult`, `MechanicalSnapshot`, `UiCaptureEntry`, `UiEvidenceBundle`, `UiEvidenceCapturePlan`, and `createUiEvidenceCapturePlan(input)`.
- Consumes: `DesignBrief`, `DesignExecutionPolicy`, variant id, route, base URL, and output directory.

- [ ] **Step 1: Write failing matrix, baseline-state, and contained-path tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  createUiEvidenceCapturePlan,
  resolveDesignExecutionPolicy,
} from "../src/domains/frontend/design/index.ts";
import { makeBrief } from "./helpers/frontend-visual-fixtures.ts";

const brief = makeBrief({ requiredStates: ["success", "offline"], supportedViewports: [390, 1440] });
const policy = resolveDesignExecutionPolicy({
  mode: "refine", profile: "standard", rankedRecipeIds: ["mobile-consumer-app"], requiredStates: brief.surface.requiredStates,
});

test("expands the fixed viewport and baseline-state matrix", () => {
  const plan = createUiEvidenceCapturePlan({
    evidenceId: "evidence-1", brief, policy, variantId: "v1",
    sourceIdentity: "git:abc", baseUrl: "http://127.0.0.1:3000", route: "/app", outputDir: ".design/evidence/evidence-1",
  });
  assert.deepEqual([...new Set(plan.entries.map(({ viewport }) => viewport.width))], [390, 768, 1440]);
  assert.deepEqual([...new Set(plan.entries.map(({ state }) => state))], ["loading", "empty", "error", "success", "offline"]);
  assert.equal(plan.entries.length, 15);
  assert.ok(plan.entries.every(({ screenshotPath }) => path.resolve(screenshotPath).startsWith(path.resolve(plan.outputDir) + path.sep)));
});

test("rejects unsafe evidence and variant ids", () => {
  assert.throws(() => createUiEvidenceCapturePlan({
    evidenceId: "../escape", brief, policy, variantId: "v1", sourceIdentity: "git:abc",
    baseUrl: "http://127.0.0.1:3000", route: "/", outputDir: ".design/evidence",
  }), /safe path segment/);
});
```

Define `makeBrief` as a complete `DesignBrief`; use neutral product facts and no unknown evidence.

Create the helper with this exact implementation:

```ts
import type { DesignBrief } from "../../src/domains/frontend/design/index.ts";

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
```

- [ ] **Step 2: Run the test and verify the evidence module is missing**

Run: `node --test tests/frontend-ui-evidence.test.ts`

Expected: FAIL on the missing `createUiEvidenceCapturePlan` export.

- [ ] **Step 3: Define evidence types and plan creation**

```ts
export type UiCheckCode =
  | "horizontal-overflow" | "clipped-content" | "element-overlap" | "sticky-overlap"
  | "console-error" | "unreachable-action" | "keyboard-trap" | "focus-order"
  | "invisible-focus" | "contrast" | "critical-axe" | "reduced-motion"
  | "state-not-rendered" | "inconsistent-spacing" | "random-color"
  | "excessive-radii" | "excessive-shadows" | "generic-card-repetition"
  | "weak-typography-hierarchy" | "text-measure" | "touch-target";

export type UiCheckResult = {
  code: UiCheckCode;
  severity: "critical" | "high" | "medium" | "low";
  gate: "hard" | "soft";
  viewport: number;
  state: string;
  locator: string;
  measured?: string;
  expected: string;
  evidence: string[];
  remediation: string;
};

export type MechanicalSnapshot = {
  spacingContexts: Array<{ id: string; locators: string[]; valuesPx: number[] }>;
  colors: Array<{ locator: string; value: string; role?: string; occurrences: number }>;
  radii: Array<{ locator: string; valuePx: number; isPillOrCircle: boolean }>;
  shadows: Array<{ locator: string; value: string; isNone: boolean }>;
  cards: Array<{ locator: string; depth: number; repeatedCount: number; semanticRole: "generic" | "group" | "tool" | "item" }>;
  typography: Array<{ locator: string; role: "h1" | "h2" | "h3" | "body" | "meta"; fontSizePx: number; fontWeight: number }>;
  textBlocks: Array<{ locator: string; measureCh: number }>;
  touchTargets: Array<{ locator: string; widthPx: number; heightPx: number; interactive: boolean }>;
};

export type UiCaptureEntry = {
  viewport: { width: number; height: number };
  state: string;
  screenshotPath: string;
  observation: BrowserObservation;
  checks: UiCheckResult[];
};

export type UiEvidenceBundle = {
  schemaVersion: "1.0";
  id: string;
  variantId: string;
  iteration: number;
  sourceIdentity: string;
  route: string;
  capturedAt: string;
  requiredViewports: [390, 768, 1440];
  requiredStates: string[];
  captures: UiCaptureEntry[];
  adapterCapabilities: string[];
};
```

`UiEvidenceCapturePlan` contains the same identity fields plus `baseUrl`, absolute `outputDir`, and entries without observation/check results. Use viewport heights `844`, `1024`, and `900`. Normalize state order to baseline states first and recipe states after them. Require evidence and variant ids to match `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`.

- [ ] **Step 4: Run focused, schema, and compatibility tests**

Run: `node --test tests/frontend-ui-evidence.test.ts tests/frontend-design-runtime.test.ts tests/domain-pack.test.ts && npm run build`

Expected: PASS; old two-viewport briefs remain valid, while the new capture plan always expands to three viewports.

- [ ] **Step 5: Commit the evidence contract**

```bash
git add src/domains/frontend/design/evidence-types.ts src/domains/frontend/design/evidence-plan.ts src/domains/frontend/design/index.ts domains/frontend/schemas/ui-evidence-bundle.schema.json domains/frontend/domain.manifest.json tests/helpers/frontend-visual-fixtures.ts tests/frontend-ui-evidence.test.ts
git commit -m "feat(frontend): define immutable UI evidence bundles"
```

---

### Task 2: Deterministic browser and mechanical check evaluator

**Files:**
- Create: `src/domains/frontend/design/mechanical.ts`
- Create: `src/domains/frontend/design/browser-checks.ts`
- Modify: `src/domains/frontend/design/index.ts`
- Test: `tests/frontend-mechanical-checks.test.ts`

**Interfaces:**
- Produces: `MechanicalCheckPolicy`, `defaultMechanicalCheckPolicy`, `evaluateMechanicalSnapshot(input): UiCheckResult[]`, and `evaluateBrowserPayload(input): UiCheckResult[]`.
- Consumes: raw adapter arrays/measurements, `MechanicalSnapshot`, viewport, state, and screenshot path.

- [ ] **Step 1: Write failing tests for every requested mechanical check**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultMechanicalCheckPolicy,
  evaluateMechanicalSnapshot,
} from "../src/domains/frontend/design/index.ts";

test("reports spacing, colors, radii, shadows, cards, typography, measure, and targets", () => {
  const checks = evaluateMechanicalSnapshot({
    snapshot: {
      spacingContexts: [{ id: "toolbar", locators: ["#a", "#b", "#c"], valuesPx: [8, 13, 24] }],
      colors: [{ locator: "#badge", value: "#12ab34", occurrences: 1 }],
      radii: [0, 4, 8, 12, 16].map((valuePx, i) => ({ locator: `#r${i}`, valuePx, isPillOrCircle: false })),
      shadows: ["a", "b", "c", "d"].map((value, i) => ({ locator: `#s${i}`, value, isNone: false })),
      cards: [{ locator: ".card", depth: 2, repeatedCount: 6, semanticRole: "generic" }],
      typography: [
        { locator: "h1", role: "h1", fontSizePx: 24, fontWeight: 600 },
        { locator: "h2", role: "h2", fontSizePx: 24, fontWeight: 600 },
        { locator: "p", role: "body", fontSizePx: 16, fontWeight: 400 },
      ],
      textBlocks: [{ locator: "article p", measureCh: 92 }],
      touchTargets: [{ locator: "button.icon", widthPx: 28, heightPx: 28, interactive: true }],
    },
    policy: defaultMechanicalCheckPolicy,
    viewport: 390,
    state: "success",
    screenshotPath: "390-success.png",
  });
  assert.deepEqual([...new Set(checks.map(({ code }) => code)].sort(), [
    "excessive-radii", "excessive-shadows", "generic-card-repetition", "inconsistent-spacing",
    "random-color", "text-measure", "touch-target", "weak-typography-hierarchy",
  ]);
});
```

Add a second test for `evaluateBrowserPayload` with one value in each of: `overlaps`, `consoleErrors`, `keyboardTraps`, `focusOrderViolations`, `invisibleFocus`, `contrastViolations`, `criticalAxeViolations`, `unreachableActions`, `clippedControls`, and `stateRendered: false`, plus `reducedMotionVerified: false`. Assert the corresponding exact `UiCheckCode` set.

- [ ] **Step 2: Run the tests and verify evaluator imports fail**

Run: `node --test tests/frontend-mechanical-checks.test.ts`

Expected: FAIL because mechanical and browser evaluators do not exist.

- [ ] **Step 3: Implement exact mechanical thresholds**

```ts
export const defaultMechanicalCheckPolicy = {
  spacingScalePx: [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96],
  maxSpacingValuesPerContext: 2,
  maxUnroledOneOffColors: 0,
  maxRadiusValues: 3,
  maxShadowValues: 3,
  maxTextMeasureCh: 75,
  minTouchTargetPx: 44,
  minHeadingScaleRatio: 1.2,
  normalTextContrast: 4.5,
  largeTextContrast: 3,
} as const;
```

Rules:

- `inconsistent-spacing`: a context has more than two unique values or any value is outside `spacingScalePx`.
- `random-color`: `role` is absent and `occurrences === 1`.
- `excessive-radii`: more than three distinct non-pill radius values.
- `excessive-shadows`: more than three distinct non-none shadows.
- `generic-card-repetition`: `semanticRole === "generic"` and either `depth > 1` or `repeatedCount >= 4`.
- `weak-typography-hierarchy`: adjacent present heading roles fail `larger/smaller >= 1.2`; equal h1/h2 sizes fail.
- `text-measure`: `measureCh > 75`.
- `touch-target`: interactive width or height is below `44`.
- `contrast`: ratio below `4.5`, or below `3` when the adapter marks text as large.

Every result uses screenshot path plus locator as evidence. Mechanical results are soft at medium severity except touch target and contrast, which are high hard findings. Browser runtime, focus, keyboard, overlap, reachability, state-rendering, and reduced-motion results are high/critical hard findings.

- [ ] **Step 4: Run evaluator and design-validation regression tests**

Run: `node --test tests/frontend-mechanical-checks.test.ts tests/frontend-design-runtime.test.ts && npm run build`

Expected: PASS with deterministic ordering by severity, code, then locator.

- [ ] **Step 5: Commit deterministic checks**

```bash
git add src/domains/frontend/design/mechanical.ts src/domains/frontend/design/browser-checks.ts src/domains/frontend/design/index.ts tests/frontend-mechanical-checks.test.ts
git commit -m "feat(frontend): add browser and mechanical design checks"
```

---

### Task 3: Safe extended adapter execution and evidence persistence

**Files:**
- Create: `src/domains/frontend/design/adapter.ts`
- Create: `src/domains/frontend/design/evidence.ts`
- Modify: `src/domains/frontend/design/browser.ts`
- Modify: `src/domains/frontend/design/index.ts`
- Modify: `docs/browser-adapter.md`
- Test: `tests/frontend-ui-evidence.test.ts`
- Test: `tests/frontend-design-runtime.test.ts`

**Interfaces:**
- Produces: `parseAdapterCommandTemplate(template)`, `executeAdapterJson(input)`, and `executeUiEvidenceCapture(input): Promise<UiEvidenceBundle>`.
- Consumes: `UiEvidenceCapturePlan`, command template, project root, timeout, raw adapter JSON, browser/mechanical evaluators.

- [ ] **Step 1: Add failing adapter, persistence, screenshot, and idempotency tests**

```ts
test("captures observations and extended mechanical evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-evidence-"));
  const adapter = path.join(root, "adapter.mjs");
  const adapterFixtureSource = `
    import { mkdir, writeFile } from "node:fs/promises";
    import path from "node:path";
    const [width, state, screenshotPath] = process.argv.slice(2);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    process.stdout.write(JSON.stringify({
      horizontalOverflow: false,
      clippedControls: [], unreachableActions: [], stickyOverlaps: [], consoleErrors: [],
      keyboardTraps: [], invisibleFocus: [], criticalAxeViolations: [], reducedMotionVerified: true,
      stateRendered: true, overlaps: [], focusOrderViolations: [], contrastViolations: [],
      mechanicalSnapshot: {
        spacingContexts: [], colors: [], radii: [], shadows: [], cards: [], typography: [], textBlocks: [],
        touchTargets: [{ locator: "button.icon", widthPx: 28, heightPx: 28, interactive: true }],
      },
      width: Number(width), state,
    }));
  `;
  await writeFile(adapter, adapterFixtureSource);
  const plan = createUiEvidenceCapturePlan({
    evidenceId: "e1", brief: makeBrief({ requiredStates: ["success"] }), policy,
    variantId: "v1", sourceIdentity: "git:abc", baseUrl: "http://127.0.0.1:3000",
    route: "/", outputDir: path.join(root, "e1"),
  });
  const bundle = await executeUiEvidenceCapture({
    plan,
    commandTemplate: `node ${adapter} "{{width}}" "{{state}}" "{{screenshotPath}}"`,
    projectRoot: root,
  });
  assert.equal(bundle.captures.length, 12);
  assert.ok(bundle.captures.every(({ screenshotPath }) => existsSync(screenshotPath)));
  assert.ok(bundle.captures.some(({ checks }) => checks.some(({ code }) => code === "touch-target")));
  await assert.rejects(() => executeUiEvidenceCapture({ plan, commandTemplate: `node ${adapter}`, projectRoot: root }), /already exists/);
});
```

- [ ] **Step 2: Run evidence tests and verify the executor is missing**

Run: `node --test tests/frontend-ui-evidence.test.ts`

Expected: FAIL because `executeUiEvidenceCapture` is not exported.

- [ ] **Step 3: Extract safe adapter execution and build bundles**

Move the existing quote-aware command parser and `spawn(..., { shell: false })` runner from `browser.ts` into `adapter.ts`. Keep existing error messages for legacy tests. Export only:

```ts
export const executeAdapterJson = async (input: {
  commandTemplate: string;
  replacements: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
}): Promise<unknown>;
```

`executeUiEvidenceCapture` must preflight every screenshot path, reject existing output, create parent directories, invoke once per plan entry, validate all legacy fields, evaluate extended browser/mechanical payloads, confirm each screenshot is a non-empty file, and atomically write `<outputDir>/bundle.json`. Set `capturedAt` once after the final successful capture. On adapter failure, do not write `bundle.json`; retain already-created screenshots for diagnosis and report their paths in the thrown error.

- [ ] **Step 4: Update the adapter contract and run compatibility tests**

Document these required legacy fields: `horizontalOverflow`, `clippedControls`, `unreachableActions`, `stickyOverlaps`, `consoleErrors`, `keyboardTraps`, `invisibleFocus`, `criticalAxeViolations`, and `reducedMotionVerified`. Document these new fields: `stateRendered`, `overlaps`, `focusOrderViolations`, `contrastViolations`, and `mechanicalSnapshot` with the exact Task 1 types. State that adapters must exercise sequential Tab/Shift+Tab/Escape navigation and reduced-motion media emulation.

Run: `node --test tests/frontend-ui-evidence.test.ts tests/frontend-design-runtime.test.ts && npm run build`

Expected: PASS; existing `executeBrowserObservationPlan` tests keep their current behavior.

- [ ] **Step 5: Commit evidence capture**

```bash
git add src/domains/frontend/design/adapter.ts src/domains/frontend/design/evidence.ts src/domains/frontend/design/browser.ts src/domains/frontend/design/index.ts docs/browser-adapter.md tests/frontend-ui-evidence.test.ts tests/frontend-design-runtime.test.ts
git commit -m "feat(frontend): capture extended UI evidence safely"
```

---

### Task 4: Regression-aware final visual verification

**Files:**
- Create: `src/domains/frontend/design/visual-verification.ts`
- Modify: `src/domains/frontend/design/index.ts`
- Modify: `docs/verification-engine.md`
- Modify: `tests/helpers/frontend-visual-fixtures.ts`
- Test: `tests/frontend-visual-verification.test.ts`

**Interfaces:**
- Produces: `verifyVisualResult(input): DesignValidationResult`.
- Consumes: `DesignExecutionPolicy`, `VisualRun`, selected `DesignVariantMetadata`, initial/recheck `UiEvidenceBundle`, `VisualCriticReport`, optional `BoundedRepairRequest`, bounded-repair completion findings, `DesignBrief`, and `DesignDirection`.

- [ ] **Step 1: Write failing lifecycle, identity, matrix, and success tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { verifyVisualResult } from "../src/domains/frontend/design/index.ts";
import { makeBundle, makeVerificationInput } from "./helpers/frontend-visual-fixtures.ts";

test("fails stale, incomplete, or mismatched evidence", () => {
  const result = verifyVisualResult(makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:abc" }),
    recheckEvidence: makeBundle({ id: "e1", variantId: "v2", sourceIdentity: "git:abc", captures: [] }),
  }));
  assert.deepEqual(result.findings.map(({ code }) => code), [
    "visual-evidence-stale",
    "visual-variant-evidence-mismatch",
    "visual-evidence-source-stale",
    "visual-evidence-matrix-incomplete",
  ]);
  assert.equal(result.report.outcome, "failed");
});

test("verifies only a complete fresh correction cycle", () => {
  const result = verifyVisualResult(makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:abc" }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:def" }),
  }));
  assert.equal(result.findings.length, 0);
  assert.equal(result.report.outcome, "verified");
  assert.equal(result.report.evidence.filter(({ kind }) => kind === "screenshot").length, 12);
});
```

Extend `tests/helpers/frontend-visual-fixtures.ts` with these deterministic bundle and verifier-input builders:

```ts
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
```

Import the referenced types and `resolveDesignExecutionPolicy` from `src/domains/frontend/design/index.ts` at the top of the helper.

- [ ] **Step 2: Run the test and verify final verifier is absent**

Run: `node --test tests/frontend-visual-verification.test.ts`

Expected: FAIL because `verifyVisualResult` is not exported.

- [ ] **Step 3: Implement artifact identity, matrix, repair, and gate validation**

`verifyVisualResult` accepts an optional `artifactExists(path): boolean` test seam and must emit findings in this stable order:

1. run state is not `final-audited`;
2. selected variant mismatch;
3. critic actor is not independent or critic did not select the variant;
4. initial/recheck evidence id is equal;
5. evidence variant mismatch;
6. recheck source identity equals initial source identity;
7. required viewport/state capture missing;
8. screenshot missing/non-empty check failure;
9. bounded repair completion findings;
10. recheck `UiCheckResult` converted to `VerificationFinding`.

Call existing `validateDesignBrief` and `validateDesignDirection` first, then the checks above. Use `createVerificationReport` with `capabilityStatus: "ready"` only when both `browser` and `screenshots` adapter capabilities are present; otherwise use `degraded`. Set `verificationStatus: "passed"` only when no critical/high hard finding remains. Include recheck screenshots, critique id, repair id, and both evidence bundle paths in `report.evidence`.

- [ ] **Step 4: Run final verification and legacy validation tests**

Run: `node --test tests/frontend-visual-verification.test.ts tests/frontend-design-runtime.test.ts tests/frontend-bounded-repair.test.ts tests/frontend-visual-loop.test.ts && npm run build`

Expected: PASS; legacy `validateDesignResult` stays available while material workflows can use the stricter verifier.

- [ ] **Step 5: Commit final visual verification**

```bash
git add src/domains/frontend/design/visual-verification.ts src/domains/frontend/design/index.ts docs/verification-engine.md tests/helpers/frontend-visual-fixtures.ts tests/frontend-visual-verification.test.ts
git commit -m "feat(frontend): verify complete visual correction evidence"
```

## Plan Verification

Run:

```bash
npm run build
node --test tests/frontend-ui-evidence.test.ts tests/frontend-mechanical-checks.test.ts tests/frontend-visual-verification.test.ts tests/frontend-design-runtime.test.ts tests/frontend-bounded-repair.test.ts tests/frontend-visual-loop.test.ts
npm run validate:registry
```

Expected: every command exits `0`; the full `390/768/1440 × loading/empty/error/success` matrix is enforced and every requested browser/mechanical condition has deterministic coverage.

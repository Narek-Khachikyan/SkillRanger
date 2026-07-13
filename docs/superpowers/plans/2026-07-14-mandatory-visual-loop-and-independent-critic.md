# Mandatory Visual Loop And Independent Critic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require initial rendering, independent comparison/critique, bounded repair handling, fresh recheck evidence, and final audit for every material visual run.

**Architecture:** A frontend visual-run state machine persists only immutable artifact references and validates every transition. Variant metadata wraps current `DesignDirection` files without changing their schema. A critic boundary creates a code-free comparison input and validates an independently produced structured report, including explicit AI-slop findings and winner selection. SkillRanger validates and orchestrates the critic contract; the host supplies the independent model invocation.

**Tech Stack:** TypeScript 6, Node.js 24 built-ins, Node test runner, JSON Schema 2020-12, existing skill-run and frontend verification types.

## Global Constraints

- Preserve `DesignDirection` schema version `1.0`; store variant metadata separately.
- The generator and critic actor ids must differ.
- The critic may read directions and evidence but may not emit JSX, CSS, HTML, diffs, shell commands, source edits, or implementation artifacts.
- `repair` and `refine` use one selected variant; `explore` and effective `reimagine` use the policy's two-or-three variant limit.
- A selected variant must belong to the compared candidate set.
- AI-slop findings require a code, affected variant, evidence reference, severity, and explanation.
- `constrained` always enters `repair-requested`; `no-repair-needed` is available only to `standard` and `advanced` with zero critic repair findings.
- Initial and recheck evidence ids must differ before final audit.
- Invalid transitions and stale artifact references do not mutate the stored visual run.
- Use TDD for every task and commit only the files listed for that task.

---

### Task 1: Variant, critic, and visual-run contracts

**Files:**
- Create: `src/domains/frontend/design/visual-loop-types.ts`
- Create: `domains/frontend/schemas/design-variant.schema.json`
- Create: `domains/frontend/schemas/visual-critic-report.schema.json`
- Create: `domains/frontend/schemas/visual-run.schema.json`
- Modify: `src/domains/frontend/design/index.ts`
- Modify: `domains/frontend/domain.manifest.json`
- Test: `tests/frontend-visual-loop.test.ts`

**Interfaces:**
- Produces: `DesignVariantMetadata`, `VisualRunState`, `VisualRun`, `VisualRunEvent`, `VisualCriterion`, `AiSlopCode`, `VisualCriticInput`, `VisualCriticReport`, and `VariantComparisonResult`.
- Consumes: `DesignExecutionPolicy`, `VerificationFinding`, and current artifact ids/paths.

- [ ] **Step 1: Write the failing contract and manifest tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type {
  DesignVariantMetadata,
  VisualCriticReport,
  VisualRun,
} from "../src/domains/frontend/design/index.ts";

test("exports immutable visual orchestration artifacts", () => {
  const variant: DesignVariantMetadata = {
    schemaVersion: "1.0",
    id: "variant-a",
    recipeId: "saas-workspace",
    directionPath: ".design/variants/variant-a/direction.json",
    ruleIds: ["layout.list-detail", "state.recovery-first"],
    createdOrder: 1,
    generatorActorId: "generator-1",
    implementationArtifact: "git-diff:abc",
    evidenceIds: ["evidence-initial-a"],
  };
  const run: VisualRun = {
    schemaVersion: "1.0",
    id: "visual-run-1",
    policyPath: ".design/execution-policy.json",
    state: "implemented",
    variantIds: [variant.id],
    artifacts: {},
    history: [{ state: "policy-resolved", at: "2026-07-14T00:00:00.000Z" }],
  };
  assert.equal(run.state, "implemented");
});

test("publishes visual variant, critic, and run schemas", async () => {
  const manifest = JSON.parse(await readFile("domains/frontend/domain.manifest.json", "utf8"));
  for (const file of ["design-variant", "visual-critic-report", "visual-run"]) {
    assert.ok(manifest.artifacts.schemas.includes(`schemas/${file}.schema.json`));
  }
});
```

- [ ] **Step 2: Run the contract test and verify missing exports**

Run: `node --test tests/frontend-visual-loop.test.ts`

Expected: FAIL because `visual-loop-types.ts` and its exports do not exist.

- [ ] **Step 3: Define the exact orchestration types**

```ts
import type { VerificationFinding } from "../../../runtime/types.ts";

export type DesignVariantMetadata = {
  schemaVersion: "1.0";
  id: string;
  recipeId: string;
  directionPath: string;
  ruleIds: string[];
  createdOrder: number;
  generatorActorId: string;
  implementationArtifact?: string;
  evidenceIds: string[];
};

export type VisualRunState =
  | "policy-resolved" | "directions-valid" | "implemented"
  | "initial-evidence-captured" | "critiqued"
  | "repair-requested" | "no-repair-needed" | "repaired"
  | "recheck-evidence-captured" | "final-audited" | "verified"
  | "failed" | "blocked";

export type VisualRun = {
  schemaVersion: "1.0";
  id: string;
  policyPath: string;
  state: VisualRunState;
  variantIds: string[];
  selectedVariantId?: string;
  artifacts: {
    initialEvidenceId?: string;
    critiqueId?: string;
    repairId?: string;
    recheckEvidenceId?: string;
    verificationReportPath?: string;
  };
  history: Array<{ state: VisualRunState; at: string; eventId?: string }>;
};

export type VisualCriterion =
  | "product-specificity" | "hierarchy" | "composition" | "typography"
  | "color-roles" | "state-quality" | "responsive-transformation"
  | "accessibility" | "implementation-coherence" | "ai-slop-risk";

export type AiSlopCode =
  | "generic-hero-copy" | "interchangeable-saas-layout" | "excessive-generic-cards"
  | "meaningless-effects" | "invented-proof" | "repeated-icon-grid"
  | "arbitrary-radii-shadows" | "weak-hierarchy" | "meaningless-decoration";

export type VisualCriticInput = {
  schemaVersion: "1.0";
  generatorActorId: string;
  criticActorId: string;
  policyId: string;
  candidates: Array<{
    variantId: string;
    directionPath: string;
    evidenceId: string;
    screenshotPaths: string[];
  }>;
};

export type VisualCriticReport = {
  schemaVersion: "1.0";
  id: string;
  generatorActorId: string;
  criticActorId: string;
  candidateVariantIds: string[];
  evidenceIds: string[];
  comparisons: Array<{
    variantId: string;
    scores: Record<VisualCriterion, number>;
    strengths: string[];
    weaknesses: string[];
    aiSlopFindings: Array<{
      code: AiSlopCode;
      severity: "critical" | "high" | "medium" | "low";
      evidence: string;
      explanation: string;
    }>;
  }>;
  outcome: "selected" | "no-acceptable-variant";
  selectedVariantId?: string;
  repairFindings: VerificationFinding[];
  confidence: number;
  residualUncertainty: string[];
  containsImplementationCode: false;
};

export type VariantComparisonResult = {
  ok: boolean;
  selectedVariantId?: string;
  findings: VerificationFinding[];
  report?: VisualCriticReport;
};
```

Define `VisualRunEvent` as a discriminated union with one event per non-terminal transition. Every event contains `id` and `at`; evidence, critique, repair, and verification events also contain their artifact id/path. The schemas must use `additionalProperties: false`, score bounds `0..1`, confidence bounds `0..1`, and unique candidate/evidence arrays.

- [ ] **Step 4: Run type, schema-path, and build checks**

Run: `node --test tests/frontend-visual-loop.test.ts tests/domain-pack.test.ts && npm run build`

Expected: PASS with all three new schemas listed by the domain pack.

- [ ] **Step 5: Commit visual contracts**

```bash
git add src/domains/frontend/design/visual-loop-types.ts src/domains/frontend/design/index.ts domains/frontend/schemas/design-variant.schema.json domains/frontend/schemas/visual-critic-report.schema.json domains/frontend/schemas/visual-run.schema.json domains/frontend/domain.manifest.json tests/frontend-visual-loop.test.ts
git commit -m "feat(frontend): define visual loop and critic contracts"
```

---

### Task 2: Deterministic visual-run state machine

**Files:**
- Create: `src/domains/frontend/design/visual-loop.ts`
- Modify: `src/domains/frontend/design/index.ts`
- Test: `tests/frontend-visual-loop.test.ts`

**Interfaces:**
- Consumes: `VisualRun`, `VisualRunEvent`, and `DesignExecutionPolicy`.
- Produces: `createVisualRun(input): VisualRun`, `applyVisualRunEvent(run, event, policy): VisualRun`, and `allowedVisualRunEvents(state): string[]`.

- [ ] **Step 1: Add failing valid-path, skipped-stage, constrained-repair, and stale-evidence tests**

```ts
import {
  applyVisualRunEvent,
  createVisualRun,
  resolveDesignExecutionPolicy,
} from "../src/domains/frontend/design/index.ts";

const constrained = resolveDesignExecutionPolicy({ mode: "refine", profile: "constrained", rankedRecipeIds: ["developer-tool"] });
const standard = resolveDesignExecutionPolicy({ mode: "explore", profile: "standard", rankedRecipeIds: ["saas-workspace", "developer-tool"] });

test("requires the complete visual correction path", () => {
  let run = createVisualRun({ id: "run-1", policyPath: ".design/execution-policy.json" });
  run = applyVisualRunEvent(run, { type: "directions-validated", id: "1", at: "2026-07-14T00:00:01Z", variantIds: ["v1"] }, constrained);
  run = applyVisualRunEvent(run, { type: "implementation-recorded", id: "2", at: "2026-07-14T00:00:02Z" }, constrained);
  run = applyVisualRunEvent(run, { type: "initial-evidence-recorded", id: "3", at: "2026-07-14T00:00:03Z", evidenceId: "e1" }, constrained);
  run = applyVisualRunEvent(run, { type: "critique-recorded", id: "4", at: "2026-07-14T00:00:04Z", critiqueId: "c1", selectedVariantId: "v1", repairFindingCount: 0 }, constrained);
  assert.throws(() => applyVisualRunEvent(run, { type: "no-repair-needed", id: "5", at: "2026-07-14T00:00:05Z" }, constrained), /constrained requires a corrective pass/);
  run = applyVisualRunEvent(run, { type: "repair-requested", id: "6", at: "2026-07-14T00:00:06Z", repairId: "r1" }, constrained);
  run = applyVisualRunEvent(run, { type: "repair-recorded", id: "7", at: "2026-07-14T00:00:07Z" }, constrained);
  assert.throws(() => applyVisualRunEvent(run, { type: "recheck-evidence-recorded", id: "8", at: "2026-07-14T00:00:08Z", evidenceId: "e1" }, constrained), /fresh evidence/);
});

test("rejects variant counts that disagree with policy", () => {
  const run = createVisualRun({ id: "run-2", policyPath: ".design/execution-policy.json" });
  assert.throws(() => applyVisualRunEvent(run, {
    type: "directions-validated", id: "1", at: "2026-07-14T00:00:01Z", variantIds: ["v1"],
  }, standard), /requires 2 variants/);
});

test("does not mutate a run after an invalid transition", () => {
  const run = createVisualRun({ id: "run-3", policyPath: ".design/execution-policy.json" });
  assert.throws(() => applyVisualRunEvent(run, { type: "final-audit-recorded", id: "x", at: "2026-07-14T00:00:02Z", reportPath: "report.json" }, constrained));
  assert.equal(run.state, "policy-resolved");
  assert.equal(run.history.length, 1);
});
```

- [ ] **Step 2: Run the tests and confirm state-machine imports fail**

Run: `node --test tests/frontend-visual-loop.test.ts`

Expected: FAIL because `createVisualRun` and `applyVisualRunEvent` do not exist.

- [ ] **Step 3: Implement the transition table and guards**

```ts
const transitionByState: Record<VisualRunState, VisualRunEvent["type"][]> = {
  "policy-resolved": ["directions-validated", "blocked", "failed"],
  "directions-valid": ["implementation-recorded", "blocked", "failed"],
  implemented: ["initial-evidence-recorded", "blocked", "failed"],
  "initial-evidence-captured": ["critique-recorded", "blocked", "failed"],
  critiqued: ["repair-requested", "no-repair-needed", "blocked", "failed"],
  "repair-requested": ["repair-recorded", "blocked", "failed"],
  "no-repair-needed": ["recheck-evidence-recorded", "blocked", "failed"],
  repaired: ["recheck-evidence-recorded", "blocked", "failed"],
  "recheck-evidence-captured": ["final-audit-recorded", "blocked", "failed"],
  "final-audited": ["verification-recorded", "blocked", "failed"],
  verified: [], failed: [], blocked: [],
};
```

Map events to target states explicitly. Before cloning the run, enforce: exact variant count, unique variant ids, selected variant membership, `no-repair-needed` only when profile is not constrained and the critique recorded zero repair findings, fresh recheck evidence, and verification outcome `verified` before entering `verified`. Append a history record only after all guards pass.

- [ ] **Step 4: Run state-machine and policy regression tests**

Run: `node --test tests/frontend-visual-loop.test.ts tests/frontend-design-policy.test.ts && npm run build`

Expected: PASS; every skipped stage throws and the valid full path reaches `verified`.

- [ ] **Step 5: Commit the state machine**

```bash
git add src/domains/frontend/design/visual-loop.ts src/domains/frontend/design/index.ts tests/frontend-visual-loop.test.ts
git commit -m "feat(frontend): enforce mandatory visual correction loop"
```

---

### Task 3: Independent critic input, AI-slop checks, and winner validation

**Files:**
- Create: `src/domains/frontend/design/critic.ts`
- Modify: `src/domains/frontend/design/index.ts`
- Test: `tests/frontend-visual-critic.test.ts`

**Interfaces:**
- Consumes: policy, `DesignVariantMetadata[]`, evidence summaries, and a host-produced `VisualCriticReport`.
- Produces: `createVisualCriticInput(input): VisualCriticInput`, `validateVisualCriticReport(input, report): VerificationFinding[]`, and `compareDesignVariants(input, report): VariantComparisonResult`.

- [ ] **Step 1: Write failing independence, scorecard, code-output, and selection tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  compareDesignVariants,
  createVisualCriticInput,
  validateVisualCriticReport,
  type VisualCriticReport,
} from "../src/domains/frontend/design/index.ts";

const input = createVisualCriticInput({
  policyId: "policy-1",
  generatorActorId: "generator-a",
  criticActorId: "critic-b",
  candidates: [
    { variantId: "v1", directionPath: "v1/direction.json", evidenceId: "e1", screenshotPaths: ["v1-390.png", "v1-1440.png"] },
    { variantId: "v2", directionPath: "v2/direction.json", evidenceId: "e2", screenshotPaths: ["v2-390.png", "v2-1440.png"] },
  ],
});

const scores = {
  "product-specificity": 0.8,
  hierarchy: 0.8,
  composition: 0.8,
  typography: 0.8,
  "color-roles": 0.8,
  "state-quality": 0.8,
  "responsive-transformation": 0.8,
  accessibility: 0.8,
  "implementation-coherence": 0.8,
  "ai-slop-risk": 0.8,
} as const;

const makeCriticReport = ({ selectedVariantId }: { selectedVariantId: string }): VisualCriticReport => ({
  schemaVersion: "1.0",
  id: "critique-1",
  generatorActorId: "generator-a",
  criticActorId: "critic-b",
  candidateVariantIds: ["v1", "v2"],
  evidenceIds: ["e1", "e2"],
  comparisons: ["v1", "v2"].map((variantId) => ({
    variantId,
    scores: { ...scores },
    strengths: [`${variantId} preserves the primary action hierarchy.`],
    weaknesses: [`${variantId} needs tighter state differentiation.`],
    aiSlopFindings: [],
  })),
  outcome: "selected",
  selectedVariantId,
  repairFindings: [],
  confidence: 0.8,
  residualUncertainty: [],
  containsImplementationCode: false,
});

test("requires an actor independent from the generator", () => {
  assert.throws(() => createVisualCriticInput({ ...input, criticActorId: "generator-a" }), /independent critic/);
});

test("rejects code-shaped critic output", () => {
  const report = makeCriticReport({ selectedVariantId: "v1" });
  report.comparisons[0].weaknesses = ["```tsx\n<div className=\"p-4\" />\n```"];
  assert.ok(validateVisualCriticReport(input, report).some(({ code }) => code === "critic-code-output"));
});

test("rejects a winner outside the candidate set", () => {
  const result = compareDesignVariants(input, makeCriticReport({ selectedVariantId: "v3" }));
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(({ code }) => code === "critic-selection-invalid"));
});

test("accepts a complete code-free comparison", () => {
  const result = compareDesignVariants(input, makeCriticReport({ selectedVariantId: "v2" }));
  assert.equal(result.ok, true);
  assert.equal(result.selectedVariantId, "v2");
});
```

- [ ] **Step 2: Run the critic tests and confirm the module is missing**

Run: `node --test tests/frontend-visual-critic.test.ts`

Expected: FAIL because critic functions are not exported.

- [ ] **Step 3: Implement strict input and report validation**

Use this exact code-shape detector over every string in the report:

```ts
const codeShape = /```(?:jsx|tsx|css|html|javascript|typescript)|(?:^|\n)(?:diff --git|@@ |\+\+\+ |--- )|<\/?[a-z][^>]*>|\bclassName\s*=|\b(?:git|npm|pnpm|yarn)\s+(?:add|commit|run)\b/i;
```

Validation emits hard findings from `frontend.visual-critic` for: same actor id, candidate/evidence mismatch, missing criterion, score outside `0..1`, comparison missing for a candidate, invalid selected id, selected id present with `no-acceptable-variant`, absent selected id with `selected`, code-shaped content, `containsImplementationCode !== false`, and AI-slop evidence not pointing to a supplied screenshot/evidence id.

`compareDesignVariants` returns `{ ok: false, findings }` whenever a critical/high hard finding exists. Otherwise it returns the validated report and selected id. It never breaks ties itself or overrides the critic-selected variant.

- [ ] **Step 4: Run critic, state-machine, and source syntax tests**

Run: `node --test tests/frontend-visual-critic.test.ts tests/frontend-visual-loop.test.ts && node --check src/domains/frontend/design/critic.ts && npm run build`

Expected: PASS; JSX/CSS/diff/shell-shaped reports are rejected without false mutation.

- [ ] **Step 5: Commit the critic boundary**

```bash
git add src/domains/frontend/design/critic.ts src/domains/frontend/design/index.ts tests/frontend-visual-critic.test.ts
git commit -m "feat(frontend): add independent visual critic boundary"
```

---

### Task 4: Non-coding visual critic skill and workflow integration

**Files:**
- Create: `registry/skills/frontend.visual-critic/skill.manifest.json`
- Create: `registry/skills/frontend.visual-critic/SKILL.md`
- Create: `registry/skills/frontend.visual-critic/input.schema.json`
- Create: `registry/skills/frontend.visual-critic/output.schema.json`
- Create: `registry/skills/frontend.visual-critic/workflow.json`
- Create: `registry/skills/frontend.visual-critic/gates.json`
- Create: `registry/skills/frontend.visual-critic/evals.json`
- Modify: `domains/frontend/workflows/design-generation.workflow.json`
- Modify: `registry/skills/frontend.visual-design-polish/workflow.json`
- Modify: `registry/skills/frontend.design-to-code/workflow.json`
- Test: `tests/design-skill-contracts.test.ts`
- Test: `tests/skill-content-contracts.test.ts`

**Interfaces:**
- Consumes: `VisualCriticInput` and the critic policy from Tasks 1–3.
- Produces: registry skill `frontend.visual-critic` with read-only permissions and `VisualCriticReport` output.

- [ ] **Step 1: Add failing critic-skill safety tests**

```ts
test("visual critic is read-only and code-free", async () => {
  const manifest = JSON.parse(await readFile("registry/skills/frontend.visual-critic/skill.manifest.json", "utf8"));
  const skill = await readFile("registry/skills/frontend.visual-critic/SKILL.md", "utf8");
  const output = JSON.parse(await readFile("registry/skills/frontend.visual-critic/output.schema.json", "utf8"));
  assert.deepEqual(manifest.permissions.writes, []);
  assert.equal(manifest.permissions.shell, false);
  assert.equal(manifest.permissions.network, false);
  assert.match(skill, /must not write or propose JSX, CSS, HTML, diffs, shell commands, or source edits/i);
  assert.equal(output.properties.containsImplementationCode.const, false);
});

test("material design workflows call critic after initial evidence", async () => {
  const workflow = JSON.parse(await readFile("domains/frontend/workflows/design-generation.workflow.json", "utf8"));
  const ids = workflow.steps.map((step: { id: string }) => step.id);
  assert.ok(ids.indexOf("capture-initial-evidence") < ids.indexOf("independent-visual-critique"));
  assert.ok(ids.indexOf("independent-visual-critique") < ids.indexOf("bounded-repair"));
});
```

- [ ] **Step 2: Run skill tests and confirm the registry entry is absent**

Run: `node --test tests/design-skill-contracts.test.ts tests/skill-content-contracts.test.ts`

Expected: FAIL with `ENOENT` for `frontend.visual-critic`.

- [ ] **Step 3: Create the critic skill with an explicit ownership boundary**

The manifest must use id `frontend.visual-critic`, name `visual-critic`, routing lane `qa`, category `visual-critic`, permissions `filesystem: ["read-project"]`, `writes: []`, `network: false`, `shell: false`, and execution files listed above. Its description triggers only after rendered variants or screenshots exist.

`SKILL.md` must require this sequence: validate input artifact ids; inspect every declared viewport/state screenshot; score all ten criteria; flag AI slop with evidence; compare variants; select one or reject all; emit bounded findings in the output schema. It must explicitly refuse implementation requests and hand code changes back to the owning implementation skill.

`gates.json` must hard-fail `same-actor`, `missing-candidate-evidence`, `incomplete-scorecard`, `critic-code-output`, and `invalid-selection`. `evals.json` must contain one should-trigger prompt with two rendered variants, one should-not-trigger prompt asking to implement a page, and one task assertion requiring a code-free report.

- [ ] **Step 4: Validate the new skill and workflow contracts**

Run: `node --test tests/design-skill-contracts.test.ts tests/skill-content-contracts.test.ts && npm run validate:registry && npm run lint:skills && npm run audit:registry`

Expected: PASS; audit reports no write, shell, network, or executable-script permission.

- [ ] **Step 5: Commit critic skill integration**

```bash
git add registry/skills/frontend.visual-critic domains/frontend/workflows/design-generation.workflow.json registry/skills/frontend.visual-design-polish/workflow.json registry/skills/frontend.design-to-code/workflow.json tests/design-skill-contracts.test.ts tests/skill-content-contracts.test.ts
git commit -m "feat(frontend): add non-coding visual critic skill"
```

## Plan Verification

Run:

```bash
npm run build
node --test tests/frontend-visual-loop.test.ts tests/frontend-visual-critic.test.ts tests/frontend-design-policy.test.ts tests/design-skill-contracts.test.ts tests/skill-content-contracts.test.ts tests/domain-pack.test.ts
npm run validate:registry
npm run lint:skills
npm run audit:registry
```

Expected: every command exits `0`; a complete material run cannot reach `verified` without initial evidence, independent code-free critique, bounded repair handling, and fresh recheck evidence.

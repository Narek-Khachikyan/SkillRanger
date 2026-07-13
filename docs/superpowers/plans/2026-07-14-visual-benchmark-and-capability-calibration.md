# Visual Benchmark And Capability Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a frozen 96-slot visual benchmark, collect blind human judgments, measure quality and stability, and derive runtime design freedom from observed capability rather than model names.

**Architecture:** A visual benchmark suite contains eight product briefs, one per recipe. A new runner crosses those briefs with three externally configured capability candidates, two SkillRanger arms, and two repetitions, executing every slot in an isolated fixture copy. A blind-review pack separates opaque A/B material from the private mapping. Pure aggregation calculates quality, preference, variance, divergence, failure, verification, false-completion, and repair metrics. A threshold calibrator emits `DesignCapabilityConstraints` consumed by Plan 1's policy resolver.

**Tech Stack:** TypeScript 6, Node.js 24 filesystem/crypto/child-process built-ins, Node test runner, existing safe eval runner patterns, JSON artifacts.

## Global Constraints

- The frozen matrix is exactly `8 briefs × 3 capability candidates × 2 arms × 2 repetitions = 96 runs`.
- Arms are `without-skillranger` and `with-skillranger`.
- Capability candidates are configured externally with exact model ids; candidate/result metrics, not model ids, drive calibration.
- Every run uses an isolated fixture copy and immutable unique run id.
- Prompts, brief order, SkillRanger version/checksum, tool capabilities, and review rubric are frozen within a benchmark version.
- Reviewers see opaque randomized A/B labels and rendered evidence only.
- LLM judging cannot satisfy blind human review.
- Report mean/median quality, preference share, repeat variance, design-axis divergence, catastrophic failure rate, hard-gate failure rate, average repair iterations, verification success, and false-completion rate.
- Unknown or insufficient evidence resolves to constrained capability.
- Repetitions remain separate records; resume never merges or overwrites a completed run.
- External model execution is analytical evidence and is not an ordinary local release blocker.
- Use TDD for every task and commit only the files listed for that task.

---

### Task 1: Frozen eight-brief visual benchmark suite

**Files:**
- Create: `src/evals/visual/types.ts`
- Create: `src/evals/visual/suite.ts`
- Create: `evals/frontend/visual-benchmark/suite.json`
- Create: `evals/frontend/visual-benchmark/briefs/operational-command-center.json`
- Create: `evals/frontend/visual-benchmark/briefs/consumer-discovery.json`
- Create: `evals/frontend/visual-benchmark/briefs/developer-tool.json`
- Create: `evals/frontend/visual-benchmark/briefs/editorial-content.json`
- Create: `evals/frontend/visual-benchmark/briefs/marketing-landing.json`
- Create: `evals/frontend/visual-benchmark/briefs/saas-workspace.json`
- Create: `evals/frontend/visual-benchmark/briefs/e-commerce.json`
- Create: `evals/frontend/visual-benchmark/briefs/mobile-consumer-app.json`
- Create: `tests/helpers/visual-benchmark-fixtures.ts`
- Test: `tests/frontend-visual-benchmark.test.ts`

**Interfaces:**
- Produces: `VisualBenchmarkSuite`, `VisualBenchmarkBrief`, `VisualCapabilityCandidate`, `loadVisualBenchmarkSuite(path?)`, and `validateVisualBenchmarkSuite(suite)`.
- Consumes: eight recipe ids, fixed viewport/state requirements, and the ten visual critic criteria.

- [ ] **Step 1: Write failing suite completeness and invention-safety tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { loadVisualBenchmarkSuite, validateVisualBenchmarkSuite } from "../src/evals/visual/suite.ts";

test("loads one frozen brief per recipe", async () => {
  const suite = await loadVisualBenchmarkSuite();
  assert.equal(suite.schemaVersion, "1.0");
  assert.equal(suite.version, "visual-benchmark-v1");
  assert.equal(suite.briefs.length, 8);
  assert.deepEqual(suite.briefs.map(({ recipeId }) => recipeId), [
    "operational-command-center", "consumer-discovery", "developer-tool", "editorial-content",
    "marketing-landing", "saas-workspace", "e-commerce", "mobile-consumer-app",
  ]);
  assert.deepEqual(validateVisualBenchmarkSuite(suite), []);
});

test("requires real states, fixed viewports, and forbidden invention", async () => {
  const suite = await loadVisualBenchmarkSuite();
  for (const brief of suite.briefs) {
    assert.deepEqual(brief.requiredViewports, [390, 768, 1440]);
    for (const state of ["loading", "empty", "error", "success"]) assert.ok(brief.requiredStates.includes(state));
    assert.ok(brief.forbiddenInvention.includes("metrics"));
    assert.ok(brief.forbiddenInvention.includes("testimonials"));
    assert.ok(brief.forbiddenInvention.includes("people"));
    assert.equal(brief.scoringCriteria.length, 10);
  }
});
```

- [ ] **Step 2: Run the test and confirm suite modules/files are missing**

Run: `node --test tests/frontend-visual-benchmark.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/evals/visual/suite.ts`.

- [ ] **Step 3: Define exact suite contracts**

```ts
export type VisualBenchmarkBrief = {
  schemaVersion: "1.0";
  id: string;
  recipeId: string;
  prompt: string;
  fixture: string;
  route: string;
  productFacts: string[];
  contentShapes: string[];
  requiredViewports: [390, 768, 1440];
  requiredStates: string[];
  scoringCriteria: VisualCriterion[];
  forbiddenInvention: Array<"metrics" | "testimonials" | "people" | "brands" | "transactions">;
};

export type VisualBenchmarkSuite = {
  schemaVersion: "1.0";
  version: "visual-benchmark-v1";
  skillRangerVersion: string;
  skillRangerChecksum: string;
  toolCapabilities: string[];
  briefs: VisualBenchmarkBrief[];
};

export type VisualCapabilityCandidate = {
  id: "weak" | "medium" | "strong";
  modelId: string;
  commandProfile: string;
};
```

Use `fixtures/next-react-ts` for all v1 briefs and these exact primary scenarios:

| brief id | prompt focus | extra state |
| --- | --- | --- |
| `ops-incident-queue` | triage an incident queue with stale and assigned status | stale |
| `discovery-reading-catalogue` | browse, filter, and save supplied titles | filtered |
| `developer-run-diagnostics` | inspect a failed repository run and copy commands | running |
| `editorial-implementation-guide` | read a sourced guide with long content and navigation | long-content |
| `marketing-capability-landing` | explain a supplied product mechanism and request access without invented proof | form-error |
| `saas-team-workspace` | update task status with permissions and sync recovery | no-permission |
| `commerce-product-comparison` | compare supplied products, availability, and fulfillment before cart | unavailable |
| `mobile-daily-check-in` | complete an offline-capable one-thumb daily check-in | offline |

Every prompt must require structured direction, implementation, all declared states, screenshots, critique, repair, and recheck. Product facts and content shapes must be concrete neutral fixture facts, not claims about real entities.

Create `tests/helpers/visual-benchmark-fixtures.ts` with the pinned three-candidate array used throughout this plan and export:

```ts
export const visualCandidates = [
  { id: "weak", modelId: "provider/model-a@pinned", commandProfile: "weak.json" },
  { id: "medium", modelId: "provider/model-b@pinned", commandProfile: "medium.json" },
  { id: "strong", modelId: "provider/model-c@pinned", commandProfile: "strong.json" },
] as const;

export const makeMetrics = (overrides: Partial<{
  sampleCount: number;
  meanQuality: number;
  catastrophicFailureRate: number;
  verificationSuccessRate: number;
  withinConditionVariance: number;
  meanRepairIterations: number;
  modelIds: string[];
}> = {}) => ({
  benchmarkVersion: "visual-benchmark-v1",
  candidateId: "medium",
  sampleCount: 16,
  meanQuality: 0.7,
  catastrophicFailureRate: 0.05,
  verificationSuccessRate: 0.85,
  withinConditionVariance: 0.08,
  meanRepairIterations: 2,
  modelIds: ["provider/model-b@pinned"],
  successfulRecipeIds: ["developer-tool", "saas-workspace"],
  evidencePaths: ["results/report.json"],
  ...overrides,
});
```

In Task 3, extend the same helper with `makeCompletedTwoArmPlan`, `makeCompletedResults`, `makeReview`, and `makeAggregateInput`. Build them from `generateVisualBenchmarkPlan`, not hand-written run arrays: every completed result mirrors one plan entry, every A/B mapping groups the two arms by brief/candidate/repetition, and synthetic criterion vectors use `4` for SkillRanger and `3` without SkillRanger except the explicitly overridden weak catastrophic fixtures.

- [ ] **Step 4: Run suite validation and existing eval compatibility tests**

Run: `node --test tests/frontend-visual-benchmark.test.ts tests/frontend-eval.test.ts && npm run build`

Expected: PASS; the existing frontend eval suite remains unchanged.

- [ ] **Step 5: Commit the frozen suite**

```bash
git add src/evals/visual/types.ts src/evals/visual/suite.ts evals/frontend/visual-benchmark tests/helpers/visual-benchmark-fixtures.ts tests/frontend-visual-benchmark.test.ts
git commit -m "test(frontend): add frozen eight-brief visual benchmark"
```

---

### Task 2: 96-slot isolated benchmark planner and runner

**Files:**
- Create: `src/evals/process.ts`
- Create: `src/evals/visual/runner.ts`
- Modify: `src/evals/runner.ts`
- Test: `tests/frontend-visual-benchmark.test.ts`
- Test: `tests/frontend-eval.test.ts`

**Interfaces:**
- Produces: `VisualBenchmarkArm`, `VisualBenchmarkPlanEntry`, `VisualBenchmarkPlan`, `generateVisualBenchmarkPlan(input)`, and `executeVisualBenchmarkPlan(input)`.
- Consumes: suite, exactly three candidate configs, command template, output directory, dry-run/resume flags, and timeout.

- [ ] **Step 1: Add failing 96-slot, uniqueness, isolation, and resume tests**

```ts
import {
  executeVisualBenchmarkPlan,
  generateVisualBenchmarkPlan,
} from "../src/evals/visual/runner.ts";

const candidates = [
  { id: "weak", modelId: "provider/model-a@pinned", commandProfile: "weak.json" },
  { id: "medium", modelId: "provider/model-b@pinned", commandProfile: "medium.json" },
  { id: "strong", modelId: "provider/model-c@pinned", commandProfile: "strong.json" },
] as const;

test("generates exactly 96 immutable run slots", async () => {
  const plan = generateVisualBenchmarkPlan({ suite: await loadVisualBenchmarkSuite(), candidates: [...candidates] });
  assert.equal(plan.entries.length, 96);
  assert.equal(new Set(plan.entries.map(({ runId }) => runId)).size, 96);
  assert.equal(plan.entries.filter(({ arm }) => arm === "with-skillranger").length, 48);
  assert.equal(plan.entries.filter(({ repetition }) => repetition === 2).length, 48);
});

test("dry-run creates distinct isolated workspace paths", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "visual-benchmark-"));
  const result = await executeVisualBenchmarkPlan({
    plan: generateVisualBenchmarkPlan({ suite: await loadVisualBenchmarkSuite(), candidates: [...candidates] }),
    commandTemplate: "agent run {{prompt}} --output {{outputDir}}",
    outputDir,
    dryRun: true,
  });
  assert.equal(result.runs.length, 96);
  assert.equal(new Set(result.runs.map(({ workspacePath }) => workspacePath)).size, 96);
});
```

Add a resume test that creates one valid `run-result.json`, runs with `resume: true`, and asserts the record is read unchanged while the remaining slot executes or dry-runs separately.

- [ ] **Step 2: Run runner tests and verify new planner is absent**

Run: `node --test tests/frontend-visual-benchmark.test.ts tests/frontend-eval.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/evals/visual/runner.ts`.

- [ ] **Step 3: Extract safe process execution and define the plan**

Move the quote-aware parser, placeholder substitution primitive, and `spawn(..., { shell: false })` process runner from `src/evals/runner.ts` into `src/evals/process.ts`; preserve existing exports and tests through imports.

```ts
export type VisualBenchmarkArm = "without-skillranger" | "with-skillranger";

export type VisualBenchmarkPlanEntry = {
  runId: string;
  briefId: string;
  recipeId: string;
  capabilityCandidateId: "weak" | "medium" | "strong";
  modelId: string;
  commandProfile: string;
  arm: VisualBenchmarkArm;
  repetition: 1 | 2;
  prompt: string;
  fixture: string;
  route: string;
};
```

Generate ids as `<brief-id>--<candidate-id>--<arm>--r<repetition>`. Reject candidate arrays that do not contain each of `weak`, `medium`, and `strong` exactly once. Candidate ids organize benchmark lanes; never infer them from `modelId`.

- [ ] **Step 4: Implement isolated execution and immutable resume**

For every non-dry run, copy the brief fixture recursively to `<outputDir>/runs/<runId>/workspace`, execute in that copy, and support placeholders `{{runId}}`, `{{briefId}}`, `{{recipeId}}`, `{{candidateId}}`, `{{modelId}}`, `{{arm}}`, `{{repetition}}`, `{{prompt}}`, `{{workspace}}`, and `{{outputDir}}`. Persist stdout, stderr, duration, exit/signal, source SkillRanger version/checksum, and artifact paths in `run-result.json` using atomic temp-file rename.

Resume accepts a slot only when run id, brief id, candidate id, arm, repetition, model id, suite version, and SkillRanger checksum all match. A mismatch throws `stale benchmark run <runId>` and never overwrites evidence.

Run: `node --test tests/frontend-visual-benchmark.test.ts tests/frontend-eval.test.ts && npm run build`

Expected: PASS; existing task-eval runner output is byte-compatible for its tests.

- [ ] **Step 5: Commit benchmark execution**

```bash
git add src/evals/process.ts src/evals/runner.ts src/evals/visual/runner.ts tests/frontend-visual-benchmark.test.ts tests/frontend-eval.test.ts
git commit -m "feat(evals): run isolated visual benchmark matrix"
```

---

### Task 3: Blind human review package and quality/stability metrics

**Files:**
- Create: `src/evals/visual/review.ts`
- Create: `src/evals/visual/metrics.ts`
- Modify: `tests/helpers/visual-benchmark-fixtures.ts`
- Test: `tests/frontend-visual-benchmark.test.ts`

**Interfaces:**
- Produces: `VisualBlindReviewPackage`, `VisualBlindReviewMapping`, `VisualHumanReview`, `createBlindReviewPackage(input)`, `validateHumanReview(input)`, and `aggregateVisualBenchmark(input): VisualBenchmarkReport`.
- Consumes: completed run index, screenshot/evidence paths, injected cryptographic label factory, and one or more human review artifacts.

- [ ] **Step 1: Write failing blinding, human-only, pairing, and metric tests**

```ts
test("creates opaque A/B pairs without leaking arm or model", () => {
  const { reviewPackage, privateMapping } = createBlindReviewPackage({
    plan: makeCompletedTwoArmPlan(),
    results: makeCompletedResults(),
    labelFactory: (() => { let n = 0; return () => `opaque-${++n}`; })(),
  });
  const publicText = JSON.stringify(reviewPackage);
  assert.doesNotMatch(publicText, /with-skillranger|without-skillranger|provider\//);
  assert.equal(reviewPackage.pairs.length, 48);
  assert.equal(privateMapping.pairs.length, 48);
});

test("rejects llm judges and incomplete criterion scores", () => {
  const issues = validateHumanReview(makeReview({ reviewerType: "llm", scores: {} }));
  assert.ok(issues.includes("reviewerType must be human"));
  assert.ok(issues.includes("all ten criterion scores are required"));
});

test("aggregates quality and repeat stability separately", () => {
  const report = aggregateVisualBenchmark(makeAggregateInput());
  assert.equal(report.metrics.runSlots, 96);
  assert.equal(report.metrics.pairwiseSkillRangerPreferenceShare, 0.75);
  assert.ok(report.metrics.withinConditionVariance >= 0);
  assert.ok(report.metrics.repeatDesignAxisDivergence >= 0);
  assert.equal(report.byCapability.weak.catastrophicFailureRate, 0.25);
  assert.equal(report.byCapability.weak.meanRepairIterations, 2.5);
});
```

- [ ] **Step 2: Run review/metrics tests and verify modules are absent**

Run: `node --test tests/frontend-visual-benchmark.test.ts`

Expected: FAIL because review and metrics modules do not exist.

- [ ] **Step 3: Implement strict blinded pair creation**

Pair runs by brief, capability candidate, and repetition; each pair contains exactly one run per arm. Randomize A/B through `labelFactory` plus `randomBytes(16)` in production. The public package includes opaque pair id, A/B screenshot paths copied to a review directory, recipe-neutral criterion labels, and no source paths containing run ids. The private mapping contains pair id, opaque A/B labels, run ids, arms, model ids, and source artifact paths. Never store the private mapping under the public review directory.

Human review contract:

```ts
export type VisualHumanReview = {
  schemaVersion: "1.0";
  benchmarkVersion: string;
  reviewerId: string;
  reviewerType: "human";
  judgments: Array<{
    pairId: string;
    scoresA: Record<VisualCriterion, number>;
    scoresB: Record<VisualCriterion, number>;
    preference: "A" | "B" | "tie";
    catastrophicA: boolean;
    catastrophicB: boolean;
    notes: string[];
  }>;
};
```

Scores are integers `1..5`. Every review must cover every public pair exactly once.

- [ ] **Step 4: Implement exact aggregate metrics**

Normalize a run quality score as the arithmetic mean of its ten criterion scores divided by `5`. Use population variance for repeated normalized scores. Repeat design-axis divergence is the mean Euclidean distance between repetition score vectors divided by `sqrt(10 * 16)`. Preference share is `(SkillRanger wins + 0.5 * ties) / reviewed pairs`.

Read run metadata for hard-gate failure, repair iterations, verification outcome, and completion claim. Calculate:

- catastrophic failure rate;
- hard-gate failure rate;
- mean repair iterations;
- verification success rate;
- false-completion rate where completion was claimed but outcome was not `verified`;
- overall and per-candidate mean/median quality;
- within-condition variance and repeat divergence;
- SkillRanger deltas for every metric.

Run: `node --test tests/frontend-visual-benchmark.test.ts && npm run build`

Expected: PASS with fixed numeric fixtures within `1e-9` tolerance.

- [ ] **Step 5: Commit blind review and metrics**

```bash
git add src/evals/visual/review.ts src/evals/visual/metrics.ts tests/helpers/visual-benchmark-fixtures.ts tests/frontend-visual-benchmark.test.ts
git commit -m "feat(evals): measure blind visual quality and stability"
```

---

### Task 4: Empirical capability records and runtime policy integration

**Files:**
- Create: `src/evals/visual/calibration.ts`
- Create: `domains/frontend/capabilities/default-constrained.json`
- Create: `domains/frontend/schemas/model-capability-record.schema.json`
- Modify: `src/domains/types.ts`
- Modify: `src/domains/frontend/design/policy-types.ts`
- Modify: `src/domains/frontend/design/policy.ts`
- Modify: `src/domains/frontend/design/index.ts`
- Modify: `domains/frontend/domain.manifest.json`
- Modify: `docs/model-capability-profiles.md`
- Test: `tests/frontend-capability-calibration.test.ts`
- Test: `tests/frontend-design-policy.test.ts`

**Interfaces:**
- Produces: `ModelCapabilityRecord`, `calibrateCapabilityRecord(input)`, `loadCapabilityRecord(path?)`, and `constraintsFromCapabilityRecord(record)`.
- Consumes: per-candidate `VisualBenchmarkReport` metrics and Plan 1's `DesignCapabilityConstraints`.

- [ ] **Step 1: Write failing constrained/standard/advanced threshold tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { calibrateCapabilityRecord, constraintsFromCapabilityRecord } from "../src/evals/visual/calibration.ts";

test("selects constrained for unstable or insufficient evidence", () => {
  assert.equal(calibrateCapabilityRecord(makeMetrics({ sampleCount: 7 })).profile, "constrained");
  assert.equal(calibrateCapabilityRecord(makeMetrics({
    sampleCount: 16, catastrophicFailureRate: 0.11, verificationSuccessRate: 0.9,
  })).profile, "constrained");
});

test("selects advanced only for high quality and stable evidence", () => {
  const record = calibrateCapabilityRecord(makeMetrics({
    sampleCount: 16, meanQuality: 0.86, catastrophicFailureRate: 0.01,
    verificationSuccessRate: 0.94, withinConditionVariance: 0.03,
    meanRepairIterations: 1.2,
  }));
  assert.equal(record.profile, "advanced");
  assert.equal(constraintsFromCapabilityRecord(record).maxVariants, 3);
  assert.equal(constraintsFromCapabilityRecord(record).maxPrimitiveFreedom, "new-primitives");
});

test("does not use model id to classify capability", () => {
  const metrics = makeMetrics({ sampleCount: 16, meanQuality: 0.7 });
  assert.equal(calibrateCapabilityRecord({ ...metrics, modelIds: ["provider/a"] }).profile,
    calibrateCapabilityRecord({ ...metrics, modelIds: ["provider/b"] }).profile);
});
```

- [ ] **Step 2: Run calibration tests and verify module/schema are absent**

Run: `node --test tests/frontend-capability-calibration.test.ts tests/frontend-design-policy.test.ts`

Expected: FAIL because calibration exports do not exist.

- [ ] **Step 3: Define the record and exact thresholds**

```ts
export type ModelCapabilityRecord = {
  schemaVersion: "1.0";
  id: string;
  benchmarkVersion: string;
  candidateId: string;
  modelIds: string[];
  sampleCount: number;
  evaluatedAt: string;
  metrics: {
    meanQuality: number;
    catastrophicFailureRate: number;
    verificationSuccessRate: number;
    withinConditionVariance: number;
    meanRepairIterations: number;
  };
  profile: "constrained" | "standard" | "advanced";
  constraints: DesignCapabilityConstraints;
  evidencePaths: string[];
};
```

Threshold order:

1. `constrained` when `sampleCount < 16`, catastrophic failure `> 0.10`, verification success `< 0.75`, or variance `> 0.12`.
2. `advanced` when mean quality `>= 0.82`, catastrophic failure `<= 0.03`, verification success `>= 0.90`, variance `<= 0.06`, and mean repair iterations `<= 1.5`.
3. `standard` otherwise.

Constraints:

- constrained: `maxVariants: 1`, recipe allowlist from successful briefs only, preserve composition, existing primitives, verified patterns only;
- standard: `maxVariants: 2`, successful recipe allowlist, recipe layouts, local variants, patterns preferred;
- advanced: `maxVariants: 3`, successful recipe allowlist or all eight when every brief passes, free composition, new primitives, free implementation after structured direction.

The default JSON is constrained with id `unknown-constrained-default`, sample count `0`, empty model ids, all risk metrics at their conservative boundary, and all eight recipe ids allowed so unknown capability can still choose one top recipe.

Extend `DomainPackManifest.artifacts` with optional `capabilityRecords?: string[]` and publish `capabilities/default-constrained.json` there. This field is distinct from the existing top-level domain `capabilities` feature list.

- [ ] **Step 4: Integrate records with policy resolution**

Allow `resolveDesignExecutionPolicy` callers to pass `constraintsFromCapabilityRecord(record)` through the existing `capability` field; do not add `modelId` to the resolver input. Validate loaded record schema, benchmark version, finite metrics, and contained evidence paths.

Run: `node --test tests/frontend-capability-calibration.test.ts tests/frontend-design-policy.test.ts tests/domain-pack.test.ts && npm run build`

Expected: PASS; changing only model ids never changes the resolved profile or freedom.

- [ ] **Step 5: Commit empirical calibration**

```bash
git add src/evals/visual/calibration.ts src/domains/types.ts src/domains/frontend/design/policy-types.ts src/domains/frontend/design/policy.ts src/domains/frontend/design/index.ts domains/frontend/capabilities/default-constrained.json domains/frontend/schemas/model-capability-record.schema.json domains/frontend/domain.manifest.json docs/model-capability-profiles.md tests/frontend-capability-calibration.test.ts tests/frontend-design-policy.test.ts
git commit -m "feat(frontend): calibrate design freedom from benchmark evidence"
```

---

### Task 5: CLI workflow, reports, and benchmark documentation

**Files:**
- Create: `src/cli/visual-eval.ts`
- Modify: `src/cli/index.ts`
- Modify: `package.json`
- Create: `tests/fixtures/visual-candidates.json`
- Create: `docs/visual-benchmark.md`
- Modify: `docs/evaluation-and-promotion.md`
- Test: `tests/cli.visual-eval.test.ts`

**Interfaces:**
- Produces CLI command `eval:visual` with mutually exclusive actions `--plan`, `--run`, `--prepare-review`, `--aggregate`, and `--calibrate`.
- Consumes: suite, candidate config JSON, command template, result directory, human review files, and benchmark report.

- [ ] **Step 1: Write failing CLI plan and invalid-combination tests**

```ts
test("eval:visual plans the frozen 96-run matrix", async () => {
  const result = await runCli(["eval:visual", "--plan", "--candidates", candidateConfigPath, "--json"]);
  assert.equal(result.code, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.entries.length, 96);
});

test("eval:visual rejects multiple actions", async () => {
  const result = await runCli(["eval:visual", "--plan", "--aggregate", "--candidates", candidateConfigPath]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /choose exactly one visual benchmark action/);
});
```

- [ ] **Step 2: Run CLI tests and verify command is unknown**

Run: `node --test tests/cli.visual-eval.test.ts`

Expected: FAIL because `eval:visual` is not routed.

- [ ] **Step 3: Implement thin CLI action dispatch**

`--plan` prints/generated plan; `--run` requires `--command` and `--output`; `--prepare-review` requires completed results and separate `--public-review-output` plus `--private-mapping-output`; `--aggregate` requires one or more `--human-review`; `--calibrate` requires an aggregate report and candidate id. Every action supports `--json`. Candidate config must contain exactly weak/medium/strong entries with pinned model ids.

CLI code calls the modules from Tasks 1–4 and contains no metric or calibration formulas. Add `eval:visual` to help text and `npm run eval:visual --` script. Add `src/cli/visual-eval.ts` and all `src/evals/visual/*.ts` files to the `check` script.

Create `tests/fixtures/visual-candidates.json` with exactly:

```json
[
  { "id": "weak", "modelId": "fixture/model-weak@pinned", "commandProfile": "weak.json" },
  { "id": "medium", "modelId": "fixture/model-medium@pinned", "commandProfile": "medium.json" },
  { "id": "strong", "modelId": "fixture/model-strong@pinned", "commandProfile": "strong.json" }
]
```

- [ ] **Step 4: Document reproducible execution and review separation**

`docs/visual-benchmark.md` must include the 96-run formula, candidate config example, exact plan/run/review/aggregate/calibrate commands, isolated output layout, reviewer instructions, metric formulas, threshold table, artifact retention, and warning that the private mapping must not be shared with reviewers. `docs/evaluation-and-promotion.md` must state that visual calibration is analytical evidence and does not replace existing routing/task promotion gates.

Run: `node --test tests/cli.visual-eval.test.ts tests/frontend-visual-benchmark.test.ts tests/frontend-capability-calibration.test.ts && npm run check && npm run build`

Expected: PASS; dry-run planning requires no external agent binary.

- [ ] **Step 5: Commit CLI and documentation**

```bash
git add src/cli/visual-eval.ts src/cli/index.ts package.json docs/visual-benchmark.md docs/evaluation-and-promotion.md tests/fixtures/visual-candidates.json tests/cli.visual-eval.test.ts
git commit -m "feat(evals): expose visual benchmark calibration workflow"
```

## Plan Verification

Run:

```bash
npm run build
npm run check
node --test tests/frontend-visual-benchmark.test.ts tests/frontend-capability-calibration.test.ts tests/frontend-design-policy.test.ts tests/frontend-eval.test.ts tests/cli.visual-eval.test.ts
npm run eval:visual -- --plan --candidates tests/fixtures/visual-candidates.json --json
```

Expected: every command exits `0`; the plan contains 96 unique slots, public review material contains no arm/model leakage, aggregate fixtures expose stability metrics, and calibration ignores model names.

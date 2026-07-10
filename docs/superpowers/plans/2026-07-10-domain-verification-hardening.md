# Domain Verification Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent invalid design inputs, missing screenshots, unsafe paths, incomplete variance evidence, and unresolved domain eval assets from passing verification or promotion gates.

**Architecture:** Keep validation dependency-free and synchronous. Strengthen the frontend design validator at the public boundary, enforce observation artifacts both in the adapter runner and verifier, require complete A/B/C variance groups, and add a generic package-root eval resolver for bundled domain packs.

**Tech Stack:** TypeScript 6, Node.js 20+ built-ins, `node:test`, JSON domain contracts.

## Global Constraints

- Add no runtime dependency.
- Preserve existing CLI and MCP command/tool names and successful response shapes.
- Follow red-green-refactor for every production behavior change.
- Preserve unrelated user changes in the dirty working tree.
- Do not stage or commit unless the user explicitly requests it.

---

### Task 1: Strict design artifact and screenshot validation

**Files:**
- Modify: `tests/frontend-design-runtime.test.ts`
- Modify: `src/domains/frontend/design/validation.ts`

**Interfaces:**
- Consumes: `DesignBrief`, `DesignDirection`, `BrowserObservation`, `VerificationFinding`.
- Produces: `validateDesignBrief(brief)`, `validateDesignDirection(brief, direction)`, and `validateDesignResult(input)` that never throw for malformed nested input and cannot verify missing screenshot artifacts.
- Adds: `artifactExists?: (filePath: string) => boolean` to `validateDesignResult` and `validateBrowserObservations` options, defaulting to local filesystem existence.

- [ ] **Step 1: Add failing malformed-artifact tests**

Add focused tests proving a partial brief returns hard findings instead of throwing and a direction with missing/invalid axes, role maps, rejected defaults, or recipe ID cannot verify:

```ts
test("malformed design artifacts fail structurally without throwing", () => {
  const result = validateDesignResult({
    workflowId: "frontend.design-generation",
    brief: { schemaVersion: "1.0" } as DesignBrief,
    direction: {
      schemaVersion: "1.0",
      recipeId: "missing-recipe",
      thesis: "x",
      productReason: "x",
      axes: { motionIntensity: "banana" },
      signatureMove: "x",
      rejectedDefaults: ["x"],
      destructiveCritique: "x",
    } as unknown as DesignDirection,
    capabilities: [],
  });
  assert.equal(result.report.outcome, "failed");
  assert.ok(result.findings.some((finding) => finding.code === "direction-axes-contract"));
});
```

- [ ] **Step 2: Add a failing screenshot evidence test**

Use complete browser observations whose screenshot paths do not exist and assert a `screenshot-evidence-missing` hard finding and failed outcome. Pass `artifactExists: () => false` so the test is deterministic.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `node --test --test-name-pattern='malformed design artifacts|missing screenshot' tests/frontend-design-runtime.test.ts`

Expected: assertions fail because malformed directions currently verify or throw and missing screenshots currently count as evidence.

- [ ] **Step 4: Implement complete structural checks**

Add record/string-array/string-map helpers and explicit allowed-value sets matching the JSON schemas. Validate every required brief and direction field before semantic access. Use hard findings such as:

```ts
finding(
  "direction-axes-contract",
  "critical",
  "hard",
  "Design direction axes must contain supported density, hierarchy, composition, material, motionIntensity, and expressionLevel values.",
  "Regenerate the direction from the canonical design-direction schema.",
)
```

Only execute regulated/mobile semantic checks when their prerequisite brief fields are structurally valid.

- [ ] **Step 5: Implement screenshot existence gating**

Default `artifactExists` to `existsSync`. For every browser observation, require a non-empty screenshot path whose artifact exists. Emit `screenshot-evidence-missing` as a high hard finding and only include verified screenshot paths in `report.evidence`.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `node --test tests/frontend-design-runtime.test.ts`

Expected: all frontend design runtime tests pass.

---

### Task 2: Contained browser observation artifacts

**Files:**
- Modify: `tests/frontend-design-runtime.test.ts`
- Modify: `src/domains/frontend/design/browser.ts`

**Interfaces:**
- Consumes: `createBrowserObservationPlan`, `executeBrowserObservationPlan`.
- Produces: deterministic screenshot paths contained within `outputDir`; adapter execution rejects missing expected screenshots.

- [ ] **Step 1: Add failing path-containment and adapter tests**

Add a plan test using state `../../../../escaped` and assert:

```ts
const root = path.resolve("/tmp/skillranger-observations");
const screenshot = plan.entries[0]!.screenshotPath;
assert.equal(screenshot.startsWith(`${root}${path.sep}`), true);
```

Add an adapter-runner test whose command returns clean observation JSON without creating the screenshot and assert rejection matching `/did not create screenshot/`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test --test-name-pattern='contained|does not create' tests/frontend-design-runtime.test.ts`

Expected: the path escapes and the adapter currently succeeds.

- [ ] **Step 3: Implement safe deterministic filenames and containment**

Encode state with `encodeURIComponent`, require finite positive integer viewport widths, resolve under `<outputDir>/screenshots`, and assert the result starts with the resolved output root plus `path.sep`.

- [ ] **Step 4: Require adapter-created screenshots**

After parsing a successful adapter result, verify the expected screenshot exists and is a file before accepting the observation. Keep the observation screenshot path canonical by using `expected.screenshotPath`, not an arbitrary adapter-returned path.

- [ ] **Step 5: Update the successful adapter fixture**

Modify the existing test adapter to create `screenshotPath` before returning JSON so the success case proves the new contract.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `node --test tests/frontend-design-runtime.test.ts`

Expected: all frontend design runtime tests pass.

---

### Task 3: Complete A/B/C variance plans and promotion evidence

**Files:**
- Modify: `tests/frontend-eval.test.ts`
- Modify: `src/evals/runner.ts`
- Modify: `src/evals/frontend.ts`

**Interfaces:**
- Consumes: `generateRunPlan(suite, options)` and `summarizeFrontendVariance(evidence, suite)`.
- Produces: non-empty, unique baseline plans; promotion issues for missing current-skill, without-skill, or old-skill model groups.

- [ ] **Step 1: Add failing run-plan validation tests**

Assert `generateRunPlan` throws for `baselines: []` and duplicate values such as `['current-skill', 'current-skill']`.

- [ ] **Step 2: Add a failing incomplete variance test**

Construct three passing `current-skill` repetitions with no controls and assert:

```ts
const summary = summarizeFrontendVariance(evidence, suite);
assert.equal(summary.promotionReady, false);
assert.ok(summary.issues.some((issue) => issue.includes("without-skill")));
assert.ok(summary.issues.some((issue) => issue.includes("old-skill")));
```

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test --test-name-pattern='empty baseline|duplicate baseline|complete A/B/C' tests/frontend-eval.test.ts`

Expected: no exception for invalid plans and incomplete variance is promotion-ready.

- [ ] **Step 4: Implement plan validation**

Reject an empty baseline array and duplicate baseline kinds before generating entries.

- [ ] **Step 5: Implement variance group completeness checks**

Require at least one `current-skill` group. For each current model group, require matching `without-skill` and `old-skill` groups before delta comparison. Add issues without manufacturing comparison metrics.

- [ ] **Step 6: Run focused and full eval tests**

Run: `node --test tests/frontend-eval.test.ts`

Expected: all frontend eval tests pass.

---

### Task 4: Resolve bundled domain eval artifacts generically

**Files:**
- Modify: `tests/domain-pack.test.ts`
- Modify: `src/domains/registry.ts`
- Modify: `docs/domains/creating-a-domain-pack.md`

**Interfaces:**
- Consumes: `DomainPack.manifest.artifacts.evalSuite`, package root.
- Produces: `resolveDomainEvalSuitePath(pack: DomainPack): Promise<string | undefined>` returning a canonical existing package-contained path.

- [ ] **Step 1: Add a failing resolver test**

Assert the bundled frontend pack resolves its eval suite and that reading the resolved JSON yields the manifest-declared frontend suite name.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern='resolves its eval suite' tests/domain-pack.test.ts`

Expected: failure because the resolver does not exist.

- [ ] **Step 3: Implement package-root resolution**

Resolve `evalSuite` against `packageRoot`, enforce containment under `packageRoot`, require the target to be a file, and return `undefined` only when the manifest omits the eval suite.

- [ ] **Step 4: Document path semantics**

State that domain schemas/recipes/workflows/validators are domain-root relative while bundled eval suites are package-root relative and must be resolved through `resolveDomainEvalSuitePath`.

- [ ] **Step 5: Run domain tests and verify GREEN**

Run: `node --test tests/domain-pack.test.ts`

Expected: all domain pack tests pass.

---

### Task 5: Full release-equivalent verification

**Files:**
- Verify only; do not create tracked artifacts.

**Interfaces:**
- Consumes all modified source, contract, test, and documentation files.
- Produces fresh evidence for build, tests, registry, routing, and workspace cleanliness.

- [ ] **Step 1: Run TypeScript and syntax checks**

Run: `./node_modules/.bin/tsc -p tsconfig.build.json --noEmit && npm run check`

Expected: exit 0.

- [ ] **Step 2: Run the complete test suite**

Run: `npm test`

Expected: zero failed tests.

- [ ] **Step 3: Run registry and publication checks**

Run individually: `npm run validate:registry`, `npm run lint:skills`, `npm run audit:registry`, `npm run publish:check`.

Expected: 17 valid skills and zero audit failures.

- [ ] **Step 4: Run routing and data checks**

Run: `npm run eval:frontend -- --run-routing --project fixtures/next-react-ts --json`, JSON parsing over new contract files, and `git diff --check`.

Expected: routing failures 0, JSON errors 0, whitespace errors 0.

- [ ] **Step 5: Verify the final diff is scoped**

Run: `git status --short` and `git diff --stat`.

Expected: only the pre-existing implementation plus the approved hardening source, tests, and docs are changed; nothing is staged or committed.

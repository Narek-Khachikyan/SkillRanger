# Strict Runtime Central Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all five strict runtime v2 certification and locking defects found in commit `3ac1abd`.

**Architecture:** Add a non-configurable certification kernel around contract gates: complete persisted-state invariants, mandatory artifact integrity, runtime-derived frontend evidence, and a runtime critic-resolution gate. Extract the proven v1 lock ownership algorithm into a shared component used by both stores.

**Tech Stack:** Node.js 20+, TypeScript ESM, `node:test`, filesystem-backed JSON artifacts, Git.

## Global Constraints

- Keep CLI and MCP command names and result shapes stable.
- Keep execution contract schema version `2.0`.
- Add no runtime dependency and do not execute a hidden browser.
- Preserve v1 run lifecycle semantics and all existing v1 lock tests.
- Follow red-green-refactor: no production change before its regression test fails for the expected reason.
- Treat artifact corruption as `artifact-integrity`, persisted graph corruption as `run-integrity`, and domain/critic hard failures as bounded repair inputs.

---

### Task 1: Reject forged persisted terminal states

**Files:**
- Modify: `tests/strict-store.test.ts`
- Modify: `tests/strict-run.test.ts`
- Modify: `src/runtime/strict/validation.ts`

**Interfaces:**
- Consumes: `assertValidStrictSkillRun(input: unknown): asserts input is SkillRunV2`
- Produces: persisted ledger/state validation strong enough that `StrictSkillRunStore.read()` rejects a forged `used` outcome before `finalizeStrictRun` can consume it.

- [ ] **Step 1: Add a failing store regression for forged `used`**

```typescript
test("rejects a persisted used outcome without completed steps and verification", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-forged-used-"));
  const store = new StrictSkillRunStore(root);
  const run = fixtureRun();
  await store.create(run);

  const runPath = path.join(root, ".skillranger", "runs", `${run.runId}.json`);
  const forged = JSON.parse(await readFile(runPath, "utf8"));
  forged.skillLedgers[0].state = "used";
  forged.skillLedgers[0].outcome = "used";
  await writeFile(runPath, `${JSON.stringify(forged)}\n`);

  await assert.rejects(
    store.read(run.runId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
  );
});
```

- [ ] **Step 2: Run the regression and verify RED**

Run: `node --test --test-name-pattern="persisted used" tests/strict-store.test.ts`

Expected: FAIL because the forged ledger is currently accepted.

- [ ] **Step 3: Add focused reducer-shape regressions**

In `tests/strict-run.test.ts`, directly call `assertValidStrictSkillRun` through a persisted-shaped fixture and assert rejection for:

```typescript
const forged = structuredClone(created());
forged.skillLedgers[0].steps[0].id = "frontend.test-skill/step/forged";
assert.throws(() => assertValidStrictSkillRun(forged), StrictSkillRunError);

const forgedReport = fullyExecutedFixture();
forgedReport.skillLedgers[0].state = "used";
forgedReport.skillLedgers[0].outcome = "used";
forgedReport.skillLedgers[0].verificationReports = [];
assert.throws(() => assertValidStrictSkillRun(forgedReport), StrictSkillRunError);
```

- [ ] **Step 4: Implement exact persisted graph invariants**

Add focused helpers in `src/runtime/strict/validation.ts` and call them from `assertValidStrictSkillRun`:

```typescript
const same = (left: unknown, right: unknown) => isDeepStrictEqual(left, right);

const expectedStepSnapshot = (step: Record<string, unknown>) => {
  const { status: _status, attempts: _attempts, ...snapshot } = step;
  return snapshot;
};

const assertAttempts = (
  skillId: string,
  step: Record<string, unknown>,
  artifactIds: Set<string>,
) => {
  const attempts = step.attempts as unknown[];
  attempts.forEach((raw, index) => {
    if (!record(raw)
      || raw.attempt !== index + 1
      || typeof raw.startedAt !== "string"
      || !Array.isArray(raw.evidenceIds)
      || !raw.evidenceIds.every((id) => typeof id === "string" && artifactIds.has(id))) {
      fail(`Invalid attempt ${index + 1} for ${skillId}/${String(step.id)}.`);
    }
    if (raw.completedAt !== undefined && typeof raw.completedAt !== "string") {
      fail(`Invalid completion timestamp for ${skillId}/${String(step.id)}.`);
    }
  });
  const latest = attempts.at(-1);
  if (step.status === "active" && (!record(latest) || latest.completedAt !== undefined)) {
    fail(`Active step ${String(step.id)} must have an incomplete latest attempt.`);
  }
  if (step.status === "satisfied" && (!record(latest) || typeof latest.completedAt !== "string")) {
    fail(`Satisfied step ${String(step.id)} must have a completed latest attempt.`);
  }
};

const assertUsedLedger = (ledger: Record<string, unknown>) => {
  if (ledger.state !== "used" && ledger.outcome !== "used") return;
  const steps = ledger.steps as Array<Record<string, unknown>>;
  if (steps.some((step) => step.type !== "repair" && step.status !== "satisfied")) {
    fail(`Used ledger ${String(ledger.skillId)} has incomplete workflow steps.`);
  }
  const reports = ledger.verificationReports as Array<Record<string, unknown>>;
  const latest = reports.at(-1);
  if (!record(latest) || latest.hardPassed !== true) {
    fail(`Used ledger ${String(ledger.skillId)} lacks a passing verification report.`);
  }
};
```

Validate artifacts before attempts so `artifactIds` is available. Then require:

```typescript
const contractSteps = (rawLedger.contract as ExecutionContractV2).steps;
if (rawLedger.steps.length !== contractSteps.length) fail(`Step snapshot mismatch for ${skillId}.`);
rawLedger.steps.forEach((step, index) => {
  if (!record(step) || !same(expectedStepSnapshot(step), contractSteps[index])) {
    fail(`Step snapshot mismatch for ${skillId} at index ${index}.`);
  }
  assertAttempts(skillId, step, artifactIds);
});
assertUsedLedger(rawLedger);
```

Also validate report identities, gate-level consistency, derived `hardPassed`, repair iteration bounds, attribution step/attempt/rule membership, and aggregate run state using small named helpers instead of one compound condition.

- [ ] **Step 5: Run targeted tests and verify GREEN**

Run: `node --test tests/strict-store.test.ts tests/strict-run.test.ts`

Expected: PASS with the forged persisted run rejected as `run-integrity`.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/runtime/strict/validation.ts tests/strict-store.test.ts tests/strict-run.test.ts
git commit -m "fix: validate strict persisted lifecycle invariants"
```

### Task 2: Make artifact integrity mandatory

**Files:**
- Modify: `tests/strict-store.test.ts`
- Modify: `tests/strict-run.test.ts`
- Modify: `src/runtime/strict/verification.ts`
- Modify: `src/runtime/strict/reducer.ts`
- Modify: `src/runtime/strict/store.ts`

**Interfaces:**
- Produces: `StrictValidatorDerivation` with `artifactIntegrity` and `validatorResults`.
- Changes: `verifyStrictSkill(source, skillId, input)` requires the derived integrity result and throws `artifact-integrity` when it is false.

- [ ] **Step 1: Add the failing digest-mutation regression**

```typescript
test("rejects changed evidence even when the contract omits an integrity gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-evidence-mutated-"));
  const source = path.join(root, "report.json");
  await writeFile(source, "{}\n");
  const store = new StrictSkillRunStore(root);
  let run = beginStrictStep(readNextStrictChunk(fixtureRun(), contract.skillId).run, contract.skillId, contract.steps[0].id);
  await store.create(run);
  run = await store.ingestEvidence(run.runId, {
    sourcePath: source,
    kind: "report",
    validatedAs: "output",
    attributions: [{ skillId: contract.skillId, stepId: contract.steps[0].id, attempt: 1, relation: "produced", ruleIds: contract.rules.map(({ id }) => id) }],
  });
  await writeFile(path.join(root, run.artifacts[0].path), "changed\n");
  run = await store.update(run.runId, (current) => completeStrictStep(current, contract.skillId, contract.steps[0].id));

  await assert.rejects(
    store.verifySkill(run.runId, contract.skillId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "artifact-integrity",
  );
});
```

- [ ] **Step 2: Run the regression and verify RED**

Run: `node --test --test-name-pattern="changed evidence" tests/strict-store.test.ts`

Expected: FAIL because schema metadata currently permits verification.

- [ ] **Step 3: Return integrity separately from domain validator results**

In `src/runtime/strict/verification.ts`:

```typescript
export type StrictValidatorDerivation = {
  artifactIntegrity: Result;
  validatorResults: Record<string, Result>;
};

export const deriveStrictValidatorResults = async (
  projectRoot: string,
  run: SkillRunV2,
  ledger: SkillLedger,
): Promise<StrictValidatorDerivation> => {
  const artifactIntegrity: Result = integrity
    ? { passed: true }
    : { passed: false, message: "Staged artifact digest, size, path, or file type changed." };
  return { artifactIntegrity, validatorResults: results };
};
```

- [ ] **Step 4: Enforce integrity in the reducer boundary**

In `src/runtime/strict/reducer.ts`:

```typescript
export const verifyStrictSkill = (source: SkillRunV2, skillId: string, input: {
  artifactIntegrity: { passed: boolean; message?: string };
  validatorResults: Record<string, { passed: boolean; message?: string }>;
  systemGateResults?: Array<{ gateId: string; passed: boolean; level: "hard"; message?: string }>;
}): SkillRunV2 => {
  if (!input.artifactIntegrity.passed) {
    fail("artifact-integrity", input.artifactIntegrity.message ?? "Strict evidence integrity failed.");
  }
};
```

Update `StrictSkillRunStore.verifySkill` to pass the entire derivation and update direct reducer tests to explicitly pass `{ artifactIntegrity: { passed: true }, validatorResults }`.

- [ ] **Step 5: Run targeted tests and verify GREEN**

Run: `node --test tests/strict-store.test.ts tests/strict-run.test.ts tests/strict-pilots-e2e.test.ts`

Expected: PASS; a digest mismatch fails before gate reduction.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/runtime/strict/verification.ts src/runtime/strict/reducer.ts src/runtime/strict/store.ts tests/strict-store.test.ts tests/strict-run.test.ts
git commit -m "fix: require strict evidence integrity"
```

### Task 3: Derive Tailwind gates from observations and diff content

**Files:**
- Create: `src/runtime/strict/frontend-evidence.ts`
- Modify: `src/runtime/strict/verification.ts`
- Modify: `tests/strict-pilots-e2e.test.ts`
- Modify: `tests/strict-store.test.ts`

**Interfaces:**
- Produces: `deriveBrowserGateResults(value, artifacts): Record<string, Result>`.
- Produces: `deriveTailwindSourceResults(content): Record<string, Result>`.
- Consumes: existing `validateFrontendSources` and BrowserObservation-compatible fields.

- [ ] **Step 1: Add RED tests proving `checks: true` is rejected**

Change the Tailwind pilot test so its verification artifact initially remains:

```typescript
{ checks: browserChecks }
```

Assert that every `frontend/browser-hard-gates` gate fails with a message mentioning malformed observations. Add a source case whose `implementation-diff` contains `{ checks: { "no-dynamic-tailwind-classes": true } }` and assert the source gate does not accept it as a decision.

- [ ] **Step 2: Run the pilot regression and verify RED**

Run: `node --test --test-name-pattern="Tailwind pilot" tests/strict-pilots-e2e.test.ts`

Expected: FAIL because caller booleans still pass.

- [ ] **Step 3: Implement the frontend evidence parser**

Create `src/runtime/strict/frontend-evidence.ts` with these runtime-owned shapes and exports:

```typescript
import { validateFrontendSources } from "../../domains/frontend/design/source-validation.ts";
import type { EvidenceArtifact } from "./types.ts";

type Result = { passed: boolean; message?: string };
type Observation = {
  viewport: { width: number; height: number };
  state: string;
  screenshotPath: string;
  horizontalOverflow: boolean;
  clippedControls: string[];
  unreachableActions: string[];
  stickyOverlaps: string[];
  consoleErrors: string[];
  keyboardTraps: string[];
  invisibleFocus: string[];
  criticalAxeViolations: string[];
  reducedMotionVerified: boolean;
};

export const deriveBrowserGateResults = (
  value: unknown,
  artifacts: EvidenceArtifact[],
): Record<string, Result> => {
  const browserGateSlugs = [
    "required-states-covered", "no-horizontal-overflow", "no-clipped-controls",
    "no-sticky-overlap", "focus-visible", "no-runtime-console-errors", "reduced-motion-verified",
  ];
  const failed = (message: string) => Object.fromEntries(
    browserGateSlugs.map((slug) => [slug, { passed: false, message }]),
  );
  if (!record(value) || !Array.isArray(value.observations)) {
    return failed("verification-input must contain valid browser observations.");
  }
  const observations = value.observations.map(parseObservation);
  const screenshotSources = new Set(
    artifacts.filter(({ kind }) => kind.startsWith("browser-screenshot-")).map(({ sourcePath }) => sourcePath).filter(Boolean),
  );
  if (observations.some(({ screenshotPath }) => !screenshotSources.has(screenshotPath))) {
    return failed("Observation screenshot is not bound to ingested evidence.");
  }
  const widths = new Set(observations.map(({ viewport }) => viewport.width));
  return {
    "required-states-covered": { passed: [390, 768, 1440].every((width) => widths.has(width)) },
    "no-horizontal-overflow": { passed: observations.every(({ horizontalOverflow }) => !horizontalOverflow) },
    "no-clipped-controls": { passed: observations.every(({ clippedControls, unreachableActions }) => clippedControls.length === 0 && unreachableActions.length === 0) },
    "no-sticky-overlap": { passed: observations.every(({ stickyOverlaps }) => stickyOverlaps.length === 0) },
    "focus-visible": { passed: observations.every(({ invisibleFocus, keyboardTraps }) => invisibleFocus.length === 0 && keyboardTraps.length === 0) },
    "no-runtime-console-errors": { passed: observations.every(({ consoleErrors }) => consoleErrors.length === 0) },
    "reduced-motion-verified": { passed: observations.every(({ reducedMotionVerified }) => reducedMotionVerified) },
  };
};

export const deriveTailwindSourceResults = (content: string): Record<string, Result> => {
  const findings = validateFrontendSources([{ path: "implementation.diff", content }]);
  return {
    "no-dynamic-tailwind-classes": { passed: !findings.some(({ code, gate }) => code === "tailwind-dynamic-class" && gate === "hard") },
    "raw-colors-reviewed": { passed: !findings.some(({ code }) => code === "design-system-raw-color") },
    "repeated-class-bundles-reviewed": { passed: !findings.some(({ code }) => code === "tailwind-conflicting-utilities") },
  };
};
```

Implement `record` as a non-array object guard. Implement `parseObservation` as a closed-shape parser that requires finite positive viewport dimensions, a non-empty state and screenshot path, booleans for `horizontalOverflow` and `reducedMotionVerified`, and string arrays for every locator/error field. Catch parser errors in `deriveBrowserGateResults` and return `failed(error.message)` so every browser gate receives a deterministic failure.

- [ ] **Step 4: Wire derived results into strict verification**

In `src/runtime/strict/verification.ts`, parse only integrity-checked latest-attempt artifacts:

```typescript
const browser = deriveBrowserGateResults(verificationInput, artifacts);
const source = deriveTailwindSourceResults(await readText(projectRoot, implementationDiff));

// For frontend/browser-hard-gates and frontend/tailwind-source:
const result = gate.evaluator.validatorId === "frontend/browser-hard-gates"
  ? browser[gateSlug(gate.id)]
  : source[gateSlug(gate.id)];
```

Remove all reads of `evidence.checks`.

- [ ] **Step 5: Replace pilot fixtures with observation and diff evidence**

Use three screenshot artifacts whose `sourcePath` values are referenced by observations:

```typescript
const observations = [390, 768, 1440].map((width) => ({
  viewport: { width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 },
  state: "default",
  screenshotPath: `evidence/${width}.png`,
  horizontalOverflow: false,
  clippedControls: [],
  unreachableActions: [],
  stickyOverlaps: [],
  consoleErrors: [],
  keyboardTraps: [],
  invisibleFocus: [],
  criticalAxeViolations: [],
  reducedMotionVerified: true,
}));
```

Use diff text with a static Tailwind class for the passing source case and a template expression such as ``className={`bg-${color}-600`}`` for the failing case.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run: `node --test tests/strict-pilots-e2e.test.ts tests/strict-store.test.ts`

Expected: PASS; raw `checks` maps fail and observation/diff evidence drives the gates.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/runtime/strict/frontend-evidence.ts src/runtime/strict/verification.ts tests/strict-pilots-e2e.test.ts tests/strict-store.test.ts
git commit -m "fix: derive strict frontend gates from evidence"
```

### Task 4: Route critic findings through bounded repair

**Files:**
- Modify: `src/runtime/strict/verification.ts`
- Modify: `src/runtime/strict/reducer.ts`
- Modify: `src/runtime/strict/validation.ts`
- Modify: `src/runtime/strict/types.ts`
- Modify: `schemas/verification-report-v2.schema.json`
- Modify: `tests/strict-run.test.ts`
- Modify: `tests/strict-pilots-e2e.test.ts`

**Interfaces:**
- Produces: `core/gate/critic-findings` as an allowlisted runtime hard gate.
- Extends: reducer verification input with `systemGateResults`.

- [ ] **Step 1: Add RED tests for critical critic findings**

Add a strict-run regression with a valid immutable critic report:

```typescript
{
  schemaVersion: "2.0",
  skillId,
  criticInvocationId: "critic-2",
  executorInvocationId: "executor-1",
  outcome: "findings",
  findings: [{
    id: "critical-1",
    ruleId: contract.rules[0].id,
    severity: "critical",
    message: "The verified surface is still broken.",
    evidenceArtifactIds: [screenshotArtifactId],
    remediation: "Repair and recapture the surface.",
  }],
}
```

Assert first verification produces `repair-required`, `finalizeStrictRun` rejects it, and a completed repair plus fresh downstream evidence allows a later verification to become `used`.

- [ ] **Step 2: Run critic regressions and verify RED**

Run: `node --test --test-name-pattern="critic" tests/strict-run.test.ts tests/strict-pilots-e2e.test.ts`

Expected: FAIL because the critic schema gate currently ignores outcome and severity.

- [ ] **Step 3: Derive a runtime critic system gate**

In `src/runtime/strict/verification.ts`:

```typescript
export const criticSystemGateId = "core/gate/critic-findings";

const deriveCriticSystemGate = async (
  projectRoot: string,
  ledger: SkillLedger,
  artifacts: EvidenceArtifact[],
): Promise<{ gateId: string; passed: boolean; level: "hard"; message?: string } | undefined> => {
  const artifact = artifacts.findLast(({ validatedAs }) => validatedAs === "critic-report");
  if (!artifact) return undefined;
  const report = await parse(projectRoot, artifact);
  assertValidCriticReportV2(report, ledger.contract);
  if (report.outcome === "clean") return { gateId: criticSystemGateId, passed: true, level: "hard" };
  const repaired = ledger.steps.some(({ type, attempts }) =>
    type === "repair" && attempts.some(({ completedAt }) => completedAt !== undefined));
  return {
    gateId: criticSystemGateId,
    passed: repaired,
    level: "hard",
    ...(repaired ? {} : { message: `Critic reported ${report.findings.length} unresolved finding(s).` }),
  };
};
```

Return it in `StrictValidatorDerivation.systemGateResults`.

- [ ] **Step 4: Merge system gates in the reducer**

```typescript
const contractGateResults = ledger.contract.gates.map(/* existing reduction */);
const gateResults = [...contractGateResults, ...(input.systemGateResults ?? [])];
const hardPassed = gateResults.every(({ level, passed }) => level !== "hard" || passed);
```

Failed system gates must be included in `repairRequest.gateIds`, so the existing repair limit and retry flow apply unchanged.

- [ ] **Step 5: Validate allowlisted system gates in persisted reports**

In `src/runtime/strict/validation.ts`, require contract gates exactly once and permit `core/gate/critic-findings` at most once with `level: hard`. Recompute `hardPassed` from every persisted result. Update `schemas/verification-report-v2.schema.json` gate id description without weakening its closed shape.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run: `node --test tests/strict-run.test.ts tests/strict-store.test.ts tests/strict-pilots-e2e.test.ts`

Expected: PASS; unresolved findings enter repair, and a later completed repair can satisfy the system gate.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/runtime/strict/verification.ts src/runtime/strict/reducer.ts src/runtime/strict/validation.ts src/runtime/strict/types.ts schemas/verification-report-v2.schema.json tests/strict-run.test.ts tests/strict-pilots-e2e.test.ts
git commit -m "fix: enforce strict critic repair gate"
```

### Task 5: Share the safe run-lock implementation

**Files:**
- Create: `src/runtime/run-lock.ts`
- Modify: `src/runtime/skill-run/store.ts`
- Modify: `src/runtime/strict/store.ts`
- Modify: `tests/skill-run-store.test.ts`
- Modify: `tests/strict-store.test.ts`

**Interfaces:**
- Produces: `RunFileLock` with `acquire(runId)` and `release(lock)`.
- Produces: `RunFileLockHooks` retaining the v1 test hooks.
- Both stores supply a run-path resolver and error factory.

- [ ] **Step 1: Add the strict live-owner RED regression**

```typescript
test("does not reclaim an old strict lock owned by a live process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-live-lock-"));
  const store = new StrictSkillRunStore(root);
  const run = fixtureRun();
  await store.create(run);
  const lockPath = path.join(root, ".skillranger", "runs", `${run.runId}.lock`);
  await writeFile(lockPath, JSON.stringify({ token: "live-owner", pid: process.pid }));
  const old = new Date(Date.now() - 31_000);
  await utimes(lockPath, old, old);

  let entered = false;
  const pending = store.update(run.runId, (current) => {
    entered = true;
    return readNextStrictChunk(current, contract.skillId).run;
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(entered, false);
  await unlink(lockPath);
  await pending;
  assert.equal(entered, true);
});
```

- [ ] **Step 2: Run the strict lock regression and verify RED**

Run: `node --test --test-name-pattern="live process" tests/strict-store.test.ts`

Expected: FAIL because strict store unlinks the old live lock immediately.

- [ ] **Step 3: Extract the v1 ownership algorithm**

Create `src/runtime/run-lock.ts` with the existing v1 guard algorithm and this public boundary:

```typescript
export type OwnedRunLock = { path: string; token: string };
export type RunFileLockHooks = {
  beforeGuardPublish?: (input: { guardPath: string; candidatePath: string; token: string }) => void | Promise<void>;
  guardEntered?: () => void | Promise<void>;
  guardExited?: () => void | Promise<void>;
};

export class RunFileLock {
  constructor(private readonly input: {
    lockPath: (runId: string) => string;
    error: (message: string) => Error;
    hooks?: RunFileLockHooks;
  }) {}

  async acquire(runId: string): Promise<OwnedRunLock>;
  async release(lock: OwnedRunLock): Promise<void>;
}

export { lockTimeoutMs, staleLockMs };
```

Extract the bodies of `processIsAlive`, `parseOwnerMetadata`, `guardOwnerState`, `reclaimGuardIfAbandoned`, `acquireGuard`, `releaseGuard`, `withLockGuard`, `createLockWhileGuarded`, `acquireLock`, and `releaseLock` from `src/runtime/skill-run/store.ts:43-263` into private methods of `RunFileLock`. Rename `acquireLock` to `acquire` and `releaseLock` to `release`; replace every `new SkillRunError("run-integrity", message)` with `this.input.error(message)`. Keep the existing `dev`/`ino` guard identity comparison, live-PID preservation, token comparison, 25 ms polling, 5-second acquisition deadline, and deadline-free release exactly unchanged.

- [ ] **Step 4: Compose the shared lock in both stores**

In each store constructor:

```typescript
this.lock = new RunFileLock({
  lockPath: (runId) => `${this.runPath(runId).slice(0, -5)}.lock`,
  error: (message) => new StrictSkillRunError("run-integrity", message),
});
```

The v1 store passes its existing hooks and creates `SkillRunError("run-integrity", message)`. Replace private acquisition/release calls with `this.lock.acquire(runId)` and `this.lock.release(lock)`.

- [ ] **Step 5: Add dead-owner and concurrent update coverage**

Add strict tests that create a stale lock with a known-dead PID, verify it is reclaimed, and start two concurrent `readNextStrictChunk` updates for distinct chunks. Assert both receipts persist and revisions increase exactly once per committed update.

- [ ] **Step 6: Run all store tests and verify GREEN**

Run: `node --test tests/skill-run-store.test.ts tests/strict-store.test.ts`

Expected: PASS, including every pre-existing v1 lock contention test and the new strict live-owner test.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/runtime/run-lock.ts src/runtime/skill-run/store.ts src/runtime/strict/store.ts tests/skill-run-store.test.ts tests/strict-store.test.ts
git commit -m "fix: share safe run lock ownership"
```

### Task 6: Document the evidence contract and verify integration

**Files:**
- Modify: `docs/workflow-runtime.md`

**Interfaces:**
- Documents the observation-shaped `verification-input`, diff-text `implementation-diff`, mandatory integrity behavior, and critic repair semantics.

- [ ] **Step 1: Update strict v2 workflow documentation**

Add a compact JSON example:

```json
{
  "observations": [{
    "viewport": { "width": 390, "height": 844 },
    "state": "default",
    "screenshotPath": "evidence/390.png",
    "horizontalOverflow": false,
    "clippedControls": [],
    "unreachableActions": [],
    "stickyOverlaps": [],
    "consoleErrors": [],
    "keyboardTraps": [],
    "invisibleFocus": [],
    "criticalAxeViolations": [],
    "reducedMotionVerified": true
  }]
}
```

State explicitly that `checks` maps are rejected and that every screenshot path must reference ingested evidence.

- [ ] **Step 2: Run focused static and registry checks**

Run: `npm run build`

Expected: exit 0.

Run: `npm run check`

Expected: exit 0.

Run: `npm run validate:registry`

Expected: `Registry valid: 18 skills`.

- [ ] **Step 3: Run strict and store suites**

Run: `node --test tests/strict-*.test.ts tests/skill-run-store.test.ts`

Expected: all selected tests pass with zero failures.

- [ ] **Step 4: Run the full suite with a writable npm cache**

Run: `env npm_config_cache=/tmp/skillranger-npm-cache npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 5: Check patch hygiene**

Run: `git diff --check`

Expected: no output.

Run: `git status --short`

Expected: only the intended Task 6 documentation files are uncommitted.

- [ ] **Step 6: Commit Task 6**

```bash
git add docs/workflow-runtime.md
git commit -m "docs: define strict verification evidence"
```

- [ ] **Step 7: Review final commit range**

Run: `git log --oneline 3ac1abd..HEAD`

Expected: the design commit plus one focused commit for each implementation task.

Run: `git diff --stat 3ac1abd..HEAD`

Expected: changes limited to strict runtime, shared locking, focused tests, schemas, and workflow documentation.

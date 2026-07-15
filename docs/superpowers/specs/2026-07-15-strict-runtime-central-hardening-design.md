# Strict Runtime Central Hardening Design

## Context

Commit `3ac1abd` introduced the strict workflow runtime v2. Review found five ways its certification boundary can be bypassed or corrupted:

1. a persisted ledger can declare `used` without completed steps or a passing verification report;
2. artifact digest verification is optional because it only affects contracts that declare `core/artifact-integrity`;
3. Tailwind hard gates accept caller-authored `checks: true` decisions;
4. a valid critic report with findings can still reach `verified` while the repair step remains skipped;
5. a strict-run lock older than 30 seconds can be removed even when its owner is alive.

All five issues come from trusting mutable boundary data instead of re-deriving mandatory runtime invariants. The fix therefore belongs in the strict runtime core, not in individual callers or only in the two pilot contracts.

## Goals

- Make artifact integrity an unconditional prerequisite for strict verification.
- Reject persisted runs whose lifecycle, evidence graph, or generated decisions are inconsistent.
- Derive Tailwind source and browser gate results from structured evidence rather than submitted gate booleans.
- Prevent unresolved critic findings from producing a `used` outcome and route them through bounded repair.
- Prevent stale-lock recovery from stealing a lock owned by a live process.
- Preserve CLI/MCP parity and the existing v2 contract format unless a contract change is necessary to describe evidence.

## Non-goals

- The local JSON file will not become cryptographically tamper-proof against a user who can rewrite the repository and runtime code together.
- The runtime will not install or secretly execute a browser. Browser observations remain host-produced evidence.
- This change will not introduce a general plugin validator API or signed remote attestation protocol.
- Legacy v1 run semantics will not change.

## Chosen Architecture

The strict runtime will enforce a non-configurable certification kernel around contract-defined gates. Contracts can add domain gates, but they cannot disable artifact integrity, lifecycle consistency, or critic resolution.

### 1. Persisted lifecycle validation

`assertValidStrictSkillRun` will validate the complete persisted state graph:

- ledger steps must be an exact structural snapshot of `contract.steps` plus runtime-owned `status` and `attempts`;
- attempt numbers must be consecutive, timestamps must be structurally valid, and completion fields must agree with step status;
- every attempt evidence id must resolve to one artifact, and every artifact attribution must resolve to the declared ledger, step, attempt, and canonical rule id;
- `used` requires all non-repair workflow steps satisfied, no active or pending steps, and a latest verification report with `hardPassed: true`;
- verification report gate ids and levels must match the contract plus allowlisted runtime system gates, and `hardPassed` must equal the derived hard-gate result;
- `no-op` requires `applicability.applicable: false`;
- prerequisite-blocked ledgers require a non-empty unmet-prerequisite set;
- repair counters, requests, report iterations, and step status must remain mutually consistent;
- the aggregate run state must be compatible with its ledger states and outcomes.

The validator detects structural corruption and direct outcome forgery. File-content checks remain asynchronous and run at the store boundary.

### 2. Mandatory artifact integrity

`deriveStrictValidatorResults` will return an explicit integrity result covering every artifact used by the latest attempts. `verifyStrictSkill` will refuse verification with `artifact-integrity` when any referenced file is missing, is not a regular file, has the wrong size, escapes the project root, or has a digest mismatch.

This check is mandatory even when the execution contract does not declare `core/artifact-integrity`. Schema-valid gates may continue to rely on `validatedAs` because ingestion validates the immutable bytes and verification now proves those exact bytes are unchanged.

### 3. Runtime-derived Tailwind gates

The strict Tailwind verifier will stop reading `checks` maps.

- `verification-input` will contain browser observations using the existing BrowserObservation-compatible fields: viewport, state, screenshot path, overflow flag, clipped/unreachable/sticky locator arrays, console errors, keyboard/focus failures, accessibility failures, and reduced-motion status.
- Runtime code will parse the observations, require coverage for the contract's required viewports, bind every screenshot path to an ingested screenshot artifact, and derive the hard gate results from the observation fields.
- `implementation-diff` will be treated as source/diff text. Runtime code will call the existing frontend source validator over that content and derive the Tailwind source gates from actual findings. Submitted `checks` properties will have no meaning and will fail the new evidence shape.

The host still supplies observations, but it supplies measurements and locators rather than SkillRanger's final pass/fail decisions.

### 4. Critic findings and bounded repair

The verifier will parse the latest immutable critic report and add an allowlisted runtime system gate for critic resolution.

- `outcome: clean` passes the system gate.
- `outcome: findings` fails until a later completed repair attempt exists after the critic evidence.
- a failed critic system gate opens the normal bounded repair cycle and cannot produce `used`.
- after the repair step and fresh downstream evidence complete, the prior critic findings are considered addressed for that iteration; a newer critic report would supersede the older one.
- reaching `maxRepairIterations` with unresolved critic or domain hard gates produces `blocked`.

This preserves the current contract order—critic before the initially skipped repair step—while ensuring that findings cannot be ignored.

### 5. Safe strict-run locking

The proven v1 lock ownership algorithm will be extracted into a shared runtime lock component and reused by both v1 and strict stores. The component retains token ownership, PID liveness checks, guarded stale-lock replacement, atomic acquisition, and release that cannot delete another owner's lock.

Strict-store tests will cover a live owner older than the stale threshold, a dead stale owner, concurrent reclaimers, and monotonic concurrent updates. Existing v1 lock tests must remain unchanged and green.

## Data Flow

1. Evidence ingestion validates schema-declared JSON, hashes the exact bytes, and copies them to the run artifact directory.
2. Step completion records only evidence ids belonging to the active attempt.
3. Verification reloads every latest-attempt artifact, proves path/size/digest integrity, and parses only integrity-checked bytes.
4. Core validators derive browser, source, performance, critic, and system gate results.
5. The reducer creates the verification report, opens bounded repair when a hard gate fails, or records `used` only when all contract and system hard gates pass.
6. Every store read and write validates the complete persisted lifecycle graph.
7. Finalization accepts only terminal ledgers whose persisted outcomes are supported by those validated reports and evidence links.

## Error Handling

- Missing or changed evidence returns `artifact-integrity`; it is treated as corruption, not repairable evidence failure.
- Malformed browser/source evidence produces a failed validator result with a precise message and enters bounded repair when the related gate is hard.
- Inconsistent persisted state returns `run-integrity` before any update overwrites the file.
- Unresolved critic findings use the normal repair request and repair limit.
- Lock timeout preserves the previous run and returns `run-integrity`; a live lock is never reclaimed solely because of age.

## Testing Strategy

Implementation follows red-green-refactor, one defect at a time:

1. Persisted-run regression: forge `used` on a pending ledger and prove read/finalize rejects it.
2. Integrity regression: mutate an ingested artifact and prove verification returns `artifact-integrity` even without a contract integrity gate.
3. Browser/source regression: prove `checks: true` no longer passes; then prove valid observations and clean diff-derived findings do pass.
4. Critic regression: prove a critical finding opens repair and cannot finalize; then complete repair plus fresh evidence and prove verification can pass.
5. Lock regressions: prove a live stale lock is preserved and concurrent recovery cannot overlap critical sections.

After targeted tests pass, run build, syntax check, registry validation, the strict test subset, and the full test suite with a writable npm cache.

## Compatibility and Migration

- CLI and MCP command names remain unchanged.
- Existing strict runs containing caller-authored Tailwind `checks` evidence will fail verification and must add observation-shaped evidence in a fresh attempt.
- Contract schema version remains `2.0`; the evidence shape is runtime-owned and documented in the workflow runtime guide.
- No new runtime dependency is introduced.


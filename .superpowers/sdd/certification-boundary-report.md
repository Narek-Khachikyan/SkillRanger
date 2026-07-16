# Certification Boundary Report

## Status

Implemented the strict runtime certification boundary without changing frontend class analysis or schema versions.

- Runtime validator derivations are registered in a module-private `WeakSet`; the deep raw reducer rejects plain and cloned inputs before reading integrity or gate booleans.
- Verification report construction and finalization comparison share one evidence/gate projection, including exact gate order and cardinality.
- `StrictSkillRunStore.finalizeRun(runId)` owns the run lock, reloads the persisted run, reopens current evidence, re-derives built-in gates for every `used` ledger, compares the latest passing report, and only then persists the final state.
- Missing or changed evidence fails with `artifact-integrity`; a structurally valid report that disagrees with runtime derivation fails with `run-integrity`.
- Generic store updates cannot transition a run to `verified`.
- Pure finalization is now a non-exported store-local reduction; the supported strict index and deep reducer expose no raw finalizer.
- CLI `run:finalize` and MCP `finalize_skill_run` now call the store-owned finalizer while preserving response shapes.

## Test Evidence

- Focused strict/CLI/MCP: 148 passed, 0 failed.
- All strict plus strict CLI: 140 passed, 0 failed.
- Actual v1 lifecycle (`skill-run`, CLI runs, shared start): 57 passed, 0 failed.
- `npm run build`: passed.
- `npm run check`: passed.
- `npm run validate:registry`: 18 skills valid.
- `npm run lint:skills`: 18 skills valid.
- `npm run audit:registry`: 18 skills, 0 failed.
- Full suite with isolated npm cache: 593 passed, 0 failed.

The first full-suite attempt passed 592 tests and failed only because `npm pack` could not write a root-owned entry in the user npm cache. Re-running unchanged code with `npm_config_cache=/tmp/skillranger-npm-cache` passed all 593 tests.

## Self-Review

- Confirmed `finalizeStrictRun` is absent from the supported strict index and deep reducer.
- Confirmed CLI and MCP have no remaining raw-finalizer imports.
- Confirmed the shared projection is used by verification and finalization, while persisted validation uses the same gate-order helper.
- Confirmed no class-analysis files, exports map, dependencies, v1 schemas, or v2 schema versions changed.
- Saved the complete working diff to `/tmp/diff` for final inspection.

## Concerns

No code concerns remain. The user-level npm cache ownership issue is environmental and was avoided with an isolated `/tmp` cache; no permissions or user files were changed.

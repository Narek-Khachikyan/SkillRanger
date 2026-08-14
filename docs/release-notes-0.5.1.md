## Summary

SkillRanger 0.5.1 is a patch release that hardens the router's runtime coupling, enforces always-on core (universal) skill output contracts, and makes verification recording mandatory for verification-required lifecycle runs. The frontend design contract is unchanged: the package and the frontend domain publish the same 0.5.1 release identity over the same six-family/18-rule contract, eight recipe packs, 80 deterministic worked-example assets, and the frozen visual benchmark pinned to `visual-benchmark-v1`.

## What's changed

- Consolidated the router's three runtime adapter sites into one bridge module (`src/router/runtime-bridge.ts`): lifecycle payload construction (including the recommendations shim), the runtime-store dispatch between the lifecycle-v1 and strict-v2 stores, and the mandatory-read bridge. Task preparation and the read surface consume them through a single `RouterRuntimeBridge` interface.
- Extracted the routing pipeline into `src/router/pipeline.ts`, unified router skill metadata behind one canonical factory, and migrated the router evaluations onto the same pipeline consumed by production routing.
- Bridged CLI `task:read` onto the shared mandatory-read reader: completed mandatory reads now record into the runtime run with the same journaled semantics as MCP `read_run_skill_file` — a lifecycle-v1 run gains a content-delivered read record, and a strict-v2 run syncs its chunk receipts — so a CLI-driven lifecycle run can proceed to `run:begin` without stalling in `skills-selected`.
- Added output-contract enforcement for always-on core (universal) skills (ADR 0008): manifests may declare `outputContract.requiredReportFields`, registry validation rejects unknown properties and unsafe field ids, and lifecycle `verify_skill_run` blocks until the report's `universalContracts` section satisfies every required field declared by the run's selected core skills.
- Made the server the sole author of the verification report file: `reportPath` must stay inside the project root (absolute paths are accepted only inside it, and the write walks path components to reject symlink escapes), and the report — or a verification-blocked status record — is written atomically.
- Made verification recording mandatory for verification-required lifecycle runs (ADR 0009): a run closed as implemented without recorded verification carries the `verification-required-unrecorded` notice on both `complete_skill_run` and `inspect_skill_run`, in the CLI and the MCP surface, while the structured run payload stays exactly the persisted record.
- Expanded the managed guidance block and MCP tool descriptions for the mandatory-verification notice, universal output contracts, and persisted-state outcome claims.

## Verification

- `pnpm release:check` passed at the release commit: build, test suite, registry validation/lint/audit, publish gate, frontend certification, frontend routing eval gates, router golden gate, and package smoke.

The npm package publish is intentionally performed separately.

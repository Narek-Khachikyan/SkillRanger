## Summary

SkillRanger 0.4.1 is a patch release that hardens strict-v2 verification ownership and the catalog-assisted router's nomination handling. The frontend design contract is unchanged: the package and the frontend domain publish the same 0.4.1 release identity over the same six-family/18-rule contract, eight recipe packs, 80 deterministic worked-example assets, and the frozen visual benchmark pinned to `visual-benchmark-v1`.

## What's changed

- Established a trusted validator registry in the strict runtime with ownership validation: evaluator ids are resolved before a run starts, and only domain-owned validators may serve core gates (`src/runtime/strict/validator-registry.ts`, ADR 0004).
- Moved browser hard gates, performance claims, and Tailwind source checks behind the frontend domain validator; removed the legacy validator dispatch while locking persisted-run compatibility.
- Added a pure nomination-resolution module to the router: declared ambiguity, ordered nominations, and explicit skill choices now resolve through the same nomination decision as the catalog-bound proposal path, including continuation and post-retrieval primary arbitration.
- Preserved cross-domain primary nominations and restored declared-order ranking for nomination-order-only callers; gated model-assisted routing evals in the test suite.
- Documented the tag → GitHub release → npm publish steps in `RELEASE.md`.

## Verification

- `pnpm release:check` passed at the release commit: build, 91-file test suite (1162 tests), registry validation/lint/audit, publish gate, frontend certification, frontend routing eval gates (157 trigger prompts, 54 task evals), router golden gate, and package smoke.
- Package smoke passed for `skillranger-0.4.1.tgz`.

The npm package publish is intentionally performed separately.

## Summary

SkillRanger 0.6.0 is the routing world loader and canonical identity release. Task preparation and both router evaluation suites load every Routing world through one loader with replace and merge fixture modes, the Routing entry fronts the routing pipeline, and one canonical identity module owns normalization, source-form validation, and skill indexing across every Routing module and evaluation adapter. Lifecycle-v1 verification reports become a published collect-all contract (ADR 0010). The frontend design contract is unchanged: the package and the frontend domain publish the same 0.6.0 release identity over the same six-family/18-rule contract, eight recipe packs, 80 deterministic worked-example assets, and the frozen visual benchmark pinned to `visual-benchmark-v1`.

## What's changed

- Added the Routing world loader (`src/router/world.ts`): `replace` mode builds a fully synthetic world from fixture packs (no bundled packs, registry skills, or routing context content), and `merge` mode composes fixture domains and skills over the bundled world where a fixture entry with the same id overrides the bundled one. CLI/MCP task preparation, the golden router evaluations, and the model-assisted evaluations all enter through it (#120–#123).
- Introduced the Routing entry (`src/router/entry.ts`) over the routing pipeline: the pipeline owns the `semantic-recall-limited` fallback warning, the entry owns target-agent handling, and the domain glossary names the entry (#126, #127, #130).
- Finished the canonical identity module (`src/router/canonical.ts`, #132): one interface owns canonical normalization (NFKC, surrounding-whitespace trim, lowercase), canonical source-form validation (1–128 ASCII characters, first character a lowercase letter or digit), and canonical skill indexing. The Routing entry, routing proposals, Router store, metadata validation, vocabulary validation, fixtures, skill inputs, the CLI task surface, domain-pack validation, and the model-assisted evaluation adapter consume it; private canonical ID patterns were removed. Externally observable routing behavior, validation outcomes, error codes, and deterministic evaluation results are unchanged.
- Kept backward compatibility for the registry kind rename: `test-fixture` remains accepted as an alias of `replace` in `PrepareTaskCoreInput.registry.kind`, so pre-rename callers do not silently fall into the bundled path.
- Published the lifecycle-v1 verification report contract (ADR 0010): the `verify_skill_run` report schema is exposed on the MCP tool surface and validation is collect-all — one call reports every violation instead of one per call — while strict-v2 stays the migration target with unchanged semantics.
- Added the optional `targetSurface` field to domain-pack manifests (schemaVersion 1.2): the frontend domain declares `web`, and the resolver applies cross-surface ambiguity resolution for bundled domains.
- Metadata validation now reports both the byte-limit diagnostic and the canonical-token diagnostic for overlong tokens (129+ ASCII characters); rejection outcomes are unchanged.

## Verification

- `pnpm release:check` passed at the release commit: build, test suite, registry validation/lint/audit, publish gate, frontend certification, frontend routing eval gates, router golden gate, and package smoke.

The npm package publish is intentionally performed separately.

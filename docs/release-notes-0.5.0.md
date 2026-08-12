## Summary

SkillRanger 0.5.0 is the frontend design craft release. The package and frontend domain publish the same 0.5.0 release identity over the same six-family/18-rule contract, eight recipe packs, 80 deterministic worked-example assets, and the frozen visual benchmark pinned to `visual-benchmark-v1`.

## What's changed

- Added the first **core (universal) skills** — always-on, domain-agnostic behavioral guidance (`core.proportional-engineering`, `core.universal-safety`) owned by a new minimal `core` domain pack, delivered first in router-level mandatory read order and bounded by the new `maxCoreSkills` router config (default 3). Guidance-only: audited and catalogued like curated skills but excluded from the strict runtime's contract/verification machinery. See ADR 0006.
- Added a provenance-labelled craft reference layer to the frontend pack (`domains/frontend/craft/`): type pairings, OKLCH palette recipes, macrostructures, and component cookbooks with the observed/inferred/assumed/unknown evidence ladder. Craft references are knowledge, not rules — they never participate in the six-family rule-selection contract. `npm run bundle:craft` copies them byte-identically into the bundled polish skill at build time. See ADR 0007.
- Added DNA-extraction mode to the reference-handling skill with an attribute-vs-trade-dress boundary, evidence ladder, and pixel-clone refusal, surfaced through the MCP `referenceDna` argument on the frontend result validators.
- Moved the design direction contract to **schemaVersion 1.1** with macrostructure and theme-axes identity fields. New directions must emit 1.1 (legacy 1.0 directions remain loadable but cannot be certified).
- Made the deterministic identity-diversification gate compare only the certified direction's identity — resolved from the latest design-direction step attempt, never a stale or unselected candidate — with the window N read from the optional `execution-policy` evidence (default 3) and a tooling-written `.design/diversification-log.json` awareness cache.
- Added a `bounded-motion` hard gate (transition-all, bouncy overshoot easing) to the browser hard-gate set; mechanical motion checks are now hard.
- Extended the visual critic contract to 1.1 with the expanded AiSlop code set while keeping 1.0 reports backward-readable.
- Low-level MCP tools now resolve an omitted `projectRoot` to the fixed server root instead of the process working directory, keeping runs prepared via `prepare_task` reachable by the lifecycle tools.
- Versioned skill bumps: `frontend.design-to-code` 0.3.1, `frontend.visual-critic` 0.1.1, `frontend.visual-design-polish` 0.3.2.

## Verification

- `pnpm release:check` passed at the release commit: build, test suite, registry validation/lint/audit, publish gate, frontend certification, frontend routing eval gates, router golden gate, and package smoke.

The npm package publish is intentionally performed separately.

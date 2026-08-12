# Frontend design craft as a provenance-labelled reference layer

- Status: Accepted
- Date: 2026-08-12
- Scope: frontend domain pack, frontend skills, visual verification contracts

SkillRanger's frontend pipeline verifies rigorously but carries little parametric design knowledge (no type pairings, palettes, macrostructures, or component cookbooks). We close that gap with a provenance-labelled craft reference layer inside the frontend domain pack, expand the closed AiSlopCode set with the recurring AI tells observed in real design work, and make diversification deterministic through a snapshot-semantics hard gate over persisted run artifacts instead of a self-written log. All craft content is written fresh, in our own words, from first principles and the maintainer's own design experience; no external skill text, structure, or tables are reproduced.

## Decision

- Craft knowledge (type pairings, palette recipes, macrostructures, component cookbooks) lives in a new `domains/frontend/craft/` reference layer, advisory to the direction step and outside the six-family rule-selection contract. Craft files are copied into the skill package's `references/` directory at registry build/publish time, before the existing install pipeline copies the package verbatim; the domain pack remains the source of truth and the promotion path into bundled rules stays open.
- The six-rule selection contract and hard gate `direction-rule-selection-contract` remain unchanged; craft references are not rules and are not selected by the direction. `design-direction.schema.json` gains two required declared identity fields — a named `macrostructure` and the theme axes — which is a normative change: the schema bumps to `schemaVersion` 1.1 and the validator accepts both 1.0 (loadable legacy, pinned schema snapshots) and 1.1 directions.
- Identity is recorded, not duplicated: the diversification gate reuses the existing treatment axes already in `direction.json` (`composition`, `material`) and adds the declared identity fields (named macrostructure, paper band, display style, accent hue). There is exactly one direction contract and no parallel axis system; the gate compares a fingerprint of the reused treatment axes plus the declared identity fields.
- The closed AiSlopCode enum expands by a curated set of visually observable AI tells (generic font stack, gradient abuse, centred hero, eyebrow-everywhere, italic display heading, glassmorphism, glowing orb). Motion/implementation tells (`transition-all`, bouncy easing) are NOT critic codes — the critic is code-free and reads static screenshots, so those tells move to the mechanical browser-adapter gates where they are observable from computed styles. This extends the browser adapter contract: the adapter must report the computed `transition-property` and `transition-timing-function` of interactive elements for the mechanical gates to fire. The critic change is a normative schema change: `visual-critic-report.schema.json` bumps to `schemaVersion` 1.1 (matching the critic contract's own version convention, not rule-library semver) and existing validators migrate.
- The AiSlopCode enum lives in five places and all are updated together: domain schema, skill `output.schema.json`, `visual-loop-types.ts`, the validator hard-code set in `critic.ts`, and the `schemaVersion !== "1.0"` checks. The `frontend.visual-critic` skill instructions gain per-code detection rubrics so the new names are not noisy.
- Diversification is deterministic with snapshot semantics: the store gains a read-only capability to enumerate a project's verified runs; at verification time the gate compares the current direction against the last N verified run directions and writes the comparison snapshot (run ids + direction digests) into the verification report; finalization re-checks against that recorded snapshot rather than re-deriving against a moving set. N lives in the execution policy (default 3), alongside `variantLimit` and `requiredViewports`. Only the selected variant's direction is compared, not unselected candidates.
- The gate checks declarations; the critic confirms them against evidence. The critic instructions require the declared macrostructure/paper band/accent hue to be checked against the screenshots, so a paper-declaration that does not match the render cannot certify.
- A project-scoped `.design/diversification-log.json` is written by tooling from verified run facts as a derived cache for the model's in-session awareness only; it is not the enforcement mechanism and not written by the model.
- A small catalog of 5–7 themes with OKLCH tokens, genre affinities, and per-theme bans ships as craft references (provenance-labelled, extensible). The identity-fingerprint mechanism is the contract; the catalog is not.
- Craft references record provenance through the existing `observed | inferred | assumed | unknown` evidence ladder, reflecting the maintainer's own analysis and design experience. No attribution to external skill packages is recorded, because none of their text is used.
- The `study` capability is added to `frontend.design-to-code` as a DNA-extraction mode (macrostructure, type pairing, colour anchor → provenance-labelled artifact in `.design/`); it keeps the existing attribute-vs-trade-dress boundary and refuses pixel clones.

## Consequences

- The direction step gains optional craft loading and an explicit stated pick of macrostructure/theme axes, preventing the same-shape-same-palette repetition the verification machine cannot see.
- Diversification becomes a deterministic, replayable property: the gate outcome is pinned by the snapshot in the verification report, so a run completing between verify and finalize cannot flip the result.
- The critic contract version bumps to 1.1; older persisted 1.0 reports remain loadable, and new critic runs must emit the expanded enum. Legacy 1.0 reports keep their 9-code vocabulary.
- The direction contract version bumps to 1.1; older persisted 1.0 directions remain loadable and are pinned by existing schema snapshots in strict-run ledgers.
- `transition-all` and bouncy-easing become mechanical browser gates, so the evidence adapter must report them from computed styles; this extends the mechanical-checks surface, not the critic.
- The store gains an enumeration capability for verified runs — a new read-only API, previously absent.
- Craft references are promotable: anything that recurs and passes the tiered promotion bar may graduate into a bundled design rule later without touching the verification machinery.
- `frontend.design-to-code` gains a structured reference-analysis path without a new skill package.
- Contract and skill changes pin full skill text in strict-run fixtures, so fixture regeneration is expected with this change.

## Rejected options

- A new `frontend.design-craft` skill was rejected: craft is domain knowledge, not a delivery unit, and a skill package would place it outside domain evolution and promotion.
- Enriching existing rules with parametric constraints was rejected: hard gates evaluate which rules were selected, not design content, so parametric numbers inside rule constraints would either go unchecked or silently change gate semantics.
- A parallel third axis system for the gate was rejected: the gate reuses the existing treatment axes and adds only the two declared identity fields, keeping one direction contract.
- A self-written project log as the diversification enforcement mechanism was rejected because the model can evade its own log.
- Motion and implementation tells as critic codes were rejected because the code-free critic observes static screenshots only; they belong to the mechanical browser gates.
- Reproducing external skill content verbatim, with or without attribution, was rejected: SkillRanger ships only content written from first principles on the maintainer's own experience. The analysis of public design work informs which tells and recipes to cover; their expression is our own.

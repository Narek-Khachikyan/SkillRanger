# Frontend design pattern distillation — issue #25 (2026-08-04)

## Decision

The accepted corpus supports **reusing observable design constraints**, not
reusing a source product's visual identity. The safest 0.4.0 decision is:

1. Keep the existing six-family rule contract and map corpus observations to
   existing rules first.
2. Promote a candidate to a versioned rule only when it recurs in at least two
   independent product sources, can be stated without a brand token, and has a
   deterministic visual/accessibility check.
3. Use worked examples for product grammar, exact token values, and qualitative
   composition. Examples must show good/bad scenes and remain explanatory assets,
   not production UI templates.
4. Do not add a new rule or registry skill from this research alone. The accepted
   corpus is a strong hypothesis set, but it is not yet a multi-product
   recurrence study: the main concrete specimen is Linear, represented by
   Refero and DesignMD, while Neuform supplies one qualitative template.

This answers issue [#25](https://github.com/Narek-Khachikyan/SkillRanger/issues/25)
under the corpus accepted in [#26](https://github.com/Narek-Khachikyan/SkillRanger/issues/26).
The parent map is [#24](https://github.com/Narek-Khachikyan/SkillRanger/issues/24);
the separate promotion-evidence decision remains open in
[#27](https://github.com/Narek-Khachikyan/SkillRanger/issues/27).

## Rule provenance acceptance

Each bundled rule records two distinct provenance entries: the Refero semantic
reference and the DesignMD computed-style benchmark. These are independent
source/extraction records for the accepted corpus, and both remain `inferred`
because SkillRanger normalizes them into its own contract. Their agreement is
source-level recurrence, not independent-product recurrence; a new rule or a
normative revision still requires a second independent product specimen and
the visual/accessibility promotion evidence in this document.

## What the corpus actually establishes

The accepted corpus is a **role-separated reference-tool corpus**, not six
product designs. Its resolution names:

- [Refero Linear style](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1)
  as the primary semantic corpus. The inspected state is `DESIGN.md → Extended`
  (with CSS Variables, Tailwind v4, and Design Tokens as adjacent output modes).
  It exposes semantic roles, a type scale, spacing/radius values, layout prose,
  and do/don't guidance.
- [Neuform Latest Perspectives & Strategies](https://neuform.ai/template/latest-perspectives-strategies)
  as a supplementary public template preview. It explicitly describes clear
  hierarchy, information density, modular panels, and interface rhythm, but it
  is one qualitative template, not a comparative benchmark.
- [DesignMD CLI](https://designmd.cc/cli) and the public
  [Linear benchmark](https://designmd.cc/benchmarks/linear) as measurement and
  triangulation evidence. DesignMD says colors come from computed styles,
  typography from the cascade, breakpoints from live `@media` rules, and its
  benchmark is a measured snapshot with a raw-extraction state.
- [designmd.supply](https://github.com/context-dot-dev/designmd-supply) as an
  extractor pipeline description. Its README names styleguide, brand,
  screenshot, and Markdown inputs and says the final Google-format document is
  composed through an LLM; therefore its output is not independent proof of a
  pattern.
- [getdesign.md](https://getdesign.md/) as a catalog/follow-up source, not
  evidence of a live, self-service extraction state.
- [design-md-chrome](https://github.com/bergside/design-md-chrome) as a capture
  convenience. It reads the active-tab state and emits TypeUI-format output;
  this is not the same schema as Google `DESIGN.md`.

The corpus itself records this boundary in the accepted [#26 resolution
comment](https://github.com/Narek-Khachikyan/SkillRanger/issues/26#issuecomment-5177030284).

## Distilled candidate patterns

The “confidence” column describes what this corpus establishes today, not a
claim about all products.

| Candidate observable pattern | Generalizable boundary | Existing SkillRanger fit | Decision: rule or example | Evidence today |
| --- | --- | --- | --- | --- |
| **Semantic roles beat raw pigments.** Colors are named by function (canvas, surface, text, border, action, status), and accents are used for meaning rather than decoration. | Generalizable when roles survive a palette change and non-color cues remain. Exact Linear colors, “acid lime”, and dark-first treatment are brand-specific. | `color.semantic-roles`; `color.commerce-trust`; `color.operational-status`; recipe `validationRules` for proof/status visibility. | **Existing versioned rule**, with a future cross-product worked example. Do not create a new color family. | Strong as a repeated extraction vocabulary: Refero's Linear page exposes role-labelled palette entries; DesignMD documents measured color pairs and interaction states. Still not independent-product recurrence. |
| **A small, named geometry vocabulary creates coherence.** Spacing, radii, and elevation use a constrained scale rather than arbitrary one-offs. | Generalizable as bounded vocabulary and role mapping. `4px`, `12px`, hairlines, and exact shadow values are source observations, not universal values. | Mechanical checks enforce spacing scale, max three radii, max three shadows, and no unroled one-off colors. `color.semantic-roles` and the recipe `forbiddenDefaults` reinforce it. | **Versioned mechanical contract already exists.** Exact source token values belong in worked examples only. | Refero Linear exposes a 4px base, compact spacing, and a small radius set; DesignMD exposes measured tokens. The agreement is tool-level triangulation of one product, not multi-product proof. |
| **Hierarchy is role-based, not size-only.** Distinct display/body/meta roles and controlled reading measure make the primary task scannable. | Generalizable if role contrast, semantic headings, and readable measure are preserved while typeface and scale vary. Inter, Berkeley Mono, low weights, and tight tracking are brand-specific. | `typography.role-contrast`; `typography.editorial-product`; `typography.dense-workspace`; recipe validation for semantic hierarchy and reading measure. | **Existing versioned rule.** A worked example may show a dense technical surface and an editorial surface as different applications of the same roles. | Refero provides explicit type roles and a 1.2 scale; DesignMD provides measured typography. This is the strongest candidate for independent checking, but needs a second independent product specimen before claiming corpus recurrence. |
| **Primary action stays adjacent to the evidence/state that justifies it.** Claim/evidence/action is a compositional unit. | Generalizable for decisions, conversion, commerce, and discovery. It must not force adjacency when a product's task is intentionally staged or sequential. | `layout.action-evidence`; `signature.conversion-proof`; `color.commerce-trust`; recipe validation for traceable claims and visible fulfillment/proof. | **Existing versioned rule**, plus worked examples for marketing, commerce, and consumer discovery. | Supported as a design principle by Refero's product-screenshot and CTA descriptions and by the existing recipe grammar, but not directly cross-product measured in the accepted corpus. Treat as a candidate until tested. |
| **The product's real data/object is the signature move.** Product UI, work objects, catalogue content, evidence, or status supplies texture and hierarchy instead of generic decoration. | Generalizable as an anti-slop constraint: the memorable behavior must be tied to real product meaning. It does not generalize a specific screenshot composition. | `signature.product-data-grammar`; recipe-specific `signatureMovePatterns`; critic anti-patterns `invented-proof`, `meaningless-decoration`, `interchangeable-saas-layout`. | **Existing versioned rule**, with recipe-specific worked examples. | Refero and DesignMD both describe Linear's own UI as the visual texture/signature. Neuform describes reusable page direction, but its template is not proof of universality. |
| **Responsive design recomposes the task.** Mobile is not merely a vertically stacked desktop. | Generalizable only when the primary action, state context, and return path remain reachable; exact breakpoints and mobile layout are product-specific. | `responsive.recompose-not-stack`; `responsive.list-detail-drill-in`; `responsive.mobile-thumb-zone`; recipe mobile strategies. | **Existing versioned rules**, but do not change them from this corpus. Add a worked example only after capturing a real before/after state. | DesignMD establishes that live breakpoints can be extracted; the accepted corpus does not provide a verified mobile interaction matrix. Insufficient as a promoted observation. |
| **State quality is part of the design grammar.** Loading, empty, error, success, offline, and recovery states continue the same primary flow. | Generalizable as state continuity and recovery. A source's animation, copy, and exact empty/error composition are product-specific. | `state.complete-primary-flow`; `state.recovery-first`; `state.optimistic-offline`; existing recipe `requiredStates`. | **Existing versioned rules.** A worked example is appropriate for each recipe's state matrix, not a source-specific component template. | Extractors claim hover/focus/state capture, and design-md-chrome claims motion capture, but the accepted corpus has no independently verified before/after state evidence. Treat as an evaluation requirement, not new corpus proof. |
| **Quiet structural depth can replace decorative effects.** Borders/inset separation and restrained elevation can carry grouping. | Generalizable as intentional, limited elevation; not as “always dark”, “always hairline”, or “never shadows”. | Mechanical max-shadow/radius checks; `color.semantic-roles`; critic anti-pattern `meaningless-effects`. | **Worked example**, unless recurrence appears across independent products with measurable benefit. | Refero Linear and DesignMD Linear both describe subtle borders/inset depth. Same-product corroboration is insufficient for a universal versioned rule. |
| **Modular panels with clear density/rhythm.** Panels are grouped around a readable hierarchy and operational rhythm. | Generalizable as grouping and hierarchy; panel shapes, counts, and dashboard composition are recipe-specific. | `layout.list-detail`, `typography.dense-workspace`, `layout.action-evidence`; recipes `operational-command-center` and `saas-workspace`. | **Worked example only.** Neuform's template is one public qualitative specimen. | Neuform page state explicitly names hierarchy, density, modular panels, and rhythm. It does not provide a comparative score or enough independent examples for a new rule. |

### Generalizable versus brand-specific

Generalizable candidates describe relationships that can be measured without
mentioning a source brand: semantic role mapping, bounded token vocabulary,
heading/body/meta contrast, readable measure, action/evidence adjacency,
product-data-backed signature, responsive task preservation, and complete state
continuity. They can be phrased as constraints, preconditions, and verification
observations in the existing rule contract.

Brand-specific decisions must stay in examples or source provenance: Linear's
near-black canvas, acid-lime accent, Inter/Berkeley Mono pairing, exact weights
and tracking, exact radius and spacing values, screenshot-card treatment,
hairline color values, “no three-column grid”, and the particular `scale(0.97)`
active-state motion described by DesignMD. These are useful contrastive scenes,
not defaults for another product.

## Rule/example placement

### Suitable for versioned rules

Only refine or test the existing rules below; do not add a new family for this
corpus. The two-product recurrence threshold above is a screening threshold for
rule candidacy, not a replacement for the blinded-review and no-regression
promotion decision in #27:

- `typography.role-contrast`: role separation, semantic heading order, and
  bounded reading measure.
- `color.semantic-roles`: named roles, restrained meaningful accent, and
  non-color state cues.
- `layout.action-evidence` plus `signature.conversion-proof`: evidence and
  action remain causally legible and spatially related.
- `responsive.recompose-not-stack` and the existing list-detail/thumb-zone
  rules: preserve task context, primary action, focus, and return behavior.
- `state.complete-primary-flow`, `state.recovery-first`, and
  `state.optimistic-offline`: state continuity and recovery behavior.
- `signature.product-data-grammar`: derive the signature from real product data
  or object lifecycle, not generic effects.

The rule contract is defined in
[`docs/design-rule-library.md`](design-rule-library.md), validated by
[`domains/frontend/schemas/design-rule.schema.json`](../domains/frontend/schemas/design-rule.schema.json),
and loaded with exactly one compatible rule from each of the six families. A
future rule revision must retain `recipeIds`, constraints, accessibility,
anti-patterns, verification, and provenance; it must also acquire an actual
multi-product evidence bundle rather than only another extraction of Linear.

### Recipe compatibility matrix

The candidate set fits the existing recipes as follows; the source product
identity never chooses a recipe by itself.

| Recipe slice | Compatible candidate rules/examples |
| --- | --- |
| All eight recipes (`consumer-discovery`, `developer-tool`, `e-commerce`, `editorial-content`, `marketing-landing`, `mobile-consumer-app`, `operational-command-center`, `saas-workspace`) | `typography.role-contrast`, `color.semantic-roles`, `responsive.recompose-not-stack`, `state.complete-primary-flow`, and `signature.product-data-grammar`; use the source only to name the observed relationship. |
| `marketing-landing`, `editorial-content` | `typography.editorial-product`, `layout.action-evidence`, and `signature.conversion-proof`; worked example = claim/content → supplied proof → next action. |
| `e-commerce`, `consumer-discovery` | `layout.action-evidence`, `layout.commerce-comparison` where comparable evidence exists, `color.commerce-trust`, and `signature.conversion-proof`; worked example = product evidence → availability/fulfillment → action. |
| `developer-tool`, `operational-command-center`, `saas-workspace` | `typography.dense-workspace`, `layout.list-detail`, `responsive.list-detail-drill-in`, `color.operational-status`, and `state.recovery-first`; worked example = object/status/evidence/recovery sequence. |
| `mobile-consumer-app` (and `e-commerce` when the purchase loop is repeated on mobile) | `responsive.mobile-thumb-zone`, `state.optimistic-offline`, and `signature.repeated-action-feedback`; worked example = reachable action plus visible success/pending/offline/error feedback. |

### Suitable for worked examples

Create or update examples only when a future implementation task is authorized:

- A **dense developer/operations** example: role-based type, object/status
  grammar, bounded geometry, and list-detail behavior.
- A **marketing/commerce** example: claim → supplied proof → action, with
  price/availability/fulfillment kept visible where applicable.
- A **mobile repeated-action** example: thumb-reachable action, immediate
  feedback, offline/retry, and permission/error states.
- A **qualitative modular-panel** example based on Neuform: hierarchy and
  density as composition variables, with no copied imagery, colors, or panel
  markup.
- A **Linear-derived contrastive example** only as a provenance-labelled
  observation: dark canvas, restrained accent, product screenshot as texture,
  and subtle depth. It must remain a good/bad explanatory plate, never a default
  recipe or copied UI.

The existing example schema requires ten scenes (good/bad desktop success,
good/bad mobile success, and good/bad mobile loading/empty/error) with applied
and violated rule ids. The generated SVG plates are explicitly explanatory
evidence, not production JSX/CSS/component templates; see
[`docs/design-rule-library.md`](design-rule-library.md).

## Hard-gate test plan

The following is the minimum observable test for a candidate rule or example.
It is a proposal for the next promotion decision, not a claim that this
research has already passed #27.

### Contract and provenance gates

- The design direction selects exactly one compatible rule from each family;
  rule ids, recipe id, and source identity are persisted before implementation.
- Every rule has a valid `schemaVersion`, stable id/version, accessibility and
  verification clauses, and provenance. Every example has the canonical ten
  scenes and explicit applied/violated rule ids.
- Each observation records source URL, page/route or public state, capture date,
  extractor/schema, and whether the value was directly observed, inferred,
  assumed, or unknown. A generated `DESIGN.md` is an extractor output, not an
  official source design system.

### Visual and accessibility gates

Capture the primary flow at the required `390`, `768`, and `1440` widths and at
the recipe/brief-required states. The current UI evidence contract is
[`src/domains/frontend/design/evidence-types.ts`](../src/domains/frontend/design/evidence-types.ts)
and its browser/mechanical evaluation is in
[`src/domains/frontend/design/browser-checks.ts`](../src/domains/frontend/design/browser-checks.ts)
and [`src/domains/frontend/design/mechanical.ts`](../src/domains/frontend/design/mechanical.ts).

The browser hard-check path marks these findings as `gate: hard`: horizontal
overflow, clipped content, element overlap, sticky obstruction, console errors,
unreachable actions, keyboard traps, focus-order violations, invisible focus,
contrast below `4.5:1` for normal text or `3:1` for large text, critical axe
violations, and unverified reduced-motion behavior. It also hard-fails a
required state that is not rendered, a state transition without a concrete
action and observed before/after change in dependent UI representations, or a
desynchronized dependent representation. These are the browser codes emitted
by [`browser-checks.ts`](../src/domains/frontend/design/browser-checks.ts), not
visual preferences.

The mechanical policy is intentionally split: `touch-target` below the local
`44×44px` minimum is hard; inconsistent spacing, unroled one-off colors,
excessive radii/shadows, generic-card repetition, weak heading ratios, and text
measure above `75ch` are currently soft mechanical findings. The thresholds
come from [`mechanical.ts`](../src/domains/frontend/design/mechanical.ts), so a
future policy change must be explicit rather than inferred from an extracted
source token.

The visual critic is a separate workflow gate. Compare
`product-specificity`, `hierarchy`, `composition`, `typography`, `color-roles`,
and `ai-slop-risk` as art-direction criteria, then `state-quality`,
`responsive-transformation`, `accessibility`, and
`implementation-coherence` as production-integrity criteria. Do not report a
candidate as accepted when schema/identity/lifecycle checks, criterion floors,
or high/critical repair findings fail; those critic outcomes supplement the
browser hard gates rather than changing their severity.

The current critic uses an art-direction floor of `0.60` and an integrity floor
of `0.50`; the criterion evidence and screenshots must remain attached to the
run.

### Promotion evidence beyond hard gates

Passing hard gates proves that a candidate is structurally and operationally
acceptable; it does not prove that the rule improves design outcomes. Issue
[#27](https://github.com/Narek-Khachikyan/SkillRanger/issues/27) must decide the
minimum blinded-human-review sample, preference/quality threshold, repetition
stability, and no-regression requirement before promotion. The existing
[`docs/visual-benchmark.md`](visual-benchmark.md) requires opaque A/B labels,
human reviewers, immutable evidence, and repeated isolated runs; those are the
appropriate next-stage controls.

## Provenance ledger

| Source | Page/state | Schema or extraction method | Use in this decision |
| --- | --- | --- | --- |
| [Issue #26 resolution](https://github.com/Narek-Khachikyan/SkillRanger/issues/26#issuecomment-5177030284) | Accepted corpus decision, 2026-08-04 | Maintainer-supplied corpus and explicit non-template boundary | Defines admissible corpus roles. |
| [Refero Linear style](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1) | `DESIGN.md → Extended`; adjacent CSS Variables/Tailwind v4/Design Tokens states | Refero semantic style/reference output; page exposes palette roles, type, spacing, shape, layout, and guidance | Primary observation source for role vocabulary, hierarchy, bounded geometry, and product-data signature. |
| [Neuform template](https://neuform.ai/template/latest-perspectives-strategies) | Public template preview, “Latest Perspectives & Strategies” | Public page description and preview; no independent score or full interaction matrix | Qualitative observation for hierarchy, density, modular panels, and rhythm only. |
| [DesignMD CLI](https://designmd.cc/cli) | CLI documentation and sample `stripe.com` output | Computed styles, CSS cascade, live `@media`; optional token-only JSON; no LLM for JSON path | Establishes a reproducible extraction method and what can be measured. |
| [DesignMD Linear benchmark](https://designmd.cc/benchmarks/linear) | Public measured specimen; last-measured date shown on page; `Raw extraction` state | DOM/CSSOM-derived benchmark and raw extraction link | Triangulates Linear typography, geometry, color roles, depth, and interaction claims; not an independent product recurrence. |
| [designmd.supply README](https://github.com/context-dot-dev/designmd-supply) | Repository README and documented pipeline | Context.dev styleguide/brand/screenshot/Markdown inputs → LLM-composed Google-format `DESIGN.md` | Provenance warning: generated prose is a hypothesis requiring live-source confirmation. |
| [getdesign.md](https://getdesign.md/) · [private request](https://getdesign.md/request) · [LaunchKit DESIGN.md docs](https://launchkit.getdesign.md/docs/use-design-md) | Public catalog, private-request form, and kit documentation | Independent analyses/catalog plus a paid private URL-to-document flow; Google-format DESIGN.md usage; not a verified live capture of the target product | Confirms the role of reusable references; no new observable product pattern accepted. |
| [design-md-chrome README](https://github.com/bergside/design-md-chrome) | Active-tab `Auto-extract` and `Refresh` states | TypeUI `DESIGN.md`/`SKILL.md` output; extracts typography, colors, spacing, radius, shadows, motion | Capture-tool provenance only; TypeUI output is not adopted as SkillRanger's contract. |
| [Google DESIGN.md spec](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md) | Published alpha format and CLI | YAML front matter plus Markdown rationale; lint, diff, Tailwind/DTCG export | Interoperability reference only; SkillRanger normalizes observations into its own rule schema. |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Contrast, reflow, keyboard, focus, and target-size success criteria | W3C Recommendation; compare SC 1.4.3, 1.4.10, 2.1.1, 2.4.7, 2.4.11, and 2.5.8 with the stricter local evidence policy | External accessibility baseline; it does not turn a source brand value into a SkillRanger rule. |
| [Media Queries Level 5](https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion) | `prefers-reduced-motion: reduce` | W3C CSS media-feature specification | Primary source for the reduced-motion emulation requirement. |

## Rejected or insufficiently evidenced patterns

- **Copy Linear's palette, typography, exact tracking, exact radii, dark canvas,
  screenshot-card layout, or “one accent only.”** These are brand/product
  choices. Keep them only in a provenance-labelled example or reject them as
  defaults.
- **Treat generated `DESIGN.md` as official source truth.** Refero, DesignMD,
  designmd.supply, and design-md-chrome produce derived views with different
  schemas and extraction paths. Preserve the raw output and schema, then
  normalize observations; never import the file into `registry/` unchanged.
- **Promote “modular panels”, “visual superiority”, or “precision” as rules.**
  Neuform's page is a single qualitative template and supplies no blinded
  comparison or hard-gate evidence.
- **Promote exact breakpoints, hover/focus/motion recipes, or the `0.97` active
  scale from extraction claims alone.** The tools establish that such signals can
  be measured, not that one observed value is generally correct. No accepted
  corpus state provides the required cross-viewport before/after evidence.
- **Promote “never use three-column cards”, “never use shadows”, or “always use
  hairline borders.”** These may be useful source anti-patterns, but are not
  product-independent rules. Existing generic-card, radius, and shadow checks
  should remain bounded rather than stylistically absolute.
- **Promote catalog size, tool popularity, or “300+/2,000+ systems” as design
  evidence.** Counts describe a source tool's catalog/marketing claim, not a
  repeated UI observation.
- **Treat extractor agreement on Linear as multi-product recurrence.** Refero
  and DesignMD are independent extraction paths but the same product specimen.
  Agreement raises confidence in the observation; it does not satisfy the
  independent-product threshold for a new versioned rule.

## Next research/implementation boundary

No new decision ticket is identified by this research. The next unresolved
decision is already [#27](https://github.com/Narek-Khachikyan/SkillRanger/issues/27):
set the blinded-review and hard-gate promotion evidence. Only after that decision
and a second independent product specimen should a future implementation task
consider changing rule versions or adding worked examples. This document makes
no application-code or registry change.

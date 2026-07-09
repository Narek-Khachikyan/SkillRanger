---
name: visual-design-polish
description: Improve frontend visual design with subject-specific direction, hierarchy, typography, spacing, palette, density, responsive screenshot QA, and anti-generic UI critique.
---

# Visual Design Polish

Use when a frontend screen works but looks generic, weakly prioritized, crowded, empty, or mismatched to its product. Do not use for pure Tailwind cleanup, backend work, accessibility-only audits, or token-system extraction.

## Scope Triage

- **Micro polish:** a bounded, reversible issue such as one button hierarchy, spacing defect, or responsive overlap. Inspect local conventions; make one coherent change. Do not create art directions or a new spec.
- **Bounded screen:** one established screen or flow. Use one compact thesis and before/after evidence where possible.
- **Material redesign:** a new direction, layout, density model, or brand expression. Run the full workflow below. Offer three directions only when the user has not selected one.

## Evidence Ledger

Before choosing a thesis, separate **observed** project evidence, **inferred** context, and **assumptions** requiring confirmation. Never invent domain artifacts, personas, or terminology at low confidence.

Treat existing `DESIGN.md` as a source to health-check, not unquestioned truth. If it is stale, generic, contradictory, or unsupported by the current UI, name the conflict and propose a compact correction for approval. Do not silently follow or replace it.

## Verification Outcome

- Report `verified` only after rendered mobile and desktop evidence for material visual work.
- Without browser or screenshot capability, stop before material implementation with `blocked`; analysis and a manual QA plan are still useful.
- If the user explicitly asks to implement despite that blocker, return `implemented-unverified` with missing evidence and exact viewport/state checks. Never call it complete.

## Required Workflow

1. Inspect adjacent screens, components, tokens, type, spacing, states, and available references. Preserve established conventions unless the request changes direction.
2. Identify the user, screen job, primary action, important states, data constraints, and supported viewports. State only high-impact assumptions.
3. For bounded or material work, state a compact visual thesis: product/audience, hierarchy and density target, type/color roles, one useful signature move, and one generic default deliberately rejected.
4. For material work, set design variance, motion, and density to suit the product. Choose one primary direction and at most one supporting accent; do not mix unrelated trends.
5. Implement with local components and conventions. Prefer information-bearing structure over decoration: lists/tables for comparison, split panes for triage, editorial grids for narrative, and cards only when they clarify grouping.
6. Run the **final corrective gate** below immediately before handoff. It has priority over earlier ideation steps.

## Design Constraints

- A direction is insufficient if it could describe any "clean, modern, premium" SaaS product. Use real user tasks, data shapes, proof, language, and product constraints.
- Make hierarchy, readability, task clarity, accessibility, and responsive recomposition more important than ornament.
- Give typography and color semantic roles. Use saturation, motion, glow, glass, gradients, and imagery only when they clarify action, state, data, trust, or an earned signature.
- Copy and states are visual material. Use domain objects and observable verbs; account for loading, empty, error, disabled, focus-visible, selected, long-content, and permission states when relevant.
- Mobile is a separate composition: preserve focal hierarchy and action reachability; do not merely stack desktop cards.
- Public references are attribute sources, not blueprints. Never reproduce a logo, marks, exact palette-plus-layout, mascot, hero composition, or trade-dress impression.

For a material new direction or an open-ended request, read [the DESIGN.md method](references/design-md-method.md). For domain extraction, composition, typography, color, data, interaction, and pattern guidance, read [the visual rules reference](references/visual-rules.md) only when that detail is needed.

## Final Corrective Gate

Before handoff, inspect and revise the implemented result—not only the plan:

- Delete decoration, fake metrics, vague AI copy, generic icon grids, gradients, glass, glow, blobs, or nested cards that do not encode meaning.
- Confirm the first viewport makes the primary message, action, and next step clear.
- Confirm the thesis governs type, spacing, color, surfaces, imagery, and motion rather than library defaults.
- Check mobile and desktop for overlap, horizontal scroll, clipped actions, long-content failure, and focus-visible loss. Check empty/loading/error and dark mode when supported.
- Confirm contrast, non-color state cues, keyboard access, target size, reduced motion, and performance constraints after polish.
- If 20% or more secondary decoration can be removed without losing meaning, remove it.

## Output Contract

Return the visual thesis, evidence inspected, issues ordered by impact, changes made, verified viewports/states, and the explicit verification outcome (`verified`, `blocked`, or `implemented-unverified`).

---
name: visual-design-polish
description: Improve frontend visual design with subject-specific direction, hierarchy, typography, spacing, palette, density, responsive screenshot QA, and anti-generic UI critique.
---

# Visual Design Polish

Use when a frontend screen works but looks generic, weakly prioritized, crowded, empty, or mismatched to its product. Do not use for pure Tailwind cleanup, backend work, accessibility-only audits, or token-system extraction.

## Ownership Boundary

Visual-design-polish owns **broad art direction**: theses, layout models, density
targets, type/color systems, and signature moves. Tailwind-ui-polish **implements or
repairs an existing direction** through Tailwind classes. If the user asks for
open-ended direction work from tailwind-ui-polish, hand off to this skill. Do not keep
open-ended direction work in tailwind-ui-polish.

## Scope Triage

- **Micro polish:** a bounded, reversible issue such as one button hierarchy, spacing defect, or responsive overlap. Inspect local conventions; make one coherent change. Do not create art directions or a new spec.
- **Bounded screen:** one established screen or flow. Use one compact thesis and before/after evidence where possible.
- **Material redesign:** a new direction, layout, density model, or brand expression. Run the full workflow below. Offer three directions only when the user has not selected one.

## Structured Execution Contract

For material work, read `input.schema.json`, `workflow.json`, and `gates.json` before implementation. Create the required `.design` artifacts in workflow order and validate them with SkillRanger when available. Load the canonical rule index, select exactly one compatible rule from each of the six families, and record the six selected rule ids in structured direction metadata. Compare the direction against the selected recipe's good/bad example pack before implementation. Use the constrained profile when model capability is unknown: select one recommended recipe, keep one signature move, use existing primitives, and do not skip browser evidence or the repair pass. Return the shape in `output.schema.json`; `evals.json` identifies the benchmark slice.

## Design Change Modes

- **repair:** Correct verification findings within the approved `BoundedRepairRequest`; repair cannot broaden art direction.
- **refine:** Improve an approved direction while preserving its recipe, thesis, and protected invariants.
- **explore:** Compare policy-permitted recipe-compatible directions before selecting one structured direction.
- **reimagine:** Establish a new direction only when product evidence, destructive critique, and the execution policy permit it.

## Evidence Ledger

Before choosing a thesis, separate **observed** project evidence, **inferred** context, and **assumptions** requiring confirmation. Never invent domain artifacts, personas, or terminology at low confidence.

Treat existing `DESIGN.md` as a source to health-check, not unquestioned truth. If it is stale, generic, contradictory, or unsupported by the current UI, name the conflict and propose a compact correction for approval. Do not silently follow or replace it.

## Verification Outcome

- The implementation report must never claim `verified`. Only strict runtime verification followed by successful run finalization may produce a verified result.
- Without browser or screenshot capability, stop before material implementation with `blocked`; analysis and a manual QA plan are still useful.
- Return `implementationOutcome` as `implemented`, `failed`, or `blocked`, with `verificationState` set to `pending-runtime-verification`. Never call it complete self-verified.

## Workflow

### 1. Ground In Product Evidence
Inspect adjacent screens, components, tokens, type, spacing, states, and available references. Preserve established conventions unless the request changes direction. Identify the user, screen job, primary action, important states, data constraints, and supported viewports. State only high-impact assumptions. If no evidence of real users, tasks, or data shapes exists, ask for it before choosing a direction. Never invent personas, stock photography subjects, brand marks, or fake metrics.

### 2. Surface The Design Tension
Name the concrete problem the current UI creates for a real user task: weak hierarchy, missing focal point, crowded density, empty canvas, mismatched tone, or generic layout. State the design tension as a product truth (observed data or workflow) conflicting with a visual limitation.

### 3. Generate 2-3 Competing Directions
Each direction must differ on at least two of: density model, hierarchy strategy, typographic voice, color temperature, composition pattern, or material treatment. Each must include a one-sentence product reason and one rejected default it intentionally avoids. Do not propose directions that could describe the same "clean modern SaaS" with different accent colors.

### 4. Choose And Thesis
Select one direction with its product justification. Select and record one compatible rule id for typography, layout, responsive, color, state, and signature move. State a compact visual thesis: product/audience, hierarchy and density target, type/color roles, one useful signature move, and one generic default deliberately rejected. Compare it with the recipe's good/bad pack, then set design variance, motion, and density to suit the product. Choose one primary direction and at most one supporting accent; do not mix unrelated trends.

### 5. Define The Signature Move
Name one non-generic visual decision the thesis earns: a treatment of a real data shape, a domain-appropriate surface material, a typographic conflict and resolution, a composition structure tied to a user workflow, a color-as-meaning rule, or a motion behavior that clarifies cause and effect. If the signature could describe any SaaS product, it is not specific enough.

### 6. Apply Across First Viewport And Common Surfaces
Demonstrate the thesis on the primary screen, then verify on: primary/secondary CTA, repeated card or row, input/form control and focus state, navigation active state, dense data cell or metadata row, empty/loading/error state, modal/drawer/toast surface, and mobile version of the primary workflow. If the thesis breaks on any surface, revise it before implementing.

### 7. Destructive Critique
Before writing code, state the strongest argument against the chosen direction: what user task it harms, what content type it fails to contain, what responsive condition it ignores, what accessibility requirement it weakens, or what product constraint it violates. If no strong counterargument exists, the direction is likely too generic. Revise or document why the risk is acceptable.

### 8. Implement With Local Conventions
Implement with local components and conventions. Prefer information-bearing structure over decoration: lists/tables for comparison, split panes for triage, editorial grids for narrative, and cards only when they clarify grouping.

### 9. Run The Final Corrective Gate
Run the **final corrective gate** below immediately before handoff. It has priority over earlier ideation steps.

## Design Constraints

- A direction is insufficient if it could describe any "clean, modern, premium" SaaS product. Use real user tasks, data shapes, proof, language, and product constraints.
- Make hierarchy, readability, task clarity, accessibility, and responsive recomposition more important than ornament.
- Give typography and color semantic roles. Use saturation, motion, glow, glass, gradients, and imagery only when they clarify action, state, data, trust, or an earned signature.
- Copy and states are visual material. Use domain objects and observable verbs; account for loading, empty, error, disabled, focus-visible, selected, long-content, and permission states when relevant.
- Mobile is a separate composition: preserve focal hierarchy and action reachability; do not merely stack desktop cards.
- Public references are attribute sources, not blueprints. Never reproduce a logo, marks, exact palette-plus-layout, mascot, hero composition, or trade-dress impression.

## Guard Against Invented Assets

- Never invent stock photography subjects, stock people, brand marks, product logos,
  fake company names, or domain artifacts not supplied by project evidence or explicitly
  approved by the user.
- Do not generate placeholder metrics, chart data, user names, avatars, reviews, or
  testimonials that imply real people or transactions.
- When missing genuine content, use neutral structural placeholders: "Patient Name",
  "Order #1234", "Metric label". State that these are placeholders and flag the need for
  real content before release.
- Reject generated hero imagery of diverse stock teams, abstract AI brains, glowing
  server racks, or smiling people in headsets unless the product is literally about
  those things and the imagery is sourced from the project.

## Final Corrective Gate

Before handoff, inspect and revise the implemented result—not only the plan:

- Delete decoration, fake metrics, vague AI copy, generic icon grids, gradients, glass, glow, blobs, or nested cards that do not encode meaning.
- Confirm the first viewport makes the primary message, action, and next step clear.
- Confirm the thesis governs type, spacing, color, surfaces, imagery, and motion rather than library defaults.
- Check mobile and desktop for overlap, horizontal scroll, clipped actions, long-content failure, and focus-visible loss. Check empty/loading/error and dark mode when supported.
- Confirm contrast, non-color state cues, keyboard access, target size, reduced motion, and performance constraints after polish.
- If 20% or more secondary decoration can be removed without losing meaning, remove it.

### Genericity Self-Test
- Can you swap the logo and product name with an unrelated SaaS (CRM, HR platform,
  analytics dashboard) and the page still reads as intentional? If yes, reject the
  direction. Replace at least two identity-bearing axes: composition structure, type
  genre, color system, density model, imagery treatment, or material language.
- Does every decorative element (gradient, icon, card, illustration) carry known product
  meaning or state information? If not, remove or replace it with an evidence-bearing
  structure.
- Would the visual thesis survive a logo swap without reading as generic? Test by
  mentally substituting three unrelated product logos. If the page still makes sense,
  the direction is too generic.

## Validation

- Verify the visual thesis against the product's subject, audience, and user workflow,
  not against generic design taste.
- Check that the signature move survives translation to: first viewport, CTA,
  repeated card/row, form control, nav, dense data, empty/loading/error state,
  modal/drawer/toast, and mobile workflow.
- Confirm the genericity self-test is passed: logo-swap to an unrelated SaaS should
  break the illusion.
- Verify that no invented assets (stock people, fake metrics, brand marks, placeholder
  data implying real transactions) remain in the output.
- If browsers/screenshots are unavailable, state the missing evidence and the exact
  viewport/state matrix that remains unverified.

## Output Contract

Return `implementationOutcome` (`implemented`, `failed`, or `blocked`), `verificationState` (`pending-runtime-verification`), `artifacts`, `changes`, and `residualRisks`. Never claim `verified` in agent-authored output.

## References

Read [the DESIGN.md method](references/design-md-method.md) for material new direction
or open-ended requests. Read [the visual rules reference](references/visual-rules.md)
for domain extraction, composition, typography, color, data, interaction, and pattern
detail. Read [the evidence examples](references/evidence-examples.md) for worked
examples of the thesis workflow across product types.

## Shared Contracts

Ownership: visual-design-polish owns art direction.

- [`frontend/browser-evidence`](references/shared/frontend--browser-evidence.md)
- [`frontend/bounded-repair`](references/shared/frontend--bounded-repair.md)
- [`frontend/visual-verification`](references/shared/frontend--visual-verification.md)

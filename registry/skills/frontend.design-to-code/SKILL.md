---
name: design-to-code
description: Translate screenshots, mocks, Figma-style briefs, or visual references into React UI using the project's styling system, including Tailwind when present, while preserving conventions, responsiveness, states, and visual fidelity.
---

# Design To Code

Use this skill when implementing a supplied design, screenshot, mock, Figma-style brief, or visual reference in an existing frontend project, using its existing styling system rather than requiring Tailwind. Do not use it for open-ended redesigns without a reference, pure component API refactors, or backend behavior.

## Reference Intake

Classify the input before implementation: **user-owned specification**, **product-local reference**, **competitor/brand inspiration**, or **generic/unknown source**. A user-owned Figma can be authoritative for fidelity; a competitor or generic source is only an attribute source and needs product-specific adaptation. Record missing fonts, assets, measurements, and responsive states before substituting them. If the cumulative substitutes can change hierarchy or density, stop and ask for the asset/spec instead of compounding approximation drift.

## Verification Outcome

- Report `verified` only after reference, implementation, and mobile adaptation are compared in rendered evidence.
- Without browser or screenshot capability, report `blocked` before material fidelity work; do not claim a final match from code inspection.
- With explicit user approval to continue, return `implemented-unverified` plus every approximation and the required manual comparison matrix.

## Decision Rules

- Translate design intent into the existing product system, not isolated pixel art.
- Convert references into a DESIGN.md-style brief before coding: visual theme, token roles, type roles, component rules, layout, depth, guardrails, and responsive behavior.
- Preserve local components, tokens, routing, data flow, and accessibility conventions.
- Match structure, hierarchy, spacing, typography, and state behavior before adding flourishes.
- Preserve the reference's distinctive idea. Do not translate a high-character mock into generic Tailwind cards, a default shadcn neutral theme, or a model house style unless the reference actually asks for that.
- Define responsive behavior explicitly; screenshots usually imply more than one viewport.
- If exact assets, fonts, or measurements are missing, choose project-native substitutes and state the approximation.
- Require a visual comparison artifact for implemented work: reference viewport, implemented viewport, mobile adaptation, and known fidelity gaps. If browser evidence is blocked, report the blocker instead of claiming final fidelity.
- Extract the reference's attributes, not its protected or brand-specific expression. Do not clone a competitor, brand identity, mascot, proprietary composition, or single-source layout.
- Preserve the reference's structural idea while changing enough implementation details to fit the local product: information architecture, token system, typography roles, copy, responsive behavior, and state model.
- If the reference is only visually attractive but not product-appropriate, adapt the useful attributes and reject the rest.

## Guard Against Invented Assets

- Never invent stock photography subjects, stock people, brand marks, product logos,
  fake company names, or domain artifacts not supplied by the reference or project.
- Do not generate placeholder user photos, avatars, reviews, testimonials, chart data,
  or metrics that imply real people or transactions.
- When a reference lacks specific assets, use neutral structural placeholders and state
  the substitution. Flag the need for real content before release.
- For AI-generated references (DALL-E, Midjourney, etc.), treat the output as a mood
  attribute source, not an implementable spec. Extract composition, color temperature,
  hierarchy model, and material treatment. Do not reproduce AI-invented people,
  products, brand marks, impossible UI patterns, or decorative elements that lack a
  functional UI explanation. Decompose the AI output into individual design decisions
  before coding.

## Ethical Reference Handling

- Classify references as brand, creator, competitor, genre, functional, or material references.
- Treat brand, creator, and competitor references as high-risk. Use only abstracted attributes from them.
- Extract reusable attributes: mood, hierarchy, density, color temperature, spacing logic, materiality, motion rhythm, image treatment, and interaction pattern.
- Avoid copying exact composition, logo, mascot, product silhouette, proprietary color-layout combination, illustration system, icon style, or commercial impression.
- Use at least three references or one reference plus strong product/domain constraints for broad art direction; do not use a single screenshot as a blueprint.
- Document anti-goals when a reference is competitor-like: different composition, palette, typography genre, iconography, copy structure, and interaction language.

## Workflow

1. Inventory the reference: viewport size, layout regions, type roles, color roles, imagery, controls, states, and implied interactions.
2. Extract a mini-DESIGN brief from the reference using `references/reference-to-design-md.md`: theme, color roles, typography roles, component stylings, layout principles, depth model, do/don't guardrails, and responsive behavior.
3. Name the reference's non-generic signature: composition, density, type treatment, material, illustration style, interaction, or content rhythm.
4. Decompose the reference:
   - reusable attributes;
   - risky elements to avoid;
   - product-specific translation;
   - known approximations.
5. Inspect the project: framework, components, tokens, Tailwind config, global CSS, existing layout primitives, similar screens, and any project `DESIGN.md`.
6. Map the design to local building blocks:
   - reuse existing components where they fit;
   - add variants before duplicating components;
   - introduce new primitives only for repeated or central patterns.
7. Plan responsive behavior for mobile, tablet, and desktop, including what reflows, stacks, truncates, or becomes horizontally scrollable.
8. Implement static structure first, then states and interactions.
9. Preserve accessible names, semantic headings, focus order, keyboard use, contrast, target size, and reduced motion.
10. Render and compare against the reference; refine spacing, type scale, alignment, overflow, and the signature element before declaring fidelity.
11. Capture comparison evidence: reference image or brief, implemented screenshot at the reference viewport, and at least one smaller responsive viewport. For existing UI, include before/after when the implementation replaces a current screen.

## Visual Comparison Gate

- Fidelity means preserving design intent, hierarchy, signature move, spacing rhythm, type roles, color roles, and state behavior inside the local system. It does not mean isolated pixel art that ignores project conventions.
- Compare the implementation at the supplied/reference viewport and at one mobile viewport. Add tablet when the composition changes across breakpoints.
- State every known approximation: missing assets, unavailable fonts, ambiguous measurements, substituted icons, content length differences, or token substitutions.
- Verify that the reference's non-generic signature still reads after adapting to local components and tokens.
- If screenshots/browser rendering are unavailable, list the unverified viewport and state checks required before accepting fidelity.

## Validation

- Compare at the reference viewport and at least one smaller viewport.
- Provide or request a visual comparison artifact before declaring the design implemented.
- Verify long text, missing images, empty/loading/error states, and focus-visible styles.
- Verify the signature element still reads as the same design after adapting to local components.
- Confirm no unrelated route or data behavior changed.
- State any visual fidelity gaps caused by missing assets, fonts, or ambiguous reference details.
- State any reference-safety gaps if the implementation risks looking like a copied brand or competitor.

## Output Contract

- Reference interpretation first, including the extracted mini-DESIGN brief and risky elements intentionally avoided.
- Local component/token mapping.
- Implementation changes.
- Comparison evidence: reference, implemented screenshot, responsive adaptation, or blocker.
- Viewports and states verified.
- Known fidelity gaps and next visual QA checks.

## References

- Use [the reference-to-DESIGN.md extraction guide](references/reference-to-design-md.md)
  when translating a reference into a DESIGN.md-style brief.
- Use the project's existing components, tokens, Tailwind config, global CSS, and
  adjacent screens as primary implementation references.

---
name: react-component-design
description: Design and review React component APIs, composition boundaries, state ownership, accessibility, and reusable UI behavior.
---

# React Component Design

Use this skill when creating, refactoring, or reviewing reusable React components. Do not use it for one-off page markup unless the work is becoming a shared component or affects a shared component API.

## Decision Rules

- Let existing component conventions set the default shape.
- Add abstraction only when reuse, ownership, or state complexity justifies it.
- Design accessibility and interaction states into the API instead of patching them at call sites.
- Prefer explicit composition boundaries over prop bags that hide behavior.
- Component APIs shape visual quality. Narrow, opinionated APIs usually produce more distinctive UI than broad prop bags with arbitrary color, layout, and class overrides.
- Use variants for stable repeated design decisions and slots/composition for one-off richness.
- Avoid overgeneric components that make every product look like the same card, button, form, and grid system.

## Workflow

1. Identify the component's consumers, ownership boundary, and whether it is shared or local.
2. Review props for stable names, minimal surface area, sensible defaults, and escape hatches.
3. Decide controlled versus uncontrolled state and document event/value contracts through the code shape.
4. Check loading, empty, error, disabled, selected, focused, responsive, and overflow states.
5. Verify accessibility: semantic element choice, keyboard behavior, labels, focus management, and ARIA only when needed.
6. Compare styling and composition with existing local components before introducing new patterns.
7. Remove premature abstraction if only one usage exists and the abstraction does not reduce real complexity.

## Visual API Rules

- Start from the design and data model, not from reusable abstraction. Component hierarchy should reflect product-specific information architecture.
- Prefer semantic slots such as `trigger`, `leading`, `trailing`, `label`, `description`, `actions`, `media`, `footer`, `emptyState`, or named child components over vague `top`, `bottom`, `left`, and `right` props.
- Variants should encode intent: `destructive`, `success`, `warning`, `quiet`, `prominent`, `selected`, `compact`, `editorial`, `operator`, or product-specific language, not arbitrary colors.
- Keep variant matrices small. Document supported combinations of variant, size, density, loading, disabled, selected, invalid, and error.
- Density props should map to real use cases such as data-heavy tables, compact nav, toolbars, and enterprise forms; do not apply compact density globally.
- State props should describe visible user-facing states: `selected`, `expanded`, `pressed`, `invalid`, `loading`, `open`, `current`, `disabled`, not vague flags like `active` or `mode`.
- Do not expose props for values that can be derived from existing state; duplicated state creates inconsistent visuals.
- `className`, `style`, `sx`, arbitrary render props, and custom slots are escape hatches, not the canonical design path.
- If a new prop only changes CSS, decide whether it should be a token, variant, slot composition, or separate component.

## Stories And Examples

- Examples should include realistic domain content, not generic placeholder copy.
- Cover default, loading, empty, error, disabled, selected, focused, long-label, missing-media, translated-text, mobile, dark-mode, and density states where relevant.
- Stories should demonstrate one concept at a time. Avoid kitchen-sink stories that teach agents nothing about when to use the component.
- Document when not to use the component: links vs buttons, alerts vs toasts, modals vs side panels, cards vs tables, menus vs command palettes.
- If an agent cannot infer when to use the component from its name, props, stories, and docs, improve the API/docs before adding more styling options.

## Accessibility As Visual Quality

- Preserve native semantics and visible labels wherever possible.
- When using `asChild`, custom render functions, or custom elements, preserve props, refs, focus behavior, keyboard interaction, accessible names, and expected element roles.
- Do not hide visual richness from assistive tech by replacing meaningful child content with an overly broad `aria-label`.
- Focus states, labels, keyboard behavior, hit areas, disabled semantics, and error descriptions are part of the component API.

## References

- No packaged references are required for this MVP skill.
- When available in the project, inspect nearby components, shared UI primitives, Storybook stories, tests, and usage call sites.

## Validation

- Recommendations should name the API, state, or usage contract that changes.
- Suggested component APIs should be usable without hidden knowledge from a single call site.
- If consumer needs are unknown, prefer a narrower local component and call out the missing evidence.
- Confirm the API produces product-specific, accessible, high-quality UI without requiring every caller to restyle it manually.

## Output Contract

- Summarize the component boundary and state ownership.
- List findings or design recommendations by risk and maintainability impact.
- Include example prop/API direction only when it clarifies the fix.
- State test or story coverage needed for meaningful states.

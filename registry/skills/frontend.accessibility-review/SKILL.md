---
name: accessibility-review
description: Review frontend changes for semantic HTML, keyboard behavior, focus management, forms, landmarks, color contrast, and screen reader usability.
---

# Accessibility Review

Use this skill when the task touches user-facing UI, forms, navigation, modals, interactive controls, or content structure. Do not use it for backend-only, database-only, or copy-only changes unless the copy affects labels, instructions, or error recovery.

## Decision Rules

- Prefer native semantic elements before custom ARIA.
- Treat keyboard and screen reader behavior as first-class behavior, not polish.
- Check names, roles, descriptions, focus movement, and state announcements together.
- Report specific, fixable issues rather than generic accessibility advice.
- Use WCAG 2.2 AA as the default product baseline. Cite concrete criteria when possible: 1.4.3 contrast, 1.4.11 non-text contrast, 2.1.1 keyboard, 2.4.7 focus visible, 2.5.8 target size, 3.3.1 error identification, 3.3.2 labels/instructions, and 4.1.2 name/role/value.
- Treat automated checks as a regression screen, not proof. Axe or Playwright passing means only “no automatically detectable violations in tested states.”
- Separate automated, keyboard, screen reader, contrast, and reflow evidence. Do not summarize accessibility as “passes axe” when manual behavior is untested.

## Workflow

1. Identify the changed pages, components, controls, dialogs, forms, and navigation flows.
2. Check semantic structure: headings, landmarks, lists, buttons, links, tables, and form grouping.
3. Check accessible names and descriptions for controls, icons, inputs, and error messages.
4. Trace keyboard behavior: tab order, activation keys, escape behavior, focus return, and visible focus states.
5. Review validation feedback, loading states, dynamic updates, and live-region needs.
6. Check contrast thresholds, non-color-only communication, target size, reduced-motion expectations, and responsive readability: 4.5:1 normal text, 3:1 large text, 3:1 meaningful non-text UI/graphics/focus indicators.
7. For custom widgets, identify the ARIA APG pattern first: dialog, tabs, accordion, menu button, combobox, listbox, slider, grid, disclosure, tooltip, or live region. Verify role, accessible name, state/value, keyboard behavior, focus movement, and escape/close behavior.
8. Run or request automated checks when available, then list the manual residual checks automation cannot prove.

## WCAG 2.2 AA Gate

- Semantic structure: headings are ordered, landmarks are useful, lists/tables use native structure, buttons and links match their behavior, and form groups expose labels/instructions.
- Keyboard: every interactive control is reachable, operable, visible on focus, and has an expected activation key. Modals, drawers, menus, and popovers have intentional focus entry, containment where appropriate, escape path, and focus return.
- Names and announcements: icons, custom controls, validation errors, loading states, live updates, and selected/expanded/pressed states expose correct name, role, description, and value/state.
- Visual requirements: normal text contrast is at least 4.5:1, large text and meaningful UI graphics/focus indicators are at least 3:1, and information is not carried by color alone.
- Reflow and target size: content remains usable at narrow widths and zoom/reflow scenarios; pointer targets meet WCAG 2.2 target-size expectations where practical or have adequate spacing.
- Motion and timing: reduced-motion preferences are respected, timeouts are recoverable where relevant, and animation does not prevent comprehension or operation.

## Automation Boundary

- Use axe, Playwright accessibility checks, or equivalent tooling as a baseline when the project already has browser test tooling.
- Treat a clean automated report as limited evidence. It does not prove meaningful reading order, correct screen reader phrasing, complete keyboard behavior, usable error recovery, or every responsive state.
- Report residual manual risk explicitly: keyboard path, screen reader announcement, zoom/reflow, reduced motion, and contrast checks that were not directly verified.

## References

- Use WCAG 2.2, WAI-ARIA Authoring Practices Guide, MDN accessibility docs, and project-local component patterns as the source of truth.
- When available in the project, inspect existing shared form controls, modal/dialog components, route layouts, accessibility tests, axe/Playwright setup, and previous accessibility regressions.

## Validation

- Each finding should name the affected user interaction or assistive technology behavior.
- Prefer fixes that use existing components or native HTML semantics.
- If color contrast or screen reader behavior cannot be verified directly, say so and describe the evidence used.
- Distinguish proven failures from unverified risks and automated-only coverage.

## Output Contract

- Lead with actionable findings ordered by user impact.
- Include file references and the affected UI state when available.
- Provide concise fix direction, not a long accessibility lecture.
- Note automated checks run, manual checks run, and residual WCAG/APG risks that remain unverified.

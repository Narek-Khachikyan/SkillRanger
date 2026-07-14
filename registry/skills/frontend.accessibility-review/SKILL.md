---
name: accessibility-review
description: Review frontend changes for semantic HTML, keyboard behavior, focus management, forms, landmarks, color contrast, and screen reader usability.
---

# Accessibility Review

Use this skill when the task touches user-facing UI, forms, navigation, modals, interactive controls, or content structure. Do not use it for backend-only, database-only, or copy-only changes unless the copy affects labels, instructions, or error recovery.

## Verification Outcome

- Report `verified` only when the affected rendered states and primary keyboard/focus path were exercised; identify screen reader, contrast, reflow, or forced-colors checks that remain manual.
- Without a browser, source review can identify risks but cannot prove interaction accessibility. Return `implemented-unverified` after an approved code fix, or `blocked` when missing rendered evidence prevents a safe conclusion.
- A clean automated report is supporting evidence, never a substitute for the relevant manual checks.

## Decision Rules

- Prefer native semantic elements before custom ARIA.
- Treat keyboard and screen reader behavior as first-class behavior, not polish.
- Check names, roles, descriptions, focus movement, and state announcements together.
- Report specific, fixable issues rather than generic accessibility advice.
- Use WCAG 2.2 AA as the default product baseline. Cite concrete criteria when possible: 1.4.3 contrast, 1.4.11 non-text contrast, 2.1.1 keyboard, 2.4.7 focus visible, 2.5.8 target size, 3.3.1 error identification, 3.3.2 labels/instructions, and 4.1.2 name/role/value.
- Treat automated checks as a regression screen, not proof. Axe or Playwright passing means only “no automatically detectable violations in tested states.”
- Separate automated, keyboard, screen reader, contrast, and reflow evidence. Do not summarize accessibility as “passes axe” when manual behavior is untested.
- Treat forms, dialogs, menus, popovers, tabs, accordions, comboboxes, data tables, drag/drop, and live updates as high-risk surfaces until keyboard and announcement behavior are checked.
- Prefer fixing the underlying semantic/control problem over adding ARIA that masks a broken interaction.

## Workflow

1. Identify the changed pages, components, controls, dialogs, forms, and navigation flows.
2. Check semantic structure: headings, landmarks, lists, buttons, links, tables, and form grouping.
3. Check accessible names and descriptions for controls, icons, inputs, and error messages.
4. Trace keyboard behavior: tab order, activation keys, escape behavior, focus return, and visible focus states.
5. Review validation feedback, loading states, dynamic updates, and live-region needs.
6. Check contrast thresholds, non-color-only communication, target size, reduced-motion expectations, and responsive readability: 4.5:1 normal text, 3:1 large text, 3:1 meaningful non-text UI/graphics/focus indicators.
7. For custom widgets, identify the ARIA APG pattern first: dialog, tabs, accordion, menu button, combobox, listbox, slider, grid, disclosure, tooltip, or live region. Verify role, accessible name, state/value, keyboard behavior, focus movement, and escape/close behavior.
8. Check forms for labels, grouping, instructions, autocomplete, input type/inputmode, inline errors, focus-first-error behavior, and paste support.
9. Run or request automated checks when available, then list the manual residual checks automation cannot prove.

## WCAG 2.2 AA Gate

- Semantic structure: headings are ordered, landmarks are useful, lists/tables use native structure, buttons and links match their behavior, and form groups expose labels/instructions.
- Keyboard: every interactive control is reachable, operable, visible on focus, and has an expected activation key. Modals, drawers, menus, and popovers have intentional focus entry, containment where appropriate, escape path, and focus return.
- Names and announcements: icons, custom controls, validation errors, loading states, live updates, and selected/expanded/pressed states expose correct name, role, description, and value/state.
- Visual requirements: normal text contrast is at least 4.5:1, large text and meaningful UI graphics/focus indicators are at least 3:1, and information is not carried by color alone.
- Reflow and target size: content remains usable at narrow widths and zoom/reflow scenarios; pointer targets meet WCAG 2.2 target-size expectations where practical or have adequate spacing.
- Motion and timing: reduced-motion preferences are respected, timeouts are recoverable where relevant, and animation does not prevent comprehension or operation.

## Manual Test Matrix

- Keyboard path: tab forward and backward through the primary flow, activate controls with Enter/Space as appropriate, verify skip links or landmark navigation where relevant, and confirm focus is never lost or trapped.
- Overlay behavior: dialogs, drawers, popovers, menus, and sheets move focus intentionally, close by Escape or an accessible control, return focus to the trigger, and prevent background interaction where appropriate.
- Screen reader smoke: controls expose useful name, role, description, and state; validation errors, loading changes, selected/current states, expanded/collapsed states, and live updates are announced where needed.
- Reflow and zoom: content remains usable at narrow widths and common zoom/reflow scenarios without hidden controls, overlapping text, or impossible horizontal scrolling.
- Contrast and forced colors: text, icons, focus indicators, borders that carry meaning, charts, and disabled states remain distinguishable in normal and high-contrast contexts where relevant.
- Motion: `prefers-reduced-motion` removes or simplifies non-essential movement without removing the user's ability to understand state changes.

## Mechanical Checks

- Icon-only buttons have an accessible name, and decorative icons are hidden from assistive tech.
- Actions use buttons; navigation uses links. Avoid clickable `div`/`span` elements unless a native element is impossible and the full keyboard/role contract is implemented.
- Form controls have visible or programmatic labels, useful `name`, appropriate `type`, `autocomplete`, and `inputmode` where relevant.
- Do not block paste in inputs such as email, password, one-time code, coupon, API key, or account number fields.
- Errors are inline near the affected field, identify the failed field, explain recovery, and focus the first error after submit when a form submission fails.
- `outline: none`, `outline-none`, or equivalent focus removal is only acceptable with a visible replacement using `:focus-visible` or a project-standard focus style.
- Images have useful `alt` text or empty `alt` when decorative; meaningful SVGs expose a name and decorative SVGs are hidden.
- Async toasts, validation, progress, and long-running operations use visible feedback and live-region behavior when users need announcement.
- Tables use native table structure for tabular data, with headers and captions/labels when needed for comprehension.
- User-generated or translated content has wrapping, truncation, or overflow behavior that preserves labels, controls, and reading order.

## Automation Boundary

- Use axe, Playwright accessibility checks, or equivalent tooling as a baseline when the project already has browser test tooling.
- Treat a clean automated report as limited evidence. It does not prove meaningful reading order, correct screen reader phrasing, complete keyboard behavior, usable error recovery, or every responsive state.
- Report residual manual risk explicitly: keyboard path, screen reader announcement, zoom/reflow, reduced motion, and contrast checks that were not directly verified.

## References

- Use `references/a11y-manual-test-matrix.md` for manual keyboard, overlay, form, announcement, visual, and responsive checks.
- Use WCAG 2.2, WAI-ARIA Authoring Practices Guide, MDN accessibility docs, and project-local component patterns as the source of truth.
- When available in the project, inspect existing shared form controls, modal/dialog components, route layouts, accessibility tests, axe/Playwright setup, and previous accessibility regressions.

## Validation

- Each finding should name the affected user interaction or assistive technology behavior.
- Prefer fixes that use existing components or native HTML semantics.
- If color contrast or screen reader behavior cannot be verified directly, say so and describe the evidence used.
- Distinguish proven failures from unverified risks and automated-only coverage.
- Do not mark custom widgets, dialogs, forms, or route-level workflows as accessibility-ready unless keyboard and focus behavior were checked or explicitly listed as unverified.

## Output Contract

- Lead with actionable findings ordered by user impact.
- Include file references and the affected UI state when available.
- Provide concise fix direction, not a long accessibility lecture.
- Note automated checks run, manual checks run, assistive-technology or browser evidence inspected, and residual WCAG/APG risks that remain unverified.

## Shared Contracts

Ownership: accessibility-review owns semantic, keyboard, focus, target, contrast, and reduced-motion findings.

- [`frontend/browser-evidence`](references/shared/frontend--browser-evidence.md)
- [`frontend/visual-verification`](references/shared/frontend--visual-verification.md)

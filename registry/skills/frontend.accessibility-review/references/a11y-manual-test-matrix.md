# Accessibility Manual Test Matrix

Use this matrix after automated checks or when reviewing custom UI behavior. Automation cannot prove these checks.

## Keyboard

- Tab and Shift+Tab through the primary flow.
- Activate controls with Enter and Space as appropriate.
- Confirm focus is visible on every interactive control.
- Confirm focus order follows the visual and task order.
- Confirm focus is not lost after loading, validation, route changes, or modal close.

## Overlays And Custom Widgets

- Dialogs/drawers move focus on open, contain focus when modal, close with Escape or an accessible close control, and return focus to the trigger.
- Menus/popovers expose expected roles, names, expanded state, arrow-key behavior when applicable, and a clear dismissal path.
- Tabs, accordions, comboboxes, listboxes, sliders, grids, and tooltips match the relevant ARIA APG pattern or use native semantics.
- Background content is inert or unavailable to interaction when a modal overlay requires it.

## Forms

- Every input has a visible or programmatic label.
- Related controls are grouped with fieldsets, legends, or equivalent structure when needed.
- Inputs use useful `name`, `type`, `autocomplete`, and `inputmode` values.
- Paste is not blocked for user-entered credentials, codes, keys, contact info, or account values.
- Validation identifies the field, problem, and recovery path.
- Failed submit focuses the first error or moves users to an error summary.

## Announcements

- Loading, saving, validation, progress, async errors, selected/current state, expanded/collapsed state, and completion are announced when users need the update.
- Toasts and live regions do not steal focus for non-critical messages.
- Screen reader names do not hide meaningful visible content behind overly broad `aria-label` values.

## Visual And Responsive

- Normal text contrast meets 4.5:1; large text, focus indicators, and meaningful UI graphics meet 3:1.
- Information is not carried by color alone.
- Content remains usable at narrow widths and zoom/reflow scenarios.
- Pointer targets are large enough or have adequate spacing for the context.
- Reduced motion removes or simplifies non-essential movement while preserving meaning.

## Evidence Note

Report each check as verified, failed, or unverified. Do not collapse manual coverage into "passes axe".

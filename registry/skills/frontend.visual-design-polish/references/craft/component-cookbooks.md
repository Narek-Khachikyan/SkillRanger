# Component Cookbooks

Cookbook items for the surfaces a frontend build touches most. Each item gives the anatomy, spacing, states, focus behavior, and mobile treatment of one component, plus the anti-default to reject. Cookbooks are parametric knowledge — they describe what a component must decide, not a fixed visual template — so they stay useful across products without repeating one look.

## How To Use A Cookbook

1. Apply the cookbook item for the surface you are building; adjust to the product's tokens and macrostructure.
2. Where the direction has made a deliberate exception, keep the exception consistent across all instances of that surface.
3. A cookbook never relaxes a hard gate: focus visibility, contrast, target size, and state semantics still come from the rule library and the browser gates.

## Cookbook Items

### 1. Primary And Secondary Actions

- **Anatomy:** one primary action per view; secondary actions are visually quieter (text link or outline) and live beside it, further from the edge.
- **Spacing:** primary action at least 44×44 CSS px target; adjacent actions separated by ≥ 8px, or grouped with one explicit hierarchy gap.
- **States:** default, hover (subtle, no bounce), focus-visible (visible ring, never removed), active, disabled (still readable, with a reason stated in copy when the user meets it), loading (label persists or a short in-button spinner with unchanged label width).
- **Mobile:** primary action within the thumb zone; sticky bottom actions only when the primary flow needs a persistent step.
- **Anti-default:** the primary button being a bright gradient or glow with no product reason; two primary buttons competing on one view.

### 2. Cards And Rows

- **Anatomy:** a card earns its border, shadow, and padding by grouping related content that must stay together; otherwise a hairline-separated row is quieter and cheaper.
- **Spacing:** card padding 16–24px; internal gap 8–12px; between-card gap ≥ 16px.
- **States:** hover reveals row actions (with a keyboard-visible equivalent); selected state changes exactly one signal (border, background tint, or check) plus the non-color cue; disabled cards dim without hiding content.
- **Mobile:** cards become full-width; rows recompose into list-detail drill-in instead of shrinking.
- **Anti-default:** cards everywhere as decoration (the "card for every block" default), arbitrary radius changes per card, hover-only actions that vanish on touch.

### 3. Inputs And Forms

- **Anatomy:** label above or beside the field, always visible (placeholder is not a label); one field per question; validation lives with the field.
- **Spacing:** field height ≥ 40px, focus ring ≥ 2px offset, adjacent fields 16px apart.
- **States:** focus-visible ring, filled, empty, disabled, read-only; error state pairs border/icon with text and never color alone; success confirmation appears after commit, not while typing.
- **Mobile:** inputs get the right keyboard type and autocomplete; forms avoid multi-step wizards unless the flow genuinely needs steps.
- **Anti-default:** placeholder-as-label, error text only in red, form sections framed by nested cards with no hierarchy.

### 4. Navigation

- **Anatomy:** one navigation structure per page (top bar, sidebar, or tab row); active state is one signal with a non-color cue (weight, underline, or position).
- **Spacing:** nav target height ≥ 44px; icon buttons get visible labels or tooltips plus aria-labels.
- **States:** active, hover, focus-visible; collapsed menus disclose without covering the current content.
- **Mobile:** primary nav collapses into a drawer or tab bar, never a horizontally squished desktop bar.
- **Anti-default:** nav with no active state, icon-only nav with hidden labels, sticky headers covering content (the no-sticky-overlap gate).

### 5. Dense Data Tables

- **Anatomy:** sticky header with stable column alignment; numeric columns right-aligned with tabular figures; one primary row action visible, secondary actions on row hover or a per-row menu.
- **Spacing:** row height 40–48px, horizontal padding 12–16px, hairline separators; no vertical borders unless comparing cells.
- **States:** sorted column indicated with an arrow and the sort direction; row selection with checkbox + background tint + non-color cue; empty state explains the missing data and offers the recovery action.
- **Mobile:** columns recompose into list-detail drill-in with the key columns (identity, status, one action) in the list and the rest in the detail.
- **Anti-default:** shrinking the whole table on mobile, zebra stripes on every row, action menus hidden behind hover-only affordances.

### 6. Empty, Loading, And Error States

- **Anatomy:** empty state = what is missing, why, and the recovery action; loading = structure first (skeleton keeps layout stable), then content; error = what failed, what happens next, and a retry that is not a dead link.
- **Spacing:** states sit in the layout region they replace, not centered on a void with oversized illustrations.
- **Mobile:** the recovery action stays in the thumb zone; skeletons do not jiggle the layout.
- **Anti-default:** empty states with invented illustration subjects, error pages that only say "something went wrong", loading spinners that push content around.

### 7. Modals, Drawers, And Toasts

- **Anatomy:** one focus trap per modal; drawer for persistent secondary work, modal for a decisive action, toast for confirmation that needs no further action.
- **Spacing:** modal width 480–640px max, padding 24px, backdrop dims without blurring content to unreadability.
- **States:** open/close with focus returned to the trigger; escape closes; destructive actions require an explicit confirming button text; toasts stack with a summary and a dismiss.
- **Mobile:** drawers slide from the thumb side; modals keep a visible header action to close.
- **Anti-default:** toast spam, modal stacking, backdrop blur as decoration, destructive buttons styled identically to primary actions.

### 8. Badges, Tags, And Status Chips

- **Anatomy:** one status system per product: a status chip carries a non-color cue (dot, icon, or label shape) plus the color; tags are content metadata with an explicit remove affordance when editable.
- **Spacing:** chip height 20–28px, text ≥ 12px, adjacent chips 4–8px apart.
- **States:** selected/filtered chips get the accent treatment; removed chips are discoverable (undo or re-add).
- **Mobile:** chips wrap; filtered chip rows stay scrollable within the layout, not horizontally trapped.
- **Anti-default:** color-only status (red = bad, green = good without a cue), every chip in the accent color, tags that look clickable but are not.

## Cookbook Grammar

- **One state system:** define the product's states once (default/hover/focus/active/disabled/loading/empty/error/selected) and apply them to every surface; per-surface improvisation is drift.
- **Focus is not optional:** focus-visible must survive on every interactive surface; it is a hard gate, not a cookbook opinion.
- **Targets before aesthetics:** 44px targets and 4.5:1 contrast precede any styling decision.
- **Responsive by recomposition:** every cookbook item states its mobile treatment because mobile is a separate composition, not a shrink.

## Provenance

### Observed

- The maintainer has built each of these surfaces repeatedly in shipped interfaces and has seen the listed anti-defaults fail in real reviews of the author's own work and in artifacts the author reviewed.
- The browser hard gates (focus-visible, no-clipped-controls, no-sticky-overlap, reduced motion) are exactly the behaviors the cookbooks repeat as non-negotiable.

### Inferred

- The anti-default list derives from the same default-attractor problem the visual critic's slop-tell vocabulary names: decoration without product meaning, centered-everything heroes, and gradient/glow treatments without a reason.

### Assumed

- The consuming skill applies cookbooks advisory-style and will record deviations from them in the direction's rejected defaults, so deliberate exceptions stay visible.

### Unknown

- Whether a cookbook item deserves bundled-rule status is decided by the tiered promotion bar on recurring cross-source evidence, never by this corpus.

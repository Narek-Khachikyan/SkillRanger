# Tailwind Mechanical Rules Reference

Read this reference when the core SKILL.md workflow needs detailed class-level, layout,
or container guidance. Do not read it for every task — use it when a specific mechanical
question arises during implementation or audit.

## Token Discipline

- In shadcn/Tailwind projects, prefer `bg-background`, `text-foreground`, `bg-card`,
  `text-card-foreground`, `text-muted-foreground`, `border-border`, `ring-ring`,
  `bg-primary`, and `text-primary-foreground` over raw `slate-*`, `zinc-*`, or hex.
- When a project DESIGN.md defines token roles, map them to Tailwind theme variables or
  local semantic classes before adding page-level utilities.
- Preserve foreground pairs: `primary`/`primary-foreground`, `card`/`card-foreground`,
  `accent`/`accent-foreground`, `popover`/`popover-foreground`, and
  `destructive`/`destructive-foreground`.
- For Tailwind v4, inspect CSS-first `@theme`, `@theme inline`, custom variants, and
  CSS variable namespaces before adding classes.
- Prefer OKLCH or semantic CSS variables for new color ramps when the project already
  uses CSS variables.
- Theme shadcn components through `:root` and `.dark` tokens rather than scattering
  hard-coded `dark:*` palette overrides.
- Keep `--radius` or the project's radius scale as source of truth; do not invent
  unrelated corner values for one component.
- Define reusable animations with theme variables or local utilities before using many
  one-off `animate-[...]` classes.

## Class Construction Rules

- Group classes by intent: layout, sizing, spacing, typography, color, border/effects,
  state, responsive.
- Split repeated class bundles into existing components, variant maps, `cn` helpers, or
  local primitives when repetition has semantic meaning.
- Do not hide everything behind opaque custom CSS classes; Tailwind should remain
  readable unless third-party markup or a true primitive needs CSS.
- Use arbitrary values for genuine one-offs, CSS variable references, masks, complex
  grids, or layout math; promote repeated arbitrary values into tokens.
- Avoid `transition-all`; prefer `transition-colors`, `transition-opacity`,
  `transition-shadow`, or `transition-transform`.
- Use `motion-safe:` for decorative motion and `motion-reduce:` to remove or simplify
  non-essential movement.
- Use `data-*`, `aria-*`, `open:`, `disabled:`, `invalid:`, `has-*`, `group-*`, and
  `peer-*` variants to style state instead of manually toggling brittle class strings.
- Use `contrast-more:`, `forced-colors:`, and `not-forced-colors:` when high-contrast
  environments are relevant.
- Avoid global `!important` and widespread `!` modifiers; fix specificity or component
  boundaries instead.

## Container And Responsive Rules

- Use viewport breakpoints for page-level layout and container queries for cards,
  panels, dashboard tiles, embedded widgets, sidebars, and reusable components.
- Mark reusable component shells with `@container` and use named containers when nested
  contexts matter.
- Unprefixed utilities are the mobile baseline. Do not use `sm:` as the mobile style.
- Test around actual breakpoint edges, not only at ideal desktop and phone widths.
- Use `min-w-0`, `max-w-*`, `truncate`, `line-clamp`, wrapping, and explicit grid/flex
  constraints for long labels, translated strings, and user-generated content.

## Mechanical UI Checks

- Flex and grid children containing text should usually have `min-w-0` plus intentional
  wrapping, truncation, or `line-clamp` behavior.
- Buttons, tabs, badges, table cells, nav items, and icon buttons should keep stable
  dimensions across hover, focus, active, disabled, loading, and selected states.
- Images and media shells need reserved dimensions, `aspect-*`, or explicit sizing so
  loading does not shift layout.
- Full-bleed and fixed-position layouts should account for mobile safe areas when
  controls sit near viewport edges.
- Avoid `overflow-x-hidden` as a blanket fix for real overflow. Fix the child
  constraint, table strategy, sticky element, or long-content behavior first.
- If theming changes touch the page shell, check `color-scheme`, native form controls,
  scrollbars, and theme-color behavior where the project supports dark mode.
- Format dates, numbers, currencies, and units through project helpers or `Intl.*`
  conventions before polishing spacing around hard-coded text.
- Preserve deep-linkable UI state for tabs, filters, pagination, and selected records
  when the product expects shareable or restorable state; style should not hide broken
  state ownership.

## Fix Patterns

- Replace raw hex or arbitrary color values with project tokens unless the visual
  direction explicitly needs a new token.
- In shadcn projects, prefer semantic tokens for reusable UI: `background`, `foreground`,
  `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`,
  `input`, and `ring` before hard-coded neutral palettes.
- Prefer `gap`, `space-*`, grid tracks, and flex wrapping over hard-coded margins
  between repeated items.
- Use `min-w-0`, `max-w-*`, `truncate`, `line-clamp`, stable icon sizes, and explicit
  grid/flex constraints for long content.
- Use `focus-visible:*` styles that are visible against the actual background, not only
  the default light surface.
- Use mobile-first Tailwind: unprefixed utilities define the narrow layout; `sm:`,
  `md:`, `lg:`, and larger prefixes progressively enhance. Do not use `sm:` as the
  mobile style.
- Use container queries for reusable components whose layout depends on parent width
  more than viewport width.
- Keep cards shallow: use cards for repeated items or framed tools, not for every
  section inside another card.
- Keep button and control dimensions stable across states. Loading text/spinners should
  not resize the control.
- Use semantic variants for repeated states such as intent, size, tone, density, and
  selected/active.
- Preserve native semantics: anchors navigate, buttons perform actions, form controls
  keep labels and accessible names.

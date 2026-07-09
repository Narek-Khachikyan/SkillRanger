---
name: tailwind-ui-polish
description: Improve Tailwind-based UI through screenshot-driven visual QA, responsive layout repair, spacing, density, typography, state styling, accessibility checks, token consistency, and subject-specific design polish.
---

# Tailwind UI Polish

Use this skill when Tailwind classes, local Tailwind components, shadcn/Tailwind tokens, or Tailwind-driven layouts are the implementation surface for visual polish, responsive repair, density tuning, or state styling. Do not use it for pure backend work, non-visual refactors, brand redesign from scratch, illustration work, or projects where Tailwind is not part of the UI layer.

## Project Archetype

Classify the project before prescribing tokens: **shadcn-backed**, **Tailwind with local semantic tokens**, or **Tailwind/CSS-first without a system**. Use shadcn names only in the first case; reuse local roles in the second; keep changes page-local in the third until repetition proves a system boundary. Do not turn a prototype or an inconsistent baseline into a token migration by default.

## Verification Outcome

- Report `verified` only after the changed view is rendered at the relevant desktop and mobile widths.
- Without browser or screenshot capability, allow only analysis and small reversible fixes; mark material layout or visual work `blocked`.
- If the user explicitly accepts the risk, return `implemented-unverified` with a manual overflow, focus, state, and viewport checklist.

## Decision Rules

- Start from the product's subject, audience, and primary job. A manga library, CRM dashboard, and health portal should not receive the same palette, density, typography, or decorative moves.
- If the project has `DESIGN.md`, use it as the visual source for Tailwind class choices. If it does not and the task is subjective, infer a compact mini-DESIGN spec before changing classes.
- Match the existing app style before introducing a new visual direction, unless the request explicitly asks to move the direction.
- Treat screenshots, rendered browser state, and real viewport checks as required evidence for visual/layout changes. Code inspection alone is not enough to close Tailwind polish work unless browser access is blocked.
- Prioritize layout stability, readable density, hierarchy, and state coverage over decorative changes.
- Treat overflow, wrapping, contrast, focus visibility, sticky overlap, and responsive breakage as correctness issues.
- Prefer semantic Tailwind tokens, local variants, `cn` helpers, CVA/class helpers, or shared components when repeated utility clusters become meaningful duplication.
- Use arbitrary values only when no project token expresses the role or when a deliberate product-specific token is being introduced.
- Avoid one-note palettes, generic gradient/blob/card layouts, nested cards, ornamental shadows, random icon grids, and animation without a job.
- Avoid inherited model house styles unless the brief earns them. Warm cream plus serif plus terracotta, purple gradients, dark neon glass, and bento-card grids are defaults, not decisions.
- For subjective polish, set the design dials first: design variance, motion intensity, and visual density. A dense admin table, consumer landing page, and onboarding flow should not receive the same Tailwind treatment.
- Keep dashboard, CRM, admin, and operational tools compact and scannable. Save hero-scale type, large imagery, and editorial spacing for content that actually needs it.
- Keep boundaries sharp: use `frontend.design-system` for token/theme architecture, `frontend.visual-design-polish` for broad visual direction, `frontend.ux-critique` for task-flow redesign, and `frontend.interaction-polish` for motion systems beyond local state styling.
- Use Tailwind as an implementation language for a visual thesis, not as a source of generic styling. The class list should express layout, hierarchy, state, token roles, and responsive behavior.
- Every new raw color, radius, shadow, gradient, or arbitrary spacing should map to a token role or mini-DESIGN rule. If it cannot, remove it or keep it page-local with a clear product reason.
- Prefer semantic tokens and static variant maps over raw palette classes, hard-coded neutrals, dynamic class construction, and one-off arbitrary values.

## Pre-Polish Gate

Before changing Tailwind classes, identify the UI contract:

- Primary user task and first-viewport priority.
- Flow state: entry, main action, feedback, success, and recovery.
- Required states: default, hover, focus-visible, active, disabled, loading, empty, error, success, selected, dirty, stale, partial, and no-permission where relevant.
- Data stress cases: long labels, missing images, translated text, large numbers, dense tables, code blocks, and user-generated content.
- Design-system binding: existing tokens, semantic color roles, radius, shadow, type scale, spacing, density, dark mode, and component variants.
- Responsive contract: supported breakpoints, content-priority reflow, touch targets, horizontal overflow strategy, and sticky element behavior.

Do not start from a decorative class pass. Start from hierarchy, states, responsiveness, and project tokens.

## Workflow

1. Capture the polish envelope: screen or component, user workflow, Tailwind version, design system conventions, target breakpoints, and states that must remain intact.
2. Inspect local UI vocabulary before changing classes: shared components, `tailwind.config.*`, global CSS, `components.json`, shadcn theme tokens, `cn`/CVA utilities, nearby screens, and existing radii/shadow/spacing/type patterns.
   For Tailwind v4, inspect CSS-first `@theme`, `@theme inline`, `@custom-variant`, `@source`, and theme variable namespaces; for Tailwind v3, inspect `tailwind.config.*`.
3. Form a compact design thesis for the pass:
   - design source: `DESIGN.md`, supplied reference, local conventions, or inferred mini-DESIGN spec;
   - subject and audience;
   - primary content/action hierarchy;
   - density target: compact tool, balanced product UI, or editorial/marketing page;
   - one allowed visual move and what it communicates;
   - one generic Tailwind/shadcn default you are avoiding.
   For open-ended subjective polish, compare 2-3 possible directions briefly before choosing; for direct implementation requests, choose and proceed.
4. Render or request visual evidence. Check at minimum `320px` or `390px`, desktop, and `768px` when layout, tables, sidebars, modals, or dense toolbars are involved. Prefer before/after screenshots for existing UI.
5. Audit visual hierarchy:
   - primary action/content is obvious;
   - headings, labels, metadata, and controls have distinct type roles;
   - spacing groups related items and separates unrelated items;
   - color and emphasis guide attention without becoming decoration.
6. Audit responsive robustness:
   - no page-level horizontal scroll;
   - long text, translated labels, badges, icons, and buttons fit or truncate intentionally;
   - sticky headers/footers/action bars do not cover content;
   - grids, sidebars, tables, modals, menus, and toolbars keep stable dimensions.
7. Audit interaction and state styling:
   - hover, focus-visible, active, disabled, selected, loading, empty, error, success, skeleton, and dirty states;
   - keyboard focus order and visible focus rings;
   - reduced motion for transitions;
   - contrast for text, icons, borders, focus rings, charts, and disabled states.
8. Audit Tailwind implementation quality:
   - conflicting utilities such as multiple spacing, display, width, or color classes;
   - arbitrary values where tokens or semantic classes exist;
   - repeated class bundles that should become a variant or local component;
   - fragile absolute positioning, magic negative margins, and viewport-sized hacks;
   - inconsistent radii, shadows, borders, gaps, and typography scale;
   - dynamically constructed class names such as `bg-${color}-600`; map props to complete static class strings so Tailwind can detect them;
   - missing container-query handling when a reusable component should adapt to parent width rather than viewport width;
   - shadcn token drift such as hard-coded neutrals where `bg-background`, `text-foreground`, `border-border`, `ring-ring`, `bg-primary`, or `text-primary-foreground` already express the role;
   - element semantics changed for styling, such as using a button for navigation or a link for mutation.
9. Make the smallest useful change:
   - prefer local convention over a new mini design system;
   - extract only when duplication or variants justify it;
   - preserve behavior, routing, data fetching, and component ownership boundaries.
10. Verify with screenshots or state the exact manual/browser checks still needed.

## Tailwind Token Discipline

- In shadcn/Tailwind projects, prefer `bg-background`, `text-foreground`, `bg-card`, `text-card-foreground`, `text-muted-foreground`, `border-border`, `ring-ring`, `bg-primary`, and `text-primary-foreground` over raw `slate-*`, `zinc-*`, or hex values.
- When a project `DESIGN.md` defines token roles, map them to Tailwind theme variables or local semantic classes before adding page-level utilities.
- Preserve foreground pairs: `primary`/`primary-foreground`, `card`/`card-foreground`, `accent`/`accent-foreground`, `popover`/`popover-foreground`, and `destructive`/`destructive-foreground`.
- For Tailwind v4, inspect CSS-first `@theme`, `@theme inline`, custom variants, and CSS variable namespaces before adding classes.
- Prefer OKLCH or semantic CSS variables for new color ramps when the project already uses CSS variables.
- Theme shadcn components through `:root` and `.dark` tokens rather than scattering hard-coded `dark:*` palette overrides.
- Keep `--radius` or the project's radius scale as source of truth; do not invent unrelated corner values for one component.
- Define reusable animations with theme variables or local utilities before using many one-off `animate-[...]` classes.

## Class Quality Rules

- Group classes by intent: layout, sizing, spacing, typography, color, border/effects, state, responsive.
- Split repeated class bundles into existing components, variant maps, `cn` helpers, or local primitives when repetition has semantic meaning.
- Do not hide everything behind opaque custom CSS classes; Tailwind should remain readable unless third-party markup or a true primitive needs CSS.
- Use arbitrary values for genuine one-offs, CSS variable references, masks, complex grids, or layout math; promote repeated arbitrary values into tokens.
- Avoid `transition-all`; prefer `transition-colors`, `transition-opacity`, `transition-shadow`, or `transition-transform`.
- Use `motion-safe:` for decorative motion and `motion-reduce:` to remove or simplify non-essential movement.
- Use `data-*`, `aria-*`, `open:`, `disabled:`, `invalid:`, `has-*`, `group-*`, and `peer-*` variants to style state instead of manually toggling brittle class strings.
- Use `contrast-more:`, `forced-colors:`, and `not-forced-colors:` when high-contrast environments are relevant.
- Avoid global `important` and widespread `!` modifiers; fix specificity or component boundaries instead.

## Container And Responsive Rules

- Use viewport breakpoints for page-level layout and container queries for cards, panels, dashboard tiles, embedded widgets, sidebars, and reusable components.
- Mark reusable component shells with `@container` and use named containers when nested contexts matter.
- Unprefixed utilities are the mobile baseline. Do not use `sm:` as the mobile style.
- Test around actual breakpoint edges, not only at ideal desktop and phone widths.
- Use `min-w-0`, `max-w-*`, `truncate`, `line-clamp`, wrapping, and explicit grid/flex constraints for long labels, translated strings, and user-generated content.

## Mechanical UI Checks

- Flex and grid children that contain text should usually have `min-w-0` plus intentional wrapping, truncation, or `line-clamp` behavior.
- Buttons, tabs, badges, table cells, nav items, and icon buttons should keep stable dimensions across hover, focus, active, disabled, loading, and selected states.
- Images and media shells need reserved dimensions, `aspect-*`, or explicit sizing so loading does not shift layout.
- Full-bleed and fixed-position layouts should account for mobile safe areas when controls sit near viewport edges.
- Avoid `overflow-x-hidden` as a blanket fix for real overflow. Fix the child constraint, table strategy, sticky element, or long-content behavior first.
- If theming changes touch the page shell, check `color-scheme`, native form controls, scrollbars, and theme-color behavior where the project supports dark mode.
- Format dates, numbers, currencies, and units through project helpers or `Intl.*` conventions before polishing spacing around hard-coded text.
- Preserve deep-linkable UI state for tabs, filters, pagination, and selected records when the product expects shareable or restorable state; style should not hide broken state ownership.

## Hard Failure Gates

- Do not finish a Tailwind visual/layout change with unresolved page-level horizontal scroll, clipped controls, sticky overlap, invisible focus, or text/control overlap at supported breakpoints.
- Do not leave state-driven layout shift where hover, focus, active, loading, or disabled states resize controls unexpectedly.
- Do not rely on dynamic Tailwind class construction such as `bg-${color}-600`; map variants to complete static class strings.
- Do not replace semantic shadcn/Tailwind tokens with hard-coded neutrals, hex values, or arbitrary spacing unless the product role is deliberate and documented.
- Do not close responsive polish by hiding overflow while controls, text, tables, or sticky elements remain unreachable.
- If screenshots/browser verification are unavailable, report the blocker and list the exact viewport/state matrix that remains unverified.

## Self-Critique And Revision Gate

Before closing a Tailwind polish task, inspect the result for slop and revise in code:

- Remove class changes that only add generic gradients, glow, glass, blobs, heavy shadows, nested cards, or random icon decoration.
- Replace magic spacing, color, radius, shadow, and type values with project tokens or document why the one-off is deliberate.
- Verify one primary action remains visually dominant and secondary/destructive actions are quieter or separated.
- Verify state styling does not resize controls, hide focus, reduce contrast, or create layout shift.
- Verify mobile is recomposed around task priority instead of being a compressed desktop layout.
- If a repeated class bundle now encodes a stable product intent, promote it to a local variant or component; otherwise keep the change local.

## Screenshot QA Checklist

- Capture before and after when possible for `320px` or `390px`, `768px` when relevant, and desktop-width viewports, adjusted to the app's supported breakpoints.
- Compare first viewport hierarchy, scroll depth, sticky elements, long-text cases, and modal/menu/table overflow.
- Inspect at least one empty, loading, error, disabled, selected, and focused state when those states exist.
- Check that hover/focus/active states do not resize controls or shift layout.
- Check dark mode separately when the project supports it.
- Check focus-visible, disabled, loading, empty, error, selected/current, hover, and active states when they exist.
- Treat screenshot differences as useful only when they improve hierarchy, task completion, readability, accessibility, or robustness. Decoration alone is not a win.

## Tailwind Fix Patterns

- Replace raw hex or arbitrary color values with project tokens unless the visual direction explicitly needs a new token.
- In shadcn projects, prefer semantic tokens for reusable UI: `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, and `ring` before hard-coded neutral palettes.
- Prefer `gap`, `space-*`, grid tracks, and flex wrapping over hard-coded margins between repeated items.
- Use `min-w-0`, `max-w-*`, `truncate`, `line-clamp`, stable icon sizes, and explicit grid/flex constraints for long content.
- Use `focus-visible:*` styles that are visible against the actual background, not only the default light surface.
- Use mobile-first Tailwind: unprefixed utilities define the narrow layout; `sm:`, `md:`, `lg:`, and larger prefixes progressively enhance it. Do not use `sm:` as the mobile style.
- Use container queries for reusable components whose layout depends on parent width more than viewport width.
- Keep cards shallow: use cards for repeated items or framed tools, not for every section inside another card.
- Keep button and control dimensions stable across states. Loading text/spinners should not resize the control.
- Use semantic variants for repeated states such as intent, size, tone, density, and selected/active.
- Preserve native semantics: anchors navigate, buttons perform actions, form controls keep labels and accessible names.

## References

- Use official Tailwind docs for utility classes, responsive design, theme variables, arbitrary values, source detection, and functions/directives; use shadcn/ui theming and `components.json` docs when shadcn is present.
- When available in the project, inspect existing layout primitives, shared buttons/inputs/cards, Tailwind config or CSS theme variables, shadcn theme, screenshots, design tokens, and adjacent pages with similar density.

## Validation

- Name the viewport, state, or component variant affected by every material issue.
- Tie color, spacing, typography, and motion comments to hierarchy, consistency, accessibility, or usability.
- Verify no horizontal scroll, no clipped controls, no sticky overlap, no text/control overlap, visible focus, and stable controls across relevant breakpoints.
- If screenshots or browser verification are unavailable, state the missing evidence and the safest exact checks to run.
- Do not claim visual improvement without comparing against the product's subject, local conventions, and at least one concrete user workflow.

## Output Contract

- Classification first: responsive bug, state styling gap, hierarchy issue, token drift, accessibility risk, density problem, or subjective polish.
- Evidence inspected: screenshot/browser viewport, code, local component pattern, tokens/config, state coverage, or missing.
- Proposed visual thesis when the task is subjective.
- Changes made or recommended, scoped to Tailwind classes, local variants, or small component extraction.
- Viewports and states verified, including the mobile/desktop screenshot matrix or the exact blocker.
- Remaining visual/accessibility risk and any screenshots or manual checks still needed.

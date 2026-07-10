---
name: tailwind-ui-polish
description: Improve Tailwind-based UI through screenshot-driven visual QA, responsive layout repair, spacing, density, typography, state styling, accessibility checks, token consistency, and subject-specific design polish.
---

# Tailwind UI Polish

Use this skill when Tailwind classes, local Tailwind components, shadcn/Tailwind tokens, or Tailwind-driven layouts are the implementation surface for visual polish, responsive repair, density tuning, or state styling. Do not use it for pure backend work, non-visual refactors, brand redesign from scratch, illustration work, or projects where Tailwind is not part of the UI layer.

## Ownership Boundary

Tailwind-ui-polish **implements or repairs an existing visual direction** through
Tailwind classes. It does not choose open-ended art direction, layout models, density
targets, or type/color systems. If the task requires a new broad direction or the user
asks for subjective visual direction without a reference, hand off to
`frontend.visual-design-polish`. Keep this skill focused on execution class tuning and
responsive/states/overflow repair of an existing direction.

## Project Archetype

Classify the project before prescribing tokens: **shadcn-backed**, **Tailwind with local semantic tokens**, or **Tailwind/CSS-first without a system**. Use shadcn names only in the first case; reuse local roles in the second; keep changes page-local in the third until repetition proves a system boundary. Do not turn a prototype or an inconsistent baseline into a token migration by default.

## Structured Execution Contract

For material responsive or state work, read `input.schema.json`, `workflow.json`, and `gates.json` before editing. Follow the selected profile without relaxing hard gates. With unknown model capability, use the constrained profile: preserve the existing direction, make the smallest bounded class change, verify declared states and viewports, and run one repair pass. Return `output.schema.json`; use `evals.json` for isolated evaluation.

## Verification Outcome

- Report `verified` only after the changed view is rendered at the relevant desktop and mobile widths.
- Without browser or screenshot capability, allow only analysis and small reversible fixes; mark material layout or visual work `blocked`.
- If the user explicitly accepts the risk, return `implemented-unverified` with a manual overflow, focus, state, and viewport checklist.

## Decision Rules

- Start from the product's subject, audience, and primary job. A manga library, CRM dashboard, and health portal should not receive the same palette, density, typography, or decorative moves.
- If the project has `DESIGN.md`, use it as the visual source for Tailwind class choices. Otherwise infer only the bounded implementation rules supported by adjacent screens. If a new visual thesis is required, hand off to `frontend.visual-design-polish`.
- Match the existing app style. If the request explicitly asks to move the direction, hand off before changing classes.
- Treat screenshots, rendered browser state, and real viewport checks as required evidence for visual/layout changes. Code inspection alone is not enough to close Tailwind polish work unless browser access is blocked.
- Prioritize layout stability, readable density, hierarchy, and state coverage over decorative changes.
- Treat overflow, wrapping, contrast, focus visibility, sticky overlap, and responsive breakage as correctness issues.
- Prefer semantic Tailwind tokens, local variants, `cn` helpers, CVA/class helpers, or shared components when repeated utility clusters become meaningful duplication.
- Use arbitrary values only when no project token expresses the role or when a deliberate product-specific token is being introduced.
- Avoid one-note palettes, generic gradient/blob/card layouts, nested cards, ornamental shadows, random icon grids, and animation without a job.
- Avoid inherited model house styles unless the brief earns them. Warm cream plus serif plus terracotta, purple gradients, dark neon glass, and bento-card grids are defaults, not decisions.
- For subjective polish, set the design dials first: design variance, motion intensity, and visual density. A dense admin table, consumer landing page, and onboarding flow should not receive the same Tailwind treatment.
- Keep dashboard, CRM, admin, and operational tools compact and scannable. Save hero-scale type, large imagery, and editorial spacing for content that actually needs it.
- Keep boundaries sharp: use `frontend.design-system` for token/theme architecture, `frontend.visual-design-polish` for broad visual direction, `frontend.ux-critique` for task-flow redesign, `frontend.interaction-polish` for local component motion, and `frontend.motion-design` for product-wide motion systems.
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
   If these rules cannot be derived from an existing direction, reference, or adjacent UI, stop and hand off instead of inventing 2-3 directions here.
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

For detailed class-level, layout-mechanical, and container guidance, read
[the mechanical rules reference](references/mechanical-rules.md). The workflow below
covers the essential audit structure — use the reference for specific class patterns.

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

For token discipline, class construction, responsive, layout-mechanical, and fix-pattern
guidance, read [the mechanical rules reference](references/mechanical-rules.md).

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

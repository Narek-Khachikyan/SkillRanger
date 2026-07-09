---
name: design-system
description: Audit, extract, and apply frontend design-system conventions for Tailwind, shadcn, tokens, component variants, theme consistency, and anti-drift UI maintenance.
---

# Design System

Use this skill when a frontend project needs token cleanup, shadcn/Tailwind theme review, component variant extraction, repeated class consolidation, or consistency checks across buttons, inputs, cards, badges, navigation, and layout primitives. Do not use it for one-off visual taste work unless the task is about making the system consistent.

## Systemization Gate

Extract a token, variant, or primitive only when the same semantic need appears in at least two current product surfaces or has a confirmed near-term owner. For throwaway prototypes, a single local exception, or a visibly inconsistent legacy baseline, prefer a small local repair and record the candidate pattern instead of normalizing existing noise into a system. Preserve deliberate distinctive values by giving them a semantic role when they repeat; do not flatten them into default shadcn neutrals.

## Decision Rules

- Discover the existing system before inventing a new one.
- Treat `DESIGN.md` as design context when present. Use it to map visual intent to tokens and components; do not treat it as executable skill behavior.
- Prefer semantic tokens and local variants over raw colors, magic numbers, and one-off utility bundles.
- Extract a component or variant only when repetition, state complexity, or ownership boundaries justify it.
- Keep tokens layered: primitive values, semantic roles, then component variants.
- Treat focus, disabled, selected, loading, error, and dark-mode styles as part of the system, not afterthoughts.
- A design system should preserve product character, not flatten every app into default shadcn/Tailwind neutrals. Use the system to make distinctive choices repeatable.
- Decide whether the task needs adoption, adaptation, or creation: adopt existing components, adapt tokens/variants, or create a new primitive only when repeated product needs justify it.
- Optimize for same grammar, different voice: component anatomy, state behavior, and accessibility stay consistent while type, color, shape, material, density, motion, and imagery preserve brand identity.
- Use tokens to encode decisions, not decoration. Token names should describe roles and intent, not merely raw values.
- Add new variants only when they express stable semantic or product intent, not because one screen needs a one-off visual flourish.

## Workflow

1. Inspect system sources: `DESIGN.md`, `tailwind.config.*`, global CSS, `components.json`, shadcn setup, `cn` helpers, CVA/variant utilities, shared components, and adjacent screens.
2. Map current primitives: color, spacing, radius, shadow, typography, z-index, animation, and breakpoints.
3. Identify semantic roles: surface, panel, border, text, muted text, accent, danger, success, warning, focus, and interactive states.
   In shadcn projects, map these against `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, chart tokens, sidebar tokens, and radius tokens.
4. Audit drift:
   - arbitrary values where tokens exist;
   - duplicated class bundles;
   - inconsistent radius/shadow/gap/type scale;
   - copied shadcn components modified inconsistently;
   - dark-mode or focus-ring mismatches;
   - product-specific visual moves implemented as one-off hacks instead of reusable tokens or variants.
5. Choose the smallest system move:
   - normalize token use;
   - add a variant;
   - extract a local primitive;
   - add or rename semantic tokens for repeated product roles;
   - document a local convention in code;
   - defer broad migrations.
6. Check whether the change preserves distinctiveness: brand type, shape, rhythm, motion, imagery, and voice should remain recognizable.
7. Verify examples across at least two components or states so the change is truly systematic.

## Token Architecture

- Layer tokens as primitive values, semantic roles, and component tokens.
- If `DESIGN.md` exists, map its colors, typography, rounded, spacing, and component entries into the local token model before adding new values.
- Components should consume semantic roles such as `text.primary`, `surface.elevated`, `border.focus`, `action.primary`, `status.warning`, `motion.dialog.enter`, or shadcn equivalents, not raw palette values.
- Use component tokens sparingly for unavoidable specificity such as button primary background, input invalid border, or nav selected surface.
- Include usage descriptions for semantic tokens. A token without a role description becomes a disguised primitive.
- Keep role names stable across themes; change token values per theme, not component APIs.
- Dark mode, high contrast, density modes, and brand themes should map through the same roles.
- Add deprecation metadata or migration notes when replacing tokens; token names are contracts for downstream agents and developers.

## Distinctiveness Without Drift

- Define brand cue categories: voice, typography, color temperature, radius, border weight, surface material, icon stroke, illustration style, motion tone, spacing density, and data visualization style.
- Preserve `DESIGN.md` identity constraints as system rules: accent scarcity, radius policy, depth/elevation model, typography weight/tracking, section rhythm, and responsive collapse order.
- Preserve expression levels: core product UI restrained, marketing/editorial more expressive, campaign moments most expressive.
- Create utility restraint zones: forms, settings, billing, permissions, errors, destructive actions, search, tables, and checkout should prioritize clarity and familiarity.
- Create signature moment zones: onboarding, dashboard landing, empty states, AI assistant surfaces, completion states, upgrade screens, and homepage hero can carry stronger brand expression.
- Avoid flattening mature apps into default shadcn neutrals, generic `primary/secondary` buttons, identical cards, and one-size-fits-all radius/shadow.
- Extract repeated product-specific moves into reusable tokens or variants, such as `evidence`, `warningRail`, `metric`, `magic`, `editorial`, `operator`, `compact`, or `marketplace` when the product actually needs them.

## Variant And Component Rules

- Variants should encode intent: `destructive`, `success`, `warning`, `quiet`, `prominent`, `selected`, `ai`, `editorial`, `operator`, `compact`, or `marketing`, not arbitrary color names.
- Keep variant matrices small and document supported combinations of intent, size, density, loading, disabled, selected, and error.
- Use slots/composition for unique layouts and variants for repeated decisions.
- Do not add `className` escape-hatch styling as the main design path; the canonical API should produce high-quality UI without manual restyling.
- If a component needs many unrelated props to satisfy unrelated screens, split it into leaf primitives and product-specific composites.
- Stories or examples should cover realistic content, long labels, empty/loading/error states, disabled/focus states, density, responsive behavior, dark mode, and product-specific usage.

## Motion And Density Tokens

- Define density modes when the product needs them: comfortable, cozy, compact, or product-specific names. Density should affect spacing, component height, padding, gap, type, line-height, and touch targets.
- Compact density can reduce visual padding, but must not break minimum touch targets when touch input is expected.
- Define motion roles by intent: `feedback.quick`, `popup.enter`, `panel.exit`, `page.transition`, `toast.enter`, `brand.moment`, and reduced-motion alternatives.
- Frequent interactions should use fast, subtle motion; expressive motion belongs to low-frequency brand moments.
- Reduced-motion alternatives are part of the token contract, not optional implementation detail.

## Validation

- Check representative light/dark states when present.
- Verify state variants: hover, focus-visible, active, selected, disabled, loading, error.
- Ensure extracted variants do not hide important accessibility attributes.
- Confirm no broad visual regression on adjacent pages.
- Confirm the system change improves consistency without erasing a deliberate brand or product-specific visual direction.
- Verify token and variant changes against light/dark modes, density modes, focus states, disabled states, selected states, and error states where present.
- Verify AI agents can infer when to use the token/component from names, descriptions, stories, and examples.

## Output Contract

- System area first: tokens, variants, shadcn theme, component primitives, or layout conventions.
- Drift evidence with file/component references.
- Minimal system change proposed or made.
- Components/states verified.
- Deferred migration notes when full cleanup is larger than the task.

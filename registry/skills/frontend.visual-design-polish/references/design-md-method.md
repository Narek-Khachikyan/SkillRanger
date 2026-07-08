# DESIGN.md Method For Visual Design

Use this reference when a frontend design task is open-ended, generic-looking, reference-driven, or likely to drift into model-house style.

## Core Idea

High-quality AI-generated UI needs a reusable design source, not only taste advice. A `DESIGN.md`-style source defines how the product should look and feel in terms agents can apply repeatedly: visual theme, tokens, component rules, layout behavior, guardrails, and responsive strategy.

Before material visual work, look for an existing `DESIGN.md` in the project root or docs. If one exists, treat it as the visual source of truth unless the user explicitly asks to replace it. If none exists, create a compact mini-DESIGN spec before implementing.

## Mini-DESIGN Spec

For fast work, define these sections in the response or working notes before changing UI:

1. Visual Theme & Atmosphere: product world, audience, mood, density, proof medium, and one-sentence thesis.
2. Color Palette & Roles: canvas, surface, raised surface, text, muted text, hairline, primary action, focus, semantic statuses, data colors.
3. Typography Rules: display, heading, body, label, caption, button, data/mono roles; weight, tracking, line-height, numeric behavior.
4. Component Stylings: primary/secondary buttons, cards/panels, inputs, nav, tables, badges, empty states, modals, toasts, and their states.
5. Layout Principles: container width, grid, spacing scale, section rhythm, density, alignment, scroll ownership.
6. Depth & Elevation: surface ladder, hairlines, shadows, photography, screenshots, bevels, or no-depth rule.
7. Do's and Don'ts: specific positive rules and forbidden defaults.
8. Responsive Behavior: breakpoints, collapse order, touch targets, image crops, table strategy, mobile action placement.
9. Agent Prompt Guide: exact tokens/rules to reuse and what to reject.

## Strong Design Rules

- Encode identity as constraints: what color can do, what type can do, what radius means, what depth model is allowed, and what layout rhythm must preserve.
- Use scarce accent policies. A primary accent usually belongs to primary CTA, focus, links, brand mark, or selected state, not background decoration.
- Choose a depth model. Do not mix surface ladders, heavy shadows, glass, glows, gradients, and photography unless the visual thesis explicitly earns each layer.
- Treat radius as grammar. Square, pill, soft, and mixed-radius systems communicate different eras and product personalities.
- Make common app surfaces brand-native: buttons, cards, inputs, tables, nav rows, modals, toasts, empty states, pricing/plan cards, and onboarding surfaces.
- Mobile must preserve the visual grammar, not merely stack desktop cards.

## Reference Safety

When learning from public brand analyses or reference sites, extract reusable attributes rather than copying identity. Do not copy logos, names, proprietary marks, exact palettes plus layouts, mascots, hero compositions, or a trade-dress impression that implies affiliation. Change multiple axes: hue, typography, geometry, composition, voice, and domain artifacts.

## Failure Signs

- The result can only be described as clean, modern, premium, sleek, or beautiful.
- The page could fit an unrelated SaaS by swapping logo and copy.
- There is no token map or component-state rule behind the visuals.
- The primary accent appears everywhere because the design lacks hierarchy.
- Mobile collapses into identical rounded cards and loses the signature detail.
- Decorative gradients, glows, cards, or icons do not encode information, brand, proof, or state.

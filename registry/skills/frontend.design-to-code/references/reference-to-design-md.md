# Reference To DESIGN.md Extraction

Use this reference when translating a screenshot, site, mock, moodboard, Figma-style brief, or visual reference into code.

## Extraction Pass

Before implementation, convert the reference into a DESIGN.md-style brief:

- Visual theme: what world the reference creates and what job that world serves.
- Reusable attributes: hierarchy, density, composition, color temperature, spacing rhythm, materiality, type roles, motion rhythm, image treatment.
- Token roles: canvas, surfaces, text, muted text, border/hairline, primary action, focus, statuses, chart/data colors.
- Typography: display/body/label/data roles, weight, tracking, line-height, numeric behavior, fallbacks.
- Components: buttons, cards, nav, inputs, tables, badges, modals, empty states, toasts, and state variants.
- Layout: containers, grid, gutters, section rhythm, responsive collapse order, touch targets, image crop strategy.
- Guardrails: what must remain, what must not be copied, and what defaults are rejected.

## Translation Rules

- Preserve design intent, not isolated pixels.
- Map the extracted rules into local components, tokens, Tailwind theme variables, CSS variables, and existing state conventions.
- Preserve the reference's non-generic signature only after adapting it to the product's domain and brand.
- If a reference is a public brand, competitor, or creator work, change multiple axes: composition, hue, type genre, component chrome, copy structure, iconography, imagery, and motion.
- If the reference is attractive but wrong for the product, keep only the useful attributes and reject the rest.

## Common App Surface Check

After extraction, verify that the visual language works beyond the hero:

- Primary and secondary CTA.
- Repeated card or row.
- Input/form control and focus state.
- Navigation active state.
- Dense data cell or metadata row.
- Empty/loading/error state.
- Modal/drawer/toast surface.
- Mobile version of the primary workflow.

## Output Requirements

- State the extracted mini-DESIGN brief before implementation summary.
- List risky elements avoided from the reference.
- List local substitutions for fonts, assets, icons, colors, and components.
- Name fidelity gaps and screenshot/browser checks still required.

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

## Signature Decomposition

Before implementation, decompose the reference's distinctive visual idea into
reusable attributes and context-bound elements:

1. **Name the signature:** what makes this reference non-generic — a layout move,
   type treatment, material choice, color-as-data system, or interaction pattern.
2. **Separate structure from expression:** composition grid, density model, and type
   hierarchy are structural; palette, font choice, and imagery are expression.
   Structural elements are more portable; expression needs product-specific
   translation.
3. **Identify dependency on reference-specific content:** does the signature rely on a
   particular photo, illustration, data shape, or copy length? If the content changes,
   does the signature survive?
4. **Translate into the product system:** map the structural idea to local tokens,
   breakpoints, and component primitives. Replace the expression with product-native
   alternatives.
5. **Verify signature survival:** after translation, does the distinctive idea still
   read? If not, the signature was too dependent on surface-level elements rather
   than structural decisions.

## AI-Generated Reference Treatment

When a reference is AI-generated (DALL-E, Midjourney, Sora, etc.):

- Treat it as a mood attribute source, not an implementable spec. AI outputs invent
  plausible but non-functional UI: unrealistic text, impossible responsive behavior,
  missing states, fake data visualizations, and decorative elements that look
  meaningful but encode no information.
- Extract at most: composition schema, color temperature range, density model,
  hierarchy pattern, material treatment, and typographic voice.
- Reject: AI-invented people (never use "Photo of a smiling doctor" from a
  prompt), impossible product screenshots, fake brand marks, decorative blobs/gradients
  that serve no UI function, unrealistic data charts, and UI elements that have no
  real interaction model.
- Decompose the AI output into individual design decisions. For each: can this be
  implemented with real content, real components, and real states? If not, replace
  with a product-native alternative or remove it.
- Document every element rejected because it was AI-invented rather than
  product-derived.

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

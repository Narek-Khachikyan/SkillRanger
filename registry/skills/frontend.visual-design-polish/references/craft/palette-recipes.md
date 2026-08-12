# OKLCH Palette Recipes

Palette recipes for the frontend craft layer, expressed in OKLCH so the same recipe produces distinct palettes for different products. A recipe fixes the *relationship* between tokens (how much lighter the canvas is than the surface, how much chroma the accent carries) while leaving the hue to the product. This is deliberate: the recipe is reusable knowledge, the concrete hue is the product's identity.

## How To Use A Recipe

1. Pick the recipe whose register matches the product, or assemble one from the formulas below.
2. Choose one base hue (a number in OKLCH hue space, 0–360). The recipe then derives every token from it.
3. Record the palette anchor and its recipe name in the direction's `colorRoles`/theme note so the identity fingerprint can detect repetition.
4. Do not hand-pick six unrelated hexes; derive them so the page reads as one light system.

## Token Formulas

All values are `oklch(l c h)` where `h` is the chosen base hue unless noted.

- **Canvas:** `oklch(0.965 0.008 h)` — the page background; near-white, barely tinted.
- **Surface:** `oklch(0.995 0.004 h)` — raised cards; lighter than canvas so panels read as raised, not sunken.
- **Ink:** `oklch(0.22 0.02 h)` — primary text.
- **Muted ink:** `oklch(0.48 0.018 h)` — secondary text and meta.
- **Hairline:** `oklch(0.88 0.01 h)` — borders at 100% and in-between hairline on tinted surfaces.
- **Accent:** `oklch(0.55 0.18 h')` where `h'` is a hue at least 30° from the base hue — scarce: primary CTA, focus, links, selected state. Accent does not paint backgrounds.
- **Accent ink (text on accent):** `oklch(0.99 0.01 h')` or near-white ink.
- **Positive:** `oklch(0.55 0.16 150)` — success, independent of the base hue so status never blends with identity color.
- **Warning:** `oklch(0.62 0.14 80)`.
- **Negative:** `oklch(0.55 0.17 25)`.
- **Data colors:** 3–5 colors, each `l` 0.55–0.65, `c` 0.12–0.16, hues spaced ≥ 60° apart; never reuse the accent hue for a data series.

## Recipes

### 1. Paper And Ink (editorial / document-like)

- Base: warm paper, hue ~85–95 (soft yellow-green tint at very low chroma).
- Canvas is the warmest token; surfaces drift neutral; ink stays the darkest warm gray.
- Accent: a deep red or vermilion, `h'` ~25–40 — the "stamp" register.
- Bans: no gradient washes, no glowing accent, no cool-gray canvas with warm text.

### 2. Graphite And Signal (developer tool / command center)

- Base: neutral blue-gray, hue ~240–260 at very low chroma.
- Canvas nearly achromatic (`c 0.004`); ink the only strongly dark token.
- Accent: a single electric signal hue, `h'` ~160–200 (teal/cyan family), used only for primary action, focus, and the one live indicator.
- Bans: no multicolor accents, no purple-to-blue gradient headers, no glowing orbs.

### 3. Muted Earth (consumer / habit-forming)

- Base: warm neutral, hue ~60–75.
- Accent: a saturated terracotta or olive, `h'` ~30–50 or ~110–130; the pair stays warm.
- Bans: no cold-blue accent on a warm base, no candy gradients.

### 4. Clinical Cyan (saas / workspace)

- Base: cool neutral, hue ~220–240.
- Accent: cyan/azure, `h'` ~200–210 with the highest chroma budget in this set (`c 0.20`), because the register is calm and needs one strong action color.
- Bans: no neon accents, no blue-on-blue primary action on blue surfaces, no gradient logo washes.

### 5. Ivory And Commerce (e-commerce / premium)

- Base: ivory, hue ~70–85, chroma 0.010.
- Surface: slightly cooler than canvas so product imagery pops.
- Accent: deep forest or oxblood, `h'` ~140–150 or ~20–30; price and savings use the data colors, never the accent.
- Bans: no confetti multi-accent carts, no glowing sale badges, no gradient price tags.

## Palette Grammar

- **Scarce accent:** one accent token at a time. It belongs on the primary CTA, focus, links, and the selected state — not on section backgrounds, icons, or decoration.
- **Temperature discipline:** warm canvas → warm ink and warm accent; cool canvas → cool ink and cool accent. Mixing temperatures is a choice, not an accident; say why.
- **Status is separate:** positive/warning/negative hues never depend on the base hue, so a colorblind-safe non-color cue must always accompany them.
- **Dark mode:** invert lightness, not chroma — keep the same hue relationships and lower the accent chroma slightly instead of brightening it.
- **Contrast floor:** ink on canvas ≥ 7:1, muted ink ≥ 4.5:1, accent ink on accent ≥ 4.5:1, before considering any decoration.

## Provenance

### Observed

- The maintainer has built and shipped interfaces following each recipe and has used the token formulas (canvas/surface/ink/accent/status separation) in the author's own frontend practice.
- The example plates in `domains/frontend/examples/` exercise the accent-scarcity and status-separation behaviors the recipes formalize.

### Inferred

- Expressing recipes as OKLCH relationship formulas rather than fixed hues follows from the product-identity requirement: two briefs must produce visually distinct palettes without the corpus prescribing one color identity.
- The temperature-discipline and scarce-accent grammar derive from the color role contracts already enforced by the rule library.

### Assumed

- The consuming skill can express tokens in OKLCH (Tailwind 3.4+/4 and modern CSS support it); recipes degrade to `rgb()` conversion when the project cannot represent OKLCH.

### Unknown

- Whether a recipe graduates to a bundled design rule requires recurring, independently sourced evidence through the tiered promotion bar; this corpus only proposes relationships, not rules.

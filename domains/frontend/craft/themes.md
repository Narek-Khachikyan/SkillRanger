# Themes

Named, whole-page color-and-material identities expressed as OKLCH token sets. A palette recipe fixes the *relationship* between tokens; a theme fixes the *identity* — the actual lightness, chroma, and hue of every token, the paper band it sits on, the display style it favors, and the accent hue it is allowed to use. A theme is the smallest unit the direction step can state out loud: pick one by name, record its axes (`paperBand`, `displayStyle`, `accentHue`) in the direction's `themeAxes`, and the identity fingerprint can detect repetition across builds.

## How To Use A Theme

1. Match the theme's genre affinities to the recipe id; if the product straddles two genres, pick the theme whose register (not its name) fits the primary task.
2. Take the token set as-is, then adapt: swap `h` only when the product's own identity demands it, never the token *structure*.
3. Record the theme name and its three axes in the direction's `themeAxes` so the verification machine can fingerprint it.
4. Respect the theme's bans exactly — they are the edge of the identity, and a ban violated is a different theme.
5. A theme is craft knowledge, not a rule: it never participates in the six-family rule selection and carries no verification gates.

## Themes

### 1. Newsprint

A warm paper identity for editorial and document-like products. Reads like the
printed page: warm near-white paper, dark warm ink, one stamp accent.

- **Tokens:**
  - Canvas: `oklch(0.955 0.012 85)`
  - Surface: `oklch(0.99 0.008 85)` — slightly brighter than canvas so panels lift, never float.
  - Ink: `oklch(0.20 0.014 60)` — warm near-black.
  - Muted ink: `oklch(0.46 0.016 60)`.
  - Hairline: `oklch(0.87 0.012 80)`.
  - Accent: `oklch(0.50 0.16 30)` — vermilion, the stamp register; scarce.
  - Accent ink: `oklch(0.98 0.01 30)`.
  - Status: positive `oklch(0.52 0.13 150)`, warning `oklch(0.60 0.12 80)`, negative `oklch(0.52 0.14 25)`.
  - Data colors: 3–5 colors, `l` 0.50–0.62, `c` 0.10–0.14, hues spaced ≥ 60° apart (e.g. 30, 110, 190, 270).
- **Genre affinities:** `editorial-content`, `marketing-landing` (premium brand pages), `saas-workspace` (quiet, document-heavy work surfaces).
- **Bans:** no cool-gray canvas with warm ink; no gradient washes; no glowing accent; no centered hero headline; no glass panels; no dark mode that inverts to a blue-black.
- **Theme axes:** `paperBand: warm newsprint` · `displayStyle: editorial serif` · `accentHue: vermilion 30`.

### 2. Signal Console

A cool graphite identity for developer tools and command centers. Canvas is nearly achromatic; one electric signal hue carries every interactive voice.

- **Tokens:**
  - Canvas: `oklch(0.955 0.004 250)` — near-achromatic cool paper.
  - Surface: `oklch(0.985 0.005 250)`.
  - Ink: `oklch(0.19 0.012 255)`.
  - Muted ink: `oklch(0.46 0.012 255)`.
  - Hairline: `oklch(0.88 0.008 250)`.
  - Accent: `oklch(0.56 0.14 190)` — teal/cyan, the single signal hue; primary action, focus, one live indicator, nothing else.
  - Accent ink: `oklch(0.98 0.005 190)`.
  - Status: positive `oklch(0.55 0.13 155)`, warning `oklch(0.60 0.12 85)`, negative `oklch(0.53 0.15 25)`.
  - Data colors: 4 colors, `l` 0.55–0.65, `c` 0.10–0.14, hues 15, 95, 175 (never the accent hue 190), 265.
- **Genre affinities:** `developer-tool`, `operational-command-center`.
- **Bans:** no multicolor accent system; no purple-to-blue gradient headers; no glowing orbs; no accent on backgrounds or icons; no candy status badges; no decorative imagery inside rows.
- **Theme axes:** `paperBand: cool graphite` · `displayStyle: technical grotesque` · `accentHue: signal teal 190`.

### 3. Muted Earth

A warm, low-chroma consumer identity. Everything stays in the warm family; the accent is a saturated earth tone that never leaves it.

- **Tokens:**
  - Canvas: `oklch(0.96 0.016 70)` — warm sand.
  - Surface: `oklch(0.99 0.01 70)`.
  - Ink: `oklch(0.21 0.018 55)`.
  - Muted ink: `oklch(0.47 0.02 60)`.
  - Hairline: `oklch(0.87 0.014 70)`.
  - Accent: `oklch(0.52 0.14 45)` — terracotta; or olive `oklch(0.50 0.11 120)`; the pair stays warm.
  - Accent ink: `oklch(0.98 0.01 45)`.
  - Status: positive `oklch(0.55 0.13 150)`, warning `oklch(0.60 0.12 85)`, negative `oklch(0.52 0.14 25)`.
  - Data colors: 3–5 colors, `l` 0.50–0.62, `c` 0.10–0.14, hues 35, 110, 200, 300 — never the accent hue.
- **Genre affinities:** `consumer-discovery`, `mobile-consumer-app`, `e-commerce` (everyday goods, not premium).
- **Bans:** no cold-blue accent on a warm base; no candy gradients; no confetti multi-accent surfaces; no glowing sale badges; no purple accents; no dark mode that shifts the base cool.
- **Theme axes:** `paperBand: warm sand` · `displayStyle: rounded humanist` · `accentHue: terracotta 45`.

### 4. Clinical Cyan

A cool, calm workspace identity. The register is quiet, so the one strong action color is allowed the highest chroma budget in this set.

- **Tokens:**
  - Canvas: `oklch(0.96 0.006 230)` — cool neutral, barely blue.
  - Surface: `oklch(0.995 0.004 230)`.
  - Ink: `oklch(0.20 0.012 245)`.
  - Muted ink: `oklch(0.47 0.012 240)`.
  - Hairline: `oklch(0.88 0.008 230)`.
  - Accent: `oklch(0.55 0.20 205)` — cyan/azure with the highest chroma budget in the set.
  - Accent ink: `oklch(0.99 0.005 205)`.
  - Status: positive `oklch(0.55 0.14 152)`, warning `oklch(0.61 0.13 82)`, negative `oklch(0.53 0.16 24)`.
  - Data colors: 4 colors, `l` 0.55–0.65, `c` 0.10–0.15, hues 15, 95, 170, 265 — never the accent hue 205.
- **Genre affinities:** `saas-workspace`, `developer-tool` (cleaner, less dense briefs), `operational-command-center` (lighter duty consoles).
- **Bans:** no neon accents; no blue-on-blue primary action on blue surfaces; no gradient logo washes; no glowing orbs; no purple-to-blue gradients; no accent on every row's icon.
- **Theme axes:** `paperBand: cool neutral` · `displayStyle: clean grotesque` · `accentHue: cyan 205`.

### 5. Ivory Commerce

A premium commerce identity. Ivory paper, imagery-forward surfaces, and a deep, rich accent that never outshouts the product.

- **Tokens:**
  - Canvas: `oklch(0.955 0.012 75)` — ivory.
  - Surface: `oklch(0.985 0.006 240)` — cooler than canvas so product imagery pops against it.
  - Ink: `oklch(0.20 0.012 60)`.
  - Muted ink: `oklch(0.46 0.014 65)`.
  - Hairline: `oklch(0.87 0.01 75)`.
  - Accent: `oklch(0.42 0.09 145)` — deep forest; or oxblood `oklch(0.40 0.10 25)`.
  - Accent ink: `oklch(0.97 0.01 145)`.
  - Status: positive `oklch(0.55 0.13 150)`, warning `oklch(0.60 0.12 85)`, negative `oklch(0.52 0.14 25)`.
  - Data colors: 4 colors, `l` 0.50–0.62, `c` 0.09–0.13, hues 30, 105, 190, 260; price and savings use the data colors, never the accent.
- **Genre affinities:** `e-commerce` (premium), `marketing-landing` (high-end brand launches), `editorial-content` (catalog-like editorial).
- **Bans:** no confetti multi-accent carts; no glowing sale badges; no gradient price tags; no neon or pastel candy colors; no accents on product imagery frames.
- **Theme axes:** `paperBand: ivory` · `displayStyle: refined serif` · `accentHue: deep forest 145`.

### 6. Stage Black

A high-expression dark identity for launch and media surfaces. Near-black paper, one hot accent hue, chroma reserved for the single voice.

- **Tokens:**
  - Canvas: `oklch(0.13 0.012 250)` — near-black with a cool cast.
  - Surface: `oklch(0.17 0.014 250)` — lighter than canvas, never lighter than a mid gray.
  - Ink: `oklch(0.95 0.008 250)`.
  - Muted ink: `oklch(0.68 0.012 250)`.
  - Hairline: `oklch(0.30 0.012 250)`.
  - Accent: `oklch(0.70 0.15 70)` — amber; or signal red `oklch(0.62 0.17 25)`. One hot hue only.
  - Accent ink: `oklch(0.13 0.01 250)`.
  - Status: positive `oklch(0.60 0.13 152)`, warning `oklch(0.64 0.13 85)`, negative `oklch(0.58 0.16 25)`.
  - Data colors: 4 colors, `l` 0.58–0.68, `c` 0.11–0.15, hues 20, 100, 180, 260 — never the accent hue.
- **Genre affinities:** `marketing-landing` (launch surfaces), `consumer-discovery` (premium media discovery), `mobile-consumer-app` (immersive media).
- **Bans:** no full-rainbow accents; no glossy orbs; no glow spam (glow on one hero element max); no low-contrast dark-on-dark body text; no inverting to a gray-on-gray wash; no accent for every state.
- **Theme axes:** `paperBand: near-black` · `displayStyle: dramatic grotesque` · `accentHue: amber 70`.

### 7. Arctic White

A minimal enterprise identity for dense SaaS and operational surfaces that need pure, near-white clarity. Colder and lighter than graphite or clinical cyan, it reads like fresh paper under cool north light; the single indigo accent carries all signal work.

- **Tokens:**
  - Canvas: `oklch(0.985 0.004 250)` — arctic white, barely tinted cool.
  - Surface: `oklch(0.995 0.003 250)` — lifted white for cards, no tint shift.
  - Ink: `oklch(0.19 0.010 255)` — cool near-black with a blue cast.
  - Muted ink: `oklch(0.49 0.010 250)`.
  - Hairline: `oklch(0.90 0.006 250)`.
  - Accent: `oklch(0.49 0.15 275)` — indigo, the only signal hue; deep rather than bright.
  - Accent ink: `oklch(0.98 0.01 275)`.
  - Status: positive `oklch(0.55 0.13 150)`, warning `oklch(0.61 0.12 85)`, negative `oklch(0.53 0.14 25)`.
  - Data colors: 4 colors, `l` 0.55–0.65, `c` 0.10–0.13, hues 20, 80, 150, 210 — never the accent hue 275.
- **Genre affinities:** `saas-workspace` (enterprise, dense tooling), `operational-command-center` (light-duty dashboards that must stay quiet).
- **Bans:** no warm paper tint on this canvas; no purple-to-blue gradient headers; no glowing orbs; no accent on row icons or backgrounds; no mid-gray wash that dulls the white; no candy status badges.
- **Theme axes:** `paperBand: arctic white` · `displayStyle: Swiss grotesque` · `accentHue: indigo 275`.

### 8. Stone Archive

A dusty archival identity for editorial and system-of-record surfaces. Greige stone paper, restrained contrast, one warm ochre marker that reads like a filed tab.

- **Tokens:**
  - Canvas: `oklch(0.94 0.011 80)` — archival stone, warm greige.
  - Surface: `oklch(0.975 0.008 80)` — warmer than canvas, still muted so text stays dominant.
  - Ink: `oklch(0.22 0.016 65)` — warm near-black.
  - Muted ink: `oklch(0.49 0.015 70)`.
  - Hairline: `oklch(0.86 0.01 80)`.
  - Accent: `oklch(0.60 0.13 85)` — ochre, the filed-tab marker; mid-lightness so it works on stone.
  - Accent ink: `oklch(0.18 0.012 65)` — dark ink on ochre for the required contrast floor.
  - Status: positive `oklch(0.54 0.12 150)`, warning `oklch(0.61 0.13 82)`, negative `oklch(0.52 0.14 25)`.
  - Data colors: 4 colors, `l` 0.52–0.64, `c` 0.09–0.13, hues 30, 120, 200, 280 — never the accent hue 85.
- **Genre affinities:** `editorial-content` (archive, report library), `operational-command-center` (system-of-record consoles).
- **Bans:** no cool-blue canvas on warm stone ink; no neon or high-chroma candy accents; no gradient washes; no decorative hairline grids; no glass or blur panels; no centered hero headline on archive lists.
- **Theme axes:** `paperBand: archival stone` · `displayStyle: archival serif` · `accentHue: ochre 85`.

### 9. Midnight Navy

A dark immersive identity distinct from near-black Stage Black. Canvas is deep navy rather than graphite black, so the surface step is blue-shifted and the single violet accent reads as electric rather than hot.

- **Tokens:**
  - Canvas: `oklch(0.15 0.02 265)` — deep navy near-black with a blue cast.
  - Surface: `oklch(0.20 0.022 265)` — lighter than canvas, still near-black; never mid-gray.
  - Ink: `oklch(0.96 0.008 250)`.
  - Muted ink: `oklch(0.68 0.012 255)`.
  - Hairline: `oklch(0.28 0.018 265)`.
  - Accent: `oklch(0.62 0.18 300)` — violet, one electric hue on navy; chroma reserved for the single voice.
  - Accent ink: `oklch(0.98 0.01 300)`.
  - Status: positive `oklch(0.60 0.13 152)`, warning `oklch(0.64 0.13 85)`, negative `oklch(0.58 0.16 25)`.
  - Data colors: 4 colors, `l` 0.58–0.68, `c` 0.11–0.15, hues 25, 80, 160, 210 — never the accent hue 300.
- **Genre affinities:** `marketing-landing` (immersive dark launch), `saas-workspace` (dark console variant), `mobile-consumer-app` (immersive media).
- **Bans:** no warm-paper inversion; no amber or terracotta accent on navy (belongs to Stage Black); no glow flood beyond one hero element; no blue-on-blue primary action on navy surface; no full-rainbow accents; no low-contrast muted ink on navy.
- **Theme axes:** `paperBand: deep navy` · `displayStyle: ink serif` · `accentHue: violet 300`.

### 10. Sunbaked Clay

A warm lifestyle identity distinct from muted earth and newsprint. Clay paper is more saturated than sand, but the accent is a cool-leaning plum that complements rather than repeats the warm family, giving habit-forming surfaces a softer, humanist voice.

- **Tokens:**
  - Canvas: `oklch(0.95 0.018 45)` — sunbaked clay, warm with visible chroma.
  - Surface: `oklch(0.985 0.01 45)` — near-white warm lift for product and content cards.
  - Ink: `oklch(0.22 0.02 40)` — warm near-black.
  - Muted ink: `oklch(0.48 0.018 50)`.
  - Hairline: `oklch(0.85 0.015 45)`.
  - Accent: `oklch(0.45 0.13 320)` — plum, dusty magenta that sits opposite clay without turning cold.
  - Accent ink: `oklch(0.98 0.01 320)`.
  - Status: positive `oklch(0.55 0.13 150)`, warning `oklch(0.60 0.12 85)`, negative `oklch(0.53 0.14 25)`.
  - Data colors: 4 colors, `l` 0.52–0.64, `c` 0.10–0.14, hues 35, 115, 195, 275 — never the accent hue 320.
- **Genre affinities:** `consumer-discovery` (lifestyle, habit-forming), `e-commerce` (warm lifestyle goods), `mobile-consumer-app` (daily-use consumer).
- **Bans:** no cool-gray canvas with warm clay ink; no gradient clay washes; no glowing sale badges; no confetti multi-accent surfaces; no cold-blue accent on warm clay; no accent on product imagery frames.
- **Theme axes:** `paperBand: sunbaked clay` · `displayStyle: soft humanist` · `accentHue: plum 320`.

## Theme Grammar

- **One identity per build:** a theme is a whole-page commitment. Mixing two themes' token sets reads as a redesign in progress; if the product needs two, split the surfaces deliberately and say why.
- **Accent stays scarce within the theme:** every theme budgets exactly one accent hue and its use (primary action, focus, links, selected state). A theme does not grant a second accent; a second accent is a ban violation.
- **Status stays separate:** positive/warning/negative hues are theme-independent, so the same status semantics hold in every theme and a non-color cue always accompanies them.
- **Adaptation is token-level, not structural:** a product may shift `h` inside its theme's family (warm to warm), but may not move a token from one role to another (accent to canvas) or re-chroma the canvas to a different band.
- **Contrast floor holds per theme:** ink on canvas ≥ 7:1, muted ink ≥ 4.5:1, accent ink on accent ≥ 4.5:1, before decoration. Dark themes verify the same floor on their own tokens.

## Provenance

### Observed

- The maintainer has applied each theme's register in shipped interfaces: warm paper editorial, graphite console, muted consumer earth tones, calm cyan workspaces, ivory commerce, near-black launch, arctic white enterprise, archival stone, deep navy immersive, and sunbaked clay lifestyle surfaces all recur across the author's own frontend work.
- The working example plates in `domains/frontend/examples/` exercise the accent-scarcity and temperature-discipline behaviors the themes formalize.
- The theme axes (`paperBand`, `displayStyle`, `accentHue`) match the identity fields the direction contract already requires, so a theme pick slots directly into the declared identity without a parallel vocabulary.
- The ten-theme set was curated for diversification: each of the four added themes (Arctic White, Stone Archive, Midnight Navy, Sunbaked Clay) introduces a distinct `paperBand` + `displayStyle` + `accentHue` triple not present in the original six, with genre affinities that balance coverage across the eight recipe ids and per-theme bans that forbid duplicative treatments observed in slop-prone builds.

### Inferred

- Expressing themes as complete OKLCH token sets rather than hex swatches follows from the identity-fingerprint requirement: two builds must produce distinct fingerprints without the corpus prescribing a fixed color identity.
- Deriving every theme from the palette-recipe formulas (canvas/surface/ink/muted/hairline/accent/status separation) keeps the theme layer consistent with the recipe layer: recipes propose relationships, themes fix one identity.
- The ban lists derive from the color-role contracts already enforced by the rule library plus the AI-tell codes (gradient abuse, glowing orb) the critic already detects.
- Diversification-aware theme selection follows from ADR 0007/0011: the direction step must be able to vary `paperBand`, `displayStyle`, and `accentHue` independently of the six-family rule selection, so the catalog deliberately spaces paper bands (arctic white vs. cool neutral vs. archival stone vs. sunbaked clay vs. near-black vs. deep navy) and accent hues (30, 45, 70, 85, 145, 190, 205, 275, 300, 320) to maximize cross-build fingerprint distance.

### Assumed

- The consuming skill can express tokens in OKLCH (Tailwind 3.4+/4 and modern CSS support it); themes degrade to `rgb()` conversion when the project cannot represent OKLCH, keeping the *roles* and *bans* intact even if the exact numbers shift.
- A theme's dark-mode adaptation is the inverse lightness of its own token set with chroma slightly lowered — every theme above states its paper band explicitly so the dark form stays in-family.

### Unknown

- Whether a theme graduates to a bundled design rule requires recurring, independently sourced evidence through the tiered promotion bar; this corpus only proposes identities, not rules.
- The catalog is not a closed contract: themes may be added or replaced as the maintainer's shipped work accumulates, and the identity-fingerprint mechanism — not this list — is what enforces diversification.

# Type Pairings

Parametric type-pairing knowledge for the frontend craft layer. Each pairing names a display voice, a body voice, and the roles each covers, plus the decisions that make the pair read as one system. A pairing is a starting point, not a rule: adapt it to the product evidence, then state the choice out loud in the direction.

## How To Use A Pairing

1. Pick one pairing whose display voice matches the product's register (engineering tool, editorial brand, consumer app, operational console).
2. Assign roles: display (headlines, numerals), body (paragraphs, lists), meta (labels, captions, timestamps), data (tables, code, figures).
3. Keep the pair unequal on purpose: one voice leads, the other supports. Two showy voices compete; two neutral voices disappear.
4. Record the pairing in `typographyRoles` on the direction so the verification machine can see the choice.

## Pairings

### 1. Geometric Grotesque Display + Humanist Sans Body

- **Display voice:** a geometric grotesque with closed apertures and even strokes — the "machine" register. Use for headlines, numbers, and the primary action label.
- **Body voice:** a humanist sans with open apertures and visible stroke contrast — readable at small sizes and in dense copy.
- **Roles:** display for headlines and figures; body for paragraphs; meta in the humanist voice with reduced weight and tracking widened instead of size shrinking.
- **Works best when:** the product is a tool, platform, or anything whose identity leans technical and precise.
- **Avoid:** using the geometric voice for long body text; it reads stiffer at paragraph length.

### 2. Editorial Serif Display + Neutral Sans Body

- **Display voice:** a high-contrast serif (or a cut with pronounced letterforms) for headlines and pull-quote moments.
- **Body voice:** a neutral sans that stays quiet under the serif headlines.
- **Roles:** serif only for display and evidence emphasis; sans for everything else including meta and data.
- **Works best when:** narrative, editorial, or long-form product evidence leads the page — report reading, story surfaces, premium brand pages.
- **Avoid:** italic serif headlines as decoration; italics should carry meaning (a sourced quote, a highlighted term), not style.

### 3. Mono Display + Sans Body

- **Display voice:** a monospace face at large sizes for the primary number, the code-like label, or the machine-readable identity.
- **Body voice:** a plain sans; mono takes over data, labels, and any literal values.
- **Roles:** mono for data, identifiers, timestamps, and the signature number; sans for prose.
- **Works best when:** the product is defined by data or infrastructure — dashboards, dev tools, accounting, observability.
- **Avoid:** mono for long paragraphs; reserve it for the "readable by machine, shown to humans" register.

### 4. Condensed Display + Humanist Body

- **Display voice:** a condensed sans or narrow-cut display for dense, high-energy headlines (posters, commerce, event surfaces).
- **Body voice:** a humanist sans with room to breathe under the condensed headlines.
- **Roles:** display for hero headlines and section titles; body for everything that must stay calm and legible.
- **Works best when:** the page must say a lot in little horizontal space or carry an energetic commercial register.
- **Avoid:** condensing the body voice; condensation at body sizes hurts legibility.

### 5. Slab/Technical Display + Geometric Body

- **Display voice:** a slab or technical cut (square-ish terminals, sturdy weight) for a grounded, industrial register.
- **Body voice:** a geometric sans with even spacing that mirrors the slab's structure without shouting.
- **Roles:** display for headlines and section markers; body for instructions and descriptions; data in the geometric voice with tabular numerals.
- **Works best when:** physical, operational, or industrial products — field work, logistics, hardware software.
- **Avoid:** pairing slab display with a second slab; one slab family per page.

## Pairing Grammar

- **Scale:** keep at least a 1.25 ratio between adjacent display steps; the body step sets the baseline rhythm everything else derives from.
- **Measure:** 45–75 characters per line for paragraphs; widen tracking on meta labels rather than shrinking size below ~12px.
- **Numerals:** use tabular figures wherever numbers are compared in columns; proportional figures for standalone prices and counts.
- **Weight budget:** one display weight per page (regular or bold, not both at headline size), plus a body regular/medium pair and a meta medium.
- **Semantics:** heading structure must follow the document outline, not the visual weight of the display voice.

## Provenance

### Observed

- The maintainer has shipped interfaces using each of the five pairings and has seen the pairing grammar (scale ratio, measure, numerals, weight budget) hold up across product types in the author's own frontend practice.
- The example plates in `domains/frontend/examples/` render the display/body/meta role distinction that these pairings formalize.

### Inferred

- The "one leading voice, one supporting voice" rule is derived from the role-contrast direction contract: semantic roles are created by distinct voices, not by size alone.
- The register mapping (tool → grotesque, narrative → serif, data → mono) is derived from the product recipe domain signals, not from any external style guide.

### Assumed

- The consuming skill will pick a pairing before implementation and record it in the direction, so repetition across builds stays detectable.

### Unknown

- Whether a pairing deserves promotion to a bundled design rule is a tiered-promotion decision requiring recurring evidence across independent sources; this corpus does not decide it.

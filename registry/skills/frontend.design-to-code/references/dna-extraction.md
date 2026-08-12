# DNA-Extraction Mode

Use this reference when a studied reference should inform a build *as attributes*, not as
a blueprint: name the reference design's **macrostructure**, **type pairing**, and
**colour anchor** into a provenance-labelled artifact at `.design/reference-dna.json`, then
let the named attributes inform the direction without copying pixels or trade dress.

DNA extraction is a structured mode of reference handling, not a replacement for the
`reference-to-design-md.md` brief extraction. The brief records the full translation
(theme, token roles, components, layout, responsive behavior); DNA extraction records the
identity fingerprint only — the three named attributes that the direction contract's
identity fields (`macrostructure`, `themeAxes`) can reuse directly.

## When To Use

- The reference's identity should shape the direction's declared `macrostructure` and
  `themeAxes` (`paperBand`, `displayStyle`, `accentHue`).
- The reference is a brand, competitor, or public source where trade-dress risk is real.
- A later build step will compare the extracted identity against the craft macrostructures
  and themes instead of re-reading the reference.
- The user explicitly asks to study a reference design (a screenshot, mock, Figma-style
  brief, or design spec) before building.

## What The Artifact Records

The artifact carries exactly three attribute groups plus provenance and boundary records:

1. **Macrostructure** — the named page-level composition shape (hero placement, body,
   divider, button voice, image treatment), e.g. `Evidence-First List`. Name it from the
   craft macrostructure vocabulary when it matches; otherwise describe the shape in named
   terms. Record the observable evidence for the name.
2. **Type pairing** — the display voice and body voice roles, e.g. `geometric grotesque
   display + humanist sans body`. Record the role evidence (which voice leads, which
   supports) without naming exact typefaces as production requirements.
3. **Colour anchor** — the paper band, display style, and accent hue as *attributes*, e.g.
   `warm sand`, `clean grotesque`, `terracotta`. Record hue families and temperature, never
   exact reference tokens.

Every claim in the artifact goes through the observed/inferred/assumed/unknown evidence
ladder, exactly like the craft corpus: nothing is recorded without a category.

## Boundary

- **Attributes are extractable:** composition shape, voice roles, hue family, paper
  temperature, spacing rhythm, density model, materiality, interaction pattern.
- **Protected expression is refused:** logo, brand marks, mascot, exact palette-plus-layout
  combination, exact typefaces as production requirements, hero composition, and any
  trade-dress impression. Record what you refused in `boundary.protectedExpressionRefused`.
- **Pixel clones are refused outright:** exact color literals (`#hex`, `oklch()`, `rgb()`,
  `hsl()`, `hwb()`) and embedded base64 image data are hard-gate violations. Name the
  color by attribute ("signal teal"), not by token.
- **High-risk sources must name their refusal:** a competitor-inspiration or unknown-source
  artifact must list at least one protected expression it intentionally did not extract.

## Artifact Shape

```json
{
  "schemaVersion": "1.0",
  "reference": {
    "source": "path-or-url-of-the-studied-reference",
    "kind": "screenshot | mock | figma-brief | design-spec",
    "ownership": "user-owned | product-local | competitor-inspiration | unknown"
  },
  "macrostructure": { "name": "...", "evidence": "..." },
  "typePairing": { "displayVoice": "...", "bodyVoice": "...", "evidence": "..." },
  "colourAnchor": {
    "paperBand": "...",
    "displayStyle": "...",
    "accentHue": "...",
    "evidence": "..."
  },
  "evidence": {
    "observed": [{ "statement": "...", "source": "..." }],
    "inferred": [{ "statement": "..." }],
    "assumed": [{ "statement": "..." }],
    "unknown": [{ "statement": "..." }]
  },
  "boundary": {
    "attributesExtracted": ["composition shape", "voice roles", "hue family"],
    "protectedExpressionRefused": ["logo", "exact palette-plus-layout"]
  }
}
```

## Workflow

1. Classify the reference (ownership and kind) before extraction.
2. Read the reference and name the three attribute groups, using the craft macrostructures,
   type pairings, and theme axes vocabulary where the reference matches it.
3. Write `.design/reference-dna.json` in the shape above, with every claim categorized in
   the evidence ladder.
4. Record the boundary: what you extracted as attributes and what protected expression you
   refused.
5. Validate the artifact (schemaVersion 1.0, non-empty attributes, evidence ladder, no
   pixel clones, refusal named for high-risk sources) before using it in a direction.
6. When declaring the direction, reuse the named macrostructure and theme axes from the
   artifact so the identity fingerprint reflects the studied reference — without the
   reference itself being copied.

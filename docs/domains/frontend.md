# Frontend Domain

Frontend v1 supplies:

- ownership rules for design, implementation, UX, interaction, motion, and release review;
- structured design brief and direction contracts;
- eight product-evidence recipes: operational command center, consumer discovery, developer tool, editorial content, marketing landing, SaaS workspace, e-commerce, and mobile consumer app;
- 18 versioned rules across typography, layout, responsive, color, state, and signature-move families;
- eight worked example packs with 80 deterministic good/bad SVG evidence plates;
- deterministic brief, axis, responsive, state, runtime, accessibility, focus, and reduced-motion gates;
- a reference DNA artifact contract (`schemas/reference-dna.schema.json`) for the design-to-code DNA-extraction mode, validating the macrostructure, type pairing, and colour anchor attribute record plus its trade-dress boundary;
- verification outcomes separated from host capability readiness;
- bounded repair requests that never edit a project silently;
- structured execution packages for `frontend.visual-design-polish`, `frontend.tailwind-ui-polish`, and `frontend.design-to-code`;
- skill-specific A/B/C eval slices and repeated-run variance reporting.

Browser observations are supplied by the host as structured evidence. `verified` requires browser and screenshot capabilities, every required viewport and state, no hard finding, and no false completion claim.

For material design work, load `domains/frontend/rules/index.json`, select one compatible rule from every family, and record the six selected rule ids before implementation. New directions use schemaVersion `1.1` and additionally record the identity fields: a named `macrostructure` and the three `themeAxes` (`paperBand`, `displayStyle`, `accentHue`); the validator accepts both `1.0` and `1.1`, so legacy `1.0` directions remain loadable in persisted strict runs. Compare the direction with `domains/frontend/examples/<recipe-id>/example.json`. The generated SVG assets explain decisions and violations; they are not JSX/CSS or production UI templates.

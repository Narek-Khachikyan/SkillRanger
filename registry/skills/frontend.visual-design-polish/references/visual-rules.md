# Visual Rules Reference

Read this only for material visual direction, an unfamiliar domain, or when the core workflow needs concrete craft guidance.

## Canonical Rule Library

Load `domains/frontend/rules/index.json` before material implementation. Select exactly one compatible rule from each family—typography, layout, responsive, color, state, and signature move—and record the six selected rule ids in structured direction metadata. Treat each rule's preconditions, constraints, accessibility notes, anti-patterns, and verification criteria as one decision contract.

- Constrained: use the first policy-compatible six-rule set without adding primitives.
- Standard: compare recipe-compatible alternatives by rule id before selecting six.
- Advanced: a deviation requires destructive critique naming the affected rule id, product benefit, accessibility effect, and replacement verification.

Do not mix constraints from several same-family rules while claiming one selection.

## Domain And Direction

Anchor a visual thesis in observed domain nouns, verbs, artifacts, data shapes, user
stakes, and brand voice. If those are unknown, use neutral product-native structure and
record the assumption; do not manufacture a world from plausible-sounding details.

### Operational Positive Direction Method

Replace anti-pattern prohibitions with grounded positive guidance from product evidence:

1. **Collect product evidence:** domain objects, user verbs, data shapes, artifact types,
   trust signals, frequency metrics, stakes (financial, safety, compliance, identity).
2. **Identify the visual job:** scan, compare, decide, create, monitor, purchase, learn,
   or navigate. Each job implies a different layout model, density target, and hierarchy
   logic.
3. **Choose a treatment from observed patterns** and adapt it with the product's
   specific constraints:
   - Dense operations: compact tables, exception queues, timestamps, split panes,
     signal colors, audit trails.
   - Editorial product story: typographic contrast, asymmetric grid, proof near claims,
     art-directed imagery, varied rhythm.
   - Tactile commerce: close product crops, honest specs, variant clarity, trust near
     purchase decisions.
   - Clinical or regulated: quiet high-contrast surfaces, stable forms, recovery copy,
     evidence trails, restrained motion.
   - Technical control room: mono metadata, status rails, diagrams, calibrated
     live-state accents, high-density scanning.
4. **Derive constraints from observation:** If the product has 50+ items per screen,
   choose compact density; if the product needs trust signals at decision points, place
   proof adjacent to the CTA; if the audience scans for exceptions, use signal color as
   a left-border rail not background decoration.
5. **Verify against product evidence:** Does the treatment serve the observed user
   workflow? Does it communicate the real data shapes? Does it encode domain meaning
   rather than abstract decoration?

### Direction Integrity

Choose a direction because it aids the product task, not because it is fashionable.
A single justified aesthetic risk is enough: stronger type, a data-specific treatment,
domain material, composition, or feedback. State why restraint is better if no risk is
warranted.

## Composition And Type

- Encode sequence, ownership, priority, status, or grouping with structure; avoid decorative rails, badges, cards, and dividers.
- Use a real grid, rhythm, gutters, alignment, and scroll ownership. Break symmetry only with shared edges or baselines.
- Use tables/lists for comparison, split panes for triage, editorial grids for reading, dashboards for monitoring, and bento only for genuinely different jobs.
- Define roles for display, heading, body, label, caption, CTA, and data/mono. Use tabular figures for metrics, timers, tables, and money.
- Avoid one generic treatment: giant centered hero, rounded-card grid, ultra-light body text, tiny low-contrast captions, all-caps long labels, or centred paragraphs.

## Color, Surfaces, Images, And Data

- Define semantic roles for canvas, surface, raised surface, text, muted text, border, action, focus, selected, status, disabled, and data.
- Let neutrals carry most product UI; reserve saturation for action, state, focus, data, and signature moments. Dark mode needs separate surface and text roles, not inversion.
- Glass, blur, glow, gradients, 3D, nostalgia, maximalism, and motion require a thesis-specific reason plus readability and performance checks.
- Prefer real product surfaces, diagrams, data patterns, domain artifacts, and art-directed crops over stock 3D people, abstract AI waves, fake dashboards, and ornamental chart wallpaper.
- Charts answer a named question with labels, units, timeframe, freshness, thresholds, uncertainty, and accessible color.

## States And Motion

- Empty states explain what belongs there, why it is empty, and the best next action. Errors identify the object, problem, known cause, and recovery.
- AI output needs provenance, uncertainty when useful, and controls to edit, accept, reject, retry, stop, or inspect sources.
- Motion communicates feedback, causality, continuity, progress, or a rare brand moment. Prefer opacity and transform; respect reduced motion; do not default to scroll-jacking, cursor followers, animated counters, or blanket reveals.

## Severity

- S4: blocks a core task, serious accessibility exclusion, data loss, legal/payment/security risk, or unreleasable responsive breakage.
- S3: harms comprehension, trust, accessibility, first-run success, conversion, or mobile usability.
- S2: recoverable friction, inconsistency, weak craft, or missed specificity.
- S1: cosmetic improvement with limited task impact.

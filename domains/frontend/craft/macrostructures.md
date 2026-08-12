# Macrostructures

Named page-level composition shapes. A macrostructure fixes the page's top-level anatomy — hero placement, body organization, divider treatment, button voice, image treatment — so the direction step can pick one by name and state it out loud instead of drifting into the default attractor. The named shape is also what the verification machine records, so repetition across builds becomes detectable.

## How To Use A Macrostructure

1. Choose the macrostructure that matches the primary task and the recipe's layout model.
2. State its name in the direction out loud, alongside the theme axes and the treatment axes.
3. Apply its anatomy to the first viewport first; every other surface inherits the same anatomy.
4. A macrostructure is a composition shape, not a rule: the six-family rule selection is independent of it.

## Macrostructures

### 1. Hero-Forward

- **Hero placement:** full-width lead block — one headline, one supporting line, one primary action; nothing competes above the fold.
- **Body:** value sections that each answer one objection, in decreasing importance.
- **Divider:** generous whitespace; hairlines only inside dense regions.
- **Button voice:** one loud primary CTA, repeated verbatim where the flow demands the action.
- **Image treatment:** one product-real screenshot or data viz per claim, never stock decoration.
- **Suits:** marketing landing, launch surfaces, new-user stories.
- **Interacts with:** composition `editorial-grid`/`grid`, hierarchy `action-first`, material `layered`/`flat`.

### 2. Evidence-First List

- **Hero placement:** no hero — a compact title row, then the evidence.
- **Body:** the primary content is a scannable list, table, or feed whose rows carry the facts; every row earns its height.
- **Divider:** hairlines between rows; the first row visually anchors the list.
- **Button voice:** actions live on rows and in the list header; the primary action is a header-level control, not a hero button.
- **Image treatment:** inline data or object visuals inside rows; no decorative imagery between rows.
- **Suits:** operational consoles, developer tools, inboxes, admin surfaces.
- **Interacts with:** composition `structured-list`/`table`, hierarchy `data-first`, density `compact`/`balanced`.

### 3. Split Triage

- **Hero placement:** none; the page opens split.
- **Body:** two panes — a left selector/origin and a right detail/work surface — with the relationship between the panes visible (selection highlights both sides).
- **Divider:** one structural divider between panes; internal hairlines for density.
- **Button voice:** the detail pane carries the primary action; the selector pane carries row-level secondary actions.
- **Image treatment:** detail-oriented imagery (previews, renders) in the right pane only.
- **Suits:** triage flows, mail clients, settings, compare views.
- **Interacts with:** composition `split-pane`, hierarchy `action-first`/`data-first`, material `bordered`/`layered`.

### 4. Editorial Narrative

- **Hero placement:** a large, typographic opening (a statement headline, not a stock photo band).
- **Body:** long-form sections with a reading measure; pull-quotes and evidence blocks interrupt the flow only when they carry sourced content.
- **Divider:** whitespace and pull elements; hairlines are rare.
- **Button voice:** the primary action is a link-styled or quiet button; loud CTAs would break the reading register.
- **Image treatment:** editorial photography or large data figures, captioned, never decorative screenshots.
- **Suits:** report pages, case studies, editorial content, premium brand pages.
- **Interacts with:** composition `editorial-grid`, hierarchy `narrative-first`, density `editorial`/`spacious`.

### 5. Commerce Grid

- **Hero placement:** a compact banner strip (offer or category), not a full-viewport hero.
- **Body:** a product grid with consistent item cards; comparison-critical facts (price, stock, rating) are stable across cards.
- **Divider:** hairlines inside cards; grid gaps carry the rhythm.
- **Button voice:** the primary action is per-item (add to cart); one global cart CTA stays persistent.
- **Image treatment:** uniform product shots with one background treatment across the grid.
- **Suits:** catalog, storefront, marketplace, gallery.
- **Interacts with:** composition `grid`, hierarchy `action-first`, material `flat`/`bordered`.

### 6. Mobile-First Feed

- **Hero placement:** none or a slim summary strip.
- **Body:** a single-column feed of content blocks; each block is one decision unit with its own action.
- **Divider:** cards or hairline-separated blocks; thumb-zone placement of primary actions (bottom of the block, reachable by the thumb).
- **Button voice:** one primary action per block; the global primary action is a fixed bottom action on the primary flow.
- **Image treatment:** content-led imagery (user content, product shots); no full-screen decorative bands.
- **Suits:** mobile consumer apps, social surfaces, daily-use flows.
- **Interacts with:** composition `structured-list`, hierarchy `action-first`, material `flat`/`tactile`.

## Macrostructure Grammar

- **One anatomy per page:** choose one macrostructure; nested secondary surfaces inherit it. Two macrostructures on one page reads as indecision.
- **Name it out loud:** the direction must record the macrostructure name and the paper band, display style, and accent hue so the identity fingerprint can measure cross-build difference.
- **Recomposition, not restack:** the mobile layout recomposes the anatomy (list-detail drill-in, bottom action) rather than stacking desktop cards.
- **The hero is optional:** a page without a hero is a legitimate choice; defaulting to a hero when the content is a list is the slop tell.
- **Interaction with axes:** macrostructure fixes the top-level shape; the treatment axes (density, hierarchy, composition, material, motion, expression) tune it. Both are recorded; neither replaces the other.

## Provenance

### Observed

- The maintainer has applied each macrostructure in shipped interfaces: hero-forward landing builds, evidence-first consoles, split triage tools, editorial report pages, commerce grids, and mobile feeds in the author's own practice.
- The recipe example plates in `domains/frontend/examples/` render anatomies matching these shapes (for example the operational-console plates show evidence-first list anatomy).

### Inferred

- Recording a named macrostructure alongside the treatment axes follows from the identity-fingerprint design: a deterministic gate needs a named, comparable field to detect repetition across verified runs.
- The "one anatomy per page" grammar derives from the composition material of the direction contract, which admits exactly one composition per direction.

### Assumed

- A direction naming a macrostructure will be checked against the rendered evidence by the critic, so a declared anatomy that the screenshots contradict cannot certify.

### Unknown

- Whether a macrostructure should graduate into a bundled design rule requires recurrence across independent sources plus the tiered promotion bar; the craft corpus itself never promotes anything.

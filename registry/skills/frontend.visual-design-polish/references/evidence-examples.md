# Evidence-Grounded Design Examples

Use this reference when the product context matches one of these patterns. Each example
shows product truth -> design tension -> competing directions -> thesis -> signature ->
application -> destructive critique. Adapt the structure, not the details.

## 1. Operations SaaS: Fleet Maintenance Dashboard

**Product truth:** Dispatchers scan 50+ work orders/hour. Each order has priority,
vehicle class, fault code, service interval, location, status, ETA, and exception flag. Errors cascade to late
deliveries and crew overtime.

**Design tension:** Generic card layout hides priority and exception urgency behind equal
visual weight. Dispatchers must open each card to triage.

**Direction A — Compact dense table:** Single-row work orders with status rail, inline
priority badge, exception signal, scroll-linked sticky header. Rejects oversized cards
and whitespace-for-whitespace-sake.

**Direction B — Kanban queue:** Three columns (queued / in-progress / exception).
Rejects forcing a table when the physical workflow is a handoff.

**Direction C — Map-first with overlay list.** Rejected: geo-data is thin here — most
work is triage, not routing.

**Chosen thesis (A):** Compact table with exception rail, monospace timing, status-dot
priority. Density: 48px rows. Typography: heading=Inter SemiBold 14px, body=Inter
Regular 13px, data=JetBrains Mono 12px tabular, labels=Inter Medium 11px uppercase.
Color: canvas surface for table, amber/red left-border rail for exceptions, green for
on-time, gray for scheduled. Signature: left-border exception rail and tabular ETA
alignment let dispatchers scan without opening.

**Application:** Primary viewport fits 25 orders at once. Common surfaces: toast for new
exception (red rail, no modal), detail slide-over with same type/color grammar, empty
state = no-exception banner, mobile = horizontal scroll with frozen first column.

**Destructive critique:** Loses detail preview — must open row for context. Acceptable
(dispatchers know their fleet; detail is for action not browsing). Genericity check:
swap "order/dispatch/vehicle" — does the table still work for any admin? Yes, it is a
generic data table. Fix: make fault code, service interval, and vehicle class part of the
scan grammar, with the exception rail connecting the affected field to the maintenance
action. Re-test: logo-swap to a CRM — the fault/service grammar no longer transfers.

## 2. Editorial: Scientific Journal Article Page

**Product truth:** Researchers scan for findings, methodology, data availability, and
citations. Reading time averages 4 min first visit. PDF is still the primary format for
deep reading.

**Design tension:** Wide content column with full-justified serif text mimics print but
wastes horizontal space on widescreens and buries data figures in linear scroll.

**Direction A — Asymmetric editorial grid:** Narrow text column (~66ch), wide margin for
figures/citations/data tables, sticky author sidebar. Rejects full-width text columns.

**Direction B — Linear reader with floating panels:** Central scroll, floating figure
viewer, sticky citation drawer. Rejects fixed sidebar competing with reading focus.

**Direction C — PDF-first with enhanced HTML supplement.** Rejected: replicates existing
PDF experience.

**Chosen thesis (A):** Asymmetric editorial grid with margin figures. Hierarchy: title,
abstract in distinct surface, body at 1.5 line-height, marginalia for figures.
Typography: display=IBM Plex Serif 38px bold, body=20px/30px, captions=13px,
data=IBM Plex Mono 14px. Color: warm off-white canvas, dark charcoal text, blue-600 for
links/citations, amber for open-access badges. Signature: figures floated into the right
margin at the point of reference — not collected in a media block.

**Application:** Article page fits abstract + first figure above fold. Common surfaces:
citation drawer uses same type scale; search results use compact two-line result
(title+author+year); empty state = no-results with domain-specific suggestions; mobile
collapses margin figures inline.

**Destructive critique:** Marginal figures overlap at narrow viewports without a
deliberate collapse rule. Acceptable with a <1024px breakpoint that moves figures inline
and widens text column. Genericity check: swap logo to a fashion magazine — citation
grammar and data typography are domain-specific, protecting identity.

## 3. Commerce: Artisanal Food Marketplace

**Product truth:** Customers choose based on origin, producer story, ingredients, and
photography. Trust signals (certifications, reviews, producer ratings) justify premium
pricing. Basket is typically 3-7 items.

**Design tension:** Default e-commerce cards with uniform thumbnail, title, price, and
rating bury the producer narrative and ingredient transparency that justify the premium.

**Direction A — Narrative product card:** Hero crop with producer name overlay,
ingredients as visual badge row, origin map dot, price as secondary. Rejects price-first
card hierarchy.

**Direction B — Editorial product detail with gallery:** Single product page as story
with full-bleed hero, producer inset, ingredient infographic. Rejects tabs-and-accordion
PDP.

**Direction C — Grid of small tiles with modal detail.** Rejected: modal disrupts
browsing for narrative discovery.

**Chosen thesis (A):** Narrative product card on browse grid. Hierarchy: existing
product photography, producer and origin as the primary caption, verified certification
and ingredient facts, price in callout weight, rating as secondary. Typography:
display=sturdy project grotesk 22px, body=project sans 15px, origin/lot metadata=condensed
sans 12px, price=project sans 16px semibold tabular. Color: neutral label-paper canvas,
ink text, certification green, and one batch-marker accent sampled from approved product
packaging. Signature: a lot-label band ties producer, origin, batch, and certification
into one evidence-bearing strip instead of decorative ingredient tags.

**Application:** Browse grid 3 columns, each card = hero (3:2) + producer + badges +
price. Common surfaces: PDP uses same visual grammar (hero full-bleed, ingredient
section as visual grid, producer sidebar). Cart = compact row with thumbnail + producer
+ qty + price. Empty cart: "Your basket is empty — explore [region] [category]" with
live producer samples. Mobile: 2 columns, hero crops tighter.

**Destructive critique:** Ingredient badges add visual noise at small card sizes.
Acceptable — at <640px, badges collapse to count-dot with tooltip. Genericity check:
swap to electronics marketplace — "ingredient badges" become meaningless; the edible
color cue system is product-specific.

## 4. Regulated: Clinical Trial Results Portal

**Product truth:** Physicians and regulators need fast scanning of endpoints, safety
data, and statistical methods. Every figure and statistic has regulatory significance.
Users print or PDF-export for records.

**Design tension:** Marketing-grade visual design or complex data dashboards create trust
issues. Too much decoration undermines credibility.

**Direction A — Quiet high-information document layout:** Single-column structured
document with anchored TOC, results in table form, statistical detail in expandable
sections. Rejects dashboard or card-based navigation.

**Direction B — Structured data portal with filter-driven results matrix.** Rejects
narrative in favor of direct cross-trial comparison.

**Direction C — PDF replica in HTML.** Rejected: replicates print limitations; loses
linking and search.

**Chosen thesis (A):** Quiet document layout with anchored navigation. Hierarchy: sticky
TOC sidebar, results tables with row striping and fixed headers, expandable appendices.
Typography: body=system font 16px/24px (proven readability), tables=tabular 14px,
headings=semibold at stepped scale. Color: white canvas, high-contrast charcoal text,
blue-600 for endpoints and links, amber for safety signals — no decoration. Signature:
every figure and table is preceded by its regulatory identifier (NCT + endpoint ID) in a
fixed-format metadata line.

**Application:** Trial landing = metadata header + TOC + results summary. Common
surfaces: search = trial cards (NCT, condition, phase, status badge, enrollment). Data
table = fixed-header sortable with row hover and highlight-on-scroll-to-anchor. Print =
hidden navigation, expanded all sections. Empty = "No results matching criteria; try
broadening [filters]."

**Destructive critique:** Document layout reads as an unstyled legal filing. Acceptable
for this audience — regulatory readers trust document structure; the metadata identifier
provides the signature without ornament. Genericity check: swap to a marketing landing
page — regulatory identifiers and table-heavy structure are unmistakably domain-specific.

## 5. Niche Consumer: Vinyl Record Marketplace

**Product truth:** Collectors care about pressing year, label, country, condition grade,
matrix/runout, and rarity. Grading (Mint/NM/VG+/VG/G) is the most important data.
Cover art is secondary to pressing details for experienced buyers.

**Design tension:** Generic e-commerce cards with large cover art and price bury the
pressing details and grading that determine purchase decisions.

**Direction A — Data-forward list with grading visual system:** Compact list rows with
small thumbnail, pressing details as structured data, grading as color-coded badge,
price aligned right. Rejects large-card-with-add-to-cart as primary interaction.

**Direction B — Discogs-style table with matrix detail panel.** Familiar to the audience
but visually outdated. Rejects reinventing a layout collectors already understand.

**Direction C — Visual grid with pressing metadata overlay.** Rejected: buries critical
grading data behind hover.

**Chosen thesis (A):** Hybrid of list density and data precision. Hierarchy: small
thumbnail (40x40), pressing year+label+country as primary line, grade as colored badge,
matrix/runout as mono secondary, price+seller rating right-aligned. Typography: body=Inter
14px, data=Mono 12px, grade badge=Inter 11px bold tracking-wide. Color: slate bg, warm
paper surface. Grade colors — Mint=teal, NM=blue, VG+=green, VG=amber, G/g+=gray. No
cover-art blowups as hero — pressing data is the hero. Signature: grade badges use
vinyl-era typography (tracking-wide, uppercase, fixed-width) with a subtle groove-line
icon prefix.

**Application:** Browse = sortable list (year, label, grade, price). Common surfaces:
detail page = large cover art (now earned) + pressing details table + seller info.
Cart = compact row. Empty = "No pressings match your search — try [label] [year]
[country]." Mobile = same list, grade badges stay readable.

**Destructive critique:** List density overwhelms casual collectors who browse by cover
art. Acceptable — add a grid-view toggle for casual browsing. Genericity check: swap to
book marketplace — "pressing year/matrix/runout" become meaningless; vinyl-era grade
badges with groove-line icon are unmistakably domain-specific.

---
name: visual-design-polish
description: Improve frontend visual design with subject-specific direction, hierarchy, typography, spacing, palette, density, responsive screenshot QA, and anti-generic UI critique.
---

# Visual Design Polish

Use this skill when a frontend screen works but feels generic, visually weak, poorly prioritized, too crowded, too empty, or mismatched to the product's subject and audience. Do not use it for pure Tailwind class cleanup, backend work, accessibility-only audits, or design-system extraction unless the main request is visual direction and polish.

## Core Directive

Do not produce generic "clean modern SaaS" UI by default. Beautiful frontend design starts with a product-specific visual thesis, then carries that thesis through layout, typography, color, surfaces, imagery, content, states, and motion. Trendy is acceptable only when it improves comprehension, memorability, trust, or task completion.

Use the TASTE framework for substantial visual work:

- Thesis: one sentence describing the visual world, audience, and product promise.
- Art direction: constrained rules for type, color, spacing, surfaces, iconography, imagery, and motion.
- Specificity: domain nouns, artifacts, workflows, data shapes, copy, states, and visuals that could not belong to a random app.
- Task clarity: hierarchy, CTA clarity, accessibility, responsive behavior, and fast comprehension survive the styling.
- Evaluation: screenshot QA, template-smell critique, and hard gates before completion.

## Decision Rules

- Use `DESIGN.md` as the first-class visual source when present. Before material visual work, look for a project `DESIGN.md` or equivalent design brief; follow it unless the user explicitly asks to replace the direction.
- If no `DESIGN.md` exists and the task is subjective or open-ended, create a compact mini-DESIGN spec before implementing: theme, color roles, typography roles, component rules, layout, depth, do/don't guardrails, and responsive behavior.
- Do not treat anti-generic warnings as a design direction. A good result needs positive visual grammar: token roles, component-state rules, surface/depth policy, and a signature proof medium such as product screenshots, domain imagery, editorial type, operational tables, or data artifacts.
- Start from the product, audience, and screen job. A design direction must be specific enough that it would not fit a random SaaS page.
- Make one memorable visual move and keep the rest disciplined.
- Prefer hierarchy, readability, density, and subject fit over decoration.
- Treat browser-rendered screenshots as required evidence for material visual changes. Do not call visual work complete without mobile and desktop evidence unless blocked.
- Avoid generic AI-layout defaults: purple-blue gradients, floating blobs, nested cards, random icon grids, vague SaaS copy, one-note palettes, and ornamental shadows.
- Treat current model house styles as calibration data, not inspiration. Warm cream backgrounds with serif display type and terracotta accents can be appropriate for editorial or hospitality work, but they are a default failure for dashboards, developer tools, finance, healthcare, and dense operational UIs unless the brief justifies them.
- If the brief is open-ended and the user needs taste direction, sketch 3 distinct directions before building. If the user asked for direct implementation, choose the strongest direction, state the visual thesis, and proceed.
- Preserve existing product conventions unless the task explicitly asks for a new direction.
- Copy, data density, and imagery are design materials. Generic placeholder SaaS copy can make a good layout feel AI-generated.
- Choose exactly one primary aesthetic direction and at most one secondary accent. Do not mix brutalism, glass, glow, 3D, nostalgia, bento, parallax, and maximalism into trend soup.
- Use trends as ingredients, not as defaults. Gradients, glass, bento, brutalism, AI glow, scroll effects, 3D, nostalgia, and maximalism must have a product reason.
- Make mobile an art-direction surface, not a collapsed desktop layout. Preserve focal hierarchy, brand character, and action reachability on narrow viewports.
- Treat accessibility and performance as part of taste. Low contrast, invisible focus, tiny targets, heavy motion, and slow media are not polish.

## Pre-Generation Gate

Before generating, redesigning, or materially changing a UI, identify the product frame first:

- User and context: who uses this screen, under what stakes, and at what expertise level.
- Primary task: the one job the screen must help complete.
- Flow: entry point, main action, feedback, success state, and error or recovery path.
- Platform and viewports: desktop, tablet, mobile, touch, keyboard, and any embedded surface constraints.
- Data model: available, missing, long, stale, partial, permission-limited, localized, or time-sensitive data.
- Design-system binding: existing components, tokens, type scale, spacing, color roles, motion, density, and state conventions.
- Required states: default, hover, focus-visible, active, disabled, loading, empty, error, success, partial, stale, offline, and no-permission where relevant.

If any frame is missing, state the assumption briefly and choose the safest product-native default. Do not invent an unrelated SaaS template to fill missing context.

## Required Visual Thesis

For open-ended or subjective visual work, define this before implementation:

- Design source: existing `DESIGN.md`, supplied reference, inferred mini-DESIGN spec, or local UI conventions.
- Product and audience: who uses this and under what stakes.
- Primary workflow: reading, comparing, monitoring, buying, editing, configuring, deciding, or creating.
- Visual thesis: `This should feel like [specific world/reference] for [specific audience] because [product promise].`
- Primary aesthetic: one direction such as `dense operations cockpit`, `editorial museum archive`, `field notebook`, `technical control room`, `creator zine`, `clinical calm`, or `tactile commerce`.
- Secondary accent: one supporting device such as mono metadata, paper grain, signal-color alerts, cropped product imagery, subtle glow, redline annotations, or kinetic state feedback.
- Signature detail: one memorable product-specific detail such as a branded empty state, domain-shaped divider, data-specific visualization, custom badge language, or meaningful microinteraction.
- Forbidden cliches: name the defaults you are rejecting: gradient blobs, floating dashboard mockups, fake KPI cards, stock people illustrations, purple-blue glass, vague AI sparkles, identical rounded cards, or beige fake-premium whitespace.

## DESIGN.md Method

Use `references/design-md-method.md` for substantial visual direction. The compact required shape is:

- Visual Theme & Atmosphere: product world, mood, density, audience, proof medium.
- Color Palette & Roles: canvas, surface, text, muted, hairline, action, focus, status, data.
- Typography Rules: display, heading, body, label, caption, button, data/mono roles.
- Component Stylings: buttons, cards, inputs, nav, tables, badges, empty/loading/error, modals, toasts.
- Layout Principles: grid, spacing, section rhythm, density, alignment, scroll ownership.
- Depth & Elevation: surface ladder, hairlines, shadow policy, imagery, screenshots, or no-depth rule.
- Do's and Don'ts: specific positive constraints and named forbidden defaults.
- Responsive Behavior: breakpoints, collapse order, touch targets, table/image strategy, mobile action placement.
- Agent Prompt Guide: exact tokens and rules future agents should reuse.

When using a public brand or website as a reference, extract reusable attributes only. Do not copy logos, names, proprietary marks, exact palette-plus-layout combinations, mascots, hero compositions, or a trade-dress impression that implies affiliation.

## Domain Aesthetic Extraction

Before inventing style, extract a domain model:

- Domain nouns: objects users recognize, such as claims, manifests, clauses, incidents, invoices, routes, specimens, shipments, lessons, or tracks.
- Domain verbs: actions users take, such as reconcile, triage, annotate, approve, compare, forecast, dispatch, review, submit, cite, or recover.
- Physical artifacts: ledgers, maps, clips, dashboards, labels, folders, field notes, scoreboards, control panels, receipts, product materials, or studio timelines.
- Digital artifacts: tables, traces, timelines, logs, diagrams, documents, queues, canvases, galleries, scripts, prompts, or evidence packets.
- Data shapes: timeline, matrix, hierarchy, map, stream, graph, cohort, distribution, comparison, or stack.
- User emotional state: rushed, skeptical, creative, anxious, exploratory, expert, novice, interrupted, high-risk, or playful.
- Brand voice: precise, warm, clinical, premium, playful, institutional, tactical, creator-led, or rebellious.

Translate the extraction into visual rules. A port tool can use berth maps, container-stack geometry, maritime signal colors, and operational tables. A legal tool can use evidence-room structure, citation drawers, redaction overlays, and audit-ready typography. A music tool can use waveform annotations, track timelines, VU accents, and studio-dark surfaces.

## Workflow

1. Capture the design brief: screen, audience, primary job, current complaint, implementation surface, and available screenshots.
2. Inspect local visual language: adjacent pages, tokens, type scale, spacing, buttons, cards, forms, empty states, and brand cues.
3. Write a compact visual thesis:
   - subject and audience;
   - hierarchy target;
   - palette role;
   - typography role;
   - density target;
   - one signature move;
   - one default aesthetic you are explicitly rejecting.
4. If direction is open-ended, sketch 3 materially different directions before choosing. Directions must vary structure and density, not only color.
5. Critique the current UI against the thesis:
   - first-viewport priority;
   - typography scale and weight;
   - spacing rhythm and grouping;
   - contrast and palette discipline;
   - content density;
   - imagery or icon relevance;
   - copy specificity and product vocabulary;
   - whether decorative devices encode real information;
   - responsive fit.
6. Run the anti-generic check: would the same page work unchanged for a random analytics SaaS, portfolio, ecommerce shop, or AI startup? If yes, revise palette, type treatment, layout structure, content, imagery, state design, or the signature move until at least two choices are subject-specific.
7. Remove or reduce generic decoration before adding new decoration.
8. Make scoped implementation changes using local components, tokens, and CSS/Tailwind conventions.
9. Verify in the browser with screenshots. For existing UI, capture before/after when possible; for new UI, capture rendered results. Include mobile and desktop evidence or explicitly report the blocker and exact checks still needed.

## Modern Visual Direction Patterns

- Dense operations cockpit: compact tables, exception queues, precise labels, signal colors, split panes, timestamps, and audit trails. Good for dashboards, admin, logistics, finance, support, AI agent operations.
- Editorial product story: strong typographic contrast, asymmetric grid, proof near claims, art-directed imagery, and varied section rhythm. Good for marketing pages, reports, case studies, launch pages.
- Tactile commerce: product-specific materials, close-up crops, honest specs, variant clarity, trust near purchase decisions, and restrained motion. Good for product pages and marketplaces.
- Clinical calm: high-contrast quiet neutrals, stable forms, clear recovery copy, evidence trails, and minimal motion. Good for healthcare, legal, insurance, compliance, safety.
- Technical control room: dark or neutral surfaces, mono metadata, status rails, diagrams, calibrated glow only for live state, and high-density scannability. Good for developer tools, infrastructure, monitoring, AI ops.
- Creator zine: modular blocks, expressive typography, sticker or collage accents, playful but accessible color, and concrete creator workflows. Good for communities, media, music, marketplaces, education.
- Field notebook or atlas: maps, layered records, annotations, earthy or environment-derived palette, confidence bands, and practical evidence. Good for agriculture, climate, field work, research, travel.

## Layout And Composition Rules

- Choose layout from user intent: reading, comparing, monitoring, editing, browsing, buying, or deciding.
- Do not default to cards. Use tables/lists for comparison, split panes for triage, editorial grids for narrative, bento for heterogeneous overviews, and dashboards for monitoring.
- Use a real alignment system: columns, gutters, margins, keylines, row rhythm, and scroll ownership.
- Break symmetry deliberately, not randomly. Asymmetry still needs shared edges, baselines, or gutters.
- Make space semantic: related items are closer than unrelated items; section gaps are larger than item gaps; whitespace should communicate grouping before borders do.
- Bento is only justified when each cell has a different job or priority. Random row spans and identical icon-title-paragraph tiles are fake bento.
- Dense dashboards should earn beauty through alignment, typography, precision, and useful hierarchy, not oversized KPI cards and decorative charts.
- Responsive behavior is recomposition. Preserve relationships and priority on mobile rather than blindly stacking desktop columns.

## Typography Rules

- Treat typography as the first visual decision. Define roles for display/title, heading, body, label, caption, metric, code/data, and CTA.
- Product UI usually needs compact, scannable type; editorial and marketing can use larger responsive display type.
- Use one distinctive typographic move, then keep the rest restrained: compressed headings, editorial serif, mono data rail, large numerals, or strong section labels.
- Use tabular numbers for metrics, tables, timers, financial values, and live counters.
- Do not use the same `Inter + giant centered hero + card grid` treatment for every product.
- Avoid ultra-light body text, tiny low-contrast captions, decorative display fonts in controls, centered paragraphs, and all-caps long labels.

## Color And Surface Rules

- Build palettes from semantic roles: background, surface, surface-raised, text, muted text, border, primary action, accent, focus, selected, success, warning, danger, info, disabled, chart, and AI-assist.
- Prefer OKLCH or perceptual thinking when generating ramps, hover states, dark mode, and accents.
- Let neutrals do most of the work; reserve saturated color for action, status, selection, focus, data, or signature moments.
- Do not use purple-blue gradients, neon cyber glass, beige fake-premium, all-blue enterprise, or pastel candy palettes unless the thesis earns them.
- Dark mode is not inversion. Define canvas, surface, raised, overlay, text, border, action, focus, and status roles separately; elevated dark surfaces are usually slightly lighter.
- Glass, blur, glow, and gradients require contrast checks and a reason. Solid surfaces usually beat translucent slop for product UI.

## Imagery, Icons, And Data Rules

- Every visual must have a job: prove product behavior, explain a mechanism, build trust, orient the user, differentiate the brand, or support a state.
- Prefer real product surfaces, realistic screenshots, diagrams, data-derived patterns, domain artifacts, and art-directed crops over stock 3D people, floating blobs, abstract AI waves, and fake dashboards.
- Screenshots should show meaningful workflows and readable details. Use crops, captions, annotations, or before/after sequences when full-page screenshots become illegible.
- Diagrams should use verbs on arrows and labels. Avoid generic hub-and-spoke AI diagrams unless the product actually works that way.
- Icons need consistent stroke, grid, corner, fill, and metaphor rules. Pair icons with text unless meaning is universal.
- Charts must answer a named question. Use direct labels, units, timeframe, freshness, thresholds, annotations, uncertainty, and accessible color. Avoid decorative donuts, rainbow palettes, and chart wallpaper.

## Copy And State Rules

- Generic copy makes good UI feel AI-generated. Replace vague nouns with domain objects and vague verbs with observable actions.
- CTAs should be `verb + domain object`: `Review flagged invoices`, `Import vendor list`, `Generate appeal letter`, `Assign failed payouts`, not `Get started`, `Optimize`, or `Unlock insights`.
- Empty states explain what belongs there, why it is empty, and the best next action. Good-news empty states should not manufacture urgency.
- Error states need problem, object/location, cause if known, and recovery action. Avoid `Something went wrong`, `Invalid`, and cute blame language.
- AI-generated content needs labeling, provenance, sources or evidence, uncertainty when useful, and user controls to edit, accept, reject, regenerate, or inspect.
- Design loading, empty, error, success, disabled, selected, partial-data, stale, offline, permission-limited, and AI-generated states as part of the visual system.

## AI-Specific UX Rules

- AI interfaces should expose control and provenance instead of presenting magic. Show what the system is doing, why it needs permission, what sources it used, and what the user can change.
- For generation or agent workflows, design streaming, pause/stop, retry, resume, regenerate, edit, accept, reject, and undo paths where they affect task trust or recovery.
- For tool-using agents, expose tool calls, approvals, logs, progress, failures, partial results, and recoverable next steps at the level of detail the user needs to stay in control.
- For cited or evidence-based output, show sources, recency, confidence or uncertainty where useful, and a path to inspect the underlying artifact.
- For memory or personalization, show what is remembered, allow revoke/delete/export where appropriate, and avoid hidden persistence that changes future behavior without user visibility.
- For editable artifacts, preserve version history or recovery when edits, regenerations, or tool actions can overwrite user work.

## Motion And Interaction Rules

- Motion must explain state, causality, feedback, spatial continuity, progression, or a low-frequency brand moment.
- Frequent UI feedback should be quick and subtle; larger transitions can be slightly longer but should not block work.
- Good defaults: hover/press/color feedback 50-120ms, microinteractions 70-150ms, popovers 120-180ms, panels/modals 200-300ms, page/layout transitions 250-400ms.
- Exits should be faster than entrances. Dismissed UI should get out of the user's way.
- Prefer opacity and transform. Avoid animating width, height, margin, top, left, heavy blur, filters, and large shadows unless measured.
- Avoid scroll-jacking, parallax, cursor followers, floating blobs, animated counters, infinite marquees, and blanket scroll reveals by default.
- Respect `prefers-reduced-motion` with a usable non-animated path, not merely shorter decorative motion.

## Trend Use Rules

- Gradients: use for controlled atmosphere, lighting, or brand signature; avoid unreadable text and generic AI auroras.
- Glass: use for functional layering or overlays; avoid translucent text panels over busy backgrounds.
- Bento: use for heterogeneous overviews with varied priority; avoid random cards with equal claims.
- Brutalism: use for editorial, cultural, experimental, or rebellious brands; keep core affordances conventional.
- AI sparkle/glow: use only for real generation, suggestion, enhancement, or transformation states; never hide uncertainty behind magic.
- Scroll effects: use to explain a story or mechanism; never delay reading core text.
- 3D: use for physical, spatial, technical, product-commerce, or inspectable objects; avoid unrelated shiny orbs.
- Nostalgia: use when the audience or product has a real cultural reason; do not mix every retro cue.
- Maximalism: choose one dimension to maximize and keep a strict underlying system.

## Anti-Generic Quality Gates

- The visual direction should name a concrete source from the product world: material, instrument, artifact, workflow, environment, audience, or data shape.
- The signature move should be useful or meaningful, not a sticker. Examples: a manga library can use shelf/spine rhythm; a trading tool can use order-book density; a healthcare portal can use calm clinical hierarchy rather than neon gradients.
- Typography should have roles, not just font names: display, body, utility/data, labels, and numbers where relevant.
- Color should have semantic jobs: surface, text, muted, accent, success/warning/danger, focus, data series. Do not add accent colors that do not guide attention.
- Ornament should earn its space. Delete background blobs, glows, grids, and icon clusters when they do not improve comprehension, hierarchy, or brand fit.
- Keep the quality floor: WCAG AA contrast where practical, visible keyboard focus, stable controls, mobile fit, and reduced-motion support.

## Hard Failure Gates

- Thesis gate: the direction can only be described as clean, modern, sleek, premium, or beautiful.
- Template gate: swapping logo and copy would make the screen fit an unrelated SaaS, ecommerce, AI startup, or portfolio.
- Hierarchy gate: the primary message, primary action, or next step is not obvious in the first viewport.
- Specificity gate: labels, metrics, icons, visuals, or state copy are generic, fake, or unrelated to the domain.
- Mobile gate: the desktop composition collapses into bland cards, clipped text, weak CTA placement, or horizontal overflow.
- Accessibility gate: contrast, focus, keyboard access, labels, target size, reduced motion, or non-color state cues are missing.
- Motion gate: animation is decorative, distracting, too slow, inaccessible, or unrelated to feedback/storytelling.
- Craft gate: spacing, alignment, type scale, density, radii, shadows, borders, or surfaces feel accidental or library-default.
- State gate: loading, empty, error, disabled, hover, focus, selected, success, or long-content states are visually unhandled.
- Performance gate: richness depends on oversized media, autoplay, excessive blur/filter, unreserved layout, or heavy motion without justification.

## Self-Critique And Revision Gate

Before finalizing subjective visual work, critique the result and revise rather than merely listing issues:

- Remove or reduce decorative gradients, glass, glow, blobs, nested cards, fake metrics, vague AI copy, and generic icon grids unless they serve hierarchy, brand, state, or comprehension.
- Confirm the primary message, primary action, and next step are clear in the first viewport.
- Confirm spacing, typography, color, surfaces, motion, and imagery follow the visual thesis instead of library defaults.
- Confirm loading, empty, error, disabled, hover, focus-visible, selected, long-content, and mobile states are handled or explicitly out of scope.
- Confirm accessibility, responsive behavior, and performance constraints still hold after polish.
- If at least 20% of decorative or secondary elements can be removed without losing meaning, remove them.

## Critique Rubric

Use severity when reviewing visual design:

- S4 Critical: blocks a core task, creates serious accessibility exclusion, data loss, security/payment/legal risk, or unreleasable responsive breakage.
- S3 Major: harms comprehension, conversion, trust, accessibility, first-run success, or mobile usability.
- S2 Minor: noticeable friction, inconsistency, weak craft, or missed specificity that users can recover from.
- S1 Polish: subjective or cosmetic improvement with limited task impact.

Review areas: hierarchy, originality, product specificity, UX flow, visual craft, accessibility, responsive behavior, motion, content, consistency, trust, and releasability.

## Browser Evidence Gate

- For implemented visual changes, inspect a rendered browser view before claiming completion. Static code inspection is not enough for spacing, hierarchy, density, or responsive fit.
- Capture or request screenshots for at least one supported mobile viewport and one desktop viewport. Add tablet when the layout has sidebars, dense grids, tables, or split panes.
- For existing screens, prefer before/after screenshots so changes can be judged against the old hierarchy instead of personal taste.
- Check long content, empty/loading/error states, primary action placement, focus-visible styling, and dark mode when the project supports it.
- If browser or screenshot evidence is unavailable, state the blocker, the unverified viewports/states, and the safest exact follow-up checks. Do not present subjective visual quality as fully verified.

## Validation

- Check mobile narrow, common mobile, and desktop viewports when possible.
- Treat mobile and desktop browser evidence as a hard gate for material visual changes unless blocked.
- Ensure no text/control overlap, horizontal scroll, or focus-state loss.
- Verify long titles, empty states, loading states, and primary actions still work visually.
- Check normal text contrast against 4.5:1 and large text or meaningful UI graphics against 3:1 when colors changed.
- Check pointer targets around 24x24 CSS pixels or adequate spacing for compact interfaces.
- If the change is subjective, explain why it fits this product better than the previous direction.

## Output Contract

- Visual thesis first, including design source, product subject, audience, hierarchy target, density target, type/color roles, component grammar, signature move, and rejected generic default.
- Evidence inspected: screenshots, browser viewports, local components, tokens, states, or blocker.
- Top visual issues ordered by user impact.
- Changes made or recommended.
- Viewports/states verified, with mobile and desktop called out explicitly.
- Remaining subjective risk, missing screenshots, or blocked browser checks.

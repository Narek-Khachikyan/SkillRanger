---
name: audit
description: Run a final frontend release-readiness audit across accessibility, responsive layout, performance, theming, state coverage, testing evidence, and anti-generic UI risk.
---

# Frontend Audit

Use this skill when a frontend feature, page, redesign, or app slice needs a final cross-cutting quality audit before the work is treated as complete. Use it after implementation or during review when the question is broader than one specialist lane. Do not use it as a substitute for deep specialist work when the task is specifically Next.js routing, React architecture, Tailwind polish, accessibility conformance, Playwright debugging, or visual redesign; call those skills for detailed findings and use this skill to summarize release readiness.

## Decision Rules

- Audit measurable implementation quality first, then subjective polish. A beautiful screen with broken keyboard access, layout overflow, or missing error states is not release-ready.
- Score only what has evidence. If browser, screenshot, axe, Lighthouse, trace, or test evidence is missing, mark the dimension as unverified rather than guessing.
- Separate release blockers from follow-up polish. Do not bury a keyboard trap, data-loss risk, broken mobile layout, or hydration/runtime error under visual suggestions.
- Prefer specialist handoffs over shallow coverage: a11y to `frontend.accessibility-review`, Next.js to `frontend.next-app-router-review`, React architecture to `frontend.react-app-review`, Tailwind implementation to `frontend.tailwind-ui-polish`, performance measurement to `frontend.performance-review`, tests to `frontend.testing-strategy`, and visual taste to `frontend.visual-design-polish`.
- Treat loading, empty, error, disabled, focused, selected, long-content, permission-denied, offline, stale, and success states as part of the release surface.
- Treat generic AI-looking UI as a product quality risk when it weakens trust, hierarchy, specificity, or brand fit.

## Workflow

1. Define the audit envelope: changed routes, components, workflows, viewports, states, design-system surfaces, and release risk.
2. Gather evidence before scoring: code diff, running browser view, screenshots, accessibility artifacts, performance measurements, test results, console/network errors, and existing design-system rules.
3. Walk the primary user flow from entry to completion, including loading, validation, failure, retry, success, and navigation away.
4. Score each audit dimension from 0 to 4 using the scorecard below.
5. Identify release blockers first, then high-impact fixes, then polish.
6. Hand off any dimension that needs specialist review rather than expanding this audit into a vague mega-review.
7. Produce a release-readiness verdict with evidence inspected, unverified areas, and exact next checks.

## Scorecard

- 4 Strong: verified in code and browser/test evidence; no material risk found.
- 3 Acceptable: minor issues or limited unverified states; releasable with low-risk follow-up.
- 2 Risky: meaningful gaps in state coverage, responsive behavior, accessibility, performance, or consistency; fix before broad release.
- 1 Failing: user-visible breakage, serious missing states, broken keyboard/mobile behavior, major performance risk, or systemic drift.
- 0 Blocked: cannot judge because required evidence is unavailable, app cannot run, or the audited surface is undefined.

## Audit Dimensions

- Accessibility: semantic HTML, labels, accessible names, keyboard path, focus visibility, focus management, contrast, target size, live updates, reduced motion, and screen reader risk.
- Responsive layout: mobile, tablet when relevant, desktop, long text, translated text, dense tables, sticky elements, safe areas, horizontal overflow, and touch targets.
- State coverage: default, hover, focus-visible, active, disabled, loading, empty, error, success, selected/current, stale, partial, no-permission, offline, and destructive confirmation or undo.
- Performance: LCP/INP/CLS risk, bundle/client graph, data waterfalls, image and font delivery, third-party scripts, expensive render loops, animation cost, and cache behavior.
- Theming and design-system fit: semantic tokens, dark mode, density, variants, component reuse, shadcn/Tailwind token consistency, and drift from `DESIGN.md` or local conventions.
- Visual and UX quality: primary task clarity, hierarchy, copy specificity, information architecture, generic AI-pattern risk, domain specificity, motion purpose, and first-viewport priority.
- Testing and evidence: unit/component/integration/e2e coverage, visual regression, axe/accessibility checks, manual keyboard/browser checks, CI placement, screenshots, and residual manual QA.
- Runtime integrity: console errors, failed network requests, hydration warnings, broken links/navigation, route state/deep links, form submission behavior, and recoverable failures.

## Release Blocking Gates

- Do not mark a frontend change release-ready with keyboard traps, invisible focus, unlabeled critical controls, missing form labels, inaccessible dialogs, or unverified custom widget behavior.
- Do not accept page-level horizontal scroll, clipped controls, sticky overlap, text/control overlap, broken mobile primary actions, or state-driven layout shift at supported breakpoints.
- Do not accept missing loading/error/empty states for user flows that fetch, mutate, validate, authenticate, or depend on permissions.
- Do not accept runtime console errors, hydration mismatches, broken navigation, duplicate destructive submissions, or irreversible destructive actions without confirmation or undo.
- Do not accept raw visual polish that introduces low contrast, heavy unmeasured media, slow decorative motion, generic gradients/blobs/cards, or design-system token drift.
- If browser evidence is unavailable, the audit can recommend next steps but must not claim full release readiness.

## Evidence Requirements

- Browser evidence: at least one mobile viewport and one desktop viewport for user-facing UI; add tablet when sidebars, tables, grids, modals, or split panes are involved.
- Accessibility evidence: automated checks when tooling exists plus manual keyboard/focus checks for primary flows and custom widgets.
- Performance evidence: measurements when available; otherwise label findings as risk-based and state the trace, Lighthouse, Web Vitals, bundle, or profiler artifact needed.
- Testing evidence: commands run, artifacts inspected, and coverage that remains manual.
- Visual evidence: screenshots or rendered browser inspection for material layout, density, typography, or state changes.

## References

- Use `references/frontend-audit-scorecard.md` for the reusable scoring rubric, verdict definitions, and minimum evidence checklist.
- Hand off specialist issues to the relevant `frontend.*` skill rather than expanding this audit into a deep implementation review.

## Validation

- Every score below 4 should name the affected dimension, file or UI state when available, user impact, and fix direction.
- Every release blocker should map to a concrete verification check after the fix.
- If evidence is incomplete, keep the score honest and list the missing command, viewport, artifact, or state.
- The final verdict should be one of: release-ready, release-ready with follow-ups, risky, blocked, or not enough evidence.

## Output Contract

- Audit envelope and final verdict first.
- Scorecard by dimension, with 0-4 scores and evidence source for each score.
- Release blockers before non-blocking findings.
- Specialist handoffs needed, if any.
- Commands, screenshots, browser viewports, test artifacts, and manual checks run or missing.
- Prioritized remediation plan and residual risk.

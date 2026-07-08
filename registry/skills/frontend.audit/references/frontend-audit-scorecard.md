# Frontend Audit Scorecard

Use this reference when the audit needs a consistent release-readiness score across multiple frontend quality dimensions.

## Scoring

- 4 Strong: verified with code plus browser/test evidence; no material issue found.
- 3 Acceptable: minor issues or limited unverified states; releasable with low-risk follow-up.
- 2 Risky: meaningful gaps that should be fixed before broad release.
- 1 Failing: user-visible breakage, major missing state, broken accessibility/mobile behavior, or systemic drift.
- 0 Blocked: evidence is missing, app cannot run, or the audited surface is undefined.

## Dimensions

- Accessibility: semantics, labels, names, keyboard, focus, contrast, target size, announcements, reduced motion.
- Responsive layout: mobile, tablet when relevant, desktop, long text, translated text, sticky elements, overflow, safe areas.
- State coverage: loading, empty, error, success, disabled, focused, selected, stale, partial, permission, offline, destructive recovery.
- Performance: LCP, INP, CLS, bundle/client graph, data waterfalls, media/fonts/scripts, render loops, animation cost, cache behavior.
- Theming and design-system fit: tokens, variants, dark mode, density, component reuse, shadcn/Tailwind consistency, `DESIGN.md` fit.
- Visual and UX quality: primary task clarity, hierarchy, copy specificity, IA, domain specificity, generic AI-pattern risk, motion purpose.
- Testing and evidence: unit, component, integration, e2e, accessibility, visual regression, CI placement, manual QA.
- Runtime integrity: console errors, failed requests, hydration warnings, broken links, route state, form behavior, recoverable failures.

## Verdicts

- Release-ready: no blockers, all critical dimensions score 3 or 4, and required browser evidence exists.
- Release-ready with follow-ups: no blockers; only low-risk follow-ups remain.
- Risky: one or more dimensions score 2 or material evidence is missing for an important workflow.
- Blocked: blocker exists, app cannot run, or required evidence is unavailable.
- Not enough evidence: audit surface or artifacts are too vague to score honestly.

## Minimum Evidence

- Code or diff context for changed frontend surfaces.
- Browser evidence for at least mobile and desktop on user-facing UI.
- Manual keyboard/focus evidence for interactive flows.
- Automated a11y/performance/test evidence when project tooling exists.
- Explicit list of unverified states and viewports.

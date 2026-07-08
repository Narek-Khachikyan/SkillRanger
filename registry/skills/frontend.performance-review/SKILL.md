---
name: performance-review
description: Review frontend web app performance for rendering cost, bundle size, data loading, image delivery, caching, and Core Web Vitals risk.
---

# Frontend Performance Review

Use this skill when reviewing frontend web app changes that may affect runtime performance, loading speed, bundle size, rendering cost, data fetching, image delivery, caching, or Core Web Vitals. Do not use it for backend-only profiling, database query tuning, or infrastructure capacity planning with no browser-facing surface.

## Decision Rules

- Start from user-visible performance impact before suggesting micro-optimizations.
- Separate initial load, route transition, interaction latency, and render stability concerns.
- Prefer evidence from changed code, framework configuration, bundle boundaries, and existing measurements.
- Treat performance and accessibility as linked when loading states, disabled states, or layout shifts affect usability.
- Use Core Web Vitals as the default browser-facing frame: LCP, INP, and CLS matter more than raw implementation elegance.

## Workflow

1. Identify changed routes, components, data loaders, media assets, client components, and shared utilities.
2. Check whether code moved unnecessary work to the client, added broad imports, unstable keys, repeated effects, or expensive render loops.
3. Review data fetching and caching behavior for duplicate requests, waterfall risk, missing loading/error states, and stale data assumptions.
4. Inspect image, font, script, and third-party usage for blocking resources, missing dimensions, or avoidable client payload.
5. Look for route-level bundle risks such as large dependencies in shared layouts or components that could stay server-rendered.
6. Recommend the smallest change that reduces measurable risk while preserving existing framework conventions.

## Evidence Gates

- Name the metric or performance dimension for every finding: LCP, INP, CLS, bundle size, route transition latency, render cost, memory growth, data waterfall, or cache behavior.
- Use good Core Web Vitals thresholds as default targets unless the project defines stricter budgets: LCP at or below 2.5s, INP at or below 200ms, CLS at or below 0.1.
- When measurement exists, cite Lighthouse/Web Vitals output, browser performance trace, bundle analyzer output, profiler data, network waterfall, or app-specific telemetry.
- When measurement is unavailable, label the finding as risk-based and state the exact evidence needed to confirm it.
- Do not claim a performance win from code shape alone. Tie expected benefit to a user-visible wait, interaction, layout shift, or payload reduction.

## Review Checklist

- Loading and rendering: avoid unnecessary client boundaries, broad imports, render loops, unstable keys, repeated effects, and expensive work during typing or scrolling.
- Images: set dimensions, use responsive sizing, prioritize only the likely LCP image, avoid lazy-loading above-the-fold LCP candidates, and compress/serve appropriate formats.
- Fonts: avoid render-blocking font patterns, check fallback stability, subset where practical, and watch for layout shift from late font swaps.
- JavaScript: keep heavy dependencies out of shared layouts, split route-specific code, avoid hydration work for static UI, and verify tree-shaking assumptions.
- Data: avoid waterfalls, duplicate fetches, stale loading states, cache invalidation gaps, and optimistic UI that hides slow or failed mutations.
- Third parties: identify scripts that block render, shift layout, or add main-thread work; recommend deferral or isolation when appropriate.

## References

- Use web.dev Core Web Vitals guidance, framework performance docs, browser DevTools, Lighthouse, bundle analyzer output, and project-local performance budgets when available.
- When available in the project, inspect framework config, changed route files, component boundaries, package dependencies, image/font usage, and existing performance tests or reports.

## Validation

- Findings should name the likely performance dimension: load, interaction, render stability, memory, or data latency.
- Suggestions should include what evidence would confirm the issue, such as profiler output, bundle analysis, trace, or user-facing timing.
- If no measurement exists, label the recommendation as risk-based rather than proven.
- Report Core Web Vitals, bundle, trace, or profiler artifacts that were inspected, or state exactly why they were unavailable.

## Output Contract

- Lead with the highest user-impact performance risks.
- Include file references and the specific behavior that creates the risk.
- State the expected benefit and any tradeoff for each recommendation.
- List commands, measurements, budgets, and artifacts run or recommended, and note unverified assumptions.

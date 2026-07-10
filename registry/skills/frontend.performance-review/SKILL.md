---
name: performance-review
description: Review frontend web app performance for rendering cost, bundle size, data loading, image delivery, caching, and Core Web Vitals risk.
---

# Frontend Performance Review

Use this skill when reviewing frontend web app changes that may affect runtime performance, loading speed, bundle size, rendering cost, data fetching, image delivery, caching, or Core Web Vitals. Do not use it for backend-only profiling, database query tuning, or infrastructure capacity planning with no browser-facing surface.

## Verification Outcome

- Report `verified` only when the claimed result is backed by the relevant before/after browser measurement, trace, profiler, bundle, network, or field artifact.
- Without measurement capability, report risks and hypotheses but not wins. Return `implemented-unverified` for an approved change with the exact measurement still required, or `blocked` when evidence is necessary to choose a safe fix.
- A Lighthouse score alone does not verify every runtime concern; name the user flow and metric represented by each artifact.

## Decision Rules

- Start from user-visible performance impact before suggesting micro-optimizations.
- Separate initial load, route transition, interaction latency, and render stability concerns.
- Prefer evidence from changed code, framework configuration, bundle boundaries, and existing measurements.
- Treat performance and accessibility as linked when loading states, disabled states, or layout shifts affect usability.
- Use Core Web Vitals as the default browser-facing frame: LCP, INP, and CLS matter more than raw implementation elegance.
- Prioritize likely user-visible bottlenecks before local code neatness: data waterfalls, client bundle growth, hydration cost, render/input latency, media delivery, and layout shift.
- Treat unmeasured performance claims as hypotheses. Recommend the artifact needed to prove or disprove them.

## Workflow

1. Identify changed routes, components, data loaders, media assets, client components, and shared utilities.
2. Check whether code moved unnecessary work to the client, added broad imports, unstable keys, repeated effects, or expensive render loops.
3. Review data fetching and caching behavior for duplicate requests, waterfall risk, missing loading/error states, and stale data assumptions.
4. Inspect image, font, script, and third-party usage for blocking resources, missing dimensions, or avoidable client payload.
5. Look for route-level bundle risks such as large dependencies in shared layouts or components that could stay server-rendered.
6. Check runtime evidence when available: console errors, network waterfall, Lighthouse/Web Vitals, profiler, trace, bundle analyzer, image/font loading, and third-party script behavior.
7. Recommend the smallest change that reduces measurable risk while preserving existing framework conventions.

## Evidence Gates

- Name the metric or performance dimension for every finding: LCP, INP, CLS, bundle size, route transition latency, render cost, memory growth, data waterfall, or cache behavior.
- Use good Core Web Vitals thresholds as default targets unless the project defines stricter budgets: LCP at or below 2.5s, INP at or below 200ms, CLS at or below 0.1.
- When measurement exists, cite Lighthouse/Web Vitals output, browser performance trace, bundle analyzer output, profiler data, network waterfall, or app-specific telemetry.
- When measurement is unavailable, label the finding as risk-based and state the exact evidence needed to confirm it.
- Do not claim a performance win from code shape alone. Tie expected benefit to a user-visible wait, interaction, layout shift, or payload reduction.

## Priority Taxonomy

- Critical: data waterfalls on primary routes, accidental broad client bundles, blocking third-party scripts, missing dimensions causing CLS, expensive work during input, and cache mistakes that make core flows slow or stale.
- High: LCP image or font delivery issues, unnecessary hydration of static UI, large dependencies in shared layouts, repeated fetches, slow optimistic/retry flows, and long lists rendered without a containment or virtualization strategy.
- Medium: avoidable re-renders, unstable keys, heavy animation/filter effects, unoptimized below-fold media, duplicate formatting work, and missing preconnect/preload where evidence shows resource delay.
- Low: micro-optimizations without visible latency, speculative memoization, and refactors that do not affect load, interaction, stability, memory, or payload.

## Measurement Artifact Checklist

- Initial load: Lighthouse, WebPageTest, Core Web Vitals, browser network waterfall, route render timing, or server logs where available.
- Interaction: React Profiler, browser performance trace, INP/Web Vitals, input typing latency, scroll/drag trace, or targeted Playwright timing.
- Bundle: bundle analyzer, dependency diff, route chunk inspection, client/server boundary review, and tree-shaking assumptions.
- Media/fonts/scripts: image sizes and dimensions, LCP candidate priority, font fallback stability, `font-display`, script loading strategy, and third-party main-thread cost.
- Data/cache: duplicate request evidence, waterfall timing, cache freshness contract, invalidation path, stale-data behavior, and retry/recovery timing.

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
- Rank recommendations by expected user-visible impact and confidence in the evidence.

## Output Contract

- Lead with the highest user-impact performance risks.
- Include file references and the specific behavior that creates the risk.
- State the expected benefit and any tradeoff for each recommendation.
- List commands, measurements, budgets, artifacts inspected or recommended, confidence level, and unverified assumptions.

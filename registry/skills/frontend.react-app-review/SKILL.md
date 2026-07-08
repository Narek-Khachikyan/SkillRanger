---
name: react-app-review
description: Review React app changes for state ownership, effects, data flow, routing integration, rendering boundaries, component composition, accessibility handoffs, and maintainability.
---

# React App Review

Use this skill when reviewing general React application changes that are broader than a single reusable component API: state ownership, effects, data flow, routing integration, rendering boundaries, composition, context/provider usage, error/loading states, and maintainability. Do not use it for Next.js framework-specific routing, caching, Server Components, or Server Actions; use `frontend.next-app-router-review` for those. Use `frontend.react-component-design` for focused reusable component API design.

## Decision Rules

- Start from user-visible app behavior and changed ownership boundaries, not from preferred React style.
- Keep derived values derived during render when possible; add state only when there is a real independent source of truth.
- Treat effects as synchronization with external systems, not as a default data-flow mechanism.
- Preserve local project conventions for routing, state libraries, query/cache tools, forms, and component organization.
- Hand off specialist issues instead of flattening them: a11y to `frontend.accessibility-review`, performance measurement to `frontend.performance-review`, visual polish to `frontend.visual-design-polish`, and test portfolio choices to `frontend.testing-strategy`.
- Treat URL state, server/cache state, form state, local UI state, and derived values as separate ownership contracts.
- Be careful with React-version-specific advice. Check installed React version and local compiler/memoization guidance before recommending `memo`, `useMemo`, `useCallback`, `use`, transitions, or ref patterns.

## Workflow

1. Identify changed routes, containers, shared components, hooks, providers, data-fetching code, and state owners.
2. Map state ownership: server/cache state, URL state, form state, local UI state, derived values, and persisted state.
3. Review effects and subscriptions for unnecessary derived state, missing cleanup, stale closures, duplicate fetches, and dependency mistakes.
4. Check data and error flow: loading, empty, optimistic, partial failure, retry, permission, and stale-data states.
5. Review component composition and boundaries: avoid prop drilling through unrelated layers, broad context invalidations, hidden coupling, and premature abstraction.
6. Check routing and URL behavior: filters, tabs, pagination, selected records, deep links, back/forward behavior, and state resets across route or tab changes.
7. Check rendering behavior: expensive work during typing/scrolling, unstable keys, unnecessary remounts, broad context invalidations, controlled input cost, hydration-sensitive values, and unnecessary client work.
8. Verify accessibility and interaction basics are preserved, then hand off specialist findings when they need deeper review.

## React Review Gates

- State model is named and justified: URL state, server/cache state, form state, local UI state, or derived value.
- Effects have an external synchronization target and correct cleanup. Avoid effects that only mirror props/state into more state.
- Data flow preserves loading, empty, error, success, partial, and stale states without hiding failures.
- Component boundaries are clear enough that callers can reason about ownership, events, and side effects.
- Rendering changes do not introduce avoidable remounts, key instability, state loss, or excessive re-render work.

## Priority Checks

- Critical: duplicate data sources, effects that create fetch loops, state resets that lose user input, hidden mutation failures, permission leaks, and route changes that break deep links or back/forward behavior.
- High: unnecessary derived state, stale closures, missing cleanup, unstable keys, broad context providers, expensive controlled inputs, and missing loading/error/empty states.
- Medium: prop drilling through unrelated layers, over-broad reusable components, avoidable remounts, unclear event contracts, and memoization that fights local compiler conventions.
- Low: style-only React preferences, micro-optimizations without user-visible impact, and abstraction cleanup that does not reduce current complexity.

## React Mechanics Checklist

- Effects synchronize with an external system such as network, DOM, subscription, timer, storage, or analytics. They should not mirror props/state into duplicated state.
- URL-owned state stays in the URL when users expect shareable, restorable, or back/forward-aware state.
- Server/cache state stays in the project's query, loader, router, or framework cache layer rather than ad hoc local state.
- Form state preserves user input across validation, loading, retry, and route transitions where the product expects recovery.
- Use transitions or deferred rendering only when they protect real interaction responsiveness; do not add them as generic decoration.
- Memoization is justified by measured or obvious render cost, stable dependency contracts, and local React Compiler guidance.
- Hydration-sensitive values such as dates, random IDs, viewport-only data, and local storage are handled without server/client markup drift.

## References

- Prefer project-local React conventions, router/data libraries, form libraries, state management, query/cache tools, and existing component patterns.
- Use official React guidance for state, effects, rendering, context, refs, transitions, and controlled/uncontrolled inputs when local conventions do not answer the question.

## Validation

- Findings should name the affected state owner, effect, data flow, route behavior, or component boundary.
- Suggested fixes should preserve existing app conventions unless the local pattern is the source of the bug.
- If behavior cannot be verified, state the missing route, state, or interaction check.
- State whether the recommendation is correctness, maintainability, performance risk, or framework-version-sensitive guidance.

## Output Contract

- Lead with findings ordered by user or maintainer impact.
- Include file references and affected states/routes when available.
- Explain whether each recommendation is about state ownership, effects, data flow, rendering, or composition.
- List targeted tests or manual checks needed for the changed state paths.

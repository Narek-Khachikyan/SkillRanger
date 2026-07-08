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

## Workflow

1. Identify changed routes, containers, shared components, hooks, providers, data-fetching code, and state owners.
2. Map state ownership: server/cache state, URL state, form state, local UI state, derived values, and persisted state.
3. Review effects and subscriptions for unnecessary derived state, missing cleanup, stale closures, duplicate fetches, and dependency mistakes.
4. Check data and error flow: loading, empty, optimistic, partial failure, retry, permission, and stale-data states.
5. Review component composition and boundaries: avoid prop drilling through unrelated layers, broad context invalidations, hidden coupling, and premature abstraction.
6. Check rendering behavior: expensive work during typing/scrolling, unstable keys, unnecessary remounts, and state resets across route or tab changes.
7. Verify accessibility and interaction basics are preserved, then hand off specialist findings when they need deeper review.

## React Review Gates

- State model is named and justified: URL state, server/cache state, form state, local UI state, or derived value.
- Effects have an external synchronization target and correct cleanup. Avoid effects that only mirror props/state into more state.
- Data flow preserves loading, empty, error, success, partial, and stale states without hiding failures.
- Component boundaries are clear enough that callers can reason about ownership, events, and side effects.
- Rendering changes do not introduce avoidable remounts, key instability, state loss, or excessive re-render work.

## References

- Prefer project-local React conventions, router/data libraries, form libraries, state management, query/cache tools, and existing component patterns.
- Use official React guidance for state, effects, rendering, context, refs, transitions, and controlled/uncontrolled inputs when local conventions do not answer the question.

## Validation

- Findings should name the affected state owner, effect, data flow, route behavior, or component boundary.
- Suggested fixes should preserve existing app conventions unless the local pattern is the source of the bug.
- If behavior cannot be verified, state the missing route, state, or interaction check.

## Output Contract

- Lead with findings ordered by user or maintainer impact.
- Include file references and affected states/routes when available.
- Explain whether each recommendation is about state ownership, effects, data flow, rendering, or composition.
- List targeted tests or manual checks needed for the changed state paths.

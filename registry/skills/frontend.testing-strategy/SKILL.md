---
name: testing-strategy
description: Plan and review frontend testing strategy across unit, integration, component, end-to-end, accessibility, and regression coverage.
---

# Frontend Testing Strategy

Use this skill when planning or reviewing test coverage for frontend web applications, especially changes that need unit, integration, component, end-to-end, accessibility, or regression coverage decisions. Do not use it for debugging a single Playwright failure when the dedicated Playwright debug skill is a better fit, or for backend-only test architecture.

## Decision Rules

- Match test type to risk: pure logic, component behavior, route integration, browser workflow, visual regression, or accessibility.
- Prefer a small number of high-signal tests over broad snapshots that lock in implementation details.
- Separate missing coverage from brittle coverage, slow coverage, and duplicate coverage.
- Respect the project's existing test runner and fixture patterns before proposing new tooling.
- Treat accessibility, visual regression, and browser workflow coverage as separate gates. A unit test plan alone is not a frontend release strategy.
- For browser-facing behavior, inspect the rendered app before inventing selectors or assertions. Screenshots, DOM roles, console errors, and network state often reveal the right test contract.
- Prefer tests that assert user-observable state, accessible names, navigation, and recovery behavior over implementation details.

## Workflow

1. Identify changed user flows, components, data contracts, validation rules, and edge states.
2. Map each risk to the narrowest useful test layer: unit, integration, component, end-to-end, accessibility, visual, or smoke.
3. Check existing tests for overlap, brittle selectors, excessive mocking, missing cleanup, and unclear assertions.
4. For browser workflows, run or request a reconnaissance pass: render the route, inspect screenshot/DOM roles, console errors, network failures, and stable user-facing selectors before proposing assertions.
5. Look for gaps around loading, error, empty, permission, responsive, keyboard, long-content, and recovery states.
6. Recommend test additions or refactors that fit the current runner, naming conventions, fixtures, and CI constraints.
7. Call out cases where manual QA or product acceptance criteria are still needed beyond automated tests.

## Browser Reconnaissance Gate

- Start from the smallest route, story, or fixture that renders the changed behavior.
- Inspect the rendered DOM through user-facing roles, labels, headings, text, URLs, and landmark structure before choosing selectors.
- Capture or inspect screenshots for layout, visual state, long text, empty/loading/error states, and responsive breakpoints when visual correctness is part of the risk.
- Check console errors, page errors, hydration warnings, failed requests, and unexpected redirects before treating a test failure as only a test problem.
- Prefer role/name, label, placeholder, text, alt/title, or project-standard test id selectors. Avoid CSS/XPath selectors unless no user-facing contract exists.
- Assert the final user-visible state, not only that an event handler was called or a mocked function received arguments.
- If the app cannot run locally, state that the browser evidence is missing and keep browser workflow recommendations conditional.

## Test Layer Gates

- Unit tests: pure transforms, reducers, validators, formatting, permission logic, and branch-heavy helpers. Keep them fast and independent of DOM/browser concerns.
- Component tests: reusable UI behavior, prop/state variants, forms, keyboard handling, focus behavior, disabled/loading/error states, and accessible names where a browser is not required.
- Integration tests: route-level data, provider wiring, form submission, cache invalidation, optimistic updates, and error recovery across component boundaries.
- End-to-end tests: critical user workflows, routing, authentication-sensitive paths, cross-page state, real browser behavior, and high-risk regressions that unit/component tests cannot prove.
- Accessibility tests: automated axe or equivalent checks for rendered states plus manual keyboard/focus/APG checks for custom controls.
- Visual regression or screenshot checks: layout, density, responsive breakpoints, theme changes, before/after polish, and state rendering where visual correctness matters.
- Smoke tests: the smallest build/start/render path that catches broken routes, missing environment assumptions, and release-blocking frontend failures.

## Coverage Quality Gates

- Every proposed test should name the regression it would catch and why that layer is the cheapest reliable layer.
- Prefer role-based and user-facing selectors in browser tests; avoid brittle implementation selectors unless the project has a stable test-id convention.
- Include at least loading, empty, error, disabled, focused, and successful states when those states are part of the user workflow.
- Keep snapshots narrow. Do not use broad snapshots as a substitute for behavior, accessibility, or visual assertions.
- Respect CI cost: identify which tests run on every push, PR, nightly, or release gate.
- When tooling is absent, propose the smallest first credible test surface instead of a full stack migration.
- Browser tests should include at least one successful path and one meaningful recovery path for critical workflows that fetch, submit, validate, authenticate, or mutate data.
- Visual or screenshot coverage should be tied to layout, density, responsive behavior, theme, or state correctness; do not add snapshots that only freeze incidental markup.

## References

- Use the project's existing runner docs and local conventions first: Vitest/Jest, React Testing Library, Playwright/Cypress, Storybook, axe integrations, visual snapshot tooling, and CI workflows when present.
- When available in the project, inspect test config, existing test files, fixtures, page objects, accessibility tests, screenshot tests, and CI workflow before proposing changes.

## Validation

- Each recommended test should tie to a concrete behavior or regression risk.
- The proposed test layer should explain why it is cheaper or more reliable than alternatives.
- If the project has no test runner, recommend an incremental first test surface rather than a full test stack migration.
- Separate automated coverage from manual release checks and product acceptance criteria.
- For browser-facing recommendations, state whether rendered DOM, screenshot, console/network, or trace evidence was inspected.

## Output Contract

- Summarize the risk areas first.
- Provide a short coverage plan grouped by test layer.
- Include specific files, flows, or assertions to add or adjust.
- List test commands run or recommended, browser reconnaissance evidence, CI placement, and coverage that remains manual or unverified.

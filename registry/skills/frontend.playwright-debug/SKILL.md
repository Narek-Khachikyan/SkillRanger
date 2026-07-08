---
name: playwright-debug
description: Diagnose Playwright end-to-end failures using traces, artifacts, actionability logs, locator audits, route-aware waits, retries, CI checks, and fixture isolation.
---

# Playwright Debug

Use this skill when a Playwright test fails, flakes, regresses in CI, or needs a targeted debug workflow. Do not use it for unit tests, non-browser integration tests, purely visual design review, or browser exploration without a failing spec or reproducible user workflow.

## Decision Rules

- Start with evidence, not guesses. Prefer HTML report, trace, screenshots, video, actionability logs, console/page errors, network failures, and CI metadata before code inspection.
- Reproduce the smallest failing spec, project, browser, and line before changing global config or broad timeouts.
- Classify the failure: app regression, locator fragility, actionability/timing, route or hydration race, network/backend dependency, data/fixture pollution, CI environment, parallelism/order dependency, or unknown.
- Prefer user-facing locators: role/name first, then label/text/placeholder/alt/title, then test id when the repo has an explicit test-id convention.
- Treat `waitForTimeout`, broad timeout increases, blanket retries, and `force: true` as diagnostic smells unless the evidence proves they are intentionally needed.
- Use retries to collect artifacts and expose flakes, not to hide the root cause.


## Failure Taxonomy

Classify before fixing:

| Class | Evidence | Preferred fix |
| --- | --- | --- |
| App regression | trace shows real broken UI, console/page error, bad response, or missing state | fix app behavior, then keep the test strict |
| Locator fragility | multiple matches, DOM copy changed, locator not user-facing | replace with role/name or scoped locator; add accessible name if missing |
| Actionability/timing | trace log reports not visible/stable/receiving events/enabled/editable | remove overlay/race, wait for user-visible state, or fix transition/state |
| Route/hydration race | URL changes before UI is ready, click before handlers attach | wait for route-specific UI or web-first assertion |
| Network/backend dependency | failed/slow response in trace Network tab or CI logs | stub only when the test contract allows it; otherwise fix dependency/readiness |
| Fixture pollution | passes alone, fails after another spec/worker/retry | isolate accounts, seeded data, storage state, and cleanup |
| CI environment | local pass + CI CPU/browser/env/artifact difference | tune CI readiness/workers only after app/test causes are excluded |

## Workflow

1. Capture the failure envelope: failing command, spec path and line, project/browser, local vs CI, retry status, expected user workflow, and recent related changes.
2. Reproduce narrowly when possible:
   - `npx playwright test path/to/spec.ts:LINE --project=chromium`
   - `npx playwright test path/to/spec.ts:LINE --trace on`
   - `npx playwright test path/to/spec.ts:LINE --debug`
3. Inspect artifacts in priority order:
   - HTML report, failed step, source line, and retry/flaky status;
   - Trace Viewer: Actions timeline, Error tab, Source, Call, Log/actionability checks, Console, Network, Metadata, and Attachments;
   - screenshots and videos under `test-results` or configured output folders;
   - console errors, `pageerror`, failed requests, response status, and CI logs.
4. Read `playwright.config.*`, fixtures, page objects, test helpers, auth/storage-state setup, webServer config, and nearby passing specs.
5. Audit selectors and assertions:
   - locator ladder: role/name, label, text, placeholder, alt/title, explicit test id, then CSS/XPath only as a last resort;
   - repair ambiguous locators with scoping, chaining, `filter({ hasText })`, `filter({ has })`, or a uniqueness assertion instead of `.first()` as a silence button;
   - add accessible names in app code when the test exposes a real usability gap;
   - prefer web-first assertions such as `toBeVisible`, `toHaveURL`, `toHaveText`, or `toHaveAccessibleName`.
6. Diagnose waits and transitions:
   - for route changes, redirects, and SPA navigation, wait for URL or user-visible route state;
   - for network-dependent UI, wait for the resulting UI state or a specific response only when the UI has no better signal;
   - for hydration races, verify whether visible controls are clickable before handlers are attached.
   - map failed actionability checks explicitly: visible, stable, receives events, enabled, and editable;
   - avoid `force: true` unless the artifact proves the browser interaction is intentionally non-user-like.
7. Review fixture and state isolation:
   - seeded data, cleanup, auth state, storage state, per-worker uniqueness, parallelism, retries, worker-scoped fixtures, and test order assumptions.
8. Check CI-specific causes:
   - browser/dependency install, `baseURL`, web server readiness, worker count, CPU/memory contention, sharding, env vars, artifact upload, OS/browser parity.
   - uploaded `playwright-report/`, traces, screenshots, and videos on failure or retry;
   - auth/storage-state expiry, committed auth secrets, and shared-account state pollution.

## Locator And Wait Reference

- Locator ladder: `getByRole({ name })` → `getByLabel` → `getByPlaceholder` → `getByText` → `getByAltText`/`getByTitle` → configured test id → scoped CSS only when user-facing selectors are impossible.
- Assert uniqueness before interaction when a locator is repaired from a flake: `await expect(locator).toHaveCount(1)` or scope it to the owning landmark/dialog/row.
- Prefer `await expect(page).toHaveURL(...)`, `await expect(heading).toBeVisible()`, and route-specific content assertions over sleeps.
- Use `waitForResponse` only when the UI exposes no reliable user-observable state, and still assert the final UI state.
- Treat `.first()`, `{ force: true }`, `waitForTimeout`, broad `test.setTimeout`, and global retry increases as suspect until the trace proves they match the user workflow.

## CI Artifact Policy

- Required for a credible flake diagnosis: failing command, spec path/line, project/browser, retry count, trace or HTML report, screenshot/video when configured, and CI job metadata.
- If artifacts are missing, first recommend enabling trace on first retry and screenshot/video on failure for the smallest affected project.
- Do not mark a Playwright skill evaluation above `evaluation.status: "none"` unless the run stores evidence under the eval suite contract: skill id/version/checksum, command, fixture/project, duration, trace/screenshot/video paths, and pass/fail result.
9. Make the smallest fix that addresses the classified root cause. Run the targeted test again or state the exact next verification command.

## References

- Prefer project-local docs, comments, fixtures, and nearby passing specs before introducing new conventions.
- Use Playwright's trace viewer, locators, actionability, retries, fixtures, network, and CI docs as the external source of truth when project guidance is absent.
- If a repo already configures trace/screenshot/video policy, preserve it unless evidence shows it blocks diagnosis. A good default is screenshot on failure, trace on first retry, and video on first retry for CI.

## Validation

- Cite the artifact or observation that supports the root-cause classification.
- Do not present a flake as harmless; flaky tests can still expose real regressions.
- Fixes should keep test data isolated, selectors resilient, and waits tied to user-observable state.
- If trace or reproduction is unavailable, state missing evidence and provide the safest next command.
- Avoid broad changes to global timeouts, global retries, or worker count unless the failure is classified as environment/CI capacity.

## Output Contract

- Suspected root cause and classification first.
- Evidence inspected: report, trace, screenshot, video, actionability log, console/network, CI metadata, or missing.
- Exact command run or recommended.
- Selector, wait, route, fixture, data, CI, or app behavior changes proposed.
- Verification result or next targeted verification command.
- Remaining flake risk and any missing artifacts.

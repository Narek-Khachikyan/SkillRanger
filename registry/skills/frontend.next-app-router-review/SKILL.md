---
name: next-app-router-review
description: Review Next.js App Router changes for routing, Server/Client Component boundaries, data fetching, caching, Server Actions, metadata, streaming, and framework-specific performance risk.
---

# Next.js App Router Review

Use this skill when reviewing framework-specific Next.js App Router or modern Pages Router changes: routing, layouts, Server/Client Component boundaries, data fetching, caching/revalidation, metadata, route handlers, Server Actions, streaming/loading/error states, and framework-driven performance risk. Do not use it as a substitute for specialist accessibility, visual design, Tailwind, testing, or evidence-led performance reviews when the task is primarily in those lanes.

## Decision Rules

- Detect App Router vs Pages Router and the installed Next version/config before giving framework advice.
- Keep this skill Next-specific. Hand off general React app architecture to `frontend.react-app-review`, deep reusable component API work to `frontend.react-component-design`, accessibility conformance to `frontend.accessibility-review`, evidence-led performance to `frontend.performance-review`, and test portfolio work to `frontend.testing-strategy`.
- Prefer concrete regressions and missing states over broad framework advice.
- Match the app's existing App Router or Pages Router conventions before suggesting new patterns.
- Distinguish a user-visible bug from a style preference.
- Treat Server/Client Component boundaries, cache freshness, mutation invalidation, and route segment states as framework contracts, not implementation details.
- Do not give Next.js advice from memory alone when the installed version, router mode, or experimental flags change the correct answer.

## Workflow

1. Identify the changed routes, layouts, pages, components, server actions, route handlers, API calls, and shared utilities.
2. Detect router mode, Next version, relevant `next.config.*` flags, and whether the project uses the previous caching model or Cache Components/PPR-style primitives.
3. Check Server/Client Component boundaries: push `'use client'` to small interactive leaves, keep server-only modules and secrets out of client graphs, and ensure server-to-client props are serializable.
4. Review data fetching and caching: avoid local Route Handler hops from Server Components, name the freshness contract, and choose project-appropriate `fetch` cache options, `unstable_cache`, `use cache`, `cacheLife`, tags, `revalidatePath`, `revalidateTag`, `updateTag`, or `refresh`.
5. Check route conventions, segment files, metadata, `loading`, `error`, `not-found`, Suspense placement, route transitions, and meaningful pending/error UI.
6. Review Server Actions and forms for server-side validation, auth/authz inside the action, CSRF/origin assumptions, safe return DTOs, accessible pending/error feedback, duplicate-submit protection, and cache invalidation after mutation.
7. Check hydration and runtime safety: server/client date or random values, browser-only APIs, environment variables, dynamic imports, serializable props, and console/runtime errors.
8. Identify specialist handoffs for a11y, visual design, Tailwind, testing, or deep performance issues instead of flattening every concern into this review.

## Next Review Gates

- Router mode and version are identified: App Router, Pages Router, hybrid app, installed Next version, relevant `next.config.*`, React version, and experimental cache/PPR flags.
- Changed segment files are accounted for: `layout`, `template`, `page`, `loading`, `error`, `global-error`, `not-found`, `default`, route groups, parallel routes, intercepting routes, route handlers, and metadata exports where relevant.
- Server/Client boundary is intentional: client components are small interactive leaves, server-only modules and secrets do not enter the client graph, props crossing the boundary are serializable, and provider placement does not force broad hydration.
- Data freshness contract is named: static, dynamic, request-time, tag-invalidated, path-invalidated, user-specific, or real-time. Cache APIs match that contract.
- Mutations revalidate or refresh the exact affected surfaces and expose pending, success, validation error, server error, and retry states.
- Route state and navigation preserve expected user behavior: deep links, search params, back/forward navigation, redirects, not-found behavior, and auth/permission boundaries.

## Server And Client Boundary Checks

- Avoid adding `'use client'` to route-level files, layouts, or shared shells unless interaction truly requires it.
- Keep server-only code behind server modules: secrets, database clients, filesystem access, admin SDKs, private API keys, and privileged fetches must not be imported by client graphs.
- Ensure client component props are serializable and stable enough to avoid hydration mismatches or needless client work.
- Prefer server-rendered static structure with interactive islands for filters, menus, forms, and controls.
- Check provider placement. Broad providers in root layouts can hydrate the whole app and hide route-specific performance costs.
- Confirm browser-only APIs, timers, `Date`, random values, `window`, `document`, and local storage access are guarded or isolated to client code without server/client markup drift.

## Caching And Revalidation Checks

- Do not fetch the app's own Route Handlers from Server Components when direct server calls would avoid an extra HTTP hop and duplicated auth/cache logic.
- For `fetch`, `unstable_cache`, `use cache`, `cacheLife`, and cache tags, verify whether data is shared across users, request-specific, permission-sensitive, or stale-tolerant.
- For mutations, confirm `revalidatePath`, `revalidateTag`, `updateTag`, `router.refresh`, or project-local cache invalidation matches the surfaces users can see.
- Avoid hiding stale or failed mutations behind optimistic UI without rollback, retry, or visible stale state.
- Watch for accidental dynamic rendering from cookies, headers, search params, no-store fetches, or uncached server work in shared layouts.
- Check waterfalls across nested layouts, pages, and client components. Prefer parallel server fetches or Suspense boundaries when route UX benefits.

## Server Action And Route Handler Safety

- Validate inputs on the server even when client validation exists.
- Check authentication and authorization inside the action or route handler, not only at the page or button level.
- Return safe DTOs. Do not leak stack traces, internal IDs, secrets, private permissions, or over-broad model objects to clients.
- Provide accessible pending, validation error, server error, success, and retry feedback for forms and mutations.
- Prevent duplicate destructive submissions and preserve a recovery path for failed or partial mutations.
- For route handlers, verify method handling, status codes, cache headers, request body limits, auth boundaries, and CORS/origin assumptions where relevant.

## Metadata, Media, And Runtime Checks

- Metadata should match the route's user-visible content and avoid missing title/description/canonical/social metadata on public pages.
- Check `next/image`, `next/font`, and `next/script` usage for dimensions, priority only for likely LCP images, stable font fallback, script strategy, and avoidable client payload.
- Check streaming and Suspense fallbacks for meaningful skeletons, stable layout, and accessible loading feedback.
- Check `error` and `not-found` states for recovery paths, navigation, support context, and no sensitive error details.
- Check console errors, hydration warnings, failed requests, and broken navigation before calling the route review complete.

## References

- Use `references/next-review-checklist.md` for the reusable App Router, Server/Client boundary, cache, mutation, route handler, media, metadata, and runtime review checklist.
- Prefer version-matched project docs and installed Next docs when present; otherwise use official Next.js App Router, caching, data fetching, Server Components, Server Actions, route handlers, metadata, streaming, image, font, and script docs.
- Inspect `app/`, `pages/`, `components/`, `next.config.*`, route handlers, server action files, test files, and existing design-system components before giving recommendations.

## Validation

- Findings should be backed by a file path, code behavior, missing state, or observable user impact.
- Suggested fixes should preserve the local framework and component conventions.
- If evidence is incomplete, state what is missing instead of guessing.
- Each framework finding should identify the affected contract: routing, server/client boundary, cache freshness, mutation invalidation, route state, metadata, media, or runtime safety.
- If version-specific APIs are involved, state the installed version or the missing evidence needed to verify it.

## Output Contract

- Lead with findings ordered by severity.
- Include file references when available.
- Explain the user or maintainer impact in one sentence per finding.
- Classify each finding by Next.js contract: router mode, segment convention, Server/Client boundary, caching/revalidation, Server Action safety, route handler behavior, metadata/media, streaming state, or runtime safety.
- List commands run or recommended, browser/runtime evidence inspected, and any unverified assumptions.

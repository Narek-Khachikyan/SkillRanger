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

## Workflow

1. Identify the changed routes, layouts, pages, components, server actions, route handlers, API calls, and shared utilities.
2. Detect router mode, Next version, relevant `next.config.*` flags, and whether the project uses the previous caching model or Cache Components/PPR-style primitives.
3. Check Server/Client Component boundaries: push `'use client'` to small interactive leaves, keep server-only modules and secrets out of client graphs, and ensure server-to-client props are serializable.
4. Review data fetching and caching: avoid local Route Handler hops from Server Components, name the freshness contract, and choose project-appropriate `fetch` cache options, `unstable_cache`, `use cache`, `cacheLife`, tags, `revalidatePath`, `revalidateTag`, `updateTag`, or `refresh`.
5. Check route conventions, metadata, `loading`, `error`, `not-found`, Suspense placement, route transitions, and meaningful pending/error UI.
6. Review Server Actions and forms for server-side validation, auth/authz inside the action, safe return DTOs, accessible pending/error feedback, and cache invalidation after mutation.
7. Identify specialist handoffs for a11y, visual design, Tailwind, testing, or deep performance issues instead of flattening every concern into this review.

## References

- Prefer version-matched project docs and installed Next docs when present; otherwise use official Next.js App Router, caching, data fetching, Server Components, Server Actions, route handlers, metadata, streaming, image, font, and script docs.
- Inspect `app/`, `pages/`, `components/`, `next.config.*`, route handlers, server action files, test files, and existing design-system components before giving recommendations.

## Validation

- Findings should be backed by a file path, code behavior, missing state, or observable user impact.
- Suggested fixes should preserve the local framework and component conventions.
- If evidence is incomplete, state what is missing instead of guessing.

## Output Contract

- Lead with findings ordered by severity.
- Include file references when available.
- Explain the user or maintainer impact in one sentence per finding.
- List commands run or recommended, and note any unverified assumptions.

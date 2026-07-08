# Next.js Review Checklist

Use this reference for App Router and modern Pages Router reviews where framework behavior is part of the risk.

## Project Context

- Identify router mode: App Router, Pages Router, or hybrid.
- Identify installed Next and React versions.
- Inspect `next.config.*`, experimental flags, cache/PPR settings, image/font/script config, and route structure.
- Prefer project-local conventions and version-matched docs over generic Next.js memory.

## Segment Files

- Account for changed `layout`, `template`, `page`, `loading`, `error`, `global-error`, `not-found`, route groups, parallel routes, intercepting routes, route handlers, and metadata exports.
- Verify `loading`, `error`, and `not-found` states are meaningful, accessible, and recoverable.
- Check search params, redirects, not-found behavior, back/forward navigation, and deep links.

## Server/Client Boundary

- Keep `'use client'` in small interactive leaves when possible.
- Ensure server-only modules, secrets, database clients, admin SDKs, filesystem access, and privileged fetches stay out of client graphs.
- Ensure props crossing the server/client boundary are serializable.
- Watch for broad providers that hydrate static layouts or shared shells.
- Guard browser-only APIs and hydration-sensitive values such as dates, random values, viewport data, and local storage.

## Data And Cache

- Name the freshness contract: static, dynamic, request-time, tag-invalidated, path-invalidated, user-specific, or real-time.
- Avoid fetching the app's own route handlers from Server Components when direct server calls are available.
- Match `fetch`, `unstable_cache`, `use cache`, `cacheLife`, tags, `revalidatePath`, `revalidateTag`, `updateTag`, and `router.refresh` to the freshness contract.
- Check duplicate requests, nested waterfalls, stale UI, and optimistic updates without rollback.
- Watch for accidental dynamic rendering from cookies, headers, search params, `no-store`, or uncached server work in shared layouts.

## Mutations And Route Handlers

- Validate inputs on the server.
- Check auth/authz inside Server Actions and route handlers.
- Return safe DTOs and avoid leaking stack traces, secrets, internal permissions, or over-broad model objects.
- Provide pending, success, validation error, server error, and retry feedback.
- Prevent duplicate destructive submissions and preserve recovery after partial failure.
- For route handlers, verify methods, status codes, cache headers, body limits, auth boundaries, and origin/CORS assumptions.

## Media, Metadata, Runtime

- Metadata matches route content and public sharing needs.
- `next/image` uses dimensions and prioritizes only likely LCP images.
- `next/font` has stable fallback and avoids avoidable layout shift.
- `next/script` strategy avoids blocking route render unless justified.
- Check console errors, hydration warnings, failed requests, and broken navigation before calling the review complete.

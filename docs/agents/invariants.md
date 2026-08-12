# SkillRanger Invariants (Agent Guide)

Rules that must never be broken. Enforced items make tests fail if violated; conventions are
not machine-checked but are held to regardless.

## Enforced by code — breaking these makes tests fail

- Only `StrictSkillRunStore.finalizeRun` may produce the `verified` state. A reducer that tries
  throws `run-integrity` (`src/runtime/strict/store.ts`). `finalizeRun` short-circuits on `verified`
  alone, so a blocked run stays re-finalizable.
- Lifecycle-v1 `verified` requires passed hard gates, at least one evidence entry, matching evidence
  snapshots, and `content-delivered` reads for every mandatory skill (`src/runtime/skill-run/reducer.ts`).
- The MCP project root is fixed at server startup from `SKILLRANGER_PROJECT_ROOT` or `cwd`. A tool
  argument that tries to override it yields `project-root-unauthorized` (`src/mcp/router-context.ts`,
  [ADR 0001](../adr/0001-universal-prompt-router-boundaries.md)).
- `callMcpTool` validates arguments against each tool's published `inputSchema` — except router
  tools, which are deliberately excluded so they can own that trust-boundary error code.
- A skill counts as installed only when the lockfile checksum equals the registry checksum **and**
  `assertInstalledMatches` passes (`src/runtime/strict/service.ts`).
- `prepare_task` requires an explicit trigger (`@skillranger`, `skillranger`, or `/sr`); matches
  inside code spans or URLs are rejected (`src/router/trigger.ts`).
- Mandatory router reads must be consumed in inventory order before any optional file
  (`validateReadLedger` in `src/router/reader.ts`).
- Every run-store and lockfile mutation happens under `RunFileLock` (`src/runtime/run-lock.ts`) and
  lands via temp-file + `rename`.
- Routing performs no network calls, no child processes, and no application edits.

Zero runtime dependencies is enforced as a convention; the canonical statement lives in the root
`AGENTS.md` (Toolchain).

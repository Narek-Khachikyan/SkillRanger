# Release Checklist

This checklist covers the current public beta. It verifies the npx/npm UX, compiled npm binaries, source-run CLI, MCP server, Universal Prompt Router, bundled registry, audit gates, frontend and router eval suites, and package hygiene before handing the beta to another user or publishing a tarball.

This MVP supports npm/npx usage from compiled `dist/` via `skillranger`, MCP launch through `skillranger mcp`, the installed convenience binary `skillranger-mcp`, and source-run development from a checkout via `node src/cli/index.ts` and `node src/mcp/server.ts`.

## Pre-Release Checks

Run the single local release gate from the repository root:

```bash
npm run release:check
```

`release:check` runs the build, source check, test suite, registry validation/lint/audit, blocking frontend routing evaluations, and the Universal Router golden gate. Run `npm run publish:check` separately before creating a package.

Expected result:

- Build and syntax checks pass.
- Test suite passes.
- Registry validates all curated skills.
- Registry audit reports zero failed skills.
- Frontend eval suite reaches the seeded target counts.
- Frontend routing eval emits project-rooted routing metrics and failure details when current routing misses expectations.
- Universal Router shipped and synthetic suites meet the checked-in status, primary, precision/recall, companion, outcome, privacy, and determinism thresholds.

## CLI Smoke Checks

Run the compiled binary fixture happy path:

```bash
node dist/cli/index.js scan fixtures/next-react-ts --json
node dist/cli/index.js recommend fixtures/next-react-ts --target codex
node dist/cli/index.js recommend fixtures/next-react-ts --target codex --lane design --limit-per-lane 2
node dist/cli/index.js eval:frontend --run-routing --project fixtures/next-react-ts --json
node dist/cli/index.js install frontend.next-app-router-review --project fixtures/next-react-ts --target codex --scope repo --dry-run --json
node dist/cli/index.js installed fixtures/next-react-ts
node dist/cli/index.js task fixtures/next-react-ts --intent "Review accessibility and verify the result" --target codex --json
```

Run the interactive setup wizard from a disposable frontend project and decline the final confirmation:

```bash
node dist/cli/index.js setup /path/to/disposable/frontend-project
```

Run one source-run smoke to verify checkout development still works:

```bash
node src/cli/index.ts doctor
```

Expected result:

- Next.js fixture scans as frontend/web-app with React, TypeScript, Tailwind, Vitest, Playwright, and Testing Library signals.
- Default recommendations include relevant frontend skills.
- Design-lane recommendations only include design-lane skills.
- Routing eval returns `routingEval.metrics` and `routingEval.failures` for the Next.js fixture.
- Dry-run install reports expected writes and lockfile updates without writing files.
- `installed` handles an empty or existing lockfile cleanly.
- Setup wizard shows recommendations selected by default, Space toggles items, Enter continues, and `n` or Enter at final confirmation writes nothing.
- Direct router mode prepares a lifecycle run without requiring a terminal trigger and returns ordered mandatory reads.

## Negative Fixture Checks

Verify the recommender and audit gates do not overreach:

```bash
node dist/cli/index.js recommend fixtures/vite-react-ts --target codex --json
node dist/cli/index.js recommend fixtures/backend-node --target codex --json
node dist/cli/index.js audit frontend.next-app-router-review --json
```

Expected result:

- Vite React projects do not receive Next-only recommendations.
- Backend-only projects do not receive the frontend pack.
- Curated skills audit as low risk with no findings.

## Packaging Check

Inspect the package contents without writing a tarball:

```bash
npm pack --dry-run
```

Expected tarball contents include:

- `dist/`
- `src/`
- `registry/skills/`
- `schemas/`
- `evals/`
- `tests/fixtures/router-cases.json` and declarative `tests/fixtures/router-packs/` used by `eval:router`
- `docs/`
- `README.md`
- `RELEASE.md`
- `LICENSE`
- `package.json`

Expected tarball contents exclude:

- `.codegraph/`
- `.pnpm-store/`
- executable test files and test helpers
- fixture projects outside the explicitly packaged router eval baseline
- local temporary files
- generated install output from smoke tests

## npm/npx Tarball Smoke

Before publishing, run the package smoke from the repository root:

```bash
npm run smoke:package
```

The smoke command creates a fresh temporary directory, consumes the exact filename emitted by `npm pack --json`, and removes only that temporary directory when it finishes. It never relies on a checked-in or previously generated tarball.

Expected result:

- npm installs and runs the packed `skillranger` binary without a source checkout.
- `doctor` reports run mode `compiled-binary`.
- Fixture scan and recommendation commands work through the packed package.

Expected MCP result:

- stdout contains only JSON-RPC response lines.
- `result.serverInfo.name` is `skillranger`.
- `result.serverInfo.title` is `SkillRanger`.

## Extracted Tarball Smoke

`npm run smoke:package` also extracts the newly emitted tarball and runs its compiled `doctor` entrypoint before removing the temporary smoke directory.

Expected result:

- Compiled commands run on Node `>=20.0.0` without TypeScript source execution.
- The bundled registry is found without running from the extracted package root.
- Dry-run install reports writes inside the target project only.

## MCP Smoke Checks

Run `npx -y skillranger@latest mcp`, `skillranger mcp`, `skillranger-mcp`, `node dist/mcp/server.js`, or source-run `node src/mcp/server.ts` through a stdio MCP host or newline-delimited JSON-RPC smoke client.

Required MCP coverage:

- `tools/list` returns the MVP tool set.
- `analyze_project` returns a project fingerprint.
- `recommend_skills` returns recommendations and `recommendationGroups`.
- `recommend_skills` accepts `lane` and `limitPerLane`.
- `plan_skill_install` returns dry-run writes and lockfile updates.
- `install_skill` rejects missing confirmation.
- `install_skill` rejects stale expected writes.
- `install_skill` blocks block-risk audit results without writes.
- `prepare_task` requires an explicit terminal trigger and uses only the server-fixed project root and bundled registry.
- `read_run_skill_file` delivers mandatory chunks in order, bridges the runtime read gate, and returns identical content/revision for a bound retry.
- clarification, decomposition, no-match, strict failure, and budget failure create no partial router or runtime record.
- strict prepared/read/steps/finalize reaches the strict runtime's evidence-derived terminal state.

See `docs/mcp-host-config.md` for example host config and JSON-RPC messages.

## Manual Publish Steps

Do not publish until the npm account is authenticated and the package name is still available immediately before publishing:

```bash
npm view skillranger name version description
npm login
npm publish --access public
npm view skillranger name version bin engines
npx -y skillranger@latest doctor
```

## Manual MVP Acceptance

The MVP is ready when all of these are true:

- A new user can understand the product from `README.md` and complete the 5-minute demo.
- The CLI can scan, recommend, audit, plan install, and list installed skills.
- MCP exposes the same core behavior without duplicating business logic.
- The frontend pack remains low risk and passes validation/audit gates.
- Dry-run is the default install behavior.
- Confirmed repo-local install writes only expected skill files and `skillranger.lock.json`.
- The package tarball is clean and does not include local indexes, package-manager stores, tests, fixtures, or temporary files.

## Universal Router Release Notes

- Added direct CLI `task` and `task:read` commands and explicit MCP `prepare_task` and `read_run_skill_file` tools.
- Added fixed-root MCP authorization, bundled-registry trust boundaries, privacy-safe task profiles, source snapshots, idempotent reads, and journal recovery.
- Added normal clarification continuation, decomposition, production no-match, strict requirements, and context-budget outcomes without partial runs.
- Added installed-only strict v2 preparation and lifecycle-v1 mandatory-read bridging without changing existing runtime schemas.
- Migrated the managed `AGENTS.md` block to universal explicit-activation guidance while preserving surrounding content and line endings.
- Added a 21-case shipped/synthetic router baseline and `tests/router.e2e.test.ts` coverage for lifecycle, strict, continuation, CLI/MCP, integrity, retry, and recovery flows.

## Scope Freeze

Do not block the `0.1.0` MVP on these post-MVP items:

- `backend-api` pack.
- Remote registry or marketplace.
- Signature infrastructure.
- AI-generated trusted skills.
- Dashboard UI.
- Full user-global install support.
- Full adapter coverage for every AI coding agent.

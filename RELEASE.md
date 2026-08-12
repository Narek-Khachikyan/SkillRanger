# Release Checklist

This checklist covers the current public beta. It verifies the npx/npm UX, compiled npm binaries, source-run CLI, MCP server, Universal Prompt Router, bundled registry, audit gates, frontend and router eval suites, and package hygiene before handing the beta to another user or publishing a tarball.

0.5.0 is the frontend design craft release. The package and frontend domain publish the same release identity over the six-family/18-rule contract, eight recipe packs, 80 deterministic worked-example assets, and the frozen visual benchmark pinned to `visual-benchmark-v1`.

The bundled library ships the first **core (universal) skills** — always-on, domain-agnostic behavioral guidance (`core.proportional-engineering`, `core.universal-safety`) owned by a new minimal `core` domain pack and included in every SkillRanger-prepared run (strict and non-strict, both routing modes), delivered first in router-level mandatory read order and bounded by the new `maxCoreSkills` router config (default 3). Core skills are guidance-only: they are audited and catalogued like curated skills but carry no execution contract and are excluded from the strict runtime's contract/verification machinery, so they can never make a run unverifiable. They count toward the instruction-byte budget but not the total-skill cap or the agent-context slot, are protected from eviction, and reject conflicting task skills. See ADR 0006 (`docs/adr/0006-core-owned-always-on-guidance-skills.md`).

The frontend domain pack gains a provenance-labelled craft reference layer (`domains/frontend/craft/`): type pairings, OKLCH palette recipes, macrostructures, and component cookbooks written fresh in the maintainer's own words with the observed/inferred/assumed/unknown evidence ladder. Craft references are knowledge, not rules — they never participate in the six-family rule-selection contract. `npm run bundle:craft` validates the catalog and copies it byte-identically into `registry/skills/frontend.visual-design-polish/references/craft/` at build/publish time (`prepack` and `release:check`); the install pipeline still copies the skill package verbatim with no new install-time behaviour. `release:validate` fails if the bundled copies drift from the domain pack. The reference-handling skill also gains a DNA-extraction mode with an attribute-vs-trade-dress boundary and pixel-clone refusal, surfaced through the MCP `referenceDna` argument on the frontend result validators. See ADR 0007 (`docs/adr/0007-frontend-design-craft-reference-layer.md`).

The design direction contract moves to **schemaVersion 1.1** with macrostructure and theme-axes identity fields. New directions must emit 1.1 (legacy 1.0 directions stay loadable but cannot be certified), and the deterministic identity-diversification gate compares only the certified direction's identity — resolved from the latest design-direction step attempt via `resolveCertifiedDirectionArtifact`, never a stale or unselected candidate — with the window N read from the run's optional `execution-policy` evidence (default 3) and a tooling-written `.design/diversification-log.json` awareness cache. A new `bounded-motion` hard gate (transition-all, bouncy overshoot easing) joins the browser hard gates, mechanical motion checks are `hard`, and the visual critic contract 1.1's expanded AiSlop code set stays backward-readable for 1.0 reports. Low-level MCP tools now resolve an omitted `projectRoot` to the fixed server root instead of the process working directory, keeping runs prepared via `prepare_task` reachable by the lifecycle tools.

0.4.1 is a patch release. The strict runtime now routes core evaluators through a trusted validator registry with ownership validation, moving browser hard gates, performance claims, and Tailwind source checks behind the frontend domain validator and removing the legacy validator dispatch. The router gains a pure nomination-resolution module: declared ambiguity, ordered nominations, and continuation now resolve through the same nomination decision consumed by the proposal-assisted path, with cross-domain primary nominations preserved. See ADR 0004 (`docs/adr/0004-domain-owned-strict-validators.md`).

0.4.0 is the frontend design certification release. The package and frontend domain publish the same release identity, a six-family/18-rule contract, eight recipe packs, 80 deterministic worked-example assets, and the frozen visual benchmark pinned to `visual-benchmark-v1`. Validate the shipped contract with:

```bash
npm run release:validate
```

After external benchmark execution and independent review, assemble the retained evidence into one handoff report:

```bash
node src/cli/index.ts release:certify \
  --visual-candidates /path/to/candidates.json \
  --visual-plan /path/to/plan.json \
  --visual-results /path/to/results/index.json \
  --visual-report /path/to/aggregate.json \
  --review-package /path/to/public/package.json \
  --private-mapping /restricted/path/mapping.json \
  --capability-record /restricted/path/capability.json \
  --human-review /restricted/path/review-a.json,/restricted/path/review-b.json \
  --baseline-evidence /path/to/task-evidence.json \
  --output /path/to/release-handoff.json \
  --json
```

The command retains SHA-256 file metadata and returns `promotable` only when the artifact, visual, matched three-arm baseline, and evidence-completeness gates all pass. Missing evidence, hard gates, catastrophic findings, false completion, incomplete operational evidence, preference regressions, or baseline regressions produce `not-promotable` and exit non-zero. External model execution remains outside the deterministic local release check; its immutable outputs must be supplied to this handoff.

Each candidate's safe relative `commandProfile` is resolved beside the candidate configuration, its `sha256:` digest is copied into every plan entry and run result, and the file is retained as a separate hashed evidence artifact. Certification rejects missing or changed profile digests. The certification command always uses the checked-in frozen visual and frontend eval suites; those suites are not overrideable at release time.

0.3.2 is a patch release. Visual verification now derives rendered-state and synchronization findings from persisted evidence at the final boundary instead of trusting caller-supplied checks; a `verified` synchronization must include a concrete action and at least one locator-level before/after change. The legacy synchronization shape remains readable, but it is non-certifying without causal evidence. Strict critic reports stay bound to their own screenshot attempt across bounded repairs, and MCP visual contracts publish the fields used for validation.

0.3.1 is a patch release. CLI `run:finalize` now emits the same error `details` (`userMessage`, `blockedSkills`) as the MCP surface; repeat finalization of a terminal run is a no-op instead of advancing its revision; evidence kinds named after `Object.prototype` members are ingested as plain evidence again; `verify_visual_result` publishes the container fields it dereferences and rejects deeper malformed snapshot shapes as `invalid-arguments` instead of a JSON-RPC internal error; and the fixtures `eval:router` loads at startup now ship in the package.

0.3.0 is a breaking release for host browser adapters: every capture payload must now carry `stateSynchronization` with a status, a non-empty `path`, and observed values, and a payload without it is rejected by the parser. See `docs/browser-adapter.md` and the `frontend/browser-evidence` shared contract (1.1.0).

MCP `prepare_task` now accepts `skillInputs` with `strict: true`, so strict runs are reachable from an MCP host instead of only from CLI `task --skill-inputs`. Explicit activation now also accepts a leading `@skillranger` or `/sr`; a bare leading `skillranger` stays inactive.

Server instructions and the managed `AGENTS.md` block now branch on `run.runtime`. A strict task creates a `strict-v2` run that is advanced with `begin_skill_step`, `add_skill_evidence`, `complete_skill_step`, `verify_skill`, and `finalize_skill_run`; the `lifecycle-v1` transition tools are labelled accordingly and reject a strict run. `capture_ui_evidence` publishes the required-state fields it consumes, and visual contract violations now return `invalid-arguments` or the new `capture-failed` code instead of a JSON-RPC internal error.

Lifecycle v1 now verifies real project-contained evidence files and persists byte length plus SHA-256 snapshots for new `verified` transitions.
Checksum-only skill reads are attestations and cannot produce `verified`; authoritative non-strict runs use `prepare_task` followed by complete `read_run_skill_file` delivery.
Russian routing now recognizes visual quality and responsiveness vocabulary, while Tailwind-specific routing requires project applicability evidence or explicit Tailwind intent.

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
- local agent/session metadata such as `docs/agents/`, `.workbuddy-ai/`, and `skills-lock.json`
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

Create the tag and GitHub release first, then publish to npm. The tag must point at the exact commit whose contents will be published; if in doubt, verify checksum parity between the npm tarball and the tagged tree.

From the release commit (after `release:check` passes):

```bash
git tag -a v0.5.0 -m "SkillRanger v0.5.0"
git push origin v0.5.0
gh release create v0.5.0 \
  --title "SkillRanger v0.5.0" \
  --notes-file /path/to/release-notes.md
```

Write the release notes with `Summary`, `What's changed`, and `Verification` sections in the style of the previous releases. Then do not publish until the npm account is authenticated and the package name is still available immediately before publishing:

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

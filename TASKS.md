# Tasks

This file keeps concrete implementation tasks and running status updates separate from the product/architecture spec.

## 20. Final deliverable

### Files to create first

```text
package.json
tsconfig.json
src/cli/index.ts
src/scanner/index.ts
src/registry/index.ts
src/recommender/index.ts
src/audit/index.ts
src/installers/types.ts
src/installers/codex.ts
src/lockfile/index.ts
schemas/registry.schema.json
schemas/fingerprint.schema.json
schemas/lockfile.schema.json
registry/skills/frontend.next-react-review/SKILL.md
registry/skills/frontend.next-react-review/skill.manifest.json
fixtures/next-react-ts/
tests/scanner.test.ts
tests/recommender.test.ts
tests/audit.test.ts
docs/threat-model.md
```

### Milestone на 1-2 дня

Goal:

- working scan + hardcoded local registry + deterministic recommendations.

Tasks:

- scaffold TS project;
- implement `scan`;
- define fingerprint schema;
- create one Next.js fixture;
- create 3 curated skill manifests;
- implement scoring;
- print recommendation explanations.

Done when:

- `skillranger scan fixtures/next-react-ts` prints correct stack;
- `skillranger recommend fixtures/next-react-ts --target codex` returns expected ranked list.

### Milestone на 1 неделю

Goal:

- useful Codex-first MVP.

Tasks:

- implement Codex installer dry-run/apply;
- write `.agents/skills/<skill>/SKILL.md`;
- create lockfile;
- add audit checks;
- add 5-8 curated frontend skills;
- add fixture tests;
- add `doctor`;
- add initial MCP server with read-only tools.

Done when:

- user can install a low-risk skill into a repo;
- lockfile pins checksum;
- malicious skill fixture is blocked;
- Codex can call `analyze_project` and `recommend_skills`.

### 10 concrete tasks for AI coding agent

1. Scaffold TypeScript CLI project with `pnpm`, `tsup`, `vitest`.
2. Define Zod schemas for fingerprint, registry entry, lockfile, audit report.
3. Implement package manager and framework detection from `package.json`.
4. Implement config/folder detection for Next.js, Vite, Tailwind, tests, AGENTS.md.
5. Create fixture `next-react-ts` with minimal realistic files.
6. Create local registry loader and 5 curated frontend skill manifests.
7. Implement ranking formula and explanation output.
8. Implement Codex installer dry-run and apply for repo scope.
9. Implement audit scanner for hidden files, binaries, suspicious commands, checksum.
10. Add Vitest golden tests for scanner, recommender, audit, installer.

### 10 research-backed follow-up tasks

1. Wire runtime registry schema validation into `loadLocalRegistry`.
2. Add `validate:registry`, `lint:skills`, `audit:registry`, and `publish:check` scripts.
3. Add frontmatter parser and enforce `SKILL.md`/manifest consistency.
4. Harden installer slug generation and path containment.
5. Add tests that block path traversal, unsupported targets, invalid scopes and block-risk installs.
6. Add registry-level hygiene audit for hidden files, `.DS_Store`, duplicate ids/names and unexpected top-level files.
7. Expand security fixture matrix for symlinks, binaries, `.env`, `.ssh`, persistence, dependency installs and prompt-injection references.
8. Convert current curated `SKILL.md` files from short checklists into playbooks with decision rules, workflow, references map and output contract.
9. Add detailed quality rubric metadata while keeping flat `qualityScore` and `securityScore` for backward compatibility.
10. Replace plain `supportedAgents` with a compatibility matrix over time, while keeping adapter-specific install behavior isolated.

Implementation update 2026-07-05:

- Done: runtime manifest validation is wired into `loadLocalRegistry`.
- Done: `validate:registry`, `lint:skills`, `audit:registry`, and `publish:check` scripts are available.
- Done: installer slug generation now rejects empty/traversal-like names and checks path containment.
- Verified: `npm run check`, `npm test`, `npm run validate:registry`, and `npm run audit:registry` pass.
- Next recommended task: add frontmatter parser and enforce `SKILL.md`/manifest consistency.

Implementation update 2026-07-05:

- Done: `SKILL.md` frontmatter parser is wired into registry validation.
- Done: frontmatter `name` must match manifest `name`.
- Done: frontmatter `description` must describe the same intent as manifest `description`.
- Verified: `npm run check`, `pnpm test`, `npm run validate:registry`, and `npm run publish:check` pass.
- Next recommended task: add registry-level hygiene audit for hidden files, `.DS_Store`, duplicate ids/names and unexpected top-level files.

Implementation update 2026-07-05:

- Done: registry-level hygiene audit rejects hidden files, `.DS_Store`, non-directory entries under `registry/skills`, missing package files, unexpected skill package top-level entries, duplicate ids and duplicate names.
- Done: existing `.DS_Store` files were removed from `registry/` and `registry/skills/`.
- Verified: `npm run check`, `pnpm test`, `npm run validate:registry`, and `npm run publish:check` pass.
- Next recommended task: expand security fixture matrix for symlinks, binaries, `.env`, `.ssh`, persistence, dependency installs and prompt-injection references.

Implementation update 2026-07-05:

- Done: audit blocks symlink packages without following the symlink target.
- Done: audit matrix covers binary files, `.env`, `.ssh`, persistence mechanisms, dependency install instructions, prompt-injection references, declared scripts and network permissions.
- Done: threat model and README document the expanded audit coverage.
- Verified: `npm run check`, `pnpm test`, and `npm run publish:check` pass.
- Next recommended task: add tests for unsupported targets, invalid scopes and block-risk installs.

Implementation update 2026-07-05:

- Done: installer tests cover unsupported target agents.
- Done: installer tests cover unsupported `user` scope.
- Done: installer tests verify block-risk installs fail before writing skill files or lockfile entries.
- Verified: `npm run check`, `pnpm test`, and `npm run publish:check` pass.
- Next recommended task: convert current curated `SKILL.md` files from short checklists into playbooks with decision rules, workflow, references map and output contract.

Implementation update 2026-07-05:

- Done: all 5 curated frontend `SKILL.md` files now use playbook structure with decision rules, workflow, references, validation and output contract.
- Done: skills remain instruction-only with no scripts, dependencies, network access or shell access.
- Verified: `npm run check`, `pnpm test`, `npm run validate:registry`, and `npm run publish:check` pass.
- Next recommended task: add detailed quality rubric metadata while keeping flat `qualityScore` and `securityScore` for backward compatibility.

Implementation update 2026-07-05:

- Done: `quality.rubricVersion` and `quality.scores.*` metadata were added to all curated skill manifests.
- Done: runtime validation accepts rubric metadata as backward-compatible optional fields, while curated skills now carry it.
- Done: `qualityScore` is validated as the derived average of usefulness, trigger specificity, progressive disclosure, verifiability, maintainability and portability; `safety` stays present in rubric metadata while `securityScore` remains a separate audit/safety score.
- Done: registry schema documents the quality rubric shape.
- Verified: `npm run check`, `pnpm test`, `npm run validate:registry`, and `npm run publish:check` pass.
- Next recommended task: replace plain `supportedAgents` with a compatibility matrix over time, while keeping adapter-specific install behavior isolated.

Implementation update 2026-07-05:

- Done: optional `compatibility` matrix metadata is supported in manifest types, runtime validation and schema.
- Done: all curated manifests include native compatibility entries for `codex` and `generic-agent-skills`.
- Done: recommender uses the compatibility matrix when present and falls back to `supportedAgents` for backward compatibility.
- Done: validation rejects `supportedAgents` entries that do not have native compatibility metadata.
- Verified: `npm run check`, `pnpm test`, `npm run validate:registry`, and `npm run publish:check` pass.
- Next recommended task: start the next vertical slice, likely read-only MCP tools (`analyze_project`, `recommend_skills`, `audit_skill`, `list_installed_skills`) or richer install/update lockfile behavior.

Implementation update 2026-07-05:

- Done: existing `skillranger.lock.json` files are now validated when read; missing lockfiles still return an empty installed set.
- Done: CLI exposes `installed` / `list-installed` to inspect repo lockfile entries in human-readable or JSON form.
- Done: lockfile tests cover empty lockfiles, malformed lockfiles and the installed-list CLI JSON path.
- Verified: `npm run check`, `npm test`, `node src/cli/index.ts installed fixtures/next-react-ts`, and `node src/cli/index.ts install frontend.next-react-review --project fixtures/next-react-ts --dry-run --json` pass.
- Next recommended task: implement read-only MCP tools (`analyze_project`, `recommend_skills`, `audit_skill`, `list_installed_skills`) over the existing scanner, recommender, auditor and lockfile modules.

Implementation update 2026-07-05:

- Done: read-only MCP stdio server is available at `src/mcp/server.ts` and package script `npm run mcp`.
- Done: MCP `initialize`, `tools/list` and `tools/call` are implemented without adding runtime dependencies.
- Done: MCP exposes `analyze_project`, `recommend_skills`, `audit_skill` and `list_installed_skills` over the existing core modules.
- Done: MCP tool handler tests cover project analysis, recommendations, audit reports and installed lockfile entries.
- Verified: `npm run check`, `npm test`, and stdio JSON-RPC smoke tests for `tools/list` and `tools/call` pass.
- Next recommended task: add MCP server documentation/config examples for Codex/Claude-style hosts, then consider write-capable MCP install planning as a separate gated tool.

Implementation update 2026-07-05:

- Done: `docs/mcp-host-config.md` documents a generic stdio MCP host entry and JSON-RPC smoke test.
- Done: MCP exposes `plan_skill_install`, a dry-run-only installer planning tool that reports intended writes and lockfile updates without writing files.
- Done: MCP tests cover `plan_skill_install` output.
- Verified: `npm run check`, `npm test`, `npm run validate:registry`, and `npm run publish:check` pass.
- Next recommended task: add a gated write-capable MCP install tool only after defining explicit confirmation semantics, idempotency behavior and audit failure reporting.

Implementation update 2026-07-05:

- Done: MCP exposes gated write-capable `install_skill`.
- Done: `install_skill` requires `confirm: true`, exact `expectedWrites`, and exact `expectedLockfileUpdates` from a current `plan_skill_install` response.
- Done: stale plan paths are rejected before any write.
- Done: block-risk audit results return structured `isError: true` with `reason: audit-blocked` and do not write files or lockfile entries.
- Done: successful installs reuse the existing adapter and upsert lockfile behavior, making repeat installs idempotent for the same skill, target agent and scope.
- Verified: `npm run check`, `npm test`, `npm run validate:registry`, `npm run publish:check`, and a stdio JSON-RPC `install_skill` smoke test pass.
- Next recommended task: add explicit lockfile/schema validation for install idempotency and consider richer MCP error codes once the protocol wrapper grows beyond the minimal stdio implementation.

Implementation update 2026-07-05:

- Done: lockfile runtime validation now checks safe skill/agent ids, sha256 checksum shape, relative non-traversing installed/source paths, source fields, audit risk/security fields and audit finding fields.
- Done: lockfile runtime validation rejects duplicate installed entries for the same `skillId`, `targetAgent` and `scope`.
- Done: `writeLockfile` validates before writing, so invalid in-memory lockfile updates fail early.
- Done: installer tests verify repeat installs upsert into a single lockfile entry.
- Done: `schemas/lockfile.schema.json` now mirrors the stricter field-level shape and documents runtime compound uniqueness.
- Next recommended task: add richer MCP error result taxonomy/codes so hosts can distinguish confirmation-required, stale-plan, audit-blocked and unsupported-target failures without parsing message text.

Implementation update 2026-07-05:

- Done: MCP tool-level expected failures now return `isError: true`, `ok: false`, and stable `code` values.
- Done: `install_skill` returns `confirmation-required`, `stale-plan` and `audit-blocked` codes.
- Done: planning/install adapter failures for unsupported targets return `unsupported-target`.
- Done: validation helpers return `invalid-arguments`, missing registry skills return `skill-not-found`, and unknown tool names return `unknown-tool`.
- Done: unexpected implementation failures remain JSON-RPC internal errors with `internal-error` data.
- Done: `docs/mcp-host-config.md` documents the tool error taxonomy for hosts.
- Next recommended task: split MCP tool handlers into smaller modules if the tool surface grows, or add a lightweight protocol test harness for JSON-RPC request/response behavior.

Implementation update 2026-07-05:

- Done: MCP JSON-RPC request handling moved into `src/mcp/protocol.ts`.
- Done: stdio server is now a thin newline transport wrapper around `handleJsonRpcLine`.
- Done: protocol tests cover initialize, notification ignoring, tools/list, tool-level error result shape, invalid tools/call params and malformed JSON parse errors.
- Done: `npm run check` now syntax-checks the protocol module.
- Next recommended task: split growing MCP tool handlers into domain modules (`project`, `registry`, `install`) if more tools are added.

Implementation update 2026-07-05:

- Done: MCP tool definitions and handlers were split into `src/mcp/tools/project.ts`, `src/mcp/tools/registry.ts`, and `src/mcp/tools/install.ts` with shared types/utilities under `src/mcp/tools/`.
- Done: `src/mcp/tools.ts` remains a stable aggregator for existing protocol/tests imports.
- Done: `npm run check` now syntax-checks the MCP aggregator and split tool modules.
- Done: the curated frontend pack now includes 8 roadmap skills by adding `frontend.performance-review`, `frontend.testing-strategy`, and `frontend.agents-md-bootstrap`.
- Done: the new skills use playbook structure, quality rubric metadata, native compatibility matrix entries, and low-risk instruction-only permissions.
- Verified: `npm run check`, `npm test`, `npm run validate:registry`, `npm run audit:registry`, and `npm run publish:check` pass.
- Next recommended task: add richer recommendation fixtures/intent tests for the expanded frontend pack, or start the first post-MVP `backend-api` pack after choosing scope.

Implementation update 2026-07-05:

- Done: used the local `.codegraph/codegraph.db` symbol/call graph to inspect `recommendSkills` dependencies and public call sites before changing recommender behavior.
- Done: recommender intent scoring now favors identity/task-specific matches, so specialized skills win for intents like performance, Playwright debugging, testing strategy, and AGENTS.md guidance instead of the broad Next.js review skill dominating all topical queries.
- Done: recommender now filters skills that are incompatible with the requested target agent rather than returning high-scoring but unsupported recommendations.
- Done: recommender golden tests cover the full 8-skill frontend MVP pack, specialized intent promotion, and unsupported target filtering.
- Verified: `node --test tests/recommender.test.ts`, `npm run check`, `npm test`, `npm run validate:registry`, `npm run publish:check`, and project diagnostics pass.
- Next recommended task: choose between starting the first `backend-api` pack or adding additional fixture projects such as `vite-react-ts`/`backend-node` to exercise scanner and recommender behavior across non-Next stacks.

Implementation update 2026-07-05:

- Done: reviewed MVP status against `PLAN.md`, `ROADMAP.md`, current fixtures, registry contents, CodeGraph, and the test suite.
- Verified: `npm run check`, `npm test`, `npm run validate:registry`, and `npm run publish:check` pass with 8 registry skills and 54 tests.
- Observed: current broad project coverage is still mostly one happy-path fixture, `fixtures/next-react-ts`, plus malicious skill fixtures for audit behavior.
- Observed: npm prints a warning for `.npmrc` option `verify-deps-before-run`; it does not fail checks, but it makes MVP validation output noisier.
- Next recommended task: before broader MVP testing, add `fixtures/vite-react-ts` and `fixtures/backend-node` with scanner/recommender golden tests, then run CLI and MCP smoke checks across all fixtures.
- Defer: the first `backend-api` skill pack should wait until the fixture matrix proves the current scanner/recommender behavior outside Next.js.

Implementation update 2026-07-05:

- Done: added `fixtures/vite-react-ts` with npm lockfile, Vite config, TypeScript config, and minimal React source files.
- Done: added `fixtures/backend-node` with npm lockfile, TypeScript config, Express server source, and Dockerfile.
- Done: scanner tests now cover Next.js React TypeScript, Vite React TypeScript, and backend Node fixtures.
- Done: recommender tests now verify Vite React projects do not receive the Next-specific or Playwright-specific frontend skills, and backend Node projects do not receive the frontend pack.
- Done: recommender relevance filtering now requires stack overlap and suppresses framework/tool-specific skills when the project lacks required tags such as `nextjs`, `react`, `tailwind`, or `playwright`.
- Done: removed the `.npmrc` option that caused npm to warn about `verify-deps-before-run`.
- Verified: `npm run check`, `npm test`, `npm run validate:registry`, `npm run publish:check`, CLI fixture smoke checks, and MCP `tools/list`/`tools/call` smoke checks pass.
- Current test count: 58 passing tests.
- Next recommended task: begin hands-on MVP testing through CLI and MCP host configuration before adding the first post-MVP `backend-api` pack.

Implementation update 2026-07-05:

- Done: tested SkillRanger against real project `/Users/narek_khachikyan/Desktop/PersonalProjects/AnimeBounty-Info`.
- Observed: scanner correctly detects npm, Vite, React, Tailwind, Playwright e2e, JavaScript, existing `AGENTS.md`, and no repo-local Codex/generic skills.
- Done: scanner now tags Playwright projects as both `playwright` and generic `testing`, so testing-focused skills receive accurate evidence.
- Done: recommender now suppresses `frontend.agents-md-bootstrap` when the target project already has `AGENTS.md`.
- Observed: real-project recommendations now rank `frontend.playwright-debug`, `frontend.tailwind-ui-polish`, and `frontend.testing-strategy` highest for AnimeBounty-Info.
- Verified: CLI `scan`, `recommend`, `installed`, dry-run `install`, and MCP `analyze_project`/`recommend_skills`/`plan_skill_install` smoke checks pass against AnimeBounty-Info.
- Verified: `npm run check`, `npm test`, `npm run validate:registry`, and `npm run publish:check` pass.
- Current test count: 59 passing tests.
- Next recommended task: perform an approved repo-local install into a disposable branch/worktree or continue smoke testing against one more real project before adding the first post-MVP pack.

Implementation update 2026-07-05:

- Decided: near-term product focus moves from router mechanics to frontend skill quality and third-party sourcing.
- Done: added `docs/FRONTEND_SKILL_QUALITY.md` with quality bar, `skills.sh` sourcing shortlist, import policy, frontend upgrade order, eval set, and next concrete task.
- Observed from `skills.sh`: strong frontend candidates include Vercel React/Next best practices and composition patterns, Anthropic frontend design and webapp testing, shadcn, Vercel web design guidelines, design-system extraction, and design critique/polish skills.
- Policy: third-party skills should be discovered and staged, not blindly installed; they must pass local audit, provenance review, compatibility mapping, and fixture/real-project eval before becoming curated.
- Next recommended task: upgrade `frontend.playwright-debug` first, using AnimeBounty-Info as the real-project eval target.

Implementation update 2026-07-05:

- Done: ran an 18-track sub-agent research pass on frontend skill best practices, with extra weight on design.
- Done: created `docs/FRONTEND_SKILL_RESEARCH_2026-07-05.md` as the synthesized research report.
- Findings: frontend skill quality should be measured by narrow activation, progressive disclosure, evidence-first workflow, visual QA, accessibility, performance, project fit, and before/after eval deltas.
- Findings: design must become first-class through distinct lanes for visual design polish, UX critique, design systems, design-to-code, responsive layout, accessibility, and interaction polish.
- Findings: the current frontend pack should become layered lanes, not eight peer checklists; add lane/mode metadata later so the recommender can route specialists instead of returning flat frontend matches.
- Findings: third-party skills from `skills.sh` should be quarantined, pinned, audited, provenance-reviewed, and evaluated before curation.
- Next recommended task: build the frontend skill eval harness and then upgrade `frontend.playwright-debug` as the first measured skill improvement.

Implementation update 2026-07-05:

- Done: added the first frontend skill eval harness with `evals/frontend/suite.json`, `src/evals/frontend.ts`, CLI command `eval:frontend`, npm script `eval:frontend`, and tests.
- Done: seeded the frontend eval suite with 18 trigger prompts, 4 task bands, scoring weights, and promotion gates toward target coverage of 80 trigger prompts and 40 task evals.
- Done: upgraded `frontend.playwright-debug` from a checklist into a trace-first Playwright debugging playbook covering artifacts, actionability, locators, route-aware waits, fixtures, retries, CI causes, validation, and output contract.
- Done: raised `frontend.playwright-debug` quality metadata to `0.89`, which correctly moves it higher in the Next.js + Playwright recommendation order.
- Verified: `npm run check`, `npm test`, `npm run validate:registry`, `npm run publish:check`, and `node src/cli/index.ts eval:frontend --json` pass.
- Current test count: 62 passing tests.
- Next recommended task: expand the eval suite toward the 80/40 target, then upgrade the design-heavy frontend lane (`visual design polish` / `tailwind UI polish`) with screenshot-based QA expectations.

Implementation update 2026-07-05:

- Done: expanded the frontend eval suite from 18 to 44 trigger prompts and from 4 to 12 seeded task evals while keeping the target at 80 trigger prompts and 40 task evals.
- Done: added stronger design-heavy eval coverage for Tailwind polish, screenshot QA, token drift, responsive density, visual design fit, interaction polish, design-system extraction, design-to-code, UX critique, empty/error states, and before/after visual review.
- Done: upgraded `frontend.tailwind-ui-polish` into a screenshot-driven visual QA and Tailwind implementation playbook covering design thesis, responsive robustness, hierarchy, state styling, accessibility, token consistency, anti-generic design, and output contract.
- Done: raised `frontend.tailwind-ui-polish` quality metadata from `0.80` to `0.87`; it now ranks just after Next and Playwright in the Next.js + Tailwind + Playwright fixture without displacing the Next-specific default skill.
- Verified: `npm run check`, `npm test`, `npm run validate:registry`, `npm run publish:check`, `node src/cli/index.ts eval:frontend`, and `node src/cli/index.ts recommend fixtures/next-react-ts --json` pass.
- Current test count: 62 passing tests.
- Next recommended task: add the missing design specialist manifests/skills (`frontend.visual-design-polish`, `frontend.design-system`, `frontend.design-to-code`, `frontend.ux-critique`, `frontend.interaction-polish`) or first split `frontend.tailwind-ui-polish` so Tailwind correctness and visual taste are separate lanes.

Implementation update 2026-07-05:

- Done: added 5 new low-risk, instruction-only design specialist skills: `frontend.visual-design-polish`, `frontend.design-system`, `frontend.design-to-code`, `frontend.ux-critique`, and `frontend.interaction-polish`.
- Done: each new skill includes a focused trigger description, decision rules, workflow, validation section, output contract, quality rubric metadata, freshness metadata, and native compatibility entries for `codex` and `generic-agent-skills`.
- Done: recommender tests now cover the expanded 13-skill frontend pack and intent routing for visual design polish, design system tokens, design-to-code screenshots, UX critique, and interaction polish.
- Observed: in the Next.js + Tailwind + Playwright fixture, the default top skills remain `frontend.next-react-review`, `frontend.playwright-debug`, `frontend.tailwind-ui-polish`, and `frontend.visual-design-polish`, while specific user intent promotes the matching design specialist.
- Verified: `npm run check`, `npm test`, `npm run validate:registry`, `npm run publish:check`, `node src/cli/index.ts eval:frontend`, and `node src/cli/index.ts recommend fixtures/next-react-ts --json` pass.
- Current registry count: 13 curated skills.
- Current test count: 62 passing tests.
- Next recommended task: add lane/category metadata to manifests and recommender output so the UI/CLI can group framework, design, implementation, QA, and agent-context recommendations instead of presenting one flat list.

Implementation update 2026-07-05:

- Done: added optional manifest `routing` metadata with `lane` and `category`.
- Done: all 13 curated skills now carry routing metadata across `framework`, `design`, `implementation`, `qa`, and `agent-context` lanes.
- Done: registry validation and `schemas/registry.schema.json` validate routing lane/category shape.
- Done: recommendation items now include `lane` and `category`; CLI JSON and MCP `recommend_skills` also return `recommendationGroups`.
- Done: human-readable `skillranger recommend` output is grouped by lane instead of one flat list.
- Done: tests cover curated routing metadata, recommendation item lane/category fields, grouped recommendation output, and MCP grouped recommendation output.
- Verified: `npm run check`, `npm test`, `npm run validate:registry`, `npm run publish:check`, `node src/cli/index.ts eval:frontend`, `node src/cli/index.ts recommend fixtures/next-react-ts`, and `node src/cli/index.ts recommend fixtures/next-react-ts --json` pass.
- Current registry count: 13 curated skills.
- Current test count: 63 passing tests.
- Next recommended task: use the lane metadata to add per-lane recommendation limits or a `--lane design` filter, so design-heavy workflows can request only visual/design-system/interaction specialists without noise from framework and QA skills.

Implementation update 2026-07-05:

- Done: verified lane-filtered recommendations through the recommender, CLI, and MCP surfaces.
- Done: `skillranger recommend --lane design` returns only design-lane recommendations and one design recommendation group.
- Done: `recommend_skills` accepts `lane` and `limitPerLane`; invalid MCP lane input returns the structured `invalid-arguments` tool error.
- Done: tests now cover recommender lane filtering, per-lane limiting, CLI `--lane`, CLI invalid lane handling, and MCP design-lane filtering.
- Verified: `npm run check`, `npm test`, `npm run validate:registry`, `npm run publish:check`, `node src/cli/index.ts eval:frontend`, `node src/cli/index.ts recommend fixtures/next-react-ts --lane design`, and `node src/cli/index.ts recommend fixtures/next-react-ts --lane design --json` pass.
- Current registry count: 13 curated skills.
- Current test count: 72 passing tests.
- Next recommended task: update user-facing CLI/MCP documentation for lane filters and per-lane limits, then continue expanding the frontend eval suite toward the 80 trigger / 40 task target.

Implementation update 2026-07-05:

- Done: documented CLI recommendation lane controls in `README.md`, including `--lane` and `--limit-per-lane` usage.
- Done: documented MCP `recommend_skills` lane arguments in `docs/mcp-host-config.md`, including allowed lane values, `limitPerLane`, examples, and grouped rendering guidance.
- Done: updated `docs/ARCHITECTURE.md` to describe lane-aware recommendation metadata, MCP input/output shape, and first-run CLI UX with design-lane limiting.
- Verified: `npm run check`, `node src/cli/index.ts recommend fixtures/next-react-ts --target codex --lane design --limit-per-lane 2`, and `node src/cli/index.ts recommend fixtures/next-react-ts --target codex --lane design --limit-per-lane 2 --json` pass.
- Next recommended task: continue expanding the frontend eval suite toward the 80 trigger / 40 task target.

### Questions to resolve before coding

- Resolved: package name is `skillranger` and public product name is `SkillRanger`.
- Should MVP default install scope be repo-local or user-global? Recommendation: repo-local.
- Should the MVP support only Codex, or Codex + generic `.agents/skills`? Recommendation: Codex + generic baseline.
- Should registry be JSON or SQLite? Recommendation: JSON for MVP.
- Should remote registry exist in MVP? Recommendation: no.
- Should generated skills be in MVP? Recommendation: no, only design the folder/schema.
- What is the minimum quality rubric for curated skills?
- What exact risk threshold blocks install?
- Should `install` always start with dry-run? Recommendation: yes for third-party and medium/high risk.
- Should skills be copied or symlinked? Recommendation: copy for reproducible lockfile behavior.

## Short recommendation

This project is worth building, but only if the MVP stays narrow.

Start with:

- local TypeScript CLI;
- Next.js/React/TypeScript scanner;
- 5-8 curated frontend skills;
- Codex repo-local installer;
- audit + lockfile;
- basic MCP tools for analyze/recommend.

This starting point is just the first vertical slice. The product vision is broader: one router for all known agent workflow directions, with domain packs added over time through the same registry, audit, ranking, and adapter system.

Do not start with marketplace, AI generation, all agents, remote installs, or every domain pack at once. The first win should be simple: open a repo, run one command, get better agent workflows installed safely.

# SkillRanger

SkillRanger is a local-first CLI and MCP server for attaching the right AI agent workflows to a repository without blind installs.

It scans a project, builds a deterministic stack fingerprint, recommends compatible skill packages from a local curated registry, audits packages for basic safety issues, and plans or applies repo-local installs for Codex-compatible and generic agent skill layouts.

## MVP Scope

This `0.1.0` MVP is intentionally narrow:

- Compiled npm CLI binaries plus explicit TypeScript source-run mode for checkout development.
- Local bundled JSON/file registry.
- Frontend-focused curated skill pack.
- Deterministic scanner for common JavaScript/TypeScript web signals.
- Lane-aware recommendations for framework, design, implementation, QA, and agent-context workflows.
- Static skill audit and registry validation.
- Repo-local Codex/generic skill install planning and confirmed apply.
- Lockfile tracking in `skillranger.lock.json`.
- MCP stdio server exposing scan, recommend, audit, list, plan, and gated install tools.
- Generic domain-pack registration with frontend as the reference domain.
- Structured design briefs, product recipes, deterministic verification, bounded repair requests, and repeated A/B/C eval slices.

Not in this MVP: public marketplace, remote registry sync, signature infrastructure, generated trusted skills, dashboard UI, user-global installs, or every agent adapter.

## Requirements

- Node.js `>=20.0.0` for npm-installed compiled binaries.
- Node.js `>=23.6.0` for direct TypeScript source-run mode from a checkout.
- No runtime npm dependencies are required by the MVP package.
- npm-installed usage runs compiled JavaScript from `dist/` through the `skillranger` and `skillranger-mcp` binaries.
- Source-run usage runs TypeScript entrypoints directly with `node src/cli/index.ts ...` and is intended for a source checkout or extracted source tarball.

## Quick Start

Use the public package without cloning the repo:

```bash
npx -y skillranger@latest doctor
npx -y skillranger@latest scan .
npx -y skillranger@latest recommend . --target codex
npx -y skillranger@latest install frontend.next-app-router-review --project . --target codex --scope repo --dry-run
```

For repeated use, install the compiled CLI globally:

```bash
npm install -g skillranger
skillranger doctor
skillranger scan .
skillranger setup
```

`skillranger setup` is the easiest interactive path from a target project. It scans the current directory, selects all recommended skills by default, lets you deselect skills with Space, then asks for final confirmation before writing repo-local skill files.

From a global install or after `npm run build` in a checkout:

```bash
skillranger scan fixtures/next-react-ts
skillranger recommend fixtures/next-react-ts --target codex
skillranger install frontend.next-app-router-review --project fixtures/next-react-ts --target codex --scope repo --dry-run
```

Source-run equivalent from a checkout requires Node.js `>=23.6.0` for direct `.ts` execution:

```bash
node src/cli/index.ts scan fixtures/next-react-ts
node src/cli/index.ts recommend fixtures/next-react-ts --target codex
node src/cli/index.ts install frontend.next-app-router-review --project fixtures/next-react-ts --target codex --scope repo --dry-run
```

The default skill registry is bundled with the source tree. Use MCP or CLI `registryRoot` options only when testing an alternate local registry.

## 5-Minute Demo

Run the full safe path against the included Next.js fixture:

```bash
skillranger scan fixtures/next-react-ts
skillranger recommend fixtures/next-react-ts --target codex
skillranger recommend fixtures/next-react-ts --target codex --lane design --limit-per-lane 2
skillranger audit frontend.next-app-router-review
skillranger install frontend.next-app-router-review --project fixtures/next-react-ts --target codex --scope repo --dry-run
skillranger installed fixtures/next-react-ts
```

To apply an install after reviewing the dry-run writes, add `--yes`:

```bash
skillranger install frontend.next-app-router-review --project fixtures/next-react-ts --target codex --scope repo --yes
```

Confirmed installs copy skill files into `.agents/skills/<skill>/` and update `skillranger.lock.json` in the target project.

## CLI Commands

```bash
skillranger scan [project] [--json]
skillranger recommend [project] [--target codex] [--intent "..."] [--capabilities browser,screenshots] [--lane <lane>] [--limit-per-lane <n>] [--explain] [--json]
skillranger setup [project] [--target codex] [--intent "..."] [--scope repo] [--lane <lane>] [--limit-per-lane <n>]
skillranger audit <skill-id> [--json]
skillranger validate:registry [--json]
skillranger lint:skills [--json]
skillranger audit:registry [--json]
skillranger publish:check [--json]
skillranger eval:frontend [--suite <path>] [--json]
skillranger eval:frontend --run-routing --project <path> [--target codex] [--suite <path>] [--json]
skillranger eval:frontend --verify-task-evidence <path> [--suite <path>] [--json]
skillranger eval:frontend --verify-pairwise-review <path> [--suite <path>] [--json]
skillranger domain:list [--json]
skillranger domain:inspect frontend [--json]
skillranger design:brief [project] --domain <domain> --user <actor> --task <task> --surface <type> --action <action> [--output .design/brief.json] [--json]
skillranger design:recommend-recipe --brief .design/brief.json [--json]
skillranger design:observe --brief .design/brief.json --base-url <url> --command <adapter> [--route </path>] [--output .design/observations.json] [--json]
skillranger design:validate --brief .design/brief.json [--direction .design/direction.json] [--json]
skillranger design:validate-source [project] --files <paths> [--semantic-tokens] [--json]
skillranger design:verify --brief .design/brief.json --direction .design/direction.json --observations observations.json --capabilities browser,screenshots [--json]
skillranger design:repair --report .design/verification.json [--max-iterations 3] [--json]
skillranger design:compile --brief .design/brief.json --direction .design/direction.json [--report .design/verification.json] [--output .design/DESIGN.md]
skillranger install <skill-id> --project <path> [--target codex] [--scope repo] [--dry-run] [--yes]
skillranger installed [project] [--project <path>] [--json]
skillranger mcp
skillranger doctor
```

For source-run mode, replace `skillranger` with `node src/cli/index.ts` and `skillranger mcp` with `node src/mcp/server.ts`.

Recommendation lanes:

- `framework`
- `design`
- `implementation`
- `qa`
- `agent-context`

Use `--lane` when the user intent is specific, for example design-only review. With `--intent`, SkillRanger returns one primary skill and up to two compatible companions rather than an overlapping full pack. Use `--capabilities browser,screenshots` to mark visual work as ready for verification; without them, visual recommendations remain available but are explicitly `unverified`. `setup --yes` requires `--intent` for the same reason. Use `--limit-per-lane` to keep catalog output balanced and `--explain` to print score drivers; JSON and MCP recommendation output include `scoreBreakdown` and `verification` for each skill.

## Curated Skills

The bundled frontend registry currently includes 15 low-risk, instruction-only skills, including:

- `frontend.next-app-router-review`
- `frontend.react-app-review`
- `frontend.accessibility-review`
- `frontend.tailwind-ui-polish`
- `frontend.playwright-debug`
- `frontend.react-component-design`
- `frontend.performance-review`
- `frontend.testing-strategy`
- `frontend.agents-md-bootstrap`
- `frontend.visual-design-polish`
- `frontend.design-system`
- `frontend.design-to-code`
- `frontend.ux-critique`
- `frontend.interaction-polish`
- `frontend.audit`

Every curated manifest is validated for package shape, frontmatter consistency, checksums, compatibility metadata, routing metadata, quality rubric drift, and low-risk audit status.

## MCP Server

Start the stdio MCP server through npx:

```bash
npx -y skillranger@latest mcp
```

Global installs can use either CLI entrypoint:

```bash
skillranger mcp
skillranger-mcp
```

MVP tools:

- `analyze_project`
- `recommend_skills`
- `audit_skill`
- `list_installed_skills`
- `plan_skill_install`
- `install_skill`
- `list_domains`
- `inspect_domain`
- `create_frontend_design_brief`
- `recommend_frontend_recipe`
- `validate_frontend_result`
- `compile_frontend_design_spec`
- `verify_frontend_result`
- `repair_frontend_result`
- `run_domain_eval`

`install_skill` is write-capable and gated. It requires `confirm: true`, plus exact `expectedWrites` and `expectedLockfileUpdates` copied from a fresh `plan_skill_install` result. See `docs/mcp-host-config.md` for host configuration and JSON-RPC smoke examples.

## Safety Model

The MVP is local-first and conservative:

- Registry packages are local files, not remote downloads.
- Installs default to dry-run unless `--yes` is provided.
- Skill writes are constrained to repo-local target paths.
- Lockfiles pin version, checksum, target, scope, installed path, source, and audit result.
- Audit rejects or flags symlinks, binaries, hidden files, `.env`, `.ssh`, persistence mechanisms, dependency install instructions, prompt-injection references, risky permissions, and dangerous shell patterns.

See `docs/SECURITY.md` and `docs/threat-model.md` for the expanded model.

## Development Checks

```bash
npm run build
npm run check
npm test
npm run validate:registry
npm run lint:skills
npm run audit:registry
npm run publish:check
npm run eval:frontend
node src/cli/index.ts eval:frontend --run-routing --project fixtures/next-react-ts --json
npm run release:check
```

See `RELEASE.md` for the full MVP release checklist.

## Project Docs

- `docs/ARCHITECTURE.md`: core modules, scanner, recommender, CLI/MCP, installers, lockfile.
- `docs/REGISTRY.md`: registry and skill package model.
- `docs/SECURITY.md`: security model and audit controls.
- `docs/TESTING.md`: fixture, golden, install, and audit testing strategy.
- `docs/mcp-host-config.md`: MCP host config and smoke tests.
- `RELEASE.md`: release validation checklist for npm binary and source-run usage.

# SkillRanger

> Find, audit, and install the right AI agent skills for your codebase.

**Public MVP / Beta** · Local-first · CLI + MCP · Zero runtime dependencies

SkillRanger scans your repository, detects its stack and development context, recommends compatible skills, audits them for common risks, and produces reviewable install plans before an explicit apply.

## Why SkillRanger?

AI coding agents become more useful when they have focused, task-specific workflows. Finding compatible skills, understanding why they fit, and reviewing what they will write should not require blind installation.

SkillRanger turns repository evidence into deterministic, explainable recommendations. Frontend is the first available domain pack; the scanner, recommender, auditor, installer, lockfile, and evaluation pipeline are designed to support more software-engineering domains over time.

## Quick Start

Run the public package from the repository you want to configure:

```bash
npx -y skillranger@latest doctor
npx -y skillranger@latest setup
```

`setup` scans the current directory, prompts you to choose one or more target agents and repo or user scope, recommends a set of skills selected by default, lets you deselect any item with Space, and asks for final confirmation before writing.

If you select Codex and repo scope, the expected repo-local outputs are:

- skill packages under `.agents/skills/<skill>/`;
- a managed SkillRanger block in `AGENTS.md`, unless you pass `--no-agent-context`;
- installed versions, checksums, and paths in `skillranger.lock.json`.

Other target and scope selections can use different layouts and outputs. Review the proposed selection and final confirmation prompt before applying it.

### Universal Router Quick Start

The Universal Prompt Router turns one complete task into a bounded skill set and a prepared lifecycle run. CLI activation is direct, so no trigger is required:

```bash
skillranger task . --intent "Review accessibility and fix critical issues" --target codex --json
skillranger task:read . --router-run <router-run-id> --mandatory-next --expected-read-revision 0 --json
```

For MCP, activation is explicit. End the complete prompt with `@skillranger`, `skillranger`, or `/sr`, then call `prepare_task`. Continue with `read_run_skill_file` until `readStatus.runMandatoryReadsComplete` is true before beginning the returned runtime run.

Routing may return `clarification_required`, `decomposition_required`, `no_matching_skills`, `strict_requirements_unmet`, or `context_budget_exceeded` instead of preparing a run. Clarification returns an opaque continuation token and creates no partial run. Decomposition returns bounded subtasks. Because frontend is the only shipped production domain pack, backend, mobile, and other absent packs return `no_matching_skills`; synthetic packs exist only in tests and evals.

Production routing uses the bundled audited registry and never installs, downloads, executes, or auto-activates a skill. Non-strict routing can read an integrity-pinned bundled skill without installing it. Strict routing is repo-installed-only and requires matching lockfile, package files, contract v2, inputs, and mandatory reads.

Raw prompts are not persisted by default. CLI raw-intent storage requires both project config permission and the explicit `--store-intent --confirm-store-intent` flags. MCP router tools do not expose raw-intent persistence.

## Transparent Manual Workflow

Prefer individual, inspectable steps? This sequence keeps the install dry-run-first:

```bash
npx -y skillranger@latest scan .
npx -y skillranger@latest recommend . --target codex --intent "Review this Next.js app before release" --explain
npx -y skillranger@latest audit frontend.next-app-router-review
npx -y skillranger@latest install frontend.next-app-router-review --project . --target codex --scope repo --dry-run
npx -y skillranger@latest install frontend.next-app-router-review --project . --target codex --scope repo --yes
npx -y skillranger@latest installed .
```

Each command answers a separate question:

1. `scan` — What kind of project is this, based on files and configuration already in the repository?
2. `recommend` — Which compatible skill best fits the stack and stated intent, and why?
3. `audit` — Does the bundled package contain blocked or suspicious content?
4. `install --dry-run` — Which repo-local skill files and lockfile update are planned?
5. `install --yes` — After reviewing the dry-run output, use a separate explicit invocation to apply the selected skill. Without `--yes`, direct installs remain dry runs.
6. `installed` — What does `skillranger.lock.json` say is currently installed?

## How It Works

```text
Repository evidence
      ↓
Deterministic stack fingerprint
      ↓
Compatibility- and intent-aware recommendations
      ↓
Static skill audit
      ↓
Reviewable install plan
      ↓
Confirmed repo-local files + skillranger.lock.json
```

A stack fingerprint is a reproducible summary of signals such as languages, frameworks, styling, tests, infrastructure, and existing agent context. SkillRanger scores compatible skills against that fingerprint and, when supplied, the user's intent.

Recommendations are organized into five lanes: `framework`, `design`, `implementation`, `qa`, and `agent-context`. Lanes keep related workflows visible without turning every recommendation into one overlapping list.

Use intent to request a focused primary skill and compatible companions:

```bash
skillranger recommend . --target codex --intent "Review this Next.js app before release" --explain
```

Or inspect one lane directly:

```bash
skillranger recommend . --target codex --lane design --limit-per-lane 2
```

Visual workflows can declare the host capabilities needed for verification:

```bash
skillranger recommend . --target codex --capabilities browser,screenshots
```

Without those capabilities, visual recommendations remain available but are explicitly marked `unverified` rather than presented as verified work.

## What SkillRanger Does Today

The current public `0.1.3` package provides:

- a compiled npm CLI and a stdio MCP server;
- deterministic scanning for common JavaScript and TypeScript web-project signals;
- compatibility-, intent-, lane-, and capability-aware recommendations;
- static package audits and registry validation;
- dry-run-first, repo-local install planning and confirmed application;
- installed-state tracking in `skillranger.lock.json`;
- a bundled local registry with 18 low-risk, instruction-only frontend skills;
- domain, design, evaluation, and skill-run workflows for maintainers and integrators.

The bundled registry ships with the package, so normal discovery and recommendation do not require registry credentials, network tokens, or remote skill downloads.

## The Frontend Domain

Frontend is the single domain pack available today. Its 18 bundled skills are grouped here by purpose.

**Framework and implementation**

- `frontend.next-app-router-review`
- `frontend.react-app-review`
- `frontend.react-component-design`
- `frontend.tailwind-ui-polish`
- `frontend.design-to-code`

**Design and UX**

- `frontend.visual-design-polish`
- `frontend.design-system`
- `frontend.ux-critique`
- `frontend.interaction-polish`
- `frontend.motion-design`
- `frontend.motion-audit`
- `frontend.visual-critic`

**Quality and release**

- `frontend.accessibility-review`
- `frontend.performance-review`
- `frontend.testing-strategy`
- `frontend.playwright-debug`
- `frontend.audit`

**Agent context**

- `frontend.agents-md-bootstrap`

## Built for More Than Frontend

Backend/API, mobile, infrastructure/DevOps, security, data/AI, QA, and other software-engineering packs are future directions, not currently available domains.

Those future packs are intended to reuse the domain-agnostic pipeline already in place: project detection, compatibility-aware recommendation, static audit, reviewable install planning, lockfile tracking, and evaluation gates.

## Agent Compatibility

Interactive setup and direct install currently support five native targets:

- Codex (`codex`)
- Claude Code (`claude-code`)
- OpenCode (`opencode`)
- Cursor (`cursor`)
- Gemini CLI (`gemini-cli`)

SkillRanger also includes generic Agent Skills and universal adapters. These provide a broader compatibility surface, but do not imply that every host has identical native setup behavior or directory conventions.

## Safety and Write Boundaries

SkillRanger keeps installation reviewable and conservative:

- The bundled registry is local and ships inside the package.
- Skill package scripts are never executed during installation.
- Direct CLI installs default to dry-run and write only when `--yes` is supplied.
- Repo-scope planning resolves writes to the target's expected local skill paths and `skillranger.lock.json`.
- The lockfile records installed versions, checksums, target, scope, source, path, and audit result.
- A static audit detects blocked and suspicious package content; `block` risk rejects installation.
- MCP writes require explicit confirmation and exact expected writes from a fresh dry-run plan.

See [Security](docs/SECURITY.md) and the [threat model](docs/threat-model.md) for the detailed controls and current limitations.

## MCP Server

Start the stdio MCP server through the public package:

```bash
npx -y skillranger@latest mcp
```

A generic stdio host configuration looks like this:

```json
{
  "mcpServers": {
    "skillranger": {
      "command": "npx",
      "args": ["-y", "skillranger@latest", "mcp"]
    }
  }
}
```

Read-only tools analyze projects, recommend and audit skills, inspect installed state, and produce dry-run install plans. The write-capable `install_skill` tool requires `confirm: true` plus `expectedWrites` and `expectedLockfileUpdates` that exactly match a fresh `plan_skill_install` result. Stale plans and block-risk audits are rejected.

See [MCP host configuration](docs/mcp-host-config.md) for host-specific examples, the full tool list, JSON-RPC smoke tests, and the confirmation protocol.

## Command Reference

Use `skillranger <command> --help` for canonical flags and examples. The main command families are grouped below.

### Everyday workflow

```text
doctor
scan
recommend
setup
audit
install
installed
```

### Domains and design

```text
domain:list
domain:inspect
design:brief
design:recommend-recipe
design:observe
design:validate
design:validate-source
design:verify
design:repair
design:compile
```

### Evaluation and registry

```text
eval:frontend
eval:visual
validate:registry
lint:skills
audit:registry
publish:check
```

### Lifecycle and integration

```text
task
task:read
run:start
run:record-read
run:resolve-clarifications
run:begin
run:complete
run:verify
run:inspect
run:read-next
run:step:begin
run:evidence:add
run:step:complete
run:skill:verify
run:finalize
mcp
```

## Beta Status

SkillRanger is a public MVP/beta. Its CLI and MCP protocols, local registry validation, installation boundaries, command routing, and frontend recommendation paths have automated coverage. The current bundled pack is low-risk, internally consistent, and installable.

That is not the same as saying every skill is production-proven. Much of the current skill content remains intentionally checklist-like, and broader real-task, repeated-run, and blinded-human evidence is still being collected before stronger quality promotion. Editorial scores should not be treated as benchmark-backed until those evidence gates pass.

Third-party skills are not installed directly by default; they must be staged and explicitly reviewed through audit and evaluation workflows. Early adopters should inspect recommendations and dry-run output, keep changes under version control, and report cases where routing or skill guidance falls short.

## Requirements and Installation

- Node.js `>=20.0.0` for npm-installed compiled binaries.
- Node.js `>=23.6.0` for direct TypeScript source execution from a checkout.
- No runtime npm dependencies.

For repeated command-line use:

```bash
npm install -g skillranger
skillranger doctor
skillranger setup
```

An installed package also exposes `skillranger-mcp` as a convenience binary. The canonical npx MCP command remains `npx -y skillranger@latest mcp`.

From a source checkout:

```bash
npm install
npm run build
node src/cli/index.ts doctor
node src/cli/index.ts scan fixtures/next-react-ts
```

Direct `.ts` execution is a development mode; compiled npm usage runs JavaScript from `dist/`.

## Development and Release Checks

Run the focused checks while developing:

```bash
npm run build
npm run check
npm test
npm run validate:registry
npm run lint:skills
npm run audit:registry
npm run eval:router
npm run publish:check
```

Before release, run the complete project gate:

```bash
npm run release:check
```

See [RELEASE.md](RELEASE.md) for package and source-run release validation.

## Project Documentation

- [Architecture](docs/ARCHITECTURE.md) — scanner, recommender, domain, CLI/MCP, installer, and lockfile structure.
- [Registry](docs/REGISTRY.md) — bundled package shape, manifests, and validation.
- [Security](docs/SECURITY.md) — audit controls and write boundaries.
- [Testing](docs/TESTING.md) — fixtures, golden tests, install tests, and audit coverage.
- [MCP host configuration](docs/mcp-host-config.md) — host setup, tools, and confirmation protocol.
- [Frontend skill quality](docs/FRONTEND_SKILL_QUALITY.md) — evidence and promotion boundaries for the current pack.
- [Creating a domain pack](docs/domains/creating-a-domain-pack.md) — extension model for future domains.

## Contributing

Issues and pull requests are welcome, especially for reproducible scanner signals, routing cases, audit findings, agent adapters, domain-pack infrastructure, and evidence-backed skill improvements.

Please include tests or fixtures for behavioral changes, run the relevant development checks above, and avoid raising quality or safety claims without recorded evidence. Registry contributions should follow the package and validation rules in [Registry](docs/REGISTRY.md).

## License

[MIT](LICENSE)

# SkillRanger

AI agents are only as useful as the instructions they are given — and most skills get installed without being read. SkillRanger finds, audits, and installs the right agent skills for your codebase, with the full plan shown before anything is written.

<p align="center">
  <a href="https://www.npmjs.com/package/skillranger"><img src="https://img.shields.io/npm/v/skillranger?color=blue&style=flat-square" alt="npm version"></a>
  <a href="https://github.com/Narek-Khachikyan/SkillRanger/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?style=flat-square" alt="Node version"></a>
  <a href="https://github.com/Narek-Khachikyan/SkillRanger/actions/workflows/ci.yml"><img src="https://github.com/Narek-Khachikyan/SkillRanger/actions/workflows/ci.yml/badge.svg" alt="CI Status"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Narek-Khachikyan/SkillRanger/main/docs/demo.gif" alt="SkillRanger setup on a Next.js project: scan, recommend, audit, confirm, install" width="720">
</p>

## Quick Start

```bash
npx -y skillranger@latest setup
```

Run that one command inside your project. SkillRanger requires Node.js 20 or newer. The setup flow takes about 30 seconds and works like this:

1. **Scan** — detects your repository's stack (`Detected:` types, languages, frameworks, styling, testing).
2. **Recommend** — selects a small compatible skill set (`Selected N skills:`), not a dump of everything that exists.
3. **Plan** — shows exactly which files would be written or updated (`Planned changes:`). Nothing is touched yet.
4. **Audit** — prints a computed risk level and finding count for every recommended skill (`Audit summary:`).
5. **Install** — after you confirm, writes the reviewed instructions, adds a managed block to your `AGENTS.md`, and records checksums in `skillranger.lock.json`.

To script the same flow, pass `--yes` with an intent. Interactively, setup asks you to confirm the target agents, scope, and install mode. In an interactive terminal, setup ends with a single line pointing to the repository; it stays quiet in CI.

### What setup creates

For a repo-scoped setup, SkillRanger creates or updates:

- `.agents/skills/<skill>/` — repository-local skill packages;
- `AGENTS.md` — a bounded, marker-delimited SkillRanger-managed context block;
- `skillranger.lock.json` — installed versions, checksums, targets, and audit metadata.

Installed skills are static instructions. SkillRanger does not invoke a model itself, execute skill scripts, or silently modify your application code.

## Why SkillRanger?

Three situations that send developers looking for a skill installer:

- **Copy-pasted skills rot.** The skill you pasted from a blog post has no version, no checksum, and no update path. Months later your agent still follows instructions written for an old API, and nobody knows.
- **Install-all lists bloat your repo.** Dumping a curated list of forty skills into the project makes every agent read more context than it needs. The right two skills for your stack get lost in the noise.
- **Trust is granted before review.** In most install flows the plan is the install. You never see what will be written, and no one checks the skill for credential access, destructive commands, or prompt-injection patterns before it lands in the context your agent trusts most.

SkillRanger exists to make the review step the default instead of an exception: recommend a small set, audit it, show the plan, then write.

### Honest comparison

| | SkillRanger | Manual copying | Git submodule | Curated skill collections |
| :--- | :--- | :--- | :--- | :--- |
| **Versioning** | Lockfile-pinned installs (`skillranger.lock.json`) | None — paste and forget | Upstream commit recorded; `git submodule update` syncs to it | Whatever upstream does |
| **Integrity checks** | SHA-256 checksums recorded and verified | None | Git hash integrity | None stated |
| **Relevance to your repo** | Selected from detected stack + your intent | Whatever you pick | A fixed repo, not per-project selection | Browse and pick by hand |
| **Audit before install** | Static security audit per skill, shown in the plan | None | None | None (see below) |
| **Multiple agent targets** | Codex, Claude Code, Cursor, OpenCode, Gemini CLI, MCP hosts | Copy per agent by hand | One checkout; per-agent mapping is manual | Per collection |
| **Review before writing** | Full plan and audit summary before confirm | None | None | None |

**Best when:**
- **Manual copying** — you need one or two files and want no tooling at all.
- **Git submodule** — your priority is exact synchronization with an upstream repo.
- **Curated collection** — your priority is browsing and choosing skills by hand.

Third-party notes: git submodule tracks a recorded upstream commit and updates the working tree to match it (git-scm.com/docs/git-submodule, checked 2026-08-12). Curated collections such as anthropics/skills present skills for manual browsing and are described as demonstration and educational material — "always test skills thoroughly in your own environment before relying on them" (github.com/anthropics/skills README, checked 2026-08-12); they do not audit before install.

**Where SkillRanger is not the best choice:** the bundled registry currently covers frontend skills only — a backend-only project will get few or no recommendations. Skills are instructions, not code: the host agent still does the work. And if you never install third-party content into your agent's context, you do not need an installer at all.

## How It Works

```text
Repository + task
       │
       ▼
Detect stack and project context
       │
       ▼
Select a small compatible skill set
       │
       ▼
Audit and preview installation
       │
       ▼
Install reviewed instructions and lockfile metadata
       │
       ▼
Your agent reads the selected instructions and performs the task
```

## Supported Agents

Repo-local setup is supported for Codex, Claude Code, Cursor, OpenCode, Gemini CLI, and Model Context Protocol hosts through the stdio MCP server. One install can target several agents at once (`--target codex,claude-code`).

## Bundled Skills

SkillRanger ships with 18 pre-audited, instruction-only frontend skills: framework reviews (Next.js App Router, React), component and Tailwind polish, visual design, UX, interaction, motion, accessibility, performance, testing strategy, Playwright debugging, release audits, and agent-context bootstrap.

The full table of skill IDs, categories, and purposes is in [`docs/bundled-skills.md`](docs/bundled-skills.md).

## Security Model

- **Bundled local registry** — packages ship with the distribution; normal recommendation never fetches arbitrary remote skills.
- **Static instructions** — skills are text, not scripts; nothing executes during installation.
- **Explicit writes** — CLI installs can be previewed with `--dry-run`; interactive setup always shows the plan before writing.
- **Integrity tracking** — installed files are hashed and recorded in `skillranger.lock.json`; `skillranger verify` checks them.
- **Host-managed execution** — the host owns model calls and code changes; SkillRanger validates what a model proposes and refuses ineligible or unsafe skills.

The full threat model lives in [`docs/SECURITY.md`](docs/SECURITY.md).

## For Agent Hosts (MCP)

SkillRanger runs as a stdio MCP server so a host agent can analyze projects, recommend and audit skills, discover the audited catalog, propose a skill set for a task, preview or confirm installations, and serve the installed instructions:

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

When a host model proposes skills for a task, SkillRanger validates the proposal against catalog, audit, and compatibility rules before composing the final set — a model cannot add arbitrary skills or bypass an audit gate. Host configuration for Claude Code, Cursor, and other clients: [`docs/mcp-host-config.md`](docs/mcp-host-config.md).

## Documentation

- [`docs/bundled-skills.md`](docs/bundled-skills.md) — the full bundled skill catalog
- [`docs/cli-reference.md`](docs/cli-reference.md) — every command and flag
- [`docs/model-assisted-routing.md`](docs/model-assisted-routing.md) — catalog-assisted routing for hosts
- [`docs/workflow-runtime.md`](docs/workflow-runtime.md) — persisted runs, evidence, and recovery
- [`docs/verification-engine.md`](docs/verification-engine.md) — evidence and verification gates
- [`docs/design-rule-library.md`](docs/design-rule-library.md) — frontend design rules and recipes
- [`docs/REGISTRY.md`](docs/REGISTRY.md) — skill package metadata and registry design
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model

## Development

```bash
git clone https://github.com/Narek-Khachikyan/SkillRanger.git
cd SkillRanger
pnpm install

pnpm build
pnpm check
pnpm test
pnpm release:check
```

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for environment setup, how to create a skill package, and the PR gates.

## License

Distributed under the [MIT License](LICENSE).

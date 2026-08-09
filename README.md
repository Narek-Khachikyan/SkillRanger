# SkillRanger

<p align="center">
  <strong>Find, audit, and install the right AI agent skills for your codebase.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/skillranger"><img src="https://img.shields.io/npm/v/skillranger?color=blue&style=flat-square" alt="npm version"></a>
  <a href="https://github.com/Narek-Khachikyan/SkillRanger/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?style=flat-square" alt="Node version"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-Supported-purple?style=flat-square" alt="MCP Server"></a>
  <a href="https://github.com/Narek-Khachikyan/SkillRanger/actions/workflows/ci.yml"><img src="https://github.com/Narek-Khachikyan/SkillRanger/actions/workflows/ci.yml/badge.svg" alt="CI Status"></a>
</p>

---

**Public MVP / Beta** · Local-First · CLI + MCP · Zero Runtime Dependencies

SkillRanger scans your repository, detects its stack and development context, recommends compatible skills, audits them for safety risks, and creates a reviewable install plan before writing anything.

## Quick Start

One command, inside your project:

```bash
cd your-project
npx -y skillranger@latest setup
```

SkillRanger requires Node.js 20 or newer. The setup command walks you through the whole flow in about 30 seconds:

1. **Scan** — detects your repository's stack (`Detected:` types, languages, frameworks, styling, testing).
2. **Recommend** — selects a small compatible skill set (`Selected N skills:`).
3. **Plan** — shows the reviewable install plan: exactly which files would be written and updated (`Planned changes:`). Nothing is touched yet.
4. **Audit** — prints a computed audit summary for each recommended skill: risk level and findings count (`Audit summary:`).
5. **Install** — after you confirm, installs the reviewed instructions, writes a managed block into your `AGENTS.md`, and records checksums in `skillranger.lock.json`.

When setup finishes, it prints one feedback invitation: star the repo or open an issue.

To script the same flow without an interactive prompt, pass `--yes` with an intent (and a target agent — setup asks for both interactively):

```bash
npx -y skillranger@latest setup --yes --target codex \
  --intent "Review this Next.js app before release"
```

### What setup creates

For a repo-scoped setup, SkillRanger can create or update:

- `.agents/skills/<skill>/` — repository-local skill packages;
- `AGENTS.md` — a bounded SkillRanger-managed context block;
- `skillranger.lock.json` — installed versions, checksums, targets, and audit metadata.

SkillRanger installs static instructions. It does not invoke a model itself or silently modify your application code.

## Why SkillRanger?

| Feature | What it means |
| :--- | :--- |
| **Context-aware recommendations** | Skills are selected from repository evidence and the user's task instead of a fixed global list. |
| **No blind installs** | Review recommendations, audit results, and planned file changes before applying them. |
| **Hybrid prompt routing** | Deterministic vocabulary matching remains available, while an MCP host model can nominate skills from the trusted catalog for implicit intent. |
| **Lockfile integrity** | Installed versions, checksums, target agents, and audit data are tracked in `skillranger.lock.json`. |
| **Local-first operation** | Bundled discovery and recommendation require no API keys or network tokens. |
| **Multiple agent targets** | One project can be prepared for Codex, Claude Code, Cursor, OpenCode, Gemini CLI, or MCP hosts. |

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

SkillRanger supports repo-local setup for:

- **Codex** (`codex`)
- **Claude Code** (`claude-code`)
- **Cursor** (`cursor`)
- **OpenCode** (`opencode`)
- **Gemini CLI** (`gemini-cli`)
- **Model Context Protocol** hosts through the stdio MCP server

## Bundled Frontend Skills

SkillRanger currently ships with 18 pre-audited, instruction-only frontend skills covering:

- React and Next.js architecture;
- component design and Tailwind UI polish;
- visual design, UX, interaction, and motion;
- accessibility, performance, testing, and Playwright debugging;
- release audits and AI-agent project context.

<details>
<summary><strong>View all 18 bundled skill IDs</strong></summary>

| Category | Skill ID | Purpose |
| :--- | :--- | :--- |
| Framework & Core | `frontend.next-app-router-review` | Next.js App Router architecture and data-flow review. |
| | `frontend.react-app-review` | React state ownership, providers, and render performance. |
| | `frontend.react-component-design` | Component APIs, composition, and prop boundaries. |
| | `frontend.tailwind-ui-polish` | Responsive layout and Tailwind UI cleanup. |
| | `frontend.design-to-code` | Responsive implementation from designs and mockups. |
| Design & Motion | `frontend.visual-design-polish` | Art direction, hierarchy, typography, and aesthetics. |
| | `frontend.design-system` | Tokens, themes, primitives, and consistency. |
| | `frontend.ux-critique` | Information architecture, usability, and user flows. |
| | `frontend.interaction-polish` | Dialogs, drawers, focus, and micro-interactions. |
| | `frontend.motion-design` | Motion choreography and reduced-motion behavior. |
| | `frontend.motion-audit` | Animation performance and frame-drop diagnostics. |
| | `frontend.visual-critic` | Independent visual comparison and critique. |
| Quality & Release | `frontend.accessibility-review` | WCAG, ARIA, keyboard navigation, and focus behavior. |
| | `frontend.performance-review` | Core Web Vitals, bundles, and render bottlenecks. |
| | `frontend.testing-strategy` | Focused unit, integration, and E2E planning. |
| | `frontend.playwright-debug` | Playwright flakiness, waits, and traces. |
| | `frontend.audit` | Broad frontend release-readiness audit. |
| Agent Context | `frontend.agents-md-bootstrap` | Project commands and architecture guidance for agents. |

</details>

## Security Model

- **Bundled local registry** — bundled packages ship with the distribution; normal recommendation does not fetch arbitrary remote skills.
- **Static instructions** — installed skill packages are instructions, not scripts executed during installation.
- **Explicit writes** — CLI installation can be previewed with `--dry-run`; MCP writes require explicit confirmation.
- **Integrity tracking** — installed files are hashed and recorded in `skillranger.lock.json`.
- **Host-managed execution** — the host owns model calls, tools, and application-code changes; SkillRanger validates model nominations and enforces routing and runtime guarantees.

## Advanced

The capabilities below are ready to use but are not part of the 30-second quick start.

### Universal Task Router

SkillRanger also routes a natural-language task into a bounded, reviewable skill set. Two paths are supported: a deterministic fallback that matches the prompt and repository signals against a bounded bilingual vocabulary, and catalog-assisted MCP routing where the host model reads the audited skill catalog and submits a prompt-grounded `routingProposal` — which SkillRanger validates before composing the final set. The model cannot add arbitrary skills, bypass audit or compatibility checks, or force an ineligible skill.

- [`docs/model-assisted-routing.md`](docs/model-assisted-routing.md) — the catalog-assisted flow
- [`docs/ROUTING_VOCABULARY.md`](docs/ROUTING_VOCABULARY.md) — vocabulary and translations
- [ADR 0003](docs/adr/0003-model-assisted-skill-nomination.md) — design and trust boundaries

### Strict runs, evidence, and recovery

Persisted runs track skill reads, execution, evidence, and verification. Strict v2 requires opened steps, attached evidence, and verification before finalization — a run is only `verified` when every gate passes. Lifecycle v1 and strict v2 runs, evidence handling, verification states, and recovery behavior are documented in:

- [`docs/workflow-runtime.md`](docs/workflow-runtime.md) — run lifecycle and recovery
- [`docs/verification-engine.md`](docs/verification-engine.md) — evidence and gates

### Frontend design pipeline

The frontend design contract ships in release `0.4.1`: six rule families, 18 stable rules, eight recipe packs, and 80 deterministic worked-example assets. The pipeline covers briefs and recipes, rule selection, repair loops, model capability profiles, and browser-based visual verification:

- [`docs/design-rule-library.md`](docs/design-rule-library.md) — rule library and recipes
- [`docs/repair-loop.md`](docs/repair-loop.md) — bounded repair flow
- [`docs/model-capability-profiles.md`](docs/model-capability-profiles.md) — model profiles
- [`docs/browser-adapter.md`](docs/browser-adapter.md) and [`docs/visual-benchmark.md`](docs/visual-benchmark.md) — visual verification

Run `npm run release:validate` to verify the local package artifacts; use `release:certify` to bind external visual and matched-baseline evidence into a retained promotion verdict.

### MCP integration

SkillRanger runs as a stdio MCP server so a host agent can analyze projects, recommend and audit skills, discover the trusted skill catalog, accept a host model's routing proposal, preview or confirm installations, prepare routed tasks, and serve mandatory skill instructions:

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

Full host configuration (Claude Code, Cursor, and other clients) is in [`docs/mcp-host-config.md`](docs/mcp-host-config.md).

### Advanced CLI usage

The commands below are optional. They are useful for inspecting individual stages, scripting SkillRanger, or integrating it into an agent host.

```bash
# Detect repository context
npx -y skillranger@latest scan .

# Explain recommendations for a task
npx -y skillranger@latest recommend . \
  --target codex \
  --intent "Review this Next.js app before release" \
  --explain

# Audit one package
npx -y skillranger@latest audit frontend.next-app-router-review

# Preview installation
npx -y skillranger@latest install frontend.next-app-router-review \
  --project . \
  --target codex \
  --scope repo \
  --dry-run

# Apply the reviewed plan
npx -y skillranger@latest install frontend.next-app-router-review \
  --project . \
  --target codex \
  --scope repo \
  --yes

# Inspect installed skills
npx -y skillranger@latest installed .

# Direct task routing (structured result, no interactive flow)
npx -y skillranger@latest task . \
  --intent "Review accessibility and fix critical focus traps" \
  --target codex \
  --json

# Read required instruction chunks from a routed task
npx -y skillranger@latest task:read . \
  --router-run <router-run-id> \
  --mandatory-next \
  --expected-read-revision 0 \
  --json
```

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

## License

Distributed under the [MIT License](LICENSE).

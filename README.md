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

For example, when you ask an AI agent to review a Next.js application, SkillRanger can select the relevant Next.js, accessibility, performance, and testing instructions instead of making the agent work from a generic prompt.

## Quick Start

### 1. Run setup inside your project

SkillRanger requires Node.js 20 or newer.

```bash
cd your-project
npx -y skillranger@latest setup
```

The interactive setup will:

1. scan the current repository;
2. ask which AI agents you use;
3. recommend compatible skills;
4. show what will be installed;
5. ask for confirmation before writing files.

You can run diagnostics first when troubleshooting:

```bash
npx -y skillranger@latest doctor
```

### 2. Universal Task Router

Route any task prompt into an optimal, bounded skill set and lifecycle run. End the task with `@skillranger`, `skillranger`, or `/sr` when you want the installed SkillRanger workflow to run:

```text
Review this Next.js app for accessibility and fix critical keyboard-navigation issues. @skillranger
```

Or via CLI:

```bash
# Execute CLI routing for a natural-language task ending with terminal trigger
skillranger task . --intent "Review accessibility and fix critical focus traps @skillranger" --target codex --json

# Read mandatory lifecycle instructions before execution
skillranger task:read . --router-run <router-run-id> --mandatory-next --expected-read-revision 0 --json
```

> 🌐 **Bilingual Natural Language**: Prompts can be written in English, Russian, or mixed terminology (e.g. *"Создай современный сайт по Bleach с плавной анимацией @skillranger"*). Matching is 100% deterministic using owner-scoped Domain Pack routing vocabularies. Note: End the task with `@skillranger`, `skillranger`, or `/sr` when you want the installed SkillRanger workflow to run.

After setup, open Codex, Claude Code, Cursor, OpenCode, or Gemini CLI in the same repository and write your task as usual:

```text
Review this Next.js app for accessibility and fix critical keyboard-navigation issues. @skillranger
```

SkillRanger's managed agent context activates when your task prompt ends with `@skillranger`, `skillranger`, or `/sr`, guiding the agent on which installed skill instructions must be read before implementation.

You do **not** need to manually run the advanced lifecycle commands for normal interactive use.

### What setup creates

For a repo-scoped Codex setup, SkillRanger can create or update:

- `.agents/skills/<skill>/` — repository-local skill packages;
- `AGENTS.md` — a bounded SkillRanger-managed context block;
- `skillranger.lock.json` — installed versions, checksums, targets, and audit metadata.

SkillRanger installs static instructions. It does not invoke a model or silently modify your application code.

## Why SkillRanger?

| Feature | What it means |
| :--- | :--- |
| **Context-aware recommendations** | Skills are selected from repository evidence and the user's task instead of a fixed global list. |
| **No blind installs** | Review recommendations, audit results, and planned file changes before applying them. |
| **Deterministic routing** | English, Russian, and mixed-language tasks are matched without external LLM routing calls. |
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

## MCP Integration

Add SkillRanger as a stdio MCP server:

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

The MCP surface can analyze projects, recommend and audit skills, preview or confirm installations, prepare routed tasks, and serve mandatory skill instructions to an agent host.

<details>
<summary><strong>Available MCP tools</strong></summary>

- `analyze_project`
- `recommend_skills`
- `audit_skill`
- `plan_skill_install`
- `install_skill`
- `prepare_task`
- `read_run_skill_file`

</details>

## Advanced CLI Usage

The commands below are optional. They are useful for inspecting individual stages, scripting SkillRanger, or integrating it into an agent host.

### Manual recommendation and installation

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
```

### Direct task router

Use this mode when an integration needs a structured routed result rather than the normal interactive setup flow:

```bash
npx -y skillranger@latest task . \
  --intent "Review accessibility and fix critical focus traps" \
  --target codex \
  --json
```

An agent host or manual integration can then read required instruction chunks:

```bash
npx -y skillranger@latest task:read . \
  --router-run <router-run-id> \
  --mandatory-next \
  --expected-read-revision 0 \
  --json
```

For persisted and strict lifecycle commands, evidence handling, verification states, and recovery behavior, see [`docs/workflow-runtime.md`](docs/workflow-runtime.md).

## Security Model

- **Bundled local registry** — bundled packages ship with the distribution; normal recommendation does not fetch arbitrary remote skills.
- **Static instructions** — installed skill packages are instructions, not scripts executed during installation.
- **Explicit writes** — CLI installation can be previewed with `--dry-run`; MCP writes require explicit confirmation.
- **Integrity tracking** — installed files are hashed and recorded in `skillranger.lock.json`.
- **Host-managed execution** — your selected AI agent owns model calls, tools, and application-code changes.

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

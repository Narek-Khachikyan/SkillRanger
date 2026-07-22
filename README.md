# SkillRanger

<p align="center">
  <img src="https://raw.githubusercontent.com/Narek-Khachikyan/SkillRanger/main/docs/assets/banner.png" alt="SkillRanger Banner" width="100%" onError="this.style.display='none'" />
</p>

<p align="center">
  <strong>Find, audit, and install the right AI agent skills for your codebase.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/skillranger"><img src="https://img.shields.io/npm/v/skillranger?color=blue&style=flat-square" alt="npm version"></a>
  <a href="https://github.com/Narek-Khachikyan/SkillRanger/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?style=flat-square" alt="Node version"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-Supported-purple?style=flat-square" alt="MCP Server"></a>
  <a href="https://github.com/Narek-Khachikyan/SkillRanger/actions"><img src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square" alt="Build Status"></a>
</p>

---

**Public MVP / Beta** · Local-First · Universal Prompt Router · CLI + MCP · Zero Runtime Dependencies

SkillRanger scans your repository, detects its stack and development context, recommends compatible skills, audits them for safety risks, and produces reviewable, deterministic install plans before any changes are applied.

---

## 🚀 Key Features

| Feature | Description |
| :--- | :--- |
| 🎯 **Universal Prompt Router** | Converts natural-language tasks (English, Russian, or mixed) into precise, bounded skill sets without fuzzy external LLM calls. |
| 🛡️ **Zero Blind Installs** | Dry-run-first workflow. Audit skill packages for risk, review proposed file changes, and confirm before writing. |
| 🔒 **Lockfile Integrity** | Tracks installed skill versions, checksums, target agent configurations, and audit scores in `skillranger.lock.json`. |
| ⚡ **Local-First & Offline** | Bundles 18 pre-audited frontend skills. Discovery and recommendation require no network tokens or API keys. |
| 🔌 **Multi-Agent Compatibility** | Native support for Codex, Claude Code, Cursor, OpenCode, Gemini CLI, plus a stdio Model Context Protocol (MCP) server. |

---

## 💡 How It Works

```text
┌──────────────────────────┐
│   Repository Evidence    │  (Languages, Frameworks, Testing, Styling, Signals)
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ Stack & Intent Fingerprint│  (Deterministic multi-lane scoring)
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ Universal Prompt Router  │  (Natural-language matching via Domain Vocabulary)
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│   Static Package Audit   │  (Security scanning & risk verification)
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ Reviewable Install Plan   │  (Dry-run diffs & skillranger.lock.json)
└──────────────────────────┘
```

---

## ⚡ Quick Start

### 1. Interactive Setup

Run SkillRanger directly in any repository you want to configure:

```bash
npx -y skillranger@latest doctor
npx -y skillranger@latest setup
```

`setup` scans the current repository, helps you select target agents (e.g. Codex, Claude Code, Cursor), presents top compatible skill recommendations, and asks for confirmation before applying changes.

When configured for Codex in repo scope, SkillRanger creates:
- 📂 `.agents/skills/<skill>/` — Repo-local skill packages.
- 📝 `AGENTS.md` — Managed SkillRanger context block (optional).
- 🔒 `skillranger.lock.json` — Lockfile tracking versions, checksums, and audit hashes.

---

### 2. Universal Task Router

Route any task prompt into an optimal, bounded skill set and lifecycle run:

```bash
# Execute CLI routing for a natural-language task
skillranger task . --intent "Review accessibility and fix critical focus traps" --target codex --json

# Read mandatory lifecycle instructions before execution
skillranger task:read . --router-run <router-run-id> --mandatory-next --expected-read-revision 0 --json
```

> 🌐 **Bilingual Natural Language**: Prompts can be written in English, Russian, or mixed terminology (e.g. *"Создай современный сайт по Bleach с плавной анимацией"*). Matching is 100% deterministic using owner-scoped Domain Pack routing vocabularies.

---

### 3. Transparent Step-by-Step Workflow

If you prefer inspectable, manual steps:

```bash
# 1. Scan repository stack
npx -y skillranger@latest scan .

# 2. Get recommendations tailored to your stack and intent
npx -y skillranger@latest recommend . --target codex --intent "Review this Next.js app before release" --explain

# 3. Audit skill package for security risks
npx -y skillranger@latest audit frontend.next-app-router-review

# 4. Preview install plan (Dry-Run)
npx -y skillranger@latest install frontend.next-app-router-review --project . --target codex --scope repo --dry-run

# 5. Apply install plan after review
npx -y skillranger@latest install frontend.next-app-router-review --project . --target codex --scope repo --yes

# 6. Verify lockfile status
npx -y skillranger@latest installed .
```

---

## 📦 Bundled Frontend Domain Pack

SkillRanger ships with 18 pre-audited, instruction-only skills for modern web development:

| Category | Skill ID | Description |
| :--- | :--- | :--- |
| **Framework & Core** | `frontend.next-app-router-review` | Next.js App Router architecture, Server Components, & data fetching. |
| | `frontend.react-app-review` | React application state ownership, providers, and render performance. |
| | `frontend.react-component-design` | Clean component API boundaries, prop sprawl reduction, & composition. |
| | `frontend.tailwind-ui-polish` | Responsive layout fixes, Tailwind class cleanup, & mobile edge cases. |
| | `frontend.design-to-code` | Implementing pixel-matched responsive UIs from designs and mockups. |
| **Design & Motion** | `frontend.visual-design-polish` | Art direction, visual hierarchy, typography, & modern aesthetics. |
| | `frontend.design-system` | Design tokens, theme migrations, & component primitive consistency. |
| | `frontend.ux-critique` | Information architecture, cognitive load, usability, & user flows. |
| | `frontend.interaction-polish` | Micro-interactions, modal dialogs, drawers, & focus management. |
| | `frontend.motion-design` | Page transitions, CSS/Framer motion choreography, & reduced-motion. |
| | `frontend.motion-audit` | Frame-drop diagnostics, animation performance, & reduced-motion audits. |
| | `frontend.visual-critic` | Independent visual comparison & critique of rendered UI variants. |
| **Quality & Release** | `frontend.accessibility-review` | WCAG compliance, ARIA roles, keyboard navigation, & focus traps. |
| | `frontend.performance-review` | Core Web Vitals (LCP, INP), bundle analysis, & render bottlenecks. |
| | `frontend.testing-strategy` | Testing portfolio planning across Unit, Integration, & E2E layers. |
| | `frontend.playwright-debug` | Playwright test flakiness, wait strategies, & trace artifact analysis. |
| | `frontend.audit` | Comprehensive preflight audit & release-readiness scorecard. |
| **Agent Context** | `frontend.agents-md-bootstrap` | Bootstrapping project commands & architecture guidance for AI agents. |

---

## 🤖 Agent Compatibility Matrix

SkillRanger supports direct interactive setup and repo-local skill layouts for:

- 🟢 **Codex** (`codex`)
- 🟣 **Claude Code** (`claude-code`)
- 🔵 **Cursor** (`cursor`)
- 🟠 **OpenCode** (`opencode`)
- 🔷 **Gemini CLI** (`gemini-cli`)
- 🌐 **Model Context Protocol** (stdio MCP Server)

---

## 🔌 Model Context Protocol (MCP) Integration

SkillRanger includes a stdio MCP server for seamless IDE and agent integration:

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

### Available MCP Tools

- 🔍 `analyze_project` — Detect stack signals & project context.
- 💡 `recommend_skills` — Query compatibility-aware skill recommendations.
- 🛡️ `audit_skill` — Inspect static package security & risk levels.
- 📋 `plan_skill_install` — Generate reviewable dry-run install plans.
- ⚙️ `install_skill` — Confirmed repo-local installation (requires explicit user confirmation).
- 🎯 `prepare_task` — Universal prompt routing & task lifecycle initialization.
- 📖 `read_run_skill_file` — Mandatory read-flow for prepared lifecycle runs.

---

## 🛡️ Security & Safety Guarantees

SkillRanger operates under a strict security policy:
- **Local Registry**: Bundled packages ship inside the distribution; no external network fetches.
- **No Code Execution**: Skill scripts are static instructions and are never executed during install.
- **Explicit Confirmation**: CLI defaults to `--dry-run`; MCP write operations require explicit `confirm: true` and exact write hash matching.
- **Lockfile Verification**: All installed files are hashed and validated against `skillranger.lock.json`.

---

## 🛠️ Development & Testing

```bash
# Clone and install dependencies
git clone https://github.com/Narek-Khachikyan/SkillRanger.git
cd SkillRanger
npm install

# Run build and full verification suite
npm run build
npm run check
npm test

# Run evaluation matrices
npm run eval:frontend:ru
npm run eval:router

# Pre-release verification gate
npm run release:check
```

---

## 📄 License

Distributed under the [MIT License](LICENSE).

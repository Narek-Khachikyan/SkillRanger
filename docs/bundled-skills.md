# Bundled Skills

SkillRanger ships with 20 author-curated, pre-audited, instruction-only skills — frontend today, more directions on the way. Normal recommendation never fetches arbitrary remote skills; every package below passes the registry validation, content lint, and static audit gates before release.

| Category | Skill ID | Purpose |
| :--- | :--- | :--- |
| Core (always-on) | `core.proportional-engineering` | Smallest maintainable change; KISS/YAGNI/Pareto, scope expansion gate. |
| | `core.universal-safety` | Secrets, destructive operations, history preservation, escalation. |
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

Core skills are always-on behavioral guidance: they are included in every SkillRanger-prepared run (strict and non-strict, both routing modes) and delivered first in router-level read order. They are guidance-only — no execution contract, no strict-run verification dependency — and bounded by the `maxCoreSkills` router config (default 3). Since ADR 0008 their output contracts are **enforced** in lifecycle-v1: each core skill declares `outputContract.requiredReportFields` in its manifest, `prepare_task` stamps those requirements into the run policy, and `verify_skill_run` blocks until the report's `universalContracts` section satisfies every field (see ADR 0008). Because core skills are not project-specific, the reference install flow uses `--scope user` (one lockfile covers all projects); repo scope remains an option for team pinning, and user-scope installation is sufficient for strict-mode lockfile matching.

## Package layout

Each skill lives under `registry/skills/<id>/` as a portable package:

- `SKILL.md` — the instruction document: YAML frontmatter with `name` and `description`, then a focused workflow with decision rules and boundaries;
- `skill.manifest.json` — registry metadata: tags, source, risk level, permissions, per-agent compatibility, routing vocabulary, and quality scores.

Some packages also ship `references/` (text resources only), `input.schema.json`/`output.schema.json` (strict contract v2 skills), and `workflow.json`/`gates.json` (execution contract).

## Adding a skill

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) — new packages must pass `validate:registry`, `lint:skills`, and `audit:registry` before they can be merged. Packages are instruction-only: patterns such as remote install pipes, credential access, destructive commands, and obfuscated execution are hard-blocked.

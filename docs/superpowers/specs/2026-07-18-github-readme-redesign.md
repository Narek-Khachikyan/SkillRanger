# GitHub README Redesign

**Date:** 2026-07-18

**Status:** Approved design

## Purpose

Replace the current reference-heavy README with a product-first GitHub landing page that helps a new developer understand what SkillRanger is, why it exists, and how to complete a safe first run without reading the source or the full documentation set.

The README must remain technically accurate for the public `skillranger@0.1.3` package and must describe the project as a public MVP/beta rather than as a production-proven product.

## Audience

The primary reader is a developer who uses an AI coding agent and has not used SkillRanger before. They may know what agent skills are, but they should not need to understand SkillRanger's registry, scoring, installer adapters, or MCP implementation before getting value from the tool.

Secondary readers are:

- developers who want a transparent manual workflow instead of an interactive wizard;
- agent-host integrators looking for MCP support;
- contributors evaluating the architecture, safety model, and development workflow.

## Positioning

The first screen will describe SkillRanger as a local-first CLI and MCP server that finds, audits, and installs compatible AI agent skills for a codebase.

The hero will communicate four facts immediately:

- SkillRanger is a public MVP/beta;
- it scans the local repository and makes deterministic, explainable recommendations;
- installation is reviewable and confirmation-gated;
- frontend is the first available domain pack, not the final product boundary.

The README must not claim that every bundled skill is production-proven or fully promoted through real-project and blinded-human evaluation.

## Reader Journey

The README will use a product-first order:

1. Hero, one-sentence value proposition, and beta status.
2. The problem SkillRanger solves.
3. A minimal Quick Start using the public npm package.
4. What `setup` does and what files it may write.
5. A transparent manual workflow: `scan`, `recommend`, `audit`, dry-run, confirmed install, and installed-state inspection.
6. A compact explanation of the internal flow from repository evidence to a repo-local installation.
7. Current capabilities, supported agents, and the bundled frontend skill pack.
8. Future domain direction without dates or a roadmap link.
9. Safety guarantees and explicit write boundaries.
10. MCP usage and a link to detailed host configuration.
11. Grouped CLI reference for advanced users.
12. Beta limitations, development checks, project documentation, contributing guidance, and license.

## Quick Start Design

The primary path will favor the interactive setup wizard:

```bash
npx -y skillranger@latest doctor
npx -y skillranger@latest setup
```

The accompanying text will explain that `setup` scans the current project, presents recommended skills selected by default, lets the user change the selection, and asks for final confirmation before writing files.

The manual path will immediately follow for users who want full control:

```text
scan -> recommend -> audit -> install --dry-run -> install --yes -> installed
```

Examples will use `frontend.next-app-router-review`, the included Next.js fixture where repository-local examples are appropriate, and `codex` as the simplest target while making the other supported targets visible.

## Current and Future Domains

The README will distinguish availability from direction.

**Available now:** the frontend/web reference domain and its 18 bundled low-risk, instruction-only skills.

**Designed for future expansion:** backend/API, mobile, infrastructure/DevOps, security, data/AI, QA, and other software-engineering workflows.

The wording will explain that future domain packs are expected to reuse the same domain-agnostic pipeline: project detection, compatibility-aware recommendation, static audit, reviewable install planning, lockfile tracking, and evaluation gates. It will not provide delivery dates and will not link to the roadmap.

## Supported Agents

The setup-focused compatibility section will name the currently supported interactive targets:

- Codex
- Claude Code
- OpenCode
- Cursor
- Gemini CLI

The generic Agent Skills adapter and universal compatibility surface may be mentioned separately, without implying identical native behavior across every host.

## Safety and Trust

The safety section will make concrete claims only:

- the bundled registry is local and ships with the package;
- dry-run is the default for direct installs;
- confirmed repo-local installs are constrained to expected skill paths and `skillranger.lock.json`;
- installed versions and checksums are recorded;
- the static audit detects blocked or suspicious package content;
- the MCP install tool requires confirmation plus exact expected writes from a fresh plan.

The README will also state the beta limitation: registry validation and routing evidence are strong, but most skill content has not yet been promoted through the complete real-task and blinded-human quality pipeline.

## Command Reference

The existing flat command block will be reorganized into scannable groups:

- everyday project workflow;
- registry and package maintenance;
- domains and frontend design workflow;
- evaluation and visual benchmarking;
- skill-run lifecycle and MCP.

Canonical syntax must come from current CLI help and source, not from older architecture notes.

## Style

The README will be written in English with short paragraphs, descriptive headings, compact lists, and runnable command blocks. It will avoid marketing filler, oversized badge collections, emojis as navigation, and repetitive explanations.

The tone will be direct, technically credible, and welcoming to early adopters. Specialized terms such as lane, fingerprint, domain pack, and MCP will be explained on first use.

## Accuracy Sources

README claims and examples will be checked against:

- `package.json` for version, runtime requirements, binaries, and scripts;
- canonical CLI help for command names and flags;
- `src/cli/index.ts` for setup targets and behavior;
- the bundled registry for the current skill count and identifiers;
- `docs/SECURITY.md` and `docs/mcp-host-config.md` for safety and MCP details;
- the release, publication, routing, and package smoke checks.

Older planning documents will not be treated as current behavior when they disagree with executable code or tests.

## Non-Goals

- Adding product functionality.
- Adding a logo, screenshots, or generated artwork.
- Adding a roadmap link or release dates for future domains.
- Claiming backend, mobile, or other future packs are currently available.
- Changing the package version, registry contents, CLI behavior, or release process.
- Rewriting the deeper architecture, security, testing, or MCP documents.

## Acceptance Criteria

The redesign is complete when:

- a new reader can explain the product and its current frontend scope from the first two sections;
- the Quick Start reaches the interactive setup flow in two commands;
- the manual workflow explains every write-capable step and preserves dry-run-first behavior;
- the README reports version `0.1.3` context without stale `0.1.0` MVP wording;
- it reports 18 bundled frontend skills;
- supported setup targets match the current CLI;
- future backend, mobile, infrastructure, security, data/AI, QA, and other domains are described as planned rather than available;
- command examples pass their help or smoke checks;
- local documentation links resolve;
- the README contains no unsupported production-readiness or evaluation claims.

## Verification

After editing the README:

1. Run the documented public/local smoke commands that do not modify the repository.
2. Run direct install examples only with `--dry-run`.
3. Check every documented canonical command with CLI help or the command-schema tests.
4. Validate local Markdown links and search for stale `0.1.0` and 15-skill claims.
5. Run the project release gate in an npm-cache environment with valid permissions.
6. Review the final diff solely for README scope and factual consistency.

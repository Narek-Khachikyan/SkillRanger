# Product-First GitHub README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `README.md` with an accurate product-first GitHub landing page that explains SkillRanger, gets a new user through a safe first run, and communicates the current frontend scope plus future domain direction.

**Architecture:** Keep README as the single public entry point and progressively disclose detail: product value first, setup and manual workflows second, then capabilities, safety, MCP, reference material, and contributor information. Derive every behavioral claim from current CLI help, package metadata, registry manifests, and tested release behavior rather than older planning documents.

**Tech Stack:** GitHub-flavored Markdown, Node.js CLI, npm/npx, stdio MCP, existing project release scripts.

## Global Constraints

- Write the README in English.
- Position SkillRanger as a public MVP/beta, not as a production-proven product.
- Present frontend/web as the only currently available domain pack.
- Present backend/API, mobile, infrastructure/DevOps, security, data/AI, QA, and other domains as future directions without dates or a roadmap link.
- Report the current package context as `0.1.3` and the bundled frontend registry as 18 skills.
- Keep `skillranger setup` as the primary first-run path and the transparent manual workflow immediately after it.
- Preserve dry-run-first language for direct installs and precise write boundaries.
- Do not add a logo, generated artwork, badge wall, dependency, or unrelated documentation rewrite.

---

### Task 1: Establish the README accuracy baseline

**Files:**
- Read: `package.json`
- Read: `src/cli/index.ts`
- Read: `registry/skills/*/skill.manifest.json`
- Read: `docs/SECURITY.md`
- Read: `docs/mcp-host-config.md`
- Read: `docs/FRONTEND_SKILL_QUALITY.md`
- Test: `README.md`

**Interfaces:**
- Consumes: compiled `dist/cli/index.js`, package version `0.1.3`, the bundled registry, and current CLI command schema.
- Produces: a frozen factual checklist for the README rewrite: supported setup targets, skill count, command syntax, write boundaries, MCP entrypoint, and beta limitations.

- [ ] **Step 1: Confirm the package and public entrypoints**

Run:

```bash
node dist/cli/index.js --version
node dist/cli/index.js doctor
```

Expected: version `0.1.3`; `doctor` reports 18 registry skills and a valid compiled-binary or source-run mode.

- [ ] **Step 2: Confirm the user-facing command syntax**

Run:

```bash
node dist/cli/index.js setup --help
node dist/cli/index.js scan --help
node dist/cli/index.js recommend --help
node dist/cli/index.js audit --help
node dist/cli/index.js install --help
node dist/cli/index.js installed --help
node dist/cli/index.js domain:list --help
node dist/cli/index.js mcp --help
```

Expected: every command exits zero without performing its normal action; setup and install list the five supported native targets `codex`, `claude-code`, `opencode`, `cursor`, and `gemini-cli`.

- [ ] **Step 3: Record the stale README baseline**

Run:

```bash
rg -n '0\.1\.0|15 low-risk|15 bundled' README.md
```

Expected before editing: stale `0.1.0` and 15-skill claims are found. This establishes the documentation defect that the rewrite must remove.

### Task 2: Replace README with the product-first document

**Files:**
- Modify: `README.md`
- Reference: `docs/superpowers/specs/2026-07-18-github-readme-redesign.md`

**Interfaces:**
- Consumes: the factual checklist from Task 1 and the approved README design spec.
- Produces: the complete GitHub landing page and canonical public usage guide.

- [ ] **Step 1: Replace the hero and first-run experience**

Use this heading order and core copy:

```markdown
# SkillRanger

> Find, audit, and install the right AI agent skills for your codebase.

**Public MVP / Beta** · Local-first · CLI + MCP · Zero runtime dependencies

SkillRanger scans your repository, detects its stack and development context, recommends compatible skills, audits them for common risks, and installs only the files you explicitly approve.

## Why SkillRanger?

AI coding agents become more useful when they have focused, task-specific workflows. Finding compatible skills, understanding why they fit, and reviewing what they will write should not require blind installation.

## Quick Start

```bash
npx -y skillranger@latest doctor
npx -y skillranger@latest setup
```
```

Immediately explain that `setup` scans the current directory, recommends a set, lets the user deselect with Space, and asks for final confirmation before writing. State the expected repo-local outputs: `.agents/skills/<skill>/`, the managed SkillRanger block in `AGENTS.md` unless disabled, and `skillranger.lock.json`.

- [ ] **Step 2: Add the transparent manual workflow**

Document the exact safe sequence:

```bash
npx -y skillranger@latest scan .
npx -y skillranger@latest recommend . --target codex --intent "Review this Next.js app before release" --explain
npx -y skillranger@latest audit frontend.next-app-router-review
npx -y skillranger@latest install frontend.next-app-router-review --project . --target codex --scope repo --dry-run
npx -y skillranger@latest install frontend.next-app-router-review --project . --target codex --scope repo --yes
npx -y skillranger@latest installed .
```

Explain what each step answers: what the project is, which skill fits, whether it is safe, what would be written, explicit apply, and installed-state inspection.

- [ ] **Step 3: Explain how the product works**

Add this compact flow before implementation detail:

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

Describe recommendation lanes as `framework`, `design`, `implementation`, `qa`, and `agent-context`. Show one intent example, one lane example, and one `--capabilities browser,screenshots` example. Explain that visual recommendations remain explicitly unverified when those capabilities are absent.

- [ ] **Step 4: Present current capabilities and future domains accurately**

Create sections named `What SkillRanger Does Today`, `The Frontend Domain`, and `Built for More Than Frontend`.

Group the 18 bundled skills by purpose:

- Framework and implementation: `frontend.next-app-router-review`, `frontend.react-app-review`, `frontend.react-component-design`, `frontend.tailwind-ui-polish`, `frontend.design-to-code`.
- Design and UX: `frontend.visual-design-polish`, `frontend.design-system`, `frontend.ux-critique`, `frontend.interaction-polish`, `frontend.motion-design`, `frontend.motion-audit`, `frontend.visual-critic`.
- Quality and release: `frontend.accessibility-review`, `frontend.performance-review`, `frontend.testing-strategy`, `frontend.playwright-debug`, `frontend.audit`.
- Agent context: `frontend.agents-md-bootstrap`.

State that future backend/API, mobile, infrastructure/DevOps, security, data/AI, QA, and other packs will reuse the domain-agnostic scan, recommendation, audit, install-plan, lockfile, and evaluation pipeline. Do not add dates or a roadmap link.

- [ ] **Step 5: Add compatibility, safety, MCP, and beta boundaries**

List the five current setup targets and mention the generic Agent Skills/universal adapter separately. Add the verified safety properties: bundled local registry, no install-time skill script execution, direct installs default to dry-run, exact repo-local write planning, checksum/version lockfile entries, block-risk rejection, and gated MCP writes.

Use the canonical MCP quick start:

```bash
npx -y skillranger@latest mcp
```

Include the generic stdio host configuration and link to `docs/mcp-host-config.md` for the full tool list and confirmation protocol.

Add a `Beta Status` section that distinguishes tested CLI/MCP/registry/routing behavior from skill-content promotion: the current pack is safe, consistent, and installable, while broader real-task and blinded-human evidence is still being collected.

- [ ] **Step 6: Add grouped reference and contributor sections**

Group canonical commands under:

- Everyday workflow: `doctor`, `scan`, `recommend`, `setup`, `audit`, `install`, `installed`.
- Domains and design: `domain:list`, `domain:inspect`, and the `design:*` family.
- Evaluation and registry: `eval:frontend`, `eval:visual`, `validate:registry`, `lint:skills`, `audit:registry`, `publish:check`.
- Lifecycle and integration: `run:*` and `mcp`.

Keep full flag details discoverable through `skillranger <command> --help` rather than repeating the entire root help block.

End with requirements, global/source development usage, release checks, links to architecture/registry/security/testing/MCP docs, contributing guidance, and the MIT license link.

### Task 3: Verify the README as a public package entry point

**Files:**
- Test: `README.md`
- Test: `package.json`
- Test: `tests/cli.help.test.ts`
- Test: `tests/package-publication.test.ts`

**Interfaces:**
- Consumes: the rewritten README from Task 2.
- Produces: evidence that claims, links, examples, release checks, and package smoke behavior remain valid.

- [ ] **Step 1: Reject stale or unsupported claims**

Run:

```bash
rg -n '0\.1\.0|15 low-risk|15 bundled|production-ready|roadmap' README.md
```

Expected: no matches.

Run:

```bash
rg -n '18 bundled|Public MVP / Beta|backend/API|mobile|infrastructure/DevOps|security|data/AI|QA' README.md
```

Expected: all approved current/future scope markers are present.

- [ ] **Step 2: Validate local Markdown links**

Run:

```bash
node -e 'const fs=require("node:fs");const path=require("node:path");const text=fs.readFileSync("README.md","utf8");const links=[...text.matchAll(/\[[^\]]+\]\((?!https?:|#)([^)]+)\)/g)].map(m=>m[1].split("#")[0]).filter(Boolean);const missing=[...new Set(links)].filter(p=>!fs.existsSync(path.resolve(p)));if(missing.length){console.error(missing.join("\n"));process.exit(1)}console.log(`Validated ${links.length} local links`);'
```

Expected: exit zero and a positive validated-link count.

- [ ] **Step 3: Run the documented safe examples**

Run:

```bash
node dist/cli/index.js doctor
node dist/cli/index.js scan fixtures/next-react-ts
node dist/cli/index.js recommend fixtures/next-react-ts --target codex --intent "Review this Next.js app before release" --explain
node dist/cli/index.js audit frontend.next-app-router-review
node dist/cli/index.js install frontend.next-app-router-review --project fixtures/next-react-ts --target codex --scope repo --dry-run
node dist/cli/index.js installed fixtures/next-react-ts
```

Expected: every command exits zero; the install command prints a plan and does not write fixture files.

- [ ] **Step 4: Run documentation-adjacent and release verification**

Run:

```bash
node --test tests/cli.help.test.ts tests/package-publication.test.ts
env npm_config_cache=/private/tmp/skillranger-readme-release-cache npm run release:check
env npm_config_cache=/private/tmp/skillranger-readme-release-cache npm run smoke:package
git diff --check
```

Expected: focused tests pass, the full release gate exits zero, package smoke reports `skillranger-0.1.3.tgz`, and the diff has no whitespace errors.

- [ ] **Step 5: Review and commit the README**

Run:

```bash
git diff -- README.md
git status --short
git add README.md
git diff --cached --check
git commit -m "docs: rewrite GitHub README for public beta"
```

Expected: the diff contains only the product-first README rewrite; the pre-existing `.pnpm-store/v11/projects/` remains untracked and unstaged; commit succeeds.

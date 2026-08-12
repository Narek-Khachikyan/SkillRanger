# CLI Reference

`skillranger` is a single Node.js binary (`npx -y skillranger@latest` or a local install). Run `skillranger --help` for the full command list; `skillranger <command> --help` shows one command's options.

Requires Node.js 20 or newer.

## Quick start command

```bash
# Interactive setup: scan, recommend, audit, plan, confirm, install
npx -y skillranger@latest setup
```

## Inspecting projects and recommendations

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
```

## Installing skills

```bash
# Preview installation (writes nothing)
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

# Verify lockfile and file integrity
npx -y skillranger@latest verify .

# Remove a skill and update the lockfile
npx -y skillranger@latest uninstall frontend.next-app-router-review --project . --target codex
```

`setup` accepts the same flags as `install` (`--target`, `--scope`, `--copy`, `--yes`, `--intent`, `--lane`, `--limit-per-lane`) and additionally `--no-agent-context` to skip the `AGENTS.md` block for repo scope.

## Task routing

The `task` family prepares a natural-language task into a bounded, reviewable skill set. Two paths are supported: a deterministic fallback that matches the prompt and repository signals against a bounded bilingual vocabulary, and catalog-assisted routing where an MCP host model reads the audited catalog and proposes a prompt-grounded set — which SkillRanger validates before composing the final set. A model cannot add arbitrary skills, bypass audit or compatibility checks, or force an ineligible skill.

```bash
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

## Persisted runs

`run:*` commands start, step, evidence, verify, and finalize persisted runs. Runs track skill reads, execution, evidence, and verification; a run is only verified when every declared gate passes with attached evidence. See [`docs/workflow-runtime.md`](workflow-runtime.md) and [`docs/verification-engine.md`](verification-engine.md) for the full lifecycle.

## Registry and release gates

```bash
npx -y skillranger@latest validate:registry   # manifest schema validation
npx -y skillranger@latest lint:skills         # skill content lint
npx -y skillranger@latest audit:registry      # static audit of every bundled skill
npx -y skillranger@latest publish:check       # validation + audit publication gates
npx -y skillranger@latest release:validate    # frontend release artifact contract
```

## Design pipeline commands

`design:*` commands create briefs, recommend recipes, run browser observations, validate sources, verify artifacts, and produce bounded repair requests. See [`docs/design-rule-library.md`](design-rule-library.md), [`docs/browser-adapter.md`](browser-adapter.md), and [`docs/visual-benchmark.md`](visual-benchmark.md).

## Domain packs

`domain:list` and `domain:inspect` show the installed domain packs and their capabilities. See [`docs/domains/`](domains/).

## MCP server

```bash
npx -y skillranger@latest mcp
```

Starts the stdio MCP server; configure it in the host client per [`docs/mcp-host-config.md`](mcp-host-config.md). `skillranger doctor` prints runtime and registry diagnostics.

# Contributing to SkillRanger

Thanks for considering a contribution. SkillRanger is a local-first AI skill router and package manager: a host model proposes skills from a trusted catalog while SkillRanger validates, composes, audits, and installs bounded instructions.

## Environment

- Node.js 20 or newer.
- pnpm 11.7.0 (see `packageManager` in `package.json`).

```bash
pnpm install
```

## Commands

The scripts below are the canonical build/check/test loop. Run them exactly as they are defined in `package.json` — do not invent alternatives.

| Command | Purpose |
| :--- | :--- |
| `pnpm build` | Compile `src/` to `dist/` with `tsc -p tsconfig.build.json`. |
| `pnpm check` | Syntax-check every source entry point with `node --check`. |
| `pnpm test` | Run the full test suite with `node --test tests/*.test.ts`. |
| `pnpm release:check` | Full gate: build, check, test, registry validation, skill lint, registry audit, publish check, release validation, frontend and router evals, package smoke. |

The CI workflow (`.github/workflows/ci.yml`) runs `pnpm release:check` on pull requests, plus compiled smoke runs on Node 20 and platform smoke on macOS and Windows.

## Creating a skill package

Skill packages live under `registry/skills/<domain>.<name>/`. A package is a folder with:

- `SKILL.md` — the portable instruction document: YAML frontmatter with `name` and `description`, then a focused workflow with decision rules and explicit boundaries. No scripts, no binaries.
- `skill.manifest.json` — the registry metadata: id, tags, source, risk level, permissions, compatibility per target agent, routing vocabulary, and quality scores. `schemas/registry.schema.json` is the contract.

Use an existing package (for example `registry/skills/frontend.agents-md-bootstrap/`) as the shape reference.

Before opening a PR with a new or changed package, run the gates locally:

```bash
pnpm validate:registry   # every manifest validates against the registry schema
pnpm lint:skills         # skill content lint over all bundled packages
pnpm audit:registry      # static security audit over all bundled packages
node src/cli/index.ts audit <skill-id>   # audit one package
```

A package that fails validation, lint, or audit gates cannot be shipped. The registry accepts instruction-only content; patterns such as remote install pipes, credential access, destructive commands, and obfuscated execution are hard-blocked.

## Documentation and demos

- `README.md` is the product surface for visitors and npmjs.com. Keep it under 350 lines; move detail into `docs/` instead of deleting it.
- Every product capability claimed in `README.md` must be traceable to an implementation or a test. Unverifiable claims are removed, not hedged.
- The terminal demo is generated from `docs/demo.tape` with charmbracelet/vhs. Install VHS (`brew install vhs` on macOS, or `go install github.com/charmbracelet/vhs@latest`) and run `pnpm demo` to regenerate `docs/demo.gif` after a CLI output change.

## Pull requests

- Keep changes scoped and the commit history clean: one logical change per commit.
- Add or extend tests for behavior changes. The suite uses `node:test` — follow the patterns in `tests/`.
- Public CLI flags, JSON output schemas, MCP tool contracts, and runtime routing behavior are frozen; propose changes to them in an issue before implementing.
- Run `pnpm release:check` before marking a PR ready; the same gate runs in CI.
- Fill in the pull request template, including the claim-evidence table when the change touches `README.md` or user-facing output.

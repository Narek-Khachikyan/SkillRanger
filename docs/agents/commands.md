# SkillRanger Commands (Agent Guide)

Core commands (`install`/`build`/`check`/`test`), the Node 22 requirement, and running source
directly are in the root `AGENTS.md` — single source of truth. Published `bin` entries point at
`dist/cli/index.js` and `dist/mcp/server.js`.

## Verification commands

```bash
pnpm check              # node --check syntax pass over the main modules
pnpm test               # node --test tests/*.test.ts
pnpm validate:registry  # registry schema + content validation
pnpm lint:skills        # same handler as validate:registry
pnpm audit:registry     # audit every bundled skill
pnpm publish:check      # fails if any skill is not low-risk with zero findings
pnpm release:validate   # frontend 0.4.0 artifact and published-reference gate
pnpm eval:router        # deterministic routing gate
pnpm eval:frontend      # frontend routing/task eval suite
pnpm release:check      # the full CI gate; run before releasing
```

CI (`.github/workflows/ci.yml`) runs `pnpm release:check` on Node 22 and 24, a Node 20 smoke test
against compiled `dist/`, and a macOS/Windows `build` + `test` pass. `pnpm check` uses POSIX shell
syntax, which is why the Windows job runs `test` only.

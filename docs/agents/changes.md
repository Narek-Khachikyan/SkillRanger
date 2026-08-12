# SkillRanger Change-Specific Guidance (Agent Guide)

Rules for editing specific areas of the repository.

- **`registry/skills/**`** — any byte change alters the skill checksum, so existing lockfile entries
  stop verifying. Bump `version`, then run `pnpm validate:registry && pnpm audit:registry`. A skill
  directory may only contain the entries allowlisted in `src/registry/index.ts`; hidden files are
  rejected. Skill manifest validation is hand-written in `src/registry/validation.ts`, not driven by
  `schemas/registry.schema.json`.
- **`schemas/**`, `domains/frontend/**`, `registry/contracts/**`** — published contract data that
  ships in the npm package. Changing a shape is a breaking change for hosts. Only
  `schemas/router-tool-result.schema.json` is loaded by `src/` at runtime.
- **`src/mcp/tools/**`** — a new tool needs a definition with a complete `inputSchema` plus an effect
  descriptor from `src/mcp/tools/types.ts`; anything that writes must declare it. Router tools are
  exempt from central argument validation on purpose — do not "fix" that.
- **`src/runtime/strict/**`** — evidence, gates, and finalization carry the integrity guarantees.
  Change these only with a matching test in `tests/strict-*.test.ts`.
- **`src/router/vocabulary/**` and `domains/frontend/routing.vocabulary.json`** — routing must stay
  deterministic and bilingual (EN/RU). Re-run `pnpm eval:router` and `pnpm eval:frontend` after
  changes.

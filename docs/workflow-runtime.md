# Workflow Runtime

SkillRanger v1 is host-managed. Codex, OpenCode, Claude Code, or another agent host invokes the model, grants tools, and applies changes. SkillRanger provides deterministic contracts and checks.

The design flow is:

```text
scan project
-> create brief
-> validate brief
-> recommend recipe
-> create and validate direction
-> host implements
-> host captures browser observations
-> SkillRanger verifies
-> SkillRanger emits bounded repair request
-> host repairs
-> SkillRanger verifies again
-> compile DESIGN.md
```

No Core command invokes a model, stores provider credentials, or silently edits application files. This keeps model comparisons portable and makes tool permissions visible in the host.

## Skill-run lifecycle

The CLI lifecycle is explicit and persisted under `<project>/.skillranger/runs/<run-id>.json`:

```bash
skillranger run:start . --target opencode --domain frontend --intent "Проверь доступность формы" --json
skillranger run:record-read . --run <run-id> --skill <selected-skill-id> --json
skillranger run:resolve-clarifications . --run <run-id> --answers answers.json --json
skillranger run:begin . --run <run-id> --json
# The host implements the task here.
skillranger run:complete . --run <run-id> --status implemented \
  --artifacts browser-screenshot=artifacts/desktop.png,build-log=artifacts/build.log --json
skillranger run:verify . --run <run-id> --report verification.json --json
skillranger run:inspect . --run <run-id> --json
```

Run `run:record-read` once for every mandatory selected skill. If clarification is not required, move directly from recorded reads to `run:begin`. If it is required, answer every question. When an allowed question is declined, supply one bounded assumption per declined field; the frontend fallback preserves existing conventions, permits at most one signature move, uses neutral placeholders, and does not invent metrics, testimonials, people, brands, or unsupported product claims.

Raw intent is private by default. The run stores a canonical SHA-256 digest and normalized goal, but not the original prompt. CLI users must opt in with `run:start --store-intent`; MCP users must opt in with `storeIntent: true`.

Only `run:verify`/`verify_skill_run` can produce a SkillRanger `verified` state, and only from an implemented run with a structurally valid report, passed hard gates, zero critical findings, and recorded evidence. Missing evidence or capabilities produces `implemented-unverified` or a verification error. External agents may bypass SkillRanger and edit a project directly, but they cannot receive a SkillRanger `verified` outcome without evidence.

CLI and MCP reduce the same lifecycle events into the same canonical run artifact. The equivalent MCP sequence is `start_skill_run`, `record_skill_read`, `resolve_skill_run_clarifications` when required, `begin_skill_run_execution`, `complete_skill_run`, `verify_skill_run`, and `inspect_skill_run`. Given equivalent inputs, normalized artifacts and the verification report SHA-256 digest must match across both surfaces.

## Managed agent context and recovery

Repository-scoped `skillranger setup` creates or updates one bounded `<!-- SKILLRANGER_START -->` / `<!-- SKILLRANGER_END -->` block in `AGENTS.md`. Repeated setup is idempotent and preserves user-authored bytes outside the block. Use `skillranger setup . --no-agent-context --yes` to opt out. Malformed or duplicate markers fail safely instead of rewriting ambiguous user content.

If a run file is corrupt, `run:inspect` and MCP lifecycle calls return `run-integrity`; they never guess or overwrite it. Preserve the invalid file for diagnosis, correct it from a trusted copy only when its run id and checksums can be established, or move it aside and start a new run. Stale abandoned lock files are reclaimed automatically; an active lock is never stolen.

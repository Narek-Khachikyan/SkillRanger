# Frontend Domain Pack

The frontend pack is SkillRanger's reference domain implementation. It owns frontend routing policy, structured design artifacts, product recipes, deterministic validation rules, workflows, and frontend eval slices. Core imports only the generic domain interfaces.

The host remains responsible for model execution and project edits. SkillRanger validates artifacts and browser observations, computes outcomes, and emits bounded repair requests. It never silently edits a project through this runtime.

## Structured Design Flow

1. Create `.design/brief.json` from observed project evidence.
2. Run `skillranger design:validate --brief .design/brief.json`.
3. Run `skillranger design:recommend-recipe --brief .design/brief.json`.
4. Create `.design/direction.json` using the selected recipe.
5. Implement the direction through the selected skill.
6. Record browser observations for required viewports and states. Use `design:observe` with a project-specific browser adapter or provide the same JSON contract through the host.
7. Run `skillranger design:verify` and repair hard findings.
8. Compile `.design/DESIGN.md` from the canonical JSON artifacts.

`verified` requires browser and screenshot capabilities, all required viewport/state evidence, and no hard findings. Otherwise the result remains `implemented-unverified`, `failed`, or `blocked`.

## Enforced skill lifecycle

For skill-driven frontend work, use `run:start` → `run:record-read` for every mandatory selected skill → `run:resolve-clarifications` when requested → `run:begin` immediately before implementation → `run:complete` with artifacts → `run:verify` with evidence → `run:inspect`. Artifacts are persisted at `<project>/.skillranger/runs/<run-id>.json`; raw intent is represented by a digest and is stored only with explicit `--store-intent`/`storeIntent: true` consent.

The MCP equivalents are `start_skill_run`, `record_skill_read`, `resolve_skill_run_clarifications`, `begin_skill_run_execution`, `complete_skill_run`, `verify_skill_run`, and `inspect_skill_run`. Both surfaces share the same state reducer and canonical verification digest. External agents may bypass SkillRanger, but they cannot receive a SkillRanger `verified` outcome without mandatory reads, resolved clarification, an implemented state, passed hard gates, and recorded evidence.

When material product facts remain unknown, clarification is limited to the required fields. A declined allowed question activates the constrained fallback: preserve project conventions, use neutral placeholders, make at most one signature visual move, and do not invent product claims. Corrupt persisted runs fail with `run-integrity`; restore a trusted artifact or start a new run rather than overwriting evidence.

`skillranger setup` manages one marker-bounded lifecycle block in repository `AGENTS.md`, updates it idempotently, and preserves user text outside the markers. Use `--no-agent-context` to opt out; malformed markers fail safely.

## Russian routing release profile

`npm run eval:frontend:ru` runs the frozen Cyrillic routing slice against `fixtures/next-react-ts`; mixed Cyrillic/Latin prompts are part of the Russian slice. `npm run release:check` runs build, syntax checks, all tests, registry validation/lint/audit, the full 157-prompt routing suite, and this Russian gate. For repeated OpenCode task comparisons, use the exact Russian task filter documented in `docs/FRONTEND_SKILL_QUALITY.md`; use the complete real `visual-direction`, `tailwind-execution`, and `design-to-code` slices for promotion variance. Keep the same fixture, `opencode` target, installed versions/checksums, three baselines, and at least three repetitions for each separately pinned and labeled GLM and DeepSeek model. External-model results are analytical evidence and do not block deterministic local build/test gates.

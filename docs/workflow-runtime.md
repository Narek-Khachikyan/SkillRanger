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

## Router preparation and reads

The Universal Prompt Router prepares an existing runtime from one complete task. CLI direct mode uses `skillranger task <project> --intent <task>`; MCP explicit mode uses `prepare_task` and requires a terminal SkillRanger trigger. Production routes use the bundled registry and never auto-install or execute selected packages.

Only `prepared` creates records. Clarification continuation, decomposition, no-match for absent production packs, strict prerequisite failure, and context-budget failure return normal typed outcomes without a partial router or runtime record. A prepared result contains both IDs and an ordered `requiredReads` projection.

Use `skillranger task:read` or MCP `read_run_skill_file` to request `mandatory-next` chunks. The caller supplies a UUID request ID and current read revision but cannot choose the next mandatory skill, path, or offset. Identical retries return the same chunk and revision; conflicting retries and stale revisions fail. Optional inventory files are available only after mandatory reads and are charged to a separate byte budget. Completed mandatory files are atomically recorded in the lifecycle or strict ledger before execution can begin.

Task profiles and router sidecars persist canonical vocabulary, checksums, and a keyed project identity rather than the raw prompt, URLs, unknown free text, or absolute root. CLI raw-intent persistence requires project policy plus `--store-intent --confirm-store-intent`; public router MCP tools do not expose it. Host capability declarations affect eligibility and verification availability but never count as execution evidence.

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

## Strict v2 preview

`run:start --strict` opts into the certified workflow runtime. The start command requires every selected strict skill to match its repository installation and `skillranger.lock.json` checksum. It snapshots the v2 contract, input/output schemas, and every `mustRead` file into the run ledger. Legacy companions may be recorded as excluded; a legacy primary recommendation fails with `strict-contract-missing`.

```bash
skillranger run:start . --strict --target codex --domain frontend \
  --intent "Review frontend performance risks" --inputs strict-inputs.json --json
skillranger run:read-next . --run <run-id> --skill <skill-id> --json
skillranger run:step:begin . --run <run-id> --skill <skill-id> --step <step-id> --json
skillranger run:evidence:add . --run <run-id> --skill <skill-id> --step <step-id> \
  --path evidence.json --kind performance-report --validated-as output --json
skillranger run:step:complete . --run <run-id> --skill <skill-id> --step <step-id> --json
skillranger run:skill:verify . --run <run-id> --skill <skill-id> --json
skillranger run:finalize . --run <run-id> --json
```

`run:read-next` is the only way to create v2 read receipts. Evidence is copied into a content-addressed run artifact directory, hashed, schema-checked when declared as input/output/critic evidence, and attributed to the active step attempt and canonical rule IDs. Verification reports, `hardPassed`, repair requests, and the final outcome are generated by the runtime; callers cannot submit those decisions. A failed hard gate opens an immutable bounded repair request and only fresh attempt evidence participates in the recheck.

Strict certification also validates the complete persisted lifecycle graph on every store read and write. Contract steps must remain exact snapshots with runtime-owned statuses and consecutive attempts; evidence IDs and attributions must resolve to their declared ledger, step, attempt, and rule; report gates, repair history, ledger outcomes, and aggregate run state must agree. In particular, `used` requires completed non-repair workflow steps and a latest passing verification report. Forged or inconsistent persisted state fails with `run-integrity` before it can be finalized or overwritten.

Artifact integrity is mandatory and cannot be disabled by omitting a contract gate. Before parsing evidence or reducing any domain or critic gate, verification reopens every artifact used by the latest attempts and checks project containment, regular-file type, byte size, and SHA-256 digest. A missing, replaced, escaped, resized, or modified artifact fails with `artifact-integrity`.

The strict Tailwind workflow derives browser gates from measurements in `verification-input`; callers do not submit gate decisions. The evidence must use this observation shape:

```json
{
  "observations": [{
    "viewport": { "width": 390, "height": 844 },
    "state": "default",
    "screenshotPath": "evidence/390.png",
    "horizontalOverflow": false,
    "clippedControls": [],
    "unreachableActions": [],
    "stickyOverlaps": [],
    "consoleErrors": [],
    "keyboardTraps": [],
    "invisibleFocus": [],
    "criticalAxeViolations": [],
    "reducedMotionVerified": true
  }]
}
```

`checks` maps and other caller-authored approval fields are rejected: the root object may contain only `observations`, and every observation has the closed shape shown above. Every `screenshotPath` must reference separately ingested screenshot evidence for that viewport; one screenshot cannot stand in for multiple observations. The runtime requires viewport coverage at widths 390, 768, and 1440 and a non-empty `state` label on each observation; it does not prescribe a set of state names. It derives overflow, clipped or unreachable controls, sticky overlap, focus, keyboard, and critical axe accessibility results, console errors, and reduced-motion results from those observations. Any `criticalAxeViolations` entry fails the existing `focus-visible` accessibility hard gate.

`implementation-diff` evidence is diff/source text, not JSON gate decisions. The runtime validates added lines from a structurally valid unified diff, or the complete content when it is not a diff, and derives the Tailwind source gates from the resulting findings. Embedded `checks` properties have no authority.

Integrity-checked critic reports are also runtime inputs, not final decisions. A clean report passes the runtime-owned critic gate; findings fail it until a completed repair attempt is causally linked to the verification report that opened that bounded repair request. Repair then requires fresh downstream evidence and another verification. Unresolved findings consume the contract's existing repair budget and end as `blocked` when `maxRepairIterations` is reached; they cannot produce `used`.

These hardening rules keep CLI and MCP command/result shapes stable, retain execution contract schema `2.0`, add no runtime dependency or hidden process/browser, and leave v1 lifecycle behavior unchanged.

The MCP equivalents are `start_skill_run` with `strict: true`, `read_next_skill_chunk`, `begin_skill_step`, `add_skill_evidence`, `complete_skill_step`, `verify_skill`, `finalize_skill_run`, and `inspect_skill_run`. v1 remains available during preview but is non-certified.

## Managed agent context and recovery

Repository-scoped `skillranger setup` creates or updates one bounded `<!-- SKILLRANGER_START -->` / `<!-- SKILLRANGER_END -->` block in `AGENTS.md`. Repeated setup is idempotent and preserves user-authored bytes outside the block. Use `skillranger setup . --no-agent-context --yes` to opt out. Malformed or duplicate markers fail safely instead of rewriting ambiguous user content.

Current setup migrates the managed block to universal router guidance while preserving its marker pair, surrounding bytes, and existing LF or CRLF convention. The block explains explicit activation and mandatory reads; it is guidance rather than a security boundary. Setup is the only flow that writes `AGENTS.md`; task preparation never does.

If a run file is corrupt, `run:inspect` and MCP lifecycle calls return `run-integrity`; they never guess or overwrite it. Preserve the invalid file for diagnosis, correct it from a trusted copy only when its run id and checksums can be established, or move it aside and start a new run. v1 and strict stores share the same live-owner-safe lock: acquisition is atomic and token-owned, PID liveness and file identity guard stale recovery, and release cannot delete another owner's lock. A dead stale owner can be reclaimed, but age alone never permits stealing a lock from a live process.

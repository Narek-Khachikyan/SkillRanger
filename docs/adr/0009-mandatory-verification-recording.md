# ADR 0009: Mandatory Verification Recording for Verification-Required Lifecycle Runs

- Status: Accepted
- Date: 2026-08-13
- Scope: lifecycle-v1 runtime, complete_skill_run response, managed guidance
- Issue: #109 (follow-up to #108 / ADR 0008)

## Context

ADR 0008 made the always-on core (universal) skill output contracts hard gates of
`verify_skill_run`, and made the server the sole author of the report file. The live test of that
fix (asda project, run `run_236a64b1-…`, lifecycle-v1, `verificationRequired: true`) revealed a
neighboring gap of the same class: **the host never called `verify_skill_run` at all**. The run
persisted as `implemented` with `verification: None`, and the host's final message narrated the
outcome as `implemented-unverified` — a state that never existed in the persisted run (no
`record-verification` event, no `inspect_skill_run` call).

The verification gate only fires when the host actually calls `verify_skill_run`; nothing makes the
call mandatory, and nothing stops a host from narrating an unpersisted outcome.

A hard block on `complete_skill_run(status="implemented")` was considered and rejected:
`record-verification` requires the `implemented` state, so blocking `implemented` closure would make
verification unreachable (state-machine circularity). The enforcement must therefore be guidance
plus a non-blocking server signal, not a transition change.

## Decision

- **Mandatory-verify guidance.** The managed guidance (setup-written AGENTS.md block, MCP server
  instructions) and the `complete_skill_run` / `verify_skill_run` tool descriptions state: when the
  run's policy has `verificationRequired`, calling `verify_skill_run` is a mandatory lifecycle step
  with any allowed outcome — including `implemented-unverified` — and a run closed without a
  recorded verification is incomplete and must be reported as such.
- **Non-blocking server notice.** `complete_skill_run` on a run closed as `implemented` with
  `verificationRequired: true` and no recorded verification returns a deterministic notice
  (`verification-required-unrecorded`) on both the MCP and CLI surfaces. The same notice rides
  `inspect_skill_run` until an outcome is recorded — MCP carries it as an extra content block while
  the structured content stays exactly the persisted run (the narrative rule's source of truth must
  not carry derived signals); CLI `run:inspect` returns it in the `notices` field. The notice is
  scoped to the `implemented` state, the only state `record-verification` accepts: a `failed` or
  `blocked` closure makes verification unreachable, so signalling there would be noise that teaches
  hosts to ignore it. The persisted run schema and state machine are unchanged; the notice does not
  block the `implemented` transition (see circularity above).
- **Persisted-state narrative rule.** Guidance forbids naming any verification outcome that is not
  present in the persisted run: the only source of outcome claims is `inspect_skill_run`. Narrating
  `implemented-unverified` (or any state) without a recorded verification is a violation and must
  be reported as the run's actual state.
- **Parity.** The notice appears identically on MCP and CLI; runs that do record verification (any
  outcome) emit no notice.

## Consequences

- `complete_skill_run` and CLI `run:inspect` gain a notice field in their result envelopes without
  changing the run schema; MCP `inspect_skill_run` keeps the bare persisted run as structured
  content and carries the notice as an extra text block. MCP/CLI parity tests cover both surfaces.
- Managed guidance and tool descriptions change; the AGENTS.md block snapshot test is updated.
- Regression tests cover the notice (verification-required + unrecorded), its absence (verification
  recorded), and parity.
- Residual risk, documented: a host may still ignore the notice and the guidance; the persisted run
  remains the deterministic source of truth either way, and the notice makes the incomplete state
  machine-visible in the same response that closes the run.
- Strict-v2 is unaffected: its `finalize_skill_run` path already certifies completion explicitly.

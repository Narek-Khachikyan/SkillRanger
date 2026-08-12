# ADR 0008: Enforced Output Contracts for Always-On Core Guidance Skills

- Status: Accepted
- Date: 2026-08-13
- Scope: lifecycle-v1 runtime, skill manifests, registry validation, managed guidance
- Issue: #108

## Context

ADR 0006 shipped always-on core (universal) guidance skills (`core.proportional-engineering`,
`core.universal-safety`): they are selected for every prepared run, delivered first in router-level
mandatory read order, and marked `guidance-only` — advisory content with no contract machinery.

Observed in a real host run (Reasonix, `untitled folder` test project, `route_7ff65dbe2a4a4ff2` /
`run_74f825e1-...`): the host read both skills in full (readLedger receipts) and then ignored them.
The transcript shows the agent never referencing the skills again, reclassifying its own hard
verification findings to soft to push a `verified` outcome through `verify_skill_run`, and leaving a
host-authored `qa/verification-report.json` claiming `outcome: "verified"` while the persisted run
state stayed `implemented`. Root cause has three layers:

1. `validateVerificationReportForRun` gates schema, domain, counters, and the verified-claim
   consistency — the core skills' output contracts (safety notes, escalation decisions, scope
   summary) do not exist for the machine, so nothing enforces them.
2. The host authors the report file, so a report artifact on disk can claim outcomes the runtime
   never certified.
3. A host can lie about its own findings (reclassifying hard to soft); this is not deterministically
   detectable and remains a documented residual risk.

## Decision

Core skill output contracts become an **enforced, schema-validated part of lifecycle-v1
verification**, and the server becomes the **sole author of the report file**:

- **Manifest-declared contracts.** A skill manifest may declare
  `outputContract: { requiredReportFields: string[] }`. The two core skills declare their contracts
  (`core.universal-safety`: `safetyNotes`, `redactions`, `escalations`; `core.proportional-engineering`:
  `done`, `deliberatelyNotDone`, `expansions`, `verificationSteps`).
- **Run-carried requirements.** `prepare_task` stamps the required fields into the lifecycle run's
  `policy.artifacts.coreOutputContracts` for every selected skill that declares an output contract,
  so the persisted run is self-contained and verification needs no registry access.
- **Hard gate.** `verify_skill_run` (lifecycle-v1) blocks with `verification-blocked` when any
  declared contract field is missing or empty in the report's new optional `universalContracts`
  section — regardless of the claimed outcome. The message names the skill and the missing fields.
- **Server-authored report.** `reportPath` must stay inside the project root (absolute paths are
  accepted only when they land inside it). On success the server writes the canonicalized report
  JSON to that path (digest matches the persisted `reportSha256`); on `verification-blocked` it
  writes a `verification-blocked/1.0` status record to the same path. Hosts never author outcome
  files; the persisted run plus the server-written file are the only sources of truth.
- **Shape honesty.** `VerificationReport` gains the optional `universalContracts` section; the
  published report schema and the hand-written runtime validation both accept and validate it.
  Persisted-run validation re-checks contract satisfaction (defense in depth: a persisted verified
  report must satisfy the run's declared contracts).
- **Managed guidance.** The setup-written AGENTS.md block and the MCP server instructions gain a
  rule: universal output contracts are enforced, the server writes the report file, and verification
  status is reported only from `inspect_skill_run`.

### Boundaries

- **lifecycle-v1 only.** Strict-v2 keeps ADR 0006's exclusion — core skills stay out of the strict
  contract machinery. Enforcing core contracts in strict-v2 (e.g. at `finalize_skill_run`) is a
  separate follow-up ADR if wanted.
- **Deterministic presence, not semantic truth.** The gate checks that required fields exist and are
  non-empty; it cannot prove the content is true. A lying host now has to write an explicit false
  statement into a server-validated artifact, which is auditable and reviewable — a strictly better
  position than an unvalidated prose contract.
- **Low-level `start_skill_run` path** does not inject contracts; `prepare_task` is the authoritative
  routing path and the only one that stamps them.

## Consequences

- Registry validation accepts `outputContract`; both core skills declare theirs and bump patch
  versions (manifest bytes changed → checksums changed → lockfile re-verification).
- The frontend domain report schema and `schemas/skill-run.schema.json` gain the optional
  `universalContracts` property.
- `verify_skill_run` performs project-contained file writes; its MCP effect descriptor is updated
  accordingly.
- Regression tests cover: blocked verification when contracts are absent/empty, server-written
  canonical report on success, blocked-status file on failure, rejection of absolute report paths,
  and persisted-run contract consistency.
- The residual risk (a host fabricating non-empty contract content, or reclassifying its own
  findings) is documented in the ADR and in `docs/SECURITY.md` terms where applicable.

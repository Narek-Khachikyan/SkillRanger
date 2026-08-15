# ADR 0010: Migration-First on Strict-v2; Lifecycle-v1 Gets Stopgap Ergonomics Only

- Status: Accepted
- Date: 2026-08-15
- Scope: lifecycle-v1 verification ergonomics, strict-v2 migration posture

## Context

A live lifecycle-v1 session (Avatar project, run `run_65be0500-…`, 2026-08-15) spent ~28 failed
`verify_skill_run` calls discovering the verification report's shape one validation error at a
time. Root cause was not the report contract itself but its invisibility: the tool published
`report: { type: "object" }` while the full shape lived only in the server-side hand-rolled
validator, which fails fast — exactly one violation per call. The always-on output contracts
(ADR 0008) were discoverable only after tripping `verification-blocked`.

The same session class of problem does not exist in strict-v2: `verify_skill` evaluates declared
gates server-side from attached evidence, so the host never authors a verification report at all.

Two paths were considered:

- **Migration only, v1 untouched** — zero patches, but every non-migrated host keeps hitting the
  same wall until it migrates.
- **Refuse non-strict runs** — force hosts onto strict-v2 now; rejected because strict mode has a
  real entry barrier (installed skills, `skillInputs`, `hostCapabilities`) and casual sessions
  would degrade into install flows instead of runs. SkillRanger also does not control which mode
  a host requests: `strict` is a host-supplied flag with a config default.

## Decision

- **Migration-first**: strict-v2 is the strategic target; effort goes into making it the default
  path, not into deepening lifecycle-v1.
- **Stopgap, not repair**: lifecycle-v1 verification gets exactly three ergonomics fixes and
  nothing structural:
  1. the full verification-report shape is published inline in `verify_skill_run`'s `inputSchema`
     (the precedent set by `compare_design_variants` / `verify_visual_result` for
     `criticReport`);
  2. report-form validation collects **all** violations in one pass instead of failing on the
     first (fail-fast produced the 28-iteration loop);
  3. errors carry machine-readable `details` (e.g. `problems`, `requiredContractFields`) so hosts
     can parse instead of re-deriving shape from prose.
- **Single source of truth**: the published schema and the validator are composed from the same
  exported field-set/enum constants in `src/runtime/skill-run/validation.ts`; drift between the
  published shape and the enforced shape is impossible by construction. No JSON-schema library is
  added (zero-runtime-dependency constraint holds).
- **ADR 0008 boundary unchanged**: always-on output contracts remain hard requirements for every
  outcome including `implemented-unverified`. The Avatar session's failure was shape
  invisibility, not the contract rule.

## Consequences

- Lifecycle-v1 remains fully supported but frozen: structural verification changes now route to
  strict-v2 work instead.
- `inputSchema` for `report` stays a static shape; per-run required contract fields
  (`policy.artifacts.coreOutputContracts`) remain dynamic and are surfaced through
  `inspect_skill_run` and the enriched error `details`, not the static schema.
- **Host-visible error-code change**: the MCP boundary validates tool arguments against
  `inputSchema` before dispatch, so a report violating the published shape now fails with
  `invalid-arguments` at the boundary instead of `run-integrity` from the report validator. The
  collect-all `run-integrity` result with `details.problems` remains reachable for
  schema-passing-but-contract-violating reports and for the CLI path, which does not go through
  MCP argument validation.
- The published schema's per-field constraints are exactly the validator's (e.g. contract
  statements matching `\\S`, rejecting whitespace-only strings the validator's trimmed-blank
  rule rejects), keeping the "cannot drift by construction" claim honest field by field.
- A follow-up ADR is required if lifecycle-v1's verification contract itself is ever reopened.

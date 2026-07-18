# MCP Host Config

SkillRanger exposes a local stdio MCP server through the npm package. For public npm users, prefer the `skillranger` package entrypoint through npx:

```bash
npx -y skillranger@latest mcp
```

Global installs can use `skillranger mcp`. The `skillranger-mcp` binary remains a convenience entrypoint for installed package users, but it is not the primary npx path because `npx skillranger-mcp` searches for a separate package named `skillranger-mcp`.

From a source checkout, use `node src/mcp/server.ts`. For direct compiled smoke checks, use `node dist/mcp/server.js` after `npm run build`.

The server is designed for host-managed approval flows. SkillRanger publishes effect metadata for every MCP tool. Read-only tools do not mutate project state. `install_skill` writes only after exact-plan confirmation. Skill-run lifecycle tools persist state under `.skillranger/runs` using host-managed mutation approval. `capture_ui_evidence` executes a host-reviewed command and writes artifacts inside `projectRoot`; it requires `confirm: true` but does not use install-plan fields.

`outputDir` confinement does not sandbox `commandTemplate`; the host must review the full command because its side effects can extend beyond the declared capture destination.

## Generic stdio entry

Use this shape for MCP hosts that accept a command plus arguments:

```json
{
  "name": "skillranger",
  "command": "npx",
  "args": ["-y", "skillranger@latest", "mcp"],
  "cwd": "/path/to/project"
}
```

Global-install fallback:

```json
{
  "name": "skillranger",
  "command": "skillranger",
  "args": ["mcp"],
  "cwd": "/path/to/project"
}
```

Installed-package convenience binary:

```json
{
  "name": "skillranger",
  "command": "skillranger-mcp",
  "args": [],
  "cwd": "/path/to/project"
}
```

If the host supports environment variables, keep this server minimal. It does not need network tokens or registry credentials for the MVP local registry.

## Tool Surface

SkillRanger exposes 31 tools in four effect classes, each with a distinct host approval boundary.

### Read-only (17)

- `analyze_project` scans a project and returns a stack fingerprint.
- `recommend_skills` ranks registry skills for a project and target agent, with optional `lane` and `limitPerLane` filters.
- `audit_skill` audits one local registry skill package for MVP security findings.
- `list_installed_skills` reads `skillranger.lock.json`.
- `plan_skill_install` returns a dry-run installer plan with intended writes and does not modify files.
- `list_domains` lists the available domain policies.
- `inspect_domain` reads one domain policy and its supported capabilities.
- `create_frontend_design_brief` creates a frontend design brief from supplied project context.
- `recommend_frontend_recipe` recommends a frontend implementation recipe for a design brief.
- `validate_frontend_result` validates a frontend result against its design requirements.
- `compile_frontend_design_spec` compiles a frontend design brief into an implementation specification.
- `verify_frontend_result` verifies a frontend result using the canonical frontend verifier.
- `repair_frontend_result` prepares a bounded frontend repair request without applying it.
- `run_domain_eval` evaluates a domain workflow from supplied inputs.
- `inspect_skill_run` reads the current persisted skill-run state without changing it.
- `compare_design_variants` prepares an independent critic exchange or validates its returned report.
- `verify_visual_result` runs the canonical strict final visual verifier.

### Exact-plan install (1)

- `install_skill` installs a skill only when `confirm: true`, `expectedWrites`, and `expectedLockfileUpdates` exactly match the current dry-run plan.

### Persisted run-state transitions (12)

These tools use host-managed mutation approval and update the persisted run JSON under `.skillranger/runs`.

- `start_skill_run` prepares and persists a skill run from project signals, intent, and domain policy.
- `record_skill_read` records a selected skill checksum as read for a skill run.
- `resolve_skill_run_clarifications` resolves required clarifications with JSON-native answers, declines, and assumptions.
- `begin_skill_run_execution` transitions a prepared skill run into execution.
- `complete_skill_run` records an execution status and JSON-native artifacts.
- `verify_skill_run` records a JSON-native verification report for an implemented skill run.
- `read_next_skill_chunk` reads the next strict-skill content chunk and writes persisted read progress, despite its name.
- `begin_skill_step` starts a strict v2 skill step in the persisted run.
- `add_skill_evidence` adds attributed evidence to the active strict v2 skill step.
- `complete_skill_step` completes the active strict v2 skill step.
- `verify_skill` verifies a strict v2 skill in the persisted run.
- `finalize_skill_run` finalizes a strict v2 skill run.

### Confirmed command and artifact write (1)

- `capture_ui_evidence` executes the reviewed browser-evidence command and writes its artifacts within `projectRoot` after `confirm: true`.

`recommend_skills` arguments:

- `projectRoot`: project directory to scan. Defaults to the host working directory.
- `registryRoot`: local registry directory. Defaults to `registry`.
- `targetAgent`: target agent id. Defaults to `codex`.
- `userIntent`: optional natural-language task intent used as a ranking signal.
- `lane`: optional lane filter. Allowed values: `framework`, `design`, `implementation`, `qa`, `agent-context`.
- `limitPerLane`: optional positive integer cap for each returned recommendation group.

Examples:

```json
{"projectRoot":"fixtures/next-react-ts","targetAgent":"codex","lane":"design"}
{"projectRoot":"fixtures/next-react-ts","targetAgent":"codex","limitPerLane":2}
```

The tool returns both flat `recommendations` and grouped `recommendationGroups`; hosts should prefer groups when rendering lane-aware UI. Each recommendation includes `reasons` and `scoreBreakdown` so hosts can explain why a skill was recommended without reverse-engineering the ranking formula.

## Skill-run example and CLI parity

All lifecycle transition and read-progress tools update the persisted run JSON; `inspect_skill_run` is the only read-only lifecycle tool.

Call the lifecycle tools in this order:

```jsonl
{"name":"start_skill_run","arguments":{"projectRoot":"/path/to/project","targetAgent":"opencode","domain":"frontend","intent":"Проверь доступность формы"}}
{"name":"record_skill_read","arguments":{"projectRoot":"/path/to/project","runId":"<run-id>","skillId":"frontend.accessibility-review","checksum":"sha256:<selected-checksum>"}}
{"name":"resolve_skill_run_clarifications","arguments":{"projectRoot":"/path/to/project","runId":"<run-id>","answers":[],"declinedFields":[],"assumptions":[]}}
{"name":"begin_skill_run_execution","arguments":{"projectRoot":"/path/to/project","runId":"<run-id>"}}
{"name":"complete_skill_run","arguments":{"projectRoot":"/path/to/project","runId":"<run-id>","status":"implemented","artifacts":[{"kind":"test","path":"artifacts/test.log","description":"Focused tests"}]}}
{"name":"verify_skill_run","arguments":{"projectRoot":"/path/to/project","runId":"<run-id>","reportPath":"verification.json","report":{"schemaVersion":"1.0","domain":"frontend","workflowId":"frontend-accessibility-review","iteration":0,"capabilityStatus":"ready","executionStatus":"implemented","verificationStatus":"passed","outcome":"verified","findings":[],"gates":{"hardPassed":true,"criticalFindings":0,"highFindings":0},"evidence":[{"kind":"test","path":"artifacts/test.log","description":"Focused tests passed"}],"residualRisks":[]}}}
{"name":"inspect_skill_run","arguments":{"projectRoot":"/path/to/project","runId":"<run-id>"}}
```

Omit `resolve_skill_run_clarifications` only when the returned clarification status is `not-required`. The equivalent CLI commands are `run:start`, `run:record-read`, `run:resolve-clarifications`, `run:begin`, `run:complete`, `run:verify`, and `run:inspect`. Hosts should compare normalized run fields and `verification.reportSha256` when checking CLI/MCP parity.

The privacy and guarantee boundary is identical on both surfaces: raw prompt storage is opt-in, and a host or external agent may bypass the lifecycle but cannot obtain a SkillRanger `verified` outcome until mandatory reads, clarification, execution, and evidence-backed verification are recorded.


## Install Confirmation Flow

This flow applies only to `install_skill`.

1. Call `plan_skill_install`.
2. Show the returned `plan.writes` and `plan.lockfileUpdates` to the user.
3. If approved, call `install_skill` with:
   - `confirm: true`
   - `expectedWrites: plan.writes`
   - `expectedLockfileUpdates: plan.lockfileUpdates`

If the current plan differs from the expected paths, installation is rejected. If audit risk is `block`, the tool returns `isError: true` with `reason: "audit-blocked"` and does not write files.

## UI Capture Confirmation Flow

1. Show `commandTemplate`, `baseUrl`, resolved `projectRoot`, and requested `outputDir`.
2. Require user/host approval before sending `confirm: true`.
3. Expect rejection when `outputDir` escapes `projectRoot`.
4. Treat the invoked command as open-world and potentially destructive according to MCP annotations.
5. Do not send install-only `expectedWrites` or `expectedLockfileUpdates` fields.

## Tool Error Codes

Expected tool-level failures return an MCP tool result with `isError: true`, `ok: false`, and a stable `code` in `structuredContent`. Hosts should branch on these codes rather than parsing message text.

- `confirmation-required`: `install_skill` was called without `confirm: true`.
- `stale-plan`: expected paths do not match the current install plan.
- `audit-blocked`: audit risk is `block`; no files were written.
- `unsupported-target`: no MVP adapter exists for the requested target agent.
- `skill-not-found`: the requested skill id does not exist in the registry.
- `invalid-arguments`: tool arguments have the wrong shape.
- `unknown-tool`: the requested MCP tool is not implemented.
- `run-integrity`: a persisted run or supplied lifecycle artifact is corrupt or inconsistent. Preserve it for diagnosis; restore a trusted copy or start a new run rather than overwriting it in place.

Unexpected implementation failures still surface as JSON-RPC internal errors.

## Smoke Test

Send newline-delimited JSON-RPC over stdin:

```jsonl
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

The server writes only JSON-RPC messages to stdout. Logs and host diagnostics should use stderr if added later.

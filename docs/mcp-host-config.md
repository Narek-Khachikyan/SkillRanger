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

If the host supports environment variables, set `SKILLRANGER_PROJECT_ROOT` to the authorized project. Router tools canonicalize this root once at startup; when the variable is absent they use startup `cwd`. Startup fails if the root is not a real directory. The server does not need network tokens or registry credentials for the bundled registry.

## Universal Router

Use the router only after an explicit trigger: `@skillranger`, `/sr`, or a terminal `skillranger`; `@skillranger` and `/sr` may lead or end the prompt, while a bare leading `skillranger` is not a trigger. The model cannot select activation mode, project root, registry root, or raw-intent persistence. The router uses the fixed server root and bundled audited registry.

For model-assisted routing on a current server, follow this sequence:

1. Call `inspect_skill_catalog` with `{}` after the explicit trigger.
2. Follow every `nextCursor` with the preceding `catalogDigest` as `expectedCatalogDigest` until `complete: true`. Treat the `catalogReceipt` on that final page as proof of complete delivery, not proof of model comprehension.
3. Submit a prompt-grounded `routingProposal` to `prepare_task` using that final digest and receipt. If `prepare_task` returns `catalog_refresh_required`, discard the old proposal and receipt, restart catalog inspection with `{}`, and submit a new proposal.
4. Call `prepare_task` with the complete, unmodified prompt, including its trigger. Do not combine `routingProposal` with legacy `semanticHints`.
5. For a `prepared` result, call `read_run_skill_file` in `mandatory-next` mode in order until `readStatus.runMandatoryReadsComplete` is true. Only then resolve runtime clarification or begin the returned runtime run.

If `inspect_skill_catalog` is unavailable because the host is connected to a legacy SkillRanger server, use the compatibility path: call `prepare_task` with the complete prompt and omit `routingProposal`. Do not treat an unavailable catalog tool as a routing failure. Once the MCP server is configured, non-strict catalog-assisted routing does not require `skillranger setup`; setup remains useful for strict workflow installation and for writing the managed guidance. That managed guidance is advisory and is not a security boundary.

Normal outcomes are `prepared`, `clarification_required`, `decomposition_required`, `no_matching_skills`, `strict_requirements_unmet`, and `context_budget_exceeded`. Only `prepared` creates a router sidecar and one lifecycle-v1 or strict-v2 runtime record. Clarification provides a short-lived opaque continuation token; resend the same canonical task with `continuationToken` and closed-option `clarificationAnswers`. Decomposition and no-match do not create partial runs.

For a prepared run, call `read_run_skill_file` in `mandatory-next` mode with a new UUID `readRequestId` and the current `expectedReadRevision`. The server chooses the next skill, path, offset, and UTF-8 chunk. Replaying the same bound request ID returns the same content and revision. Do not begin the runtime until `readStatus.runMandatoryReadsComplete` is true.

`hostCapabilities` describe what the host can provide; they are not verification evidence. Missing optional verification capabilities produce guidance-only or unverified outcomes. Strict mode additionally requires every selected skill to be repo-installed with matching lockfile and files, contract v2, accepted inputs, and complete strict reads.

Supply accepted inputs with `skillInputs`, a map from bundled skill id to that skill's input object. It is available only with `strict: true`, accepts at most 32 entries, and rejects any id that is not in the bundled registry. Each skill declares its required object in `input.schema.json`, which is readable inside the installed skill directory after `install_skill`; an entry that does not validate leaves the skill reported as a missing `skill-input` requirement. The CLI equivalent is `task --strict --skill-inputs <file>`.

```json
{"prompt":"улучши визуальное качество главной страницы @skillranger","strict":true,"hostCapabilities":["browser","screenshots"],"skillInputs":{"frontend.visual-design-polish":{"brief":{},"capabilityProfile":"standard","changeClass":"material"}}}
```

The router never auto-installs a missing skill. A lifecycle `record_skill_read` is checksum attestation only; it does not prove content delivery. Only mandatory reads completed through `read_run_skill_file` are persisted as `content-delivered` and can support lifecycle `verified`.

The persisted task profile contains canonical routing vocabulary and digests, not raw prompts, URLs, arbitrary free text, or absolute project roots. Optional skill files use progressive disclosure and become readable only after mandatory instructions are complete.

## Tool Surface

SkillRanger exposes 34 tools in four effect classes, each with a distinct host approval boundary.

### Read-only (18)

- `analyze_project` scans a project and returns a stack fingerprint.
- `recommend_skills` ranks registry skills for a project and target agent, with optional `lane` and `limitPerLane` filters.
- `inspect_skill_catalog` delivers the complete trusted bundled skill catalog through digest-bound pages without scanning project state.
- `audit_skill` audits one local registry skill package for MVP security findings.
- `list_installed_skills` reads `skillranger.lock.json`.
- `plan_skill_install` returns a dry-run installer plan with intended writes and does not modify files.
- `list_domains` lists the available domain policies.
- `inspect_domain` reads one domain policy and its supported capabilities.
- `create_frontend_design_brief` creates a frontend design brief from supplied project context.
- `recommend_frontend_recipe` recommends a frontend implementation recipe for a design brief.
- `validate_frontend_result` validates a frontend result against its design requirements.
- `compile_frontend_design_spec` compiles a frontend design brief into an implementation specification.
- `verify_frontend_result` applies the same stateless frontend hard gates as `validate_frontend_result` and adds a `notice` field marking the result non-certifying. It does not create, advance, or certify a strict run.
- `repair_frontend_result` prepares a bounded frontend repair request without applying it.
- `run_domain_eval` evaluates a domain workflow from supplied inputs.
- `inspect_skill_run` reads the current persisted skill-run state without changing it.
- `compare_design_variants` prepares a critic exchange with host-attested actor separation or validates its returned report. Distinct actor IDs do not technically prove independent execution.
- `verify_visual_result` runs the canonical strict final visual verifier.

### Exact-plan install (1)

- `install_skill` installs a skill only when `confirm: true`, `expectedWrites`, and `expectedLockfileUpdates` exactly match the current dry-run plan.

### Persisted run-state transitions (14)

These tools use host-managed mutation approval and update the persisted run JSON under `.skillranger/runs`.

- `prepare_task` is the canonical authoritative entrypoint: it routes one explicitly activated prompt and atomically creates a router sidecar plus runtime only for a prepared outcome.
- `read_run_skill_file` delivers an integrity-pinned prepared skill chunk and atomically bridges completed mandatory reads into the runtime ledger.
- `start_skill_run` prepares and persists a low-level compatibility lifecycle run from project signals, intent, and domain policy.
- `record_skill_read` records checksum attestation only; standalone attestation cannot produce `verified`.
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

- `capture_ui_evidence` executes the reviewed browser-evidence command and writes its artifacts within `projectRoot` after `confirm: true`. It returns the canonical `bundle.json` shape, including the persisted evidence `id`, `variantId`, `sourceIdentity`, and the optional non-negative `iteration` used to distinguish a fresh recheck.

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

For an authoritative non-strict lifecycle, call `prepare_task`, read every mandatory file with `read_run_skill_file` until `runMandatoryReadsComplete` is true, then use the returned runtime run ID for clarification, begin, complete, and verify. The low-level compatibility example below may persist a run, but checksum-only reads can finish only as `implemented-unverified` or another non-verified outcome.

Call the lifecycle tools in this order:

```jsonl
{"name":"start_skill_run","arguments":{"projectRoot":"/path/to/project","targetAgent":"opencode","domain":"frontend","intent":"Проверь доступность формы"}}
{"name":"record_skill_read","arguments":{"projectRoot":"/path/to/project","runId":"<run-id>","skillId":"frontend.accessibility-review","checksum":"sha256:<selected-checksum>"}}
{"name":"resolve_skill_run_clarifications","arguments":{"projectRoot":"/path/to/project","runId":"<run-id>","answers":[],"declinedFields":[],"assumptions":[]}}
{"name":"begin_skill_run_execution","arguments":{"projectRoot":"/path/to/project","runId":"<run-id>"}}
{"name":"complete_skill_run","arguments":{"projectRoot":"/path/to/project","runId":"<run-id>","status":"implemented","artifacts":[{"kind":"test","path":"artifacts/test.log","description":"Focused tests"}]}}
{"name":"verify_skill_run","arguments":{"projectRoot":"/path/to/project","runId":"<run-id>","reportPath":"verification.json","report":{"schemaVersion":"1.0","domain":"frontend","workflowId":"frontend-accessibility-review","iteration":0,"capabilityStatus":"ready","executionStatus":"implemented","verificationStatus":"partial","outcome":"implemented-unverified","findings":[],"gates":{"hardPassed":true,"criticalFindings":0,"highFindings":0},"evidence":[{"kind":"test","path":"artifacts/test.log","description":"Focused tests passed"}],"residualRisks":[]}}}
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
6. For an initial capture and its recheck, use distinct evidence ids and source identities, retain the selected variant id, and increment `iteration` for the recheck.

## Critic and Verification Contracts

Three distinct contracts share similar names. Submitting one where another is expected is rejected.

- **`VisualCriticReport` v1** (`schemaVersion` `1.0`) is the `criticReport` argument of `compare_design_variants` and `verify_visual_result`. Its full JSON Schema is published on both tools and ships at `registry/skills/frontend.visual-critic/output.schema.json`.
- **`CriticReportV2`** (`schemaVersion` `2.0`) is the strict-run evidence submitted with `add_skill_evidence` as `critic-report`. It is a closed shape: `schemaVersion`, `skillId`, `criticInvocationId`, `executorInvocationId`, `outcome`, `evidenceArtifactIds`, `findings`. Its invocation IDs must differ as a host attestation of separation; this is not technical proof of independent execution. Rejections carry `requiredFields` in the error details.
- **Browser verification input** is the strict-run evidence submitted as `verification-input` for skills whose gates use the `frontend/browser-hard-gates` validator. It must be exactly `{ "observations": [...] }` with real captured observations. Each closed observation requires `stateRendered: true`, a non-empty `action`, and `changes` containing at least one locator whose `before` and `after` values differ. Self-declared pass flags are rejected. Other skills use a different `verification-input` shape, so this contract applies only to that validator.

## Tool Error Codes

Expected tool-level failures return an MCP tool result with `isError: true`, `ok: false`, and a stable `code` in `structuredContent`. Hosts should branch on these codes rather than parsing message text.

- `confirmation-required`: either confirmed-write tool (`install_skill` or `capture_ui_evidence`) was called without `confirm: true`. Only `install_skill` uses the install-plan `expectedWrites` and `expectedLockfileUpdates` fields.
- `stale-plan`: expected paths do not match the current `install_skill` plan.
- `audit-blocked`: audit risk is `block`; no files were written.
- `run-blocked`: `finalize_skill_run` finalized a strict run in a terminal state other than `verified`. The terminal state is persisted before the error, so `inspect_skill_run` still reports it. Details carry `state`, `userMessage`, and `blockedSkills`, each entry naming `reason` (`hard-gates-failed` or `unmet-prerequisites`), `failedHardGates`, and `unmetPrerequisites`. A run blocked before execution has no verification report and therefore no failed gates.
- `capture-failed`: `capture_ui_evidence` ran but the browser adapter or its returned payload violated the evidence contract. Argument-shape problems return `invalid-arguments` instead. Unexpected implementation faults still surface as JSON-RPC internal errors.
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

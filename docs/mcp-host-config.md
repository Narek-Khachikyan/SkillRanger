# MCP Host Config

SkillRanger exposes a local stdio MCP server through the npm package. For public npm users, prefer the `skillranger` package entrypoint through npx:

```bash
npx -y skillranger@latest mcp
```

Global installs can use `skillranger mcp`. The `skillranger-mcp` binary remains a convenience entrypoint for installed package users, but it is not the primary npx path because `npx skillranger-mcp` searches for a separate package named `skillranger-mcp`.

From a source checkout, use `node src/mcp/server.ts`. For direct compiled smoke checks, use `node dist/mcp/server.js` after `npm run build`.

The server is designed for host-managed approval flows. Most tools are read-only. `plan_skill_install` only returns a dry-run plan and does not write files. `install_skill` is write-capable and requires explicit confirmation plus exact expected writes from a current dry-run plan.

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

- `analyze_project`: scan a project and return a stack fingerprint.
- `recommend_skills`: rank registry skills for a project and target agent; accepts optional `lane` and `limitPerLane` filters.
- `audit_skill`: audit one registry skill package.
- `list_installed_skills`: read `skillranger.lock.json`.
- `plan_skill_install`: return a dry-run installer plan with intended writes.
- `install_skill`: install only when `confirm: true`, `expectedWrites`, and `expectedLockfileUpdates` match the current plan.

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


## Install Confirmation Flow

1. Call `plan_skill_install`.
2. Show the returned `plan.writes` and `plan.lockfileUpdates` to the user.
3. If approved, call `install_skill` with:
   - `confirm: true`
   - `expectedWrites: plan.writes`
   - `expectedLockfileUpdates: plan.lockfileUpdates`

If the current plan differs from the expected paths, installation is rejected. If audit risk is `block`, the tool returns `isError: true` with `reason: "audit-blocked"` and does not write files.

## Tool Error Codes

Expected tool-level failures return an MCP tool result with `isError: true`, `ok: false`, and a stable `code` in `structuredContent`. Hosts should branch on these codes rather than parsing message text.

- `confirmation-required`: `install_skill` was called without `confirm: true`.
- `stale-plan`: expected paths do not match the current install plan.
- `audit-blocked`: audit risk is `block`; no files were written.
- `unsupported-target`: no MVP adapter exists for the requested target agent.
- `skill-not-found`: the requested skill id does not exist in the registry.
- `invalid-arguments`: tool arguments have the wrong shape.
- `unknown-tool`: the requested MCP tool is not implemented.

Unexpected implementation failures still surface as JSON-RPC internal errors.

## Smoke Test

Send newline-delimited JSON-RPC over stdin:

```jsonl
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

The server writes only JSON-RPC messages to stdout. Logs and host diagnostics should use stderr if added later.

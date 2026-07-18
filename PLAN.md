# SkillRanger Reliability Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Track progress with the checkboxes below and do not skip the red test in any task.

**Goal:** Remove the verified release, persistence, lock-ownership, and MCP audit-provenance defects without changing the public lockfile schema or user-visible CLI behavior.

**Architecture:** Use the existing filesystem-visible `RunFileLock` to serialize every install-lockfile transaction across independent processes, and atomically replace the destination from a same-directory temporary file. Make `applyInstall` the sole owner of the audit used to gate, persist, and report an installation. Harden `RunFileLock` with versioned best-effort process identity plus a bounded fallback for platforms where identity is unavailable. Derive release identity and tarball paths from `package.json`/`npm pack` output instead of hardcoded versions.

**Tech Stack:** TypeScript 6, Node.js built-in modules, Node test runner, npm/pnpm, MCP JSON-RPC.

## Global Constraints

- Runtime support remains Node.js `>=20.0.0`; CI/source TypeScript commands continue to run on Node.js 24.
- Add no runtime or development dependency.
- Preserve lockfile schema version `1.0` and the current installed-entry JSON shape.
- Preserve CLI flags, CLI JSON shape, MCP tool inputs, `audit-blocked`, `stale-plan`, and confirmation behavior.
- A lockfile transaction lock must be visible across independent OS processes; an in-memory mutex is insufficient.
- Atomic replacement must preserve the last complete destination across process termination or a failed staged write/rename. This plan does not claim power-loss durability.
- Source-integrity checks before and after staged skill copying remain mandatory.
- Release commands must not contain a literal versioned tarball name.
- Every regression test is written and observed failing before its implementation is added.

---

## Verified Findings and Release Decision

| ID | Severity | Confidence | Finding | Release blocking |
| --- | --- | --- | --- | --- |
| SR-001 | P1 | High | `upsertInstalledSkill` performs an unlocked read-modify-write and `writeLockfile` overwrites the destination directly. | Yes |
| SR-004 | P1 | High | Package version is `0.1.2`, while MCP reports `0.1.0` and release smoke commands target the checked-in `skillranger-0.1.0.tgz`. | Yes |
| SR-002 | P2 | Medium | Stale run-lock ownership uses PID alone, so PID reuse can preserve a dead owner's lock. | No |
| SR-003 | P3 | High for duplicate provenance; Low for value divergence | MCP and core apply perform separate audits. Integrity checks prevent a simple mutable-registry reproduction, but the response and persisted projection still do not originate from one returned apply result. | No |

**Release recommendation:** Block release until Tasks 1 and 2 pass. Tasks 3 and 4 may ship in the same remediation release; if deferred, track them explicitly and retain their focused failing tests on the remediation branch.

### Evidence anchors

- `src/lockfile/index.ts:113-157`: direct read, overwrite, and unlocked upsert.
- `package.json:3`: package version `0.1.2`.
- `src/mcp/protocol.ts:61-65`: hardcoded MCP version `0.1.0`.
- `RELEASE.md:112-145`: hardcoded `skillranger-0.1.0.tgz` smoke target.
- `src/runtime/run-lock.ts:16,46-80,195-218`: `{ token, pid }` owner metadata and PID-only liveness.
- `src/mcp/tools/install.ts:169-193` and `src/installers/codex.ts:235-277`: two audit invocations for one MCP install.
- `src/installers/codex.ts:104-151`: source integrity is checked while planning and before/after staged copying; therefore a simple source mutation produces `stale skill integrity`, not a successful divergent audit result.

## File and Interface Map

| File | Responsibility after remediation |
| --- | --- |
| `src/version.ts` | Read and validate the package version from the active source/compiled package root. |
| `src/mcp/protocol.ts` | Report the package-derived MCP server version. |
| `scripts/package-smoke.mjs` | Pack into a fresh temporary directory, consume the filename emitted by `npm pack --json`, run compiled CLI/MCP/extracted-package smoke, and clean up. |
| `src/lockfile/index.ts` | Validate lockfiles, serialize cross-process transactions, atomically replace the lockfile, and return the committed installed entry. |
| `src/installers/types.ts` | Define the apply-only input, apply result, and typed audit-blocked error. |
| `src/installers/codex.ts` | Produce one authoritative audit/apply result and persist its projection. |
| `src/runtime/run-lock.ts` | Protect filesystem locks with versioned process identity and bounded unknown-owner recovery. |
| `tests/helpers/lockfile-upsert-child.ts` | Coordinate deterministic child-process lockfile serialization coverage. |
| `tests/package-publication.test.ts` | Guard dynamic package identity and release-smoke documentation. |
| `tests/lockfile.test.ts` | Cover cross-process serialization and failed atomic replacement. |
| `tests/mcp.test.ts` / `tests/mcp.protocol.test.ts` | Cover canonical audit projection, blocked audit mapping, and server version. |
| `tests/run-lock.test.ts` | Cover matching, mismatched, unknown, and legacy lock-owner identity. |

## Canonical Interfaces

The implementation must use these contracts consistently across tasks:

```ts
// src/types.ts
export type InstalledSkill = Lockfile["installed"][number];
```

```ts
// src/installers/types.ts
export type ApplyInstallInput = Omit<InstallInput, "dryRun"> & { dryRun: false };

export type InstallApplyResult = {
  plan: InstallPlan;
  audit: AuditReport;
  installed: InstalledSkill;
};

export class InstallAuditBlockedError extends Error {
  readonly code = "audit-blocked";
  constructor(
    readonly plan: InstallPlan,
    readonly audit: AuditReport,
  ) {
    super(`Blocked install for ${audit.skillId}: audit risk is block.`);
  }
}

export type AgentAdapter = {
  id: string;
  planInstall(skill: RegistrySkill, input: InstallInput): Promise<InstallPlan>;
  applyInstall(skill: RegistrySkill, input: ApplyInstallInput): Promise<InstallApplyResult>;
};
```

```ts
// src/runtime/run-lock.ts
export type ProcessIdentity = {
  scheme: "linux-proc-start-ticks";
  value: string;
};

export type ProcessIdentityState =
  | { status: "dead" }
  | { status: "known"; identity: ProcessIdentity }
  | { status: "unknown" };

export type ProcessIdentityProvider = {
  lookup(pid: number): Promise<ProcessIdentityState>;
};
```

The default identity provider reads Linux `/proc/<pid>/stat` field 22 after first confirming PID liveness. macOS, Windows, permission failures, malformed `/proc` content, and legacy metadata produce `unknown`; they do not silently become `dead`.

---

### Task 1: Make package identity and release smoke current

**Addresses:** SR-004.

**Files:**

- Create: `src/version.ts`
- Create: `scripts/package-smoke.mjs`
- Modify: `src/mcp/protocol.ts`
- Modify: `package.json`
- Modify: `RELEASE.md`
- Modify: `tests/mcp.protocol.test.ts`
- Modify: `tests/package-publication.test.ts`

**Produces:** `readSkillRangerVersion(): Promise<string>` and `npm run smoke:package`.

- [x] **Step 1: Write the failing package-identity tests**

  In `tests/mcp.protocol.test.ts`, read `package.json`, initialize MCP, and assert `result.serverInfo.version === packageJson.version`. In `tests/package-publication.test.ts`, assert that `RELEASE.md` contains `npm run smoke:package` and does not match `/skillranger-\d+\.\d+\.\d+\.tgz/`.

- [x] **Step 2: Run the red tests**

  Run: `node --test tests/mcp.protocol.test.ts tests/package-publication.test.ts`

  Expected: FAIL because MCP reports `0.1.0` and `RELEASE.md` contains `skillranger-0.1.0.tgz`.

- [x] **Step 3: Implement package-derived runtime versioning**

  Add `readSkillRangerVersion()` in `src/version.ts`. It reads `${packageRoot}/package.json`, requires a non-empty string `version`, and throws `Invalid package version at <path>` for malformed data. Await it when constructing the MCP initialize result; remove the hardcoded version.

- [x] **Step 4: Implement a dynamic package smoke command**

  `scripts/package-smoke.mjs` must:

  1. Create its own `mkdtemp` directory.
  2. Run `npm pack --ignore-scripts --json --pack-destination <temp>`.
  3. Parse the single returned `filename` and resolve that exact tarball.
  4. Run `npm exec --yes --package <exact-tarball> -- skillranger doctor`.
  5. Run compiled scan/recommend smoke against repository fixtures.
  6. Extract the same tarball and run its compiled `doctor` entrypoint.
  7. Spawn the packaged MCP command, send one JSON-RPC `initialize` request, and assert name, title, and package-derived version.
  8. Remove only the temporary smoke directory in `finally`.

  Add `"smoke:package": "node scripts/package-smoke.mjs"` to `package.json`. Replace versioned tarball commands in `RELEASE.md` with this single command and describe that it always tests the tarball emitted by the current checkout.

- [x] **Step 5: Run the focused tests and smoke**

  Run: `node --test tests/mcp.protocol.test.ts tests/package-publication.test.ts`

  Expected: PASS.

  Run: `npm run build && npm run smoke:package`

  Expected: PASS; MCP reports `0.1.2`, and all smoke commands use the newly packed tarball from the temporary directory.

- [x] **Step 6: Commit**

  ```bash
  git add src/version.ts src/mcp/protocol.ts scripts/package-smoke.mjs package.json RELEASE.md tests/mcp.protocol.test.ts tests/package-publication.test.ts
  git commit -m "fix: derive release smoke from current package"
  ```

---

### Task 2: Serialize and atomically replace the install lockfile

**Addresses:** SR-001.

**Files:**

- Modify: `src/lockfile/index.ts`
- Modify: `src/types.ts`
- Create: `tests/helpers/lockfile-upsert-child.ts`
- Modify: `tests/lockfile.test.ts`
- Modify: `tests/installer.codex.test.ts`

**Consumes:** Existing `RunFileLock` and `RunFileLockHooks` from `src/runtime/run-lock.ts`.

**Produces:** `upsertInstalledSkill(...): Promise<InstalledSkill>` and atomic `writeLockfile` behavior.

- [x] **Step 1: Write the failing child-process serialization test**

  Add a helper that loads one registry skill, audits it, and calls `upsertInstalledSkill`. A test-only `afterTransactionLockAcquired` hook writes an acquired marker; the first child waits for a release marker while holding the transaction lock. Start the second child and assert its acquired marker does not exist until the first child is released. After both exit successfully, assert both distinct installed entries exist exactly once.

  The lock path must be `${lockfilePath(projectRoot)}.update.lock`. The test must use two `node` child processes, not two promises in one process.

- [x] **Step 2: Write the failing atomic-replacement test**

  Seed a valid lockfile and save its exact bytes. Inject `beforeCommit` to throw after the same-directory temporary file is fully written but before rename. Assert rejection, byte-for-byte equality of the destination, successful `readLockfile`, and absence of matching temporary files.

- [x] **Step 3: Run the red lockfile tests**

  Run: `node --test tests/lockfile.test.ts`

  Expected: FAIL because transaction hooks/cross-process locking do not exist and the destination is overwritten directly.

- [x] **Step 4: Implement one transaction primitive**

  In `src/lockfile/index.ts`, add one internal `withLockfileTransaction(projectRoot, apply, hooks)` function. It must resolve the project root, instantiate `RunFileLock` with the exact `.update.lock` path, acquire before any read, call `afterTransactionLockAcquired` only after acquisition, and release in `finally`.

  Both exported writers use it:

  - `writeLockfile` acquires the transaction lock and atomically replaces the validated destination.
  - `upsertInstalledSkill` acquires once, reads inside the lock, builds an immutable next object, atomically replaces the destination without reacquiring, and returns the exact committed `InstalledSkill` object.

  The internal atomic writer must use a unique `${destination}.${process.pid}.${randomUUID()}.tmp` path in the destination directory, `open(..., "wx")`, write the validated JSON, close the handle, call `beforeCommit`, rename over the destination, and unlink only its own temporary file in `finally`. Existing malformed destinations remain fail-closed.

- [x] **Step 5: Run focused persistence and installer tests**

  Run: `node --test tests/lockfile.test.ts tests/installer.codex.test.ts tests/cli.install.test.ts tests/mcp.test.ts`

  Expected: PASS; the child process cannot enter while the first holds the lock, both entries remain, and failed commit preserves the previous bytes.

- [x] **Step 6: Commit**

  ```bash
  git add src/lockfile/index.ts src/types.ts tests/helpers/lockfile-upsert-child.ts tests/lockfile.test.ts tests/installer.codex.test.ts
  git commit -m "fix: serialize install lockfile transactions"
  ```

---

### Task 3: Return one authoritative install audit result

**Addresses:** SR-003.

**Files:**

- Modify: `src/types.ts`
- Modify: `src/installers/types.ts`
- Modify: `src/installers/codex.ts`
- Modify: `src/mcp/tools/install.ts`
- Modify: `src/cli/index.ts`
- Modify: `tests/installer.codex.test.ts`
- Modify: `tests/mcp.test.ts`
- Modify affected direct-adapter tests identified by `rg -n '\.applyInstall\(' tests src`

**Produces:** `InstallApplyResult` and `InstallAuditBlockedError` exactly as defined in Canonical Interfaces.

- [x] **Step 1: Write the failing success-projection test**

  For a successful MCP install, assert:

  - `result.audit.skillId === result.installed.skillId`
  - `result.audit.checksum === result.installed.checksum`
  - `result.audit.riskLevel === result.installed.audit.riskLevel`
  - `result.audit.securityScore === result.installed.audit.securityScore`
  - `result.audit.findings` deep-equals `result.installed.audit.findings`

  Do not assert deep equality between the complete `AuditReport` and `installed.audit`; the lockfile intentionally stores `skillId` and `checksum` at the installed-entry level.

- [x] **Step 2: Write the failing blocked-result test**

  Keep the existing malicious-registry fixture. Assert the MCP response remains `audit-blocked`, contains the one audit carried by `InstallAuditBlockedError`, and writes neither skill files nor a lockfile entry. Add an installer-level assertion that `applyInstall` rejects with `InstallAuditBlockedError` and exposes the same plan/audit fields.

- [x] **Step 3: Run the red MCP/installer tests**

  Run: `node --test tests/mcp.test.ts tests/installer.codex.test.ts`

  Expected: FAIL because `applyInstall` returns only `InstallPlan` and MCP performs its own pre-audit.

- [x] **Step 4: Implement the canonical apply result**

  Change `AgentAdapter.applyInstall` to accept `ApplyInstallInput` and return `InstallApplyResult`. Inside `applyInstall`:

  1. Build the plan.
  2. Run `auditSkill` exactly once.
  3. Reject stale source state when `audit.checksum !== skill.checksum`.
  4. Throw `InstallAuditBlockedError(plan, audit)` for block risk before any writes.
  5. Preserve all existing copy-time integrity checks.
  6. Use the `InstalledSkill` returned by `upsertInstalledSkill`.
  7. Return `{ plan, audit, installed }`.

  Remove the MCP pre-audit and post-apply lockfile reread. Map `InstallAuditBlockedError` to the existing structured `audit-blocked` response. Update CLI call sites to consume `.plan`, preserving current CLI output exactly.

- [x] **Step 5: Run every apply caller and parity test**

  Run: `rg -n '\.applyInstall\(' tests src`

  Expected: every production caller either consumes `.plan`/the complete result or intentionally ignores the result.

  Run: `node --test tests/mcp.test.ts tests/mcp.protocol.test.ts tests/installer.codex.test.ts tests/cli.install.test.ts tests/cli.setup.test.ts tests/package-publication.test.ts tests/shared-contracts.test.ts tests/strict-start.test.ts tests/strict-pilots-e2e.test.ts`

  Expected: PASS.

- [x] **Step 6: Commit**

  ```bash
  git add src/types.ts src/installers/types.ts src/installers/codex.ts src/mcp/tools/install.ts src/cli/index.ts tests
  git commit -m "fix: return canonical install audit result"
  ```

---

### Task 4: Distinguish reused PIDs from the original run-lock owner

**Addresses:** SR-002.

**Files:**

- Modify: `src/runtime/run-lock.ts`
- Create: `tests/run-lock.test.ts`
- Modify: `tests/skill-run.test.ts`
- Modify: `tests/strict-store.test.ts`

**Produces:** `ProcessIdentityProvider` and versioned lock-owner metadata.

- [x] **Step 1: Write the failing identity-policy tests**

  Inject a deterministic `ProcessIdentityProvider` and short timeout values. Cover all four cases for both final locks and guard entries:

  1. Stale owner, live PID, mismatched known identity: reclaim.
  2. Stale owner, live PID, matching known identity: retain and time out.
  3. Stale owner with unknown identity: retain through `staleLockMs`, reclaim only after `unknownOwnerMaxAgeMs`.
  4. Legacy `{ token, pid }` metadata: treat as unknown and apply the same bounded fallback.

- [x] **Step 2: Run the red run-lock tests**

  Run: `node --test tests/run-lock.test.ts tests/skill-run.test.ts tests/strict-store.test.ts`

  Expected: FAIL because metadata has no version/identity and no identity provider exists.

- [x] **Step 3: Implement versioned owner metadata and Linux identity**

  Persist this shape for new final locks and guard entries:

  ```ts
  type LockOwnerMetadataV2 = {
    version: 2;
    token: string;
    pid: number;
    createdAt: string;
    identity?: ProcessIdentity;
  };
  ```

  The parser must continue accepting legacy `{ token, pid }`. The default provider returns:

  - `dead` only when PID liveness returns `ESRCH`.
  - `known` on Linux when `/proc/<pid>/stat` yields field 22.
  - `unknown` for permission errors, unsupported platforms, malformed metadata, or unreadable identity data.

  Add constructor options with defaults: `lockTimeoutMs = 5_000`, `staleLockMs = 30_000`, and `unknownOwnerMaxAgeMs = 300_000`. Matching known identity is never reclaimed solely due to age. Mismatched known identity is reclaimed after `staleLockMs`. Unknown/legacy identity is reclaimed only after `unknownOwnerMaxAgeMs`.

  Reclamation age continues to come from the final lock file or guard-directory `mtime`; `createdAt` is provenance only and must never extend a stale lock's retention window.

- [x] **Step 4: Run focused run-state tests**

  Run: `node --test tests/run-lock.test.ts tests/skill-run.test.ts tests/strict-store.test.ts`

  Expected: PASS, including existing concurrent updates, stale-guard recovery, release ownership, and long-running live-owner coverage.

- [x] **Step 5: Commit**

  ```bash
  git add src/runtime/run-lock.ts tests/run-lock.test.ts tests/skill-run.test.ts tests/strict-store.test.ts
  git commit -m "fix: harden stale lock owner identity"
  ```

---

### Task 5: Run the complete release gate

**Dependencies:** Tasks 1-4.

**Files:**

- Modify: `PLAN.md` checkboxes only after commands succeed.

- [x] **Step 1: Run static/build checks**

  Run: `npm run build && npm run check`

  Expected: PASS.

- [x] **Step 2: Run the complete test and registry gates**

  Run: `npm test && npm run validate:registry && npm run lint:skills && npm run audit:registry && npm run publish:check`

  Expected: all commands PASS; registry remains 18 valid skills with zero audit failures unless a separately reviewed registry change intentionally updates that count.

- [x] **Step 3: Run frontend and aggregate release checks**

  Run: `npm run eval:frontend -- --run-routing --project fixtures/next-react-ts --json && npm run eval:frontend:ru && npm run release:check`

  Expected: routing remains 156/156 for the current fixture and the aggregate release check passes.

- [x] **Step 4: Run the current-package smoke**

  Run: `npm run smoke:package`

  Expected: PASS using only the tarball created in the command's fresh temporary directory; MCP version equals `package.json` version.

- [x] **Step 5: Inspect the working tree**

  Run: `git status --short`

  Expected: only the intended source, test, documentation, and plan changes are present; `.pnpm-store/v11/projects/` remains pre-existing and untracked unless the user removes it separately.

## Completion Criteria

- SR-001: two child processes cannot overlap the lockfile transaction, both committed entries survive, and a failed staged commit preserves the previous bytes.
- SR-004: no runtime/release command hardcodes `0.1.0`; packaged MCP reports the version from the packed package.
- SR-003: apply runs one audit, returns it with the committed installed entry, and MCP maps the typed blocked error without a second audit or lockfile reread.
- SR-002: known mismatched process identity is reclaimed, matching identity is retained, and unknown/legacy identity follows the explicit five-minute upper bound.
- All focused red-green tests and every command in Task 5 pass with fresh output.
- No lockfile schema migration, dependency addition, or unrelated refactor is included.

## Deferred, Explicitly Unverified Risks

- Power-loss durability after rename is outside this remediation; process interruption and staged-write/rename failure are covered.
- Linux receives exact process-start identity. macOS and Windows use the bounded unknown-owner policy until a separately designed native identity provider is added.
- User-scope install containment remains based on hardcoded agent destinations and is not expanded in this plan.

## Execution Handoff

Implement task-by-task with one of these workflows:

1. **Subagent-Driven (recommended):** use `superpowers:subagent-driven-development`, one fresh implementer per task, with review after each task.
2. **Inline Execution:** use `superpowers:executing-plans`, keeping the red-green and commit checkpoints above.

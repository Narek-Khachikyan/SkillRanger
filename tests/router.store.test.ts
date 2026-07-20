import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertValidRouterRun,
  RouterStore,
  RouterStoreError,
  routerRecordDigest,
  type RouterRuntimeStore,
} from "../src/router/index.ts";
import type { RouterRun } from "../src/router/types.ts";

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
const projectIdentity = digest("a");

const fixtureRun = (overrides: Partial<RouterRun> = {}): RouterRun => ({
  schemaVersion: "router-run/1.0",
  routerRunId: "route_12345678",
  revision: 0,
  readRevision: 0,
  state: "prepared",
  createdAt: "2026-07-19T00:00:00.000Z",
  updatedAt: "2026-07-19T00:00:00.000Z",
  projectIdentity,
  taskProfile: {
    schemaVersion: "task-profile/1.0",
    normalizedGoal: "implement api",
    locale: "en",
    actions: ["implement"],
    artifactTypes: ["api"],
    technologies: ["nodejs"],
    constraints: [],
    qualityGoals: [],
    acceptanceCriteria: [],
    domains: [],
    subtasks: [],
    evidence: [],
  },
  routing: {
    targetAgent: "codex",
    domains: [],
    deterministicKey: digest("b"),
    routerAlgorithmVersion: "router/1.0",
    routingDate: "2026-07-19",
    fingerprintDigest: digest("c"),
    registryDigest: digest("d"),
    configDigest: digest("e"),
  },
  selections: {
    environment: [],
    primary: {
      skillId: "frontend.primary",
      displayName: "Primary",
      role: "primary",
      domains: ["frontend"],
      version: "1.0.0",
      packageChecksum: digest("f"),
      score: 0.9,
      source: "bundled-registry",
      reasons: ["domain-match:frontend"],
      verificationStatus: "not-required",
    },
    companions: [],
    verification: [],
    agentContext: [],
  },
  sourceInventory: [],
  readLedger: [],
  runtime: { kind: "lifecycle-v1", runId: "run_12345678" },
  ...overrides,
});

const temporaryProject = () => mkdtemp(path.join(os.tmpdir(), "skillranger-router-store-"));

const memoryRuntime = (initial: Record<string, unknown> = {}) => {
  const records = new Map(Object.entries(initial));
  const runtime: RouterRuntimeStore = {
    async read(runId) { return records.get(runId); },
    async create(runId, value) {
      if (records.has(runId)) throw new Error("runtime already exists");
      records.set(runId, structuredClone(value));
    },
  };
  return { runtime, records };
};

test("router store creates owner-only identity key and preserves its project identity", async () => {
  const root = await temporaryProject();
  const store = new RouterStore(root);
  const first = await store.projectIdentity();
  const second = await store.projectIdentity();
  const keyPath = path.join(root, ".skillranger", "identity.key");
  const metadata = await lstat(keyPath);

  assert.match(first, /^sha256:[a-f0-9]{64}$/);
  assert.equal(second, first);
  assert.equal(metadata.mode & 0o077, 0);
  assert.equal((await readFile(keyPath)).byteLength, 32);
});

test("router store atomically creates and updates validated runs with monotonic revisions", async () => {
  const root = await temporaryProject();
  const store = new RouterStore(root);
  const run = await store.create(fixtureRun({ projectIdentity: await store.projectIdentity() }));
  assert.equal(run.revision, 0);
  const updated = await store.update(run.routerRunId, (current) => ({
    ...current,
    state: "reading",
    updatedAt: "2026-07-19T00:01:00.000Z",
  }));
  assert.equal(updated.revision, 1);
  assert.equal((await store.read(run.routerRunId)).state, "reading");
  const entries = await readdir(path.join(root, ".skillranger", "runs", "router"));
  assert.deepEqual(entries.filter((entry) => entry.endsWith(".tmp")), []);
});

test("router store rejects malformed persisted records and invalid writes", async () => {
  const root = await temporaryProject();
  const store = new RouterStore(root);
  const projectIdentity = await store.projectIdentity();
  await assert.rejects(
    () => store.create(fixtureRun({ projectIdentity, revision: 1 })),
    (error) => error instanceof RouterStoreError && error.code === "run-integrity",
  );
  const runPath = path.join(root, ".skillranger", "runs", "router", "route_12345678.json");
  await writeFile(runPath, "{\"schemaVersion\":\"router-run/1.0\"}");
  await assert.rejects(
    () => store.read("route_12345678"),
    (error) => error instanceof RouterStoreError && error.code === "run-integrity",
  );
  assert.throws(() => assertValidRouterRun({}), /routerRun/);
  const unsafeSource = fixtureRun({
    projectIdentity,
    sourceInventory: [{
      skillId: "frontend.primary", source: "installed", version: "1.0.0", packageChecksum: digest("f"), auditDigest: digest("a"), rootIdentity: digest("b"),
      locator: { kind: "installed", targetAgent: "codex", installedPath: "../outside" }, files: [],
    }],
  });
  assert.throws(() => assertValidRouterRun(unsafeSource), /safe project-relative path/);
});

test("concurrent router updates serialize and preserve every revision", async () => {
  const root = await temporaryProject();
  const store = new RouterStore(root);
  await store.create(fixtureRun({ projectIdentity: await store.projectIdentity() }));
  const results = await Promise.all([
    store.update("route_12345678", (run) => ({ ...run, updatedAt: "2026-07-19T00:00:01.000Z" })),
    store.update("route_12345678", (run) => ({ ...run, updatedAt: "2026-07-19T00:00:02.000Z" })),
  ]);
  assert.deepEqual(results.map(({ revision }) => revision).sort((a, b) => a - b), [1, 2]);
  assert.equal((await store.read("route_12345678")).revision, 2);
});

test("journaled create is deterministic and does not duplicate runtime records", async () => {
  const root = await temporaryProject();
  const { runtime, records } = memoryRuntime();
  const store = new RouterStore(root, { runtime });
  const run = fixtureRun({ projectIdentity: await store.projectIdentity() });
  const payload = { schemaVersion: "runtime/1.0", runId: run.runtime.runId };
  await store.journaledCreate({ routerRun: run, runtimePayload: payload, runtime });
  assert.deepEqual(records.get(run.runtime.runId), payload);
  assert.equal((await store.read(run.routerRunId)).routerRunId, run.routerRunId);
  assert.equal((await readdir(path.join(root, ".skillranger", "runs", "router"))).some((entry) => entry.includes("journal")), false);
});

test("startup recovery completes an interrupted journal with the preallocated IDs", async () => {
  const root = await temporaryProject();
  const { runtime, records } = memoryRuntime();
  const run = fixtureRun({ routerRunId: "route_87654321", runtime: { kind: "lifecycle-v1", runId: "run_87654321" } });
  const journal = {
    schemaVersion: "router-journal/1.0",
    operationId: "op_interrupted",
    routerRunId: run.routerRunId,
    runtimeRunId: run.runtime.runId,
    payloadDigest: routerRecordDigest({ routerRun: run, runtimePayload: { fixed: true } }),
    intendedTransition: "create-runtime-and-router" as const,
    createdAt: "2026-07-19T00:00:00.000Z",
    routerRun: run,
    runtimePayload: { fixed: true },
  };
  const journalDir = path.join(root, ".skillranger", "runs", "router");
  run.projectIdentity = await (new RouterStore(root)).projectIdentity();
  journal.payloadDigest = routerRecordDigest({ routerRun: run, runtimePayload: { fixed: true } });
  await (await import("node:fs/promises")).mkdir(journalDir, { recursive: true });
  await writeFile(path.join(journalDir, `${run.routerRunId}.journal.json`), `${JSON.stringify(journal)}\n`);

  const recovered = new RouterStore(root, { runtime });
  const result = await recovered.recover();
  assert.deepEqual(result.recovered, [run.routerRunId]);
  assert.deepEqual(records.get(run.runtime.runId), { fixed: true });
  assert.equal((await recovered.read(run.routerRunId)).routerRunId, run.routerRunId);
});

test("record-read journal recovers after the runtime bridge commits first", async () => {
  const root = await temporaryProject();
  const { runtime, records } = memoryRuntime();
  const store = new RouterStore(root, { runtime });
  const created = fixtureRun({ projectIdentity: await store.projectIdentity() });
  await store.create(created);
  const next = {
    ...created,
    revision: 1,
    readRevision: 1,
    state: "reading" as const,
    updatedAt: "2026-07-19T00:01:00.000Z",
  };
  const payload = { readRequestId: "read_1", checksum: digest("9") };
  const result = await store.journaledUpdate({
    routerRun: next,
    runtime,
    runtimePayload: payload,
    applyRuntime: async () => { records.set(created.runtime.runId, payload); },
  });
  assert.equal(result.readRevision, 1);
  assert.equal((await store.read(created.routerRunId)).revision, 1);
});

test("journal payload mismatch and identity mutation fail closed", async () => {
  const root = await temporaryProject();
  const first = new RouterStore(root);
  await first.projectIdentity();
  const keyPath = path.join(root, ".skillranger", "identity.key");
  await writeFile(keyPath, Buffer.alloc(32, 7));
  await assert.rejects(
    () => first.projectIdentity(),
    (error) => error instanceof RouterStoreError && error.code === "identity-integrity",
  );
  await chmod(keyPath, 0o644);
  await assert.rejects(
    () => new RouterStore(root).projectIdentity(),
    (error) => error instanceof RouterStoreError && error.code === "identity-integrity",
  );
});

test("pruning removes old runs but keeps identity key", async () => {
  const root = await temporaryProject();
  const store = new RouterStore(root);
  await store.create(fixtureRun({ projectIdentity: await store.projectIdentity() }));
  await store.prune();
  await assert.rejects(() => store.read("route_12345678"), /not found/);
  assert.equal((await lstat(path.join(root, ".skillranger", "identity.key"))).isFile(), true);
});

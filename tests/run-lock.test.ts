import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rmdir, unlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RunFileLock,
  type ProcessIdentity,
  type ProcessIdentityProvider,
  type ProcessIdentityState,
} from "../src/runtime/run-lock.ts";

const firstIdentity: ProcessIdentity = {
  scheme: "linux-proc-start-ticks",
  value: "100",
};
const secondIdentity: ProcessIdentity = {
  scheme: "linux-proc-start-ticks",
  value: "200",
};

const provider = (state: ProcessIdentityState): ProcessIdentityProvider => ({
  lookup: async () => state,
});

const makeLock = (
  lockPath: string,
  identityProvider: ProcessIdentityProvider,
  hooks: ConstructorParameters<typeof RunFileLock>[0]["hooks"] = {},
) => new RunFileLock({
  lockPath: () => lockPath,
  error: (message) => new Error(message),
  hooks,
  identityProvider,
  lockTimeoutMs: 75,
  staleLockMs: 20,
  unknownOwnerMaxAgeMs: 500,
});

const ownerV2 = (identity?: ProcessIdentity) => ({
  version: 2,
  token: "seed-owner",
  pid: process.pid,
  createdAt: new Date().toISOString(),
  ...(identity === undefined ? {} : { identity }),
});

const seedOwner = async (
  location: "final lock" | "guard entry",
  lockPath: string,
  metadata: unknown,
  ageMs: number,
) => {
  const old = new Date(Date.now() - ageMs);
  if (location === "final lock") {
    await writeFile(lockPath, JSON.stringify(metadata));
    await utimes(lockPath, old, old);
    return;
  }

  const guardPath = `${lockPath}.guard`;
  const token = (metadata as { token: string }).token;
  await mkdir(guardPath);
  await writeFile(path.join(guardPath, token), JSON.stringify(metadata));
  await utimes(guardPath, old, old);
};

const ageSeededOwner = async (
  location: "final lock" | "guard entry",
  lockPath: string,
  ageMs: number,
) => {
  const old = new Date(Date.now() - ageMs);
  await utimes(location === "final lock" ? lockPath : `${lockPath}.guard`, old, old);
};

const removeSeededOwner = async (location: "final lock" | "guard entry", lockPath: string) => {
  if (location === "final lock") {
    await unlink(lockPath).catch(() => undefined);
    return;
  }
  const guardPath = `${lockPath}.guard`;
  for (const entry of await readdir(guardPath).catch(() => [] as string[])) {
    await unlink(path.join(guardPath, entry)).catch(() => undefined);
  }
  await rmdir(guardPath).catch(() => undefined);
};

test("new final locks and guard entries persist versioned process identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "run-lock-metadata-"));
  const lockPath = path.join(root, "run.lock");
  let guardOwner: Record<string, unknown> | undefined;
  const lock = makeLock(
    lockPath,
    provider({ status: "known", identity: firstIdentity }),
    {
      guardEntered: async () => {
        const guardPath = `${lockPath}.guard`;
        const [entry] = await readdir(guardPath);
        guardOwner = JSON.parse(await readFile(path.join(guardPath, entry), "utf8"));
      },
    },
  );

  const acquired = await lock.acquire("run");
  const finalOwner = JSON.parse(await readFile(lockPath, "utf8"));

  for (const metadata of [guardOwner, finalOwner]) {
    assert.equal(metadata?.version, 2);
    assert.equal(metadata?.pid, process.pid);
    assert.equal(typeof metadata?.createdAt, "string");
    assert.deepEqual(metadata?.identity, firstIdentity);
  }
  await lock.release(acquired);
});

for (const location of ["final lock", "guard entry"] as const) {
  test(`${location} reclaims a stale live PID with mismatched known identity`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "run-lock-mismatch-"));
    const lockPath = path.join(root, "run.lock");
    await seedOwner(location, lockPath, ownerV2(firstIdentity), 40);
    const lock = makeLock(lockPath, provider({ status: "known", identity: secondIdentity }));

    const acquired = await lock.acquire("run");

    await lock.release(acquired);
  });

  test(`${location} retains a stale live PID with matching known identity`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "run-lock-match-"));
    const lockPath = path.join(root, "run.lock");
    await seedOwner(location, lockPath, ownerV2(firstIdentity), 540);
    const lock = makeLock(lockPath, provider({ status: "known", identity: firstIdentity }));

    await assert.rejects(lock.acquire("run"), /Timed out waiting for run lock/);
    await removeSeededOwner(location, lockPath);
  });

  test(`${location} bounds recovery when process identity is unknown`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "run-lock-unknown-"));
    const lockPath = path.join(root, "run.lock");
    await seedOwner(location, lockPath, ownerV2(firstIdentity), 40);
    const lock = makeLock(lockPath, provider({ status: "unknown" }));

    await assert.rejects(lock.acquire("run"), /Timed out waiting for run lock/);
    await ageSeededOwner(location, lockPath, 540);
    const acquired = await lock.acquire("run");

    await lock.release(acquired);
  });

  test(`${location} treats legacy metadata as unknown with the same recovery bound`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "run-lock-legacy-"));
    const lockPath = path.join(root, "run.lock");
    await seedOwner(location, lockPath, { token: "seed-owner", pid: process.pid }, 40);
    const lock = makeLock(lockPath, provider({ status: "known", identity: secondIdentity }));

    await assert.rejects(lock.acquire("run"), /Timed out waiting for run lock/);
    await ageSeededOwner(location, lockPath, 540);
    const acquired = await lock.acquire("run");

    await lock.release(acquired);
  });
}

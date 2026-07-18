import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { lockfilePath, readLockfile, writeLockfile } from "../src/lockfile/index.ts";

const execFile = promisify(execFileCallback);

const waitForFile = async (filePath: string, timeoutMs = 5_000) => {
  const startedAt = Date.now();
  while (true) {
    try {
      await stat(filePath);
      return;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (Date.now() - startedAt >= timeoutMs) throw new Error(`Timed out waiting for ${filePath}`);
    await delay(20);
  }
};

const runUpsertChild = (args: string[]) => {
  const child = spawn(process.execPath, ["tests/helpers/lockfile-upsert-child.ts", ...args], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return {
    child,
    completed: new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`Lockfile child exited with code ${code} signal ${signal ?? "none"}: ${stderr}${stdout}`));
      });
    }),
  };
};

const validLockfileEntry = {
  skillId: "frontend.next-app-router-review",
  version: "0.1.0",
  checksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  targetAgent: "codex",
  scope: "repo" as const,
  installedPath: ".agents/skills/next-app-router-review",
  source: {
    type: "curated",
    registry: "local",
    path: "./registry/skills/frontend.next-app-router-review"
  },
  audit: {
    riskLevel: "low" as const,
    securityScore: 0.9,
    findings: []
  }
};

test("readLockfile returns an empty lockfile when none exists", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-lockfile-"));
  const lockfile = await readLockfile(projectRoot);

  assert.deepEqual(lockfile, { schemaVersion: "1.0", installed: [] });
});

test("readLockfile rejects malformed existing lockfiles", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-lockfile-"));
  await writeFile(path.join(projectRoot, "skillranger.lock.json"), "{ not json");

  await assert.rejects(readLockfile(projectRoot), /Expected property name|JSON/);
});

test("readLockfile rejects duplicate installed entries", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-lockfile-"));
  await writeFile(
    path.join(projectRoot, "skillranger.lock.json"),
    JSON.stringify(
      {
        schemaVersion: "1.0",
        installed: [validLockfileEntry, validLockfileEntry]
      },
      null,
      2
    )
  );

  await assert.rejects(readLockfile(projectRoot), /duplicate installed entry/);
});

test("writeLockfile rejects invalid runtime lockfile entries", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-lockfile-"));
  await assert.rejects(
    writeLockfile(projectRoot, {
      schemaVersion: "1.0",
      installed: [
        {
          ...validLockfileEntry,
          installedPath: "../outside"
        }
      ]
    }),
    /installedPath/
  );
});

test("upsertInstalledSkill serializes transactions across child processes", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-lockfile-processes-"));
  const firstAcquired = path.join(projectRoot, "first-acquired");
  const secondAcquired = path.join(projectRoot, "second-acquired");
  const releaseFirst = path.join(projectRoot, "release-first");

  const first = runUpsertChild([
    projectRoot,
    "frontend.next-app-router-review",
    firstAcquired,
    releaseFirst,
  ]);
  await waitForFile(firstAcquired);
  assert.equal((await stat(`${lockfilePath(projectRoot)}.update.lock`)).isFile(), true);

  const second = runUpsertChild([
    projectRoot,
    "frontend.performance-review",
    secondAcquired,
  ]);
  await delay(150);
  await assert.rejects(stat(secondAcquired), /ENOENT/);

  await writeFile(releaseFirst, "release\n");
  await Promise.all([first.completed, second.completed]);

  const lockfile = await readLockfile(projectRoot);
  assert.deepEqual(
    lockfile.installed.map(({ skillId }) => skillId).sort(),
    ["frontend.next-app-router-review", "frontend.performance-review"],
  );
  assert.equal(new Set(lockfile.installed.map(({ skillId }) => skillId)).size, 2);
});

test("failed atomic replacement preserves the previous lockfile bytes", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-lockfile-atomic-"));
  const destination = lockfilePath(projectRoot);
  await writeLockfile(projectRoot, { schemaVersion: "1.0", installed: [validLockfileEntry] });
  const before = await readFile(destination);

  await assert.rejects(
    writeLockfile(
      projectRoot,
      {
        schemaVersion: "1.0",
        installed: [{ ...validLockfileEntry, version: "0.2.0" }],
      },
      {
        beforeCommit: async () => {
          throw new Error("injected before rename");
        },
      },
    ),
    /injected before rename/,
  );

  assert.deepEqual(await readFile(destination), before);
  assert.deepEqual(await readLockfile(projectRoot), {
    schemaVersion: "1.0",
    installed: [validLockfileEntry],
  });
  const temporaryPrefix = `${path.basename(destination)}.${process.pid}.`;
  assert.equal((await readdir(projectRoot)).some((entry) => entry.startsWith(temporaryPrefix) && entry.endsWith(".tmp")), false);
});

test("installed CLI command prints lockfile entries as JSON", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-lockfile-"));
  await writeLockfile(projectRoot, {
    schemaVersion: "1.0",
    installed: [validLockfileEntry]
  });

  const { stdout } = await execFile(process.execPath, ["src/cli/index.ts", "installed", projectRoot, "--json"]);
  const report = JSON.parse(stdout) as { projectRoot: string; installed: Array<{ skillId: string }> };

  assert.equal(report.projectRoot, projectRoot);
  assert.equal(report.installed[0]?.skillId, "frontend.next-app-router-review");
});

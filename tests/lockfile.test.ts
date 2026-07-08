import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readLockfile, writeLockfile } from "../src/lockfile/index.ts";

const execFile = promisify(execFileCallback);

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

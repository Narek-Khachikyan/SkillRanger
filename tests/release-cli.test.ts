import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const cli = (...args: string[]) => spawnSync(
  process.execPath,
  ["src/cli/index.ts", ...args],
  { cwd: process.cwd(), encoding: "utf8", timeout: 15_000 },
);

test("release:certify writes a non-promotable handoff when retained evidence is incomplete", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "release-cli-"));
  const output = path.join(root, "release-handoff.json");
  const result = cli("release:certify", "--output", output, "--json");

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(await readFile(output, "utf8")) as {
    releaseVersion: string;
    verdict: string;
    blockingReasons: string[];
    evidenceBundle: { missingRoles: string[] };
  };
  assert.equal(report.releaseVersion, "0.4.0");
  assert.equal(report.verdict, "not-promotable");
  assert.ok(report.blockingReasons.some((reason) => reason.includes("visual benchmark gate")));
  assert.ok(report.evidenceBundle.missingRoles.includes("visual-candidates"));
  assert.ok(report.evidenceBundle.missingRoles.includes("capability-record"));
  assert.ok(report.evidenceBundle.missingRoles.includes("visual-plan"));
  assert.ok(report.evidenceBundle.missingRoles.includes("baseline-evidence"));
});

test("release:certify persists a blocked report for malformed baseline evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "release-cli-malformed-"));
  const evidence = path.join(root, "baseline.json");
  const output = path.join(root, "release-handoff.json");
  await writeFile(evidence, "{}");
  const result = cli("release:certify", "--baseline-evidence", evidence, "--output", output, "--json");

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(await readFile(output, "utf8")) as { verdict: string; blockingReasons: string[] };
  assert.equal(report.verdict, "not-promotable");
  assert.ok(report.blockingReasons.some((reason) => reason.includes("baseline gate")));
});

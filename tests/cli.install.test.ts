import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const exists = async (filePath: string) => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const copyFixtureProject = async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-cli-install-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });
  return { tmpRoot, projectRoot };
};

test("install CLI prints a human dry-run summary without writing files", async () => {
  const { tmpRoot, projectRoot } = await copyFixtureProject();
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "src/cli/index.ts",
      "install",
      "frontend.next-app-router-review",
      "--project",
      projectRoot,
      "--dry-run",
    ]);

    assert.match(stdout, /Install plan for frontend\.next-app-router-review/);
    assert.match(stdout, /Would write:/);
    assert.match(stdout.split(path.sep).join("/"), /\.agents\/skills\/next-app-router-review\/SKILL\.md/);
    assert.match(stdout, /Would update:/);
    assert.match(stdout, /skillranger\.lock\.json/);
    assert.match(stdout, /Next: re-run with --yes to apply\./);
    assert.equal(await exists(path.join(projectRoot, "skillranger.lock.json")), false);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("install CLI prints a post-install summary after applying", async () => {
  const { tmpRoot, projectRoot } = await copyFixtureProject();
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "src/cli/index.ts",
      "install",
      "frontend.next-app-router-review",
      "--project",
      projectRoot,
      "--yes",
    ]);

    assert.match(stdout, /Installed frontend\.next-app-router-review/);
    assert.match(stdout, /Wrote:/);
    assert.match(stdout, /Updated:/);
    assert.match(stdout, /Use: start or reload codex in this repo/);
    assert.equal(
      await exists(path.join(projectRoot, ".agents/skills/next-app-router-review/SKILL.md")),
      true,
    );
    assert.equal(await exists(path.join(projectRoot, "skillranger.lock.json")), true);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

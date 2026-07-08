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

test("setup CLI refuses to run without an interactive terminal", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      "src/cli/index.ts",
      "setup",
      "fixtures/next-react-ts",
    ]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        (error as Error & { stderr?: string }).stderr ?? "",
        /skillranger setup requires an interactive terminal/,
      );
      return true;
    },
  );
});

test("setup CLI applies recommendations non-interactively with --yes and explicit target", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-setup-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "src/cli/index.ts",
      "setup",
      projectRoot,
      "--target",
      "codex",
      "--scope",
      "repo",
      "--yes",
    ]);

    assert.match(stdout, /Targets: codex/);
    assert.match(stdout, /Scope: repo/);
    assert.match(stdout, /Done\. Installed \d+ skills\./);
    assert.equal(await exists(path.join(projectRoot, ".agents/skills/next-app-router-review/SKILL.md")), true);
    assert.equal(await exists(path.join(projectRoot, "skillranger.lock.json")), true);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("setup CLI supports comma-separated multi-agent targets", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-setup-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "src/cli/index.ts",
      "setup",
      projectRoot,
      "--target",
      "codex,claude-code",
      "--scope",
      "repo",
      "--yes",
    ]);

    assert.match(stdout, /Targets: codex, claude-code/);
    assert.match(stdout, /Installed frontend\.next-app-router-review for codex/);
    assert.match(stdout, /Installed frontend\.next-app-router-review for claude-code/);
    assert.equal(await exists(path.join(projectRoot, ".agents/skills/next-app-router-review/SKILL.md")), true);
    assert.equal(await exists(path.join(projectRoot, ".claude/skills/next-app-router-review")), true);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

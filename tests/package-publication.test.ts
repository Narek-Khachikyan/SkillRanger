import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
const exec = promisify(execFile);

test("published tarball contains shared contracts and supports registry install materialization", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillranger-pack-"));
  const { stdout } = await exec("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], { maxBuffer: 10 * 1024 * 1024 });
  const packed = JSON.parse(stdout) as Array<{ filename: string; files: Array<{ path: string }> }>;
  assert.ok(packed[0].files.some(({ path: packedPath }) => packedPath === "registry/contracts/frontend/browser-evidence.md"));
  const extracted = path.join(root, "extracted"); await exec("mkdir", ["-p", extracted]);
  await exec("tar", ["-xzf", path.join(root, packed[0].filename), "-C", extracted]);
  const packageDir = path.join(extracted, "package");
  const registry = await import(pathToFileURL(path.join(packageDir, "src/registry/index.ts")).href) as typeof import("../src/registry/index.ts");
  const installers = await import(pathToFileURL(path.join(packageDir, "src/installers/codex.ts")).href) as typeof import("../src/installers/codex.ts");
  const skill = await registry.findSkill("frontend.visual-design-polish", path.join(packageDir, "registry")); assert.ok(skill);
  const projectRoot = path.join(root, "project"); await exec("mkdir", ["-p", projectRoot]);
  const input = { projectRoot, targetAgent: "codex", scope: "repo" as const, dryRun: false, mode: "copy" as const };
  const plan = await installers.getAdapter("codex").planInstall(skill, input);
  assert.ok(plan.writes.some((write) => write.endsWith("references/shared/frontend--browser-evidence.md")));
  await installers.getAdapter("codex").applyInstall(skill, input);
  const installed = path.join(projectRoot, ".agents/skills/visual-design-polish/references/shared/frontend--browser-evidence.md");
  assert.ok((await stat(installed)).isFile()); assert.match(await readFile(installed, "utf8"), /Contract-Version: 1\.0\.0/);
});

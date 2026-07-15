import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { findSkill } from "../src/registry/index.ts";
import { getAdapter } from "../src/installers/codex.ts";
import type { SkillRunV2 } from "../src/runtime/strict/index.ts";

const execFileAsync = promisify(execFile);
const cli = async (...args: string[]) => JSON.parse((await execFileAsync(process.execPath, ["src/cli/index.ts", ...args])).stdout) as { ok: true; run: SkillRunV2; chunk?: { content: string; ordinal: number } };

test("CLI starts, inspects, and fully reads a strict installed skill", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cli-strict-"));
  await cp("fixtures/vite-react-ts", root, { recursive: true });
  const skill = await findSkill("frontend.performance-review");
  assert.ok(skill);
  await getAdapter("codex").applyInstall(skill!, { projectRoot: root, targetAgent: "codex", scope: "repo", dryRun: false, mode: "copy" });
  const inputsPath = path.join(root, "strict-inputs.json");
  await writeFile(inputsPath, JSON.stringify({
    "frontend.performance-review": { mode: "risk-review", affectedFlows: ["initial load"] },
  }));

  let result = await cli(
    "run:start", root, "--target", "codex", "--domain", "frontend",
    "--intent", "Review frontend performance risks", "--strict", "--inputs", inputsPath, "--json",
  );
  assert.equal(result.run.schemaVersion, "2.0");
  const runId = result.run.runId;
  const inspected = await cli("run:inspect", root, "--run", runId, "--json");
  assert.deepEqual(inspected.run, result.run);

  while (result.run.state === "reading") {
    result = await cli("run:read-next", root, "--run", runId, "--skill", "frontend.performance-review", "--json");
    assert.equal(typeof result.chunk?.content, "string");
  }
  assert.equal(result.run.state, "ready");
  assert.equal(result.run.skillLedgers[0].readReceipts.length, result.run.skillLedgers[0].contentChunks.length);
});

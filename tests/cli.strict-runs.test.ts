import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { findSkill } from "../src/registry/index.ts";
import { getAdapter } from "../src/installers/codex.ts";
import {
  StrictSkillRunStore,
  createContentChunks,
  createStrictSkillRun,
  type ExecutionContractV2,
  type SkillRunV2,
} from "../src/runtime/strict/index.ts";

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

test("CLI strict finalize keeps the JSON response shape", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cli-strict-finalize-"));
  const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
  const contract: ExecutionContractV2 = {
    schemaVersion: "2.0", skillId: "frontend.noop", contractVersion: "2.0.0",
    inputSchema: "input.schema.json", outputSchema: "output.schema.json", mustRead: ["SKILL.md"],
    applicability: { op: "tag", value: "frontend" }, prerequisites: [], maxRepairIterations: 1,
    rules: [{ id: "frontend.noop/rule/noop", description: "No-op." }],
    steps: [{ id: "frontend.noop/step/noop", type: "collect", requiredEvidenceKinds: ["noop"], ruleIds: ["frontend.noop/rule/noop"] }],
    gates: [{ id: "frontend.noop/gate/noop", level: "hard", evaluator: { type: "evidence-present", evidenceKind: "noop" }, ruleIds: ["frontend.noop/rule/noop"] }],
  };
  const run = createStrictSkillRun({
    runId: "run_cli_finalize", domain: "frontend", targetAgent: "codex", locale: "en",
    intent: { sha256: digest("cli finalize"), normalizedGoal: "preserve CLI shape" },
    selectedSkills: [{
      skillId: contract.skillId, role: "primary", mandatory: true, version: "1.0.0",
      packageChecksum: digest("package"), contractChecksum: digest(JSON.stringify(contract)), contract,
      schemaSnapshots: { input: { type: "object" }, output: { type: "object" } },
      schemaChecksums: { input: digest(JSON.stringify({ type: "object" })), output: digest(JSON.stringify({ type: "object" })) },
      contentChunks: createContentChunks("SKILL.md", "# No-op\n"), applicable: false, unmetPrerequisites: [],
    }],
  });
  await new StrictSkillRunStore(root).create(run);

  const result = await cli("run:finalize", root, "--run", run.runId, "--json");

  assert.deepEqual(Object.keys(result), ["ok", "run"]);
  assert.equal(result.ok, true);
  assert.equal(result.run.state, "verified");
});

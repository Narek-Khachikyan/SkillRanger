import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { callMcpTool } from "../src/mcp/tools.ts";

test("inspect_skill_run missing run wire is bare (no lifecycleCode/details)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inspect-wire-missing-"));
  const runId = "run_missing_wire_123";
  const result = await callMcpTool("inspect_skill_run", { projectRoot: root, runId });
  assert.equal(result.isError, true);
  const body = result.structuredContent as Record<string, unknown>;
  assert.equal(body.code, "run-not-found");
  assert.equal(body.message, `Skill run not found: ${runId}.`);
  assert.equal("lifecycleCode" in body, false);
  assert.equal("details" in body, false);
  // also ensure top-level details key not present via spread
  assert.equal(body.lifecycleCode, undefined);
  assert.equal(body.details, undefined);
});

test("inspect_skill_run invalid JSON wire is bare (no lifecycleCode/details)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inspect-wire-invalid-"));
  const runId = "run_invalid_wire_456";
  const target = path.join(root, ".skillranger", "runs", `${runId}.json`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "{ invalid json");
  const result = await callMcpTool("inspect_skill_run", { projectRoot: root, runId });
  assert.equal(result.isError, true);
  const body = result.structuredContent as Record<string, unknown>;
  assert.equal(body.code, "run-integrity");
  assert.equal(body.message, `Skill run ${runId} is not valid persisted JSON.`);
  assert.equal("lifecycleCode" in body, false);
  assert.equal("details" in body, false);
});

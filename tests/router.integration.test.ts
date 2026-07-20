import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { callMcpTool } from "../src/mcp/tools.ts";
import { initializeRouterContext } from "../src/mcp/router-context.ts";
import { prepareTask } from "../src/router/prepare.ts";
import { RouterStore } from "../src/router/store.ts";

const project = () => mkdtemp(path.join(os.tmpdir(), "skillranger-router-integration-"));
const registry = path.resolve("registry");
const digest = (value: string) => `sha256:${value.repeat(64)}`;
const mcpRoot = project();

test("MCP router rejects missing trigger without creating a run", async () => {
  const root = await mcpRoot;
  process.env.SKILLRANGER_PROJECT_ROOT = root;
  initializeRouterContext();
  const result = await callMcpTool("prepare_task", { prompt: "Create a page" });
  assert.equal(result.isError, true);
  assert.equal((result.structuredContent as { code: string }).code, "trigger-required");
  assert.deepEqual(await readdir(path.join(root, ".skillranger")).catch(() => []), []);
});

test("MCP router uses the fixed project root and rejects caller root injection", async () => {
  const root = await mcpRoot;
  const outside = await project();
  process.env.SKILLRANGER_PROJECT_ROOT = root;
  initializeRouterContext();
  const result = await callMcpTool("prepare_task", { prompt: "Create a page @skillranger", projectRoot: outside });
  assert.equal(result.isError, true);
  assert.equal((result.structuredContent as { code: string }).code, "project-root-unauthorized");
});

test("router persistence does not contain raw prompt canaries", async () => {
  const root = await project();
  const canary = "SECRET_CANARY_7f4c";
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: `Create a responsive web interface for ${canary} https://private.example/customer @skillranger`,
    activation: { mode: "explicit" },
  });
  assert.equal(result.status, "prepared");
  const routerRunId = result.status === "prepared" ? result.run.routerRunId : "";
  const source = await readFile(path.join(root, ".skillranger", "runs", "router", `${routerRunId}.json`), "utf8");
  assert.doesNotMatch(source, new RegExp(canary));
  assert.doesNotMatch(source, /private\.example/);
});

test("prepared lifecycle cannot begin before the server-controlled mandatory reads", async () => {
  const root = await project();
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "bundled", root: registry },
    prompt: "Create a responsive web interface @skillranger",
    activation: { mode: "explicit" },
  });
  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") return;
  const before = await callMcpTool("begin_skill_run_execution", { projectRoot: root, runId: result.run.runtimeRunId });
  assert.equal(before.isError, true);
  assert.equal((before.structuredContent as { code: string }).code, "invalid-transition");
});

test("clarification returns no partial router or runtime files", async () => {
  const root = await project();
  const fixtureRoot = path.resolve("tests/fixtures/router-packs");
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "test-fixture", root: fixtureRoot },
    prompt: "Create a new application interface. @skillranger",
    activation: { mode: "explicit" },
  });
  assert.notEqual(result.status, "prepared");
  assert.deepEqual(await readdir(path.join(root, ".skillranger", "runs", "router")).catch(() => []), []);
});

test("identity key is owner-only and survives run pruning", async () => {
  const root = await project();
  const store = new RouterStore(root);
  const identity = await store.projectIdentity();
  assert.match(identity, /^sha256:[a-f0-9]{64}$/);
  const key = await readFile(path.join(root, ".skillranger", "identity.key"));
  assert.equal(key.byteLength, 32);
  await store.prune();
  assert.equal((await readFile(path.join(root, ".skillranger", "identity.key"))).equals(key), true);
});

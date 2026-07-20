import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleJsonRpcLine, handleJsonRpcRequest } from "../src/mcp/protocol.ts";
import { skillLanes } from "../src/types.ts";

test("MCP protocol initializes with tool capability", async () => {
  const response = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "test",
        version: "0.0.0"
      }
    }
  });

  assert.equal(response?.id, 1);
  assert.equal((response?.result as { protocolVersion?: string })?.protocolVersion, "2025-06-18");
  assert.equal(Boolean((response?.result as { capabilities?: { tools?: unknown } })?.capabilities?.tools), true);
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  assert.equal(
    (response?.result as { serverInfo?: { version?: string } })?.serverInfo?.version,
    packageJson.version,
  );
});

test("MCP protocol ignores notifications", async () => {
  const response = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    method: "notifications/initialized"
  });

  assert.equal(response, undefined);
});

test("MCP protocol lists tools", async () => {
  const response = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: "tools",
    method: "tools/list",
    params: {}
  });
  const result = response?.result as {
    tools?: Array<{
      name: string;
      inputSchema: {
        additionalProperties?: boolean;
        properties?: {
          lane?: { enum?: unknown[] };
          limitPerLane?: { type?: string; minimum?: number };
          hostCapabilities?: { type?: string; items?: { type?: string } };
        };
      };
    }>;
  };
  const recommendSkillsTool = result.tools?.find(
    (tool) => tool.name === "recommend_skills",
  );

  assert.equal(response?.id, "tools");
  assert.ok(result.tools?.some((tool) => tool.name === "install_skill"));
  assert.equal(recommendSkillsTool?.inputSchema.additionalProperties, false);
  assert.deepEqual(
    recommendSkillsTool?.inputSchema.properties?.lane?.enum,
    skillLanes,
  );
  assert.equal(
    recommendSkillsTool?.inputSchema.properties?.limitPerLane?.type,
    "integer",
  );
  assert.equal(
    recommendSkillsTool?.inputSchema.properties?.limitPerLane?.minimum,
    1,
  );
  assert.equal(
    recommendSkillsTool?.inputSchema.properties?.hostCapabilities?.type,
    "array",
  );
  assert.equal(
    recommendSkillsTool?.inputSchema.properties?.hostCapabilities?.items?.type,
    "string",
  );
});

test("MCP tools publish complete effect and confirmation metadata", async () => {
  const response = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: "effects",
    method: "tools/list",
    params: {},
  });
  const tools = (response?.result as { tools: Array<{
    name: string;
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
    _meta?: Record<string, unknown>;
    inputSchema: { required?: string[]; properties?: Record<string, unknown> };
  }> }).tools;

  const expectedGroups = {
    "read-only": [
      "analyze_project", "recommend_skills", "audit_skill", "list_installed_skills",
      "plan_skill_install", "list_domains", "inspect_domain", "create_frontend_design_brief",
      "recommend_frontend_recipe", "validate_frontend_result", "compile_frontend_design_spec",
      "verify_frontend_result", "repair_frontend_result", "run_domain_eval", "inspect_skill_run",
       "compare_design_variants", "verify_visual_result",
    ],
    "exact-install-plan": ["install_skill"],
    "run-state-write": [
      "start_skill_run", "record_skill_read", "resolve_skill_run_clarifications",
      "begin_skill_run_execution", "complete_skill_run", "verify_skill_run",
      "read_next_skill_chunk", "begin_skill_step", "add_skill_evidence", "complete_skill_step",
       "verify_skill", "finalize_skill_run", "prepare_task", "read_run_skill_file",
    ],
    "command-and-artifact-write": ["capture_ui_evidence"],
  } as const;
  const expectedPresets = {
    "read-only": {
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      confirmation: "none",
    },
    "exact-install-plan": {
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      confirmation: "required",
    },
    "run-state-write": {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      confirmation: "host-managed",
    },
    "command-and-artifact-write": {
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      confirmation: "required",
    },
  } as const;

  assert.equal(tools.length, 33);
  for (const [effect, expectedNames] of Object.entries(expectedGroups)) {
    const matchingTools = tools.filter((tool) => tool._meta?.["skillranger/effect"] === effect);
    assert.deepEqual(matchingTools.map(({ name }) => name).sort(), [...expectedNames].sort(), effect);
    for (const tool of matchingTools) {
      const preset = expectedPresets[effect as keyof typeof expectedPresets];
      assert.deepEqual(tool.annotations, preset.annotations, tool.name);
      assert.equal(tool._meta?.["skillranger/confirmation"], preset.confirmation, tool.name);
    }
  }

  const exactPlanFields = ["expectedWrites", "expectedLockfileUpdates"];
  for (const field of exactPlanFields) {
    assert.deepEqual(
      tools.filter((tool) => tool.inputSchema.properties?.[field] !== undefined).map(({ name }) => name),
      ["install_skill"],
      field,
    );
  }
  const install = tools.find(({ name }) => name === "install_skill");
  assert.ok(install?.inputSchema.required?.includes("confirm"));
  for (const field of exactPlanFields) assert.ok(install?.inputSchema.required?.includes(field), field);
});

test("MCP protocol returns tool-level error results without JSON-RPC failure", async () => {
  const response = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "install_skill",
      arguments: {
        skillId: "frontend.next-app-router-review",
        projectRoot: "fixtures/next-react-ts",
        expectedWrites: [],
        expectedLockfileUpdates: []
      }
    }
  });
  const result = response?.result as { isError?: boolean; structuredContent?: { code?: string } };

  assert.equal(response?.error, undefined);
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent?.code, "confirmation-required");
});

test("MCP protocol rejects malformed tools/call params", async () => {
  const response = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      arguments: {}
    }
  });

  assert.equal(response?.error?.code, -32602);
});

test("MCP protocol returns parse error for malformed JSON lines", async () => {
  const response = await handleJsonRpcLine("{ not json");

  assert.equal(response?.id, null);
  assert.equal(response?.error?.code, -32700);
});

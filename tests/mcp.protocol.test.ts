import test from "node:test";
import assert from "node:assert/strict";
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

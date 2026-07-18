import { callMcpTool, mcpTools } from "./tools.ts";
import { readSkillRangerVersion } from "../version.ts";

const protocolVersion = "2025-06-18";

export type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

const success = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  result
});

const failure = (id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: {
    code,
    message,
    ...(data === undefined ? {} : { data })
  }
});

export const handleJsonRpcRequest = async (request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> => {
  const id = request.id ?? null;
  const method = request.method;

  if (!method) {
    return failure(id, -32600, "Invalid request: missing method.");
  }

  if (request.id === undefined) {
    return undefined;
  }

  if (method === "initialize") {
    const version = await readSkillRangerVersion();
    return success(id, {
      protocolVersion,
      capabilities: {
        tools: {
          listChanged: false
        }
      },
      serverInfo: {
        name: "skillranger",
        title: "SkillRanger",
        version
      },
      instructions:
        "SkillRanger provides read-only analysis and recommendation tools, exact-plan-confirmed skill installation, persisted skill-run lifecycle tools, and explicitly confirmed UI evidence capture. Capture constrains its declared output directory to the project, while the host-reviewed command remains open-world."
    });
  }

  if (method === "tools/list") {
    return success(id, { tools: mcpTools });
  }

  if (method === "tools/call") {
    const params = request.params ?? {};
    const toolName = params.name;
    if (typeof toolName !== "string" || toolName.trim() === "") {
      return failure(id, -32602, "Invalid params: tools/call requires params.name.");
    }
    const toolArgs = params.arguments;
    if (toolArgs !== undefined && (typeof toolArgs !== "object" || toolArgs === null || Array.isArray(toolArgs))) {
      return failure(id, -32602, "Invalid params: tools/call params.arguments must be an object when present.");
    }
    try {
      return success(id, await callMcpTool(toolName, (toolArgs ?? {}) as Record<string, unknown>));
    } catch (error) {
      return failure(id, -32603, error instanceof Error ? error.message : String(error), { code: "internal-error" });
    }
  }

  return failure(id, -32601, `Method not found: ${method}`);
};

export const handleJsonRpcLine = async (line: string): Promise<JsonRpcResponse | undefined> => {
  const trimmed = line.trim();
  if (!trimmed) return undefined;

  try {
    return await handleJsonRpcRequest(JSON.parse(trimmed) as JsonRpcRequest);
  } catch (error) {
    return failure(null, -32700, error instanceof Error ? error.message : String(error));
  }
};

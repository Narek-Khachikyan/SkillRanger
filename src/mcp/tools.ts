import {
  installToolDefinitions,
  installToolHandlers,
} from "./tools/install.ts";
import {
  projectToolDefinitions,
  projectToolHandlers,
} from "./tools/project.ts";
import {
  registryToolDefinitions,
  registryToolHandlers,
} from "./tools/registry.ts";
import {
  domainToolDefinitions,
  domainToolHandlers,
} from "./tools/domains.ts";
import {
  runToolDefinitions,
  runToolHandlers,
} from "./tools/runs.ts";
import type {
  JsonObject,
  McpToolDefinition,
  McpToolHandler,
  McpToolResult,
} from "./tools/types.ts";
import { codedErrorToolResult, withToolErrors } from "./tools/utils.ts";

export type {
  JsonObject,
  McpToolDefinition,
  McpToolResult,
} from "./tools/types.ts";

export const mcpTools: McpToolDefinition[] = [
  ...projectToolDefinitions,
  ...registryToolDefinitions,
  ...installToolDefinitions,
  ...domainToolDefinitions,
  ...runToolDefinitions,
];

const mcpToolHandlers: Record<string, McpToolHandler> = {
  ...projectToolHandlers,
  ...registryToolHandlers,
  ...installToolHandlers,
  ...domainToolHandlers,
  ...runToolHandlers,
};

export const callMcpTool = async (
  name: string,
  args: JsonObject = {},
): Promise<McpToolResult> => {
  const handler = mcpToolHandlers[name];
  if (!handler)
    return codedErrorToolResult("unknown-tool", `Unknown MCP tool: ${name}`, {
      toolName: name,
    });
  return withToolErrors(() => handler(args));
};

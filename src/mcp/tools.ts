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
import { visualToolDefinitions, visualToolHandlers } from "./tools/visual.ts";
import { routerToolDefinitions, routerToolHandlers } from "./tools/router.ts";
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
import { validateJsonSchema } from "../runtime/strict/json-schema.ts";

export type {
  JsonObject,
  McpToolAnnotations,
  McpToolDefinition,
  McpToolEffect,
  McpToolEffectMetadata,
  McpToolResult,
} from "./tools/types.ts";

export const mcpTools: McpToolDefinition[] = [
  ...projectToolDefinitions,
  ...registryToolDefinitions,
  ...installToolDefinitions,
  ...domainToolDefinitions,
  ...runToolDefinitions,
  ...visualToolDefinitions,
  ...routerToolDefinitions,
];

const mcpToolHandlers: Record<string, McpToolHandler> = {
  ...projectToolHandlers,
  ...registryToolHandlers,
  ...installToolHandlers,
  ...domainToolHandlers,
  ...runToolHandlers,
  ...visualToolHandlers,
  ...routerToolHandlers,
};

// Router tools enforce their own argument contract and map projectRoot/registryRoot
// injection to the project-root-unauthorized trust-boundary code (ADR 0001). Centralized
// validation must not preempt that authority, so it covers only the non-router tools.
const routerToolNames = new Set(routerToolDefinitions.map(({ name }) => name));
const mcpToolDefinitionsByName: Record<string, McpToolDefinition> = Object.fromEntries(
  mcpTools
    .filter(({ name }) => !routerToolNames.has(name))
    .map((definition) => [definition.name, definition]),
);

export const callMcpTool = async (
  name: string,
  args: JsonObject = {},
): Promise<McpToolResult> => {
  const handler = mcpToolHandlers[name];
  if (!handler)
    return codedErrorToolResult("unknown-tool", `Unknown MCP tool: ${name}`, {
      toolName: name,
    });
  const definition = mcpToolDefinitionsByName[name];
  if (definition) {
    const errors = validateJsonSchema(definition.inputSchema, args);
    if (errors.length > 0)
      return codedErrorToolResult("invalid-arguments", `Invalid arguments for ${name}: ${errors.join(" ")}`, {
        toolName: name,
      });
  }
  return withToolErrors(() => handler(args));
};

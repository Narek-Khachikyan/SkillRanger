import { auditSkill } from "../../audit/index.ts";
import { findSkill } from "../../registry/index.ts";
import type { McpToolDefinition, McpToolHandler } from "./types.ts";
import { McpToolError, mcpToolEffects } from "./types.ts";
import { jsonToolResult, registryRootProperty, requireString, resolveRegistryRoot } from "./utils.ts";

export const registryToolDefinitions: McpToolDefinition[] = [
  {
    ...mcpToolEffects.readOnly,
    name: "audit_skill",
    title: "Audit Skill",
    description: "Audit a local registry skill package for MVP security findings.",
    inputSchema: {
      type: "object",
      properties: {
        skillId: {
          type: "string",
          description: "Registry skill id to audit."
        },
        registryRoot: registryRootProperty
      },
      required: ["skillId"],
      additionalProperties: false
    }
  }
];

const auditRegistrySkill: McpToolHandler = async (args) => {
  const skillId = requireString(args.skillId, "skillId");
  const registryRoot = resolveRegistryRoot(args.registryRoot);
  const skill = await findSkill(skillId, registryRoot);
  if (!skill) throw new McpToolError("skill-not-found", `Skill not found: ${skillId}`, { skillId });
  return jsonToolResult(await auditSkill(skill));
};

export const registryToolHandlers: Record<string, McpToolHandler> = {
  audit_skill: auditRegistrySkill
};

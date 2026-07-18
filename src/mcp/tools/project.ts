import path from "node:path";
import { groupRecommendationsByLane, recommendSkills } from "../../recommender/index.ts";
import { loadLocalRegistry } from "../../registry/index.ts";
import { scanProject } from "../../scanner/index.ts";
import { skillLanes, type SkillLane } from "../../types.ts";
import { McpToolError, mcpToolEffects, type McpToolDefinition, type McpToolHandler } from "./types.ts";
import { asString, jsonToolResult, optionalString, projectRootProperty, registryRootProperty, requireStringArray, resolveRegistryRoot } from "./utils.ts";

export const projectToolDefinitions: McpToolDefinition[] = [
  {
    ...mcpToolEffects.readOnly,
    name: "analyze_project",
    title: "Analyze Project",
    description: "Scan a project and return its deterministic stack fingerprint.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: projectRootProperty
      },
      additionalProperties: false
    }
  },
  {
    ...mcpToolEffects.readOnly,
    name: "recommend_skills",
    title: "Recommend Skills",
    description: "Recommend relevant skills for a project fingerprint and target agent.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: projectRootProperty,
        registryRoot: registryRootProperty,
        targetAgent: {
          type: "string",
          description: "Target agent id. Defaults to codex."
        },
        userIntent: {
          type: "string",
          description: "Optional user intent used as an additional ranking signal."
        },
        lane: {
          type: "string",
          enum: [...skillLanes],
          description: "Optional skill lane filter."
        },
        limitPerLane: {
          type: "integer",
          minimum: 1,
          description: "Optional maximum recommendations to return per lane."
        },
        hostCapabilities: {
          type: "array",
          items: { type: "string" },
          description: "Optional host capabilities available for verified skill completion, such as browser and screenshots."
        }
      },
      additionalProperties: false
    }
  }
];

const analyzeProject: McpToolHandler = async (args) => {
  const projectRoot = path.resolve(asString(args.projectRoot, "."));
  return jsonToolResult({
    fingerprint: await scanProject(projectRoot)
  });
};

const optionalSkillLane = (value: unknown): SkillLane | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "string" && skillLanes.includes(value as SkillLane)) {
    return value as SkillLane;
  }
  throw new McpToolError("invalid-arguments", `lane must be one of ${skillLanes.join(", ")}.`, { argument: "lane" });
};

const optionalPositiveInteger = (value: unknown, name: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) {
    return value;
  }
  throw new McpToolError("invalid-arguments", `${name} must be a positive integer.`, { argument: name });
};

const optionalHostCapabilities = (value: unknown) => {
  if (value === undefined) return [];
  const capabilities = requireStringArray(value, "hostCapabilities");
  if (capabilities.some((capability) => capability.trim() === "")) {
    throw new McpToolError("invalid-arguments", "hostCapabilities must not contain empty strings.", {
      argument: "hostCapabilities",
    });
  }
  return capabilities;
};

const recommendProjectSkills: McpToolHandler = async (args) => {
  const projectRoot = path.resolve(asString(args.projectRoot, "."));
  const registryRoot = resolveRegistryRoot(args.registryRoot);
  const targetAgent = asString(args.targetAgent, "codex");
  const userIntent = optionalString(args.userIntent);
  const lane = optionalSkillLane(args.lane);
  const limitPerLane = optionalPositiveInteger(args.limitPerLane, "limitPerLane");
  const hostCapabilities = optionalHostCapabilities(args.hostCapabilities);
  const fingerprint = await scanProject(projectRoot);
  const skills = await loadLocalRegistry(registryRoot);
  const recommendations = recommendSkills(fingerprint, skills, {
    targetAgent,
    userIntent,
    lane,
    limitPerLane,
    hostCapabilities,
  });
  return jsonToolResult({
    projectRoot,
    targetAgent,
    recommendations,
    recommendationGroups: groupRecommendationsByLane(recommendations)
  });
};

export const projectToolHandlers: Record<string, McpToolHandler> = {
  analyze_project: analyzeProject,
  recommend_skills: recommendProjectSkills
};

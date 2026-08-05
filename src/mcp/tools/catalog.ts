import {
  inspectSkillCatalog,
  SkillCatalogError,
} from "../../router/catalog.ts";
import { McpToolError, mcpToolEffects, type McpToolDefinition, type McpToolHandler } from "./types.ts";
import { jsonToolResult } from "./utils.ts";

const digestSchema = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };

const catalogDomainSchema = {
  type: "object",
  required: ["domainId", "displayName", "description"],
  properties: {
    domainId: { type: "string", minLength: 1 },
    displayName: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
};

const catalogSkillSchema = {
  type: "object",
  required: [
    "skillId", "displayName", "description", "version", "domains", "roles", "actions",
    "artifactTypes", "intentTags", "technologyTags", "qualityGoals", "requiredCapabilities",
    "riskLevel", "supportedAgents",
  ],
  properties: {
    skillId: { type: "string", minLength: 1 },
    displayName: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    version: { type: "string", minLength: 1 },
    domains: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
    roles: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
    actions: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
    artifactTypes: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
    intentTags: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
    technologyTags: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
    qualityGoals: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
    requiredCapabilities: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
    riskLevel: { enum: ["low", "medium", "high", "block"] },
    supportedAgents: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
  },
  additionalProperties: false,
};

const catalogOutputSchema = {
  type: "object",
  required: ["ok", "schemaVersion", "catalogDigest", "domains", "skills", "nextCursor", "complete"],
  properties: {
    ok: { const: true },
    schemaVersion: { const: "skill-catalog/1.0" },
    catalogDigest: digestSchema,
    domains: { type: "array", items: catalogDomainSchema },
    skills: { type: "array", items: catalogSkillSchema },
    nextCursor: { oneOf: [{ type: "string", minLength: 1 }, { const: null }] },
    complete: { type: "boolean" },
    catalogReceipt: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
};

export const catalogToolDefinitions: McpToolDefinition[] = [
  {
    ...mcpToolEffects.readOnly,
    name: "inspect_skill_catalog",
    title: "Inspect Trusted Skill Catalog",
    description: "After an explicit @skillranger, /sr, or skillranger trigger, start with an empty request to discover the complete trusted bundled skill catalog. Follow nextCursor with expectedCatalogDigest until complete; this read-only discovery works before project setup and never scans the project or local skills.",
    inputSchema: {
      type: "object",
      properties: {
        cursor: { type: "string", minLength: 1, maxLength: 8_192, description: "Opaque continuation returned by the previous catalog page." },
        expectedCatalogDigest: { ...digestSchema, description: "Digest returned by the previous catalog page." },
        maxItems: { type: "integer", minimum: 1, maximum: 64, description: "Maximum skill cards per page. Keep this unchanged across a cursor chain." },
        maxBytes: { type: "integer", minimum: 1, maximum: 256_000, description: "Maximum UTF-8 bytes for the page's domains and skill cards. Keep this unchanged across a cursor chain." },
      },
      additionalProperties: false,
    },
    outputSchema: catalogOutputSchema,
  },
];

const inspectCatalog: McpToolHandler = async (args) => {
  try {
    return jsonToolResult(await inspectSkillCatalog({
      ...(typeof args.cursor === "string" ? { cursor: args.cursor } : {}),
      ...(typeof args.expectedCatalogDigest === "string" ? { expectedCatalogDigest: args.expectedCatalogDigest } : {}),
      ...(args.maxItems === undefined ? {} : { maxItems: args.maxItems as number }),
      ...(args.maxBytes === undefined ? {} : { maxBytes: args.maxBytes as number }),
    }));
  } catch (error) {
    if (error instanceof SkillCatalogError) {
      throw new McpToolError(error.code, error.message, error.details);
    }
    throw error;
  }
};

export const catalogToolHandlers: Record<string, McpToolHandler> = {
  inspect_skill_catalog: inspectCatalog,
};

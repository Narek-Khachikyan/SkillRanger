import path from "node:path";
import { defaultRegistryRoot } from "../../paths.ts";
import type { InstallScope } from "../../types.ts";
import type { JsonObject, McpToolErrorCode, McpToolResult } from "./types.ts";
import { McpToolError } from "./types.ts";

export const asString = (value: unknown, fallback: string) => (typeof value === "string" && value.trim() !== "" ? value : fallback);

export const optionalString = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value : undefined);

export const requireString = (value: unknown, name: string) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new McpToolError("invalid-arguments", `${name} must be a non-empty string.`, { argument: name });
  }
  return value;
};

export const requireStringArray = (value: unknown, name: string) => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new McpToolError("invalid-arguments", `${name} must be an array of strings.`, { argument: name });
  }
  return value;
};

export const asInstallScope = (value: unknown): InstallScope => {
  const scope = asString(value, "repo");
  if (scope !== "repo" && scope !== "user") {
    throw new McpToolError("invalid-arguments", "scope must be repo or user.", { argument: "scope" });
  }
  return scope;
};

export const jsonToolResult = (value: unknown): McpToolResult => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(value, null, 2)
    }
  ],
  structuredContent: value,
  isError: false
});

export const errorToolResult = (value: unknown): McpToolResult => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(value, null, 2)
    }
  ],
  structuredContent: value,
  isError: true
});

export const codedErrorToolResult = (code: McpToolErrorCode, message: string, details: JsonObject = {}) =>
  errorToolResult({
    ok: false,
    code,
    message,
    ...details
  });

export const withToolErrors = async (operation: () => Promise<McpToolResult>): Promise<McpToolResult> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof McpToolError) {
      return codedErrorToolResult(error.code, error.message, error.details);
    }
    if (error instanceof Error && error.message.startsWith("Unsupported target agent")) {
      return codedErrorToolResult("unsupported-target", error.message);
    }
    throw error;
  }
};

export const sameStrings = (left: string[], right: string[]) =>
  left.length === right.length && left.every((item, index) => item === right[index]);

export const projectRootProperty = {
  type: "string",
  description: "Project root to inspect. Defaults to the MCP server working directory."
};

export const registryRootProperty = {
  type: "string",
  description: "Local skill registry root. Defaults to the registry bundled with the SkillRanger package."
};

export const resolveRegistryRoot = (value: unknown) =>
  typeof value === "string" && value.trim() !== ""
    ? path.resolve(value)
    : defaultRegistryRoot;

export type JsonObject = Record<string, unknown>;

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonObject;
};

export type McpToolResult = {
  content: Array<{
    type: "text";
    text: string;
  }>;
  structuredContent: unknown;
  isError: boolean;
};

export type McpToolErrorCode =
  | "audit-blocked"
  | "confirmation-required"
  | "clarification-required"
  | "critic-required"
  | "invalid-arguments"
  | "invalid-transition"
  | "mandatory-skill-unread"
  | "repair-scope-violation"
  | "run-integrity"
  | "run-not-found"
  | "skill-not-found"
  | "stale-skill-checksum"
  | "stale-plan"
  | "unsupported-target"
  | "unknown-tool"
  | "verification-blocked";

export class McpToolError extends Error {
  code: McpToolErrorCode;
  details?: JsonObject;

  constructor(code: McpToolErrorCode, message: string, details?: JsonObject) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
    this.details = details;
  }
}

export type McpToolHandler = (args: JsonObject) => Promise<McpToolResult>;

export type JsonObject = Record<string, unknown>;

export type McpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type McpToolEffect =
  | "read-only"
  | "exact-install-plan"
  | "run-state-write"
  | "command-and-artifact-write";

export type McpToolEffectMetadata = {
  annotations: McpToolAnnotations;
  _meta: {
    "skillranger/effect": McpToolEffect;
    "skillranger/confirmation": "none" | "host-managed" | "required";
  };
};

export type McpToolDefinition = McpToolEffectMetadata & {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonObject;
};

export const mcpToolEffects = {
  readOnly: {
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { "skillranger/effect": "read-only", "skillranger/confirmation": "none" },
  },
  exactInstallPlan: {
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    _meta: { "skillranger/effect": "exact-install-plan", "skillranger/confirmation": "required" },
  },
  runStateWrite: {
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { "skillranger/effect": "run-state-write", "skillranger/confirmation": "host-managed" },
  },
  commandAndArtifactWrite: {
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    _meta: { "skillranger/effect": "command-and-artifact-write", "skillranger/confirmation": "required" },
  },
} as const satisfies Record<string, McpToolEffectMetadata>;

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
  | "verification-blocked"
  | "strict-contract-missing"
  | "strict-skill-not-installed"
  | "skill-content-unread"
  | "step-out-of-order"
  | "evidence-missing"
  | "unknown-rule-id"
  | "artifact-integrity"
  | "hard-gate-failed"
  | "repair-limit"
  | "run-not-finalizable";

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

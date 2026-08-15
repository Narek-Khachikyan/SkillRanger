// The task-preparation error vocabulary, shared by the preparation adapter and
// the router-runtime bridge that both throw it; the MCP surface maps its codes.

export class RouterPrepareError extends Error {
  readonly code: "trigger-required" | "empty-intent" | "intent-too-large" | "router-disabled" | "target-agent-unresolved" | "project-root-unauthorized" | "continuation-invalid" | "continuation-expired" | "clarification-answer-invalid" | "capability-invalid" | "router-config-invalid" | "routing-integrity" | "semantic-hint-invalid" | "routing-proposal-invalid" | "raw-intent-confirmation-required";

  constructor(code: RouterPrepareError["code"], message: string) {
    super(message);
    this.name = "RouterPrepareError";
    this.code = code;
  }
}

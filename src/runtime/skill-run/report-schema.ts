import { verificationReportEnums, verificationReportFieldSets, verificationReportSchemaVersion } from "./validation.ts";

/**
 * The JSON Schema projection of the lifecycle-v1 verification report contract, published inline
 * as verify_skill_run's `report` inputSchema (ADR 0010). Composed from the same exported
 * constants the hand-rolled validator enforces, so the published shape and the enforced shape
 * cannot drift apart. Per-run required universalContracts fields stay dynamic: they are declared
 * by policy.artifacts.coreOutputContracts on inspect_skill_run and surfaced in the
 * verification-blocked error details, not by this static shape.
 */
export const verificationReportInputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [...verificationReportFieldSets.root.required],
  properties: {
    schemaVersion: { const: verificationReportSchemaVersion },
    domain: { type: "string" },
    workflowId: { type: "string" },
    iteration: { type: "integer", minimum: 0 },
    capabilityStatus: { enum: [...verificationReportEnums.capabilityStatus] },
    executionStatus: { enum: [...verificationReportEnums.executionStatus] },
    verificationStatus: { enum: [...verificationReportEnums.verificationStatus] },
    outcome: { enum: [...verificationReportEnums.outcome] },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [...verificationReportFieldSets.finding.required],
        properties: {
          id: { type: "string" },
          code: { type: "string" },
          source: { type: "string" },
          severity: { enum: [...verificationReportEnums.severity] },
          gate: { enum: [...verificationReportEnums.gate] },
          message: { type: "string" },
          evidence: { type: "array", items: { type: "string" }, description: "References backing the finding." },
          remediation: { type: "string" },
          autofixable: { type: "boolean" },
          affectedSurface: { type: "string" },
        },
      },
    },
    gates: {
      type: "object",
      additionalProperties: false,
      required: [...verificationReportFieldSets.gates.required],
      properties: {
        hardPassed: { type: "boolean" },
        criticalFindings: { type: "integer", minimum: 0 },
        highFindings: { type: "integer", minimum: 0 },
      },
    },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [...verificationReportFieldSets.artifact.required],
        properties: {
          kind: { type: "string" },
          description: { type: "string" },
          path: { type: "string", description: "Project-contained relative path; required for a verified outcome." },
        },
      },
    },
    residualRisks: { type: "array", items: { type: "string" } },
    universalContracts: {
      type: "object",
      description: "Always-on guidance skill output contracts (ADR 0008): maps each selected core skill id to { reportField: non-empty statements }. The fields this run requires are declared by policy.artifacts.coreOutputContracts on inspect_skill_run; missing or empty required fields block verification with any outcome.",
      additionalProperties: {
        type: "object",
        additionalProperties: { type: "array", items: { type: "string", pattern: "\\S" } },
      },
    },
  },
};

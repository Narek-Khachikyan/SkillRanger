import type { CriticReportV2, ExecutionContractV2 } from "./types.ts";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown) => typeof value === "string" && value.trim().length > 0;

export const assertValidCriticReportV2: (input: unknown, contract: ExecutionContractV2) => asserts input is CriticReportV2 = (input, contract) => {
  if (!record(input)) throw new Error("Critic report must be an object.");
  const required = ["schemaVersion", "skillId", "criticInvocationId", "executorInvocationId", "outcome", "evidenceArtifactIds", "findings"];
  const unknown = Object.keys(input).find((key) => !required.includes(key));
  if (unknown || required.some((key) => !Object.hasOwn(input, key))) throw new Error("Critic report must use the closed v2 shape.");
  if (input.schemaVersion !== "2.0" || input.skillId !== contract.skillId) throw new Error("Critic report identity does not match the skill contract.");
  if (!nonEmpty(input.criticInvocationId) || !nonEmpty(input.executorInvocationId) || input.criticInvocationId === input.executorInvocationId) throw new Error("Critic invocation must be independent from the executor invocation.");
  if (input.outcome !== "clean" && input.outcome !== "findings") throw new Error("Critic outcome is invalid.");
  if (!Array.isArray(input.evidenceArtifactIds) || input.evidenceArtifactIds.length === 0 || !input.evidenceArtifactIds.every(nonEmpty)) throw new Error("Critic report evidenceArtifactIds must be a non-empty array of artifact IDs.");
  if (!Array.isArray(input.findings) || (input.outcome === "clean" && input.findings.length !== 0) || (input.outcome === "findings" && input.findings.length === 0)) throw new Error("Critic findings do not match the outcome.");
  const ruleIds = new Set(contract.rules.map(({ id }) => id));
  for (const [index, finding] of input.findings.entries()) {
    if (!record(finding)) throw new Error(`Critic finding ${index} must be an object.`);
    const fields = ["id", "ruleId", "severity", "message", "evidenceArtifactIds", "remediation"];
    if (Object.keys(finding).some((key) => !fields.includes(key)) || fields.some((key) => !Object.hasOwn(finding, key))) throw new Error(`Critic finding ${index} must use the closed shape.`);
    if (!nonEmpty(finding.id) || !nonEmpty(finding.message) || !nonEmpty(finding.remediation) || typeof finding.ruleId !== "string" || !ruleIds.has(finding.ruleId)) throw new Error(`Critic finding ${index} references an unknown rule or empty field.`);
    if (!["critical", "high", "medium", "low"].includes(finding.severity as string) || !Array.isArray(finding.evidenceArtifactIds) || !finding.evidenceArtifactIds.every(nonEmpty)) throw new Error(`Critic finding ${index} is invalid.`);
    for (const artifactId of finding.evidenceArtifactIds as string[]) {
      if (!(input.evidenceArtifactIds as string[]).includes(artifactId)) throw new Error(`Critic finding ${index} references evidence artifact ${artifactId} not included in top-level evidenceArtifactIds.`);
    }
  }
};

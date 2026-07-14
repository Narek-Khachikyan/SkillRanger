import { readFile } from "node:fs/promises";
import path from "node:path";
import { packageRoot } from "../../paths.ts";
import type { DesignCapabilityConstraints, DesignCapabilityProfile } from "../../domains/frontend/design/policy-types.ts";
import { visualRecipeIds } from "./suite.ts";

export type CapabilityMetricsInput = { benchmarkVersion: string; candidateId: string; sampleCount: number; meanQuality: number; catastrophicFailureRate: number; verificationSuccessRate: number; withinConditionVariance: number; meanRepairIterations: number; modelIds: string[]; successfulRecipeIds: string[]; evidencePaths: string[] };
export type ModelCapabilityRecord = { schemaVersion: "1.0"; id: string; benchmarkVersion: string; candidateId: string; modelIds: string[]; sampleCount: number; evaluatedAt: string; metrics: { meanQuality: number; catastrophicFailureRate: number; verificationSuccessRate: number; withinConditionVariance: number; meanRepairIterations: number }; profile: DesignCapabilityProfile; constraints: DesignCapabilityConstraints; evidencePaths: string[] };

const exactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const profileFor = (input: Pick<CapabilityMetricsInput, "sampleCount" | "meanQuality" | "catastrophicFailureRate" | "verificationSuccessRate" | "withinConditionVariance" | "meanRepairIterations">): DesignCapabilityProfile =>
  input.sampleCount < 16 || input.catastrophicFailureRate > .10 || input.verificationSuccessRate < .75 || input.withinConditionVariance > .12
    ? "constrained"
    : input.meanQuality >= .82 && input.catastrophicFailureRate <= .03 && input.verificationSuccessRate >= .90 && input.withinConditionVariance <= .06 && input.meanRepairIterations <= 1.5
      ? "advanced" : "standard";
const constraints = (profile: DesignCapabilityProfile, id: string, successful: string[]): DesignCapabilityConstraints => ({
  id, profile, maxVariants: profile === "advanced" ? 3 : profile === "standard" ? 2 : 1,
  allowedRecipeIds: profile === "advanced" && visualRecipeIds.every((recipe) => successful.includes(recipe)) ? [...visualRecipeIds] : [...new Set(successful)],
  maxCompositionFreedom: profile === "advanced" ? "free" : profile === "standard" ? "recipe-layouts" : "preserve",
  maxPrimitiveFreedom: profile === "advanced" ? "new-primitives" : profile === "standard" ? "local-variants" : "existing-only",
  implementationStrategy: profile === "advanced" ? "free" : profile === "standard" ? "patterns-preferred" : "verified-patterns-only",
});
const safeEvidencePath = (value: unknown) => typeof value === "string" && value.length > 0 && !path.isAbsolute(value)
  && !value.split(/[\\/]/).includes("..") && !/[\0\r\n]/.test(value);
const validRate = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

export const validateCapabilityRecord = (value: unknown): string[] => {
  const issues: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["record must be an object"];
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["schemaVersion", "id", "benchmarkVersion", "candidateId", "modelIds", "sampleCount", "evaluatedAt", "metrics", "profile", "constraints", "evidencePaths"])) issues.push("record has invalid keys");
  if (record.schemaVersion !== "1.0") issues.push("schemaVersion must be 1.0");
  if (typeof record.id !== "string" || !/^[a-z0-9][a-z0-9._-]+$/.test(record.id)) issues.push("id must be a safe non-empty identifier");
  if (record.benchmarkVersion !== "visual-benchmark-v1") issues.push("benchmarkVersion must be visual-benchmark-v1");
  if (!["weak", "medium", "strong", "unknown"].includes(String(record.candidateId))) issues.push("candidateId is invalid");
  if (!Array.isArray(record.modelIds) || !record.modelIds.every((item) => typeof item === "string" && item.trim().length > 0) || new Set(record.modelIds as unknown[]).size !== record.modelIds.length) issues.push("modelIds must contain unique non-empty strings");
  if (record.candidateId === "unknown" && ((record.modelIds as unknown[])?.length !== 0 || record.sampleCount !== 0)) issues.push("unknown candidate must have no model ids or samples");
  if (!Number.isInteger(record.sampleCount) || Number(record.sampleCount) < 0) issues.push("sampleCount must be a non-negative integer");
  if (typeof record.evaluatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.evaluatedAt) || !Number.isFinite(Date.parse(record.evaluatedAt)) || new Date(record.evaluatedAt).toISOString() !== record.evaluatedAt) issues.push("evaluatedAt must be an exact ISO timestamp");
  const metrics = record.metrics;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)
    || !exactKeys(metrics as Record<string, unknown>, ["meanQuality", "catastrophicFailureRate", "verificationSuccessRate", "withinConditionVariance", "meanRepairIterations"])) issues.push("metrics has invalid keys");
  const metric = (metrics && typeof metrics === "object" ? metrics : {}) as Record<string, unknown>;
  for (const key of ["meanQuality", "catastrophicFailureRate", "verificationSuccessRate", "withinConditionVariance"]) if (!validRate(metric[key])) issues.push(`${key} must be finite and between 0 and 1`);
  if (typeof metric.meanRepairIterations !== "number" || !Number.isFinite(metric.meanRepairIterations) || metric.meanRepairIterations < 0) issues.push("meanRepairIterations must be finite and non-negative");
  if (!["constrained", "standard", "advanced"].includes(String(record.profile))) issues.push("profile is invalid");
  const constraintValue = record.constraints;
  if (!constraintValue || typeof constraintValue !== "object" || Array.isArray(constraintValue)
    || !exactKeys(constraintValue as Record<string, unknown>, ["id", "profile", "maxVariants", "allowedRecipeIds", "maxCompositionFreedom", "maxPrimitiveFreedom", "implementationStrategy"])) issues.push("constraints has invalid keys");
  const capability = (constraintValue && typeof constraintValue === "object" ? constraintValue : {}) as Record<string, unknown>;
  const recipes = capability.allowedRecipeIds;
  if (!Array.isArray(recipes) || !recipes.every((recipe) => typeof recipe === "string" && visualRecipeIds.includes(recipe as typeof visualRecipeIds[number])) || new Set(recipes as unknown[]).size !== recipes.length) issues.push("allowedRecipeIds contains an invalid or duplicate recipe");
  if (!Array.isArray(record.evidencePaths) || !record.evidencePaths.every(safeEvidencePath) || new Set(record.evidencePaths as unknown[]).size !== record.evidencePaths.length) issues.push("evidencePaths must be unique safe contained relative paths");
  if (issues.length === 0) {
    const profile = record.profile as DesignCapabilityProfile;
    const expected = constraints(profile, record.id as string, recipes as string[]);
    for (const key of ["id", "profile", "maxVariants", "maxCompositionFreedom", "maxPrimitiveFreedom", "implementationStrategy"] as const) {
      if (capability[key] !== expected[key]) issues.push(`constraints.${key} is inconsistent with profile`);
    }
    const classified = profileFor({ sampleCount: record.sampleCount as number, meanQuality: metric.meanQuality as number, catastrophicFailureRate: metric.catastrophicFailureRate as number, verificationSuccessRate: metric.verificationSuccessRate as number, withinConditionVariance: metric.withinConditionVariance as number, meanRepairIterations: metric.meanRepairIterations as number });
    if (classified !== profile) issues.push("profile is inconsistent with metrics");
  }
  return issues;
};

export const calibrateCapabilityRecord = (input: CapabilityMetricsInput): ModelCapabilityRecord => {
  for (const [key, value] of Object.entries(input)) if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${key} must be finite`);
  const profile = profileFor(input);
  const id = `${input.benchmarkVersion}-${input.candidateId}-${profile}`;
  const record: ModelCapabilityRecord = { schemaVersion: "1.0", id, benchmarkVersion: input.benchmarkVersion, candidateId: input.candidateId, modelIds: [...input.modelIds], sampleCount: input.sampleCount, evaluatedAt: new Date().toISOString(), metrics: { meanQuality: input.meanQuality, catastrophicFailureRate: input.catastrophicFailureRate, verificationSuccessRate: input.verificationSuccessRate, withinConditionVariance: input.withinConditionVariance, meanRepairIterations: input.meanRepairIterations }, profile, constraints: constraints(profile, id, input.successfulRecipeIds), evidencePaths: [...input.evidencePaths] };
  const issues = validateCapabilityRecord(record);
  if (issues.length) throw new Error(`Invalid model capability record: ${issues.join("; ")}`);
  return record;
};
export const constraintsFromCapabilityRecord = (record: ModelCapabilityRecord): DesignCapabilityConstraints => {
  const issues = validateCapabilityRecord(record);
  if (issues.length) throw new Error(`Invalid model capability record: ${issues.join("; ")}`);
  return { ...record.constraints, allowedRecipeIds: [...(record.constraints.allowedRecipeIds ?? [])] };
};
export const loadCapabilityRecord = async (recordPath = path.join(packageRoot, "domains/frontend/capabilities/default-constrained.json")): Promise<ModelCapabilityRecord> => {
  const record = JSON.parse(await readFile(path.resolve(recordPath), "utf8")) as ModelCapabilityRecord;
  const issues = validateCapabilityRecord(record);
  if (issues.length) throw new Error(`Invalid model capability record: ${issues.join("; ")}`);
  return record;
};

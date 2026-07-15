import path from "node:path";
import type { ApplicabilityContext, ApplicabilityPredicate, ExecutionContractV2 } from "./types.ts";

const coreValidators = new Set([
  "core/artifact-integrity",
  "core/critic-independence",
  "frontend/tailwind-source",
  "frontend/browser-hard-gates",
  "frontend/performance-claims",
]);
const canonicalId = /^[a-z0-9][a-z0-9._-]+\/(?:step|rule|gate)\/[a-z0-9][a-z0-9._-]*$/;
const safePath = (value: string) => value.length > 0 && !path.isAbsolute(value) && !value.replace(/\\/g, "/").split("/").includes("..");
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const ownKeys = (value: Record<string, unknown>, allowed: string[], label: string) => {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${label} contains unknown property ${unknown}.`);
};
const nonEmpty: (value: unknown, label: string) => asserts value is string = (value, label) => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string.`);
};

const validatePredicate: (value: unknown, label?: string) => asserts value is ApplicabilityPredicate = (value, label = "applicability") => {
  if (!record(value)) throw new Error(`${label} must be an object.`);
  nonEmpty(value.op, `${label}.op`);
  switch (value.op) {
    case "all":
    case "any":
      ownKeys(value, ["op", "conditions"], label);
      if (!Array.isArray(value.conditions) || value.conditions.length === 0) throw new Error(`${label}.conditions must be non-empty.`);
      value.conditions.forEach((child, index) => validatePredicate(child, `${label}.conditions[${index}]`));
      return;
    case "not":
      ownKeys(value, ["op", "condition"], label);
      validatePredicate(value.condition, `${label}.condition`);
      return;
    case "tag":
      ownKeys(value, ["op", "value"], label);
      nonEmpty(value.value, `${label}.value`);
      return;
    case "signal": {
      ownKeys(value, ["op", "collection", "name", "minConfidence"], label);
      const collections = new Set(["projectTypes", "languages", "frameworks", "styling", "testing", "infrastructure"]);
      if (typeof value.collection !== "string" || !collections.has(value.collection)) throw new Error(`${label}.collection is invalid.`);
      nonEmpty(value.name, `${label}.name`);
      if (value.minConfidence !== undefined && (typeof value.minConfidence !== "number" || value.minConfidence < 0 || value.minConfidence > 1)) {
        throw new Error(`${label}.minConfidence must be between 0 and 1.`);
      }
      return;
    }
    case "input":
      ownKeys(value, ["op", "path", "present", "equals"], label);
      nonEmpty(value.path, `${label}.path`);
      if (value.present === undefined && value.equals === undefined) throw new Error(`${label} input predicate needs present or equals.`);
      return;
    default:
      throw new Error(`${label}.op is not allowlisted.`);
  }
};

export const assertValidExecutionContract: (input: unknown) => asserts input is ExecutionContractV2 = (input) => {
  if (!record(input)) throw new Error("Execution contract must be an object.");
  const required = ["schemaVersion", "skillId", "contractVersion", "inputSchema", "outputSchema", "mustRead", "applicability", "prerequisites", "steps", "rules", "gates", "maxRepairIterations"];
  ownKeys(input, required, "execution contract");
  for (const key of required) if (!Object.hasOwn(input, key)) throw new Error(`Execution contract is missing ${key}.`);
  if (input.schemaVersion !== "2.0") throw new Error("Execution contract schemaVersion must be 2.0.");
  for (const key of ["skillId", "contractVersion", "inputSchema", "outputSchema"] as const) nonEmpty(input[key], key);
  if (!safePath(input.inputSchema as string) || !safePath(input.outputSchema as string)) throw new Error("Execution contract schema paths must be safe relative paths.");
  if (!Array.isArray(input.mustRead) || input.mustRead.length === 0 || !input.mustRead.every((entry) => typeof entry === "string" && safePath(entry))) {
    throw new Error("Execution contract mustRead must contain safe relative paths.");
  }
  if (new Set(input.mustRead).size !== input.mustRead.length || !input.mustRead.includes("SKILL.md")) throw new Error("Execution contract mustRead must uniquely include SKILL.md.");
  validatePredicate(input.applicability);
  if (!Array.isArray(input.prerequisites) || !Array.isArray(input.steps) || input.steps.length === 0 || !Array.isArray(input.rules) || !Array.isArray(input.gates)) {
    throw new Error("Execution contract arrays are incomplete.");
  }
  const prefix = input.skillId as string;
  const ruleIds = new Set<string>();
  for (const [index, raw] of input.rules.entries()) {
    if (!record(raw)) throw new Error(`rules[${index}] must be an object.`);
    ownKeys(raw, ["id", "description"], `rules[${index}]`);
    nonEmpty(raw.id, `rules[${index}].id`);
    nonEmpty(raw.description, `rules[${index}].description`);
    if (!canonicalId.test(raw.id) || !raw.id.startsWith(`${prefix}/rule/`)) throw new Error(`Rule id ${raw.id} is not canonical.`);
    if (ruleIds.has(raw.id)) throw new Error(`Duplicate rule id ${raw.id}.`);
    ruleIds.add(raw.id);
  }
  const validateRuleRefs = (values: unknown, label: string) => {
    if (!Array.isArray(values) || !values.every((entry) => typeof entry === "string")) throw new Error(`${label} must be an array of rule ids.`);
    const unknown = values.find((id) => !ruleIds.has(id));
    if (unknown) throw new Error(`${label} references unknown rule ${unknown}.`);
  };
  const stepIds = new Set<string>();
  for (const [index, raw] of input.steps.entries()) {
    if (!record(raw)) throw new Error(`steps[${index}] must be an object.`);
    ownKeys(raw, ["id", "type", "requiredEvidenceKinds", "ruleIds", "repairable"], `steps[${index}]`);
    nonEmpty(raw.id, `steps[${index}].id`);
    if (!canonicalId.test(raw.id) || !raw.id.startsWith(`${prefix}/step/`)) throw new Error(`Step id ${raw.id} is not canonical.`);
    if (stepIds.has(raw.id)) throw new Error(`Duplicate step id ${raw.id}.`);
    stepIds.add(raw.id);
    if (!["collect", "validate", "implement", "critic", "verify", "repair", "report"].includes(raw.type as string)) throw new Error(`steps[${index}].type is invalid.`);
    if (!Array.isArray(raw.requiredEvidenceKinds) || !raw.requiredEvidenceKinds.every((kind) => typeof kind === "string" && kind.length > 0)) throw new Error(`steps[${index}].requiredEvidenceKinds is invalid.`);
    validateRuleRefs(raw.ruleIds, `steps[${index}].ruleIds`);
  }
  const gateIds = new Set<string>();
  for (const [index, raw] of input.gates.entries()) {
    if (!record(raw) || !record(raw.evaluator)) throw new Error(`gates[${index}] is invalid.`);
    ownKeys(raw, ["id", "level", "evaluator", "ruleIds"], `gates[${index}]`);
    nonEmpty(raw.id, `gates[${index}].id`);
    if (!canonicalId.test(raw.id) || !raw.id.startsWith(`${prefix}/gate/`)) throw new Error(`Gate id ${raw.id} is not canonical.`);
    if (gateIds.has(raw.id)) throw new Error(`Duplicate gate id ${raw.id}.`);
    gateIds.add(raw.id);
    if (raw.level !== "hard" && raw.level !== "advisory") throw new Error(`gates[${index}].level is invalid.`);
    validateRuleRefs(raw.ruleIds, `gates[${index}].ruleIds`);
    const evaluator = raw.evaluator;
    if (evaluator.type === "evidence-present") {
      ownKeys(evaluator, ["type", "evidenceKind"], `gates[${index}].evaluator`);
      nonEmpty(evaluator.evidenceKind, `gates[${index}].evaluator.evidenceKind`);
    } else if (evaluator.type === "schema-valid") {
      ownKeys(evaluator, ["type", "schema"], `gates[${index}].evaluator`);
      if (!["input", "output", "critic-report"].includes(evaluator.schema as string)) throw new Error(`gates[${index}].evaluator.schema is invalid.`);
    } else if (evaluator.type === "validator") {
      ownKeys(evaluator, ["type", "validatorId"], `gates[${index}].evaluator`);
      if (typeof evaluator.validatorId !== "string" || !coreValidators.has(evaluator.validatorId)) throw new Error(`Gate validator ${String(evaluator.validatorId)} is not registered.`);
    } else {
      throw new Error(`gates[${index}].evaluator.type is not allowlisted.`);
    }
  }
  for (const [index, raw] of input.prerequisites.entries()) {
    if (!record(raw)) throw new Error(`prerequisites[${index}] must be an object.`);
    if (raw.kind === "capability") {
      ownKeys(raw, ["id", "kind", "capability", "requiredStatus"], `prerequisites[${index}]`);
      nonEmpty(raw.id, `prerequisites[${index}].id`);
      nonEmpty(raw.capability, `prerequisites[${index}].capability`);
      if (raw.requiredStatus !== "ready") throw new Error(`prerequisites[${index}].requiredStatus must be ready.`);
    } else if (raw.kind === "input") {
      ownKeys(raw, ["id", "kind", "path"], `prerequisites[${index}]`);
      nonEmpty(raw.id, `prerequisites[${index}].id`);
      nonEmpty(raw.path, `prerequisites[${index}].path`);
    } else throw new Error(`prerequisites[${index}].kind is invalid.`);
  }
  if (!Number.isInteger(input.maxRepairIterations) || (input.maxRepairIterations as number) < 1 || (input.maxRepairIterations as number) > 5) {
    throw new Error("maxRepairIterations must be an integer from 1 to 5.");
  }
};

const inputValue = (input: Record<string, unknown>, inputPath: string): unknown => inputPath.split(".").reduce<unknown>((value, key) => record(value) ? value[key] : undefined, input);

export const evaluateApplicability = (predicate: ApplicabilityPredicate, context: ApplicabilityContext): boolean => {
  switch (predicate.op) {
    case "all": return predicate.conditions.every((child) => evaluateApplicability(child, context));
    case "any": return predicate.conditions.some((child) => evaluateApplicability(child, context));
    case "not": return !evaluateApplicability(predicate.condition, context);
    case "tag": return context.fingerprint.tags.includes(predicate.value);
    case "signal": {
      const collection = context.fingerprint[predicate.collection] as Array<{ name?: string; type?: string; confidence: number }>;
      return collection.some((signal) => (signal.name ?? signal.type) === predicate.name && signal.confidence >= (predicate.minConfidence ?? 0));
    }
    case "input": {
      const value = inputValue(context.input, predicate.path);
      if (predicate.equals !== undefined && value !== predicate.equals) return false;
      return predicate.present === undefined || predicate.present === (value !== undefined && value !== null);
    }
  }
};

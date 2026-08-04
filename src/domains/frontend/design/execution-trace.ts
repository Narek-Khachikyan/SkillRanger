import { createHash } from "node:crypto";
import { canonicalizeJson } from "../../../runtime/skill-run/validation.ts";
import type { VerificationFinding } from "../../../runtime/types.ts";
import { compareRecipeExamplePack } from "./example-comparison.ts";
import type { LoadedRecipeExamplePack } from "./example-types.ts";
import type { BoundedRepairRequest, DesignExecutionPolicy } from "./policy-types.ts";
import { validateDesignDirection } from "./validation.ts";
import type { DesignDirection } from "./types.ts";
import type { DesignVariantMetadata } from "./visual-loop-types.ts";

const digest = (value: unknown): string =>
  `sha256:${createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex")}`;

const digestPattern = /^sha256:[a-f0-9]{64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const hardFinding = (input: {
  code: string;
  message: string;
  evidence: string[];
  remediation: string;
}): VerificationFinding => ({
  id: input.code,
  code: input.code,
  source: "frontend.design-execution-trace",
  severity: "critical",
  gate: "hard",
  message: input.message,
  evidence: input.evidence,
  remediation: input.remediation,
  autofixable: false,
});

export type DesignExecutionTrace = {
  schemaVersion: "1.0";
  id: string;
  directionPath: string;
  directionDigest: string;
  recipeId: string;
  examplePackPath: string;
  examplePackDigest: string;
  ruleSelectionDigest: string;
};

export type DesignExecutionTraceSources = {
  brief: unknown;
  direction: unknown;
  examplePack?: unknown;
  policy?: DesignExecutionPolicy;
};

const examplePackPayload = (pack: LoadedRecipeExamplePack) => ({
  schemaVersion: pack.schemaVersion,
  recipeId: pack.recipeId,
  productScenario: pack.productScenario,
  differenceExplanation: [...pack.differenceExplanation],
  scenes: pack.scenes.map(({ assetPath, ...scene }) => scene),
});

export const digestDesignDirection = (direction: DesignDirection): string => digest(direction);

export const digestRecipeExamplePack = (pack: LoadedRecipeExamplePack): string =>
  digest(examplePackPayload(pack));

export const digestRuleSelection = (selectedRuleIds: readonly string[]): string =>
  digest([...selectedRuleIds]);

const isLoadedExamplePack = (value: unknown): value is LoadedRecipeExamplePack =>
  isRecord(value)
  && value.schemaVersion === "1.0"
  && nonEmpty(value.recipeId)
  && nonEmpty(value.sourcePath)
  && Array.isArray(value.differenceExplanation)
  && value.differenceExplanation.every(nonEmpty)
  && Array.isArray(value.scenes)
  && value.scenes.every((scene) => isRecord(scene) && nonEmpty(scene.id));

const traceShapeIssues = (value: unknown): string[] => {
  if (!isRecord(value)) return ["trace must be an object"];
  const issues: string[] = [];
  if (value.schemaVersion !== "1.0") issues.push("trace schemaVersion must be 1.0");
  for (const [field, fieldValue] of [
    ["id", value.id],
    ["directionPath", value.directionPath],
    ["recipeId", value.recipeId],
    ["examplePackPath", value.examplePackPath],
  ] as const) {
    if (!nonEmpty(fieldValue)) issues.push(`trace ${field} must be non-empty`);
  }
  for (const [field, fieldValue] of [
    ["directionDigest", value.directionDigest],
    ["examplePackDigest", value.examplePackDigest],
    ["ruleSelectionDigest", value.ruleSelectionDigest],
  ] as const) {
    if (typeof fieldValue !== "string" || !digestPattern.test(fieldValue)) {
      issues.push(`trace ${field} must be a sha256 digest`);
    }
  }
  const allowed = new Set([
    "schemaVersion", "id", "directionPath", "directionDigest", "recipeId",
    "examplePackPath", "examplePackDigest", "ruleSelectionDigest",
  ]);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) issues.push(`trace contains unknown field ${unexpected}`);
  return issues;
};

export const assertValidDesignExecutionTrace: (
  value: unknown,
) => asserts value is DesignExecutionTrace = (value) => {
  const issues = traceShapeIssues(value);
  if (issues.length > 0) throw new Error(`Invalid design execution trace: ${issues.join("; ")}`);
};

/**
 * Material execution keeps legacy schema-1 directions readable, but it must never
 * promote a direction that omitted its six-family rule decision. This validator is
 * the material-only boundary used before implementation and at final verification.
 */
export const validateMaterialDesignDirection = (
  brief: unknown,
  direction: unknown,
): VerificationFinding[] => {
  const findings = validateDesignDirection(brief, direction);
  if (!isRecord(direction) || !Object.hasOwn(direction, "selectedRuleIds")) {
    findings.push(hardFinding({
      code: "direction-rule-selection-missing",
      message: "Material design execution requires six recorded rule identifiers before implementation.",
      evidence: [],
      remediation: "Select exactly one compatible rule from typography, layout, responsive, color, state, and signature-move before implementation.",
    }));
  }
  return findings;
};

const validateSources = (input: DesignExecutionTraceSources): VerificationFinding[] => {
  const findings = validateMaterialDesignDirection(input.brief, input.direction);
  const direction = isRecord(input.direction) ? input.direction : undefined;
  if (input.policy && direction && nonEmpty(direction.recipeId)
    && !input.policy.allowedRecipeIds.includes(direction.recipeId)) {
    findings.push(hardFinding({
      code: "visual-execution-policy-recipe-mismatch",
      message: "The material direction selects a recipe outside the resolved execution policy.",
      evidence: [direction.recipeId],
      remediation: "Use a recipe allowed by the resolved design execution policy.",
    }));
  }

  if (!isLoadedExamplePack(input.examplePack)) {
    findings.push(hardFinding({
      code: "visual-execution-example-pack-missing",
      message: "Material visual execution requires the selected recipe's loaded worked-example pack.",
      evidence: direction && nonEmpty(direction.recipeId) ? [direction.recipeId] : [],
      remediation: "Load the canonical example pack for the selected recipe and attach it before implementation.",
    }));
    return findings;
  }

  if (direction && nonEmpty(direction.recipeId)) {
    let comparison: ReturnType<typeof compareRecipeExamplePack> | undefined;
    try {
      comparison = compareRecipeExamplePack(input.examplePack, {
        recipeId: direction.recipeId,
        selectedRuleIds: Array.isArray(direction.selectedRuleIds)
          ? direction.selectedRuleIds.filter((id): id is string => typeof id === "string")
          : undefined,
      });
    } catch (error) {
      findings.push(hardFinding({
        code: "visual-execution-example-pack-invalid",
        message: "The selected worked-example pack could not be compared with the material direction.",
        evidence: [error instanceof Error ? error.message : String(error)],
        remediation: "Load and validate the canonical recipe example pack before material execution.",
      }));
    }
    if (comparison && !comparison.ok) {
      findings.push(hardFinding({
        code: "visual-execution-example-mismatch",
        message: "The selected direction is not compatible with the selected recipe's worked examples.",
        evidence: comparison.findings,
        remediation: "Use six compatible rules demonstrated by the recipe's good reference scene.",
      }));
    }
  }
  return findings;
};

const traceMismatchFindings = (
  trace: DesignExecutionTrace,
  input: DesignExecutionTraceSources,
): VerificationFinding[] => {
  const findings: VerificationFinding[] = [];
  const direction = isRecord(input.direction) ? input.direction : undefined;
  const pack = isLoadedExamplePack(input.examplePack) ? input.examplePack : undefined;
  if (direction && trace.recipeId !== direction.recipeId) {
    findings.push(hardFinding({
      code: "visual-execution-trace-mismatch",
      message: "The execution trace recipe does not match the supplied direction.",
      evidence: [trace.recipeId, typeof direction.recipeId === "string" ? direction.recipeId : "missing"],
      remediation: "Use the immutable trace created from the same direction and recipe.",
    }));
  }
  if (direction && trace.directionDigest !== digestDesignDirection(direction as unknown as DesignDirection)) {
    findings.push(hardFinding({
      code: "visual-execution-trace-mismatch",
      message: "The design direction changed after the execution trace was recorded.",
      evidence: [trace.directionPath, trace.directionDigest],
      remediation: "Restart material execution and record a new trace before implementation.",
    }));
  }
  if (pack && trace.examplePackDigest !== digestRecipeExamplePack(pack)) {
    findings.push(hardFinding({
      code: "visual-execution-trace-mismatch",
      message: "The worked-example pack changed after the execution trace was recorded.",
      evidence: [trace.examplePackPath, trace.examplePackDigest],
      remediation: "Restart material execution with the current validated example pack.",
    }));
  }
  if (direction && Array.isArray(direction.selectedRuleIds)
    && trace.ruleSelectionDigest !== digestRuleSelection(direction.selectedRuleIds.filter((id): id is string => typeof id === "string"))) {
    findings.push(hardFinding({
      code: "visual-execution-trace-mismatch",
      message: "The selected rule identifiers changed after the execution trace was recorded.",
      evidence: [trace.directionPath, trace.ruleSelectionDigest],
      remediation: "Restart material execution and record the current six-rule selection before implementation.",
    }));
  }
  return findings;
};

export const validateMaterialVisualExecution = (input: DesignExecutionTraceSources & {
  trace?: unknown;
  requireTrace?: boolean;
}): VerificationFinding[] => {
  const findings = validateSources(input);
  if (input.trace === undefined) {
    if (input.requireTrace !== false) {
      findings.push(hardFinding({
        code: "visual-execution-trace-missing",
        message: "Material visual execution has no persisted design execution trace.",
        evidence: [],
        remediation: "Record the direction and worked-example decision before implementation.",
      }));
    }
    return findings;
  }
  const shapeIssues = traceShapeIssues(input.trace);
  if (shapeIssues.length > 0) {
    findings.push(hardFinding({
      code: "visual-execution-trace-invalid",
      message: "The persisted design execution trace is malformed.",
      evidence: shapeIssues,
      remediation: "Regenerate the trace using the published design execution trace contract.",
    }));
    return findings;
  }
  findings.push(...traceMismatchFindings(input.trace as DesignExecutionTrace, input));
  return findings;
};

export const createDesignExecutionTrace = (input: {
  id: string;
  directionPath: string;
  examplePackPath: string;
  brief?: unknown;
  direction: DesignDirection;
  examplePack: LoadedRecipeExamplePack;
  policy?: DesignExecutionPolicy;
}): DesignExecutionTrace => {
  const sourceFindings = validateSources({
    brief: input.brief ?? {},
    direction: input.direction,
    examplePack: input.examplePack,
    policy: input.policy,
  });
  const invalidSource = sourceFindings.find(({ gate, severity }) =>
    gate === "hard" && (severity === "critical" || severity === "high"));
  if (invalidSource) {
    throw new Error(`Cannot create design execution trace: ${sourceFindings.map(({ code }) => code).join(", ")}`);
  }
  if (!nonEmpty(input.id) || !nonEmpty(input.directionPath) || !nonEmpty(input.examplePackPath)) {
    throw new Error("Cannot create design execution trace: id and source paths must be non-empty");
  }
  if (!Array.isArray(input.direction.selectedRuleIds)) {
    throw new Error("Cannot create design execution trace: six rule identifiers are required");
  }
  return {
    schemaVersion: "1.0",
    id: input.id,
    directionPath: input.directionPath,
    directionDigest: digestDesignDirection(input.direction),
    recipeId: input.direction.recipeId,
    examplePackPath: input.examplePackPath,
    examplePackDigest: digestRecipeExamplePack(input.examplePack),
    ruleSelectionDigest: digestRuleSelection(input.direction.selectedRuleIds),
  };
};

export const validateDesignVariantAgainstTrace = (input: {
  trace: DesignExecutionTrace;
  direction: DesignDirection;
  variant: DesignVariantMetadata;
}): VerificationFinding[] => {
  const findings: VerificationFinding[] = [];
  if (input.variant.recipeId !== input.trace.recipeId || input.variant.recipeId !== input.direction.recipeId) {
    findings.push(hardFinding({
      code: "visual-variant-recipe-mismatch",
      message: "The visual variant recipe does not match the traced direction.",
      evidence: [input.variant.recipeId, input.trace.recipeId, input.direction.recipeId],
      remediation: "Create the variant from the traced direction's selected recipe.",
    }));
  }
  if (input.variant.directionPath !== input.trace.directionPath) {
    findings.push(hardFinding({
      code: "visual-variant-direction-mismatch",
      message: "The visual variant does not point to the traced direction artifact.",
      evidence: [input.variant.directionPath, input.trace.directionPath],
      remediation: "Persist the direction path from the material execution trace on every variant.",
    }));
  }
  const selectedRuleIds = input.direction.selectedRuleIds;
  if (!Array.isArray(selectedRuleIds)
    || input.variant.ruleIds.length !== selectedRuleIds.length
    || input.variant.ruleIds.some((ruleId, index) => ruleId !== selectedRuleIds[index])) {
    findings.push(hardFinding({
      code: "visual-variant-rule-selection-mismatch",
      message: "The visual variant rule identifiers do not match the traced direction.",
      evidence: [...input.variant.ruleIds, ...(selectedRuleIds ?? [])],
      remediation: "Derive variant ruleIds from the six rule identifiers recorded on the direction before implementation.",
    }));
  }
  return findings;
};

export const validateRepairTrace = (input: {
  request?: BoundedRepairRequest;
  targetVariantId: string;
  sourceEvidenceId: string;
}): VerificationFinding[] => {
  if (!input.request) return [];
  const findings: VerificationFinding[] = [];
  if (input.request.targetVariantId !== input.targetVariantId
    || input.request.sourceEvidenceId !== input.sourceEvidenceId) {
    findings.push(hardFinding({
      code: "visual-repair-trace-mismatch",
      message: "The bounded repair request is not attached to the traced selected variant and evidence.",
      evidence: [input.request.id, input.request.targetVariantId, input.request.sourceEvidenceId],
      remediation: "Create the repair request from the selected traced variant's initial evidence.",
    }));
  }
  return findings;
};

import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import {
  compareDesignVariants,
  createUiEvidenceCapturePlan,
  createVisualCriticInput,
  executeUiEvidenceCapture,
  verifyVisualResult,
  type DesignBrief,
  type DesignExecutionPolicy,
  type DesignDirection,
  type BoundedRepairRequest,
  type UiEvidenceBundle,
  type VisualCriticInput,
  type VisualCriticReport,
  type VisualRun,
  type DesignVariantMetadata,
} from "../../domains/frontend/design/index.ts";
import type { VerificationFinding } from "../../runtime/types.ts";
import { McpToolError, mcpToolEffects, type JsonObject, type McpToolDefinition, type McpToolHandler } from "./types.ts";
import { jsonToolResult, requireString } from "./utils.ts";

const objectSchema = { type: "object" } as const;

export const visualToolDefinitions: McpToolDefinition[] = [
  {
    ...mcpToolEffects.commandAndArtifactWrite,
    name: "capture_ui_evidence",
    title: "Capture UI evidence",
    description: "Create and execute the canonical browser evidence matrix.",
    inputSchema: { type: "object", required: ["brief", "policy", "evidenceId", "variantId", "sourceIdentity", "baseUrl", "commandTemplate", "outputDir", "confirm"], properties: { brief: objectSchema, policy: objectSchema, evidenceId: { type: "string" }, variantId: { type: "string" }, sourceIdentity: { type: "string" }, baseUrl: { type: "string" }, commandTemplate: { type: "string" }, outputDir: { type: "string" }, confirm: { type: "boolean", description: "Must be true after the host reviews commandTemplate, baseUrl, and outputDir." }, projectRoot: { type: "string" }, route: { type: "string" }, timeoutPerCaptureMs: { type: "number" } } },
  },
  {
    ...mcpToolEffects.readOnly,
    name: "compare_design_variants",
    title: "Compare design variants",
    description: "Prepare an independent critic exchange or validate its returned report.",
    inputSchema: { type: "object", required: ["policyId", "generatorActorId", "criticActorId", "candidates"], properties: { policyId: { type: "string" }, generatorActorId: { type: "string" }, criticActorId: { type: "string" }, candidates: { type: "array", minItems: 2, maxItems: 3 }, criticReport: objectSchema } },
  },
  {
    ...mcpToolEffects.readOnly,
    name: "verify_visual_result",
    title: "Verify visual result",
    description: "Run the canonical strict final visual verifier.",
    inputSchema: { type: "object", required: ["workflowId", "policy", "visualRun", "variant", "brief", "direction", "initialEvidence", "recheckEvidence", "criticReport", "boundedRepairFindings"], properties: { workflowId: { type: "string" }, policy: objectSchema, visualRun: objectSchema, variant: objectSchema, brief: objectSchema, direction: objectSchema, initialEvidence: objectSchema, recheckEvidence: objectSchema, criticReport: objectSchema, boundedRepairRequest: objectSchema, boundedRepairFindings: { type: "array" } } },
  },
];

const isOutside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
};

const realpathFromExistingAncestor = async (value: string) => {
  let ancestor = value;
  const missingTail: string[] = [];
  while (true) {
    try {
      await lstat(ancestor);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missingTail.unshift(path.basename(ancestor));
      ancestor = parent;
      continue;
    }
    return path.resolve(await realpath(ancestor), ...missingTail);
  }
};

const resolveProjectOutputDir = async (projectRoot: string, value: unknown) => {
  const outputDir = path.resolve(projectRoot, requireString(value, "outputDir"));
  if (isOutside(projectRoot, outputDir)) {
    throw new McpToolError(
      "invalid-arguments",
      "capture_ui_evidence outputDir must stay within projectRoot.",
      { projectRoot, outputDir },
    );
  }
  const [canonicalProjectRoot, canonicalOutputDir] = await Promise.all([
    realpath(projectRoot),
    realpathFromExistingAncestor(outputDir),
  ]);
  if (isOutside(canonicalProjectRoot, canonicalOutputDir)) {
    throw new McpToolError(
      "invalid-arguments",
      "capture_ui_evidence outputDir must stay within projectRoot.",
      { projectRoot, outputDir },
    );
  }
  return outputDir;
};

const capture: McpToolHandler = async (args) => {
  if (args.confirm !== true) {
    throw new McpToolError(
      "confirmation-required",
      "capture_ui_evidence requires confirm: true after reviewing commandTemplate, baseUrl, and outputDir.",
    );
  }
  const projectRoot = path.resolve(typeof args.projectRoot === "string" ? args.projectRoot : ".");
  const outputDir = await resolveProjectOutputDir(projectRoot, args.outputDir);
  const plan = createUiEvidenceCapturePlan({
    evidenceId: requireString(args.evidenceId, "evidenceId"),
    brief: args.brief as DesignBrief,
    policy: args.policy as DesignExecutionPolicy,
    variantId: requireString(args.variantId, "variantId"),
    sourceIdentity: requireString(args.sourceIdentity, "sourceIdentity"),
    baseUrl: requireString(args.baseUrl, "baseUrl"),
    route: typeof args.route === "string" ? args.route : undefined,
    outputDir,
  });
  const bundle = await executeUiEvidenceCapture({
    plan,
    commandTemplate: requireString(args.commandTemplate, "commandTemplate"),
    projectRoot,
    timeoutPerCaptureMs: typeof args.timeoutPerCaptureMs === "number" ? args.timeoutPerCaptureMs : undefined,
  });
  return jsonToolResult(bundle);
};

const compare: McpToolHandler = async (args) => {
  if (!Array.isArray(args.candidates) || args.candidates.length < 2 || args.candidates.length > 3) throw new Error("compare_design_variants requires two or three candidates.");
  const criticInput = createVisualCriticInput({
    policyId: requireString(args.policyId, "policyId"),
    generatorActorId: requireString(args.generatorActorId, "generatorActorId"),
    criticActorId: requireString(args.criticActorId, "criticActorId"),
    candidates: args.candidates as VisualCriticInput["candidates"],
  });
  if (args.criticReport === undefined) return jsonToolResult({ status: "critic-required", criticInput });
  return jsonToolResult({ status: "compared", ...compareDesignVariants(criticInput, args.criticReport) });
};

const verify: McpToolHandler = async (args) => {
  const result = verifyVisualResult({
    workflowId: requireString(args.workflowId, "workflowId"),
    policy: args.policy as DesignExecutionPolicy,
    visualRun: args.visualRun as VisualRun,
    variant: args.variant as DesignVariantMetadata,
    brief: args.brief as DesignBrief,
    direction: args.direction as DesignDirection,
    initialEvidence: args.initialEvidence as UiEvidenceBundle,
    recheckEvidence: args.recheckEvidence as UiEvidenceBundle,
    criticReport: args.criticReport as VisualCriticReport,
    boundedRepairRequest: args.boundedRepairRequest as BoundedRepairRequest | undefined,
    boundedRepairFindings: (args.boundedRepairFindings ?? []) as VerificationFinding[],
  });
  return jsonToolResult(result.report);
};

export const visualToolHandlers: Record<string, McpToolHandler> = {
  capture_ui_evidence: capture,
  compare_design_variants: compare,
  verify_visual_result: verify,
};

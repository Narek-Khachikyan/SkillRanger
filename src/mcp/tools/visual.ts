import path from "node:path";
import { readFileSync } from "node:fs";
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
import { McpToolError, mcpToolEffects, type JsonObject, type McpToolDefinition, type McpToolErrorCode, type McpToolHandler } from "./types.ts";
import { jsonToolResult, requireString } from "./utils.ts";

const objectSchema = { type: "object" } as const;
// Canonical VisualCriticReport v1, loaded from the shipped skill package so the published contract
// cannot drift from the one the validator enforces. This is NOT the strict CriticReportV2 used for
// `critic-report` evidence inside a strict run.
// Local MCP pre-validation intentionally implements a JSON Schema subset without conditional
// if/then, so this schema's outcome/selectedVariantId branches are inert here even though its
// nested `not` is supported; the handler revalidates that conditional invariant to preserve
// structured domain findings (critic-selection-invalid) over a generic invalid-arguments error.
const visualCriticReportSchema = JSON.parse(readFileSync(
  new URL("../../../registry/skills/frontend.visual-critic/output.schema.json", import.meta.url),
  "utf8",
)) as JsonObject;
const stateListSchema = { type: "array", items: { type: "string" } } as const;
// An empty item schema left agents guessing field names from the rejection text and retrying
// forever, so the critic candidate contract is published rather than only enforced.
const criticCandidateSchema = {
  type: "object",
  required: ["variantId", "directionPath", "evidenceId", "screenshotPaths"],
  properties: {
    variantId: { type: "string", minLength: 1 },
    directionPath: { type: "string", minLength: 1 },
    evidenceId: { type: "string", minLength: 1 },
    screenshotPaths: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
  },
} as const;
// The capture plan spreads both required-state lists, so omitting either one used to surface as an
// unexpected internal error. Publishing them lets the schema reject the call before dispatch.
const capturePolicySchema = { type: "object", required: ["requiredStates"], properties: { requiredStates: stateListSchema } } as const;
const captureBriefSchema = {
  type: "object",
  required: ["surface"],
  properties: { surface: { type: "object", required: ["requiredStates"], properties: { requiredStates: stateListSchema } } },
} as const;
// stateSynchronization is mandatory at capture, so a bundle reaching the final verifier without it
// was edited after capture. The verifier rejects it either way; publishing the requirement here
// names the missing field instead of returning a generic matrix finding. requiredViewports and
// requiredStates are dereferenced by the matrix check before any finding can report their absence.
const verifiedEvidenceSchema = {
  type: "object",
  required: ["captures", "requiredViewports", "requiredStates"],
  properties: {
    captures: {
      type: "array",
      items: { type: "object", required: ["stateSynchronization"] },
    },
    requiredViewports: { type: "array" },
    requiredStates: { type: "array" },
  },
} as const;
// The final verifier dereferences these containers before its lifecycle guards can turn their
// absence into findings, so an input that omitted them surfaced as a JSON-RPC internal error a
// host cannot branch on. Publishing them rejects the call as invalid-arguments before dispatch.
const verifyPolicySchema = {
  type: "object",
  required: ["requiredViewports", "requiredStates"],
  properties: { requiredViewports: { type: "array" }, requiredStates: { type: "array" } },
} as const;
const verifyVisualRunSchema = {
  type: "object",
  required: ["history", "variantIds", "artifacts"],
  properties: { history: { type: "array" }, variantIds: { type: "array" }, artifacts: { type: "object" } },
} as const;

export const visualToolDefinitions: McpToolDefinition[] = [
  {
    ...mcpToolEffects.commandAndArtifactWrite,
    name: "capture_ui_evidence",
    title: "Capture UI evidence",
    description: "Create and execute the canonical browser evidence matrix.",
    inputSchema: { type: "object", required: ["brief", "policy", "evidenceId", "variantId", "sourceIdentity", "baseUrl", "commandTemplate", "outputDir", "confirm"], properties: { brief: captureBriefSchema, policy: capturePolicySchema, evidenceId: { type: "string" }, variantId: { type: "string" }, sourceIdentity: { type: "string" }, baseUrl: { type: "string" }, commandTemplate: { type: "string" }, outputDir: { type: "string" }, confirm: { type: "boolean", description: "Must be true after the host reviews commandTemplate, baseUrl, and outputDir." }, projectRoot: { type: "string" }, route: { type: "string" }, timeoutPerCaptureMs: { type: "number" } } },
  },
  {
    ...mcpToolEffects.readOnly,
    name: "compare_design_variants",
    title: "Compare design variants",
    description: "Prepare an independent critic exchange or validate its returned report. criticReport must be a VisualCriticReport v1 (schemaVersion 1.0); the strict-run critic-report evidence contract is the different CriticReportV2 (schemaVersion 2.0).",
    inputSchema: { type: "object", required: ["policyId", "generatorActorId", "criticActorId", "candidates"], properties: { policyId: { type: "string" }, generatorActorId: { type: "string" }, criticActorId: { type: "string" }, candidates: { type: "array", minItems: 2, maxItems: 3, items: criticCandidateSchema }, criticReport: visualCriticReportSchema } },
  },
  {
    ...mcpToolEffects.readOnly,
    name: "verify_visual_result",
    title: "Verify visual result",
    description: "Run the canonical strict final visual verifier. criticReport must be a VisualCriticReport v1 (schemaVersion 1.0), not the CriticReportV2 evidence shape.",
    inputSchema: { type: "object", required: ["workflowId", "policy", "visualRun", "variant", "brief", "direction", "initialEvidence", "recheckEvidence", "criticReport", "boundedRepairFindings"], properties: { workflowId: { type: "string" }, policy: verifyPolicySchema, visualRun: verifyVisualRunSchema, variant: objectSchema, brief: objectSchema, direction: objectSchema, initialEvidence: verifiedEvidenceSchema, recheckEvidence: verifiedEvidenceSchema, criticReport: visualCriticReportSchema, boundedRepairRequest: objectSchema, boundedRepairFindings: { type: "array", items: objectSchema } } },
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
  return { outputDir, canonicalProjectRoot };
};

const assertProjectArtifactPath = async (
  projectRoot: string,
  canonicalProjectRoot: string,
  artifactPath: string,
) => {
  const resolvedArtifactPath = path.resolve(artifactPath);
  let canonicalArtifactPath: string;
  try {
    canonicalArtifactPath = await realpathFromExistingAncestor(resolvedArtifactPath);
  } catch {
    throw new McpToolError(
      "invalid-arguments",
      "capture_ui_evidence artifact paths must have a valid existing component chain within projectRoot.",
      { projectRoot, artifactPath: resolvedArtifactPath },
    );
  }
  if (
    isOutside(projectRoot, resolvedArtifactPath)
    || isOutside(canonicalProjectRoot, canonicalArtifactPath)
  ) {
    throw new McpToolError(
      "invalid-arguments",
      "capture_ui_evidence artifact paths must stay within projectRoot.",
      { projectRoot, artifactPath: resolvedArtifactPath },
    );
  }
};

// Domain contract guards throw a plain Error; a JS fault throws a TypeError, RangeError, or
// ReferenceError. Only the former is an expected tool-level failure, so only it earns a stable
// code. Anything else stays an unexpected internal error.
const asToolFailure = async <T>(code: McpToolErrorCode, run: () => T | Promise<T>): Promise<T> => {
  try { return await run(); }
  catch (error) {
    if (error instanceof McpToolError) throw error;
    if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError) throw error;
    throw new McpToolError(code, error instanceof Error ? error.message : String(error));
  }
};

const capture: McpToolHandler = async (args) => {
  if (args.confirm !== true) {
    throw new McpToolError(
      "confirmation-required",
      "capture_ui_evidence requires confirm: true after reviewing commandTemplate, baseUrl, and outputDir.",
    );
  }
  const projectRoot = path.resolve(typeof args.projectRoot === "string" ? args.projectRoot : ".");
  const { outputDir, canonicalProjectRoot } = await resolveProjectOutputDir(projectRoot, args.outputDir);
  const plan = await asToolFailure("invalid-arguments", () => createUiEvidenceCapturePlan({
    evidenceId: requireString(args.evidenceId, "evidenceId"),
    brief: args.brief as DesignBrief,
    policy: args.policy as DesignExecutionPolicy,
    variantId: requireString(args.variantId, "variantId"),
    sourceIdentity: requireString(args.sourceIdentity, "sourceIdentity"),
    baseUrl: requireString(args.baseUrl, "baseUrl"),
    route: typeof args.route === "string" ? args.route : undefined,
    outputDir,
  }));
  const bundle = await asToolFailure("capture-failed", () => executeUiEvidenceCapture({
    plan,
    commandTemplate: requireString(args.commandTemplate, "commandTemplate"),
    projectRoot,
    timeoutPerCaptureMs: typeof args.timeoutPerCaptureMs === "number" ? args.timeoutPerCaptureMs : undefined,
    assertArtifactPath: (artifactPath) => assertProjectArtifactPath(
      projectRoot,
      canonicalProjectRoot,
      artifactPath,
    ),
  }));
  return jsonToolResult(bundle);
};

const compare: McpToolHandler = async (args) => {
  if (!Array.isArray(args.candidates) || args.candidates.length < 2 || args.candidates.length > 3) {
    throw new McpToolError("invalid-arguments", "compare_design_variants requires two or three candidates.", { argument: "candidates" });
  }
  const criticInput = await asToolFailure("invalid-arguments", () => createVisualCriticInput({
    policyId: requireString(args.policyId, "policyId"),
    generatorActorId: requireString(args.generatorActorId, "generatorActorId"),
    criticActorId: requireString(args.criticActorId, "criticActorId"),
    candidates: args.candidates as VisualCriticInput["candidates"],
  }));
  if (args.criticReport === undefined) return jsonToolResult({ status: "critic-required", criticInput });
  return jsonToolResult({ status: "compared", ...await asToolFailure("invalid-arguments", () => compareDesignVariants(criticInput, args.criticReport)) });
};

const verify: McpToolHandler = async (args) => {
  // Unlike the asToolFailure convention, a TypeError here is an input fault, not a JS fault: every
  // argument is an untrusted caller-supplied snapshot, and the pure verifier reports shape problems
  // as findings rather than thrown guards, so a dereference crash can only come from a shape the
  // published schema subset cannot express. It must stay a branchable tool error.
  try {
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
  } catch (error) {
    if (error instanceof TypeError) {
      throw new McpToolError("invalid-arguments", `verify_visual_result input has an invalid shape: ${error.message}`);
    }
    throw error;
  }
};

export const visualToolHandlers: Record<string, McpToolHandler> = {
  capture_ui_evidence: capture,
  compare_design_variants: compare,
  verify_visual_result: verify,
};

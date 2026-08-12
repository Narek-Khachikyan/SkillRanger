import path from "node:path";
import "../../domains/bundled.ts";
import { getDomainPack, inspectDomainPack, listDomainPacks } from "../../domains/registry.ts";
import {
  compileDesignMarkdownWithExamples,
  createDesignBriefScaffold,
  loadFrontendRecipes,
  recommendFrontendRecipe,
  validateDesignBrief,
  validateDesignDirection,
  validateDesignResult,
  type BrowserObservation,
  type DesignBrief,
  type DesignDirection,
} from "../../domains/frontend/design/index.ts";
import { loadFrontendEvalSuite } from "../../evals/frontend.ts";
import {
  BASELINE_KINDS,
  generateRunPlan,
  type BaselineKind,
} from "../../evals/runner.ts";
import { assertValidVerificationReport } from "../../runtime/skill-run/validation.ts";
import { createRepairRequest } from "../../runtime/verification.ts";
import type { VerificationReport } from "../../runtime/types.ts";
import { scanProject } from "../../scanner/index.ts";
import { McpToolError, mcpToolEffects, type JsonObject, type McpToolDefinition, type McpToolHandler } from "./types.ts";
import { jsonToolResult, projectRootProperty, requireString, resolveProjectRoot } from "./utils.ts";

const evidenceListSchema = {
  type: "array",
  items: {
    type: "object",
    required: ["statement"],
    properties: { statement: { type: "string", minLength: 1 }, source: { type: "string" } },
    additionalProperties: false,
  },
} as const;

// Ranking and every gate dereference product and surface directly, so an unpublished
// `{ type: "object" }` turned each missing field into a runtime failure the host could not anticipate.
// This mirrors domains/frontend/schemas/design-brief.schema.json.
const designBriefSchema = {
  type: "object",
  description: "Canonical frontend design brief. Pass the brief field of create_frontend_design_brief's result unchanged, or build it to this contract.",
  required: ["schemaVersion", "product", "surface", "direction", "evidence"],
  properties: {
    schemaVersion: { const: "1.0" },
    product: {
      type: "object",
      required: ["domain", "primaryUserOrActor", "primaryTask", "contentTypes", "usageFrequency", "stakes"],
      properties: {
        domain: { type: "string", minLength: 1 },
        primaryUserOrActor: { type: "string", minLength: 1 },
        primaryTask: { type: "string", minLength: 1 },
        contentTypes: { type: "array", items: { type: "string" } },
        usageFrequency: { enum: ["rare", "occasional", "frequent", "continuous", "unknown"] },
        stakes: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
    surface: {
      type: "object",
      required: ["type", "primaryAction", "supportedViewports", "requiredStates"],
      properties: {
        type: { type: "string", minLength: 1 },
        primaryAction: { type: "string", minLength: 1 },
        supportedViewports: { type: "array", minItems: 2, items: { type: "integer", minimum: 320 } },
        requiredStates: {
          type: "array",
          minItems: 1,
          description: "States listed here require browser evidence at every supported viewport.",
          items: { type: "string", minLength: 1 },
        },
      },
      additionalProperties: false,
    },
    direction: {
      type: "object",
      required: ["requestedTone", "antiGoals", "existingDirection"],
      properties: {
        requestedTone: { type: "array", items: { type: "string" } },
        antiGoals: { type: "array", items: { type: "string" } },
        existingDirection: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    evidence: {
      type: "object",
      required: ["observed", "inferred", "assumed", "unknown"],
      properties: {
        observed: evidenceListSchema,
        inferred: evidenceListSchema,
        assumed: evidenceListSchema,
        unknown: evidenceListSchema,
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

// browserReady is derived from exactly two entries, so the recognized values have to be visible: a
// caller that guessed a different string silently skipped every browser gate. Named in the description
// rather than enumerated, because inputSchema is enforced before dispatch and callers legitimately pass
// a whole capability inventory; an enum would reject a superset that used to work.
const capabilitiesSchema = {
  type: "array",
  description: "Host capabilities available for verification. Additional entries are ignored. Recognized: browser, screenshots — both are required before any browser gate runs.",
  items: { type: "string" },
} as const;

export const domainToolDefinitions: McpToolDefinition[] = [
  {
    ...mcpToolEffects.readOnly,
    name: "list_domains",
    title: "List Domains",
    description: "List registered SkillRanger domain packs and their public capabilities.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    ...mcpToolEffects.readOnly,
    name: "inspect_domain",
    title: "Inspect Domain",
    description: "Inspect a registered domain pack, ownership rules, and artifacts.",
    inputSchema: {
      type: "object",
      properties: { domainId: { type: "string" } },
      required: ["domainId"],
      additionalProperties: false,
    },
  },
  {
    ...mcpToolEffects.readOnly,
    name: "create_frontend_design_brief",
    title: "Create Frontend Design Brief",
    description: "Create a structured design brief scaffold from deterministic project evidence. Unknown product facts remain explicit.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: projectRootProperty,
        domain: { type: "string" },
        primaryUserOrActor: { type: "string" },
        primaryTask: { type: "string" },
        surfaceType: { type: "string" },
        primaryAction: { type: "string" },
        requiredStates: {
          type: "array",
          minItems: 1,
          description: "Optional for compatibility; omission keeps the legacy loading/empty/error/success matrix. Explicit states require evidence at every supported viewport.",
          items: { type: "string", minLength: 1 },
        },
      },
      additionalProperties: false,
    },
  },
  {
    ...mcpToolEffects.readOnly,
    name: "recommend_frontend_recipe",
    title: "Recommend Frontend Recipe",
    description: "Rank approved frontend product recipes for a structured design brief. A brief that fails a hard gate returns ok:false with the findings that name the missing fields and no recommendations.",
    inputSchema: {
      type: "object",
      properties: { brief: designBriefSchema },
      required: ["brief"],
      additionalProperties: false,
    },
  },
  {
    ...mcpToolEffects.readOnly,
    name: "validate_frontend_result",
    title: "Validate Frontend Result",
    description: "Apply stateless frontend gates to caller-supplied design artifacts and self-reported browser observations. It reads no project files and never certifies completion: an outcome other than verified means the work is not verified. Strict frontend completion must advance the persisted strict-v2 run through begin_skill_step, add_skill_evidence, complete_skill_step, verify_skill, finalize_skill_run, and inspect_skill_run; use capture_ui_evidence, compare_design_variants, and verify_visual_result when required by the selected frontend contracts.",
    inputSchema: {
      type: "object",
      properties: {
        brief: designBriefSchema,
        direction: { type: "object" },
        observations: { type: "array", items: { type: "object" } },
        capabilities: capabilitiesSchema,
        iteration: { type: "integer", minimum: 0 },
        referenceDna: {
          type: "object",
          description: "Optional DNA-extraction artifact to validate against the reference-dna contract (attribute-vs-trade-dress boundary, evidence ladder, pixel-clone refusal).",
        },
      },
      required: ["brief", "direction"],
      additionalProperties: false,
    },
  },
  {
    ...mcpToolEffects.readOnly,
    name: "compile_frontend_design_spec",
    title: "Compile Frontend Design Spec",
    description: "Compile canonical frontend design artifacts into deterministic human-readable Markdown without writing files.",
    inputSchema: {
      type: "object",
      properties: {
        brief: designBriefSchema,
        direction: { type: "object" },
        report: { type: "object" },
      },
      required: ["brief", "direction"],
      additionalProperties: false,
    },
  },
  {
    ...mcpToolEffects.readOnly,
    name: "verify_frontend_result",
    title: "Validate Frontend Hard Gates (Stateless, Not Strict)",
    description: "Apply deterministic frontend hard gates to caller-supplied design artifacts and observations without creating, advancing, or certifying a persisted strict run. Never report this result as strict SkillRanger completion; strict frontend completion must advance the persisted strict-v2 run through begin_skill_step, add_skill_evidence, complete_skill_step, verify_skill, finalize_skill_run, and inspect_skill_run; use real capture_ui_evidence, compare_design_variants, and verify_visual_result when required by the selected frontend contracts.",
    inputSchema: {
      type: "object",
      properties: {
        brief: designBriefSchema,
        direction: { type: "object" },
        observations: { type: "array", items: { type: "object" } },
        capabilities: capabilitiesSchema,
        iteration: { type: "integer", minimum: 0 },
        referenceDna: {
          type: "object",
          description: "Optional DNA-extraction artifact to validate against the reference-dna contract (attribute-vs-trade-dress boundary, evidence ladder, pixel-clone refusal).",
        },
      },
      required: ["brief", "direction"],
      additionalProperties: false,
    },
  },
  {
    ...mcpToolEffects.readOnly,
    name: "repair_frontend_result",
    title: "Plan Frontend Repair",
    description: "Create a bounded repair request from normalized findings. This tool does not edit project files.",
    inputSchema: {
      type: "object",
      properties: {
        report: { type: "object" },
        maxIterations: { type: "integer", minimum: 1, maximum: 5 },
      },
      required: ["report"],
      additionalProperties: false,
    },
  },
  {
    ...mcpToolEffects.readOnly,
    name: "run_domain_eval",
    title: "Plan Domain Eval",
    description: "Build a deterministic repeated A/B/C domain eval plan. This read-only tool does not execute model commands.",
    inputSchema: {
      type: "object",
      properties: {
        domainId: { type: "string", enum: ["frontend"] },
        suitePath: { type: "string" },
        skillSlice: { type: "string" },
        repetitions: { type: "integer", minimum: 1 },
        baselines: {
          type: "array",
          items: { enum: [...BASELINE_KINDS] },
        },
      },
      required: ["domainId"],
      additionalProperties: false,
    },
  },
];

const listDomains: McpToolHandler = async () =>
  jsonToolResult({ domains: listDomainPacks().map(inspectDomainPack) });

const inspectDomain: McpToolHandler = async (args) => {
  const domainId = requireString(args.domainId, "domainId");
  const domain = getDomainPack(domainId);
  if (!domain) throw new McpToolError("invalid-arguments", `Unknown domain: ${domainId}`, { domainId });
  return jsonToolResult(inspectDomainPack(domain));
};

const optionalText = (value: unknown) => typeof value === "string" && value.trim() ? value : undefined;

const createFrontendDesignBrief: McpToolHandler = async (args) => {
  const projectRoot = resolveProjectRoot(args.projectRoot);
  const fingerprint = await scanProject(projectRoot);
  const brief = createDesignBriefScaffold(fingerprint, {
    domain: optionalText(args.domain),
    primaryUserOrActor: optionalText(args.primaryUserOrActor),
    primaryTask: optionalText(args.primaryTask),
    surfaceType: optionalText(args.surfaceType),
    primaryAction: optionalText(args.primaryAction),
    requiredStates: Array.isArray(args.requiredStates) ? args.requiredStates as string[] : undefined,
  });
  return jsonToolResult({ projectRoot, brief, findings: validateDesignBrief(brief) });
};

// Ranking reads brief.product and brief.surface directly, so a brief that fails a hard gate must
// return the findings that name the defect instead of throwing on the same fields one line later.
const recommendFrontendRecipeTool: McpToolHandler = async (args) => {
  const brief = args.brief as DesignBrief;
  const findings = validateDesignBrief(brief);
  if (findings.some((finding) => finding.gate === "hard")) {
    return jsonToolResult({ ok: false, findings, recommendations: [] });
  }
  return jsonToolResult({
    ok: true,
    findings,
    recommendations: recommendFrontendRecipe(brief, await loadFrontendRecipes()),
  });
};

const frontendResultReport = (args: JsonObject) => validateDesignResult({
  workflowId: "frontend.design-generation",
  brief: args.brief as DesignBrief,
  direction: args.direction as DesignDirection,
  observations: Array.isArray(args.observations) ? args.observations as BrowserObservation[] : [],
  capabilities: Array.isArray(args.capabilities) ? args.capabilities as string[] : [],
  iteration: typeof args.iteration === "number" ? args.iteration : 0,
  ...(args.referenceDna === undefined ? {} : { referenceDna: args.referenceDna }),
}).report;

// Keep the canonical report unchanged in structuredContent and content[0], so callers can pass it
// directly to report-consuming tools. The warning travels as a second text block.
const nonCertifyingNotice = [
  "NON-CERTIFYING STATELESS RESULT:",
  "This tool only validates caller-supplied frontend artifacts and observations.",
  "It does not read project files, and does not prove browser capture, an independent critic exchange, or a persisted strict SkillRanger run.",
  "Do not report strict verification as passed from this result.",
  "For strict frontend completion advance the persisted strict-v2 run through begin_skill_step, add_skill_evidence, complete_skill_step, verify_skill, finalize_skill_run, and inspect_skill_run; use capture_ui_evidence, compare_design_variants, and verify_visual_result when required by the selected frontend contracts. Only a persisted verified run with passed verification status certifies completion.",
].join(" ");

const statelessFrontendResult: McpToolHandler = async (args) => {
  const result = jsonToolResult(frontendResultReport(args));
  return {
    ...result,
    content: [...result.content, { type: "text", text: nonCertifyingNotice }],
  };
};

const validateFrontendResult: McpToolHandler = statelessFrontendResult;

const verifyFrontendResult: McpToolHandler = statelessFrontendResult;

const compileFrontendDesignSpec: McpToolHandler = async (args) => {
  const brief = args.brief as DesignBrief;
  const direction = args.direction as DesignDirection;
  const briefFindings = validateDesignBrief(brief);
  const findings = [
    ...briefFindings,
    ...validateDesignDirection(brief, direction),
  ];
  if (findings.some((finding) => finding.gate === "hard")) {
    return jsonToolResult({ ok: false, findings });
  }
  // The optional report is rendered by dereferencing its gates and findings, so when a caller supplies
  // one it has to satisfy the same contract the repair planner requires.
  const markdown = await compileDesignMarkdownWithExamples(
    brief,
    direction,
    args.report === undefined ? undefined : requireVerificationReport(args.report),
  );
  return jsonToolResult({
    ok: true,
    markdown,
    bytes: Buffer.byteLength(markdown),
  });
};

const requireVerificationReport = (value: unknown): VerificationReport => {
  try {
    assertValidVerificationReport(value);
  } catch {
    throw new McpToolError(
      "invalid-arguments",
      "report must match the canonical verification report contract.",
      { argument: "report" },
    );
  }
  return value;
};

const repairFrontendResult: McpToolHandler = async (args) => {
  const maxIterations = typeof args.maxIterations === "number" ? args.maxIterations : 3;
  return jsonToolResult(createRepairRequest(requireVerificationReport(args.report), maxIterations));
};

const runDomainEval: McpToolHandler = async (args) => {
  const domainId = requireString(args.domainId, "domainId");
  if (domainId !== "frontend") {
    throw new McpToolError("invalid-arguments", `No eval adapter is registered for domain: ${domainId}`, { domainId });
  }
  const suitePath = optionalText(args.suitePath);
  const suite = await loadFrontendEvalSuite(suitePath ? path.resolve(suitePath) : undefined);
  const baselines = Array.isArray(args.baselines)
    ? args.baselines as BaselineKind[]
    : [...BASELINE_KINDS];
  if (baselines.some((baseline) => !BASELINE_KINDS.includes(baseline))) {
    throw new McpToolError("invalid-arguments", "baselines contains an unsupported value", { argument: "baselines" });
  }
  const repetitions = typeof args.repetitions === "number" ? args.repetitions : 3;
  const skillSlice = optionalText(args.skillSlice);
  const plan = generateRunPlan(suite, { baselines, repetitions, skillSlice });
  return jsonToolResult({
    domainId,
    execution: "host-required",
    plan,
  });
};

export const domainToolHandlers: Record<string, McpToolHandler> = {
  list_domains: listDomains,
  inspect_domain: inspectDomain,
  create_frontend_design_brief: createFrontendDesignBrief,
  recommend_frontend_recipe: recommendFrontendRecipeTool,
  validate_frontend_result: validateFrontendResult,
  compile_frontend_design_spec: compileFrontendDesignSpec,
  verify_frontend_result: verifyFrontendResult,
  repair_frontend_result: repairFrontendResult,
  run_domain_eval: runDomainEval,
};

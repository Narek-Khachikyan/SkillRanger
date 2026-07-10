import path from "node:path";
import "../../domains/bundled.ts";
import { getDomainPack, inspectDomainPack, listDomainPacks } from "../../domains/registry.ts";
import {
  compileDesignMarkdown,
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
import { createRepairRequest } from "../../runtime/verification.ts";
import type { VerificationReport } from "../../runtime/types.ts";
import { scanProject } from "../../scanner/index.ts";
import { McpToolError, type McpToolDefinition, type McpToolHandler } from "./types.ts";
import { asString, jsonToolResult, projectRootProperty, requireString } from "./utils.ts";

export const domainToolDefinitions: McpToolDefinition[] = [
  {
    name: "list_domains",
    title: "List Domains",
    description: "List registered SkillRanger domain packs and their public capabilities.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
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
      },
      additionalProperties: false,
    },
  },
  {
    name: "recommend_frontend_recipe",
    title: "Recommend Frontend Recipe",
    description: "Rank approved frontend product recipes for a structured design brief.",
    inputSchema: {
      type: "object",
      properties: { brief: { type: "object" } },
      required: ["brief"],
      additionalProperties: false,
    },
  },
  {
    name: "validate_frontend_result",
    title: "Validate Frontend Result",
    description: "Validate design artifacts and optional browser observations, returning normalized findings and a verification outcome.",
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "object" },
        direction: { type: "object" },
        observations: { type: "array", items: { type: "object" } },
        capabilities: { type: "array", items: { type: "string" } },
        iteration: { type: "integer", minimum: 0 },
      },
      required: ["brief", "direction"],
      additionalProperties: false,
    },
  },
  {
    name: "compile_frontend_design_spec",
    title: "Compile Frontend Design Spec",
    description: "Compile canonical frontend design artifacts into deterministic human-readable Markdown without writing files.",
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "object" },
        direction: { type: "object" },
        report: { type: "object" },
      },
      required: ["brief", "direction"],
      additionalProperties: false,
    },
  },
  {
    name: "verify_frontend_result",
    title: "Verify Frontend Result",
    description: "Apply frontend hard gates to canonical design artifacts and browser observations. Alias of deterministic frontend validation.",
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "object" },
        direction: { type: "object" },
        observations: { type: "array", items: { type: "object" } },
        capabilities: { type: "array", items: { type: "string" } },
        iteration: { type: "integer", minimum: 0 },
      },
      required: ["brief", "direction"],
      additionalProperties: false,
    },
  },
  {
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
  const projectRoot = path.resolve(asString(args.projectRoot, "."));
  const fingerprint = await scanProject(projectRoot);
  const brief = createDesignBriefScaffold(fingerprint, {
    domain: optionalText(args.domain),
    primaryUserOrActor: optionalText(args.primaryUserOrActor),
    primaryTask: optionalText(args.primaryTask),
    surfaceType: optionalText(args.surfaceType),
    primaryAction: optionalText(args.primaryAction),
  });
  return jsonToolResult({ projectRoot, brief, findings: validateDesignBrief(brief) });
};

const recommendFrontendRecipeTool: McpToolHandler = async (args) => {
  const brief = args.brief as DesignBrief;
  const findings = validateDesignBrief(brief);
  return jsonToolResult({
    ok: !findings.some((finding) => finding.gate === "hard"),
    findings,
    recommendations: recommendFrontendRecipe(brief, await loadFrontendRecipes()),
  });
};

const validateFrontendResult: McpToolHandler = async (args) =>
  jsonToolResult(
    validateDesignResult({
      workflowId: "frontend.design-generation",
      brief: args.brief as DesignBrief,
      direction: args.direction as DesignDirection,
      observations: Array.isArray(args.observations) ? args.observations as BrowserObservation[] : [],
      capabilities: Array.isArray(args.capabilities) ? args.capabilities as string[] : [],
      iteration: typeof args.iteration === "number" ? args.iteration : 0,
    }).report,
  );

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
  const markdown = compileDesignMarkdown(
    brief,
    direction,
    args.report as VerificationReport | undefined,
  );
  return jsonToolResult({
    ok: true,
    markdown,
    bytes: Buffer.byteLength(markdown),
  });
};

const repairFrontendResult: McpToolHandler = async (args) => {
  const maxIterations = typeof args.maxIterations === "number" ? args.maxIterations : 3;
  return jsonToolResult(createRepairRequest(args.report as VerificationReport, maxIterations));
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
  verify_frontend_result: validateFrontendResult,
  repair_frontend_result: repairFrontendResult,
  run_domain_eval: runDomainEval,
};

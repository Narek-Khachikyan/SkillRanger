import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isCoreDomainSkill } from "../../router/metadata.ts";
import { createRouterRuntimeBridge, prepareTask, RouterPrepareError, routingProposalLimits } from "../../router/index.ts";
import type { PrepareTaskCoreInput, ReadRunSkillFileInput } from "../../router/types.ts";
import { RouterReaderError } from "../../router/reader.ts";
import { RouterStore, RouterStoreError } from "../../router/store.ts";
import { maxSkillInputEntries, SkillInputsError, validateSkillInputs } from "../../router/skill-inputs.ts";
import { SkillRunStore } from "../../runtime/skill-run/index.ts";
import { reduceSkillRun } from "../../runtime/skill-run/reducer.ts";
import { StrictSkillRunStore, readNextStrictChunk } from "../../runtime/strict/index.ts";
import { McpToolError, mcpToolEffects, type JsonObject, type McpToolDefinition, type McpToolHandler } from "./types.ts";
import { jsonToolResult, requireString, requireStringArray } from "./utils.ts";
import { routerContext } from "../router-context.ts";
import {
  catalogDiscoveryGuidance,
  catalogRefreshGuidance,
  completeRoleAwareNominationGuidance,
  explicitTriggerGuidance,
  fallbackRecallGuidance,
  legacyCatalogGuidance,
  mandatoryReadGuidance,
  proposalIntegrityGuidance,
  setupBoundaryGuidance,
} from "../../host-guidance.ts";

const routerResultSchema = JSON.parse(readFileSync(new URL("../../../schemas/router-tool-result.schema.json", import.meta.url), "utf8")) as JsonObject;

const routerToolOutputSchema = (schemaVersion: "router-result/1.1" | "router-read-result/1.0", propertiesForTool: string[]) => {
  const copy = structuredClone(routerResultSchema) as JsonObject;
  // MCP SDK AJV caches validators by $id. Both tools clone the same source schema, so a shared
  // $id makes listTools bind read_run_skill_file to prepare_task's validator and reject reads.
  delete (copy as Record<string, unknown>)["$id"];
  const properties = copy.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    copy.properties = Object.fromEntries(Object.entries(properties as Record<string, unknown>).filter(([key]) => propertiesForTool.includes(key)));
  }
  const oneOf = copy.oneOf;
  if (Array.isArray(oneOf)) {
    copy.oneOf = oneOf.filter((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const properties = (entry as Record<string, unknown>).properties;
      const version = properties && typeof properties === "object" && !Array.isArray(properties)
        ? (properties as Record<string, unknown>).schemaVersion
        : undefined;
      const constant = version && typeof version === "object" && !Array.isArray(version)
        ? (version as Record<string, unknown>).const
        : undefined;
      return typeof constant !== "string" || constant === schemaVersion;
    });
  }
  return copy;
};

const prepareTaskOutputSchema = routerToolOutputSchema("router-result/1.1", [
  "ok", "schemaVersion", "status", "activation", "taskProfile", "project", "routing", "warnings",
  "run", "selections", "requiredReads", "runtimeClarification", "verification", "clarification",
  "continuationToken", "expiresAt", "decomposition", "suggestedAction", "missing",
  "installationSuggestions", "requiredBytes", "allowedBytes", "blockingSkillIds", "code", "message",
  "details", "reasonCode", "argument", "currentCatalogDigest", "nextTool",
]);

const readRunSkillFileOutputSchema = routerToolOutputSchema("router-read-result/1.0", [
  "ok", "schemaVersion", "routerRunId", "runtimeRunId", "runtime", "readRequestId", "readRevision",
  "skillId", "path", "mimeType", "content", "fileChecksum", "chunkChecksum", "deliveredOffset",
  "deliveredBytes", "totalBytes", "complete", "readStatus", "code", "message", "details",
  "reasonCode", "argument",
]);

const inputSchema = {
  type: "object",
  properties: {
    prompt: { type: "string", minLength: 1, maxLength: 64000 },
    // Named rather than enumerated: the value is NFKC-lowercased before lookup, so an enum would
    // reject case variants that resolve today. Publishing the IDs stops a host from guessing.
    targetAgent: { type: "string", minLength: 1, maxLength: 128, description: "Canonical target agent ID, case-insensitive. Supported: claude-code, codex, cursor, gemini-cli, generic-agent-skills, opencode, universal. Omit to use the project default." },
    hostCapabilities: { type: "array", maxItems: 64, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 128 } },
    strict: { type: "boolean" },
    continuationToken: { type: "string", minLength: 1, maxLength: 4096 },
    clarificationAnswers: { type: "array", maxItems: 8, items: { type: "object", properties: { questionId: { type: "string", minLength: 1, maxLength: 128 }, value: { type: "string", minLength: 1, maxLength: 128 } }, required: ["questionId", "value"], additionalProperties: false } },
    semanticHints: { type: "object" },
    routingProposal: {
      type: "object",
      required: ["schemaVersion", "catalogDigest", "catalogReceipt", "interpretation", "nominations"],
      properties: {
        schemaVersion: { const: "routing-proposal/1.0" },
        catalogDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        catalogReceipt: { type: "string", minLength: 1, maxLength: routingProposalLimits.maxCatalogReceiptBytes },
        interpretation: {
          type: "object",
          required: ["domains", "actions", "artifactTypes", "intentTags", "technologyTags", "qualityGoals"],
          properties: Object.fromEntries(["domains", "actions", "artifactTypes", "intentTags", "technologyTags", "qualityGoals"].map((field) => [field, {
            type: "array", maxItems: routingProposalLimits.maxInterpretationItems, uniqueItems: true,
            items: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{0,127}$" },
          }])),
          additionalProperties: false,
        },
        nominations: {
          type: "array", minItems: 1, maxItems: routingProposalLimits.maxNominations,
          items: {
            type: "object",
            required: ["skillId", "role", "confidence", "evidenceText"],
            properties: {
              skillId: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{0,127}$" },
              role: { enum: ["primary", "companion", "verification"] },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              evidenceText: { type: "string", minLength: 1, maxLength: routingProposalLimits.maxEvidenceBytes },
            },
            additionalProperties: false,
          },
        },
        ambiguity: {
          type: "object", required: ["primarySkillIds"], additionalProperties: false,
          properties: { primarySkillIds: { type: "array", minItems: 2, maxItems: 3, uniqueItems: true, items: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{0,127}$" } } },
        },
      },
      additionalProperties: false,
    },
    skillInputs: { type: "object", maxProperties: maxSkillInputEntries, additionalProperties: { type: "object" }, description: "Strict-mode only. Maps a bundled skill ID to the input object required by that skill's input.schema.json." },
  },
  required: ["prompt"],
  additionalProperties: false,
};

const readInputSchema = {
  type: "object",
  properties: {
    routerRunId: { type: "string", pattern: "^route_[a-z0-9_-]{7,127}$" },
    readRequestId: { type: "string", format: "uuid" },
    expectedReadRevision: { type: "integer", minimum: 0 },
    mode: { enum: ["mandatory-next", "optional-file"] },
    skillId: { type: "string", minLength: 1 },
    path: { type: "string", minLength: 1 },
  },
  required: ["routerRunId", "readRequestId", "expectedReadRevision", "mode"],
  additionalProperties: false,
  oneOf: [
    { properties: { mode: { const: "mandatory-next" } } },
    { properties: { mode: { const: "optional-file" } }, required: ["skillId", "path"] },
  ],
};

export const routerToolDefinitions: McpToolDefinition[] = [
  { ...mcpToolEffects.runStateWrite, name: "prepare_task", title: "Prepare SkillRanger Task", description: `Canonical authoritative entrypoint after an ${explicitTriggerGuidance.replace(/^Use the SkillRanger workflow only after an /, "") } Preserve the complete, unmodified user request, including its leading or terminal trigger. ${catalogDiscoveryGuidance} ${completeRoleAwareNominationGuidance} ${legacyCatalogGuidance} ${catalogRefreshGuidance} ${proposalIntegrityGuidance} ${fallbackRecallGuidance} Do not submit semanticHints together with a routingProposal. ${mandatoryReadGuidance} ${setupBoundaryGuidance}`, inputSchema, outputSchema: prepareTaskOutputSchema },
  { ...mcpToolEffects.runStateWrite, annotations: { ...mcpToolEffects.runStateWrite.annotations, idempotentHint: true }, name: "read_run_skill_file", title: "Read Prepared Skill Instructions", description: `${mandatoryReadGuidance} Use a new RFC 4122 UUID for each new read; retry a transport failure with the identical request and its current revision.`, inputSchema: readInputSchema, outputSchema: readRunSkillFileOutputSchema },
];

const routerErrorCode = (code: string) => {
  const allowed = new Set(["trigger-required", "empty-intent", "intent-too-large", "router-disabled", "target-agent-unresolved", "project-root-unauthorized", "continuation-invalid", "continuation-expired", "clarification-answer-invalid", "capability-invalid", "router-config-invalid", "raw-intent-confirmation-required", "routing-integrity", "semantic-hint-invalid", "routing-proposal-invalid", "skill-not-selected", "skill-source-unavailable", "skill-file-not-found", "skill-path-blocked", "skill-file-unsupported", "stale-skill-checksum", "read-request-conflict", "read-order-invalid", "context-budget-exceeded", "run-not-found", "run-integrity"]);
  return allowed.has(code) ? code as never : "run-integrity" as never;
};

const withRouterErrors = (handler: McpToolHandler): McpToolHandler => async (args) => {
  try { return await handler(args); }
  catch (error) {
    if (error instanceof McpToolError) throw error;
    if (error instanceof RouterPrepareError || error instanceof RouterReaderError) throw new McpToolError(routerErrorCode(error.code), error.message, { reasonCode: error.code });
    if (error instanceof RouterStoreError) {
      const code = error.code === "run-not-found" ? "run-not-found" : "run-integrity";
      throw new McpToolError(code, error.message, { reasonCode: error.code });
    }
    throw error;
  }
};

const prepare: McpToolHandler = async (args) => {
  const context = routerContext();
  const unknown = Object.keys(args).find((key) => !["prompt", "targetAgent", "hostCapabilities", "strict", "continuationToken", "clarificationAnswers", "semanticHints", "routingProposal", "skillInputs"].includes(key));
  if (unknown) throw new McpToolError(unknown === "projectRoot" || unknown === "registryRoot" ? "project-root-unauthorized" as never : "invalid-arguments", `Unknown router argument: ${unknown}.`, { argument: unknown });
  if (args.skillInputs !== undefined && args.strict !== true) throw new McpToolError("invalid-arguments", "skillInputs is only available with strict: true.", { argument: "skillInputs" });
  const skillInputs = args.skillInputs === undefined
    ? undefined
    : await validateSkillInputs(args.skillInputs, context.registryRoot).catch((error) => {
      if (error instanceof SkillInputsError) throw new McpToolError("invalid-arguments", error.message, { argument: "skillInputs" });
      throw error;
    });
  const input: PrepareTaskCoreInput = {
    projectRoot: context.projectRoot,
    registry: { kind: "bundled", root: context.registryRoot },
    prompt: requireString(args.prompt, "prompt"),
    activation: { mode: "explicit" },
    ...(typeof args.targetAgent === "string" ? { targetAgent: args.targetAgent } : {}),
    capabilities: (args.hostCapabilities === undefined ? [] : requireStringArray(args.hostCapabilities, "hostCapabilities")).map((id) => ({ id, source: "host-reported" as const })),
    ...(typeof args.strict === "boolean" ? { strict: args.strict } : {}),
    ...(typeof args.continuationToken === "string" ? { continuationToken: args.continuationToken } : {}),
    ...(Array.isArray(args.clarificationAnswers) ? { clarificationAnswers: args.clarificationAnswers as Array<{ questionId: string; value: string }> } : {}),
    ...(args.semanticHints !== undefined ? { semanticHints: args.semanticHints as PrepareTaskCoreInput["semanticHints"] } : {}),
    ...(args.routingProposal !== undefined ? { routingProposal: args.routingProposal as PrepareTaskCoreInput["routingProposal"] } : {}),
    ...(skillInputs === undefined ? {} : { skillInputs }),
  };
  return jsonToolResult(await prepareTask(input));
};

const read: McpToolHandler = async (args) => {
  const context = routerContext();
  const unknown = Object.keys(args).find((key) => !["routerRunId", "readRequestId", "expectedReadRevision", "mode", "skillId", "path"].includes(key));
  if (unknown) throw new McpToolError("invalid-arguments", `Unknown argument: ${unknown}.`, { argument: unknown });
  if (args.mode !== "mandatory-next" && args.mode !== "optional-file") throw new McpToolError("invalid-arguments", "mode must be mandatory-next or optional-file.", { argument: "mode" });
  const input: ReadRunSkillFileInput = {
    routerRunId: requireString(args.routerRunId, "routerRunId"),
    readRequestId: requireString(args.readRequestId, "readRequestId"),
    expectedReadRevision: typeof args.expectedReadRevision === "number" ? args.expectedReadRevision : Number.NaN,
    mode: args.mode,
    ...(args.mode === "optional-file" ? { skillId: requireString(args.skillId, "skillId"), path: requireString(args.path, "path") } : {}),
  } as ReadRunSkillFileInput;
  const bridge = createRouterRuntimeBridge(context.projectRoot, context.registryRoot);
  const runtime = bridge.createRuntimeStore();
  const routerStore = new RouterStore(context.projectRoot, { runtime });
  const routerRun = await routerStore.read(input.routerRunId);
  const bridgedReader = bridge.createReader(routerStore, {
    prepareMandatorySkillComplete: async ({ run, skillId, packageChecksum }: { run: typeof routerRun; skillId: string; packageChecksum: string }) => {
      const existing = await runtime.read(run.runtime.runId);
      if (!existing) throw new RouterStoreError("run-not-found", `Runtime run not found: ${run.runtime.runId}`);
      if (run.runtime.kind === "lifecycle-v1") {
        const current = existing as Awaited<ReturnType<SkillRunStore["read"]>>;
        const reduced = reduceSkillRun(current, { type: "record-skill-read", skillId, checksum: packageChecksum, source: "content-delivered" });
        const next = { ...reduced, revision: current.revision + 1 };
        return { runtime, runtimePayload: next, applyRuntime: async () => { await runtime.replace(run.runtime.runId, next); } };
      }
      let next = existing as Awaited<ReturnType<StrictSkillRunStore["read"]>>;
      const ledger = next.skillLedgers.find(({ skillId: id }) => id === skillId);
      // Core (universal) skills are guidance-only and never enter the strict
      // runtime's ledgers; their completed router-level reads need no sync.
      const isCoreSkill = run.selections.agentContext.some(({ skillId: id, domains }) => id === skillId && isCoreDomainSkill(domains));
      if (!ledger) {
        if (isCoreSkill) return { runtime, runtimePayload: next, applyRuntime: async () => {} };
        throw new RouterStoreError("run-integrity", `Unknown strict skill: ${skillId}`);
      }
      while (next.skillLedgers.find(({ skillId: id }) => id === skillId)?.readReceipts.length
        !== next.skillLedgers.find(({ skillId: id }) => id === skillId)?.contentChunks.length) {
        next = readNextStrictChunk(next, skillId).run;
      }
      const payload = next;
      return { runtime, runtimePayload: payload, applyRuntime: async () => { await runtime.replace(run.runtime.runId, payload); } };
    },
  });
  return jsonToolResult(await bridgedReader.read(input));
};

export const routerToolHandlers: Record<string, McpToolHandler> = {
  prepare_task: withRouterErrors(prepare),
  read_run_skill_file: withRouterErrors(read),
};

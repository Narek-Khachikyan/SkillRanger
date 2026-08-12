import { callMcpTool, mcpTools } from "./tools.ts";
import { readSkillRangerVersion } from "../version.ts";
import { routerContext } from "./router-context.ts";
import {
  catalogDiscoveryGuidance,
  catalogRefreshGuidance,
  completeRoleAwareNominationGuidance,
  explicitTriggerGuidance,
  fallbackRecallGuidance,
  legacyCatalogGuidance,
  mandatoryReadGuidance,
  managedGuidanceBoundary,
  proposalIntegrityGuidance,
  setupBoundaryGuidance,
  universalOutputContractGuidance,
} from "../host-guidance.ts";

const protocolVersion = "2025-06-18";

export type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

const success = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  result
});

const failure = (id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: {
    code,
    message,
    ...(data === undefined ? {} : { data })
  }
});

export const handleJsonRpcRequest = async (request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> => {
  const id = request.id ?? null;
  const method = request.method;

  if (!method) {
    return failure(id, -32600, "Invalid request: missing method.");
  }

  if (request.id === undefined) {
    return undefined;
  }

  if (method === "initialize") {
    const version = await readSkillRangerVersion();
    const { projectRoot } = routerContext();
    return success(id, {
      protocolVersion,
      capabilities: {
        tools: {
          listChanged: false
        }
      },
      serverInfo: {
        name: "skillranger",
        title: "SkillRanger",
        version
      },
      instructions: [
        `Effective SkillRanger project root: ${projectRoot}.`,
        "This root is fixed for the lifetime of this MCP server.",
        "If it is not the intended project, stop and restart Codex from the target directory.",
        "Do not pass projectRoot to router tools and do not fall back to a local SkillRanger CLI.",
        explicitTriggerGuidance,
        catalogDiscoveryGuidance,
        completeRoleAwareNominationGuidance,
        legacyCatalogGuidance,
        catalogRefreshGuidance,
        proposalIntegrityGuidance,
        fallbackRecallGuidance,
        "Call prepare_task with the full prompt and requested strict mode; do not combine routingProposal with semanticHints.",
        setupBoundaryGuidance,
        managedGuidanceBoundary,
        "Strict mode also requires hostCapabilities and a skillInputs entry for every selected skill; each skill declares its required input object in input.schema.json inside its installed skill directory.",
        "Treat its runtime run ID as authoritative; do not call the low-level start_skill_run after prepare_task.",
        mandatoryReadGuidance,
        "For lifecycle-v1, resolve any required clarifications, call begin_skill_run_execution, and persist results with complete_skill_run and verify_skill_run.",
        "For strict-v2, use read_next_skill_chunk, begin_skill_step, add_skill_evidence, complete_skill_step, verify_skill, and finalize_skill_run; the lifecycle-v1 transition tools reject a strict-v2 run, so never mix the two families on one run.",
        "For material frontend work in strict mode, complete the returned frontend design workflow, capture real browser evidence with capture_ui_evidence, run a compare_design_variants critic exchange with host-attested actor separation, recheck after any repair, and call verify_visual_result.",
        "Read persisted state of either runtime with inspect_skill_run.",
        universalOutputContractGuidance,
        "Never report that SkillRanger or strict visual verification passed unless the persisted run is verified with a passed verification status; otherwise report the exact failed or incomplete state.",
        "A finalize_skill_run that returns the run-blocked error means no verified result exists: report its userMessage and blockedSkills verbatim and do not describe the run as passed, processed, or complete.",
        "For project work, use repo scope unless the user explicitly requests user scope.",
        "Skill installation requires an exact confirmed plan.",
        "After strict_requirements_unmet, use the returned installation suggestion: plan the exact install, obtain confirmation, apply that exact plan, then call prepare_task again.",
        "Do not call run:start or start_skill_run as a fallback.",
        "UI capture requires explicit confirmation and constrains its declared output directory to the project, while the host-reviewed command remains open-world.",
      ].join(" ")
    });
  }

  if (method === "tools/list") {
    return success(id, { tools: mcpTools });
  }

  if (method === "tools/call") {
    const params = request.params ?? {};
    const toolName = params.name;
    if (typeof toolName !== "string" || toolName.trim() === "") {
      return failure(id, -32602, "Invalid params: tools/call requires params.name.");
    }
    const toolArgs = params.arguments;
    if (toolArgs !== undefined && (typeof toolArgs !== "object" || toolArgs === null || Array.isArray(toolArgs))) {
      return failure(id, -32602, "Invalid params: tools/call params.arguments must be an object when present.");
    }
    try {
      return success(id, await callMcpTool(toolName, (toolArgs ?? {}) as Record<string, unknown>));
    } catch (error) {
      return failure(id, -32603, error instanceof Error ? error.message : String(error), { code: "internal-error" });
    }
  }

  return failure(id, -32601, `Method not found: ${method}`);
};

export const handleJsonRpcLine = async (line: string): Promise<JsonRpcResponse | undefined> => {
  const trimmed = line.trim();
  if (!trimmed) return undefined;

  try {
    return await handleJsonRpcRequest(JSON.parse(trimmed) as JsonRpcRequest);
  } catch (error) {
    return failure(null, -32700, error instanceof Error ? error.message : String(error));
  }
};

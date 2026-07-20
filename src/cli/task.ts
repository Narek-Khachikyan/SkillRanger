import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { loadRouterConfig } from "../config/index.ts";
import { loadLocalRegistry } from "../registry/index.ts";
import { createRouterReader, prepareTask, RouterPrepareError } from "../router/index.ts";
import type { PrepareTaskCoreInput, PrepareTaskResult, ReadRunSkillFileInput, RouterExplanation, RouterSkillRole } from "../router/types.ts";
import { RouterReaderError } from "../router/reader.ts";

type Flags = Record<string, string | boolean>;
const maxJsonFileBytes = 256_000;
const canonicalId = /^[a-z0-9][a-z0-9._-]{1,127}$/;

class TaskCliError extends Error {
  readonly code = "invalid-arguments";
}

const invalid = (message: string): never => { throw new TaskCliError(message); };

const required = (flags: Flags, name: string): string => {
  const value = flags[name];
  const text = typeof value === "string" ? value : invalid(`--${name} is required.`);
  if (text.trim() === "") invalid(`--${name} is required.`);
  return text;
};

const optional = (flags: Flags, name: string): string | undefined => {
  const value = flags[name];
  if (value === undefined) return undefined;
  const text = typeof value === "string" ? value : invalid(`--${name} requires a value.`);
  if (text.trim() === "") invalid(`--${name} requires a value.`);
  return text;
};

const jsonFile = async (value: string, label: string): Promise<unknown> => {
  let handle;
  try {
    handle = await open(path.resolve(value), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = await handle.stat();
    if (!metadata.isFile()) invalid(`${label} must be a regular file.`);
    if (metadata.size > maxJsonFileBytes) invalid(`${label} exceeds ${maxJsonFileBytes} bytes.`);
    const buffer = Buffer.alloc(maxJsonFileBytes + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxJsonFileBytes) invalid(`${label} exceeds ${maxJsonFileBytes} bytes.`);
    return JSON.parse(buffer.subarray(0, offset).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof TaskCliError) throw error;
    invalid(`Could not read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await handle?.close();
  }
};

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(`${label} must be a JSON object.`);
  return value as Record<string, unknown>;
};

const parseSkillInputs = async (filePath: string, registryRoot: string) => {
  const value = record(await jsonFile(filePath, "skill inputs"), "skill inputs");
  const entries = Object.entries(value);
  if (entries.length > 32) invalid("skill inputs contain too many skill IDs.");
  const registryIds = new Set((await loadLocalRegistry(registryRoot)).map(({ manifest }) => manifest.id));
  for (const [skillId, skillInput] of entries) {
    if (!canonicalId.test(skillId) || !registryIds.has(skillId)) invalid(`skill inputs contain an unknown bundled skill ID: ${skillId}.`);
    record(skillInput, `skill input for ${skillId}`);
  }
  return value as Record<string, Record<string, unknown>>;
};

const parseAnswers = async (filePath: string) => {
  const value = record(await jsonFile(filePath, "clarification answers"), "clarification answers");
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 8) invalid("clarification answers must contain between 1 and 8 entries.");
  return entries.map(([questionId, answer]) => {
    const answerText = typeof answer === "string" ? answer : invalid("clarification answers must map canonical question IDs to non-empty option values of at most 128 characters.");
    if (!canonicalId.test(questionId)) {
      invalid("clarification answers must map canonical question IDs to non-empty option values of at most 128 characters.");
    }
    if (answerText.length < 1 || answerText.length > 128) invalid("clarification answers must map canonical question IDs to non-empty option values of at most 128 characters.");
    return { questionId, value: answerText };
  });
};

const capabilities = (value: string | boolean | undefined): string[] => {
  if (value === undefined) return [];
  const text = typeof value === "string" ? value : invalid("--capabilities requires a comma-separated value.");
  return text.split(",").map((item: string) => item.trim()).filter(Boolean);
};

const explanationFor = (result: PrepareTaskResult): RouterExplanation => {
  const selectedRoles: Record<RouterSkillRole, string[]> = {
    environment: [], primary: [], companion: [], verification: [], "agent-context": [],
  };
  const selected = result.status === "prepared"
    ? [result.selections.primary, ...result.selections.environment, ...result.selections.companions, ...result.selections.verification, ...result.selections.agentContext]
    : [];
  for (const selection of selected) selectedRoles[selection.role].push(selection.skillId);
  return {
    deterministicKey: result.routing.deterministicKey,
    domains: result.routing.domains.map(({ id, confidence, reasons }) => ({ id, score: confidence, reasonCodes: reasons })),
    candidates: selected.map(({ skillId, score }) => ({ skillId, score })),
    selectedRoles,
    omitted: [],
  };
};

const print = (value: unknown, json: boolean, explain = false) => {
  if (json) {
    const output = explain ? { ...(value as PrepareTaskResult), explanation: explanationFor(value as PrepareTaskResult) } : value;
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  const result = value as { status?: string; run?: { routerRunId: string; runtimeRunId: string }; routing?: { domains: Array<{ id: string; role: string; confidence: number }> }; requiredReads?: Array<unknown>; suggestedAction?: string };
  if (result.status === "prepared") {
    const primary = result.routing?.domains.find(({ role }) => role === "primary");
    console.log(`Prepared${primary ? ` ${primary.id} (${Math.round(primary.confidence * 100)}%)` : ""}.`);
    console.log(`Router run: ${result.run?.routerRunId}`);
    console.log(`Runtime run: ${result.run?.runtimeRunId}`);
    console.log(`Mandatory reads: ${result.requiredReads?.length ?? 0}`);
    if (explain) {
      const selections = (value as PrepareTaskResult & { status: "prepared" }).selections;
      for (const selection of [selections.primary, ...selections.environment, ...selections.companions, ...selections.verification, ...selections.agentContext]) {
        console.log(`${selection.role}: ${selection.skillId} - ${selection.reasons.join("; ")}`);
      }
    }
  } else console.log(result.status === "no_matching_skills" ? result.suggestedAction : result.status);
};

const errorCode = (error: unknown) => error instanceof TaskCliError || error instanceof RouterPrepareError || error instanceof RouterReaderError ? error.code : "tool-error";

export const handleTaskCliCommand = async (input: { command?: string; positionals: string[]; flags: Flags; registryRoot: string }): Promise<boolean> => {
  if (input.command !== "task" && input.command !== "task:read") return false;
  const json = Boolean(input.flags.json);
  try {
    const projectRoot = path.resolve(input.positionals[0] ?? ".");
    if (input.command === "task:read") {
      const routerRunId = required(input.flags, "router-run");
      const expectedReadRevision = Number(required(input.flags, "expected-read-revision"));
      if (!Number.isSafeInteger(expectedReadRevision) || expectedReadRevision < 0) invalid("--expected-read-revision must be a non-negative integer.");
      const mandatory = Boolean(input.flags["mandatory-next"]);
      const skill = optional(input.flags, "skill");
      const relativePath = optional(input.flags, "path");
      if ((mandatory && (skill !== undefined || relativePath !== undefined)) || (!mandatory && (skill === undefined || relativePath === undefined))) {
        invalid("task:read requires exactly one of --mandatory-next or --skill with --path.");
      }
      const result = await createRouterReader(projectRoot, input.registryRoot).read({
        routerRunId,
        readRequestId: optional(input.flags, "read-request-id") ?? crypto.randomUUID(),
        expectedReadRevision,
        mode: mandatory ? "mandatory-next" : "optional-file",
        ...(mandatory ? {} : { skillId: skill as string, path: relativePath as string }),
      } as ReadRunSkillFileInput);
      if (json) print(result, true); else console.log(result.content);
      return true;
    }
    const intent = required(input.flags, "intent");
    const config = await loadRouterConfig(projectRoot);
    const storeIntent = Boolean(input.flags["store-intent"]);
    if (storeIntent && (!config.config.privacy.allowRawIntentPersistence || input.flags["confirm-store-intent"] !== true)) {
      throw new RouterPrepareError("raw-intent-confirmation-required", "Raw intent persistence requires project privacy permission and --confirm-store-intent.");
    }
    const skillInputsPath = optional(input.flags, "skill-inputs");
    const skillInputs = skillInputsPath ? await parseSkillInputs(skillInputsPath, input.registryRoot) : undefined;
    if (skillInputs !== undefined && !input.flags.strict) invalid("--skill-inputs is only available with --strict.");
    const continuationToken = optional(input.flags, "continuation-token");
    const answersPath = optional(input.flags, "answers");
    const clarificationAnswers = answersPath ? await parseAnswers(answersPath) : undefined;
    const result = await prepareTask({
      projectRoot,
      registry: { kind: "bundled", root: input.registryRoot },
      prompt: intent,
      activation: { mode: "direct" },
      targetAgent: optional(input.flags, "target"),
      capabilities: capabilities(input.flags.capabilities).map((id) => ({ id, source: "host-reported" as const })),
      strict: Boolean(input.flags.strict),
      ...(skillInputs === undefined ? {} : { skillInputs }),
      ...(continuationToken ? { continuationToken } : {}),
      ...(clarificationAnswers ? { clarificationAnswers } : {}),
      ...(storeIntent ? { rawIntentPersistence: "explicitly-authorized" as const } : {}),
    } satisfies PrepareTaskCoreInput);
    print(result, json, Boolean(input.flags.explain));
    if (result.status === "clarification_required") process.exitCode = 2;
    else if (result.status === "decomposition_required") process.exitCode = 3;
    else if (result.status === "no_matching_skills") process.exitCode = 4;
    else if (result.status === "strict_requirements_unmet") process.exitCode = 5;
    else if (result.status === "context_budget_exceeded") process.exitCode = 6;
  } catch (error) {
    const output = { ok: false, code: errorCode(error), message: error instanceof Error ? error.message : String(error) };
    if (json) console.log(JSON.stringify(output, null, 2)); else console.error(`[${output.code}] ${output.message}`);
    process.exitCode = 1;
  }
  return true;
};

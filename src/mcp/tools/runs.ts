import path from "node:path";
import "../../domains/bundled.ts";
import { startPreparedSkillRun } from "../../runs/start.ts";
import {
  completeSkillRun,
  recordSkillRead,
  resolveSkillRunClarifications,
  SkillRunError,
  SkillRunStore,
  startSkillRunExecution,
  verifySkillRun,
  type SkillRun,
  type SkillRunArtifact,
  type SkillRunErrorCode,
} from "../../runtime/skill-run/index.ts";
import type { VerificationReport } from "../../runtime/types.ts";
import { McpToolError, type McpToolDefinition, type McpToolErrorCode, type McpToolHandler } from "./types.ts";
import {
  asString,
  projectRootProperty,
  registryRootProperty,
  requireString,
  requireStringArray,
  resolveRegistryRoot,
} from "./utils.ts";

const lifecycleErrorCodeMap: Record<SkillRunErrorCode, McpToolErrorCode> = {
  "run-not-found": "run-not-found",
  "invalid-transition": "invalid-transition",
  "mandatory-skill-unread": "mandatory-skill-unread",
  "stale-skill-checksum": "stale-skill-checksum",
  "clarification-required": "clarification-required",
  "verification-blocked": "verification-blocked",
  "run-integrity": "run-integrity",
};

export const mapSkillRunError = (error: SkillRunError): McpToolError => (
  new McpToolError(lifecycleErrorCodeMap[error.code], error.message, { lifecycleCode: error.code })
);

const withSkillRunErrors = (handler: McpToolHandler): McpToolHandler => async (args) => {
  try {
    return await handler(args);
  } catch (error) {
    if (error instanceof SkillRunError) throw mapSkillRunError(error);
    throw error;
  }
};

const runResult = (run: SkillRun) => ({
  content: [{ type: "text" as const, text: `${run.runId}: ${run.state}` }],
  structuredContent: run,
  isError: false,
});

const asProjectRoot = (value: unknown) => path.resolve(asString(value, "."));

const asStoreIntent = (value: unknown): boolean => {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  throw new McpToolError("invalid-arguments", "storeIntent must be a boolean.", { argument: "storeIntent" });
};

const requireObject = (value: unknown, name: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new McpToolError("invalid-arguments", `${name} must be an object.`, { argument: name });
  }
  return value as Record<string, unknown>;
};

const asClarificationAnswers = (value: unknown) => {
  if (!Array.isArray(value)) {
    throw new McpToolError("invalid-arguments", "answers must be an array.", { argument: "answers" });
  }
  return value.map((entry, index) => {
    const answer = requireObject(entry, `answers[${index}]`);
    return {
      questionId: requireString(answer.questionId, `answers[${index}].questionId`),
      answer: requireString(answer.answer, `answers[${index}].answer`),
    };
  });
};

const asArtifacts = (value: unknown): SkillRunArtifact[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new McpToolError("invalid-arguments", "artifacts must be an array.", { argument: "artifacts" });
  }
  return value.map((entry, index) => {
    const artifact = requireObject(entry, `artifacts[${index}]`);
    const artifactPath = artifact.path === undefined
      ? undefined
      : requireString(artifact.path, `artifacts[${index}].path`);
    return {
      kind: requireString(artifact.kind, `artifacts[${index}].kind`),
      ...(artifactPath === undefined ? {} : { path: artifactPath }),
      description: requireString(artifact.description, `artifacts[${index}].description`),
    };
  });
};

const startRun: McpToolHandler = async (args) => {
  const projectRoot = asProjectRoot(args.projectRoot);
  const registryRoot = resolveRegistryRoot(args.registryRoot);
  const targetAgent = requireString(args.targetAgent, "targetAgent");
  const domainId = requireString(args.domain, "domain");
  const intent = requireString(args.intent, "intent");
  const designBrief = args.designBrief === undefined
    ? undefined
    : requireObject(args.designBrief, "designBrief");
  return runResult(await startPreparedSkillRun({
    projectRoot,
    registryRoot,
    targetAgent,
    domain: domainId,
    intent,
    ...(designBrief === undefined ? {} : { artifacts: { designBrief } }),
    storeRawIntent: asStoreIntent(args.storeIntent),
  }));
};

const recordRead: McpToolHandler = async (args) => runResult(await recordSkillRead(
  new SkillRunStore(asProjectRoot(args.projectRoot)),
  requireString(args.runId, "runId"),
  {
    skillId: requireString(args.skillId, "skillId"),
    checksum: requireString(args.checksum, "checksum"),
  },
));

const resolveClarifications: McpToolHandler = async (args) => runResult(await resolveSkillRunClarifications(
  new SkillRunStore(asProjectRoot(args.projectRoot)),
  requireString(args.runId, "runId"),
  {
    answers: asClarificationAnswers(args.answers),
    declinedFields: requireStringArray(args.declinedFields, "declinedFields"),
    assumptions: requireStringArray(args.assumptions, "assumptions"),
  },
));

const beginExecution: McpToolHandler = async (args) => runResult(await startSkillRunExecution(
  new SkillRunStore(asProjectRoot(args.projectRoot)),
  requireString(args.runId, "runId"),
));

const completeRun: McpToolHandler = async (args) => {
  const status = requireString(args.status, "status");
  if (status !== "implemented" && status !== "failed" && status !== "blocked") {
    throw new McpToolError("invalid-arguments", "status must be implemented, failed, or blocked.", {
      argument: "status",
    });
  }
  return runResult(await completeSkillRun(
    new SkillRunStore(asProjectRoot(args.projectRoot)),
    requireString(args.runId, "runId"),
    { status, artifacts: asArtifacts(args.artifacts) },
  ));
};

const verifyRun: McpToolHandler = async (args) => runResult(await verifySkillRun(
  new SkillRunStore(asProjectRoot(args.projectRoot)),
  requireString(args.runId, "runId"),
  {
    reportPath: requireString(args.reportPath, "reportPath"),
    report: requireObject(args.report, "report") as VerificationReport,
  },
));

const inspectRun: McpToolHandler = async (args) => runResult(await new SkillRunStore(
  asProjectRoot(args.projectRoot),
).read(requireString(args.runId, "runId")));

const runIdProperties = {
  projectRoot: projectRootProperty,
  runId: { type: "string", description: "Skill run id." },
};

const artifactSchema = {
  type: "object",
  properties: {
    kind: { type: "string" },
    path: { type: "string" },
    description: { type: "string" },
  },
  required: ["kind", "description"],
  additionalProperties: false,
};

export const runToolDefinitions: McpToolDefinition[] = [
  {
    name: "start_skill_run",
    title: "Start Skill Run",
    description: "Prepare and persist a skill run from project signals, intent, and domain policy.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: projectRootProperty,
        registryRoot: registryRootProperty,
        targetAgent: { type: "string" },
        domain: { type: "string" },
        intent: { type: "string" },
        designBrief: { type: "object" },
        storeIntent: { type: "boolean" },
      },
      required: ["targetAgent", "domain", "intent"],
      additionalProperties: false,
    },
  },
  {
    name: "record_skill_read",
    title: "Record Skill Read",
    description: "Record a selected skill checksum as read for a skill run.",
    inputSchema: {
      type: "object",
      properties: {
        ...runIdProperties,
        skillId: { type: "string" },
        checksum: { type: "string" },
      },
      required: ["runId", "skillId", "checksum"],
      additionalProperties: false,
    },
  },
  {
    name: "resolve_skill_run_clarifications",
    title: "Resolve Skill Run Clarifications",
    description: "Resolve required clarifications with JSON-native answers, declines, and assumptions.",
    inputSchema: {
      type: "object",
      properties: {
        ...runIdProperties,
        answers: {
          type: "array",
          items: {
            type: "object",
            properties: { questionId: { type: "string" }, answer: { type: "string" } },
            required: ["questionId", "answer"],
            additionalProperties: false,
          },
        },
        declinedFields: { type: "array", items: { type: "string" } },
        assumptions: { type: "array", items: { type: "string" } },
      },
      required: ["runId", "answers", "declinedFields", "assumptions"],
      additionalProperties: false,
    },
  },
  {
    name: "begin_skill_run_execution",
    title: "Begin Skill Run Execution",
    description: "Transition a prepared skill run into execution.",
    inputSchema: {
      type: "object",
      properties: runIdProperties,
      required: ["runId"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_skill_run",
    title: "Complete Skill Run",
    description: "Complete execution with a lifecycle status and JSON-native artifacts.",
    inputSchema: {
      type: "object",
      properties: {
        ...runIdProperties,
        status: { type: "string", enum: ["implemented", "failed", "blocked"] },
        artifacts: { type: "array", items: artifactSchema },
      },
      required: ["runId", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "verify_skill_run",
    title: "Verify Skill Run",
    description: "Record a JSON-native verification report for an implemented skill run.",
    inputSchema: {
      type: "object",
      properties: {
        ...runIdProperties,
        reportPath: { type: "string" },
        report: { type: "object" },
      },
      required: ["runId", "reportPath", "report"],
      additionalProperties: false,
    },
  },
  {
    name: "inspect_skill_run",
    title: "Inspect Skill Run",
    description: "Read the current persisted skill run state.",
    inputSchema: {
      type: "object",
      properties: runIdProperties,
      required: ["runId"],
      additionalProperties: false,
    },
  },
];

export const runToolHandlers: Record<string, McpToolHandler> = {
  start_skill_run: withSkillRunErrors(startRun),
  record_skill_read: withSkillRunErrors(recordRead),
  resolve_skill_run_clarifications: withSkillRunErrors(resolveClarifications),
  begin_skill_run_execution: withSkillRunErrors(beginExecution),
  complete_skill_run: withSkillRunErrors(completeRun),
  verify_skill_run: withSkillRunErrors(verifyRun),
  inspect_skill_run: withSkillRunErrors(inspectRun),
};

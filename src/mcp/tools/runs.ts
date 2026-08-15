import path from "node:path";
import { readFile } from "node:fs/promises";
import "../../domains/bundled.ts";
import { startPreparedSkillRun } from "../../runs/start.ts";
import {
  completeSkillRun,
  recordSkillRead,
  resolveSkillRunClarifications,
  SkillRunError,
  skillRunNoticeText,
  SkillRunStore,
  startSkillRunExecution,
  verificationNoticeFor,
  verifySkillRun,
  type SkillRun,
  type SkillRunArtifact,
  type SkillRunErrorCode,
} from "../../runtime/skill-run/index.ts";
import type { VerificationReport } from "../../runtime/types.ts";
import { verificationReportInputSchema } from "../../runtime/skill-run/report-schema.ts";
import {
  beginStrictStep,
  completeStrictStep,
  readNextStrictChunk,
  startPreparedStrictSkillRun,
  StrictSkillRunError,
  StrictSkillRunStore,
  type SkillRunV2,
  type StrictSkillRunErrorCode,
} from "../../runtime/strict/index.ts";
import { McpToolError, mcpToolEffects, type JsonObject, type McpToolDefinition, type McpToolErrorCode, type McpToolHandler } from "./types.ts";
import {
  projectRootProperty,
  registryRootProperty,
  requireString,
  requireStringArray,
  resolveProjectRoot,
  resolveRegistryRoot,
} from "./utils.ts";
import { finalizeStrictRunRefreshingDiversificationLog } from "../../domains/frontend/design/diversification-log.ts";

const lifecycleErrorCodeMap: Record<SkillRunErrorCode, McpToolErrorCode> = {
  "run-not-found": "run-not-found",
  "invalid-transition": "invalid-transition",
  "mandatory-skill-unread": "mandatory-skill-unread",
  "stale-skill-checksum": "stale-skill-checksum",
  "clarification-required": "clarification-required",
  "verification-blocked": "verification-blocked",
  "run-integrity": "run-integrity",
};

const strictErrorCodeMap: Record<StrictSkillRunErrorCode, McpToolErrorCode> = {
  "strict-contract-missing": "strict-contract-missing", "strict-skill-not-installed": "strict-skill-not-installed",
  "skill-content-unread": "skill-content-unread", "step-out-of-order": "step-out-of-order",
  "evidence-missing": "evidence-missing", "unknown-rule-id": "unknown-rule-id",
  "artifact-integrity": "artifact-integrity", "hard-gate-failed": "hard-gate-failed",
  "repair-limit": "repair-limit", "run-not-finalizable": "run-not-finalizable",
  "run-not-found": "run-not-found", "run-integrity": "run-integrity",
  "run-blocked": "run-blocked",
};

export const mapSkillRunError = (error: SkillRunError): McpToolError => (
  new McpToolError(lifecycleErrorCodeMap[error.code], error.message, { lifecycleCode: error.code, ...error.details })
);

const withSkillRunErrors = (handler: McpToolHandler): McpToolHandler => async (args) => {
  try {
    return await handler(args);
  } catch (error) {
    if (error instanceof SkillRunError) throw mapSkillRunError(error);
    if (error instanceof StrictSkillRunError) throw new McpToolError(strictErrorCodeMap[error.code], error.message, { lifecycleCode: error.code, ...error.details });
    throw error;
  }
};

const runResult = (run: SkillRun) => ({
  content: [{ type: "text" as const, text: `${run.runId}: ${run.state}` }],
  structuredContent: run,
  isError: false,
});

const strictRunResult = (run: SkillRunV2, extra: Record<string, unknown> = {}) => ({
  content: [{ type: "text" as const, text: `${run.runId}: ${run.state}` }],
  structuredContent: Object.keys(extra).length === 0 ? run : { run, ...extra },
  isError: false,
});

const asProjectRoot = (value: unknown) => resolveProjectRoot(value);

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
  if (args.strict === true) return strictRunResult(await startPreparedStrictSkillRun({
    projectRoot, registryRoot, targetAgent, domain: domainId, intent,
    skillInputs: args.skillInputs === undefined ? {} : requireObject(args.skillInputs, "skillInputs") as Record<string, Record<string, unknown>>,
    hostCapabilities: args.hostCapabilities === undefined ? [] : requireStringArray(args.hostCapabilities, "hostCapabilities"),
    storeRawIntent: asStoreIntent(args.storeIntent),
  }));
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

const readNextChunk: McpToolHandler = async (args) => {
  const store = new StrictSkillRunStore(asProjectRoot(args.projectRoot));
  let delivered: ReturnType<typeof readNextStrictChunk> | undefined;
  const run = await store.update(requireString(args.runId, "runId"), (current) => {
    delivered = readNextStrictChunk(current, requireString(args.skillId, "skillId"));
    return delivered.run;
  });
  return strictRunResult(run, { chunk: delivered!.chunk });
};

const beginStep: McpToolHandler = async (args) => {
  const store = new StrictSkillRunStore(asProjectRoot(args.projectRoot));
  const run = await store.update(requireString(args.runId, "runId"), (current) => beginStrictStep(
    current, requireString(args.skillId, "skillId"), requireString(args.stepId, "stepId"),
  ));
  return strictRunResult(run);
};

const addEvidence: McpToolHandler = async (args) => {
  const store = new StrictSkillRunStore(asProjectRoot(args.projectRoot));
  const runId = requireString(args.runId, "runId");
  const skillId = requireString(args.skillId, "skillId");
  const stepId = requireString(args.stepId, "stepId");
  const current = await store.read(runId);
  const step = current.skillLedgers.find((ledger) => ledger.skillId === skillId)?.steps.find(({ id }) => id === stepId);
  const attempt = step?.attempts.at(-1)?.attempt;
  if (step?.status !== "active" || attempt === undefined) throw new StrictSkillRunError("step-out-of-order", `Step ${stepId} is not active.`);
  const relation = args.relation === undefined ? "produced" : requireString(args.relation, "relation");
  if (relation !== "produced" && relation !== "informed" && relation !== "verified") throw new McpToolError("invalid-arguments", "relation must be produced, informed, or verified.");
  const validatedAs = args.validatedAs === undefined ? undefined : requireString(args.validatedAs, "validatedAs");
  if (validatedAs !== undefined && validatedAs !== "input" && validatedAs !== "output" && validatedAs !== "critic-report") {
    throw new McpToolError("invalid-arguments", "validatedAs must be input, output, or critic-report.");
  }
  return strictRunResult(await store.ingestEvidence(runId, {
    sourcePath: requireString(args.sourcePath, "sourcePath"), kind: requireString(args.kind, "kind"),
    ...(validatedAs === undefined ? {} : { validatedAs }),
    attributions: [{ skillId, stepId, attempt, relation, ruleIds: requireStringArray(args.ruleIds, "ruleIds") }],
  }));
};

const completeStep: McpToolHandler = async (args) => {
  const store = new StrictSkillRunStore(asProjectRoot(args.projectRoot));
  const run = await store.update(requireString(args.runId, "runId"), (current) => completeStrictStep(
    current, requireString(args.skillId, "skillId"), requireString(args.stepId, "stepId"),
  ));
  return strictRunResult(run);
};

const verifyStrict: McpToolHandler = async (args) => {
  const store = new StrictSkillRunStore(asProjectRoot(args.projectRoot));
  const run = await store.verifySkill(requireString(args.runId, "runId"), requireString(args.skillId, "skillId"));
  return strictRunResult(run);
};

// A blocked run finalized as ok:true reads like success and has been narrated as one. The terminal
// state is still persisted first, so inspect_skill_run reports it; only the reply becomes an error.
// finalizeStrictRunRefreshingDiversificationLog is shared with the CLI surface so the two cannot
// disagree about either the blocked-run reply or the post-finalize diversification-log refresh.
const finalizeStrict: McpToolHandler = async (args) => {
  const projectRoot = asProjectRoot(args.projectRoot);
  const store = new StrictSkillRunStore(projectRoot);
  return strictRunResult(await finalizeStrictRunRefreshingDiversificationLog(
    projectRoot,
    store,
    requireString(args.runId, "runId"),
  ));
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
  const completed = await completeSkillRun(
    new SkillRunStore(asProjectRoot(args.projectRoot)),
    requireString(args.runId, "runId"),
    { status, artifacts: asArtifacts(args.artifacts) },
  );
  const result = runResult(completed.run);
  return {
    ...result,
    structuredContent: { run: completed.run, notices: completed.notices },
    ...(completed.notices.length === 0 ? {} : {
      content: [
        ...result.content,
        { type: "text" as const, text: completed.notices.map((notice) => skillRunNoticeText[notice]).join(" ") },
      ],
    }),
  };
};

const verifyRun: McpToolHandler = async (args) => runResult(await verifySkillRun(
  new SkillRunStore(asProjectRoot(args.projectRoot)),
  requireString(args.runId, "runId"),
  {
    reportPath: requireString(args.reportPath, "reportPath"),
    report: requireObject(args.report, "report") as VerificationReport,
  },
));

const inspectRun: McpToolHandler = async (args) => {
  const projectRoot = asProjectRoot(args.projectRoot);
  const runId = requireString(args.runId, "runId");
  if (!/^run_[a-z0-9_-]{7,127}$/.test(runId)) throw new McpToolError("run-integrity", `Invalid run id ${runId}.`);
  let persisted: { schemaVersion?: unknown };
  try { persisted = JSON.parse(await readFile(path.join(projectRoot, ".skillranger", "runs", `${runId}.json`), "utf8")) as { schemaVersion?: unknown }; }
  catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") throw new McpToolError("run-not-found", `Skill run not found: ${runId}.`);
    throw new McpToolError("run-integrity", `Skill run ${runId} is not valid persisted JSON.`);
  }
  if (persisted.schemaVersion === "2.0") {
    return strictRunResult(await new StrictSkillRunStore(projectRoot).read(runId));
  }
  const run = await new SkillRunStore(projectRoot).read(runId);
  const result = runResult(run);
  const notice = verificationNoticeFor(run);
  // The structured content stays exactly the persisted run: it is the source of truth outcome
  // claims are checked against, so a derived signal must never ride inside it. The notice goes
  // out as an extra content block, mirroring complete_skill_run's text surfacing.
  return notice === undefined
    ? result
    : { ...result, content: [...result.content, { type: "text" as const, text: skillRunNoticeText[notice] }] };
};

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
    ...mcpToolEffects.runStateWrite,
    name: "start_skill_run",
    title: "Start Skill Run",
    description: "Low-level compatibility path for preparing and persisting a skill run from project signals, intent, and domain policy. Use prepare_task for authoritative routing and content delivery.",
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
        strict: { type: "boolean" },
        skillInputs: { type: "object" },
        hostCapabilities: { type: "array", items: { type: "string" } },
      },
      required: ["targetAgent", "domain", "intent"],
      additionalProperties: false,
    },
  },
  {
    ...mcpToolEffects.runStateWrite,
    name: "record_skill_read",
    title: "Record Skill Read",
    description: "Record checksum attestation for a selected skill. This does not deliver skill content and cannot establish authoritative verified provenance; use prepare_task and read_run_skill_file for that workflow.",
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
    ...mcpToolEffects.runStateWrite,
    name: "resolve_skill_run_clarifications",
    title: "Resolve Skill Run Clarifications",
    description: "Resolve runtime clarifications only after every mandatory router read completes. Use the runtime run ID, not the router run ID; provide an answer or an allowed explicit assumption for every required field.",
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
    ...mcpToolEffects.runStateWrite,
    name: "begin_skill_run_execution",
    title: "Begin Skill Run Execution",
    description: "Lifecycle-v1 only. Transition a lifecycle-v1 runtime run into execution after every mandatory router read and any runtime clarification have completed. A strict-v2 run is rejected; use begin_skill_step instead.",
    inputSchema: {
      type: "object",
      properties: runIdProperties,
      required: ["runId"],
      additionalProperties: false,
    },
  },
  {
    ...mcpToolEffects.runStateWrite,
    name: "complete_skill_run",
    title: "Complete Skill Run",
    description: "Lifecycle-v1 only. Complete execution with a lifecycle status and JSON-native artifacts. When the run's policy has verificationRequired, verify_skill_run is mandatory: a run closed as implemented without recorded verification carries the verification-required-unrecorded notice here and on inspect_skill_run until an outcome is recorded, and a run closed without recorded verification is incomplete. Name outcomes only from the persisted run via inspect_skill_run. A strict-v2 run is rejected; use complete_skill_step and finalize_skill_run instead.",
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
    ...mcpToolEffects.runStateAndContainedWrite,
    name: "verify_skill_run",
    title: "Verify Skill Run",
    description: "Lifecycle-v1 only. Record a JSON-native verification report for an implemented lifecycle-v1 run. Mandatory when the run's policy has verificationRequired: record any allowed outcome, including implemented-unverified, or report the run as incomplete. A verified outcome requires real project-contained evidence, mandatory skill content delivered by the SkillRanger router, and satisfied always-on guidance output contracts: the report's universalContracts section must supply every required field declared by the run's core (universal) skills or verification is blocked. reportPath must stay inside the project root; the server writes the canonical report file there on success and a verification-blocked status record on block, so never author report outcome files yourself. A strict-v2 run is rejected; use verify_skill instead.",
    inputSchema: {
      type: "object",
      properties: {
        ...runIdProperties,
        reportPath: { type: "string", description: "Project-contained path the server writes the canonical verification report (or blocked status record) to." },
        report: {
          ...verificationReportInputSchema,
          description: "Verification report matching the published shape. Per-run required universalContracts fields come from policy.artifacts.coreOutputContracts on inspect_skill_run. On invalid form, the error carries every problem in details.problems; on unsatisfied contracts, details.requiredContractFields.",
        },
      },
      required: ["runId", "reportPath", "report"],
      additionalProperties: false,
    },
  },
  {
    ...mcpToolEffects.readOnly,
    name: "inspect_skill_run",
    title: "Inspect Skill Run",
    description: "Read the current persisted skill run state. Accepts both lifecycle-v1 and strict-v2 runs. The structured content is exactly the persisted run; when a lifecycle-v1 run requires verification and none is recorded, the response content also carries the verification-required-unrecorded notice.",
    inputSchema: {
      type: "object",
      properties: runIdProperties,
      required: ["runId"],
      additionalProperties: false,
    },
  },
  // This family is the only path that can certify a strict run, so each description states what the
  // tool does and where it sits in the sequence. A generated "<Title> for a strict v2 run." left the
  // certifying path indistinguishable from boilerplate in a tools/list a host model has to choose from.
  ...[
    ["read_next_skill_chunk", "Read Next Skill Chunk", { skillId: { type: "string" } }, ["skillId"],
      "Deliver the next mandatory chunk of one selected skill in a strict v2 run. Call it repeatedly until the skill reports no remaining chunks; a skill that is not fully delivered cannot be stepped or verified."],
    ["begin_skill_step", "Begin Skill Step", { skillId: { type: "string" }, stepId: { type: "string" } }, ["skillId", "stepId"],
      "Open one declared step of a delivered skill in a strict v2 run. Exactly one step at a time carries evidence, and the step must be opened before add_skill_evidence accepts anything for it."],
    ["add_skill_evidence", "Add Skill Evidence", {
      skillId: { type: "string" }, stepId: { type: "string" }, sourcePath: { type: "string" }, kind: { type: "string" },
      validatedAs: { type: "string", description: "Inferred from kind for the artifacts verification looks up by validatedAs: critic-report is validated as a CriticReportV2, and skill-output against the skill output schema. Sending this field for those kinds is optional; sending a conflicting value is rejected." },
      relation: { type: "string", enum: ["produced", "informed", "verified"] },
      ruleIds: { type: "array", items: { type: "string" } },
    }, ["skillId", "stepId", "sourcePath", "kind", "ruleIds"],
      "Attach one attributed, project-contained evidence artifact to the open strict v2 step, naming the rule ids it satisfies. Evidence is what verify_skill checks; a step without it cannot support a verified run."],
    ["complete_skill_step", "Complete Skill Step", { skillId: { type: "string" }, stepId: { type: "string" } }, ["skillId", "stepId"],
      "Close the open strict v2 step once its evidence is attached. Every declared step of a skill must be closed before that skill can be verified."],
    ["verify_skill", "Verify Skill", { skillId: { type: "string" } }, ["skillId"],
      "Verify one skill of a strict v2 run against its declared steps, attached evidence, and output schema. A failed verification leaves the run unverified: report the failed state rather than describing the work as done."],
    ["finalize_skill_run", "Finalize Skill Run", {}, [],
      "Finalize a strict v2 run after every selected skill is verified. This is the only call that can produce a certifying result. A run-blocked error means no verified result exists: report its userMessage and blockedSkills verbatim and never describe the run as passed, processed, or complete."],
  ].map(([name, title, properties, required, description]) => ({
    ...mcpToolEffects.runStateWrite,
    name: name as string, title: title as string, description: description as string,
    inputSchema: { type: "object", properties: { ...runIdProperties, ...(properties as JsonObject) }, required: ["runId", ...(required as string[])], additionalProperties: false },
  })),
];

export const runToolHandlers: Record<string, McpToolHandler> = {
  start_skill_run: withSkillRunErrors(startRun),
  record_skill_read: withSkillRunErrors(recordRead),
  resolve_skill_run_clarifications: withSkillRunErrors(resolveClarifications),
  begin_skill_run_execution: withSkillRunErrors(beginExecution),
  complete_skill_run: withSkillRunErrors(completeRun),
  verify_skill_run: withSkillRunErrors(verifyRun),
  inspect_skill_run: withSkillRunErrors(inspectRun),
  read_next_skill_chunk: withSkillRunErrors(readNextChunk),
  begin_skill_step: withSkillRunErrors(beginStep),
  add_skill_evidence: withSkillRunErrors(addEvidence),
  complete_skill_step: withSkillRunErrors(completeStep),
  verify_skill: withSkillRunErrors(verifyStrict),
  finalize_skill_run: withSkillRunErrors(finalizeStrict),
};

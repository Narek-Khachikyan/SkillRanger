import { readFile } from "node:fs/promises";
import path from "node:path";
import { startPreparedSkillRun } from "../runs/start.ts";
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
} from "../runtime/skill-run/index.ts";
import type { VerificationReport } from "../runtime/types.ts";
import {
  StrictSkillRunError,
  StrictSkillRunStore,
  beginStrictStep,
  completeStrictStep,
  finalizeStrictRun,
  readNextStrictChunk,
  startPreparedStrictSkillRun,
  type SkillRunV2,
} from "../runtime/strict/index.ts";

export type RunCliInput = {
  command?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
  registryRoot: string;
};

const runCommands = new Set([
  "run:start",
  "run:record-read",
  "run:resolve-clarifications",
  "run:begin",
  "run:complete",
  "run:verify",
  "run:inspect",
  "run:read-next",
  "run:step:begin",
  "run:evidence:add",
  "run:step:complete",
  "run:skill:verify",
  "run:finalize",
]);

const remediationByCode: Record<SkillRunErrorCode, string> = {
  "run-not-found": "Check the run ID and project path, then retry.",
  "invalid-transition": "Inspect the run and complete the required preceding lifecycle command before retrying.",
  "mandatory-skill-unread": "Record a read for every mandatory selected skill using run:record-read.",
  "stale-skill-checksum": "Restart the run to select the current registry snapshot, then read that exact skill version.",
  "clarification-required": "Answer every required clarification, or explicitly decline allowed fields with assumptions.",
  "verification-blocked": "Resolve hard findings and provide a passed report with non-empty verification evidence.",
  "run-integrity": "Inspect the run and supplied JSON artifacts, correct the inconsistent data, then retry.",
};

const strictRemediationByCode: Record<string, string> = {
  "strict-contract-missing": "Install or select a strict-compatible skill contract, then start a new strict run.",
  "strict-skill-not-installed": "Install the exact selected skill version and checksum before starting the strict run.",
  "skill-content-unread": "Call run:read-next until every required content chunk has a receipt.",
  "step-out-of-order": "Inspect the run and execute only the next pending strict step.",
  "evidence-missing": "Add every evidence kind required by the active step before completing it.",
  "unknown-rule-id": "Use only canonical rule IDs from the snapshotted execution contract.",
  "artifact-integrity": "Provide a real project file and retry evidence ingestion.",
  "hard-gate-failed": "Complete the generated bounded repair request and submit fresh evidence.",
  "repair-limit": "Inspect the exhausted repair history and resolve the blocker in a new run.",
  "run-not-finalizable": "Finish every selected skill as used, no-op, or blocked before finalizing.",
  "run-not-found": "Check the run ID and project path, then retry.",
  "run-integrity": "Inspect the persisted run and correct the invalid or tampered input.",
};

const fail = (message: string): never => {
  throw new SkillRunError("run-integrity", message);
};

const flag = (flags: RunCliInput["flags"], name: string): string => {
  const value = flags[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new SkillRunError("run-integrity", `--${name} requires a value.`);
  }
  return value;
};

const readJson = async <T>(filePath: string, label: string): Promise<T> => {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    throw new SkillRunError(
      "run-integrity",
      `Could not read ${label} at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const parseArtifacts = (value: string | boolean | undefined): SkillRunArtifact[] => {
  if (value === undefined) return [];
  if (typeof value !== "string" || value.trim() === "") {
    throw new SkillRunError("run-integrity", "--artifacts must be a comma-separated name=path list.");
  }
  return value.split(",").map((entry) => {
    const separator = entry.indexOf("=");
    const kind = separator < 0 ? "" : entry.slice(0, separator).trim();
    const artifactPath = separator < 0 ? "" : entry.slice(separator + 1).trim();
    if (!kind || !artifactPath) fail("--artifacts must be a comma-separated name=path list.");
    return { kind, path: artifactPath, description: kind };
  });
};

type RunCommandResult = SkillRun | SkillRunV2 | { run: SkillRunV2; chunk: SkillRunV2["skillLedgers"][number]["contentChunks"][number] };

const printRun = (result: RunCommandResult, json: boolean) => {
  const run = "run" in result ? result.run : result;
  if (json) console.log(JSON.stringify({ ok: true, ...( "run" in result ? result : { run }) }, null, 2));
  else console.log(`${run.runId}: ${run.state}`);
};

const printError = (error: SkillRunError | StrictSkillRunError, json: boolean) => {
  const remediation = (remediationByCode as Record<string, string>)[error.code] ?? strictRemediationByCode[error.code] ?? strictRemediationByCode["run-integrity"];
  if (json) {
    console.error(JSON.stringify({
      ok: false,
      error: { code: error.code, message: error.message, remediation },
    }));
  } else {
    console.error(`[${error.code}] ${error.message}`);
    console.error(`Remediation: ${remediation}`);
  }
};

const executeRunCommand = async (input: RunCliInput): Promise<RunCommandResult> => {
  const command = input.command;
  if (!command) throw new SkillRunError("run-integrity", "Missing lifecycle command.");
  const projectRoot = path.resolve(input.positionals[0] ?? ".");
  const store = new SkillRunStore(projectRoot);

  if (command === "run:start") {
    const targetAgent = flag(input.flags, "target");
    const domainId = flag(input.flags, "domain");
    const intent = flag(input.flags, "intent");
    if (input.flags.strict) {
      const skillInputs = typeof input.flags.inputs === "string"
        ? await readJson<Record<string, Record<string, unknown>>>(path.resolve(input.flags.inputs), "strict inputs")
        : input.flags.inputs === undefined ? {} : fail("--inputs requires a path.");
      const hostCapabilities = typeof input.flags.capabilities === "string"
        ? input.flags.capabilities.split(",").map((value) => value.trim()).filter(Boolean)
        : input.flags.capabilities === undefined ? [] : fail("--capabilities requires a comma-separated value.");
      return startPreparedStrictSkillRun({
        projectRoot, registryRoot: input.registryRoot, targetAgent, domain: domainId, intent,
        skillInputs, hostCapabilities, storeRawIntent: Boolean(input.flags["store-intent"]),
      });
    }
    const designBrief = typeof input.flags.brief === "string"
      ? await readJson<unknown>(path.resolve(input.flags.brief), "brief")
      : input.flags.brief === undefined
        ? undefined
        : fail("--brief requires a path.");
    return startPreparedSkillRun({
      projectRoot,
      registryRoot: input.registryRoot,
      targetAgent,
      domain: domainId,
      intent,
      ...(designBrief === undefined ? {} : { artifacts: { designBrief } }),
      storeRawIntent: Boolean(input.flags["store-intent"]),
    });
  }

  const runId = flag(input.flags, "run");
  const strictStore = new StrictSkillRunStore(projectRoot);
  const persistedPath = path.join(projectRoot, ".skillranger", "runs", `${runId}.json`);
  let persisted: { schemaVersion?: string } | undefined;
  if (command === "run:inspect") {
    try { persisted = JSON.parse(await readFile(persistedPath, "utf8")) as { schemaVersion?: string }; }
    catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") throw new SkillRunError("run-not-found", `Skill run not found: ${runId}.`);
      throw new SkillRunError("run-integrity", `Could not read skill run at ${persistedPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (command === "run:inspect") return persisted?.schemaVersion === "2.0" ? strictStore.read(runId) : store.read(runId);
  if (command === "run:read-next") {
    const skillId = flag(input.flags, "skill");
    let chunk: SkillRunV2["skillLedgers"][number]["contentChunks"][number] | undefined;
    const run = await strictStore.update(runId, (current) => {
      const result = readNextStrictChunk(current, skillId);
      chunk = result.chunk;
      return result.run;
    });
    return { run, chunk: chunk! };
  }
  if (command === "run:step:begin") {
    return strictStore.update(runId, (run) => beginStrictStep(run, flag(input.flags, "skill"), flag(input.flags, "step")));
  }
  if (command === "run:step:complete") {
    return strictStore.update(runId, (run) => completeStrictStep(run, flag(input.flags, "skill"), flag(input.flags, "step")));
  }
  if (command === "run:evidence:add") {
    const skillId = flag(input.flags, "skill");
    const stepId = flag(input.flags, "step");
    const current = await strictStore.read(runId);
    const ledger = current.skillLedgers.find((candidate) => candidate.skillId === skillId);
    const step = ledger?.steps.find((candidate) => candidate.id === stepId);
    const attempt = step?.attempts.at(-1);
    if (!ledger || !step || step.status !== "active" || !attempt) throw new StrictSkillRunError("step-out-of-order", `Step ${stepId} is not active.`);
    const ruleIds = typeof input.flags.rules === "string" ? input.flags.rules.split(",").map((value) => value.trim()).filter(Boolean) : step.ruleIds;
    const validatedAs = input.flags["validated-as"];
    if (validatedAs !== undefined && validatedAs !== "input" && validatedAs !== "output" && validatedAs !== "critic-report") throw new StrictSkillRunError("artifact-integrity", "--validated-as must be input, output, or critic-report.");
    return strictStore.ingestEvidence(runId, {
      sourcePath: path.resolve(flag(input.flags, "path")), kind: flag(input.flags, "kind"),
      ...(validatedAs === undefined ? {} : { validatedAs }),
      attributions: [{ skillId, stepId, attempt: attempt.attempt, relation: "produced", ruleIds }],
    });
  }
  if (command === "run:skill:verify") {
    return strictStore.verifySkill(runId, flag(input.flags, "skill"));
  }
  if (command === "run:finalize") return strictStore.update(runId, finalizeStrictRun);
  if (command === "run:record-read") {
    const skillId = flag(input.flags, "skill");
    const run = await store.read(runId);
    const selected = run.selectedSkills.find((skill) => skill.skillId === skillId);
    if (!selected) throw new SkillRunError("run-integrity", `Skill ${skillId} is not in the selected snapshot.`);
    return recordSkillRead(store, runId, { skillId, checksum: selected.checksum });
  }
  if (command === "run:resolve-clarifications") {
    const answersPath = path.resolve(flag(input.flags, "answers"));
    const answers = await readJson<{
      answers: Array<{ questionId: string; answer: string }>;
      declinedFields: string[];
      assumptions: string[];
    }>(answersPath, "clarification answers");
    return resolveSkillRunClarifications(store, runId, answers);
  }
  if (command === "run:begin") return startSkillRunExecution(store, runId);
  if (command === "run:complete") {
    const status = flag(input.flags, "status");
    if (status !== "implemented" && status !== "failed" && status !== "blocked") {
      throw new SkillRunError("run-integrity", "--status must be implemented, failed, or blocked.");
    }
    return completeSkillRun(store, runId, { status, artifacts: parseArtifacts(input.flags.artifacts) });
  }
  if (command === "run:verify") {
    const reportPath = path.resolve(flag(input.flags, "report"));
    const report = await readJson<VerificationReport>(reportPath, "verification report");
    return verifySkillRun(store, runId, { reportPath, report });
  }
  throw new SkillRunError("run-integrity", `Unsupported lifecycle command: ${command}`);
};

export const handleRunCliCommand = async (input: RunCliInput): Promise<boolean> => {
  if (!input.command || !runCommands.has(input.command)) return false;
  const json = Boolean(input.flags.json);
  try {
    printRun(await executeRunCommand(input), json);
  } catch (error) {
    const lifecycleError = error instanceof SkillRunError || error instanceof StrictSkillRunError
      ? error
      : new SkillRunError("run-integrity", error instanceof Error ? error.message : String(error));
    printError(lifecycleError, json);
    process.exitCode = 1;
  }
  return true;
};

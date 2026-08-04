import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FRONTEND_COMPARISON_BASELINES, sameEvalIdentityValue } from "./identity.ts";
import type {
  FrontendEvalSuite,
  FrontendTaskAssertion,
  FrontendTaskEvidence,
  FrontendTaskRunParameters,
} from "./frontend.ts";

export type BaselineKind = typeof FRONTEND_COMPARISON_BASELINES[number];

export const BASELINE_KINDS: readonly BaselineKind[] = FRONTEND_COMPARISON_BASELINES;

export type BaselineConfig = {
  kind: BaselineKind;
  skillId?: string;
  skillVersion?: string;
  skillChecksum?: string;
  model?: string;
  fixture?: string;
  parameters?: FrontendTaskRunParameters;
  context?: unknown;
  capabilities?: string[];
  timeoutMs?: number;
};

export type BaselineConfigMap = Partial<Record<BaselineKind, BaselineConfig>>;

export type RunPlanEntry = {
  taskId: string;
  bandId: string;
  prompt: string;
  baselineKind: BaselineKind;
  assertions: FrontendTaskAssertion[];
  repetition?: number;
};

export type RunPlan = {
  suiteName: string;
  repetitions: number;
  skillSlice?: string;
  entries: RunPlanEntry[];
};

export type GenerateRunPlanOptions = {
  baselines: BaselineKind[];
  filter?: string[];
  repetitions?: number;
  skillSlice?: string;
};

export type ExecuteRunPlanOptions = {
  plan: RunPlan;
  commandTemplate: string;
  outputDir: string;
  projectRoot?: string;
  dryRun?: boolean;
  resume?: boolean;
  baselinesConfig: BaselineConfigMap;
  timeoutPerRunMs?: number;
  quiet?: boolean;
};

const parseCommandTemplate = (template: string): string[] => {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    if (inQuote) {
      if (c === inQuote) {
        inQuote = null;
      } else {
        current += c;
      }
    } else if (c === '"' || c === "'") {
      inQuote = c;
    } else if (c === " ") {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += c;
    }
  }
  if (inQuote) {
    throw new Error("Command template contains an unterminated quote.");
  }
  if (current) args.push(current);
  return args;
};

const safePathSegment = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const assertSafePathSegment = (value: string, label: string) => {
  if (!safePathSegment.test(value) || value === "." || value === "..") {
    throw new Error(`${label} must be a safe path segment: ${value}`);
  }
};

const requiredArtifactsFor = (entry: RunPlanEntry) => [
  ...new Set(
    entry.assertions.flatMap((assertion) =>
      typeof assertion === "string" ? [] : assertion.requiredArtifacts ?? [],
    ),
  ),
];

const runIdentityFor = (
  entry: RunPlanEntry,
  baselineMeta: BaselineConfig,
  timeoutPerRunMs: number | undefined,
) => ({
  model: baselineMeta.model ?? "(none)",
  fixture: baselineMeta.fixture ?? "(none)",
  repetition: entry.repetition ?? 1,
  parameters: baselineMeta.parameters ?? {},
  prompt: entry.prompt,
  context: baselineMeta.context ?? "",
  capabilities: [...new Set(baselineMeta.capabilities ?? [])].sort(),
  timeoutMs: baselineMeta.timeoutMs ?? timeoutPerRunMs ?? 0,
  assertions: entry.assertions
    .map((assertion) => typeof assertion === "string" ? assertion : assertion.text)
    .sort(),
});

const assertPersistedIdentity = (
  existing: Record<string, unknown>,
  identity: ReturnType<typeof runIdentityFor>,
  runId: string,
) => {
  for (const field of ["model", "fixture", "repetition", "parameters", "prompt", "context", "capabilities", "timeoutMs", "assertions"] as const) {
    if (!sameEvalIdentityValue(existing[field], identity[field])) {
      throw new Error(`Cannot resume ${runId}: persisted ${field} does not match the requested run identity.`);
    }
  }
};

const substitutePlaceholders = (
  args: string[],
  entry: RunPlanEntry,
  runDir: string,
): string[] =>
  args.map((arg) =>
    arg.replace(/\{\{taskId\}\}/g, entry.taskId)
      .replace(/\{\{baseline\}\}/g, entry.baselineKind)
      .replace(/\{\{prompt\}\}/g, entry.prompt)
      .replace(/\{\{bandId\}\}/g, entry.bandId)
      .replace(/\{\{repetition\}\}/g, String(entry.repetition ?? 1))
      .replace(/\{\{outputDir\}\}/g, runDir),
  );

const runCommand = (
  cmd: string,
  args: string[],
  cwd?: string,
  timeoutMs?: number,
): Promise<{
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}> =>
  new Promise((resolve) => {
    const startTime = Date.now();
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (exitCode, signal) => {
      resolve({ exitCode, signal, stdout, stderr, durationMs: Date.now() - startTime });
    });

    child.on("error", (err) => {
      resolve({
        exitCode: null,
        signal: null,
        stdout,
        stderr: err.message,
        durationMs: Date.now() - startTime,
      });
    });
  });

export const generateRunPlan = (
  suite: FrontendEvalSuite,
  options: GenerateRunPlanOptions,
): RunPlan => {
  const { baselines, filter } = options;
  if (baselines.length === 0) {
    throw new Error("run plan requires at least one baseline");
  }
  if (new Set(baselines).size !== baselines.length) {
    throw new Error("run plan baseline values must be unique");
  }
  const repetitions = options.repetitions ?? 1;
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error("repetitions must be a positive integer");
  }
  const slice = options.skillSlice
    ? suite.skillSlices?.find((candidate) => candidate.id === options.skillSlice || candidate.skillId === options.skillSlice)
    : undefined;
  if (options.skillSlice && !slice) throw new Error(`Skill slice not found: ${options.skillSlice}`);
  const sliceTaskIds = slice ? new Set(slice.taskIds) : undefined;
  const entries: RunPlanEntry[] = [];
  const taskBands = suite.taskBands ?? [];

  for (const band of taskBands) {
    for (const task of band.seedTasks ?? []) {
      if (sliceTaskIds && !sliceTaskIds.has(task.id)) continue;
      if (filter && filter.length > 0) {
        const matches = filter.some(
          (f) => task.id === f || task.id.includes(f),
        );
        if (!matches) continue;
      }
      for (const baselineKind of baselines) {
        for (let repetition = 1; repetition <= repetitions; repetition += 1) {
          entries.push({
            taskId: task.id,
            bandId: band.id,
            prompt: task.prompt,
            baselineKind,
            assertions: task.assertions,
            ...(repetitions > 1 ? { repetition } : {}),
          });
        }
      }
    }
  }

  return {
    suiteName: suite.name,
    repetitions,
    ...(slice ? { skillSlice: slice.id } : {}),
    entries,
  };
};

export const printRunPlan = (plan: RunPlan, baselineMeta: BaselineConfigMap): void => {
  const grouped = new Map<string, RunPlanEntry[]>();
  for (const entry of plan.entries) {
    const key = `${entry.bandId} / ${entry.taskId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(entry);
  }

  console.log(`Suite: ${plan.suiteName}`);
  console.log(`Total runs: ${plan.entries.length}`);
  console.log(`Unique tasks: ${grouped.size}`);
  console.log("");

  for (const [taskLabel, entries] of grouped) {
    console.log(`  ${taskLabel}`);
    for (const entry of entries) {
      const meta = baselineMeta[entry.baselineKind];
      const skillTag =
        meta?.skillId ? ` skill=${meta.skillId}` : "";
      console.log(
        `    baseline=${entry.baselineKind}${skillTag}` +
          (entry.repetition ? ` repetition=${entry.repetition}` : "") +
          (meta?.model ? ` model=${meta.model}` : "") +
          (meta?.fixture ? ` fixture=${meta.fixture}` : ""),
      );
    }
  }
  console.log("");
};

const readExistingRunDir = async (
  runDir: string,
): Promise<Record<string, unknown> | null> => {
  try {
    const metaPath = path.join(runDir, "task-meta.json");
    return JSON.parse(await readFile(metaPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const executeRunPlan = async (
  options: ExecuteRunPlanOptions,
): Promise<FrontendTaskEvidence> => {
  const {
    plan,
    commandTemplate,
    outputDir,
    projectRoot,
    dryRun,
    resume,
    baselinesConfig,
    timeoutPerRunMs,
    quiet,
  } = options;
  const templateArgs = parseCommandTemplate(commandTemplate);
  if (templateArgs.length === 0) {
    throw new Error("Command template must include an executable.");
  }
  const runs: FrontendTaskEvidence["runs"] = [];

  for (const entry of plan.entries) {
    assertSafePathSegment(entry.taskId, "Task id");
    assertSafePathSegment(entry.baselineKind, "Baseline");
  }

  for (const entry of plan.entries) {
    const runDir = path.resolve(
      outputDir,
      entry.taskId,
      entry.baselineKind,
      ...(entry.repetition ? [`rep-${entry.repetition}`] : []),
    );
    const resolvedOutputDir = path.resolve(outputDir);
    if (!runDir.startsWith(`${resolvedOutputDir}${path.sep}`)) {
      throw new Error(`Run output escapes output directory: ${runDir}`);
    }
    const stdoutPath = path.join(runDir, "stdout.log");
    const stderrPath = path.join(runDir, "stderr.log");

    const baselineMeta = baselinesConfig[entry.baselineKind] ?? { kind: entry.baselineKind };
    const identity = runIdentityFor(entry, baselineMeta, timeoutPerRunMs);
    const runId = `${entry.taskId}-${entry.baselineKind}${entry.repetition ? `-rep-${entry.repetition}` : ""}`;

    if (resume && !dryRun) {
      const existing = await readExistingRunDir(runDir);
      if (existing !== null) {
        assertPersistedIdentity(existing, identity, runId);
        runs.push({
          runId,
          taskId: entry.taskId,
          baseline: entry.baselineKind,
          repetition: identity.repetition,
          skillId: baselineMeta.skillId ?? "(none)",
          skillVersion: baselineMeta.skillVersion ?? "(none)",
          skillChecksum: baselineMeta.skillChecksum ?? "(none)",
          model: identity.model,
          fixture: identity.fixture,
          parameters: identity.parameters,
          prompt: identity.prompt,
          context: identity.context,
          capabilities: identity.capabilities,
          timeoutMs: identity.timeoutMs,
          command: substitutePlaceholders(templateArgs, entry, runDir).join(" "),
          durationMs: typeof existing.durationMs === "number" ? existing.durationMs : 0,
          exitCode: typeof existing.exitCode === "number" ? existing.exitCode : null,
          signal: typeof existing.signal === "string" ? existing.signal : null,
          operationalEvidence: "incomplete",
          expectedArtifacts: requiredArtifactsFor(entry),
          artifacts: [
            { name: "stdout", path: stdoutPath },
            { name: "stderr", path: stderrPath },
          ],
          assertions: entry.assertions.map((a) => ({
            text: typeof a === "string" ? a : a.text,
            status: "not-assessed" as const,
          })),
        });
        continue;
      }
    }

    if (dryRun) {
      const substituted = substitutePlaceholders(templateArgs, entry, runDir);
      const cmdLine = substituted.join(" ");
      if (!quiet) {
        console.log(`[dry-run] ${entry.taskId} / ${entry.baselineKind}: ${cmdLine}`);
      }
      runs.push({
        runId,
        taskId: entry.taskId,
        baseline: entry.baselineKind,
        repetition: identity.repetition,
        skillId: baselineMeta.skillId ?? "(none)",
        skillVersion: baselineMeta.skillVersion ?? "(none)",
        skillChecksum: baselineMeta.skillChecksum ?? "(none)",
        model: identity.model,
        fixture: identity.fixture,
        parameters: identity.parameters,
        prompt: identity.prompt,
        context: identity.context,
        capabilities: identity.capabilities,
        timeoutMs: identity.timeoutMs,
        command: substitutePlaceholders(templateArgs, entry, runDir).join(" "),
        durationMs: 0,
        exitCode: null,
        signal: null,
        operationalEvidence: "incomplete",
        expectedArtifacts: requiredArtifactsFor(entry),
        artifacts: [],
        assertions: entry.assertions.map((a) => ({
          text: typeof a === "string" ? a : a.text,
          status: "not-assessed" as const,
        })),
      });
      continue;
    }

    await mkdir(runDir, { recursive: true });

    const substituted = substitutePlaceholders(templateArgs, entry, runDir);
    const [cmd, ...args] = substituted;

    const result = await runCommand(cmd, args, projectRoot, identity.timeoutMs > 0 ? identity.timeoutMs : undefined);

    await writeFile(stdoutPath, result.stdout);
    await writeFile(stderrPath, result.stderr);

    const meta = {
      ...identity,
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      expectedArtifacts: requiredArtifactsFor(entry),
    };
    await writeFile(path.join(runDir, "task-meta.json"), JSON.stringify(meta, null, 2));

    const artifactEntries: FrontendTaskEvidence["runs"][number]["artifacts"] = [
      { name: "stdout", path: stdoutPath },
      { name: "stderr", path: stderrPath },
    ];

    runs.push({
      runId,
      taskId: entry.taskId,
      baseline: entry.baselineKind,
      repetition: identity.repetition,
      skillId: baselineMeta.skillId ?? "(none)",
      skillVersion: baselineMeta.skillVersion ?? "(none)",
      skillChecksum: baselineMeta.skillChecksum ?? "(none)",
      model: identity.model,
      fixture: identity.fixture,
      parameters: identity.parameters,
      prompt: identity.prompt,
      context: identity.context,
      capabilities: identity.capabilities,
      timeoutMs: identity.timeoutMs,
      command: substituted.join(" "),
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      signal: result.signal,
      operationalEvidence: "incomplete",
      expectedArtifacts: requiredArtifactsFor(entry),
      artifacts: artifactEntries,
      assertions: entry.assertions.map((a) => ({
        text: typeof a === "string" ? a : a.text,
        status: "not-assessed" as const,
      })),
    });
  }

  return {
    schemaVersion: "1.0",
    suiteName: plan.suiteName,
    baselines: [...new Set(plan.entries.map((entry) => entry.baselineKind))],
    ...(plan.repetitions > 1 ? { repetitions: plan.repetitions } : {}),
    ...(plan.skillSlice ? { skillSlice: plan.skillSlice } : {}),
    runs,
  };
};

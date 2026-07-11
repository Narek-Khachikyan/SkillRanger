import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDomainPack } from "../domains/registry.ts";
import { loadLocalRegistry } from "../registry/index.ts";
import { recommendSkills } from "../recommender/index.ts";
import {
  completeSkillRun,
  recordSkillRead,
  resolveSkillRunClarifications,
  SkillRunError,
  SkillRunStore,
  startSkillRun,
  startSkillRunExecution,
  verifySkillRun,
  type SkillRun,
  type SkillRunArtifact,
  type SkillRunErrorCode,
  type SkillRunLocale,
} from "../runtime/skill-run/index.ts";
import type { VerificationReport } from "../runtime/types.ts";
import { scanProject } from "../scanner/index.ts";

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

const intentLocale = (intent: string): SkillRunLocale => {
  const normalized = intent.normalize("NFKC").toLowerCase();
  const hasCyrillic = /[а-яё]/u.test(normalized);
  const hasLatin = /[a-z]/u.test(normalized);
  return hasCyrillic && hasLatin ? "mixed" : hasCyrillic ? "ru" : hasLatin ? "en" : "unknown";
};

const summarizeGoal = (domainId: string, recommendations: Array<{ skillId: string }>) =>
  `${domainId} lifecycle using ${recommendations.map(({ skillId }) => skillId).join(", ")}`;

const recommendationTarget = (target: string) => (
  ["opencode", "cursor", "gemini-cli"].includes(target) ? "generic-agent-skills" : target
);

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

const printRun = (run: SkillRun, json: boolean) => {
  if (json) console.log(JSON.stringify({ ok: true, run }, null, 2));
  else console.log(`${run.runId}: ${run.state}`);
};

const printError = (error: SkillRunError, json: boolean) => {
  const remediation = remediationByCode[error.code];
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

const executeRunCommand = async (input: RunCliInput): Promise<SkillRun> => {
  const command = input.command;
  if (!command) throw new SkillRunError("run-integrity", "Missing lifecycle command.");
  const projectRoot = path.resolve(input.positionals[0] ?? ".");
  const store = new SkillRunStore(projectRoot);

  if (command === "run:start") {
    const targetAgent = flag(input.flags, "target");
    const domainId = flag(input.flags, "domain");
    const intent = flag(input.flags, "intent");
    const domain = getDomainPack(domainId);
    if (!domain) throw new SkillRunError("run-integrity", `Domain not found: ${domainId}`);
    const designBrief = typeof input.flags.brief === "string"
      ? await readJson<unknown>(path.resolve(input.flags.brief), "brief")
      : input.flags.brief === undefined
        ? undefined
        : fail("--brief requires a path.");
    const [fingerprint, skills] = await Promise.all([
      scanProject(projectRoot),
      loadLocalRegistry(input.registryRoot),
    ]);
    const recommendations = recommendSkills(fingerprint, skills, {
      targetAgent: recommendationTarget(targetAgent),
      userIntent: intent,
      domainId,
    });
    if (recommendations.length === 0) {
      fail(`No compatible ${domainId} skills were recommended for target ${targetAgent}.`);
    }
    const policy = domain.runPolicy?.evaluate({
      intent,
      recommendations,
      ...(designBrief === undefined ? {} : { artifacts: { designBrief } }),
    }) ?? {
      lifecycleRequired: false,
      mandatorySkillIds: [],
      clarification: { required: false, questions: [] },
      verificationRequired: false,
    };
    const skillById = new Map(skills.map((skill) => [skill.manifest.id, skill]));
    const selectedSkills = recommendations.map((recommendation, index) => {
      const skill = skillById.get(recommendation.skillId);
      if (!skill) {
        throw new SkillRunError(
          "run-integrity",
          `Recommended skill is missing from the registry: ${recommendation.skillId}`,
        );
      }
      return {
        skillId: recommendation.skillId,
        role: recommendation.role ?? (index === 0 ? "primary" : "companion"),
        version: skill.manifest.version,
        checksum: skill.checksum,
        mandatory: policy.mandatorySkillIds.includes(recommendation.skillId),
      };
    });
    return startSkillRun(store, {
      runId: `run_${randomUUID()}`,
      domain: domainId,
      targetAgent,
      locale: intentLocale(intent),
      rawIntent: intent,
      normalizedGoal: summarizeGoal(domainId, recommendations),
      storeRawIntent: Boolean(input.flags["store-intent"]),
      policy,
      selectedSkills,
    });
  }

  const runId = flag(input.flags, "run");
  if (command === "run:inspect") return store.read(runId);
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
    const lifecycleError = error instanceof SkillRunError
      ? error
      : new SkillRunError("run-integrity", error instanceof Error ? error.message : String(error));
    printError(lifecycleError, json);
    process.exitCode = 1;
  }
  return true;
};

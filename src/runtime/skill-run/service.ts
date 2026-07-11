import { createHash } from "node:crypto";
import type { VerificationReport } from "../types.ts";
import { createSkillRun, reduceSkillRun } from "./reducer.ts";
import type { CreateSkillRunInput, SkillRunArtifact, SkillRunPolicyDecision, SkillRunSkill, SkillRunLocale } from "./types.ts";
import type { SkillRunStore } from "./store.ts";
import { canonicalizeVerificationReport, validateVerificationReportForRun } from "./verification.ts";

export type StartSkillRunInput = {
  runId: string;
  domain: string;
  targetAgent: string;
  locale: SkillRunLocale;
  rawIntent: string;
  normalizedGoal: string;
  storeRawIntent?: boolean;
  policy: SkillRunPolicyDecision;
  selectedSkills: SkillRunSkill[];
  now?: string;
};

export const startSkillRun = async (store: SkillRunStore, input: StartSkillRunInput) => {
  const intent: CreateSkillRunInput["intent"] = {
    sha256: `sha256:${createHash("sha256").update(input.rawIntent, "utf8").digest("hex")}`,
    normalizedGoal: input.normalizedGoal,
    ...(input.storeRawIntent ? { raw: input.rawIntent } : {}),
  };
  const created = createSkillRun({
    runId: input.runId,
    domain: input.domain,
    targetAgent: input.targetAgent,
    locale: input.locale,
    intent,
    policy: input.policy,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  await store.create(created);
  return store.update(created.runId, (run) => reduceSkillRun(run, { type: "select-skills", skills: input.selectedSkills }));
};

export const recordSkillRead = (
  store: SkillRunStore,
  runId: string,
  input: { skillId: string; checksum: string },
) => store.update(runId, (run) => reduceSkillRun(run, { type: "record-skill-read", ...input }));

export const resolveSkillRunClarifications = (
  store: SkillRunStore,
  runId: string,
  input: { answers: Array<{ questionId: string; answer: string }>; declinedFields: string[]; assumptions: string[] },
) => store.update(runId, (run) => reduceSkillRun(run, { type: "resolve-clarification", ...input }));

export const startSkillRunExecution = (store: SkillRunStore, runId: string) => (
  store.update(runId, (run) => reduceSkillRun(run, { type: "start-execution" }))
);

export const completeSkillRun = (
  store: SkillRunStore,
  runId: string,
  input: { status: "implemented" | "failed" | "blocked"; artifacts: SkillRunArtifact[] },
) => store.update(runId, (run) => reduceSkillRun(run, { type: "complete-execution", ...input }));

export const verifySkillRun = (
  store: SkillRunStore,
  runId: string,
  input: { reportPath: string; report: VerificationReport },
) => store.update(runId, (run) => {
  const report = validateVerificationReportForRun(run, input.report);
  const canonical = canonicalizeVerificationReport(report);
  const reportSha256 = `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
  return reduceSkillRun(run, { type: "record-verification", reportPath: input.reportPath, reportSha256, report });
});

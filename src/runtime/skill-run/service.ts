import { createHash } from "node:crypto";
import path from "node:path";
import type { VerificationReport } from "../types.ts";
import { createSkillRun, reduceSkillRun } from "./reducer.ts";
import { ContainedFileReadError, readContainedFile } from "../strict/contained-file.ts";
import { SkillRunError, type CreateSkillRunInput, type SkillRunArtifact, type SkillRunPolicyDecision, type SkillRunSkill, type SkillRunLocale, type VerifiedEvidenceSnapshot } from "./types.ts";
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

export const recordSkillContentDelivered = (
  store: SkillRunStore,
  runId: string,
  input: { skillId: string; checksum: string },
) => store.update(runId, (run) => reduceSkillRun(run, { type: "record-skill-read", ...input, source: "content-delivered" }));

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
) => store.update(runId, async (run) => {
  const report = validateVerificationReportForRun(run, input.report);
  let evidenceSnapshots: VerifiedEvidenceSnapshot[] | undefined;
  if (report.outcome === "verified") {
    if (report.evidence.length === 0 || report.evidence.some(({ path: evidencePath }) => !evidencePath || path.isAbsolute(evidencePath))) {
      throw new SkillRunError("verification-blocked", "Verified outcome requires readable project-contained evidence.");
    }
    const projectRoot = path.resolve(store.projectRoot);
    try {
      evidenceSnapshots = await Promise.all(report.evidence.map(async (evidence) => {
        const relativePath = evidence.path as string;
        const target = path.resolve(projectRoot, relativePath);
        const relative = path.relative(projectRoot, target);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw new Error("outside project root");
        }
        const bytes = await readContainedFile({ projectRoot, target, phase: "verification" });
        return {
          kind: evidence.kind,
          path: relativePath.split(path.sep).join("/"),
          description: evidence.description,
          byteLength: bytes.bytes.byteLength,
          sha256: `sha256:${createHash("sha256").update(bytes.bytes).digest("hex")}`,
        };
      }));
    } catch (error) {
      if (error instanceof SkillRunError) throw error;
      if (error instanceof ContainedFileReadError || error instanceof Error) {
        throw new SkillRunError("verification-blocked", "Verified outcome requires readable project-contained evidence.");
      }
      throw error;
    }
  }
  const canonical = canonicalizeVerificationReport(report);
  const reportSha256 = `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
  return reduceSkillRun(run, { type: "record-verification", reportPath: input.reportPath, reportSha256, report, evidenceSnapshots });
});

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VerificationReport } from "../types.ts";
import { createSkillRun, reduceSkillRun } from "./reducer.ts";
import { ContainedFileReadError, readContainedFile } from "../strict/contained-file.ts";
import { SkillRunError, type CreateSkillRunInput, type SkillRun, type SkillRunArtifact, type SkillRunPolicyDecision, type SkillRunSkill, type SkillRunLocale, type VerifiedEvidenceSnapshot } from "./types.ts";
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

export type SkillRunNotice = "verification-required-unrecorded";

export const skillRunNoticeText: Record<SkillRunNotice, string> = {
  "verification-required-unrecorded":
    "VERIFICATION-REQUIRED-UNRECORDED: this run's policy requires verification and none is recorded. Record it now with verify_skill_run using any allowed outcome (including implemented-unverified). A run closed without recorded verification is incomplete and must be reported as such; name outcomes only from the persisted run via inspect_skill_run.",
};

// The notice fires only while verification is both required and recordable: the run must sit in
// the implemented state (the only state record-verification accepts). A failed or blocked closure
// makes verification unreachable, so signalling there would be noise that teaches hosts to ignore it.
export const verificationNoticeFor = (run: SkillRun): SkillRunNotice | undefined => (
  run.state === "implemented" && run.policy.verificationRequired && run.verification === undefined
    ? "verification-required-unrecorded"
    : undefined
);

export const completeSkillRun = async (
  store: SkillRunStore,
  runId: string,
  input: { status: "implemented" | "failed" | "blocked"; artifacts: SkillRunArtifact[] },
): Promise<{ run: SkillRun; notices: SkillRunNotice[] }> => {
  const run = await store.update(runId, (current) => reduceSkillRun(current, { type: "complete-execution", ...input }));
  const notice = verificationNoticeFor(run);
  return { run, notices: notice === undefined ? [] : [notice] };
};

const isErrno = (error: unknown, code: string): error is NodeJS.ErrnoException => (
  error instanceof Error && "code" in error && error.code === code
);

// ADR 0008: the server is the sole author of the verification report file. reportPath must stay
// inside the project root (absolute paths are accepted only when they land inside it), and the
// write walks the existing path components to reject symlink escapes, matching the router store's
// write discipline.
const resolveReportWriteTarget = async (projectRoot: string, reportPath: string): Promise<string> => {
  const root = path.resolve(projectRoot);
  if (!reportPath || reportPath.trim() === "") {
    throw new SkillRunError("verification-blocked", "reportPath must be a non-empty project-contained path.");
  }
  const target = path.resolve(path.isAbsolute(reportPath) ? reportPath : path.join(root, reportPath));
  const relative = path.relative(root, target);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new SkillRunError("verification-blocked", "reportPath must stay inside the project root.");
  }
  const parent = path.dirname(target);
  let current = root;
  for (const segment of path.relative(root, parent).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const metadata = await lstat(current).catch((error: unknown) => {
      if (isErrno(error, "ENOENT")) return undefined;
      throw error;
    });
    if (metadata?.isSymbolicLink() || (metadata && !metadata.isDirectory())) {
      throw new SkillRunError("verification-blocked", "reportPath passes through a symbolic link or a non-directory.");
    }
  }
  return target;
};

const writeAtomicFile = async (target: string, content: string) => {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!isErrno(error, "ENOENT")) throw error;
    });
  }
};

const blockedStatusContent = (runId: string, userMessage: string) => `${JSON.stringify({
  schemaVersion: "verification-blocked/1.0",
  runId,
  blockedAt: new Date().toISOString(),
  userMessage,
}, null, 2)}\n`;

export const verifySkillRun = (
  store: SkillRunStore,
  runId: string,
  input: { reportPath: string; report: VerificationReport },
) => store.update(runId, async (run) => {
  // The reducer's record-verification transition requires an implemented run; assert it up front so
  // state errors keep their precedence over report validation and no report file is written.
  if (run.state !== "implemented") {
    throw new SkillRunError("invalid-transition", `Cannot apply record-verification while skill run is ${run.state}.`);
  }
  const projectRoot = path.resolve(store.projectRoot);
  // A reportPath that escapes the project root blocks verification; no status file can be written
  // at an unauthorized target, so the block surfaces without a file write.
  const reportTarget = await resolveReportWriteTarget(projectRoot, input.reportPath);
  try {
    const report = validateVerificationReportForRun(run, input.report);
    let evidenceSnapshots: VerifiedEvidenceSnapshot[] | undefined;
    if (report.outcome === "verified") {
      if (report.evidence.length === 0 || report.evidence.some(({ path: evidencePath }) => !evidencePath || path.isAbsolute(evidencePath))) {
        throw new SkillRunError("verification-blocked", "Verified outcome requires readable project-contained evidence.");
      }
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
    // ADR 0008: the server writes the canonical report file before recording verification, so the
    // file at reportPath is always server-authored and its digest matches the persisted reportSha256.
    await writeAtomicFile(reportTarget, `${canonical}\n`);
    return reduceSkillRun(run, { type: "record-verification", reportPath: input.reportPath, reportSha256, report, evidenceSnapshots });
  } catch (error) {
    if (error instanceof SkillRunError && error.code === "verification-blocked") {
      // The canonical status record at reportPath replaces any host-authored outcome claim.
      await writeAtomicFile(reportTarget, blockedStatusContent(runId, error.message)).catch(() => undefined);
    }
    throw error;
  }
});

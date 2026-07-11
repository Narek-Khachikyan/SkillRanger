import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { canonicalizeVerificationReport, type SkillRun } from "../src/runtime/skill-run/index.ts";
import type { VerificationReport } from "../src/runtime/types.ts";

const execFileAsync = promisify(execFile);

const runCli = async (...args: string[]) => {
  const { stdout } = await execFileAsync(process.execPath, ["src/cli/index.ts", ...args]);
  return JSON.parse(stdout) as { ok: true; run: SkillRun };
};

const passedReport = (): VerificationReport => ({
  schemaVersion: "1.0",
  domain: "frontend",
  workflowId: "frontend.design-generation",
  iteration: 0,
  capabilityStatus: "ready",
  executionStatus: "implemented",
  verificationStatus: "passed",
  outcome: "verified",
  findings: [],
  gates: { hardPassed: true, criticalFindings: 0, highFindings: 0 },
  evidence: [{
    kind: "browser-screenshot",
    path: "artifacts/desktop.png",
    description: "Desktop verification screenshot",
  }],
  residualRisks: [],
});

const writeJson = (filePath: string, value: unknown) =>
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");

const expectJsonError = async (args: string[], code: string) => {
  await assert.rejects(
    execFileAsync(process.execPath, ["src/cli/index.ts", ...args]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const stderr = (error as Error & { stderr?: string }).stderr ?? "";
      const output = JSON.parse(stderr) as {
        ok: false;
        error: { code: string; message: string; remediation: string };
      };
      assert.deepEqual(Object.keys(output), ["ok", "error"]);
      assert.equal(output.ok, false);
      assert.equal(output.error.code, code);
      assert.ok(output.error.message.length > 0);
      assert.ok(output.error.remediation.length > 0);
      return true;
    },
  );
};

test("CLI records a Russian OpenCode skill lifecycle and blocks premature verification", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-cli-run-"));
  const projectRoot = path.join(tmpRoot, "project");
  const verificationPath = path.join(tmpRoot, "verification.json");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });
  await writeJson(verificationPath, passedReport());

  const started = await runCli(
    "run:start",
    projectRoot,
    "--target",
    "opencode",
    "--domain",
    "frontend",
    "--intent",
    "Сделай редизайн лендинга и используй скиллы",
    "--json",
  );

  assert.equal(started.run.targetAgent, "opencode");
  assert.equal(started.run.locale, "ru");
  assert.equal(started.run.state, "skills-selected");
  assert.ok(started.run.selectedSkills.length > 0);
  assert.equal(started.run.intent.raw, undefined);
  assert.doesNotMatch(started.run.intent.normalizedGoal, /лендинг|скилл/u);
  await expectJsonError([
    "run:verify",
    projectRoot,
    "--run",
    started.run.runId,
    "--report",
    verificationPath,
    "--json",
  ], "invalid-transition");
});

test("CLI completes and verifies a run while storing raw intent only by opt-in", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-cli-run-success-"));
  const projectRoot = path.join(tmpRoot, "project");
  const answersPath = path.join(tmpRoot, "answers.json");
  const briefPath = path.join(tmpRoot, "brief.json");
  const verificationPath = path.join(tmpRoot, "verification.json");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  let current = (await runCli(
    "run:start",
    projectRoot,
    "--target",
    "opencode",
    "--domain",
    "frontend",
    "--intent",
    "Сделай редизайн лендинга и используй скиллы",
    "--json",
  )).run;
  assert.equal(current.intent.raw, undefined);
  assert.equal(current.clarification.status, "pending");

  for (const selected of current.selectedSkills) {
    current = (await runCli(
      "run:record-read",
      projectRoot,
      "--run",
      current.runId,
      "--skill",
      selected.skillId,
      "--json",
    )).run;
  }
  assert.equal(current.state, "skills-read");

  await writeJson(answersPath, {
    answers: current.clarification.questions.map((question) => ({
      questionId: question.id,
      answer: `Answer for ${question.id}`,
    })),
    declinedFields: [],
    assumptions: [],
  });
  current = (await runCli(
    "run:resolve-clarifications",
    projectRoot,
    "--run",
    current.runId,
    "--answers",
    answersPath,
    "--json",
  )).run;
  assert.equal(current.state, "clarified");

  current = (await runCli("run:begin", projectRoot, "--run", current.runId, "--json")).run;
  assert.equal(current.state, "running");
  current = (await runCli(
    "run:complete",
    projectRoot,
    "--run",
    current.runId,
    "--status",
    "implemented",
    "--artifacts",
    "browser-screenshot=artifacts/desktop.png,build-log=artifacts/build.log",
    "--json",
  )).run;
  assert.equal(current.state, "implemented");
  assert.deepEqual(current.artifacts.map(({ kind, path: artifactPath }) => ({ kind, path: artifactPath })), [
    { kind: "browser-screenshot", path: "artifacts/desktop.png" },
    { kind: "build-log", path: "artifacts/build.log" },
  ]);

  const report = passedReport();
  await writeJson(verificationPath, report);
  current = (await runCli(
    "run:verify",
    projectRoot,
    "--run",
    current.runId,
    "--report",
    verificationPath,
    "--json",
  )).run;
  assert.equal(current.state, "verified");
  assert.equal(
    current.verification?.reportSha256,
    `sha256:${createHash("sha256").update(canonicalizeVerificationReport(report), "utf8").digest("hex")}`,
  );
  const inspected = await runCli("run:inspect", projectRoot, "--run", current.runId, "--json");
  assert.deepEqual(inspected.run, current);

  await writeJson(briefPath, {
    schemaVersion: "1.0",
    product: {
      domain: "developer tooling",
      primaryUserOrActor: "Skill author",
      primaryTask: "Review lifecycle state",
      contentTypes: [],
      usageFrequency: "frequent",
      stakes: [],
    },
    surface: {
      type: "landing page",
      primaryAction: "Start a verified run",
      supportedViewports: [390, 1440],
      requiredStates: ["loading", "empty", "error", "success"],
    },
    direction: { requestedTone: [], antiGoals: [], existingDirection: "existing" },
    evidence: { observed: [], inferred: [], assumed: [], unknown: [] },
  });
  const optedIn = await runCli(
    "run:start",
    projectRoot,
    "--target",
    "opencode",
    "--domain",
    "frontend",
    "--intent",
    "Сделай редизайн лендинга и используй скиллы",
    "--brief",
    briefPath,
    "--store-intent",
    "--json",
  );
  assert.equal(optedIn.run.intent.raw, "Сделай редизайн лендинга и используй скиллы");
  assert.equal(optedIn.run.clarification.status, "not-required");
});

test("CLI rejects verification reports whose evidence, domain, gates, or hard findings are inconsistent", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-cli-run-reports-"));
  const projectRoot = path.join(tmpRoot, "project");
  const reportsRoot = path.join(tmpRoot, "reports");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });
  await mkdir(reportsRoot);

  let current = (await runCli(
    "run:start", projectRoot,
    "--target", "codex",
    "--domain", "frontend",
    "--intent", "Polish the existing implementation without changing the design",
    "--json",
  )).run;
  for (const selected of current.selectedSkills) {
    current = (await runCli(
      "run:record-read", projectRoot,
      "--run", current.runId,
      "--skill", selected.skillId,
      "--json",
    )).run;
  }
  if (current.clarification.status === "pending") {
    const answersPath = path.join(tmpRoot, "answers.json");
    await writeJson(answersPath, {
      answers: current.clarification.questions.map((question) => ({ questionId: question.id, answer: "Provided" })),
      declinedFields: [], assumptions: [],
    });
    current = (await runCli(
      "run:resolve-clarifications", projectRoot,
      "--run", current.runId,
      "--answers", answersPath,
      "--json",
    )).run;
  }
  current = (await runCli("run:begin", projectRoot, "--run", current.runId, "--json")).run;
  current = (await runCli(
    "run:complete", projectRoot,
    "--run", current.runId,
    "--status", "implemented",
    "--json",
  )).run;
  const persisted = JSON.parse(
    await readFile(path.join(projectRoot, ".skillranger", "runs", `${current.runId}.json`), "utf8"),
  ) as SkillRun;

  const cases: Array<{ name: string; report: VerificationReport; code: string }> = [
    { name: "empty-evidence", report: { ...passedReport(), evidence: [] }, code: "verification-blocked" },
    { name: "wrong-domain", report: { ...passedReport(), domain: "backend" }, code: "run-integrity" },
    {
      name: "gate-counts",
      report: { ...passedReport(), gates: { hardPassed: true, criticalFindings: 0, highFindings: 1 } },
      code: "run-integrity",
    },
    {
      name: "hard-finding",
      report: {
        ...passedReport(),
        findings: [{
          id: "hard",
          code: "hard",
          source: "test",
          severity: "medium",
          gate: "hard",
          message: "Hard finding",
          evidence: ["artifact"],
          remediation: "Fix it",
          autofixable: false,
        }],
      },
      code: "verification-blocked",
    },
  ];

  for (const [index, rejection] of cases.entries()) {
    const runId = `report_case_${index}`;
    await writeJson(path.join(projectRoot, ".skillranger", "runs", `${runId}.json`), { ...persisted, runId });
    const reportPath = path.join(reportsRoot, `${rejection.name}.json`);
    await writeJson(reportPath, rejection.report);
    await expectJsonError([
      "run:verify", projectRoot,
      "--run", runId,
      "--report", reportPath,
      "--json",
    ], rejection.code);
  }
});

test("CLI human lifecycle errors include the code and remediation without a stack trace", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-cli-run-human-error-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  await assert.rejects(
    execFileAsync(process.execPath, [
      "src/cli/index.ts", "run:inspect", projectRoot, "--run", "missing_run",
    ]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const stderr = (error as Error & { stderr?: string }).stderr ?? "";
      assert.match(stderr, /\[run-not-found\]/);
      assert.match(stderr, /Remediation:/);
      assert.doesNotMatch(stderr, /\n\s+at /);
      return true;
    },
  );
});

test("CLI rejects a start that has no compatible skill recommendations", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-cli-run-empty-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  await expectJsonError([
    "run:start", projectRoot,
    "--target", "unsupported-agent",
    "--domain", "frontend",
    "--intent", "Redesign the landing page",
    "--json",
  ], "run-integrity");
  await assert.rejects(
    readFile(path.join(projectRoot, ".skillranger", "runs")),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
  );
});

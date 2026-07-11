import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SkillRunStore,
  SkillRunError,
  assertValidSkillRun,
  canonicalizeVerificationReport,
  completeSkillRun,
  createSkillRun,
  recordSkillRead,
  resolveSkillRunClarifications,
  startSkillRun,
  startSkillRunExecution,
  validateVerificationReportForRun,
  verifySkillRun,
  reduceSkillRun,
  type CreateSkillRunInput,
  type SkillRun,
  type SkillRunErrorCode,
  type SkillRunEvent,
  type SkillRunSkill,
} from "../src/runtime/skill-run/index.ts";
import type { VerificationReport } from "../src/runtime/types.ts";

const visualChecksum = `sha256:${"a".repeat(64)}`;
const a11yChecksum = `sha256:${"b".repeat(64)}`;
const reportChecksum = `sha256:${"d".repeat(64)}`;
const fixtureSkills: SkillRunSkill[] = [
  { skillId: "frontend.visual-design-polish", role: "primary", version: "0.3.0", checksum: visualChecksum, mandatory: true },
  { skillId: "frontend.accessibility-review", role: "companion", version: "0.2.0", checksum: a11yChecksum, mandatory: true },
];
const fixtureInput: CreateSkillRunInput = {
  runId: "run_12345678",
  domain: "frontend",
  targetAgent: "opencode",
  locale: "ru",
  intent: { sha256: `sha256:${"c".repeat(64)}`, normalizedGoal: "редизайн лендинга" },
  policy: {
    lifecycleRequired: true,
    mandatorySkillIds: fixtureSkills.map((skill) => skill.skillId),
    clarification: { required: true, questions: [{ id: "primary-user", fields: ["primaryUserOrActor"], text: "Кто основной пользователь?", allowDecline: true }] },
    verificationRequired: true,
  },
  now: "2026-07-11T00:00:00.000Z",
};
const fixtureAnswers = [{ questionId: "primary-user", answer: "Разработчик frontend-продукта" }];
const fixtureReport: VerificationReport = {
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
  evidence: [{ kind: "browser-screenshot", path: "artifacts/desktop.png", description: "Desktop verification screenshot" }],
  residualRisks: [],
};

const toSkillsRead = () => {
  let run = reduceSkillRun(createSkillRun(fixtureInput), { type: "select-skills", skills: fixtureSkills });
  run = reduceSkillRun(run, { type: "record-skill-read", skillId: fixtureSkills[0].skillId, checksum: fixtureSkills[0].checksum });
  return reduceSkillRun(run, { type: "record-skill-read", skillId: fixtureSkills[1].skillId, checksum: fixtureSkills[1].checksum });
};

test("skill run reaches verified only through the complete lifecycle", () => {
  let run = createSkillRun(fixtureInput);
  run = reduceSkillRun(run, { type: "select-skills", skills: fixtureSkills });
  run = reduceSkillRun(run, { type: "record-skill-read", skillId: "frontend.visual-design-polish", checksum: visualChecksum });
  run = reduceSkillRun(run, { type: "record-skill-read", skillId: "frontend.accessibility-review", checksum: a11yChecksum });
  run = reduceSkillRun(run, { type: "resolve-clarification", answers: fixtureAnswers, declinedFields: [], assumptions: [] });
  run = reduceSkillRun(run, { type: "start-execution" });
  run = reduceSkillRun(run, { type: "complete-execution", status: "implemented", artifacts: [{ kind: "implementation-diff", path: "diff.patch", description: "UI diff" }] });
  run = reduceSkillRun(run, { type: "record-verification", reportPath: ".design/verification.json", reportSha256: reportChecksum, report: fixtureReport });
  assert.equal(run.state, "verified");
  assert.equal(run.revision, 0);
  assert.equal(run.verification?.reportSha256, reportChecksum);
});

test("rejects verification with unread mandatory skills", () => {
  const corruptedImplemented = { ...createSkillRun(fixtureInput), state: "implemented", selectedSkills: fixtureSkills, skillReads: [] } as SkillRun;
  assert.throws(
    () => reduceSkillRun(corruptedImplemented, { type: "record-verification", reportPath: ".design/verification.json", reportSha256: reportChecksum, report: fixtureReport }),
    (error: unknown) => error instanceof SkillRunError && error.code === "mandatory-skill-unread",
  );
});

test("createSkillRun initializes an auditable pending run", () => {
  const run = createSkillRun(fixtureInput);
  assert.equal(run.state, "created");
  assert.equal(run.revision, 0);
  assert.equal(run.createdAt, fixtureInput.now);
  assert.equal(run.updatedAt, fixtureInput.now);
  assert.equal(run.clarification.status, "pending");
  assert.deepEqual(run.recommendations, []);
  assert.deepEqual(run.selectedSkills, []);
});

test("record-skill-read is idempotent for the selected version and checksum", () => {
  let run = reduceSkillRun(createSkillRun(fixtureInput), { type: "select-skills", skills: fixtureSkills });
  run = reduceSkillRun(run, { type: "record-skill-read", skillId: fixtureSkills[0].skillId, checksum: visualChecksum });
  const repeated = reduceSkillRun(run, { type: "record-skill-read", skillId: fixtureSkills[0].skillId, checksum: visualChecksum });
  assert.equal(repeated.skillReads.length, 1);
  assert.equal(repeated.skillReads[0].version, fixtureSkills[0].version);
});

test("reaches skills-read only after every selected mandatory skill is read", () => {
  const input: CreateSkillRunInput = {
    ...fixtureInput,
    policy: { ...fixtureInput.policy, mandatorySkillIds: [] },
  };
  let run = reduceSkillRun(createSkillRun(input), { type: "select-skills", skills: fixtureSkills });
  run = reduceSkillRun(run, { type: "record-skill-read", skillId: fixtureSkills[0].skillId, checksum: visualChecksum });
  assert.equal(run.state, "skills-selected");
});

test("rejects a stale selected-skill checksum", () => {
  const selected = reduceSkillRun(createSkillRun(fixtureInput), { type: "select-skills", skills: fixtureSkills });
  assert.throws(
    () => reduceSkillRun(selected, { type: "record-skill-read", skillId: fixtureSkills[0].skillId, checksum: a11yChecksum }),
    (error: unknown) => error instanceof SkillRunError && error.code === "stale-skill-checksum",
  );
});

test("rejects selection that omits a mandatory companion", () => {
  assert.throws(
    () => reduceSkillRun(createSkillRun(fixtureInput), { type: "select-skills", skills: [fixtureSkills[0]] }),
    (error: unknown) => error instanceof SkillRunError && error.code === "mandatory-skill-unread",
  );
});

test("rejects duplicate conflicting clarification answers", () => {
  assert.throws(
    () => reduceSkillRun(toSkillsRead(), {
      type: "resolve-clarification",
      answers: [{ questionId: "primary-user", answer: "Разработчик" }, { questionId: "primary-user", answer: "Дизайнер" }],
      declinedFields: [],
      assumptions: [],
    }),
    (error: unknown) => error instanceof SkillRunError && error.code === "run-integrity",
  );
});

test("allows declined clarification only with allowed fields and one assumption per field", () => {
  const declined = reduceSkillRun(toSkillsRead(), {
    type: "resolve-clarification",
    answers: [],
    declinedFields: ["primaryUserOrActor"],
    assumptions: ["Primary user is a frontend developer"],
  });
  assert.equal(declined.state, "clarified");
  assert.equal(declined.clarification.status, "declined");
  assert.equal(reduceSkillRun(declined, { type: "start-execution" }).state, "running");
});

test("rejects declined fields without one assumption per field", () => {
  assert.throws(
    () => reduceSkillRun(toSkillsRead(), { type: "resolve-clarification", answers: [], declinedFields: ["primaryUserOrActor"], assumptions: [] }),
    (error: unknown) => error instanceof SkillRunError && error.code === "clarification-required",
  );
});

for (const [name, assumption] of [["an empty", ""], ["a whitespace-only", "   "]] as const) {
  test(`rejects declined fields with ${name} assumption`, () => {
    assert.throws(
      () => reduceSkillRun(toSkillsRead(), {
        type: "resolve-clarification",
        answers: [],
        declinedFields: ["primaryUserOrActor"],
        assumptions: [assumption],
      }),
      (error: unknown) => error instanceof SkillRunError && error.code === "clarification-required",
    );
  });
}

test("rejects decline for provenance questions", () => {
  const provenanceInput: CreateSkillRunInput = {
    ...fixtureInput,
    policy: { ...fixtureInput.policy, clarification: { required: true, questions: [{ id: "source", fields: ["sourceProvenance"], text: "What is the source?", allowDecline: false }] } },
  };
  let run = reduceSkillRun(createSkillRun(provenanceInput), { type: "select-skills", skills: fixtureSkills });
  run = reduceSkillRun(run, { type: "record-skill-read", skillId: fixtureSkills[0].skillId, checksum: visualChecksum });
  run = reduceSkillRun(run, { type: "record-skill-read", skillId: fixtureSkills[1].skillId, checksum: a11yChecksum });
  assert.throws(
    () => reduceSkillRun(run, { type: "resolve-clarification", answers: [], declinedFields: ["sourceProvenance"], assumptions: ["Unknown source"] }),
    (error: unknown) => error instanceof SkillRunError && error.code === "clarification-required",
  );
});

test("starts directly after mandatory reads when clarification is not required", () => {
  const input: CreateSkillRunInput = {
    ...fixtureInput,
    policy: { ...fixtureInput.policy, clarification: { required: false, questions: [] } },
  };
  let run = reduceSkillRun(createSkillRun(input), { type: "select-skills", skills: fixtureSkills });
  run = reduceSkillRun(run, { type: "record-skill-read", skillId: fixtureSkills[0].skillId, checksum: visualChecksum });
  run = reduceSkillRun(run, { type: "record-skill-read", skillId: fixtureSkills[1].skillId, checksum: a11yChecksum });
  assert.equal(reduceSkillRun(run, { type: "start-execution" }).state, "running");
});

const skillsReadRun = toSkillsRead();
const clarifiedRun = reduceSkillRun(skillsReadRun, { type: "resolve-clarification", answers: fixtureAnswers, declinedFields: [], assumptions: [] });
const runningRun = reduceSkillRun(clarifiedRun, { type: "start-execution" });
const invalidTransitions: Array<[string, SkillRun, SkillRunEvent, SkillRunErrorCode]> = [
  ["cannot execute before clarification", skillsReadRun, { type: "start-execution" }, "clarification-required"],
  ["cannot complete before running", clarifiedRun, { type: "complete-execution", status: "implemented", artifacts: [] }, "invalid-transition"],
  ["cannot verify before implementation", runningRun, { type: "record-verification", reportPath: "report.json", reportSha256: reportChecksum, report: fixtureReport }, "invalid-transition"],
];
for (const [name, run, event, code] of invalidTransitions) test(name, () => assert.throws(() => reduceSkillRun(run, event), (error: unknown) => error instanceof SkillRunError && error.code === code));

for (const [name, report] of [
  ["empty evidence", { ...fixtureReport, evidence: [] }],
  ["failed hard gates", { ...fixtureReport, gates: { ...fixtureReport.gates, hardPassed: false } }],
  ["remaining hard findings", { ...fixtureReport, findings: [{ id: "hard", code: "hard", source: "test", severity: "medium" as const, gate: "hard" as const, message: "Hard finding", evidence: [], remediation: "Fix", autofixable: false }] }],
] as const) {
  test(`rejects verified report with ${name}`, () => {
    const implemented = reduceSkillRun(runningRun, { type: "complete-execution", status: "implemented", artifacts: [] });
    assert.throws(
      () => reduceSkillRun(implemented, { type: "record-verification", reportPath: "report.json", reportSha256: reportChecksum, report }),
      (error: unknown) => error instanceof SkillRunError && error.code === "verification-blocked",
    );
  });
}

test("maps non-verified verification outcomes to run states", () => {
  const implemented = reduceSkillRun(runningRun, { type: "complete-execution", status: "implemented", artifacts: [] });
  for (const outcome of ["implemented-unverified", "failed", "blocked"] as const) {
    const report: VerificationReport = { ...fixtureReport, outcome, verificationStatus: outcome === "implemented-unverified" ? "partial" : "failed" };
    const result = reduceSkillRun(implemented, { type: "record-verification", reportPath: "report.json", reportSha256: reportChecksum, report });
    assert.equal(result.state, outcome);
  }
});

test("skill-run JSON schema represents the complete contract", () => {
  const schema = JSON.parse(readFileSync(new URL("../schemas/skill-run.schema.json", import.meta.url), "utf8")) as any;
  const assertRequired = (objectSchema: any, fields: string[]) => {
    assert.deepEqual(new Set(objectSchema.required), new Set(fields));
  };
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.$id, "https://skillranger.local/schemas/skill-run.schema.json");
  assert.equal(schema.additionalProperties, false);
  assertRequired(schema, [
    "schemaVersion", "runId", "domain", "targetAgent", "locale", "state", "revision", "createdAt", "updatedAt", "intent", "policy", "recommendations", "selectedSkills", "skillReads", "clarification", "artifacts",
  ]);
  assertRequired(schema.properties.intent, ["sha256", "normalizedGoal"]);
  assertRequired(schema.properties.policy, ["lifecycleRequired", "mandatorySkillIds", "clarification", "verificationRequired"]);
  assertRequired(schema.properties.policy.properties.clarification, ["required", "questions"]);
  assertRequired(schema.properties.policy.properties.clarification.properties.questions.items, ["id", "fields", "text", "allowDecline"]);
  assertRequired(schema.$defs.skill, ["skillId", "role", "version", "checksum", "mandatory"]);
  assertRequired(schema.$defs.skillRead, ["skillId", "version", "checksum", "recordedAt"]);
  assertRequired(schema.properties.clarification, ["status", "questions", "answers", "declinedFields", "assumptions"]);
  assertRequired(schema.properties.clarification.properties.answers.items, ["questionId", "answer"]);
  assertRequired(schema.properties.artifacts.items, ["kind", "description"]);
  assertRequired(schema.properties.verification, ["reportPath", "reportSha256", "report"]);
  assertRequired(schema.$defs.verificationReport, ["schemaVersion", "domain", "workflowId", "iteration", "capabilityStatus", "executionStatus", "verificationStatus", "outcome", "findings", "gates", "evidence", "residualRisks"]);
  assertRequired(schema.$defs.finding, ["id", "code", "source", "severity", "gate", "message", "evidence", "remediation", "autofixable"]);
  assertRequired(schema.$defs.verificationReport.properties.gates, ["hardPassed", "criticalFindings", "highFindings"]);
  assertRequired(schema.$defs.artifact, ["kind", "description"]);
  assert.deepEqual(new Set(schema.properties.state.enum), new Set(["created", "skills-selected", "skills-read", "clarified", "running", "implemented", "verified", "implemented-unverified", "failed", "blocked"]));
  assert.equal(schema.properties.revision.minimum, 0);
  assert.equal(schema.properties.intent.properties.sha256.pattern, "^sha256:[a-f0-9]{64}$");
  assert.equal(schema.properties.artifacts.items.additionalProperties, false);
  for (const objectSchema of [schema.properties.intent, schema.properties.policy, schema.properties.policy.properties.clarification, schema.properties.policy.properties.clarification.properties.questions.items, schema.$defs.skill, schema.$defs.skillRead, schema.properties.clarification, schema.properties.clarification.properties.answers.items, schema.properties.verification]) {
    assert.equal(objectSchema.additionalProperties, false);
  }
});

test("store writes atomically under .skillranger/runs and reloads the same run", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-run-"));
  const fixtureRun = createSkillRun(fixtureInput);
  const store = new SkillRunStore(projectRoot);
  await store.create(fixtureRun);
  assert.deepEqual(await store.read(fixtureRun.runId), fixtureRun);
  assert.equal((await readdir(path.join(projectRoot, ".skillranger/runs"))).some((name) => name.endsWith(".tmp")), false);
});

test("failed update preserves the previous valid run", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-run-"));
  const fixtureRun = createSkillRun(fixtureInput);
  const store = new SkillRunStore(projectRoot);
  await store.create(fixtureRun);
  const runId = fixtureRun.runId;
  const before = await store.read(runId);
  await assert.rejects(store.update(runId, () => { throw new SkillRunError("invalid-transition", "bad transition"); }));
  assert.deepEqual(await store.read(runId), before);
});

test("concurrent updates preserve both skill reads and monotonic revisions", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-run-"));
  const store = new SkillRunStore(projectRoot);
  let run = reduceSkillRun(createSkillRun(fixtureInput), { type: "select-skills", skills: fixtureSkills });
  await store.create(run);
  await Promise.all(fixtureSkills.map((skill) => recordSkillRead(store, run.runId, {
    skillId: skill.skillId,
    checksum: skill.checksum,
  })));
  run = await store.read(run.runId);
  assert.deepEqual(new Set(run.skillReads.map((read) => read.skillId)), new Set(fixtureSkills.map((skill) => skill.skillId)));
  assert.equal(run.revision, 2);
});

test("validates every persisted field and rejects unknown nested properties", () => {
  const valid = reduceSkillRun(createSkillRun(fixtureInput), { type: "select-skills", skills: fixtureSkills });
  assert.doesNotThrow(() => assertValidSkillRun(valid));
  assert.throws(
    () => assertValidSkillRun({ ...valid, intent: { ...valid.intent, extra: true } }),
    (error: unknown) => error instanceof SkillRunError && error.code === "run-integrity",
  );
  assert.throws(
    () => assertValidSkillRun({ ...valid, selectedSkills: [{ ...valid.selectedSkills[0], checksum: "not-a-digest" }, valid.selectedSkills[1]] }),
    (error: unknown) => error instanceof SkillRunError && error.code === "run-integrity",
  );
});

test("validates report domain, nested shapes, gate counts, and verified evidence", () => {
  const implemented = reduceSkillRun(runningRun, { type: "complete-execution", status: "implemented", artifacts: [] });
  assert.doesNotThrow(() => validateVerificationReportForRun(implemented, fixtureReport));
  for (const report of [
    { ...fixtureReport, domain: "backend" },
    { ...fixtureReport, gates: { ...fixtureReport.gates, highFindings: 1 } },
    { ...fixtureReport, findings: [{ id: "x", code: "x", source: "test", severity: "high", gate: "soft", message: "x", evidence: [], remediation: "fix", autofixable: false, extra: true }] },
  ]) {
    assert.throws(() => validateVerificationReportForRun(implemented, report), (error: unknown) => error instanceof SkillRunError);
  }
  assert.throws(
    () => validateVerificationReportForRun(implemented, { ...fixtureReport, evidence: [] }),
    (error: unknown) => error instanceof SkillRunError && error.code === "verification-blocked",
  );
});

test("canonical report serialization recursively sorts object keys and preserves arrays", () => {
  const canonical = canonicalizeVerificationReport({
    ...fixtureReport,
    evidence: [{ description: "proof", kind: "test", path: "a" }],
  });
  assert.equal(canonical.startsWith('{"capabilityStatus"'), true);
  assert.equal(canonical.includes('"evidence":[{"description":"proof","kind":"test","path":"a"}]'), true);
});

test("store-backed lifecycle hashes intent and canonical verification before persistence", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-run-"));
  const store = new SkillRunStore(projectRoot);
  let run = await startSkillRun(store, {
    runId: fixtureInput.runId,
    domain: fixtureInput.domain,
    targetAgent: fixtureInput.targetAgent,
    locale: fixtureInput.locale,
    rawIntent: " redesign the landing ",
    normalizedGoal: fixtureInput.intent.normalizedGoal,
    storeRawIntent: false,
    policy: fixtureInput.policy,
    selectedSkills: fixtureSkills,
    now: fixtureInput.now,
  });
  assert.equal(run.intent.sha256, `sha256:${createHash("sha256").update(" redesign the landing ", "utf8").digest("hex")}`);
  assert.equal(run.intent.raw, undefined);
  await Promise.all(fixtureSkills.map((skill) => recordSkillRead(store, run.runId, { skillId: skill.skillId, checksum: skill.checksum })));
  run = await resolveSkillRunClarifications(store, run.runId, { answers: fixtureAnswers, declinedFields: [], assumptions: [] });
  run = await startSkillRunExecution(store, run.runId);
  run = await completeSkillRun(store, run.runId, { status: "implemented", artifacts: [] });
  run = await verifySkillRun(store, run.runId, { reportPath: "report.json", report: fixtureReport });
  assert.equal(run.state, "verified");
  assert.equal(run.verification?.reportSha256, `sha256:${createHash("sha256").update(canonicalizeVerificationReport(fixtureReport), "utf8").digest("hex")}`);
  assert.deepEqual(JSON.parse(await readFile(path.join(projectRoot, ".skillranger/runs", `${run.runId}.json`), "utf8")), run);
});

test("validates verification reports before canonicalizing runtime input", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-run-"));
  const store = new SkillRunStore(projectRoot);
  const implemented = reduceSkillRun(runningRun, { type: "complete-execution", status: "implemented", artifacts: [] });
  await store.create(implemented);
  const invalidReport = { ...fixtureReport, iteration: 0n } as unknown as VerificationReport;
  await assert.rejects(
    verifySkillRun(store, implemented.runId, { reportPath: "report.json", report: invalidReport }),
    (error: unknown) => error instanceof SkillRunError && error.code === "run-integrity",
  );
});

test("read rejects corrupted persisted runs without rewriting them", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-run-"));
  const store = new SkillRunStore(projectRoot);
  const run = createSkillRun(fixtureInput);
  await store.create(run);
  const runPath = path.join(projectRoot, ".skillranger/runs", `${run.runId}.json`);
  await writeFile(runPath, JSON.stringify({ ...run, revision: -1 }), "utf8");
  await assert.rejects(store.read(run.runId), (error: unknown) => error instanceof SkillRunError && error.code === "run-integrity");
  assert.equal(JSON.parse(await readFile(runPath, "utf8")).revision, -1);
});

test("persisted verification digest must match canonical report content", () => {
  const implemented = reduceSkillRun(runningRun, { type: "complete-execution", status: "implemented", artifacts: [] });
  const corrupted = reduceSkillRun(implemented, {
    type: "record-verification",
    reportPath: "report.json",
    reportSha256: reportChecksum,
    report: fixtureReport,
  });
  assert.throws(
    () => assertValidSkillRun(corrupted),
    (error: unknown) => error instanceof SkillRunError && error.code === "run-integrity",
  );
});

test("persisted raw intent must match its digest", () => {
  const run = createSkillRun({
    ...fixtureInput,
    intent: { ...fixtureInput.intent, raw: "different raw intent" },
  });
  assert.throws(
    () => assertValidSkillRun(run),
    (error: unknown) => error instanceof SkillRunError && error.code === "run-integrity",
  );
});

test("persisted timestamps require RFC 3339 date-time values", () => {
  assert.throws(
    () => assertValidSkillRun({ ...createSkillRun(fixtureInput), createdAt: "0" }),
    (error: unknown) => error instanceof SkillRunError && error.code === "run-integrity",
  );
});

test("stale run locks are reclaimed before updating", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-run-"));
  const store = new SkillRunStore(projectRoot);
  const run = createSkillRun(fixtureInput);
  await store.create(run);
  const lockPath = path.join(projectRoot, ".skillranger/runs", `${run.runId}.lock`);
  await writeFile(lockPath, "abandoned-owner", "utf8");
  const stale = new Date(Date.now() - 31_000);
  await utimes(lockPath, stale, stale);
  const updated = await store.update(run.runId, (current) => reduceSkillRun(current, { type: "select-skills", skills: fixtureSkills }));
  assert.equal(updated.state, "skills-selected");
  assert.equal((await readdir(path.dirname(lockPath))).includes(path.basename(lockPath)), false);
});

test("lock timeout preserves the previous run", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-run-"));
  const store = new SkillRunStore(projectRoot);
  const run = createSkillRun(fixtureInput);
  await store.create(run);
  const lockPath = path.join(projectRoot, ".skillranger/runs", `${run.runId}.lock`);
  await writeFile(lockPath, "active-owner", "utf8");
  await assert.rejects(
    store.update(run.runId, (current) => current),
    (error: unknown) => error instanceof SkillRunError && error.code === "run-integrity" && error.message === "Timed out waiting for run lock",
  );
  assert.deepEqual(await store.read(run.runId), run);
  assert.equal(await readFile(lockPath, "utf8"), "active-owner");
});

test("run ids cannot escape the runs directory", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-run-"));
  const store = new SkillRunStore(projectRoot);
  await assert.rejects(
    store.read("../../outside"),
    (error: unknown) => error instanceof SkillRunError && error.code === "run-integrity",
  );
});

import type { VerificationReport } from "../types.ts";
import {
  SkillRunError,
  type CreateSkillRunInput,
  type SkillRun,
  type SkillRunEvent,
  type SkillRunSkill,
  type SkillRunState,
} from "./types.ts";

const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

const fail = (code: ConstructorParameters<typeof SkillRunError>[0], message: string): never => {
  throw new SkillRunError(code, message);
};

const assertState = (run: SkillRun, event: SkillRunEvent["type"], allowed: SkillRunState[]) => {
  if (!allowed.includes(run.state)) {
    fail("invalid-transition", `Cannot apply ${event} while skill run is ${run.state}.`);
  }
};

const updated = <T extends Partial<SkillRun>>(run: SkillRun, changes: T): SkillRun => ({
  ...run,
  ...changes,
  updatedAt: new Date().toISOString(),
});

const selectedSkillFor = (run: SkillRun, skillId: string): SkillRunSkill => {
  const skill = run.selectedSkills.find((candidate) => candidate.skillId === skillId);
  return skill ?? fail("run-integrity", `Skill ${skillId} is not in the selected snapshot.`);
};

const hasValidRead = (run: SkillRun, skillId: string) => {
  const selected = run.selectedSkills.find((skill) => skill.skillId === skillId);
  if (!selected) return false;
  return run.skillReads.some(
    (read) => read.skillId === skillId && read.version === selected.version && read.checksum === selected.checksum,
  );
};

const mandatorySkillIds = (run: SkillRun) => new Set([
  ...run.policy.mandatorySkillIds,
  ...run.selectedSkills.filter((skill) => skill.mandatory).map((skill) => skill.skillId),
]);

const assertMandatorySkillsRead = (run: SkillRun) => {
  if ([...mandatorySkillIds(run)].some((skillId) => !hasValidRead(run, skillId))) {
    fail("mandatory-skill-unread", "Every mandatory selected skill must have a valid read record.");
  }
};

const assertCompleteReport = (report: VerificationReport) => {
  if (
    report.schemaVersion !== "1.0"
    || !report.domain
    || !report.workflowId
    || !Number.isInteger(report.iteration)
    || !Array.isArray(report.findings)
    || !report.gates
    || !Array.isArray(report.evidence)
    || !Array.isArray(report.residualRisks)
  ) {
    fail("run-integrity", "Verification report is incomplete.");
  }
};

export const createSkillRun = (input: CreateSkillRunInput): SkillRun => {
  const now = input.now ?? new Date().toISOString();
  if (!sha256Pattern.test(input.intent.sha256)) {
    fail("run-integrity", "Intent digest must be a canonical SHA-256 value.");
  }
  return {
    schemaVersion: "1.0",
    runId: input.runId,
    domain: input.domain,
    targetAgent: input.targetAgent,
    locale: input.locale,
    state: "created",
    revision: 0,
    createdAt: now,
    updatedAt: now,
    intent: input.intent,
    policy: input.policy,
    recommendations: [],
    selectedSkills: [],
    skillReads: [],
    clarification: {
      status: input.policy.clarification.required ? "pending" : "not-required",
      questions: input.policy.clarification.questions,
      answers: [],
      declinedFields: [],
      assumptions: [],
    },
    artifacts: [],
  };
};

export const reduceSkillRun = (run: SkillRun, event: SkillRunEvent): SkillRun => {
  switch (event.type) {
    case "select-skills": { // created -> skills-selected
      assertState(run, event.type, ["created"]);
      const ids = event.skills.map((skill) => skill.skillId);
      if (new Set(ids).size !== ids.length) fail("run-integrity", "Selected skill IDs must be unique.");
      if (event.skills.some((skill) => !sha256Pattern.test(skill.checksum))) {
        fail("run-integrity", "Selected skill checksums must be canonical SHA-256 values.");
      }
      if (run.policy.mandatorySkillIds.some((skillId) => !ids.includes(skillId))) {
        fail("mandatory-skill-unread", "The selected snapshot omits a mandatory skill.");
      }
      return updated(run, { state: "skills-selected", selectedSkills: [...event.skills] });
    }
    case "record-skill-read": { // skills-selected -> skills-read
      assertState(run, event.type, ["skills-selected", "skills-read"]);
      const selected = selectedSkillFor(run, event.skillId);
      if (event.checksum !== selected.checksum) {
        fail("stale-skill-checksum", `Read checksum for ${event.skillId} does not match the selected snapshot.`);
      }
      const existing = run.skillReads.find((read) => read.skillId === event.skillId);
      if (existing && (existing.version !== selected.version || existing.checksum !== event.checksum)) {
        fail("stale-skill-checksum", `Read record for ${event.skillId} conflicts with the selected snapshot.`);
      }
      const skillReads = existing ? run.skillReads : [
        ...run.skillReads,
        { skillId: selected.skillId, version: selected.version, checksum: event.checksum, recordedAt: new Date().toISOString() },
      ];
      const candidate = { ...run, skillReads };
      const allMandatoryRead = [...mandatorySkillIds(candidate)].every((skillId) => hasValidRead(candidate, skillId));
      return updated(run, { state: allMandatoryRead ? "skills-read" : "skills-selected", skillReads });
    }
    case "resolve-clarification": { // skills-read -> clarified
      assertState(run, event.type, ["skills-read"]);
      if (!run.policy.clarification.required) {
        fail("invalid-transition", "Clarification is not required for this run.");
      }
      const answerByQuestion = new Map<string, string>();
      const questionIds = new Set(run.clarification.questions.map((question) => question.id));
      for (const answer of event.answers) {
        if (!questionIds.has(answer.questionId) || !answer.answer.trim()) {
          fail("run-integrity", `Clarification answer references an unknown question or is empty: ${answer.questionId}.`);
        }
        const previous = answerByQuestion.get(answer.questionId);
        if (previous !== undefined && previous !== answer.answer) {
          fail("run-integrity", `Clarification question ${answer.questionId} has conflicting answers.`);
        }
        answerByQuestion.set(answer.questionId, answer.answer);
      }
      if (new Set(event.declinedFields).size !== event.declinedFields.length) {
        fail("run-integrity", "Declined clarification fields must be unique.");
      }
      for (const field of event.declinedFields) {
        const containing = run.clarification.questions.filter((question) => question.fields.includes(field));
        if (containing.length === 0 || containing.some((question) => !question.allowDecline)) {
          fail("clarification-required", `Clarification field ${field} cannot be declined.`);
        }
      }
      if (
        event.assumptions.length !== event.declinedFields.length
        || event.assumptions.some((assumption) => !assumption.trim())
      ) {
        fail("clarification-required", "Each declined field requires exactly one non-empty explicit assumption.");
      }
      const declined = new Set(event.declinedFields);
      const unresolved = run.clarification.questions.some(
        (question) => !answerByQuestion.has(question.id) && !question.fields.every((field) => declined.has(field)),
      );
      if (unresolved) fail("clarification-required", "Required clarification remains unresolved.");
      return updated(run, {
        state: "clarified",
        clarification: {
          ...run.clarification,
          status: event.declinedFields.length > 0 ? "declined" : "resolved",
          answers: [...event.answers],
          declinedFields: [...event.declinedFields],
          assumptions: [...event.assumptions],
        },
      });
    }
    case "start-execution": { // skills-read|clarified -> running
      assertState(run, event.type, ["skills-read", "clarified"]);
      if (run.state === "skills-read" && run.clarification.status === "pending") {
        fail("clarification-required", "Required clarification must be resolved before execution.");
      }
      const canStart = (run.state === "skills-read" && run.clarification.status === "not-required")
        || (run.state === "clarified" && run.clarification.status === "resolved")
        || (run.state === "clarified" && run.clarification.status === "declined"
          && run.clarification.assumptions.length === run.clarification.declinedFields.length);
      if (!canStart) fail("clarification-required", "Clarification decision does not permit execution.");
      assertMandatorySkillsRead(run);
      return updated(run, { state: "running" });
    }
    case "complete-execution": { // running -> implemented|failed|blocked
      assertState(run, event.type, ["running"]);
      return updated(run, { state: event.status, artifacts: [...run.artifacts, ...event.artifacts] });
    }
    case "record-verification": { // implemented -> verification outcome
      assertState(run, event.type, ["implemented"]);
      assertMandatorySkillsRead(run);
      assertCompleteReport(event.report);
      if (!sha256Pattern.test(event.reportSha256)) {
        fail("run-integrity", "Verification report digest must be a canonical SHA-256 value.");
      }
      if (
        event.report.outcome === "verified"
        && (event.report.verificationStatus !== "passed"
          || !event.report.gates.hardPassed
          || event.report.findings.some((finding) => finding.gate === "hard")
          || event.report.evidence.length === 0)
      ) {
        fail("verification-blocked", "A verified outcome requires passed verification, passed hard gates, no hard findings, and evidence.");
      }
      return updated(run, {
        state: event.report.outcome,
        verification: { reportPath: event.reportPath, reportSha256: event.reportSha256, report: event.report },
      });
    }
  }
};

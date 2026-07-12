import { createHash } from "node:crypto";
import type { VerificationFinding, VerificationReport } from "../types.ts";
import { SkillRunError, type SkillRun, type SkillRunArtifact, type SkillRunSkill } from "./types.ts";

const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const runIdPattern = /^[a-z0-9][a-z0-9_-]{7,127}$/;
const locales = new Set(["en", "ru", "mixed", "unknown"]);
const states = new Set(["created", "skills-selected", "skills-read", "clarified", "running", "implemented", "verified", "implemented-unverified", "failed", "blocked"]);
const clarificationStatuses = new Set(["not-required", "pending", "resolved", "declined"]);
const roles = new Set(["primary", "companion"]);
const severities = new Set(["critical", "high", "medium", "low", "info"]);
const gates = new Set(["hard", "soft"]);
const capabilityStatuses = new Set(["ready", "degraded", "unavailable"]);
const executionStatuses = new Set(["not-started", "running", "implemented", "failed", "blocked"]);
const verificationStatuses = new Set(["not-run", "passed", "failed", "partial"]);
const outcomes = new Set(["verified", "implemented-unverified", "failed", "blocked"]);

export const canonicalizeJson = (value: unknown): string => {
  const order = (nested: unknown): unknown => {
    if (Array.isArray(nested)) return nested.map(order);
    if (typeof nested !== "object" || nested === null) return nested;
    return Object.fromEntries(
      Object.entries(nested as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, order(child)]),
    );
  };
  return JSON.stringify(order(value));
};

const fail: (message: string) => never = (message) => {
  throw new SkillRunError("run-integrity", message);
};

const object = (input: unknown, path: string): Record<string, unknown> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) fail(`${path} must be an object.`);
  return input as Record<string, unknown>;
};

const keys = (input: unknown, required: string[], optional: string[], path: string): Record<string, unknown> => {
  const value = object(input, path);
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) fail(`${path} contains unknown property ${unknown}.`);
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (missing) fail(`${path} is missing required property ${missing}.`);
  return value;
};

const string = (input: unknown, path: string, nonEmpty = false): string => {
  if (typeof input !== "string" || (nonEmpty && input.length === 0)) fail(`${path} must be ${nonEmpty ? "a non-empty " : "a "}string.`);
  return input as string;
};

const boolean = (input: unknown, path: string): boolean => {
  if (typeof input !== "boolean") fail(`${path} must be a boolean.`);
  return input as boolean;
};

const integer = (input: unknown, path: string): number => {
  if (!Number.isInteger(input) || (input as number) < 0) fail(`${path} must be a non-negative integer.`);
  return input as number;
};

const array = (input: unknown, path: string): unknown[] => {
  if (!Array.isArray(input)) fail(`${path} must be an array.`);
  return input;
};

const enumeration = (input: unknown, allowed: Set<string>, path: string): string => {
  if (typeof input !== "string" || !allowed.has(input)) fail(`${path} has an invalid value.`);
  return input;
};

const stringArray = (input: unknown, path: string, unique = false): string[] => {
  const result = array(input, path).map((item, index) => string(item, `${path}[${index}]`));
  if (unique && new Set(result).size !== result.length) fail(`${path} must contain unique values.`);
  return result;
};

const dateTime = (input: unknown, path: string): string => {
  const value = string(input, path);
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) fail(`${path} must be a valid date-time.`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const validDay = month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  const validTime = Number(hourText) <= 23 && Number(minuteText) <= 59 && Number(secondText) <= 60;
  const validOffset = offsetHourText === undefined || (Number(offsetHourText) <= 23 && Number(offsetMinuteText) <= 59);
  if (!validDay || !validTime || !validOffset) fail(`${path} must be a valid date-time.`);
  return value;
};

const digest = (input: unknown, path: string): string => {
  const value = string(input, path);
  if (!sha256Pattern.test(value)) fail(`${path} must be a canonical SHA-256 value.`);
  return value;
};

const validateSkill = (input: unknown, path: string): SkillRunSkill => {
  const value = keys(input, ["skillId", "role", "version", "checksum", "mandatory"], [], path);
  string(value.skillId, `${path}.skillId`);
  enumeration(value.role, roles, `${path}.role`);
  string(value.version, `${path}.version`);
  digest(value.checksum, `${path}.checksum`);
  boolean(value.mandatory, `${path}.mandatory`);
  return value as SkillRunSkill;
};

const validateArtifact = (input: unknown, path: string): SkillRunArtifact => {
  const value = keys(input, ["kind", "description"], ["path"], path);
  string(value.kind, `${path}.kind`);
  string(value.description, `${path}.description`);
  if (Object.hasOwn(value, "path")) string(value.path, `${path}.path`);
  return value as SkillRunArtifact;
};

const validateFinding = (input: unknown, path: string): VerificationFinding => {
  const value = keys(input, ["id", "code", "source", "severity", "gate", "message", "evidence", "remediation", "autofixable"], ["affectedSurface"], path);
  for (const field of ["id", "code", "source", "message", "remediation"] as const) string(value[field], `${path}.${field}`);
  enumeration(value.severity, severities, `${path}.severity`);
  enumeration(value.gate, gates, `${path}.gate`);
  stringArray(value.evidence, `${path}.evidence`);
  boolean(value.autofixable, `${path}.autofixable`);
  if (Object.hasOwn(value, "affectedSurface")) string(value.affectedSurface, `${path}.affectedSurface`);
  return value as VerificationFinding;
};

export const assertValidVerificationReport: (input: unknown) => asserts input is VerificationReport = (input) => {
  const value = keys(input, ["schemaVersion", "domain", "workflowId", "iteration", "capabilityStatus", "executionStatus", "verificationStatus", "outcome", "findings", "gates", "evidence", "residualRisks"], [], "verification report");
  if (value.schemaVersion !== "1.0") fail("verification report.schemaVersion must be 1.0.");
  string(value.domain, "verification report.domain");
  string(value.workflowId, "verification report.workflowId");
  integer(value.iteration, "verification report.iteration");
  enumeration(value.capabilityStatus, capabilityStatuses, "verification report.capabilityStatus");
  enumeration(value.executionStatus, executionStatuses, "verification report.executionStatus");
  enumeration(value.verificationStatus, verificationStatuses, "verification report.verificationStatus");
  enumeration(value.outcome, outcomes, "verification report.outcome");
  array(value.findings, "verification report.findings").forEach((finding, index) => validateFinding(finding, `verification report.findings[${index}]`));
  const gateValue = keys(value.gates, ["hardPassed", "criticalFindings", "highFindings"], [], "verification report.gates");
  boolean(gateValue.hardPassed, "verification report.gates.hardPassed");
  integer(gateValue.criticalFindings, "verification report.gates.criticalFindings");
  integer(gateValue.highFindings, "verification report.gates.highFindings");
  array(value.evidence, "verification report.evidence").forEach((artifact, index) => validateArtifact(artifact, `verification report.evidence[${index}]`));
  stringArray(value.residualRisks, "verification report.residualRisks");
};

const validateReportConsistency = (run: Pick<SkillRun, "domain">, report: VerificationReport) => {
  if (report.domain !== run.domain) fail("Verification report domain does not match the skill run domain.");
  if (report.executionStatus !== "implemented") fail("Verification report execution status must be implemented.");
  const critical = report.findings.filter((finding) => finding.severity === "critical").length;
  const high = report.findings.filter((finding) => finding.severity === "high").length;
  if (report.gates.criticalFindings !== critical || report.gates.highFindings !== high) {
    fail("Verification report gate counts do not match its findings.");
  }
};

export const assertValidSkillRun: (input: unknown) => asserts input is SkillRun = (input) => {
  const value = keys(input, ["schemaVersion", "runId", "domain", "targetAgent", "locale", "state", "revision", "createdAt", "updatedAt", "intent", "policy", "recommendations", "selectedSkills", "skillReads", "clarification", "artifacts"], ["verification"], "skill run");
  if (value.schemaVersion !== "1.0") fail("skill run.schemaVersion must be 1.0.");
  const runId = string(value.runId, "skill run.runId", true);
  if (!runIdPattern.test(runId)) fail(`Invalid run id: ${runId}`);
  const domain = string(value.domain, "skill run.domain", true);
  string(value.targetAgent, "skill run.targetAgent", true);
  enumeration(value.locale, locales, "skill run.locale");
  const state = enumeration(value.state, states, "skill run.state");
  integer(value.revision, "skill run.revision");
  dateTime(value.createdAt, "skill run.createdAt");
  dateTime(value.updatedAt, "skill run.updatedAt");

  const intent = keys(value.intent, ["sha256", "normalizedGoal"], ["raw"], "skill run.intent");
  const intentSha256 = digest(intent.sha256, "skill run.intent.sha256");
  string(intent.normalizedGoal, "skill run.intent.normalizedGoal");
  if (Object.hasOwn(intent, "raw")) {
    const raw = string(intent.raw, "skill run.intent.raw");
    const expectedIntentDigest = `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
    if (intentSha256 !== expectedIntentDigest) fail("Raw intent does not match its SHA-256 digest.");
  }

  const policy = keys(value.policy, ["lifecycleRequired", "mandatorySkillIds", "clarification", "verificationRequired"], [], "skill run.policy");
  boolean(policy.lifecycleRequired, "skill run.policy.lifecycleRequired");
  const mandatoryIds = stringArray(policy.mandatorySkillIds, "skill run.policy.mandatorySkillIds", true);
  boolean(policy.verificationRequired, "skill run.policy.verificationRequired");
  const policyClarification = keys(policy.clarification, ["required", "questions"], [], "skill run.policy.clarification");
  const clarificationRequired = boolean(policyClarification.required, "skill run.policy.clarification.required");
  const validateQuestions = (inputQuestions: unknown, path: string) => array(inputQuestions, path).map((question, index) => {
    const questionPath = `${path}[${index}]`;
    const item = keys(question, ["id", "fields", "text", "allowDecline"], [], questionPath);
    string(item.id, `${questionPath}.id`);
    stringArray(item.fields, `${questionPath}.fields`, true);
    string(item.text, `${questionPath}.text`);
    boolean(item.allowDecline, `${questionPath}.allowDecline`);
    return item;
  });
  const policyQuestions = validateQuestions(policyClarification.questions, "skill run.policy.clarification.questions");
  const questionIds = policyQuestions.map((question) => question.id as string);
  if (new Set(questionIds).size !== questionIds.length) fail("Clarification question IDs must be unique.");
  if (clarificationRequired && policyQuestions.length === 0) fail("Required clarification must include questions.");

  const recommendations = array(value.recommendations, "skill run.recommendations").map((skill, index) => validateSkill(skill, `skill run.recommendations[${index}]`));
  const selected = array(value.selectedSkills, "skill run.selectedSkills").map((skill, index) => validateSkill(skill, `skill run.selectedSkills[${index}]`));
  const selectedIds = selected.map((skill) => skill.skillId);
  if (new Set(selectedIds).size !== selectedIds.length) fail("Selected skill IDs must be unique.");
  if (new Set(recommendations.map((skill) => skill.skillId)).size !== recommendations.length) fail("Recommended skill IDs must be unique.");
  if (state === "created" && selected.length > 0) fail("Created skill runs cannot contain a selected skill snapshot.");
  if (state !== "created") {
    const selectedMandatoryIds = selected.filter((skill) => skill.mandatory).map((skill) => skill.skillId);
    if (
      mandatoryIds.length !== selectedMandatoryIds.length
      || mandatoryIds.some((id) => !selectedMandatoryIds.includes(id))
    ) {
      fail("Policy mandatory skill IDs must exactly match selected mandatory skills.");
    }
  }

  const reads = array(value.skillReads, "skill run.skillReads").map((read, index) => {
    const readPath = `skill run.skillReads[${index}]`;
    const item = keys(read, ["skillId", "version", "checksum", "recordedAt"], [], readPath);
    const skillId = string(item.skillId, `${readPath}.skillId`);
    const version = string(item.version, `${readPath}.version`);
    const checksum = digest(item.checksum, `${readPath}.checksum`);
    dateTime(item.recordedAt, `${readPath}.recordedAt`);
    const skill = selected.find((candidate) => candidate.skillId === skillId);
    if (!skill || skill.version !== version || skill.checksum !== checksum) fail(`${readPath} does not match a selected skill snapshot.`);
    return item;
  });
  if (new Set(reads.map((read) => read.skillId)).size !== reads.length) fail("Skill read IDs must be unique.");
  const readIds = new Set(reads.map((read) => read.skillId));
  if (
    ["skills-read", "clarified", "running", "implemented", "verified", "implemented-unverified", "failed", "blocked"].includes(state)
    && mandatoryIds.some((id) => !readIds.has(id))
  ) {
    fail("Prepared, running, and terminal skill runs require matching reads for every mandatory skill.");
  }

  const clarification = keys(value.clarification, ["status", "questions", "answers", "declinedFields", "assumptions"], [], "skill run.clarification");
  const clarificationStatus = enumeration(clarification.status, clarificationStatuses, "skill run.clarification.status");
  const runQuestions = validateQuestions(clarification.questions, "skill run.clarification.questions");
  if (JSON.stringify(runQuestions) !== JSON.stringify(policyQuestions)) fail("Run clarification questions must match the policy questions.");
  const answers = array(clarification.answers, "skill run.clarification.answers").map((answer, index) => {
    const answerPath = `skill run.clarification.answers[${index}]`;
    const item = keys(answer, ["questionId", "answer"], [], answerPath);
    const questionId = string(item.questionId, `${answerPath}.questionId`);
    if (!questionIds.includes(questionId)) fail(`${answerPath} references an unknown question.`);
    if (!string(item.answer, `${answerPath}.answer`).trim()) fail(`${answerPath}.answer must not be blank.`);
    return item;
  });
  if (new Set(answers.map((answer) => answer.questionId)).size !== answers.length) fail("Clarification answer IDs must be unique.");
  const declinedFields = stringArray(clarification.declinedFields, "skill run.clarification.declinedFields", true);
  const assumptions = stringArray(clarification.assumptions, "skill run.clarification.assumptions");
  for (const field of declinedFields) {
    const questions = policyQuestions.filter((question) => (question.fields as string[]).includes(field));
    if (questions.length === 0 || questions.some((question) => question.allowDecline !== true)) fail(`Clarification field ${field} cannot be declined.`);
  }
  if (assumptions.length !== declinedFields.length || assumptions.some((assumption) => !assumption.trim())) fail("Each declined field requires one non-empty assumption.");
  if (!clarificationRequired && clarificationStatus !== "not-required") fail("Optional clarification must have not-required status.");
  if (!clarificationRequired && (answers.length > 0 || declinedFields.length > 0 || assumptions.length > 0)) {
    fail("Optional clarification cannot contain answer, decline, or assumption records.");
  }
  if (clarificationRequired && clarificationStatus === "not-required") fail("Required clarification cannot have not-required status.");
  if (clarificationRequired) {
    const answeredIds = new Set(answers.map((answer) => answer.questionId));
    const declined = new Set(declinedFields);
    const fullyResolved = policyQuestions.every((question) => (
      answeredIds.has(question.id as string)
      || ((question.fields as string[]).length > 0 && (question.fields as string[]).every((field) => declined.has(field)))
    ));
    if (clarificationStatus === "pending" && (answers.length > 0 || declinedFields.length > 0 || assumptions.length > 0)) {
      fail("Pending clarification cannot contain resolution records.");
    }
    if (clarificationStatus === "resolved" && (declinedFields.length > 0 || !fullyResolved)) {
      fail("Resolved clarification requires every question to be answered and no declined fields.");
    }
    if (clarificationStatus === "declined" && (declinedFields.length === 0 || !fullyResolved)) {
      fail("Declined clarification requires every unanswered question field to be permissibly declined.");
    }
    if (
      ["clarified", "running", "implemented", "verified", "implemented-unverified", "failed", "blocked"].includes(state)
      && (clarificationStatus === "pending" || !fullyResolved)
    ) {
      fail("Clarification must be fully resolved before running or reaching a terminal state.");
    }
  }

  array(value.artifacts, "skill run.artifacts").forEach((artifact, index) => validateArtifact(artifact, `skill run.artifacts[${index}]`));
  if (Object.hasOwn(value, "verification")) {
    const verification = keys(value.verification, ["reportPath", "reportSha256", "report"], [], "skill run.verification");
    string(verification.reportPath, "skill run.verification.reportPath");
    const reportSha256 = digest(verification.reportSha256, "skill run.verification.reportSha256");
    assertValidVerificationReport(verification.report);
    validateReportConsistency({ domain }, verification.report);
    const expectedDigest = `sha256:${createHash("sha256").update(canonicalizeJson(verification.report), "utf8").digest("hex")}`;
    if (reportSha256 !== expectedDigest) fail("Verification report digest does not match its canonical content.");
    if (state !== verification.report.outcome) fail("Skill run state must match its verification outcome.");
    if (verification.report.outcome === "verified" && (verification.report.verificationStatus !== "passed" || !verification.report.gates.hardPassed || verification.report.findings.some((finding) => finding.gate === "hard") || verification.report.evidence.length === 0)) {
      fail("Persisted verified report has an inconsistent verified claim.");
    }
  } else if (["verified", "implemented-unverified"].includes(state)) {
    fail("Verified terminal states require an embedded verification report.");
  }
};

export { runIdPattern };

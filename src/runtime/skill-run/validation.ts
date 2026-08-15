import { createHash } from "node:crypto";
import type { VerificationReport } from "../types.ts";
import { SkillRunError, type SkillRun, type SkillRunArtifact, type SkillRunSkill } from "./types.ts";

const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const runIdPattern = /^[a-z0-9][a-z0-9_-]{7,127}$/;
const locales = new Set(["en", "ru", "mixed", "unknown"]);
const states = new Set(["created", "skills-selected", "skills-read", "clarified", "running", "implemented", "verified", "implemented-unverified", "failed", "blocked"]);
const clarificationStatuses = new Set(["not-required", "pending", "resolved", "declined"]);
const roles = new Set(["primary", "companion"]);

// Single source of truth for the lifecycle-v1 verification report contract (ADR 0010): the
// hand-rolled validator below and the JSON Schema published through verify_skill_run's
// inputSchema (report-schema.ts) are both composed from these exported constants, so the
// enforced shape and the published shape cannot drift apart.
export const verificationReportSchemaVersion = "1.0";

export const verificationReportEnums = {
  severity: ["critical", "high", "medium", "low", "info"],
  gate: ["hard", "soft"],
  capabilityStatus: ["ready", "degraded", "unavailable"],
  executionStatus: ["not-started", "running", "implemented", "failed", "blocked"],
  verificationStatus: ["not-run", "passed", "failed", "partial"],
  outcome: ["verified", "implemented-unverified", "failed", "blocked"],
} as const;

export const verificationReportFieldSets = {
  root: {
    required: ["schemaVersion", "domain", "workflowId", "iteration", "capabilityStatus", "executionStatus", "verificationStatus", "outcome", "findings", "gates", "evidence", "residualRisks"],
    optional: ["universalContracts"],
  },
  finding: {
    required: ["id", "code", "source", "severity", "gate", "message", "evidence", "remediation", "autofixable"],
    optional: ["affectedSurface"],
  },
  artifact: {
    required: ["kind", "description"],
    optional: ["path"],
  },
  gates: {
    required: ["hardPassed", "criticalFindings", "highFindings"],
    optional: [],
  },
} as const;

const severities = new Set<string>(verificationReportEnums.severity);
const gates = new Set<string>(verificationReportEnums.gate);
const capabilityStatuses = new Set<string>(verificationReportEnums.capabilityStatus);
const executionStatuses = new Set<string>(verificationReportEnums.executionStatus);
const verificationStatuses = new Set<string>(verificationReportEnums.verificationStatus);
const outcomes = new Set<string>(verificationReportEnums.outcome);

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

// Collect-all helpers (ADR 0010): the report form is validated in one pass so a host authoring a
// report learns every violation per call, as prose and as a machine-readable problems list.
const collectObject = (input: unknown, path: string, problems: string[]): Record<string, unknown> | undefined => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    problems.push(`${path} must be an object.`);
    return undefined;
  }
  return input as Record<string, unknown>;
};

const collectKeys = (
  input: unknown,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  problems: string[],
): Record<string, unknown> | undefined => {
  const value = collectObject(input, path, problems);
  if (!value) return undefined;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) problems.push(`${path} contains unknown property ${key}.`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) problems.push(`${path} is missing required property ${key}.`);
  }
  return value;
};

const collectString = (input: unknown, path: string, problems: string[]): string | undefined => {
  if (typeof input !== "string") {
    problems.push(`${path} must be a string.`);
    return undefined;
  }
  return input;
};

const collectBoolean = (input: unknown, path: string, problems: string[]): boolean | undefined => {
  if (typeof input !== "boolean") {
    problems.push(`${path} must be a boolean.`);
    return undefined;
  }
  return input;
};

const collectInteger = (input: unknown, path: string, problems: string[]): number | undefined => {
  if (!Number.isInteger(input) || (input as number) < 0) {
    problems.push(`${path} must be a non-negative integer.`);
    return undefined;
  }
  return input as number;
};

const collectArray = (input: unknown, path: string, problems: string[]): unknown[] | undefined => {
  if (!Array.isArray(input)) {
    problems.push(`${path} must be an array.`);
    return undefined;
  }
  return input;
};

const collectEnumeration = (input: unknown, allowed: Set<string>, path: string, problems: string[]): string | undefined => {
  if (typeof input !== "string" || !allowed.has(input)) {
    problems.push(`${path} has an invalid value.`);
    return undefined;
  }
  return input;
};

const collectStringArray = (input: unknown, path: string, problems: string[]): string[] | undefined => {
  const values = collectArray(input, path, problems);
  if (!values) return undefined;
  const strings = values.map((item, index) => collectString(item, `${path}[${index}]`, problems));
  return strings.every((item) => item !== undefined) ? strings as string[] : undefined;
};

/**
 * Validates the verification report form and returns every violation in one pass.
 * Empty when the report's shape satisfies the published contract.
 */
export const collectVerificationReportProblems = (input: unknown): string[] => {
  const problems: string[] = [];
  const root = collectKeys(input, verificationReportFieldSets.root.required, verificationReportFieldSets.root.optional, "verification report", problems);
  if (!root) return problems;
  if (root.schemaVersion !== undefined && root.schemaVersion !== verificationReportSchemaVersion) problems.push(`verification report.schemaVersion must be ${verificationReportSchemaVersion}.`);
  if (root.domain !== undefined) collectString(root.domain, "verification report.domain", problems);
  if (root.workflowId !== undefined) collectString(root.workflowId, "verification report.workflowId", problems);
  if (root.iteration !== undefined) collectInteger(root.iteration, "verification report.iteration", problems);
  if (root.capabilityStatus !== undefined) collectEnumeration(root.capabilityStatus, capabilityStatuses, "verification report.capabilityStatus", problems);
  if (root.executionStatus !== undefined) collectEnumeration(root.executionStatus, executionStatuses, "verification report.executionStatus", problems);
  if (root.verificationStatus !== undefined) collectEnumeration(root.verificationStatus, verificationStatuses, "verification report.verificationStatus", problems);
  if (root.outcome !== undefined) collectEnumeration(root.outcome, outcomes, "verification report.outcome", problems);
  if (root.findings !== undefined) {
    const findings = collectArray(root.findings, "verification report.findings", problems);
    findings?.forEach((finding, index) => {
      const path = `verification report.findings[${index}]`;
      const item = collectKeys(finding, verificationReportFieldSets.finding.required, verificationReportFieldSets.finding.optional, path, problems);
      if (!item) return;
      for (const field of ["id", "code", "source", "message", "remediation"] as const) {
        if (item[field] !== undefined) collectString(item[field], `${path}.${field}`, problems);
      }
      if (item.severity !== undefined) collectEnumeration(item.severity, severities, `${path}.severity`, problems);
      if (item.gate !== undefined) collectEnumeration(item.gate, gates, `${path}.gate`, problems);
      if (item.evidence !== undefined) collectStringArray(item.evidence, `${path}.evidence`, problems);
      if (item.autofixable !== undefined) collectBoolean(item.autofixable, `${path}.autofixable`, problems);
      if (item.affectedSurface !== undefined) collectString(item.affectedSurface, `${path}.affectedSurface`, problems);
    });
  }
  if (root.gates !== undefined) {
    const gateValue = collectKeys(root.gates, verificationReportFieldSets.gates.required, verificationReportFieldSets.gates.optional, "verification report.gates", problems);
    if (gateValue) {
      if (gateValue.hardPassed !== undefined) collectBoolean(gateValue.hardPassed, "verification report.gates.hardPassed", problems);
      if (gateValue.criticalFindings !== undefined) collectInteger(gateValue.criticalFindings, "verification report.gates.criticalFindings", problems);
      if (gateValue.highFindings !== undefined) collectInteger(gateValue.highFindings, "verification report.gates.highFindings", problems);
    }
  }
  if (root.evidence !== undefined) {
    const evidence = collectArray(root.evidence, "verification report.evidence", problems);
    evidence?.forEach((artifact, index) => {
      const path = `verification report.evidence[${index}]`;
      const item = collectKeys(artifact, verificationReportFieldSets.artifact.required, verificationReportFieldSets.artifact.optional, path, problems);
      if (!item) return;
      if (item.kind !== undefined) collectString(item.kind, `${path}.kind`, problems);
      if (item.description !== undefined) collectString(item.description, `${path}.description`, problems);
      if (item.path !== undefined) collectString(item.path, `${path}.path`, problems);
    });
  }
  if (root.residualRisks !== undefined) collectStringArray(root.residualRisks, "verification report.residualRisks", problems);
  if (Object.hasOwn(root, "universalContracts")) {
    const contracts = collectObject(root.universalContracts, "verification report.universalContracts", problems);
    if (contracts) {
      for (const [skillId, section] of Object.entries(contracts)) {
        const sectionPath = `verification report.universalContracts.${skillId}`;
        const fields = collectObject(section, sectionPath, problems);
        if (!fields) continue;
        for (const [field, statements] of Object.entries(fields)) {
          const statementsPath = `${sectionPath}.${field}`;
          // Emptiness is a semantic contract failure (verification-blocked naming the field), not a
          // shape violation, so empty arrays are shape-valid here.
          const values = collectStringArray(statements, statementsPath, problems);
          if (values && values.some((statement) => statement.trim() === "")) problems.push(`${statementsPath} must not contain blank statements.`);
        }
      }
    }
  }
  return problems;
};

export const assertValidVerificationReport: (input: unknown) => asserts input is VerificationReport = (input) => {
  const problems = collectVerificationReportProblems(input);
  if (problems.length > 0) {
    throw new SkillRunError("run-integrity", problems.join(" "), { problems });
  }
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

export type UniversalOutputContracts = Record<string, string[]>;

type PolicyCarrier = { policy: { artifacts?: Record<string, unknown> } };

const universalOutputContractsOf = (run: PolicyCarrier): UniversalOutputContracts => {
  const artifacts = run.policy.artifacts;
  if (artifacts === undefined) return {};
  const declared = artifacts.coreOutputContracts;
  if (declared === undefined) return {};
  return declared as UniversalOutputContracts;
};

const validateUniversalOutputContracts = (input: unknown, path: string) => {
  const contracts = object(input, path);
  for (const [skillId, fields] of Object.entries(contracts)) {
    const fieldsPath = `${path}.${skillId}`;
    const values = stringArray(fields, fieldsPath, true);
    if (values.length === 0) fail(`${fieldsPath} must contain at least one field id.`);
    if (values.some((field) => field.trim() === "")) fail(`${fieldsPath} must not contain blank field ids.`);
  }
};

/**
 * Returns the declared contract fields a report fails to satisfy, keyed by skill.
 * Empty when the run declares no universal output contracts or the report satisfies them all.
 */
export const missingUniversalContractFields = (
  run: PolicyCarrier,
  report: VerificationReport,
): Array<{ skillId: string; fields: string[] }> => {
  const missing: Array<{ skillId: string; fields: string[] }> = [];
  for (const [skillId, fields] of Object.entries(universalOutputContractsOf(run))) {
    const section = report.universalContracts?.[skillId];
    const absent = fields.filter((field) => {
      const statements = section?.[field];
      return !Array.isArray(statements) || statements.length === 0 || statements.some((statement) => typeof statement !== "string" || statement.trim() === "");
    });
    if (absent.length > 0) missing.push({ skillId, fields: absent });
  }
  return missing;
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

  const policy = keys(value.policy, ["lifecycleRequired", "mandatorySkillIds", "clarification", "verificationRequired"], ["artifacts"], "skill run.policy");
  if (Object.hasOwn(policy, "artifacts")) {
    const artifacts = object(policy.artifacts, "skill run.policy.artifacts");
    if (Object.hasOwn(artifacts, "coreOutputContracts")) {
      validateUniversalOutputContracts(artifacts.coreOutputContracts, "skill run.policy.artifacts.coreOutputContracts");
    }
  }
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
    const item = keys(read, ["skillId", "version", "checksum", "recordedAt"], ["source"], readPath);
    const skillId = string(item.skillId, `${readPath}.skillId`);
    const version = string(item.version, `${readPath}.version`);
    const checksum = digest(item.checksum, `${readPath}.checksum`);
    dateTime(item.recordedAt, `${readPath}.recordedAt`);
    if (item.source !== undefined) enumeration(item.source, new Set(["attested", "content-delivered"]), `${readPath}.source`);
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
    const verification = keys(value.verification, ["reportPath", "reportSha256", "report"], ["evidenceSnapshots"], "skill run.verification");
    string(verification.reportPath, "skill run.verification.reportPath");
    const reportSha256 = digest(verification.reportSha256, "skill run.verification.reportSha256");
    assertValidVerificationReport(verification.report);
    if (verification.evidenceSnapshots !== undefined) {
      array(verification.evidenceSnapshots, "skill run.verification.evidenceSnapshots").forEach((snapshot, index) => {
        const item = keys(snapshot, ["kind", "path", "description", "byteLength", "sha256"], [], `skill run.verification.evidenceSnapshots[${index}]`);
        string(item.kind, `skill run.verification.evidenceSnapshots[${index}].kind`);
        string(item.path, `skill run.verification.evidenceSnapshots[${index}].path`, true);
        string(item.description, `skill run.verification.evidenceSnapshots[${index}].description`);
        integer(item.byteLength, `skill run.verification.evidenceSnapshots[${index}].byteLength`);
        digest(item.sha256, `skill run.verification.evidenceSnapshots[${index}].sha256`);
      });
    }
    validateReportConsistency({ domain }, verification.report);
    const missingContracts = missingUniversalContractFields({ policy }, verification.report);
    if (missingContracts.length > 0) {
      fail(`Persisted verification report is missing required universal output contract fields: ${missingContracts.map(({ skillId, fields }) => `${skillId}:${fields.join(",")}`).join("; ")}.`);
    }
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

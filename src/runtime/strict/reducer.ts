import { createHash } from "node:crypto";
import path from "node:path";
import { assertValidExecutionContract } from "./contract.ts";
import {
  StrictSkillRunError,
  type EvidenceArtifact,
  type SkillContentChunk,
  type SkillLedger,
  type SkillRunV2,
  type StrictSystemGateResult,
  type StrictSkillSelection,
} from "./types.ts";

const shaPattern = /^sha256:[a-f0-9]{64}$/;
const fail: (code: ConstructorParameters<typeof StrictSkillRunError>[0], message: string) => never = (code, message) => { throw new StrictSkillRunError(code, message); };
const digest = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const now = () => new Date().toISOString();
const nextRevision = (run: SkillRunV2, state = run.state): SkillRunV2 => ({ ...run, state, revision: run.revision + 1, updatedAt: now() });
const clone = <T>(value: T): T => structuredClone(value);
const ledgerFor = (run: SkillRunV2, skillId: string) => run.skillLedgers.find((ledger) => ledger.skillId === skillId) ?? fail("run-integrity", `Unknown selected skill ${skillId}.`);
const terminal = (ledger: SkillLedger) => ledger.outcome !== undefined;
const allRead = (ledger: SkillLedger) => ledger.readReceipts.length === ledger.contentChunks.length;
const safeRelative = (value: string) => value.length > 0 && !path.isAbsolute(value) && !value.replace(/\\/g, "/").split("/").includes("..");

const splitOversized = (value: string, maxBytes: number) => {
  const pieces: string[] = [];
  let current = "";
  for (const character of value) {
    if (current && Buffer.byteLength(current + character, "utf8") > maxBytes) {
      pieces.push(current);
      current = "";
    }
    current += character;
  }
  if (current) pieces.push(current);
  return pieces;
};

export const createContentChunks = (contentPath: string, content: string, maxBytes = 12 * 1024): SkillContentChunk[] => {
  if (!safeRelative(contentPath) || !Number.isInteger(maxBytes) || maxBytes < 1) fail("run-integrity", "Content chunk input is invalid.");
  const lines = content.match(/.*(?:\n|$)/gu)?.filter((line) => line.length > 0) ?? [];
  const raw: string[] = [];
  let current = "";
  const flush = () => { if (current) raw.push(current); current = ""; };
  for (const line of lines) {
    if (Buffer.byteLength(line, "utf8") > maxBytes) {
      flush();
      raw.push(...splitOversized(line, maxBytes));
    } else if (current && Buffer.byteLength(current + line, "utf8") > maxBytes) {
      flush();
      current = line;
    } else current += line;
  }
  flush();
  if (raw.length === 0) raw.push("");
  return raw.map((chunk, ordinal) => ({ path: contentPath, ordinal, total: raw.length, sha256: digest(chunk), content: chunk }));
};

export const createStrictSkillRun = (input: {
  runId: string;
  domain: string;
  targetAgent: string;
  locale: SkillRunV2["locale"];
  intent: SkillRunV2["intent"];
  selectedSkills: StrictSkillSelection[];
  recommendations?: SkillRunV2["recommendations"];
  excludedRecommendations?: SkillRunV2["excludedRecommendations"];
  now?: string;
  sourceControl?: SkillRunV2["sourceControl"];
}): SkillRunV2 => {
  if (!/^run_[a-z0-9_-]{7,127}$/.test(input.runId) || !shaPattern.test(input.intent.sha256) || input.selectedSkills.length === 0) fail("run-integrity", "Strict run input is invalid.");
  if (new Set(input.selectedSkills.map(({ skillId }) => skillId)).size !== input.selectedSkills.length) fail("run-integrity", "Selected skill ids must be unique.");
  const skillLedgers = input.selectedSkills.map((selected): SkillLedger => {
    assertValidExecutionContract(selected.contract);
    if (selected.contract.skillId !== selected.skillId || !shaPattern.test(selected.packageChecksum) || !shaPattern.test(selected.contractChecksum)) fail("run-integrity", `Invalid selected snapshot for ${selected.skillId}.`);
    for (const [index, chunk] of selected.contentChunks.entries()) {
      if (chunk.ordinal !== index || chunk.total !== selected.contentChunks.length || digest(chunk.content) !== chunk.sha256) fail("run-integrity", `Invalid content snapshot for ${selected.skillId}.`);
    }
    const outcome = !selected.applicable ? "no-op" as const : selected.unmetPrerequisites.length > 0 ? "blocked" as const : undefined;
    return {
      skillId: selected.skillId, role: selected.role, mandatory: selected.mandatory, version: selected.version,
      packageChecksum: selected.packageChecksum, contractChecksum: selected.contractChecksum, contract: clone(selected.contract),
      schemaSnapshots: clone(selected.schemaSnapshots),
      schemaChecksums: clone(selected.schemaChecksums),
      input: clone(selected.input ?? {}),
      state: outcome ?? "reading", applicability: { applicable: selected.applicable, unmetPrerequisites: [...selected.unmetPrerequisites] },
      contentChunks: clone(selected.contentChunks), readReceipts: [],
      steps: selected.contract.steps.map((step) => ({ ...clone(step), status: step.type === "repair" ? "skipped" : "pending", attempts: [] })),
      repairIterations: 0, verificationReports: [], repairRequests: [], ...(outcome === undefined ? {} : { outcome }),
    };
  });
  const timestamp = input.now ?? now();
  return {
    schemaVersion: "2.0", certification: "strict", runId: input.runId, domain: input.domain,
    targetAgent: input.targetAgent, locale: input.locale, state: skillLedgers.some((ledger) => !terminal(ledger)) ? "reading" : "planned",
    revision: 0, createdAt: timestamp, updatedAt: timestamp, intent: clone(input.intent),
    recommendations: clone(input.recommendations ?? input.selectedSkills.map(({ skillId, role }) => ({ skillId, role, strictCompatible: true }))),
    excludedRecommendations: clone(input.excludedRecommendations ?? []), skillLedgers, artifacts: [],
    sourceControl: clone(input.sourceControl ?? { mode: "non-git" }),
  };
};

export const readNextStrictChunk = (source: SkillRunV2, skillId: string, deliveredAt = now()) => {
  const run = clone(source);
  const ledger = ledgerFor(run, skillId);
  if (terminal(ledger)) fail("skill-content-unread", `Skill ${skillId} is already terminal.`);
  const chunk = ledger.contentChunks[ledger.readReceipts.length];
  if (!chunk) fail("skill-content-unread", `Every content chunk for ${skillId} is already recorded.`);
  ledger.readReceipts.push({ path: chunk.path, ordinal: chunk.ordinal, total: chunk.total, sha256: chunk.sha256, deliveredAt });
  if (allRead(ledger)) ledger.state = "ready";
  const pendingRead = run.skillLedgers.some((candidate) => !terminal(candidate) && !allRead(candidate));
  return { run: nextRevision(run, pendingRead ? "reading" : "ready"), chunk: clone(chunk) };
};

export const beginStrictStep = (source: SkillRunV2, skillId: string, stepId: string): SkillRunV2 => {
  const run = clone(source);
  const ledger = ledgerFor(run, skillId);
  if (!allRead(ledger)) fail("skill-content-unread", `Every mandatory content chunk for ${skillId} must be read.`);
  if (run.skillLedgers.some((candidate) => candidate.steps.some((step) => step.status === "active"))) fail("step-out-of-order", "Only one strict step may be active.");
  const next = ledger.steps.find((step) => step.status === "pending");
  if (!next || next.id !== stepId) fail("step-out-of-order", `Next strict step is ${next?.id ?? "none"}, not ${stepId}.`);
  next.status = "active";
  next.attempts.push({ attempt: next.attempts.length + 1, startedAt: now(), evidenceIds: [] });
  ledger.state = "running";
  return nextRevision(run, "running");
};

export const addStrictEvidence = (source: SkillRunV2, artifact: EvidenceArtifact): SkillRunV2 => {
  const run = clone(source);
  if (run.artifacts.some(({ artifactId }) => artifactId === artifact.artifactId) || !shaPattern.test(artifact.sha256) || !safeRelative(artifact.path) || !Number.isInteger(artifact.size) || artifact.size < 0 || (artifact.sourceControl.mode !== "git" && artifact.sourceControl.mode !== "non-git")) {
    fail("artifact-integrity", `Invalid or duplicate evidence artifact ${artifact.artifactId}.`);
  }
  const produced = artifact.attributions.filter(({ relation }) => relation === "produced");
  if (produced.length !== 1) fail("artifact-integrity", "Evidence requires exactly one produced attribution.");
  for (const attribution of artifact.attributions) {
    const ledger = ledgerFor(run, attribution.skillId);
    const step = ledger.steps.find(({ id }) => id === attribution.stepId) ?? fail("step-out-of-order", `Unknown attribution step ${attribution.stepId}.`);
    const attempt = step.attempts.at(-1);
    if (step.status !== "active" || !attempt || attempt.attempt !== attribution.attempt) fail("step-out-of-order", `Evidence is not attributed to the active attempt for ${step.id}.`);
    const knownRules = new Set(ledger.contract.rules.map(({ id }) => id));
    const unknown = attribution.ruleIds.find((id) => !knownRules.has(id));
    if (unknown) fail("unknown-rule-id", `Unknown canonical rule id ${unknown}.`);
  }
  run.artifacts.push(clone(artifact));
  const producer = produced[0];
  const step = ledgerFor(run, producer.skillId).steps.find(({ id }) => id === producer.stepId)!;
  step.attempts.at(-1)!.evidenceIds.push(artifact.artifactId);
  return nextRevision(run);
};

export const completeStrictStep = (source: SkillRunV2, skillId: string, stepId: string): SkillRunV2 => {
  const run = clone(source);
  const ledger = ledgerFor(run, skillId);
  const step = ledger.steps.find(({ id }) => id === stepId) ?? fail("step-out-of-order", `Unknown step ${stepId}.`);
  const attempt = step.attempts.at(-1);
  if (step.status !== "active" || !attempt) fail("step-out-of-order", `Step ${stepId} is not active.`);
  const artifacts = run.artifacts.filter(({ artifactId }) => attempt.evidenceIds.includes(artifactId));
  const missing = step.requiredEvidenceKinds.filter((kind) => !artifacts.some((artifact) => artifact.kind === kind));
  if (missing.length > 0) fail("evidence-missing", `Step ${stepId} is missing evidence: ${missing.join(", ")}.`);
  attempt.completedAt = now();
  step.status = "satisfied";
  ledger.state = "ready";
  return nextRevision(run, ledger.steps.some((candidate) => candidate.status === "pending") ? "ready" : "verifying");
};

export const verifyStrictSkill = (source: SkillRunV2, skillId: string, input: {
  artifactIntegrity: { passed: boolean; message?: string };
  validatorResults: Record<string, { passed: boolean; message?: string }>;
  systemGateResults?: StrictSystemGateResult[];
}): SkillRunV2 => {
  if (!input.artifactIntegrity.passed) {
    fail("artifact-integrity", input.artifactIntegrity.message ?? "Strict evidence integrity failed.");
  }
  const run = clone(source);
  const ledger = ledgerFor(run, skillId);
  if (ledger.steps.some((step) => step.status === "active" || step.status === "pending")) fail("step-out-of-order", `Skill ${skillId} has incomplete workflow steps.`);
  const artifactIds = new Set(ledger.steps.flatMap((step) => step.attempts.at(-1)?.evidenceIds ?? []));
  const artifacts = run.artifacts.filter(({ artifactId }) => artifactIds.has(artifactId));
  const contractGateResults = ledger.contract.gates.map((gate) => {
    let passed = false;
    let message: string | undefined;
    const evaluator = gate.evaluator;
    if (evaluator.type === "evidence-present") passed = artifacts.some(({ kind }) => kind === evaluator.evidenceKind);
    else if (evaluator.type === "schema-valid") passed = evaluator.schema === "input" ? true : artifacts.some(({ validatedAs }) => validatedAs === evaluator.schema);
    else {
      const result = input.validatorResults[gate.id] ?? input.validatorResults[evaluator.validatorId];
      passed = result?.passed === true;
      message = result?.message ?? (result ? undefined : `Validator result missing: ${evaluator.validatorId}.`);
    }
    return { gateId: gate.id, passed, level: gate.level, ...(message === undefined ? {} : { message }) };
  });
  const gateResults = [...contractGateResults, ...(input.systemGateResults ?? [])];
  const report = {
    schemaVersion: "2.0" as const, skillId, iteration: ledger.repairIterations, generatedAt: now(), gateResults,
    hardPassed: gateResults.every((gate) => gate.level !== "hard" || gate.passed), evidenceIds: [...artifactIds],
  };
  ledger.verificationReports.push(report);
  if (report.hardPassed) {
    ledger.state = "used";
    ledger.outcome = "used";
    return nextRevision(run, "verifying");
  }
  const failedGateIds = gateResults.filter((gate) => gate.level === "hard" && !gate.passed).map(({ gateId }) => gateId);
  if (ledger.repairIterations >= ledger.contract.maxRepairIterations) {
    ledger.state = "blocked";
    ledger.outcome = "blocked";
    return nextRevision(run, "blocked");
  }
  const repairIndex = ledger.steps.findIndex((step) => step.type === "repair");
  if (repairIndex < 0) fail("hard-gate-failed", `Hard gates failed without a repair step: ${failedGateIds.join(", ")}.`);
  ledger.repairIterations += 1;
  ledger.repairRequests.push({
    schemaVersion: "2.0", skillId, iteration: ledger.repairIterations, maxIterations: ledger.contract.maxRepairIterations,
    gateIds: failedGateIds, sourceReportIndex: ledger.verificationReports.length - 1,
  });
  ledger.steps.forEach((step, index) => {
    if (index === repairIndex || index > repairIndex) step.status = "pending";
  });
  ledger.state = "repair-required";
  return nextRevision(run, "repair-required");
};

export const finalizeStrictRun = (source: SkillRunV2): SkillRunV2 => {
  const run = clone(source);
  if (run.skillLedgers.some((ledger) => !terminal(ledger))) fail("run-not-finalizable", "Every selected skill must have a terminal outcome.");
  return nextRevision(run, run.skillLedgers.some(({ outcome }) => outcome === "blocked") ? "blocked" : "verified");
};

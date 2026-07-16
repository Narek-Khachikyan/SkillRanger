import { createHash } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assertValidExecutionContract } from "./contract.ts";
import { StrictSkillRunError, type ExecutionContractV2, type SkillRunV2 } from "./types.ts";
import { criticSystemGateId } from "./verification.ts";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const checksum = /^sha256:[a-f0-9]{64}$/;
const states = new Set(["planned", "reading", "ready", "running", "verifying", "repair-required", "verified", "blocked", "failed"]);
const ledgerStates = new Set(["reading", "ready", "running", "verifying", "repair-required", "used", "no-op", "blocked"]);
const safeRelative = (value: unknown) => typeof value === "string" && value.length > 0 && !path.isAbsolute(value) && !value.replace(/\\/g, "/").split("/").includes("..");
const digest = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const fail: (message: string) => never = (message) => { throw new StrictSkillRunError("run-integrity", message); };
const exactKeys = (value: Record<string, unknown>, required: string[], optional: string[], label: string) => {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) fail(`${label} contains unknown property ${unknown}.`);
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (missing) fail(`${label} is missing ${missing}.`);
};

const same = (left: unknown, right: unknown) => isDeepStrictEqual(left, right);
const expectedStepSnapshot = (step: Record<string, unknown>) => {
  const { status: _status, attempts: _attempts, ...snapshot } = step;
  return snapshot;
};

const assertAttempts = (skillId: string, step: Record<string, unknown>, artifactIds: Set<string>) => {
  const attempts = step.attempts as unknown[];
  attempts.forEach((raw, index) => {
    if (!record(raw)
      || raw.attempt !== index + 1
      || typeof raw.startedAt !== "string"
      || !Array.isArray(raw.evidenceIds)
      || !raw.evidenceIds.every((id) => typeof id === "string" && artifactIds.has(id))) {
      fail(`Invalid attempt ${index + 1} for ${skillId}/${String(step.id)}.`);
    }
    exactKeys(raw, ["attempt", "startedAt", "evidenceIds"], ["completedAt"], `attempt ${index + 1} for ${skillId}/${String(step.id)}`);
    if (raw.completedAt !== undefined && typeof raw.completedAt !== "string") {
      fail(`Invalid completion timestamp for ${skillId}/${String(step.id)}.`);
    }
  });
  const latest = attempts.at(-1);
  if (step.status === "active" && (!record(latest) || latest.completedAt !== undefined)) {
    fail(`Active step ${String(step.id)} must have an incomplete latest attempt.`);
  }
  if (step.status === "satisfied" && (!record(latest) || typeof latest.completedAt !== "string")) {
    fail(`Satisfied step ${String(step.id)} must have a completed latest attempt.`);
  }
};

const assertVerificationReports = (
  skillId: string,
  ledger: Record<string, unknown>,
  artifactIds: Set<string>,
) => {
  const contract = ledger.contract as ExecutionContractV2;
  const reports = ledger.verificationReports as unknown[];
  reports.forEach((rawReport, reportIndex) => {
    if (!record(rawReport)) fail(`Invalid verification report ${reportIndex} for ${skillId}.`);
    exactKeys(rawReport, ["schemaVersion", "skillId", "iteration", "generatedAt", "gateResults", "hardPassed", "evidenceIds"], [], `verification report ${reportIndex} for ${skillId}`);
    if (rawReport.schemaVersion !== "2.0"
      || rawReport.skillId !== skillId
      || rawReport.iteration !== reportIndex
      || typeof rawReport.generatedAt !== "string"
      || !Array.isArray(rawReport.gateResults)
      || !Array.isArray(rawReport.evidenceIds)
      || !rawReport.evidenceIds.every((id) => typeof id === "string" && artifactIds.has(id))) {
      fail(`Invalid verification report ${reportIndex} for ${skillId}.`);
    }
    const contractGateById = new Map(contract.gates.map((gate) => [gate.id, gate]));
    const gateCounts = new Map<string, number>();
    rawReport.gateResults.forEach((rawGate, gateIndex) => {
      if (!record(rawGate)) fail(`Invalid gate result ${gateIndex} in report ${reportIndex} for ${skillId}.`);
      exactKeys(rawGate, ["gateId", "passed", "level"], ["message"], `gate result ${gateIndex} in report ${reportIndex} for ${skillId}`);
      const gateId = rawGate.gateId;
      const expected = typeof gateId === "string" ? contractGateById.get(gateId) : undefined;
      const systemGate = gateId === criticSystemGateId;
      gateCounts.set(String(gateId), (gateCounts.get(String(gateId)) ?? 0) + 1);
      if ((!expected && !systemGate)
        || (expected && rawGate.level !== expected.level)
        || (systemGate && rawGate.level !== "hard")
        || typeof rawGate.passed !== "boolean"
        || (rawGate.message !== undefined && typeof rawGate.message !== "string")) {
        fail(`Gate result ${gateIndex} in report ${reportIndex} is not an allowed gate for ${skillId}.`);
      }
    });
    if (contract.gates.some(({ id }) => gateCounts.get(id) !== 1)
      || (gateCounts.get(criticSystemGateId) ?? 0) > 1) {
      fail(`Verification report ${reportIndex} for ${skillId} must contain every contract gate exactly once and each system gate at most once.`);
    }
    const hardPassed = rawReport.gateResults.every((gate) => record(gate) && (gate.level !== "hard" || gate.passed === true));
    if (rawReport.hardPassed !== hardPassed) fail(`Derived hard-gate result mismatch in report ${reportIndex} for ${skillId}.`);
  });
};

const failedHardGateIds = (report: Record<string, unknown>) => (report.gateResults as unknown[])
  .filter(record)
  .filter((gate) => gate.level === "hard" && gate.passed === false)
  .map((gate) => gate.gateId);

const assertRepairLifecycle = (skillId: string, ledger: Record<string, unknown>) => {
  const contract = ledger.contract as ExecutionContractV2;
  const repairIterations = ledger.repairIterations;
  const reports = ledger.verificationReports as Array<Record<string, unknown>>;
  const requests = ledger.repairRequests as unknown[];
  if (!Number.isInteger(repairIterations)
    || (repairIterations as number) < 0
    || (repairIterations as number) > contract.maxRepairIterations
    || reports.length < (repairIterations as number)
    || reports.length > (repairIterations as number) + 1
    || requests.length !== repairIterations) {
    fail(`Invalid repair iteration bookkeeping for ${skillId}.`);
  }
  requests.forEach((rawRequest, index) => {
    if (!record(rawRequest)) fail(`Invalid repair request ${index} for ${skillId}.`);
    exactKeys(rawRequest, ["schemaVersion", "skillId", "iteration", "maxIterations", "gateIds", "sourceReportIndex"], [], `repair request ${index} for ${skillId}`);
    const sourceReport = reports[index];
    if (rawRequest.schemaVersion !== "2.0"
      || rawRequest.skillId !== skillId
      || rawRequest.iteration !== index + 1
      || rawRequest.maxIterations !== contract.maxRepairIterations
      || rawRequest.sourceReportIndex !== index
      || !record(sourceReport)
      || sourceReport.hardPassed !== false
      || !Array.isArray(rawRequest.gateIds)
      || !same(rawRequest.gateIds, failedHardGateIds(sourceReport))) {
      fail(`Repair request ${index} is inconsistent for ${skillId}.`);
    }
  });
  const repairSteps = (ledger.steps as Array<Record<string, unknown>>).filter((step) => step.type === "repair");
  if ((repairIterations as number) === 0 && repairSteps.some((step) => step.status !== "skipped")) {
    fail(`Repair steps for ${skillId} cannot start before a failed verification.`);
  }
  if ((repairIterations as number) > 0 && repairSteps.some((step) => step.status === "skipped")) {
    fail(`Repair steps for ${skillId} must be enabled after a failed verification.`);
  }
  if (ledger.state === "repair-required" && !repairSteps.some((step) => step.status === "pending")) {
    fail(`Repair-required ledger ${skillId} lacks a pending repair step.`);
  }
};

const assertUsedLedger = (ledger: Record<string, unknown>) => {
  if (ledger.state !== "used" && ledger.outcome !== "used") return;
  const steps = ledger.steps as Array<Record<string, unknown>>;
  if (steps.some((step) => step.status === "active" || step.status === "pending")) {
    fail(`Used ledger ${String(ledger.skillId)} has unfinished workflow steps.`);
  }
  if (steps.some((step) => step.type !== "repair" && step.status !== "satisfied")) {
    fail(`Used ledger ${String(ledger.skillId)} has incomplete workflow steps.`);
  }
  const reports = ledger.verificationReports as Array<Record<string, unknown>>;
  const latest = reports.at(-1);
  if (!record(latest) || latest.hardPassed !== true) {
    fail(`Used ledger ${String(ledger.skillId)} lacks a passing verification report.`);
  }
};

const assertTerminalLifecycle = (ledger: Record<string, unknown>) => {
  const skillId = String(ledger.skillId);
  const terminalState = ledger.state === "used" || ledger.state === "no-op" || ledger.state === "blocked";
  if ((ledger.outcome === undefined) === terminalState || (terminalState && ledger.outcome !== ledger.state)) {
    fail(`Terminal state mismatch for ${skillId}.`);
  }
  const applicability = ledger.applicability as Record<string, unknown>;
  const reports = ledger.verificationReports as unknown[];
  if (ledger.outcome === "no-op" && applicability.applicable !== false) {
    fail(`No-op ledger ${skillId} must be inapplicable.`);
  }
  if (ledger.outcome !== "blocked") return;
  if (reports.length === 0) {
    if (applicability.applicable !== true || (applicability.unmetPrerequisites as unknown[]).length === 0) {
      fail(`Prerequisite-blocked ledger ${skillId} lacks unmet prerequisites.`);
    }
    return;
  }
  const contract = ledger.contract as ExecutionContractV2;
  const latest = reports.at(-1);
  const steps = ledger.steps as Array<Record<string, unknown>>;
  if (applicability.applicable !== true
    || (applicability.unmetPrerequisites as unknown[]).length !== 0
    || !record(latest)
    || latest.hardPassed !== false
    || failedHardGateIds(latest).length === 0
    || ledger.repairIterations !== contract.maxRepairIterations
    || reports.length !== contract.maxRepairIterations + 1
    || steps.some((step) => step.status !== "satisfied")) {
    fail(`Report-blocked ledger ${skillId} is inconsistent with exhausted hard-gate repair.`);
  }
};

const assertLedgerStateCoherence = (ledger: Record<string, unknown>) => {
  const skillId = String(ledger.skillId);
  const steps = ledger.steps as Array<Record<string, unknown>>;
  const activeSteps = steps.filter((step) => step.status === "active");
  const pendingRepair = steps.some((step) => step.type === "repair" && step.status === "pending");
  const allRead = (ledger.readReceipts as unknown[]).length === (ledger.contentChunks as unknown[]).length;
  if (ledger.state === "reading" && (allRead || ledger.outcome !== undefined)) {
    fail(`Reading ledger ${skillId} has no unread skill content.`);
  }
  if (ledger.state === "ready" && (!allRead || activeSteps.length !== 0 || pendingRepair || ledger.outcome !== undefined)) {
    fail(`Ready ledger ${skillId} is incompatible with its workflow state.`);
  }
  if (ledger.state === "running" && (activeSteps.length !== 1 || ledger.outcome !== undefined)) {
    fail(`Running ledger ${skillId} must own exactly one active step.`);
  }
  if (ledger.state !== "running" && activeSteps.length !== 0) {
    fail(`Active step for ${skillId} requires a running ledger.`);
  }
  if (ledger.state === "verifying" && (!allRead || ledger.outcome !== undefined
    || steps.some((step) => step.status === "active" || step.status === "pending"))) {
    fail(`Verifying ledger ${skillId} has incomplete workflow steps.`);
  }
};

const assertArtifactAttributions = (
  artifacts: Array<Record<string, unknown>>,
  ledgers: Map<string, Record<string, unknown>>,
) => {
  artifacts.forEach((artifact, artifactIndex) => {
    const attributions = artifact.attributions as unknown[];
    let producedCount = 0;
    attributions.forEach((rawAttribution) => {
      if (!record(rawAttribution)) fail(`Invalid artifact attribution at index ${artifactIndex}.`);
      exactKeys(rawAttribution, ["skillId", "stepId", "attempt", "relation", "ruleIds"], [], `artifact attribution at index ${artifactIndex}`);
      const ledger = typeof rawAttribution.skillId === "string" ? ledgers.get(rawAttribution.skillId) : undefined;
      const step = ledger && (ledger.steps as Array<Record<string, unknown>>).find((candidate) => candidate.id === rawAttribution.stepId);
      const attempt = step && (step.attempts as Array<Record<string, unknown>>).find((candidate) => candidate.attempt === rawAttribution.attempt);
      const ruleIds = ledger ? new Set((ledger.contract as ExecutionContractV2).rules.map(({ id }) => id)) : new Set<string>();
      if (!ledger
        || !step
        || !attempt
        || !["produced", "informed", "verified"].includes(rawAttribution.relation as string)
        || !Array.isArray(rawAttribution.ruleIds)
        || !rawAttribution.ruleIds.every((id) => typeof id === "string" && ruleIds.has(id))) {
        fail(`Artifact attribution at index ${artifactIndex} is outside the persisted execution graph.`);
      }
      if (rawAttribution.relation === "produced") producedCount += 1;
    });
    if (producedCount !== 1) fail(`Artifact at index ${artifactIndex} must have exactly one producer.`);
  });
};

const assertAggregateRunState = (run: Record<string, unknown>, ledgers: Array<Record<string, unknown>>, activeCount: number) => {
  const state = run.state;
  const terminal = ledgers.filter((ledger) => ledger.outcome !== undefined);
  const hasReadingLedger = ledgers.some((ledger) => ledger.state === "reading" && ledger.outcome === undefined
    && (ledger.readReceipts as unknown[]).length < (ledger.contentChunks as unknown[]).length);
  const hasReadyLedger = ledgers.some((ledger) => {
    const steps = ledger.steps as Array<Record<string, unknown>>;
    const pendingWorkflow = steps.some((step) => step.type !== "repair" && step.status === "pending");
    const untouchedRepairOnly = steps.every((step) => step.type === "repair" && step.status === "skipped")
      && ledger.repairIterations === 0 && (ledger.verificationReports as unknown[]).length === 0;
    return ledger.state === "ready" && ledger.outcome === undefined
      && (ledger.readReceipts as unknown[]).length === (ledger.contentChunks as unknown[]).length
      && (pendingWorkflow || untouchedRepairOnly);
  });
  const hasVerifiableLedger = ledgers.some((ledger) => {
    if (ledger.state === "used") return true;
    const steps = ledger.steps as Array<Record<string, unknown>>;
    return ["ready", "verifying"].includes(ledger.state as string)
      && ledger.outcome === undefined
      && steps.some((step) => step.type !== "repair")
      && steps.every((step) => step.type === "repair" || step.status === "satisfied");
  });
  const hasUsedLedger = ledgers.some((ledger) => ledger.state === "used" && ledger.outcome === "used");
  if (state === "running" && activeCount !== 1) fail("Aggregate running state has no active step.");
  if (state === "failed" && activeCount !== 0) fail("Aggregate failed state cannot retain an active step.");
  if (state === "planned" && (terminal.length !== ledgers.length || ledgers.some((ledger) => ledger.outcome === "used"))) {
    fail("Aggregate planned state is incompatible with its ledger outcomes.");
  }
  if (state === "reading" && !hasReadingLedger) {
    fail("Aggregate reading state has no unread skill content.");
  }
  if (state === "ready" && !hasReadyLedger) fail("Aggregate ready state has no ready ledger.");
  if (state === "verifying" && !(activeCount === 0 ? hasVerifiableLedger : hasUsedLedger)) {
    fail("Aggregate verifying state has no compatible verification result.");
  }
  if (state === "repair-required" && !ledgers.some((ledger) => ledger.state === "repair-required")) {
    fail("Aggregate repair-required state has no repair-required ledger.");
  }
  if (state === "verified" && (terminal.length !== ledgers.length || ledgers.some((ledger) => ledger.outcome === "blocked"))) {
    fail("Aggregate verified state is incompatible with its ledger outcomes.");
  }
  if (state === "blocked" && !ledgers.some((ledger) => ledger.outcome === "blocked")) {
    fail("Aggregate blocked state has no blocked ledger.");
  }
};

export const assertValidStrictSkillRun: (input: unknown) => asserts input is SkillRunV2 = (input) => {
  if (!record(input)) fail("Strict run must be an object.");
  exactKeys(input, ["schemaVersion", "certification", "runId", "domain", "targetAgent", "locale", "state", "revision", "createdAt", "updatedAt", "intent", "recommendations", "excludedRecommendations", "skillLedgers", "artifacts", "sourceControl"], [], "strict run");
  if (input.schemaVersion !== "2.0" || input.certification !== "strict" || typeof input.runId !== "string" || !/^run_[a-z0-9_-]{7,127}$/.test(input.runId)) fail("Strict run identity is invalid.");
  if (!states.has(input.state as string) || !Number.isInteger(input.revision) || (input.revision as number) < 0) fail("Strict run state or revision is invalid.");
  if (!record(input.intent) || !checksum.test(input.intent.sha256 as string) || typeof input.intent.normalizedGoal !== "string") fail("Strict run intent is invalid.");
  if (!Array.isArray(input.recommendations) || !Array.isArray(input.excludedRecommendations) || !Array.isArray(input.skillLedgers) || input.skillLedgers.length === 0 || !Array.isArray(input.artifacts)) fail("Strict run recommendations, ledgers, or artifacts are invalid.");
  if (!record(input.sourceControl) || (input.sourceControl.mode !== "git" && input.sourceControl.mode !== "non-git")) fail("Strict run source-control snapshot is invalid.");
  const skillIds = new Set<string>();
  const ledgers: Array<Record<string, unknown>> = [];
  const ledgerBySkillId = new Map<string, Record<string, unknown>>();
  for (const [ledgerIndex, rawLedger] of input.skillLedgers.entries()) {
    if (!record(rawLedger)) fail(`skillLedgers[${ledgerIndex}] must be an object.`);
    exactKeys(rawLedger, ["skillId", "role", "mandatory", "version", "packageChecksum", "contractChecksum", "contract", "schemaSnapshots", "schemaChecksums", "input", "state", "applicability", "contentChunks", "readReceipts", "steps", "repairIterations", "verificationReports", "repairRequests"], ["outcome"], `skillLedgers[${ledgerIndex}]`);
    const skillId = rawLedger.skillId;
    if (typeof skillId !== "string" || skillIds.has(skillId)) fail("Strict run skill ids must be unique strings.");
    skillIds.add(skillId);
    ledgers.push(rawLedger);
    ledgerBySkillId.set(skillId, rawLedger);
    if (!checksum.test(rawLedger.packageChecksum as string) || !checksum.test(rawLedger.contractChecksum as string) || !ledgerStates.has(rawLedger.state as string)) fail(`Invalid snapshot for ${skillId}.`);
    assertValidExecutionContract(rawLedger.contract);
    if (rawLedger.contract.skillId !== skillId || digest(JSON.stringify(rawLedger.contract)) !== rawLedger.contractChecksum || !record(rawLedger.schemaSnapshots) || !record(rawLedger.schemaSnapshots.input) || !record(rawLedger.schemaSnapshots.output) || !record(rawLedger.schemaChecksums) || digest(JSON.stringify(rawLedger.schemaSnapshots.input)) !== rawLedger.schemaChecksums.input || digest(JSON.stringify(rawLedger.schemaSnapshots.output)) !== rawLedger.schemaChecksums.output || !record(rawLedger.input) || !record(rawLedger.applicability) || typeof rawLedger.applicability.applicable !== "boolean" || !Array.isArray(rawLedger.applicability.unmetPrerequisites) || !rawLedger.applicability.unmetPrerequisites.every((item) => typeof item === "string") || !Array.isArray(rawLedger.contentChunks) || !Array.isArray(rawLedger.readReceipts) || !Array.isArray(rawLedger.steps) || !Array.isArray(rawLedger.verificationReports) || !Array.isArray(rawLedger.repairRequests)) fail(`Invalid ledger structure for ${skillId}.`);
    exactKeys(rawLedger.applicability, ["applicable", "unmetPrerequisites"], [], `applicability for ${skillId}`);
    const contentChunks = rawLedger.contentChunks;
    for (const [index, chunk] of contentChunks.entries()) {
      if (!record(chunk) || chunk.ordinal !== index || chunk.total !== contentChunks.length || typeof chunk.content !== "string" || digest(chunk.content) !== chunk.sha256 || !safeRelative(chunk.path)) fail(`Tampered content chunk for ${skillId}.`);
    }
    if (rawLedger.readReceipts.length > contentChunks.length) fail(`Too many read receipts for ${skillId}.`);
    rawLedger.readReceipts.forEach((receipt, index) => {
      const chunk = contentChunks[index];
      if (!record(receipt) || receipt.path !== chunk.path || receipt.ordinal !== chunk.ordinal || receipt.total !== chunk.total || receipt.sha256 !== chunk.sha256 || typeof receipt.deliveredAt !== "string") fail(`Invalid read receipt for ${skillId}.`);
    });
    if (rawLedger.outcome !== undefined && !["used", "no-op", "blocked"].includes(rawLedger.outcome as string)) fail(`Invalid outcome for ${skillId}.`);
  }
  const artifactIds = new Set<string>();
  const artifacts: Array<Record<string, unknown>> = [];
  for (const [index, artifact] of input.artifacts.entries()) {
    if (!record(artifact)) fail(`artifacts[${index}] must be an object.`);
    exactKeys(artifact, ["artifactId", "kind", "path", "sha256", "size", "attributions", "sourceControl"], ["sourcePath", "validatedAs"], `artifacts[${index}]`);
    if (typeof artifact.artifactId !== "string" || artifactIds.has(artifact.artifactId) || typeof artifact.kind !== "string" || artifact.kind.length === 0 || !safeRelative(artifact.path) || (artifact.sourcePath !== undefined && !safeRelative(artifact.sourcePath)) || !checksum.test(artifact.sha256 as string) || !Number.isInteger(artifact.size) || (artifact.size as number) < 0 || (artifact.validatedAs !== undefined && !["input", "output", "critic-report"].includes(artifact.validatedAs as string)) || !Array.isArray(artifact.attributions)) fail(`Invalid artifact at index ${index}.`);
    artifactIds.add(artifact.artifactId);
    artifacts.push(artifact);
    if (!record(artifact.sourceControl) || (artifact.sourceControl.mode !== "git" && artifact.sourceControl.mode !== "non-git")) fail(`Invalid artifact source-control snapshot at index ${index}.`);
  }
  let activeCount = 0;
  for (const rawLedger of ledgers) {
    const skillId = rawLedger.skillId as string;
    const contractSteps = (rawLedger.contract as ExecutionContractV2).steps;
    if ((rawLedger.steps as unknown[]).length !== contractSteps.length) fail(`Step snapshot mismatch for ${skillId}.`);
    (rawLedger.steps as unknown[]).forEach((step, index) => {
      if (!record(step) || !same(expectedStepSnapshot(step), contractSteps[index])) {
        fail(`Step snapshot mismatch for ${skillId} at index ${index}.`);
      }
      if (!["pending", "active", "satisfied", "skipped", "blocked"].includes(step.status as string) || !Array.isArray(step.attempts)) fail(`Invalid step for ${skillId}.`);
      assertAttempts(skillId, step, artifactIds);
      if (step.status === "active") activeCount += 1;
    });
    assertVerificationReports(skillId, rawLedger, artifactIds);
    assertRepairLifecycle(skillId, rawLedger);
    assertTerminalLifecycle(rawLedger);
    assertUsedLedger(rawLedger);
    assertLedgerStateCoherence(rawLedger);
  }
  if (activeCount > 1) fail("Only one strict step may be active.");
  assertArtifactAttributions(artifacts, ledgerBySkillId);
  assertAggregateRunState(input, ledgers, activeCount);
};

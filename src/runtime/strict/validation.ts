import { createHash } from "node:crypto";
import path from "node:path";
import { assertValidExecutionContract } from "./contract.ts";
import { StrictSkillRunError, type SkillRunV2 } from "./types.ts";

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

export const assertValidStrictSkillRun: (input: unknown) => asserts input is SkillRunV2 = (input) => {
  if (!record(input)) fail("Strict run must be an object.");
  exactKeys(input, ["schemaVersion", "certification", "runId", "domain", "targetAgent", "locale", "state", "revision", "createdAt", "updatedAt", "intent", "recommendations", "excludedRecommendations", "skillLedgers", "artifacts", "sourceControl"], [], "strict run");
  if (input.schemaVersion !== "2.0" || input.certification !== "strict" || typeof input.runId !== "string" || !/^run_[a-z0-9_-]{7,127}$/.test(input.runId)) fail("Strict run identity is invalid.");
  if (!states.has(input.state as string) || !Number.isInteger(input.revision) || (input.revision as number) < 0) fail("Strict run state or revision is invalid.");
  if (!record(input.intent) || !checksum.test(input.intent.sha256 as string) || typeof input.intent.normalizedGoal !== "string") fail("Strict run intent is invalid.");
  if (!Array.isArray(input.recommendations) || !Array.isArray(input.excludedRecommendations) || !Array.isArray(input.skillLedgers) || input.skillLedgers.length === 0 || !Array.isArray(input.artifacts)) fail("Strict run recommendations, ledgers, or artifacts are invalid.");
  if (!record(input.sourceControl) || (input.sourceControl.mode !== "git" && input.sourceControl.mode !== "non-git")) fail("Strict run source-control snapshot is invalid.");
  const skillIds = new Set<string>();
  let activeCount = 0;
  for (const [ledgerIndex, rawLedger] of input.skillLedgers.entries()) {
    if (!record(rawLedger)) fail(`skillLedgers[${ledgerIndex}] must be an object.`);
    exactKeys(rawLedger, ["skillId", "role", "mandatory", "version", "packageChecksum", "contractChecksum", "contract", "schemaSnapshots", "schemaChecksums", "input", "state", "applicability", "contentChunks", "readReceipts", "steps", "repairIterations", "verificationReports", "repairRequests"], ["outcome"], `skillLedgers[${ledgerIndex}]`);
    const skillId = rawLedger.skillId;
    if (typeof skillId !== "string" || skillIds.has(skillId)) fail("Strict run skill ids must be unique strings.");
    skillIds.add(skillId);
    if (!checksum.test(rawLedger.packageChecksum as string) || !checksum.test(rawLedger.contractChecksum as string) || !ledgerStates.has(rawLedger.state as string)) fail(`Invalid snapshot for ${skillId}.`);
    assertValidExecutionContract(rawLedger.contract);
    if (rawLedger.contract.skillId !== skillId || digest(JSON.stringify(rawLedger.contract)) !== rawLedger.contractChecksum || !record(rawLedger.schemaSnapshots) || !record(rawLedger.schemaSnapshots.input) || !record(rawLedger.schemaSnapshots.output) || !record(rawLedger.schemaChecksums) || digest(JSON.stringify(rawLedger.schemaSnapshots.input)) !== rawLedger.schemaChecksums.input || digest(JSON.stringify(rawLedger.schemaSnapshots.output)) !== rawLedger.schemaChecksums.output || !record(rawLedger.input) || !Array.isArray(rawLedger.contentChunks) || !Array.isArray(rawLedger.readReceipts) || !Array.isArray(rawLedger.steps)) fail(`Invalid ledger structure for ${skillId}.`);
    const contentChunks = rawLedger.contentChunks;
    for (const [index, chunk] of contentChunks.entries()) {
      if (!record(chunk) || chunk.ordinal !== index || chunk.total !== contentChunks.length || typeof chunk.content !== "string" || digest(chunk.content) !== chunk.sha256 || !safeRelative(chunk.path)) fail(`Tampered content chunk for ${skillId}.`);
    }
    if (rawLedger.readReceipts.length > contentChunks.length) fail(`Too many read receipts for ${skillId}.`);
    rawLedger.readReceipts.forEach((receipt, index) => {
      const chunk = contentChunks[index];
      if (!record(receipt) || receipt.path !== chunk.path || receipt.ordinal !== chunk.ordinal || receipt.total !== chunk.total || receipt.sha256 !== chunk.sha256 || typeof receipt.deliveredAt !== "string") fail(`Invalid read receipt for ${skillId}.`);
    });
    for (const step of rawLedger.steps) {
      if (!record(step) || !["pending", "active", "satisfied", "skipped", "blocked"].includes(step.status as string) || !Array.isArray(step.attempts)) fail(`Invalid step for ${skillId}.`);
      if (step.status === "active") activeCount += 1;
    }
    if (rawLedger.outcome !== undefined && !["used", "no-op", "blocked"].includes(rawLedger.outcome as string)) fail(`Invalid outcome for ${skillId}.`);
    if ((rawLedger.state === "used" || rawLedger.state === "no-op" || rawLedger.state === "blocked") && rawLedger.outcome !== rawLedger.state) fail(`Terminal state mismatch for ${skillId}.`);
  }
  if (activeCount > 1) fail("Only one strict step may be active.");
  const artifactIds = new Set<string>();
  for (const [index, artifact] of input.artifacts.entries()) {
    if (!record(artifact)) fail(`artifacts[${index}] must be an object.`);
    exactKeys(artifact, ["artifactId", "kind", "path", "sha256", "size", "attributions", "sourceControl"], ["sourcePath", "validatedAs"], `artifacts[${index}]`);
    if (typeof artifact.artifactId !== "string" || artifactIds.has(artifact.artifactId) || !safeRelative(artifact.path) || !checksum.test(artifact.sha256 as string) || !Array.isArray(artifact.attributions)) fail(`Invalid artifact at index ${index}.`);
    artifactIds.add(artifact.artifactId);
    if (!record(artifact.sourceControl) || (artifact.sourceControl.mode !== "git" && artifact.sourceControl.mode !== "non-git")) fail(`Invalid artifact source-control snapshot at index ${index}.`);
    for (const attribution of artifact.attributions) {
      if (!record(attribution) || !skillIds.has(attribution.skillId as string) || !Array.isArray(attribution.ruleIds)) fail(`Invalid artifact attribution at index ${index}.`);
    }
  }
};

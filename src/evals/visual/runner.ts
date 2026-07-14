import { cp, lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { packageRoot } from "../../paths.ts";
import { parseCommandTemplate, runProcess, substituteCommandPlaceholders } from "../process.ts";
import type { VisualBenchmarkPlan, VisualBenchmarkPlanEntry, VisualBenchmarkRunResult, VisualBenchmarkSuite, VisualCapabilityCandidate, VisualVerificationOutcome } from "./types.ts";

const candidateIds = ["weak", "medium", "strong"] as const;
const arms = ["without-skillranger", "with-skillranger"] as const;
const repetitions = [1, 2] as const;
const resultKeys = ["runId", "briefId", "recipeId", "capabilityCandidateId", "modelId", "commandProfile", "arm", "repetition", "prompt", "fixture", "route", "benchmarkVersion", "skillRangerVersion", "skillRangerChecksum", "workspacePath", "resultPath", "dryRun", "exitCode", "signal", "durationMs", "stdoutPath", "stderrPath", "artifactPaths", "operationalEvidence", "hardGateFailed", "repairIterations", "verificationOutcome", "completionClaimed"];
const entryKeys = ["runId", "briefId", "recipeId", "capabilityCandidateId", "modelId", "commandProfile", "arm", "repetition", "prompt", "fixture", "route"];
const planKeys = ["schemaVersion", "benchmarkVersion", "skillRangerVersion", "skillRangerChecksum", "entries"];
const verificationOutcomes = new Set<VisualVerificationOutcome>(["verified", "failed", "implemented-unverified", "blocked"]);
const safeRunId = /^[a-z0-9][a-z0-9._-]{2,255}$/;
const exactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const contained = (root: string, candidate: string) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
const canonicalRunId = (entry: Pick<VisualBenchmarkPlanEntry, "briefId" | "capabilityCandidateId" | "arm" | "repetition">) => `${entry.briefId}--${entry.capabilityCandidateId}--${entry.arm}--r${entry.repetition}`;

export const validateVisualCandidates = (value: unknown): VisualCapabilityCandidate[] => {
  if (!Array.isArray(value) || value.length !== 3) throw new Error("visual benchmark candidates must contain exactly three records");
  const candidates = value.map((candidate, index) => {
    if (!object(candidate) || !exactKeys(candidate, ["id", "modelId", "commandProfile"])) throw new Error(`visual benchmark candidate ${index} has invalid keys`);
    const { id, modelId, commandProfile } = candidate;
    if (!candidateIds.includes(id as typeof candidateIds[number])) throw new Error(`invalid visual benchmark candidate id: ${String(id)}`);
    if (typeof modelId !== "string" || !/^[^\s/@]+\/[^\s@]+@[^\s@]+$/.test(modelId)) throw new Error(`candidate ${String(id)} modelId must be an exact pinned provider/model@version identity`);
    if (typeof commandProfile !== "string" || !commandProfile.trim() || path.isAbsolute(commandProfile) || commandProfile.split(/[\\/]/).includes("..") || /[\0\r\n]/.test(commandProfile)) throw new Error(`candidate ${String(id)} commandProfile must be a safe non-empty relative path`);
    return { id, modelId, commandProfile } as VisualCapabilityCandidate;
  });
  for (const id of candidateIds) if (candidates.filter((candidate) => candidate.id === id).length !== 1) throw new Error("visual benchmark candidates must contain weak, medium, and strong exactly once");
  return candidates;
};

export const generateVisualBenchmarkPlan = (input: { suite: VisualBenchmarkSuite; candidates: VisualCapabilityCandidate[] }): VisualBenchmarkPlan => {
  const candidates = validateVisualCandidates(input.candidates); const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const entries: VisualBenchmarkPlanEntry[] = [];
  for (const brief of input.suite.briefs) for (const id of candidateIds) for (const arm of arms) for (const repetition of repetitions) {
    const candidate = byId.get(id)!;
    entries.push({ runId: `${brief.id}--${id}--${arm}--r${repetition}`, briefId: brief.id, recipeId: brief.recipeId, capabilityCandidateId: id, modelId: candidate.modelId, commandProfile: candidate.commandProfile, arm, repetition, prompt: brief.prompt, fixture: brief.fixture, route: brief.route });
  }
  const plan: VisualBenchmarkPlan = { schemaVersion: "1.0", benchmarkVersion: input.suite.version, skillRangerVersion: input.suite.skillRangerVersion, skillRangerChecksum: input.suite.skillRangerChecksum, entries };
  validateVisualBenchmarkPlan(plan);
  return plan;
};

const validateEntry = (entry: unknown, index: number): VisualBenchmarkPlanEntry => {
  if (!object(entry) || !exactKeys(entry, entryKeys)) throw new Error(`visual benchmark plan entry ${index} has invalid keys`);
  for (const key of ["runId", "briefId", "recipeId", "modelId", "commandProfile", "prompt", "fixture", "route"] as const) if (typeof entry[key] !== "string" || !(entry[key] as string).length) throw new Error(`visual benchmark plan entry ${index}.${key} must be non-empty`);
  if (!candidateIds.includes(entry.capabilityCandidateId as typeof candidateIds[number]) || !arms.includes(entry.arm as typeof arms[number]) || !repetitions.includes(entry.repetition as 1 | 2)) throw new Error(`visual benchmark plan entry ${index} has an invalid matrix cell`);
  const typed = entry as unknown as VisualBenchmarkPlanEntry;
  if (!safeRunId.test(typed.runId) || typed.runId !== canonicalRunId(typed) || path.isAbsolute(typed.runId) || typed.runId.includes("..")) throw new Error(`visual benchmark plan entry ${index} has invalid canonical runId`);
  validateVisualCandidates(candidateIds.map((id) => id === typed.capabilityCandidateId ? { id, modelId: typed.modelId, commandProfile: typed.commandProfile } : { id, modelId: `validation/${id}@pinned`, commandProfile: `${id}.json` }));
  return typed;
};

const validatePlanShape: (value: unknown, requireFrozen: boolean) => asserts value is VisualBenchmarkPlan = (value, requireFrozen) => {
  if (!object(value) || !exactKeys(value, planKeys) || value.schemaVersion !== "1.0" || typeof value.benchmarkVersion !== "string" || !value.benchmarkVersion || typeof value.skillRangerVersion !== "string" || !value.skillRangerVersion || typeof value.skillRangerChecksum !== "string" || !value.skillRangerChecksum || !Array.isArray(value.entries)) throw new Error("invalid visual benchmark plan contract");
  const entries = value.entries.map(validateEntry);
  if (new Set(entries.map(({ runId }) => runId)).size !== entries.length) throw new Error("visual benchmark plan contains duplicate run ids");
  const cells = new Set(entries.map((entry) => `${entry.briefId}\0${entry.capabilityCandidateId}\0${entry.arm}\0${entry.repetition}`));
  if (cells.size !== entries.length) throw new Error("visual benchmark plan contains duplicate matrix cells");
  const candidateConfig = new Map<string, string>(); const briefConfig = new Map<string, string>();
  for (const entry of entries) {
    const candidate = `${entry.modelId}\0${entry.commandProfile}`; if (candidateConfig.has(entry.capabilityCandidateId) && candidateConfig.get(entry.capabilityCandidateId) !== candidate) throw new Error("visual benchmark plan candidate identity changed between slots"); candidateConfig.set(entry.capabilityCandidateId, candidate);
    const brief = `${entry.recipeId}\0${entry.prompt}\0${entry.fixture}\0${entry.route}`; if (briefConfig.has(entry.briefId) && briefConfig.get(entry.briefId) !== brief) throw new Error("visual benchmark plan brief identity changed between slots"); briefConfig.set(entry.briefId, brief);
  }
  if (requireFrozen) {
    if (entries.length !== 96 || briefConfig.size !== 8 || new Set(entries.map(({ recipeId }) => recipeId)).size !== 8 || candidateConfig.size !== 3) throw new Error("visual benchmark execution requires the frozen 96-slot matrix");
    for (const briefId of briefConfig.keys()) for (const candidateId of candidateIds) for (const arm of arms) for (const repetition of repetitions) if (!cells.has(`${briefId}\0${candidateId}\0${arm}\0${repetition}`)) throw new Error("visual benchmark plan is missing a frozen matrix cell");
  }
};
export const validateVisualBenchmarkPlan: (value: unknown) => asserts value is VisualBenchmarkPlan = (value) => validatePlanShape(value, true);

export const atomicJson = async (filePath: string, value: unknown) => {
  await mkdir(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); await rename(temporary, filePath);
};

const renderedExtension = /\.(png|jpe?g|webp)$/i;
const walkRenderedEvidence = async (root: string, directory = root): Promise<string[]> => {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (directory === root && ["workspace", "run-result.json", "run-metadata.json", "stdout.txt", "stderr.txt", "artifact-manifest.json"].includes(entry.name)) continue;
    const full = path.join(directory, entry.name); if (entry.isSymbolicLink()) throw new Error(`benchmark artifact must not be a symlink: ${full}`);
    if (entry.isDirectory()) output.push(...await walkRenderedEvidence(root, full)); else if (entry.isFile() && renderedExtension.test(entry.name)) output.push(full);
  }
  return output;
};
const validateRegularContainedFile = async (root: string, candidate: string, allowJson = false) => {
  const lexical = path.resolve(candidate); if (!contained(path.resolve(root), lexical)) throw new Error(`benchmark artifact escaped run directory: ${candidate}`);
  const info = await lstat(lexical).catch(() => undefined); if (!info?.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error(`benchmark artifact must be a non-empty regular file: ${candidate}`);
  const [canonicalRoot, canonical] = await Promise.all([realpath(root), realpath(lexical)]); if (!contained(canonicalRoot, canonical)) throw new Error(`benchmark artifact escaped run directory: ${candidate}`);
  if (!renderedExtension.test(lexical) && !(allowJson && /\.json$/i.test(lexical))) throw new Error(`unsupported benchmark artifact type: ${candidate}`);
};
const collectArtifacts = async (runDir: string): Promise<string[]> => {
  const manifestPath = path.join(runDir, "artifact-manifest.json"); const manifestExists = await stat(manifestPath).catch(() => undefined); let candidates: string[];
  if (manifestExists) {
    const raw: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!object(raw) || !exactKeys(raw, ["schemaVersion", "artifacts"]) || raw.schemaVersion !== "1.0" || !Array.isArray(raw.artifacts) || !raw.artifacts.every((item) => typeof item === "string" && item.length > 0 && !path.isAbsolute(item) && !item.split(/[\\/]/).includes(".."))) throw new Error("invalid benchmark artifact manifest");
    candidates = raw.artifacts.map((item) => path.resolve(runDir, item as string));
  } else candidates = await walkRenderedEvidence(runDir);
  const unique = [...new Set(candidates)].sort(); for (const candidate of unique) await validateRegularContainedFile(runDir, candidate, true); return unique;
};

type OperationalMetadata = { schemaVersion: "1.0"; hardGateFailed: boolean; repairIterations: number; verificationOutcome: VisualVerificationOutcome; completionClaimed: boolean };
const loadOperationalMetadata = async (runDir: string): Promise<OperationalMetadata | undefined> => {
  const file = path.join(runDir, "run-metadata.json"); if (!(await stat(file).catch(() => undefined))) return undefined;
  await validateRegularContainedFile(runDir, file, true); const value: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!object(value) || !exactKeys(value, ["schemaVersion", "hardGateFailed", "repairIterations", "verificationOutcome", "completionClaimed"]) || value.schemaVersion !== "1.0" || typeof value.hardGateFailed !== "boolean" || !Number.isInteger(value.repairIterations) || Number(value.repairIterations) < 0 || !verificationOutcomes.has(value.verificationOutcome as VisualVerificationOutcome) || typeof value.completionClaimed !== "boolean") throw new Error("invalid benchmark run-metadata.json");
  return value as OperationalMetadata;
};

const assertPersistedResult = async (value: unknown, entry: VisualBenchmarkPlanEntry, plan: VisualBenchmarkPlan, runDir: string): Promise<VisualBenchmarkRunResult> => {
  if (!object(value) || !exactKeys(value, resultKeys)) throw new Error(`stale benchmark run ${entry.runId}: invalid result contract`);
  const result = value as unknown as VisualBenchmarkRunResult;
  for (const key of entryKeys as Array<keyof VisualBenchmarkPlanEntry>) if (result[key] !== entry[key]) throw new Error(`stale benchmark run ${entry.runId}`);
  if (result.benchmarkVersion !== plan.benchmarkVersion || result.skillRangerVersion !== plan.skillRangerVersion || result.skillRangerChecksum !== plan.skillRangerChecksum || result.dryRun !== false || !Number.isFinite(result.durationMs) || result.durationMs < 0 || !(result.exitCode === null || Number.isInteger(result.exitCode)) || !(result.signal === null || typeof result.signal === "string")) throw new Error(`stale benchmark run ${entry.runId}: invalid provenance`);
  const expectedWorkspace = path.join(runDir, "workspace"); const expectedResult = path.join(runDir, "run-result.json");
  if (path.resolve(result.workspacePath) !== path.resolve(expectedWorkspace) || path.resolve(result.resultPath) !== path.resolve(expectedResult) || result.stdoutPath !== path.join(runDir, "stdout.txt") || result.stderrPath !== path.join(runDir, "stderr.txt")) throw new Error(`stale benchmark run ${entry.runId}: invalid paths`);
  if (!Array.isArray(result.artifactPaths) || new Set(result.artifactPaths).size !== result.artifactPaths.length || !result.artifactPaths.includes(result.stdoutPath) || !result.artifactPaths.includes(result.stderrPath)) throw new Error(`stale benchmark run ${entry.runId}: invalid artifact manifest`);
  for (const artifact of result.artifactPaths) { if (typeof artifact !== "string") throw new Error(`stale benchmark run ${entry.runId}: invalid artifact path`); const info = await lstat(artifact).catch(() => undefined); if (!info?.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error(`stale benchmark run ${entry.runId}: invalid artifact`); const canonical = await realpath(artifact); const canonicalRun = await realpath(runDir); if (!contained(canonicalRun, canonical)) throw new Error(`stale benchmark run ${entry.runId}: artifact escaped run directory`); }
  const expectedEvidence = await collectArtifacts(runDir); const recordedEvidence = result.artifactPaths.filter((artifact) => artifact !== result.stdoutPath && artifact !== result.stderrPath);
  if (expectedEvidence.length !== recordedEvidence.length || expectedEvidence.some((artifact, index) => artifact !== recordedEvidence[index])) throw new Error(`stale benchmark run ${entry.runId}: artifact manifest mismatch`);
  const complete = result.operationalEvidence === "complete";
  if (!complete && result.operationalEvidence !== "incomplete") throw new Error(`stale benchmark run ${entry.runId}: invalid operational evidence status`);
  if (complete !== (typeof result.hardGateFailed === "boolean" && Number.isInteger(result.repairIterations) && Number(result.repairIterations) >= 0 && verificationOutcomes.has(result.verificationOutcome as VisualVerificationOutcome) && typeof result.completionClaimed === "boolean")) throw new Error(`stale benchmark run ${entry.runId}: invalid operational evidence`);
  if (!complete && [result.hardGateFailed, result.repairIterations, result.verificationOutcome, result.completionClaimed].some((item) => item !== null)) throw new Error(`stale benchmark run ${entry.runId}: incomplete operational evidence must use null fields`);
  const metadata = await loadOperationalMetadata(runDir);
  if (complete !== Boolean(metadata) || (metadata && (metadata.hardGateFailed !== result.hardGateFailed || metadata.repairIterations !== result.repairIterations || metadata.verificationOutcome !== result.verificationOutcome || metadata.completionClaimed !== result.completionClaimed))) throw new Error(`stale benchmark run ${entry.runId}: operational metadata mismatch`);
  return result;
};

const execute = async (input: { plan: VisualBenchmarkPlan; commandTemplate: string; outputDir: string; projectRoot?: string; dryRun?: boolean; resume?: boolean; timeoutPerRunMs?: number }, frozen: boolean) => {
  validatePlanShape(input.plan, frozen);
  const outputDir = path.resolve(input.outputDir); const projectRoot = path.resolve(input.projectRoot ?? packageRoot); const template = parseCommandTemplate(input.commandTemplate);
  if (!template.length) throw new Error("Command template must include an executable."); await mkdir(path.join(outputDir, "runs"), { recursive: true }); const canonicalOutput = await realpath(outputDir);
  const runs: VisualBenchmarkRunResult[] = [];
  for (const entry of input.plan.entries) {
    const runDir = path.join(outputDir, "runs", entry.runId); const workspacePath = path.join(runDir, "workspace"); const resultPath = path.join(runDir, "run-result.json");
    if (!contained(outputDir, runDir)) throw new Error(`benchmark run escaped output directory: ${entry.runId}`);
    if (input.resume && await stat(resultPath).catch(() => undefined)) { const text = await readFile(resultPath, "utf8"); const existing = await assertPersistedResult(JSON.parse(text), entry, input.plan, runDir); runs.push(existing); continue; }
    const base = { ...entry, benchmarkVersion: input.plan.benchmarkVersion, skillRangerVersion: input.plan.skillRangerVersion, skillRangerChecksum: input.plan.skillRangerChecksum, workspacePath, resultPath, dryRun: Boolean(input.dryRun), artifactPaths: [] as string[], operationalEvidence: "incomplete" as const, hardGateFailed: null, repairIterations: null, verificationOutcome: null, completionClaimed: null };
    if (input.dryRun) { runs.push({ ...base, exitCode: 0, signal: null, durationMs: 0 }); continue; }
    if (await stat(resultPath).catch(() => undefined)) throw new Error(`benchmark run already exists ${entry.runId}`);
    await mkdir(runDir, { recursive: true }); const canonicalRun = await realpath(runDir); if (!contained(canonicalOutput, canonicalRun)) throw new Error(`benchmark run escaped output directory: ${entry.runId}`);
    const fixture = path.resolve(projectRoot, entry.fixture); if (!contained(projectRoot, fixture)) throw new Error(`benchmark fixture escaped project root: ${entry.fixture}`);
    await cp(fixture, workspacePath, { recursive: true, errorOnExist: true, force: false });
    const args = substituteCommandPlaceholders(template, { runId: entry.runId, briefId: entry.briefId, recipeId: entry.recipeId, candidateId: entry.capabilityCandidateId, modelId: entry.modelId, arm: entry.arm, repetition: String(entry.repetition), prompt: entry.prompt, workspace: workspacePath, outputDir: runDir });
    const processResult = await runProcess(args[0], args.slice(1), { cwd: workspacePath, timeoutMs: input.timeoutPerRunMs }); const stdoutPath = path.join(runDir, "stdout.txt"); const stderrPath = path.join(runDir, "stderr.txt"); await writeFile(stdoutPath, processResult.stdout || "\n"); await writeFile(stderrPath, processResult.stderr || "\n");
    const renderedArtifacts = await collectArtifacts(runDir); const metadata = await loadOperationalMetadata(runDir);
    const record: VisualBenchmarkRunResult = { ...base, exitCode: processResult.exitCode, signal: processResult.signal, durationMs: processResult.durationMs, stdoutPath, stderrPath, artifactPaths: [stdoutPath, stderrPath, ...renderedArtifacts], operationalEvidence: metadata ? "complete" : "incomplete", hardGateFailed: metadata?.hardGateFailed ?? null, repairIterations: metadata?.repairIterations ?? null, verificationOutcome: metadata?.verificationOutcome ?? null, completionClaimed: metadata?.completionClaimed ?? null };
    await atomicJson(resultPath, record); runs.push(record);
  }
  return { schemaVersion: "1.0" as const, benchmarkVersion: input.plan.benchmarkVersion, runs };
};

export const executeVisualBenchmarkPlan = (input: Parameters<typeof execute>[0]) => execute(input, true);
/** Test-only execution for a canonical subset of a generated frozen plan. Production CLI never calls this API. */
export const executeVisualBenchmarkPlanSubsetForTesting = (input: Parameters<typeof execute>[0]) => execute(input, false);

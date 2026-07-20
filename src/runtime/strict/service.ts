import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import "../../domains/bundled.ts";
import { getDomainPack } from "../../domains/registry.ts";
import { readLockfile } from "../../lockfile/index.ts";
import { loadLocalRegistry } from "../../registry/index.ts";
import { recommendSkills } from "../../recommender/index.ts";
import { scanProject } from "../../scanner/index.ts";
import { assertValidExecutionContract } from "./contract.ts";
import { evaluateApplicability } from "./contract.ts";
import { validateJsonSchema } from "./json-schema.ts";
import { captureSourceControl } from "./git.ts";
import { createContentChunks, createStrictSkillRun } from "./reducer.ts";
import { StrictSkillRunStore } from "./store.ts";
import { StrictSkillRunError, type SkillContentChunk, type SkillRunV2, type StrictSkillSelection } from "./types.ts";
import type { PreparedSelections, PreparedSkillSelection } from "../../router/types.ts";

export type StartPreparedStrictSkillRunInput = {
  projectRoot: string;
  registryRoot: string;
  targetAgent: string;
  domain: string;
  intent: string;
  storeRawIntent?: boolean;
  skillInputs?: Record<string, Record<string, unknown>>;
  hostCapabilities?: string[];
  now?: string;
};

export type PreparedStrictSkillInput = {
  projectRoot: string;
  targetAgent: string;
  domain: string;
  intent: string;
  rawIntent?: string;
  normalizedGoal: string;
  runtimeRunId: string;
  selections: PreparedSelections;
  metadata: Array<{ skill: Awaited<ReturnType<typeof loadLocalRegistry>>[number] }>;
  fingerprint: Awaited<ReturnType<typeof scanProject>>;
  skillInputs: Record<string, Record<string, unknown>>;
  capabilities: string[];
  storeRawIntent?: boolean;
};

const sha = (value: Uint8Array | string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const locale = (intent: string): SkillRunV2["locale"] => {
  const normalized = intent.normalize("NFKC").toLowerCase();
  const cyrillic = /[а-яё]/u.test(normalized);
  const latin = /[a-z]/u.test(normalized);
  return cyrillic && latin ? "mixed" : cyrillic ? "ru" : latin ? "en" : "unknown";
};
const recommendationTarget = (target: string) => ["opencode", "cursor", "gemini-cli"].includes(target) ? "generic-agent-skills" : target;
const contained = (root: string, candidate: string) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
const nested = (input: Record<string, unknown>, inputPath: string) => inputPath.split(".").reduce<unknown>((value, key) => typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined, input);

const walkInstalled = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    const info = await lstat(full);
    if (info.isSymbolicLink()) throw new StrictSkillRunError("strict-skill-not-installed", "Installed skill packages may not contain symlinks.");
    if (info.isDirectory()) files.push(...await walkInstalled(full));
    else if (info.isFile()) files.push(full);
  }
  return files;
};

export const assertInstalledMatches = async (
  skill: Awaited<ReturnType<typeof loadLocalRegistry>>[number],
  installedRoot: string,
  lockChecksum: string,
) => {
  const sourceFiles = await walkInstalled(skill.path);
  const expected = new Map<string, string>();
  for (const file of sourceFiles) expected.set(path.relative(skill.path, file).replace(/\\/g, "/"), file);
  for (const contract of skill.sharedContracts ?? []) expected.set(contract.installPath.replace(/\\/g, "/"), contract.path);
  const installedFiles = await walkInstalled(installedRoot);
  const actualPaths = installedFiles.map((file) => path.relative(installedRoot, file).replace(/\\/g, "/")).sort();
  if (!isDeepStrictEqual(actualPaths, [...expected.keys()].sort())) throw new StrictSkillRunError("strict-skill-not-installed", `Installed skill file set mismatch: ${skill.manifest.id}.`);
  for (const [relativePath, sourcePath] of expected) {
    const installedPath = path.join(installedRoot, relativePath);
    if (relativePath === "skill.manifest.json") {
      const sourceManifest = JSON.parse(await readFile(sourcePath, "utf8")) as Record<string, unknown>;
      const installedManifest = JSON.parse(await readFile(installedPath, "utf8")) as Record<string, unknown>;
      if (installedManifest.checksum !== lockChecksum) throw new StrictSkillRunError("strict-skill-not-installed", `Installed manifest checksum mismatch: ${skill.manifest.id}.`);
      delete installedManifest.checksum;
      if (!isDeepStrictEqual(installedManifest, sourceManifest)) throw new StrictSkillRunError("strict-skill-not-installed", `Installed manifest content mismatch: ${skill.manifest.id}.`);
    } else if (sha(await readFile(sourcePath)) !== sha(await readFile(installedPath))) {
      throw new StrictSkillRunError("strict-skill-not-installed", `Installed skill content mismatch: ${skill.manifest.id}/${relativePath}.`);
    }
  }
};

const installedSelection = async (input: {
  projectRoot: string;
  targetAgent: string;
  skill: Awaited<ReturnType<typeof loadLocalRegistry>>[number];
  role: "primary" | "companion";
  fingerprint: Awaited<ReturnType<typeof scanProject>>;
  skillInput: Record<string, unknown>;
  hostCapabilities: Set<string>;
}): Promise<StrictSkillSelection> => {
  const lockfile = await readLockfile(input.projectRoot);
  const entry = lockfile.installed.find((candidate) => candidate.skillId === input.skill.manifest.id && candidate.targetAgent === input.targetAgent && candidate.scope === "repo");
  if (!entry || entry.checksum !== input.skill.checksum) throw new StrictSkillRunError("strict-skill-not-installed", `Strict skill is not installed from the selected checksum: ${input.skill.manifest.id}.`);
  const projectRoot = path.resolve(input.projectRoot);
  const installedRoot = path.resolve(projectRoot, entry.installedPath);
  if (!contained(projectRoot, installedRoot)) throw new StrictSkillRunError("strict-skill-not-installed", "Installed skill path escapes the project root.");
  const rootInfo = await lstat(installedRoot).catch(() => undefined);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new StrictSkillRunError("strict-skill-not-installed", `Installed skill integrity mismatch: ${input.skill.manifest.id}.`);
  await assertInstalledMatches(input.skill, installedRoot, entry.checksum);
  const manifest = JSON.parse(await readFile(path.join(installedRoot, "skill.manifest.json"), "utf8")) as { id?: string; version?: string; execution?: { contractVersion?: string; contract?: string } };
  if (manifest.id !== input.skill.manifest.id || manifest.version !== entry.version || manifest.execution?.contractVersion !== "2.0" || !manifest.execution.contract) throw new StrictSkillRunError("strict-contract-missing", `Installed skill has no strict v2 contract: ${input.skill.manifest.id}.`);
  const contractBytes = await readFile(path.join(installedRoot, manifest.execution.contract));
  const contract = JSON.parse(contractBytes.toString("utf8")) as unknown;
  assertValidExecutionContract(contract);
  if (contract.skillId !== manifest.id) throw new StrictSkillRunError("strict-contract-missing", "Installed execution contract skill id mismatch.");
  const readSchema = async (relativePath: string, label: string) => {
    const schemaPath = path.resolve(installedRoot, relativePath);
    if (!contained(installedRoot, schemaPath)) throw new StrictSkillRunError("strict-contract-missing", `${label} schema path escapes the skill package.`);
    const parsed = JSON.parse(await readFile(schemaPath, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new StrictSkillRunError("strict-contract-missing", `${label} schema is invalid.`);
    return parsed as Record<string, unknown>;
  };
  const schemaSnapshots = { input: await readSchema(contract.inputSchema, "Input"), output: await readSchema(contract.outputSchema, "Output") };
  const schemaChecksums = { input: sha(JSON.stringify(schemaSnapshots.input)), output: sha(JSON.stringify(schemaSnapshots.output)) };
  const inputErrors = validateJsonSchema(schemaSnapshots.input, input.skillInput);
  if (inputErrors.length > 0) throw new StrictSkillRunError("run-integrity", `Strict input schema rejected ${input.skill.manifest.id}: ${inputErrors.join(" ")}`);
  const allChunks: SkillContentChunk[] = [];
  for (const mustRead of contract.mustRead) {
    const target = path.resolve(installedRoot, mustRead);
    if (!contained(installedRoot, target)) throw new StrictSkillRunError("strict-contract-missing", `mustRead path escapes the skill package: ${mustRead}.`);
    const info = await lstat(target).catch(() => undefined);
    if (!info?.isFile() || info.isSymbolicLink()) throw new StrictSkillRunError("strict-contract-missing", `mustRead file is unavailable: ${mustRead}.`);
    allChunks.push(...createContentChunks(mustRead, await readFile(target, "utf8")));
  }
  const contentChunks = allChunks.map((chunk, ordinal) => ({ ...chunk, ordinal, total: allChunks.length }));
  const applicable = evaluateApplicability(contract.applicability, { fingerprint: input.fingerprint, input: input.skillInput });
  const unmetPrerequisites = contract.prerequisites.filter((prerequisite) => prerequisite.kind === "capability"
    ? !input.hostCapabilities.has(prerequisite.capability)
    : nested(input.skillInput, prerequisite.path) === undefined).map(({ id }) => id);
  return {
    skillId: input.skill.manifest.id, role: input.role, mandatory: input.role === "primary", version: entry.version,
    packageChecksum: entry.checksum, contractChecksum: sha(JSON.stringify(contract)), contract, schemaSnapshots, schemaChecksums, input: input.skillInput,
    contentChunks, applicable, unmetPrerequisites,
  };
};

export const startPreparedStrictSkillRun = async (input: StartPreparedStrictSkillRunInput) => {
  if (!getDomainPack(input.domain)) throw new StrictSkillRunError("run-integrity", `Domain not found: ${input.domain}.`);
  const [fingerprint, skills] = await Promise.all([scanProject(input.projectRoot), loadLocalRegistry(input.registryRoot)]);
  const recommendations = recommendSkills(fingerprint, skills, {
    targetAgent: recommendationTarget(input.targetAgent), userIntent: input.intent, domainId: input.domain,
    hostCapabilities: input.hostCapabilities,
  });
  if (recommendations.length === 0) throw new StrictSkillRunError("strict-contract-missing", `No strict-compatible ${input.domain} recommendation is available.`);
  const byId = new Map(skills.map((skill) => [skill.manifest.id, skill]));
  const primary = recommendations[0];
  const primarySkill = byId.get(primary.skillId);
  if (!primarySkill?.executionContract) throw new StrictSkillRunError("strict-contract-missing", `Primary recommendation has no strict contract: ${primary.skillId}.`);
  const strictRecommendations = recommendations.filter(({ skillId }) => byId.get(skillId)?.executionContract !== undefined);
  const excludedRecommendations = recommendations.filter(({ skillId }) => byId.get(skillId)?.executionContract === undefined)
    .map(({ skillId }) => ({ skillId, reason: "strict-contract-missing" as const }));
  const hostCapabilities = new Set(input.hostCapabilities ?? []);
  const selectedSkills: StrictSkillSelection[] = [];
  for (const [index, recommendation] of strictRecommendations.entries()) {
    const skill = byId.get(recommendation.skillId)!;
    selectedSkills.push(await installedSelection({
      projectRoot: input.projectRoot, targetAgent: input.targetAgent, skill,
      role: recommendation.role ?? (index === 0 ? "primary" : "companion"), fingerprint,
      skillInput: input.skillInputs?.[skill.manifest.id] ?? {}, hostCapabilities,
    }));
  }
  const intentDigest = sha(input.intent);
  const sourceControl = await captureSourceControl(input.projectRoot);
  const run = createStrictSkillRun({
    runId: `run_${randomUUID()}`, domain: input.domain, targetAgent: input.targetAgent, locale: locale(input.intent),
    intent: { sha256: intentDigest, normalizedGoal: `${input.domain} strict lifecycle using ${selectedSkills.map(({ skillId }) => skillId).join(", ")}`, ...(input.storeRawIntent ? { raw: input.intent } : {}) },
    recommendations: recommendations.map((recommendation, index) => ({
      skillId: recommendation.skillId, role: recommendation.role ?? (index === 0 ? "primary" : "companion"),
      strictCompatible: byId.get(recommendation.skillId)?.executionContract !== undefined,
    })),
    excludedRecommendations, selectedSkills, sourceControl, ...(input.now === undefined ? {} : { now: input.now }),
  });
  await new StrictSkillRunStore(input.projectRoot).create(run);
  return run;
};

const flattenedSelections = (selections: PreparedSelections): PreparedSkillSelection[] => [
  selections.primary,
  ...selections.environment,
  ...selections.companions,
  ...selections.verification,
  ...selections.agentContext,
];

export const createPreparedStrictSkillRun = async (input: PreparedStrictSkillInput): Promise<SkillRunV2> => {
  const byId = new Map(input.metadata.map(({ skill }) => [skill.manifest.id, skill]));
  const selectedSkills: StrictSkillSelection[] = [];
  for (const selection of flattenedSelections(input.selections)) {
    const skill = byId.get(selection.skillId);
    if (!skill) throw new StrictSkillRunError("strict-contract-missing", `Selected strict skill is unavailable: ${selection.skillId}.`);
    if (!skill.executionContract) throw new StrictSkillRunError("strict-contract-missing", `Selected strict skill has no contract: ${selection.skillId}.`);
    selectedSkills.push(await installedSelection({
      projectRoot: input.projectRoot,
      targetAgent: input.targetAgent,
      skill,
      role: selection.role === "primary" ? "primary" : "companion",
      fingerprint: input.fingerprint,
      skillInput: input.skillInputs[selection.skillId] ?? {},
      hostCapabilities: new Set(input.capabilities),
    }));
  }
  const sourceControl = await captureSourceControl(input.projectRoot);
  return createStrictSkillRun({
    runId: input.runtimeRunId,
    domain: input.domain,
    targetAgent: input.targetAgent,
    locale: locale(input.intent),
    intent: { sha256: sha(input.normalizedGoal), normalizedGoal: input.normalizedGoal, ...(input.storeRawIntent ? { raw: input.rawIntent ?? input.intent } : {}) },
    selectedSkills,
    recommendations: selectedSkills.map(({ skillId, role }) => ({ skillId, role, strictCompatible: true })),
    sourceControl,
  });
};

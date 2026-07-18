import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readdir, readlink, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditSkill } from "../audit/index.ts";
import { assertSkillIntegrity } from "../registry/index.ts";
import { upsertInstalledSkill } from "../lockfile/index.ts";
import type { InstallPlan, RegistrySkill } from "../types.ts";
import { getAgentConfig, isUniversalAgent } from "./agents.ts";
import {
  InstallAuditBlockedError,
  type AgentAdapter,
  type ApplyInstallInput,
  type InstallApplyResult,
  type InstallInput,
  type InstallMode,
} from "./types.ts";

const canonicalSkillBase = ".agents/skills";
const skillManifestFile = "skill.manifest.json";

const walkSkillFiles = async (root: string, dir = root): Promise<string[]> => {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkSkillFiles(root, fullPath)));
    } else if (entry.isFile()) {
      files.push(path.relative(root, fullPath));
    }
  }
  return files.sort();
};

const slugFromSkill = (skill: RegistrySkill) => {
  const slug = skill.manifest.name.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(slug) || slug === "." || slug === ".." || slug.includes("..")) {
    throw new Error(`Invalid install slug for ${skill.manifest.id}: ${skill.manifest.name}`);
  }
  return slug;
};

const isPathSafe = (basePath: string, targetPath: string) => {
  const base = path.resolve(basePath);
  const target = path.resolve(targetPath);
  return target === base || target.startsWith(`${base}${path.sep}`);
};

const pathsOverlap = (left: string, right: string) => isPathSafe(left, right) || isPathSafe(right, left);

const assertRepoPathSafe = async (input: InstallInput, targetPath: string, label: string, includeTarget = true) => {
  if (input.scope !== "repo") return;
  const projectRoot = path.resolve(input.projectRoot);
  const rootInfo = await lstat(projectRoot).catch(() => undefined);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Repository root must be a real directory.");
  const canonicalRoot = await realpath(projectRoot);
  const resolvedTarget = path.resolve(targetPath);
  if (!isPathSafe(projectRoot, resolvedTarget)) throw new Error(`${label} escaped repository root.`);
  const relative = path.relative(projectRoot, includeTarget ? resolvedTarget : path.dirname(resolvedTarget));
  let current = projectRoot;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const info = await lstat(current).catch(() => undefined);
    if (!info) break;
    if (info.isSymbolicLink()) throw new Error(`${label} contains a symlink component: ${path.relative(projectRoot, current)}`);
  }
  let existing = includeTarget ? resolvedTarget : path.dirname(resolvedTarget);
  while (!(await lstat(existing).catch(() => undefined))) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const canonicalExisting = await realpath(existing);
  if (!isPathSafe(canonicalRoot, canonicalExisting)) throw new Error(`${label} escaped canonical repository root.`);
};

export const getCanonicalSkillsDir = (input: Pick<InstallInput, "projectRoot" | "scope">) => {
  const base = input.scope === "user" ? os.homedir() : input.projectRoot;
  return path.resolve(base, canonicalSkillBase);
};

export const getAgentSkillsDir = (targetAgent: string, input: Pick<InstallInput, "projectRoot" | "scope">) => {
  const agent = getAgentConfig(targetAgent);
  if (input.scope === "user") {
    if (!agent.globalSkillsDir) throw new Error(`${agent.displayName} does not support user-scope skill installation.`);
    return path.resolve(agent.globalSkillsDir);
  }
  return path.resolve(input.projectRoot, agent.skillsDir);
};

const skillInstallDirs = (skill: RegistrySkill, input: InstallInput) => {
  const slug = slugFromSkill(skill);
  const canonicalBase = getCanonicalSkillsDir(input);
  const canonicalDir = path.resolve(canonicalBase, slug);
  const agentBase = getAgentSkillsDir(input.targetAgent, input);
  const agentDir = path.resolve(agentBase, slug);

  if (!isPathSafe(canonicalBase, canonicalDir)) {
    throw new Error(`Install path escaped canonical skill directory for ${skill.manifest.id}.`);
  }
  if (!isPathSafe(agentBase, agentDir)) {
    throw new Error(`Install path escaped ${input.targetAgent} skill directory for ${skill.manifest.id}.`);
  }

  return { canonicalBase, canonicalDir, agentBase, agentDir };
};

const installMode = (input: InstallInput): InstallMode => input.mode ?? "symlink";

const planWrites = async (skill: RegistrySkill, input: InstallInput) => {
  await assertSkillIntegrity(skill);
  const { canonicalDir, agentDir } = skillInstallDirs(skill, input);
  await assertRepoPathSafe(input, canonicalDir, "Canonical skill install path");
  await assertRepoPathSafe(input, agentDir, `${input.targetAgent} skill install path`);
  const files = await walkSkillFiles(skill.path);
  const copiedFiles = files.filter((filePath) => filePath !== skillManifestFile);
  copiedFiles.push(...(skill.sharedContracts ?? []).map(({ installPath }) => installPath));
  const mode = installMode(input);
  const universal = isUniversalAgent(input.targetAgent) || canonicalDir === agentDir;
  const targetDir = mode === "copy" ? agentDir : canonicalDir;
  const writes = copiedFiles.map((filePath) => path.join(targetDir, filePath));
  writes.push(path.join(targetDir, skillManifestFile));
  if (mode === "symlink" && !universal) writes.push(agentDir);
  return writes;
};

const populateSkillDirectory = async (skill: RegistrySkill, staging: string) => {
  await mkdir(staging, { recursive: false });
  const files = await walkSkillFiles(skill.path);
  for (const filePath of files) {
    if (filePath === skillManifestFile) continue;
    const sourcePath = path.join(skill.path, filePath);
    const targetPath = path.join(staging, filePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, { dereference: false, recursive: true });
  }
  for (const contract of skill.sharedContracts ?? []) {
    const targetPath = path.join(staging, contract.installPath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await cp(contract.path, targetPath, { dereference: false });
  }
  await writeFile(path.join(staging, skillManifestFile), `${JSON.stringify(skill.manifest, null, 2)}\n`);
};

const copySkillFiles = async (skill: RegistrySkill, target: string, safetyCheck?: () => Promise<void>) => {
  await assertSkillIntegrity(skill);
  await safetyCheck?.();
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  await safetyCheck?.();
  const staging = path.join(parent, `.${path.basename(target)}.staging-${randomUUID()}`);
  const backup = path.join(parent, `.${path.basename(target)}.backup-${randomUUID()}`);
  let movedExisting = false;
  try {
    await populateSkillDirectory(skill, staging);
    // Detect source/contract mutation and parent-path substitution before touching a working install.
    await assertSkillIntegrity(skill);
    await safetyCheck?.();
    if (await lstat(target).catch(() => undefined)) {
      await rename(target, backup);
      movedExisting = true;
    }
    try {
      await rename(staging, target);
    } catch (error) {
      if (movedExisting) await rename(backup, target);
      throw error;
    }
    if (movedExisting) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (movedExisting && !(await lstat(target).catch(() => undefined))) {
      await rename(backup, target).catch(() => undefined);
    }
    throw error;
  }
};

const resolveSymlinkTarget = (linkPath: string, linkTarget: string) => path.resolve(path.dirname(linkPath), linkTarget);

const resolveParentSymlinks = async (targetPath: string) => {
  const resolved = path.resolve(targetPath);
  try {
    return path.join(await realpath(path.dirname(resolved)), path.basename(resolved));
  } catch {
    return resolved;
  }
};

const createDirectorySymlink = async (target: string, linkPath: string) => {
  const resolvedTarget = path.resolve(target);
  const resolvedLink = path.resolve(linkPath);
  const [realTarget, realLink] = await Promise.all([
    realpath(resolvedTarget).catch(() => resolvedTarget),
    realpath(resolvedLink).catch(() => resolvedLink)
  ]);
  if (realTarget === realLink || (await resolveParentSymlinks(resolvedTarget)) === (await resolveParentSymlinks(resolvedLink))) return true;

  try {
    const stats = await lstat(linkPath);
    if (stats.isSymbolicLink()) {
      const existingTarget = await readlink(linkPath);
      if (resolveSymlinkTarget(linkPath, existingTarget) === resolvedTarget) return true;
      await rm(linkPath);
    } else {
      await rm(linkPath, { recursive: true });
    }
  } catch {
    // Missing or broken link paths are handled by creating the parent below.
  }

  await mkdir(path.dirname(linkPath), { recursive: true });
  try {
    await symlink(path.relative(path.dirname(linkPath), target), linkPath, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch {
    return false;
  }
};

const storedInstalledPath = (projectRoot: string, scope: InstallInput["scope"], installPath: string) => {
  if (scope === "repo") return path.relative(projectRoot, installPath);
  const home = os.homedir();
  return installPath === home || installPath.startsWith(`${home}${path.sep}`) ? `~${installPath.slice(home.length)}` : installPath;
};

const makeAdapter = (id: string): AgentAdapter => ({
  id,
  async planInstall(skill: RegistrySkill, input: InstallInput): Promise<InstallPlan> {
    const writes = await planWrites(skill, input);
    return {
      skillId: skill.manifest.id,
      targetAgent: input.targetAgent,
      scope: input.scope,
      dryRun: input.dryRun,
      writes,
      lockfileUpdates: [path.join(input.projectRoot, "skillranger.lock.json")],
      warnings: []
    };
  },
  async applyInstall(skill: RegistrySkill, input: ApplyInstallInput): Promise<InstallApplyResult> {
    const plan = await this.planInstall(skill, input);
    const audit = await auditSkill(skill);
    if (audit.checksum !== skill.checksum) {
      throw new Error(`stale skill integrity for ${skill.manifest.id}`);
    }
    if (audit.riskLevel === "block") {
      throw new InstallAuditBlockedError(plan, audit);
    }

    const { canonicalDir, agentDir } = skillInstallDirs(skill, input);
    const mode = installMode(input);
    const universal = isUniversalAgent(input.targetAgent) || canonicalDir === agentDir;
  const targetDir = mode === "copy" ? agentDir : canonicalDir;

    if (pathsOverlap(skill.path, targetDir)) {
      throw new Error(`Refusing to install ${skill.manifest.id} onto its source directory.`);
    }

    const targetSafety = () => assertRepoPathSafe(input, targetDir, "Skill install path");
    await targetSafety();
    await copySkillFiles(skill, targetDir, targetSafety);
    let installedPath = targetDir;
    if (mode === "symlink" && !universal) {
      await assertRepoPathSafe(input, agentDir, `${input.targetAgent} link path`, false);
      const linked = await createDirectorySymlink(targetDir, agentDir);
      if (linked) {
        installedPath = agentDir;
      } else {
        const agentSafety = () => assertRepoPathSafe(input, agentDir, `${input.targetAgent} skill install path`);
        await copySkillFiles(skill, agentDir, agentSafety);
        installedPath = agentDir;
        plan.warnings.push(`Symlink failed for ${input.targetAgent}; copied skill files instead.`);
      }
    }

    await assertRepoPathSafe(input, path.join(input.projectRoot, "skillranger.lock.json"), "Lockfile path");
    const installed = await upsertInstalledSkill(input.projectRoot, skill, {
      targetAgent: input.targetAgent,
      scope: input.scope,
      installedPath: storedInstalledPath(input.projectRoot, input.scope, installedPath),
      audit
    });
    return { plan, audit, installed };
  }
});

export const codexAdapter = makeAdapter("codex");
export const genericAgentSkillsAdapter = makeAdapter("generic-agent-skills");

export const getAdapter = (targetAgent: string): AgentAdapter => {
  getAgentConfig(targetAgent);
  if (targetAgent === "codex") return codexAdapter;
  if (targetAgent === "generic-agent-skills") return genericAgentSkillsAdapter;
  return makeAdapter(targetAgent);
};

export { detectInstalledAgents, agents } from "./agents.ts";

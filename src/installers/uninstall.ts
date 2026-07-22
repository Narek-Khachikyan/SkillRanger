import { lstat, readlink, rm } from "node:fs/promises";
import path from "node:path";
import { lockfilePath, readLockfile, writeLockfile } from "../lockfile/index.ts";
import { loadLocalRegistry } from "../registry/index.ts";
import { assertInstalledMatches } from "../runtime/strict/service.ts";
import type { InstallScope, Lockfile } from "../types.ts";
import { resolveInstalledSkillRoot } from "./installed-path.ts";

export type UninstallOptions = {
  projectRoot: string;
  skillId: string;
  targetAgent?: string;
  scope?: InstallScope;
  dryRun?: boolean;
  registryRoot?: string;
};

export type UninstallPlan = {
  skillId: string;
  targetAgent?: string;
  scope: InstallScope;
  dryRun: boolean;
  wouldRemove: string[];
  wouldUpdate: string[];
  warnings: string[];
};

export type UninstallResult = {
  plan: UninstallPlan;
  applied: boolean;
};

export const planUninstall = async (options: UninstallOptions): Promise<UninstallPlan> => {
  const projectRoot = path.resolve(options.projectRoot);
  const scope = options.scope ?? "repo";
  const lockfile = await readLockfile(projectRoot);

  const matching = lockfile.installed.filter((entry) => {
    if (entry.skillId !== options.skillId) return false;
    if (options.targetAgent && entry.targetAgent !== options.targetAgent) return false;
    if (entry.scope !== scope) return false;
    return true;
  });

  if (matching.length === 0) {
    return {
      skillId: options.skillId,
      targetAgent: options.targetAgent,
      scope,
      dryRun: options.dryRun ?? true,
      wouldRemove: [],
      wouldUpdate: [],
      warnings: [`Skill ${options.skillId} is not installed.`],
    };
  }

  const registry = await loadLocalRegistry(options.registryRoot);
  const registrySkill = registry.find((s) => s.manifest.id === options.skillId);

  const wouldRemove: string[] = [];
  const warnings: string[] = [];

  const remainingMatchingEntries = lockfile.installed.filter(
    (e) => e.skillId === options.skillId && !matching.includes(e)
  );

  for (const entry of matching) {
    const fullInstalledPath = path.resolve(projectRoot, entry.installedPath);
    let resolvedRoot: string | undefined;
    try {
      resolvedRoot = await resolveInstalledSkillRoot(projectRoot, entry.installedPath);
    } catch {
      warnings.push(`Installed path for ${entry.skillId} (${entry.installedPath}) does not exist or is invalid; stale lockfile entry will be removed.`);
      continue;
    }

    if (registrySkill && entry.checksum === registrySkill.checksum) {
      const matchError = await assertInstalledMatches(registrySkill, resolvedRoot, entry.checksum).catch((err) => err);
      if (matchError) {
        throw new Error(`Cannot uninstall modified skill ${entry.skillId}: ${matchError.message}`);
      }
    }

    wouldRemove.push(fullInstalledPath);
  }

  if (remainingMatchingEntries.length === 0) {
    const canonicalDir = path.resolve(projectRoot, ".agents", "skills", options.skillId.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase());
    const canonicalInfo = await lstat(canonicalDir).catch(() => undefined);
    if (canonicalInfo) {
      if (!wouldRemove.includes(canonicalDir)) {
        wouldRemove.push(canonicalDir);
      }
    }
  }

  return {
    skillId: options.skillId,
    targetAgent: options.targetAgent,
    scope,
    dryRun: options.dryRun ?? true,
    wouldRemove: [...new Set(wouldRemove)],
    wouldUpdate: [lockfilePath(projectRoot)],
    warnings,
  };
};

export const applyUninstall = async (options: UninstallOptions): Promise<UninstallResult> => {
  const plan = await planUninstall(options);
  if (plan.warnings.some((w) => w.includes("is not installed"))) {
    return { plan, applied: false };
  }

  const projectRoot = path.resolve(options.projectRoot);
  const scope = options.scope ?? "repo";

  for (const fileOrDir of plan.wouldRemove) {
    const info = await lstat(fileOrDir).catch(() => undefined);
    if (info) {
      await rm(fileOrDir, { recursive: true, force: true });
    }
  }

  const lockfile = await readLockfile(projectRoot);
  const updatedInstalled = lockfile.installed.filter((entry) => {
    if (entry.skillId !== options.skillId) return true;
    if (options.targetAgent && entry.targetAgent !== options.targetAgent) return true;
    if (entry.scope !== scope) return true;
    return false;
  });

  const nextLockfile: Lockfile = {
    schemaVersion: "1.0",
    installed: updatedInstalled,
  };

  await writeLockfile(projectRoot, nextLockfile);

  return {
    plan: { ...plan, dryRun: false },
    applied: true,
  };
};

import { readFile } from "node:fs/promises";
import path from "node:path";
import { readLockfile } from "../lockfile/index.ts";
import { loadLocalRegistry } from "../registry/index.ts";
import { assertInstalledMatches } from "../runtime/strict/service.ts";
import { resolveInstalledSkillRoot, InvalidInstalledPathError } from "./installed-path.ts";

export type VerificationStatus = "verified" | "missing" | "modified" | "invalid-path";

export type SkillVerificationResult = {
  skillId: string;
  targetAgent: string;
  scope: string;
  installedPath: string;
  status: VerificationStatus;
  reason?: string;
};

export type ProjectVerificationResult = {
  projectRoot: string;
  verified: boolean;
  entries: SkillVerificationResult[];
};

export const verifyInstalledSkills = async (options: {
  projectRoot: string;
  registryRoot?: string;
  skillId?: string;
  targetAgent?: string;
}): Promise<ProjectVerificationResult> => {
  const projectRoot = path.resolve(options.projectRoot);
  const lockfile = await readLockfile(projectRoot);
  const registry = await loadLocalRegistry(options.registryRoot);

  let filtered = lockfile.installed;
  if (options.skillId) {
    filtered = filtered.filter((entry) => entry.skillId === options.skillId);
  }
  if (options.targetAgent) {
    filtered = filtered.filter((entry) => entry.targetAgent === options.targetAgent);
  }

  const results: SkillVerificationResult[] = [];

  for (const entry of filtered) {
    const baseResult = {
      skillId: entry.skillId,
      targetAgent: entry.targetAgent,
      scope: entry.scope,
      installedPath: entry.installedPath,
    };

    let installedRoot: string;
    try {
      installedRoot = await resolveInstalledSkillRoot(projectRoot, entry.installedPath, entry.scope as "repo" | "user");
    } catch (error) {
      if (error instanceof InvalidInstalledPathError) {
        if (error.message.includes("does not exist")) {
          results.push({ ...baseResult, status: "missing", reason: "Installed skill directory does not exist." });
        } else {
          results.push({ ...baseResult, status: "invalid-path", reason: error.message });
        }
      } else {
        results.push({ ...baseResult, status: "invalid-path", reason: String(error) });
      }
      continue;
    }

    const registrySkill = registry.find((s) => s.manifest.id === entry.skillId);
    if (!registrySkill) {
      results.push({ ...baseResult, status: "modified", reason: `Skill ${entry.skillId} not found in local registry.` });
      continue;
    }

    if (entry.checksum !== registrySkill.checksum) {
      results.push({ ...baseResult, status: "modified", reason: `Lockfile checksum does not match registry skill ${entry.skillId}.` });
      continue;
    }

    try {
      await assertInstalledMatches(registrySkill, installedRoot, entry.checksum);
    } catch (error) {
      results.push({ ...baseResult, status: "modified", reason: "Installed skill content does not match the locked package." });
      continue;
    }

    results.push({ ...baseResult, status: "verified" });
  }

  const verified = results.length > 0 && results.every((r) => r.status === "verified");

  return {
    projectRoot,
    verified,
    entries: results,
  };
};

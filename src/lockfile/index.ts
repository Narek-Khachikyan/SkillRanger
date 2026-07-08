import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AuditFinding, AuditReport, InstallScope, Lockfile, RegistrySkill, RiskLevel } from "../types.ts";

export const lockfilePath = (projectRoot: string) => path.join(projectRoot, "skillranger.lock.json");

const riskLevels = new Set<RiskLevel>(["low", "medium", "high", "block"]);
const lockfileIdPattern = /^[a-z0-9][a-z0-9._-]*$/;
const checksumPattern = /^sha256:[a-f0-9]{64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isMissingFileError = (error: unknown) => isRecord(error) && error.code === "ENOENT";

const requireString = (value: Record<string, unknown>, key: string, filePath: string, entryPath: string) => {
  if (typeof value[key] !== "string" || value[key].trim() === "") {
    throw new Error(`Invalid lockfile at ${filePath}: ${entryPath}.${key} must be a non-empty string.`);
  }
  return value[key];
};

const requireRiskLevel = (value: unknown, filePath: string, entryPath: string) => {
  if (typeof value !== "string" || !riskLevels.has(value as RiskLevel)) {
    throw new Error(`Invalid lockfile at ${filePath}: ${entryPath} must be one of low, medium, high, block.`);
  }
};

const requireScore = (value: unknown, filePath: string, entryPath: string) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid lockfile at ${filePath}: ${entryPath} must be a number from 0 to 1.`);
  }
};

function assertValidAuditFinding(finding: unknown, filePath: string, entryPath: string): asserts finding is AuditFinding {
  if (!isRecord(finding)) {
    throw new Error(`Invalid lockfile at ${filePath}: ${entryPath} must be an object.`);
  }
  requireRiskLevel(finding.severity, filePath, `${entryPath}.severity`);
  requireString(finding, "code", filePath, entryPath);
  requireString(finding, "message", filePath, entryPath);
  if (finding.path !== undefined && typeof finding.path !== "string") {
    throw new Error(`Invalid lockfile at ${filePath}: ${entryPath}.path must be a string when present.`);
  }
}

const assertValidLockfile = (input: unknown, filePath: string): Lockfile => {
  if (!isRecord(input) || input.schemaVersion !== "1.0" || !Array.isArray(input.installed)) {
    throw new Error(`Invalid lockfile at ${filePath}: expected schemaVersion 1.0 with installed array.`);
  }

  const installedKeys = new Set<string>();
  for (const [index, entry] of input.installed.entries()) {
    const entryPath = `installed[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`Invalid lockfile at ${filePath}: ${entryPath} must be an object.`);
    }
    for (const key of ["skillId", "version", "checksum", "targetAgent", "scope", "installedPath"] as const) {
      requireString(entry, key, filePath, entryPath);
    }
    if (entry.scope !== "repo" && entry.scope !== "user") {
      throw new Error(`Invalid lockfile at ${filePath}: ${entryPath}.scope must be repo or user.`);
    }
    if (typeof entry.skillId === "string" && (!lockfileIdPattern.test(entry.skillId) || entry.skillId.includes(".."))) {
      throw new Error(`Invalid lockfile at ${filePath}: ${entryPath}.skillId must be a safe skill id.`);
    }
    if (typeof entry.targetAgent === "string" && (!lockfileIdPattern.test(entry.targetAgent) || entry.targetAgent.includes(".."))) {
      throw new Error(`Invalid lockfile at ${filePath}: ${entryPath}.targetAgent must be a safe agent id.`);
    }
    if (typeof entry.checksum === "string" && !checksumPattern.test(entry.checksum)) {
      throw new Error(`Invalid lockfile at ${filePath}: ${entryPath}.checksum must be a sha256 checksum.`);
    }
    if (typeof entry.installedPath === "string") {
      const normalizedPath = entry.installedPath.replace(/\\/g, "/");
      if (path.isAbsolute(entry.installedPath) || normalizedPath.split("/").includes("..")) {
        throw new Error(`Invalid lockfile at ${filePath}: ${entryPath}.installedPath must be a relative path without traversal.`);
      }
    }
    const installedKey = `${entry.skillId}\0${entry.targetAgent}\0${entry.scope}`;
    if (installedKeys.has(installedKey)) {
      throw new Error(`Invalid lockfile at ${filePath}: duplicate installed entry for ${entry.skillId}/${entry.targetAgent}/${entry.scope}.`);
    }
    installedKeys.add(installedKey);

    if (!isRecord(entry.source)) {
      throw new Error(`Invalid lockfile at ${filePath}: ${entryPath}.source must be an object.`);
    }
    for (const key of ["type", "registry", "path"] as const) {
      requireString(entry.source, key, filePath, `${entryPath}.source`);
    }
    if (typeof entry.source.path === "string") {
      const normalizedPath = entry.source.path.replace(/\\/g, "/");
      if (path.isAbsolute(entry.source.path) || normalizedPath.split("/").includes("..")) {
        throw new Error(`Invalid lockfile at ${filePath}: ${entryPath}.source.path must be a relative path without traversal.`);
      }
    }
    if (!isRecord(entry.audit)) {
      throw new Error(`Invalid lockfile at ${filePath}: ${entryPath}.audit must be an object.`);
    }
    requireRiskLevel(entry.audit.riskLevel, filePath, `${entryPath}.audit.riskLevel`);
    requireScore(entry.audit.securityScore, filePath, `${entryPath}.audit.securityScore`);
    if (!Array.isArray(entry.audit.findings)) {
      throw new Error(`Invalid lockfile at ${filePath}: ${entryPath}.audit.findings must be an array.`);
    }
    for (const [findingIndex, finding] of entry.audit.findings.entries()) {
      assertValidAuditFinding(finding, filePath, `${entryPath}.audit.findings[${findingIndex}]`);
    }
  }

  return input as Lockfile;
};

export const readLockfile = async (projectRoot: string): Promise<Lockfile> => {
  const filePath = lockfilePath(projectRoot);
  try {
    return assertValidLockfile(JSON.parse(await readFile(filePath, "utf8")) as unknown, filePath);
  } catch (error) {
    if (isMissingFileError(error)) return { schemaVersion: "1.0", installed: [] };
    throw error;
  }
};

export const writeLockfile = async (projectRoot: string, lockfile: Lockfile) => {
  const filePath = lockfilePath(projectRoot);
  await writeFile(filePath, `${JSON.stringify(assertValidLockfile(lockfile, filePath), null, 2)}\n`);
};

export const upsertInstalledSkill = async (
  projectRoot: string,
  skill: RegistrySkill,
  input: {
    targetAgent: string;
    scope: InstallScope;
    installedPath: string;
    audit: AuditReport;
  }
) => {
  const lockfile = await readLockfile(projectRoot);
  lockfile.installed = lockfile.installed.filter(
    (entry) => !(entry.skillId === skill.manifest.id && entry.targetAgent === input.targetAgent && entry.scope === input.scope)
  );
  lockfile.installed.push({
    skillId: skill.manifest.id,
    version: skill.manifest.version,
    checksum: input.audit.checksum,
    targetAgent: input.targetAgent,
    scope: input.scope,
    installedPath: input.installedPath,
    source: skill.manifest.source,
    audit: {
      riskLevel: input.audit.riskLevel,
      securityScore: input.audit.securityScore,
      findings: input.audit.findings
    }
  });
  await writeLockfile(projectRoot, lockfile);
};

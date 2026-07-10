import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { RegistrySkill } from "../types.ts";
import {
  assertValidSkillManifest,
  RegistryValidationError,
  validateCrossSkillReferences,
  validateSkillContent,
  type RegistryValidationIssue,
} from "./validation.ts";

const fileExists = async (filePath: string) => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const walkFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
};

const allowedRegistryRootEntries = new Set(["skills"]);
const allowedSkillTopLevelEntries = new Set([
  "SKILL.md",
  "skill.manifest.json",
  "references",
  "scripts",
  "assets",
  "agents",
  "tests",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "input.schema.json",
  "output.schema.json",
  "workflow.json",
  "gates.json",
  "evals.json",
]);

const hasHiddenPart = (relativePath: string) =>
  relativePath
    .split(path.sep)
    .some((part) => part.startsWith(".") && part !== ".");

const pushIssue = (
  issues: RegistryValidationIssue[],
  relativePath: string,
  message: string,
) => {
  issues.push({ path: relativePath.replace(/\\/g, "/"), message });
};

const collectRegistryLayoutIssues = async (registryRoot: string) => {
  const issues: RegistryValidationIssue[] = [];
  if (!(await fileExists(registryRoot))) return issues;

  const rootEntries = await readdir(registryRoot, { withFileTypes: true });
  for (const entry of rootEntries) {
    const rel = entry.name;
    if (entry.name.startsWith("."))
      pushIssue(
        issues,
        rel,
        "Registry root must not contain hidden files or folders.",
      );
    if (!allowedRegistryRootEntries.has(entry.name))
      pushIssue(issues, rel, "Unexpected registry top-level entry.");
  }

  const skillsRoot = path.join(registryRoot, "skills");
  if (!(await fileExists(skillsRoot))) return issues;

  const skillEntries = await readdir(skillsRoot, { withFileTypes: true });
  for (const entry of skillEntries) {
    const skillRel = path.join("skills", entry.name);
    if (entry.name.startsWith("."))
      pushIssue(
        issues,
        skillRel,
        "Skills registry must not contain hidden files or folders.",
      );
    if (!entry.isDirectory()) {
      pushIssue(
        issues,
        skillRel,
        "Skills registry entries must be directories.",
      );
      continue;
    }

    const skillRoot = path.join(skillsRoot, entry.name);
    const topEntries = await readdir(skillRoot, { withFileTypes: true });
    const topNames = new Set(topEntries.map((topEntry) => topEntry.name));
    if (!topNames.has("SKILL.md"))
      pushIssue(
        issues,
        path.join(skillRel, "SKILL.md"),
        "Skill package must contain SKILL.md.",
      );
    if (!topNames.has("skill.manifest.json")) {
      pushIssue(
        issues,
        path.join(skillRel, "skill.manifest.json"),
        "Skill package must contain skill.manifest.json.",
      );
    }

    for (const topEntry of topEntries) {
      const topRel = path.join(skillRel, topEntry.name);
      if (topEntry.name.startsWith(".") || hasHiddenPart(topRel)) {
        pushIssue(
          issues,
          topRel,
          "Skill package must not contain hidden files or folders.",
        );
      }
      if (!allowedSkillTopLevelEntries.has(topEntry.name)) {
        pushIssue(issues, topRel, "Unexpected skill package top-level entry.");
      }
    }
  }

  return issues;
};

const collectRegistryDuplicateIssues = (skills: RegistrySkill[]) => {
  const issues: RegistryValidationIssue[] = [];
  const byId = new Map<string, RegistrySkill[]>();
  const byName = new Map<string, RegistrySkill[]>();
  for (const skill of skills) {
    byId.set(skill.manifest.id, [
      ...(byId.get(skill.manifest.id) ?? []),
      skill,
    ]);
    byName.set(skill.manifest.name, [
      ...(byName.get(skill.manifest.name) ?? []),
      skill,
    ]);
  }

  for (const [id, duplicates] of byId) {
    if (duplicates.length > 1) {
      pushIssue(
        issues,
        `skills/${id}`,
        `Duplicate skill id used by ${duplicates.length} packages.`,
      );
    }
  }
  for (const [name, duplicates] of byName) {
    if (duplicates.length > 1) {
      pushIssue(
        issues,
        `skills/${name}`,
        `Duplicate skill name used by ${duplicates.map((skill) => skill.manifest.id).join(", ")}.`,
      );
    }
  }

  return issues;
};

const assertNoRegistryIssues = (
  registryRoot: string,
  issues: RegistryValidationIssue[],
) => {
  if (issues.length > 0) {
    const detail = issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    throw new RegistryValidationError(
      `Invalid local registry at ${registryRoot}: ${detail}`,
      issues,
    );
  }
};

export const computeSkillChecksum = async (skillRoot: string) => {
  const hash = createHash("sha256");
  const files = (await walkFiles(skillRoot)).sort();
  for (const file of files) {
    const rel = path.relative(skillRoot, file);
    hash.update(rel);
    hash.update("\0");
    hash.update(Uint8Array.from(await readFile(file)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
};

export const loadLocalRegistry = async (
  registryRoot = path.resolve("registry"),
): Promise<RegistrySkill[]> => {
  const resolvedRegistryRoot = path.resolve(registryRoot);
  const skillsRoot = path.join(resolvedRegistryRoot, "skills");
  assertNoRegistryIssues(
    resolvedRegistryRoot,
    await collectRegistryLayoutIssues(resolvedRegistryRoot),
  );
  if (!(await fileExists(skillsRoot))) return [];

  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const skills: RegistrySkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillRoot = path.join(skillsRoot, entry.name);
    const manifestPath = path.join(skillRoot, "skill.manifest.json");
    const skillPath = path.join(skillRoot, "SKILL.md");
    if (!(await fileExists(manifestPath)) || !(await fileExists(skillPath)))
      continue;

    const manifestJson = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as unknown;
    const skillText = await readFile(skillPath, "utf8");
    const manifest = assertValidSkillManifest(manifestJson, manifestPath, {
      folderName: entry.name,
      registryRoot: resolvedRegistryRoot,
      skillRoot,
      skillText,
    });
    const contentIssues = validateSkillContent(skillText, skillRoot, {
      lane: manifest.routing?.lane,
      skillId: manifest.id,
      requiredCapabilities: manifest.verification?.requiredCapabilities,
      enforceContracts: manifest.source.type === "curated",
    });
    const warningIssues = contentIssues.filter(
      (issue) => issue.path === "SKILL.md" && issue.message.includes("threshold"),
    );
    const contentErrors = contentIssues.filter(
      (i) => !warningIssues.includes(i),
    );
    for (const issue of warningIssues) {
      console.warn(`${manifest.id}/${issue.path}: ${issue.message}`);
    }
    if (contentErrors.length > 0) {
      const detail = contentErrors
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ");
      throw new RegistryValidationError(
        `Invalid skill content at ${skillPath}: ${detail}`,
        contentErrors,
      );
    }
    const checksum = await computeSkillChecksum(skillRoot);
    skills.push({
      manifest: { ...manifest, checksum },
      path: skillRoot,
      skillPath,
      checksum,
    });
  }

  assertNoRegistryIssues(
    resolvedRegistryRoot,
    collectRegistryDuplicateIssues(skills),
  );
  assertNoRegistryIssues(
    resolvedRegistryRoot,
    validateCrossSkillReferences(skills),
  );
  return skills.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
};

export const findSkill = async (skillId: string, registryRoot?: string) => {
  const skills = await loadLocalRegistry(registryRoot);
  return skills.find((skill) => skill.manifest.id === skillId);
};

export const validateLocalRegistry = async (registryRoot?: string) => {
  const skills = await loadLocalRegistry(registryRoot);
  return {
    ok: true,
    skills: skills.map((skill) => ({
      id: skill.manifest.id,
      checksum: skill.checksum,
    })),
  };
};

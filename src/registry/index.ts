import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { RegistrySkill, ResolvedSharedContract } from "../types.ts";
import { assertValidExecutionContract } from "../runtime/strict/contract.ts";
import type { ExecutionContractV2 } from "../runtime/strict/types.ts";
import { objectDepth, routerMetadataLimits } from "../router/metadata.ts";
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

const allowedRegistryRootEntries = new Set(["skills", "contracts"]);
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
  "execution.contract.json",
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

export const computeSkillChecksum = async (skillRoot: string, sharedContracts: ResolvedSharedContract[] = []) => {
  const hash = createHash("sha256");
  const files = (await walkFiles(skillRoot)).sort();
  for (const file of files) {
    const rel = path.relative(skillRoot, file);
    hash.update(rel);
    hash.update("\0");
    hash.update(Uint8Array.from(await readFile(file)));
    hash.update("\0");
  }
  for (const contract of [...sharedContracts].sort((a, b) => a.id.localeCompare(b.id))) {
    hash.update(contract.installPath.replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(Uint8Array.from(await readFile(contract.path)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
};

const isContainedPath = (root: string, candidate: string) =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

const assertNoSymlinkComponents = async (root: string, candidate: string, id: string) => {
  const relative = path.relative(root, candidate);
  let current = root;
  for (const component of ["", ...relative.split(path.sep)]) {
    if (component) current = path.join(current, component);
    const info = await lstat(current).catch(() => undefined);
    if (!info) throw new Error(`Shared contract not found: ${id}`);
    if (info.isSymbolicLink()) throw new Error(`Shared contract path contains a symlink: ${id}`);
  }
};

const resolveSharedContracts = async (registryRoot: string, ids: string[] = []): Promise<ResolvedSharedContract[]> => {
  const contractsRoot = path.resolve(registryRoot, "contracts");
  const rootInfo = await lstat(contractsRoot).catch(() => undefined);
  if (ids.length > 0 && (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink())) {
    throw new Error("Shared contracts root must be a real directory");
  }
  const canonicalRoot = ids.length > 0 ? await realpath(contractsRoot) : contractsRoot;
  const resolved: ResolvedSharedContract[] = [];
  for (const id of [...ids].sort()) {
    if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(id)) throw new Error(`Invalid shared contract id: ${id}`);
    const contractPath = path.resolve(contractsRoot, `${id}.md`);
    if (!isContainedPath(contractsRoot, contractPath)) throw new Error(`Shared contract escaped contracts root: ${id}`);
    await assertNoSymlinkComponents(contractsRoot, contractPath, id);
    const canonicalPath = await realpath(contractPath);
    if (!isContainedPath(canonicalRoot, canonicalPath)) throw new Error(`Shared contract escaped contracts root: ${id}`);
    const info = await lstat(contractPath);
    if (!info.isFile()) throw new Error(`Shared contract not found: ${id}`);
    const bytes = await readFile(contractPath);
    resolved.push({ id, path: contractPath, checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, installPath: `references/shared/${id.replaceAll("/", "--")}.md` });
  }
  return resolved;
};

export const assertSkillIntegrity = async (skill: RegistrySkill) => {
  // Registry-loaded skills always carry a canonical SHA-256. Explicit in-memory fixtures may not.
  if (!/^sha256:[a-f0-9]{64}$/.test(skill.checksum)) return;
  const actual = await computeSkillChecksum(skill.path, skill.sharedContracts ?? []);
  if (actual !== skill.checksum || (skill.manifest.checksum !== undefined && actual !== skill.manifest.checksum)) {
    throw new Error(`stale skill integrity for ${skill.manifest.id}`);
  }
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

    const manifestText = await readFile(manifestPath, "utf8");
    if (Buffer.byteLength(manifestText, "utf8") > routerMetadataLimits.maxManifestBytes) {
      throw new Error(`Skill manifest exceeds ${routerMetadataLimits.maxManifestBytes} bytes: ${manifestPath}`);
    }
    const manifestJson = JSON.parse(manifestText) as unknown;
    if (objectDepth(manifestJson) > routerMetadataLimits.maxObjectDepth) {
      throw new Error(`Skill manifest exceeds object depth ${routerMetadataLimits.maxObjectDepth}: ${manifestPath}`);
    }
    const skillText = await readFile(skillPath, "utf8");
    const manifest = assertValidSkillManifest(manifestJson, manifestPath, {
      folderName: entry.name,
      registryRoot: resolvedRegistryRoot,
      skillRoot,
      skillText,
    });
    const sharedContracts = await resolveSharedContracts(resolvedRegistryRoot, manifest.execution?.sharedContracts);
    let executionContract: ExecutionContractV2 | undefined;
    if (manifest.execution?.contractVersion === "2.0") {
      const contractPath = path.join(skillRoot, manifest.execution.contract!);
      const parsedContract = JSON.parse(await readFile(contractPath, "utf8")) as unknown;
      assertValidExecutionContract(parsedContract);
      if (parsedContract.skillId !== manifest.id) throw new Error(`Execution contract skillId must match ${manifest.id}.`);
      if (parsedContract.inputSchema !== manifest.execution.inputSchema || parsedContract.outputSchema !== manifest.execution.outputSchema) {
        throw new Error(`Execution contract schema paths must match the manifest for ${manifest.id}.`);
      }
      for (const requiredPath of parsedContract.mustRead) {
        const isSharedContract = sharedContracts.some(({ installPath }) => installPath === requiredPath);
        if (!isSharedContract && !(await fileExists(path.join(skillRoot, requiredPath)))) {
          throw new Error(`Execution contract mustRead file does not exist: ${requiredPath}.`);
        }
      }
      executionContract = parsedContract;
    }
    const contentIssues = validateSkillContent(skillText, skillRoot, {
      lane: manifest.routing?.lane,
      skillId: manifest.id,
      requiredCapabilities: manifest.verification?.requiredCapabilities,
      enforceContracts: manifest.source.type === "curated",
      materializedSharedContractPaths: new Set(sharedContracts.map(({ installPath }) => installPath)),
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
    const checksum = await computeSkillChecksum(skillRoot, sharedContracts);
    skills.push({
      manifest: { ...manifest, checksum },
      path: skillRoot,
      skillPath,
      checksum,
      sharedContracts,
      ...(executionContract === undefined ? {} : { executionContract }),
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

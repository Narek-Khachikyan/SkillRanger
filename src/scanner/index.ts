import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import "../domains/bundled.ts";
import { listProjectSignalProviders } from "./providers.ts";
import type { PackageJson, ProjectSignalContext } from "./types.ts";
import type { ProjectFingerprint, Signal } from "../types.ts";

const fileExists = async (filePath: string) => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const readJson = async <T>(filePath: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
};

const hasAnyFile = async (root: string, names: string[]) => {
  const hits: string[] = [];
  for (const name of names) {
    if (await fileExists(path.join(root, name))) hits.push(name);
  }
  return hits;
};

const signal = (name: string, confidence: number, evidence: string[]): Signal => ({
  name,
  confidence,
  evidence
});

const detectPackageManager = async (root: string): Promise<ProjectFingerprint["packageManager"] | undefined> => {
  const candidates: Array<[string, string]> = [
    ["pnpm", "pnpm-lock.yaml"],
    ["npm", "package-lock.json"],
    ["yarn", "yarn.lock"],
    ["bun", "bun.lockb"]
  ];

  for (const [name, lockfile] of candidates) {
    if (await fileExists(path.join(root, lockfile))) {
      return { name, confidence: 0.95, evidence: [lockfile] };
    }
  }

  if (await fileExists(path.join(root, "package.json"))) {
    return { name: "npm", confidence: 0.45, evidence: ["package.json"] };
  }

  return undefined;
};

const dependencyVersion = (pkg: PackageJson | undefined, name: string) => {
  return pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name];
};

const dependencyEvidence = (pkg: PackageJson | undefined, name: string) => {
  const evidence: string[] = [];
  if (pkg?.dependencies?.[name]) evidence.push(`dependencies.${name}`);
  if (pkg?.devDependencies?.[name]) evidence.push(`devDependencies.${name}`);
  return evidence;
};

const dependencyMajorVersion = (pkg: PackageJson | undefined, name: string) => {
  const version = dependencyVersion(pkg, name);
  const match = version?.match(/\d+/);
  return match ? Number(match[0]) : undefined;
};

const scanFiles = async (root: string, maxFiles = 500): Promise<{ files: string[]; truncated: boolean; limit: number }> => {
  const found: string[] = [];
  let truncated = false;
  const ignored = new Set(["node_modules", ".git", ".skillranger", ".next", "dist", "coverage"]);

  const walk = async (dir: string) => {
    if (found.length >= maxFiles) {
      truncated = true;
      return;
    }
    let entries: import("node:fs").Dirent[];
    try {
      entries = (await readdir(dir, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      return;
    }

    for (const entry of entries) {
      if (found.length >= maxFiles) {
        truncated = true;
        break;
      }
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(root, fullPath).split(path.sep).join("/");
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        found.push(relPath);
      }
    }
  };

  await walk(root);
  if (found.length >= maxFiles) truncated = true;
  return { files: found, truncated, limit: maxFiles };
};

export const scanProject = async (projectRoot: string): Promise<ProjectFingerprint> => {
  const root = path.resolve(projectRoot);
  const pkg = await readJson<PackageJson>(path.join(root, "package.json"));
  const { files, truncated, limit } = await scanFiles(root);
  const signals = new Set<string>();
  const tags = new Set<string>();
  const warnings: string[] = [];
  const frameworks: Signal[] = [];
  const styling: Signal[] = [];
  const testing: ProjectFingerprint["testing"] = [];
  const languages: Signal[] = [];
  const infrastructure: Signal[] = [];

  if (truncated) {
    warnings.push(`File scan stopped after ${limit} entries; project fingerprint may be incomplete.`);
  }

  for (const file of files) signals.add(file);

  if (pkg) {
    signals.add("package.json");
    tags.add("javascript");
  }

  const tsEvidence = [
    ...(await hasAnyFile(root, ["tsconfig.json"])),
    ...files.filter((file) => file.endsWith(".ts") || file.endsWith(".tsx")).slice(0, 3),
    ...dependencyEvidence(pkg, "typescript")
  ];
  if (tsEvidence.length > 0) {
    languages.push(signal("typescript", 0.96, tsEvidence));
    tags.add("typescript");
  } else if (pkg) {
    languages.push(signal("javascript", 0.8, ["package.json"]));
  }

  const pyFiles = files.filter((file) => file.endsWith(".py")).slice(0, 3);
  const pyConfig = await hasAnyFile(root, ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py"]);
  const pyEvidence = [...pyConfig, ...pyFiles];
  if (pyEvidence.length > 0) {
    languages.push(signal("python", 0.9, pyEvidence));
    tags.add("python");
  }

  for (const [name, type, confidence] of [
    ["vitest", "unit", 0.78],
    ["jest", "unit", 0.76]
  ] as const) {
    const evidence = dependencyEvidence(pkg, name);
    if (evidence.length > 0) {
      testing.push({ ...signal(name, confidence, evidence), type });
      tags.add("testing");
    }
  }

  const projectTypes = [];
  const providerContext: ProjectSignalContext = {
    root,
    packageJson: pkg,
    files,
    hasAnyFile: (names) => hasAnyFile(root, names),
    dependencyVersion: (name) => dependencyVersion(pkg, name),
    dependencyEvidence: (name) => dependencyEvidence(pkg, name),
    dependencyMajorVersion: (name) => dependencyMajorVersion(pkg, name),
    signal,
  };
  for (const provider of listProjectSignalProviders()) {
    const contribution = await provider.detect(providerContext);
    projectTypes.push(...(contribution.projectTypes ?? []));
    frameworks.push(...(contribution.frameworks ?? []));
    styling.push(...(contribution.styling ?? []));
    testing.push(...(contribution.testing ?? []));
    infrastructure.push(...(contribution.infrastructure ?? []));
    for (const tag of contribution.tags ?? []) tags.add(tag);
    warnings.push(...(contribution.warnings ?? []));
  }

  if ((await hasAnyFile(root, ["Dockerfile", "docker-compose.yml", "docker-compose.yaml"])).length) {
    infrastructure.push(signal("docker", 0.8, await hasAnyFile(root, ["Dockerfile", "docker-compose.yml", "docker-compose.yaml"])));
    tags.add("devops-platform");
  }

  const folderSignals = await hasAnyFile(root, ["app", "pages", "src", "components", "server", "api", "packages"]);
  for (const folder of folderSignals) {
    signals.add(`${folder}/`);
  }

  const agentsMd = await hasAnyFile(root, ["AGENTS.md"]);
  const codexSkills = await hasAnyFile(root, [".agents/skills"]);
  const claudeSkills = await hasAnyFile(root, [".claude/skills"]);

  if (!agentsMd.length) warnings.push("No AGENTS.md found for repo-local agent guidance.");
  if (!codexSkills.length) warnings.push("No repo-local Codex/generic skills found.");

  if (tags.has("devops-platform")) {
    projectTypes.push({ type: "devops-platform", confidence: 0.72, evidence: ["Docker config"] });
  }

  return {
    schemaVersion: "1.0",
    root,
    packageManager: await detectPackageManager(root),
    projectTypes,
    languages,
    frameworks,
    styling,
    testing,
    infrastructure,
    dependencies: [...new Set([
      ...Object.keys(pkg?.dependencies ?? {}),
      ...Object.keys(pkg?.devDependencies ?? {}),
    ])].sort(),
    agentContext: {
      agentsMd: { present: agentsMd.length > 0, paths: agentsMd },
      codexSkills: { present: codexSkills.length > 0, paths: codexSkills },
      claudeSkills: { present: claudeSkills.length > 0, paths: claudeSkills }
    },
    signals: [...signals].sort(),
    tags: [...tags].sort(),
    warnings
  };
};

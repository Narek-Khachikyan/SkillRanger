import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ProjectFingerprint, Signal } from "../types.ts";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

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

const scanFiles = async (root: string, maxFiles = 500): Promise<string[]> => {
  const found: string[] = [];
  const ignored = new Set(["node_modules", ".git", ".next", "dist", "coverage"]);

  const walk = async (dir: string) => {
    if (found.length >= maxFiles) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (found.length >= maxFiles) break;
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(root, fullPath);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        found.push(relPath);
      }
    }
  };

  await walk(root);
  return found;
};

export const scanProject = async (projectRoot: string): Promise<ProjectFingerprint> => {
  const root = path.resolve(projectRoot);
  const pkg = await readJson<PackageJson>(path.join(root, "package.json"));
  const files = await scanFiles(root);
  const signals = new Set<string>();
  const tags = new Set<string>();
  const warnings: string[] = [];
  const frameworks: Signal[] = [];
  const styling: Signal[] = [];
  const testing: ProjectFingerprint["testing"] = [];
  const languages: Signal[] = [];
  const infrastructure: Signal[] = [];

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

  if (dependencyVersion(pkg, "next") || (await hasAnyFile(root, ["next.config.js", "next.config.ts", "next.config.mjs"])).length) {
    frameworks.push(signal("nextjs", 0.96, [...dependencyEvidence(pkg, "next"), ...(await hasAnyFile(root, ["next.config.js", "next.config.ts", "next.config.mjs"]))]));
    tags.add("nextjs");
    tags.add("frontend");
    tags.add("web-app");
  }

  if (dependencyVersion(pkg, "vite") || (await hasAnyFile(root, ["vite.config.js", "vite.config.ts"])).length) {
    frameworks.push(signal("vite", 0.9, [...dependencyEvidence(pkg, "vite"), ...(await hasAnyFile(root, ["vite.config.js", "vite.config.ts"]))]));
    tags.add("vite");
    tags.add("frontend");
  }

  if (dependencyVersion(pkg, "react")) {
    frameworks.push(signal("react", 0.98, dependencyEvidence(pkg, "react")));
    tags.add("react");
    tags.add("frontend");
  }

  if (dependencyVersion(pkg, "tailwindcss") || (await hasAnyFile(root, ["tailwind.config.js", "tailwind.config.ts", "postcss.config.js", "postcss.config.mjs"])).length) {
    styling.push(signal("tailwindcss", 0.88, [...dependencyEvidence(pkg, "tailwindcss"), ...(await hasAnyFile(root, ["tailwind.config.js", "tailwind.config.ts"]))]));
    tags.add("tailwind");
  }

  const reactMajor = dependencyMajorVersion(pkg, "react");
  if (reactMajor !== undefined && (reactMajor < 18 || reactMajor > 19)) {
    warnings.push(`React ${reactMajor} is outside the maintained frontend-skill range (18-19); use conservative fallbacks and do not promote without verification.`);
  }
  const tailwindMajor = dependencyMajorVersion(pkg, "tailwindcss");
  if (tailwindMajor !== undefined && (tailwindMajor < 3 || tailwindMajor > 4)) {
    warnings.push(`Tailwind CSS ${tailwindMajor} is outside the maintained frontend-skill range (3-4); use conservative fallbacks and do not promote without verification.`);
  }

  for (const [name, type, confidence] of [
    ["vitest", "unit", 0.78],
    ["jest", "unit", 0.76],
    ["playwright", "e2e", 0.82],
    ["cypress", "e2e", 0.76],
    ["@testing-library/react", "component", 0.74]
  ] as const) {
    const evidence = dependencyEvidence(pkg, name);
    if (name === "playwright") evidence.push(...(await hasAnyFile(root, ["playwright.config.ts", "playwright.config.js"])));
    if (evidence.length > 0) {
      testing.push({ ...signal(name.replace("@testing-library/react", "testing-library"), confidence, evidence), type });
      tags.add("testing");
      if (name.includes("playwright")) tags.add("playwright");
    }
  }

  if ((await hasAnyFile(root, ["Dockerfile", "docker-compose.yml", "docker-compose.yaml"])).length) {
    infrastructure.push(signal("docker", 0.8, await hasAnyFile(root, ["Dockerfile", "docker-compose.yml", "docker-compose.yaml"])));
    tags.add("devops-platform");
  }

  const folderSignals = await hasAnyFile(root, ["app", "pages", "src", "components", "server", "api", "packages"]);
  for (const folder of folderSignals) {
    if (folder === "components") tags.add("component-design");
    signals.add(`${folder}/`);
  }

  const agentsMd = await hasAnyFile(root, ["AGENTS.md"]);
  const codexSkills = await hasAnyFile(root, [".agents/skills"]);
  const claudeSkills = await hasAnyFile(root, [".claude/skills"]);

  if (!agentsMd.length) warnings.push("No AGENTS.md found for repo-local agent guidance.");
  if (!codexSkills.length) warnings.push("No repo-local Codex/generic skills found.");

  const projectTypes = [
    ...(tags.has("frontend") ? [{ type: "frontend", confidence: 0.94, evidence: ["react/next/vite signals"] }] : []),
    ...(tags.has("web-app") ? [{ type: "web-app", confidence: 0.92, evidence: ["app/pages/package signals"] }] : []),
    ...(tags.has("devops-platform") ? [{ type: "devops-platform", confidence: 0.72, evidence: ["Docker config"] }] : [])
  ];

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

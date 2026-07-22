import { lstat, realpath, readlink } from "node:fs/promises";
import path from "node:path";

const isPathSafe = (basePath: string, targetPath: string) => {
  const base = path.resolve(basePath);
  const target = path.resolve(targetPath);
  return target === base || target.startsWith(`${base}${path.sep}`);
};

export class InvalidInstalledPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInstalledPathError";
  }
}

/**
 * Safely resolves an installed skill root directory within projectRoot.
 *
 * Rules:
 * 1. Resolves only repo-scoped paths inside projectRoot.
 * 2. Parent path components must NOT be symlinks.
 * 3. A leaf symlink/junction is allowed ONLY IF:
 *    - Its resolved target is inside projectRoot.
 *    - Its target resides in the canonical skill base (.agents/skills).
 * 4. Returns the absolute canonical real path of the skill directory.
 * 5. Replaces ad-hoc checks without mutating the filesystem.
 */
import os from "node:os";

export const resolveInstalledSkillRoot = async (
  projectRoot: string,
  installedPath: string,
  scope: "repo" | "user" = "repo",
): Promise<string> => {
  if (scope === "user") {
    const home = path.resolve(os.homedir());
    const fullInstalledPath = installedPath.startsWith("~")
      ? path.resolve(home, installedPath.slice(1).replace(/^[/\\]+/, ""))
      : path.resolve(home, installedPath);

    if (!isPathSafe(home, fullInstalledPath)) {
      throw new InvalidInstalledPathError(`User-scoped installed path escaped home directory: ${installedPath}`);
    }

    const relative = path.relative(home, fullInstalledPath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new InvalidInstalledPathError(`Invalid user-scoped installed path location: ${installedPath}`);
    }

    const parts = relative.split(path.sep).filter(Boolean);
    let current = home;
    for (let i = 0; i < parts.length - 1; i++) {
      current = path.join(current, parts[i]);
      const info = await lstat(current).catch(() => undefined);
      if (!info) {
        throw new InvalidInstalledPathError(`Parent path component does not exist: ${path.relative(home, current)}`);
      }
      if (info.isSymbolicLink()) {
        throw new InvalidInstalledPathError(`Parent path component contains a symlink: ${path.relative(home, current)}`);
      }
    }

    const leafInfo = await lstat(fullInstalledPath).catch(() => undefined);
    if (!leafInfo) {
      throw new InvalidInstalledPathError(`Installed skill path does not exist: ${installedPath}`);
    }

    let canonicalTargetDir: string;
    if (leafInfo.isSymbolicLink()) {
      const rawTarget = await readlink(fullInstalledPath);
      const resolvedLinkTarget = path.resolve(path.dirname(fullInstalledPath), rawTarget);
      const realTarget = await realpath(resolvedLinkTarget).catch(() => undefined);
      if (!realTarget) {
        throw new InvalidInstalledPathError(`Symlink target does not exist for: ${installedPath}`);
      }
      const canonicalBase = path.resolve(home, ".agents", "skills");
      const canonicalBaseReal = await realpath(canonicalBase).catch(() => canonicalBase);
      if (!isPathSafe(canonicalBaseReal, realTarget) && !isPathSafe(canonicalBase, realTarget)) {
        throw new InvalidInstalledPathError(`Symlink target is not within canonical user skill directory: ${installedPath}`);
      }
      canonicalTargetDir = realTarget;
    } else if (leafInfo.isDirectory()) {
      const realTarget = await realpath(fullInstalledPath);
      if (!isPathSafe(home, realTarget)) {
        throw new InvalidInstalledPathError(`Installed skill directory escaped home directory: ${installedPath}`);
      }
      canonicalTargetDir = realTarget;
    } else {
      throw new InvalidInstalledPathError(`Installed skill path is neither a directory nor a valid symlink: ${installedPath}`);
    }

    return canonicalTargetDir;
  }

  const resolvedProjectRoot = path.resolve(projectRoot);
  const rootInfo = await lstat(resolvedProjectRoot).catch(() => undefined);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new InvalidInstalledPathError("Project root must be a real directory.");
  }
  const canonicalProjectRoot = await realpath(resolvedProjectRoot);

  const fullInstalledPath = path.resolve(resolvedProjectRoot, installedPath);
  if (!isPathSafe(resolvedProjectRoot, fullInstalledPath)) {
    throw new InvalidInstalledPathError(`Installed path escaped project root: ${installedPath}`);
  }

  const relative = path.relative(resolvedProjectRoot, fullInstalledPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new InvalidInstalledPathError(`Invalid installed path relative location: ${installedPath}`);
  }

  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.length === 0) {
    throw new InvalidInstalledPathError(`Invalid installed path: ${installedPath}`);
  }

  // Check parent path components (excluding the leaf)
  let current = resolvedProjectRoot;
  for (let i = 0; i < parts.length - 1; i++) {
    current = path.join(current, parts[i]);
    const info = await lstat(current).catch(() => undefined);
    if (!info) {
      throw new InvalidInstalledPathError(`Parent path component does not exist: ${path.relative(resolvedProjectRoot, current)}`);
    }
    if (info.isSymbolicLink()) {
      throw new InvalidInstalledPathError(`Parent path component contains a symlink: ${path.relative(resolvedProjectRoot, current)}`);
    }
  }

  // Check leaf component
  const leafInfo = await lstat(fullInstalledPath).catch(() => undefined);
  if (!leafInfo) {
    throw new InvalidInstalledPathError(`Installed skill path does not exist: ${installedPath}`);
  }

  let canonicalTargetDir: string;
  if (leafInfo.isSymbolicLink()) {
    const rawTarget = await readlink(fullInstalledPath);
    const resolvedLinkTarget = path.resolve(path.dirname(fullInstalledPath), rawTarget);
    const realTarget = await realpath(resolvedLinkTarget).catch(() => undefined);
    if (!realTarget) {
      throw new InvalidInstalledPathError(`Symlink target does not exist for: ${installedPath}`);
    }
    if (!isPathSafe(canonicalProjectRoot, realTarget)) {
      throw new InvalidInstalledPathError(`Installed skill symlink target escaped project root: ${installedPath}`);
    }
    const canonicalBase = path.resolve(resolvedProjectRoot, ".agents", "skills");
    const canonicalBaseReal = await realpath(canonicalBase).catch(() => canonicalBase);
    if (!isPathSafe(canonicalBaseReal, realTarget) && !isPathSafe(canonicalBase, realTarget)) {
      throw new InvalidInstalledPathError(`Symlink target is not within canonical skill directory: ${installedPath}`);
    }
    canonicalTargetDir = realTarget;
  } else if (leafInfo.isDirectory()) {
    const realTarget = await realpath(fullInstalledPath);
    if (!isPathSafe(canonicalProjectRoot, realTarget)) {
      throw new InvalidInstalledPathError(`Installed skill directory escaped project root: ${installedPath}`);
    }
    canonicalTargetDir = realTarget;
  } else {
    throw new InvalidInstalledPathError(`Installed skill path is neither a directory nor a valid symlink: ${installedPath}`);
  }

  return canonicalTargetDir;
};

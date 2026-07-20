import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { LoadedRouterConfig, RouterConfig } from "./types.ts";
import { RouterConfigError, routerConfigDigest, validateRouterConfig } from "./validation.ts";

export type { LoadedRouterConfig, RouterConfig } from "./types.ts";
export { RouterConfigError, canonicalRouterConfig, routerConfigDigest, validateRouterConfig } from "./validation.ts";

const builtInRouterConfig: RouterConfig = {
  schemaVersion: "router-config/1.0",
  defaultTargetAgent: "codex",
  router: {
    enabled: true,
    strictByDefault: false,
    maxSelectedRisk: "medium",
    maxEnvironmentSkills: 2,
    maxTaskCompanions: 2,
    maxVerificationSkills: 2,
    maxAgentContextSkills: 1,
    maxTotalSelectedSkills: 7,
    maxInstructionBytes: 120_000,
    maxAdditionalReadBytes: 80_000,
    maxSingleFileBytes: 256_000,
    maxIntentBytes: 64_000,
  },
  privacy: {
    allowRawIntentPersistence: false,
  },
};

export const defaultRouterConfig: RouterConfig = structuredClone(builtInRouterConfig);

const isErrno = (error: unknown, code: string): error is NodeJS.ErrnoException => (
  error instanceof Error && "code" in error && error.code === code
);

const readProjectConfig = async (projectRoot: string) => {
  const root = await realpath(projectRoot).catch(() => {
    throw new RouterConfigError("project root cannot be canonicalized.");
  });
  const rootStat = await stat(root).catch(() => {
    throw new RouterConfigError("project root cannot be inspected.");
  });
  if (!rootStat.isDirectory()) throw new RouterConfigError("project root must be a directory.");

  const configPath = path.join(root, "skillranger.config.json");
  let metadata;
  try {
    metadata = await lstat(configPath);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined;
    throw new RouterConfigError("project router config cannot be inspected.");
  }
  if (metadata.isSymbolicLink()) throw new RouterConfigError("project router config must not be a symbolic link.");
  if (!metadata.isFile()) throw new RouterConfigError("project router config must be a regular file.");
  if (metadata.size > 256_000) throw new RouterConfigError("project router config exceeds 256000 bytes.");

  let handle;
  try {
    handle = await open(configPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > 256_000) throw new RouterConfigError("project router config is not a supported regular file.");
    return await handle.readFile("utf8");
  } catch (error) {
    if (error instanceof RouterConfigError) throw error;
    throw new RouterConfigError("project router config cannot be read safely.");
  } finally {
    await handle?.close();
  }
};

export const loadRouterConfig = async (projectRoot: string): Promise<LoadedRouterConfig> => {
  const source = await readProjectConfig(projectRoot);
  if (source === undefined) {
    const config = validateRouterConfig(builtInRouterConfig);
    return { config, digest: routerConfigDigest(config), source: "defaults" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new RouterConfigError("project router config must be valid JSON.");
  }
  const config = validateRouterConfig(parsed);
  return { config, digest: routerConfigDigest(config), source: "project" };
};

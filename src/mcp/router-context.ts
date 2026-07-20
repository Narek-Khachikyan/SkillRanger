import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { defaultRegistryRoot } from "../paths.ts";

let configuredRoot: string | undefined;

const canonicalDirectory = (value: string, label: string) => {
  let canonical: string;
  try { canonical = realpathSync(value); }
  catch { throw new Error(`${label} cannot be canonicalized.`); }
  try {
    if (!statSync(canonical).isDirectory()) throw new Error();
  } catch { throw new Error(`${label} must be a directory.`); }
  return canonical;
};

export const initializeRouterContext = () => {
  configuredRoot = canonicalDirectory(process.env.SKILLRANGER_PROJECT_ROOT?.trim() || process.cwd(), "MCP project root");
  return { projectRoot: configuredRoot, registryRoot: defaultRegistryRoot };
};

export const routerContext = () => {
  if (!configuredRoot) initializeRouterContext();
  return { projectRoot: configuredRoot!, registryRoot: defaultRegistryRoot };
};

export const assertRouterProjectRoot = (value: string) => {
  const context = routerContext();
  const candidate = canonicalDirectory(value, "Project root");
  if (candidate !== context.projectRoot) throw new Error("Project root is not authorized for this MCP server.");
  return candidate;
};

export const routerDisplayRoot = ".";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { defaultDomainsRoot, packageRoot } from "../paths.ts";
import type {
  DomainCapability,
  DomainOwnershipRule,
  DomainPack,
  DomainPackManifest,
  DomainPackRegistration,
} from "./types.ts";

const idPattern = /^[a-z0-9][a-z0-9._-]*$/;
const capabilities = new Set<DomainCapability>([
  "project-signals",
  "intent-routing",
  "structured-artifacts",
  "verification",
  "repair",
  "evaluation",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim() !== "");

const safeRelativePath = (value: string) =>
  !path.isAbsolute(value) && !value.replace(/\\/g, "/").split("/").includes("..");

export const validateDomainPackManifest = (input: unknown): string[] => {
  const issues: string[] = [];
  if (!isRecord(input)) return ["domain manifest must be an object"];
  if (input.schemaVersion !== "1.0") issues.push("schemaVersion must be 1.0");
  for (const key of ["id", "displayName", "version", "coreApi", "skillIdPrefix"] as const) {
    if (typeof input[key] !== "string" || !input[key].trim()) issues.push(`${key} is required`);
  }
  if (typeof input.id === "string" && !idPattern.test(input.id)) issues.push("id must be a safe slug");
  if (typeof input.skillIdPrefix === "string" && !input.skillIdPrefix.endsWith(".")) {
    issues.push("skillIdPrefix must end with a dot");
  }
  if (!isStringArray(input.capabilities)) {
    issues.push("capabilities must be a non-empty string array");
  } else {
    for (const capability of input.capabilities) {
      if (!capabilities.has(capability as DomainCapability)) issues.push(`unsupported capability: ${capability}`);
    }
  }
  if (!isRecord(input.artifacts)) {
    issues.push("artifacts must be an object");
  } else {
    for (const key of ["intents", "schemas", "recipes", "workflows", "validators"] as const) {
      if (!isStringArray(input.artifacts[key])) issues.push(`artifacts.${key} must be a string array`);
      else if (!input.artifacts[key].every(safeRelativePath)) issues.push(`artifacts.${key} contains an unsafe path`);
    }
    if (
      input.artifacts.evalSuite !== undefined &&
      (typeof input.artifacts.evalSuite !== "string" || !safeRelativePath(input.artifacts.evalSuite))
    ) {
      issues.push("artifacts.evalSuite must be a safe relative path");
    }
  }
  if (!Array.isArray(input.ownership) || input.ownership.length === 0) {
    issues.push("ownership must be a non-empty array");
  } else {
    const intents = new Set<string>();
    for (const [index, rule] of input.ownership.entries()) {
      if (!isRecord(rule)) {
        issues.push(`ownership[${index}] must be an object`);
        continue;
      }
      if (typeof rule.intent !== "string" || !rule.intent.trim()) issues.push(`ownership[${index}].intent is required`);
      else if (intents.has(rule.intent)) issues.push(`duplicate ownership intent: ${rule.intent}`);
      else intents.add(rule.intent);
      if (typeof rule.primarySkill !== "string" || !rule.primarySkill.trim()) {
        issues.push(`ownership[${index}].primarySkill is required`);
      }
      if (!isStringArray(rule.supportingSkills)) issues.push(`ownership[${index}].supportingSkills must be a string array`);
      if (rule.requiresEvidence !== undefined && !isStringArray(rule.requiresEvidence)) {
        issues.push(`ownership[${index}].requiresEvidence must be a string array`);
      }
    }
  }
  return issues;
};

const registered = new Map<string, DomainPack>();

export const registerDomainPack = (registration: DomainPackRegistration): DomainPack => {
  const issues = validateDomainPackManifest(registration.manifest);
  if (issues.length > 0) throw new Error(`Invalid domain pack ${registration.manifest.id}: ${issues.join("; ")}`);
  if (registered.has(registration.manifest.id)) {
    throw new Error(`Domain pack already registered: ${registration.manifest.id}`);
  }
  const pack: DomainPack = {
    manifest: registration.manifest,
    routing: registration.routing,
    ...(registration.runPolicy ? { runPolicy: registration.runPolicy } : {}),
    root: registration.root ?? "",
  };
  registered.set(pack.manifest.id, pack);
  return pack;
};

export const unregisterDomainPack = (id: string) => registered.delete(id);

export const listDomainPacks = () => [...registered.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));

export const getDomainPack = (id: string) => registered.get(id);

export const resolveDomainPackForSkill = (skillId: string) =>
  listDomainPacks().find((pack) => skillId.startsWith(pack.manifest.skillIdPrefix));

export const readDomainPackManifest = async (
  id: string,
  domainsRoot = defaultDomainsRoot,
): Promise<DomainPackManifest> => {
  const manifestPath = path.join(domainsRoot, id, "domain.manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  const issues = validateDomainPackManifest(manifest);
  if (issues.length > 0) throw new Error(`Invalid domain manifest at ${manifestPath}: ${issues.join("; ")}`);
  return manifest as DomainPackManifest;
};

export const inspectDomainPack = (pack: DomainPack) => ({
  ...pack.manifest,
  root: pack.root,
  ownership: pack.manifest.ownership as DomainOwnershipRule[],
});

export const resolveDomainEvalSuitePath = async (
  pack: DomainPack,
): Promise<string | undefined> => {
  const evalSuite = pack.manifest.artifacts.evalSuite;
  if (!evalSuite) return undefined;
  const resolved = path.resolve(packageRoot, evalSuite);
  if (!resolved.startsWith(`${packageRoot}${path.sep}`)) {
    throw new Error(`Domain eval suite escapes package root: ${evalSuite}`);
  }
  const stats = await stat(resolved).catch(() => undefined);
  if (!stats?.isFile()) {
    throw new Error(`Domain eval suite does not exist: ${resolved}`);
  }
  return resolved;
};

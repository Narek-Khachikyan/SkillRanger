import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { defaultDomainsRoot, packageRoot } from "../paths.ts";
import {
  objectDepth,
  normalizeMetadataToken,
  routerMetadataLimits,
  validateMetadataArray,
} from "../router/metadata.ts";
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
const domainFields = new Set(["schemaVersion", "id", "displayName", "version", "coreApi", "skillIdPrefix", "capabilities", "artifacts", "ownership", "routing"]);
const artifactFields = new Set(["intents", "schemas", "recipes", "rules", "examples", "workflows", "validators", "evalSuite", "capabilityRecords"]);
const ownershipFields = new Set(["intent", "primarySkill", "supportingSkills", "requiresEvidence"]);
const routingFields = ["aliases", "intentTags", "artifactTypes", "technologyTags", "projectTags"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim() !== "");

const safeRelativePath = (value: string) =>
  !path.isAbsolute(value) && !value.replace(/\\/g, "/").split("/").includes("..");

export const validateDomainPackManifest = (input: unknown): string[] => {
  const issues: string[] = [];
  if (!isRecord(input)) return ["domain manifest must be an object"];
  if (objectDepth(input) > routerMetadataLimits.maxObjectDepth) {
    issues.push(`domain manifest object depth must not exceed ${routerMetadataLimits.maxObjectDepth}`);
  }
  for (const key of Object.keys(input)) {
    if (!domainFields.has(key)) issues.push(`${key} is an unknown property`);
  }
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
    for (const key of Object.keys(input.artifacts)) {
      if (!artifactFields.has(key)) issues.push(`artifacts.${key} is an unknown property`);
    }
    for (const key of ["intents", "schemas", "recipes", "workflows", "validators"] as const) {
      if (!isStringArray(input.artifacts[key])) issues.push(`artifacts.${key} must be a string array`);
      else if (!input.artifacts[key].every(safeRelativePath)) issues.push(`artifacts.${key} contains an unsafe path`);
    }
    for (const key of ["rules", "examples", "capabilityRecords"] as const) {
      if (input.artifacts[key] !== undefined) {
        if (!isStringArray(input.artifacts[key])) issues.push(`artifacts.${key} must be a string array`);
        else if (!input.artifacts[key].every(safeRelativePath)) issues.push(`artifacts.${key} contains an unsafe path`);
      }
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
      for (const key of Object.keys(rule)) {
        if (!ownershipFields.has(key)) issues.push(`ownership[${index}].${key} is an unknown property`);
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
  if (input.routing !== undefined) {
    if (!isRecord(input.routing)) {
      issues.push("routing must be an object");
    } else {
      for (const key of Object.keys(input.routing)) {
        if (!routingFields.includes(key as typeof routingFields[number])) issues.push(`routing.${key} is an unknown property`);
      }
      for (const key of routingFields) {
        for (const issue of validateMetadataArray(input.routing[key], `routing.${key}`)) {
          issues.push(`${issue.path}: ${issue.message}`);
        }
      }
      if (Array.isArray(input.routing.aliases) && typeof input.id === "string") {
        input.routing.aliases.forEach((alias, index) => {
          if (typeof alias === "string" && normalizeMetadataToken(alias) === normalizeMetadataToken(input.id as string)) {
            issues.push(`routing.aliases[${index}] conflicts with the canonical domain id`);
          }
        });
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
  const manifestText = await readFile(manifestPath, "utf8");
  if (Buffer.byteLength(manifestText, "utf8") > routerMetadataLimits.maxManifestBytes) {
    throw new Error(`Domain manifest exceeds ${routerMetadataLimits.maxManifestBytes} bytes: ${manifestPath}`);
  }
  const manifest = JSON.parse(manifestText) as unknown;
  const issues = validateDomainPackManifest(manifest);
  if (issues.length > 0) throw new Error(`Invalid domain manifest at ${manifestPath}: ${issues.join("; ")}`);
  return manifest as DomainPackManifest;
};

export type BundledRouterPack = DomainPackManifest & {
  routing: NonNullable<DomainPackManifest["routing"]>;
  root: string;
};

export const loadBundledRouterPacks = async (
  domainsRoot = defaultDomainsRoot,
): Promise<BundledRouterPack[]> => {
  const entries = (await readdir(domainsRoot, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length > routerMetadataLimits.maxDomainPacks) {
    throw new Error(`Domain registry exceeds ${routerMetadataLimits.maxDomainPacks} packs`);
  }
  const packs: BundledRouterPack[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !idPattern.test(entry.name)) {
      throw new Error(`Unsupported domain registry entry: ${entry.name}`);
    }
    const manifest = await readDomainPackManifest(entry.name, domainsRoot);
    if (manifest.id !== entry.name) throw new Error(`Domain manifest id must match folder name: ${entry.name}`);
    if (!manifest.routing) throw new Error(`Domain manifest ${manifest.id} is missing router metadata`);
    packs.push({ ...manifest, routing: manifest.routing, root: path.join(domainsRoot, entry.name) });
  }

  const claimed = new Map<string, string>();
  for (const pack of packs) {
    for (const value of [pack.id, ...pack.routing.aliases]) {
      const normalized = normalizeMetadataToken(value);
      const owner = claimed.get(normalized);
      if (owner && owner !== pack.id) throw new Error(`Domain id or alias ${value} conflicts between ${owner} and ${pack.id}`);
      claimed.set(normalized, pack.id);
    }
  }
  return packs;
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

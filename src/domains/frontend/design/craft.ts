import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultDomainsRoot } from "../../../paths.ts";

export const craftReferenceKinds = [
  "type-pairing",
  "palette-recipe",
  "macrostructure",
  "component-cookbook",
] as const;

export type CraftReferenceKind = (typeof craftReferenceKinds)[number];

export type CraftEvidenceEntry = {
  statement: string;
  source?: string;
};

export type CraftEvidenceLadder = {
  observed: CraftEvidenceEntry[];
  inferred: CraftEvidenceEntry[];
  assumed: CraftEvidenceEntry[];
  unknown: CraftEvidenceEntry[];
};

export type CraftCatalog = {
  schemaVersion: "1.0";
  id: string;
  displayName: string;
  description: string;
  categories: Record<CraftReferenceKind, string>;
  provenance: CraftEvidenceLadder;
};

export type LoadedCraftCatalog = {
  catalog: CraftCatalog;
  references: Array<{ kind: CraftReferenceKind; path: string; file: string }>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
};

const catalogKeys = ["schemaVersion", "id", "displayName", "description", "categories", "provenance"] as const;
const evidenceLadderKeys = ["observed", "inferred", "assumed", "unknown"] as const;

const markdownReferencePathPattern = /^[a-z0-9][a-z0-9._-]*\.md$/;

export const validateCraftEvidenceEntry = (
  value: unknown,
  at: string,
): CraftEvidenceEntry => {
  if (!isRecord(value) || !hasOnlyKeys(value, ["statement", "source"])) {
    throw new Error(`Invalid craft evidence entry: ${at}`);
  }
  if (!isNonEmptyString(value.statement)) {
    throw new Error(`Craft evidence entry requires a non-empty statement: ${at}`);
  }
  if (value.source !== undefined && !isNonEmptyString(value.source)) {
    throw new Error(`Craft evidence entry source must be a non-empty string: ${at}`);
  }
  return value as CraftEvidenceEntry;
};

export const validateCraftEvidenceLadder = (
  value: unknown,
  at: string,
): CraftEvidenceLadder => {
  if (!isRecord(value) || !hasOnlyKeys(value, evidenceLadderKeys)) {
    throw new Error(`Craft provenance must be the observed/inferred/assumed/unknown evidence ladder: ${at}`);
  }
  const ladder = {} as CraftEvidenceLadder;
  for (const key of evidenceLadderKeys) {
    const entries = value[key];
    if (!Array.isArray(entries)) {
      throw new Error(`Craft evidence ladder requires an array for ${key}: ${at}`);
    }
    ladder[key] = entries.map((entry, index) => validateCraftEvidenceEntry(entry, `${at}.${key}[${index}]`));
  }
  return ladder;
};

// The craft corpus is deliberately rule-free: it carries no rule metadata fields.
// These are the rule-contract keys the catalog must reject so craft references can
// never be confused with (or consumed as) the six-family rule library.
const ruleContractKeys = new Set([
  "family", "ruleIds", "selectedRuleIds", "recipeIds", "constraints", "verification",
]);

export const validateCraftCatalog = (
  value: unknown,
  at = "craft catalog",
): CraftCatalog => {
  if (!isRecord(value)) throw new Error(`Invalid craft catalog: ${at}`);
  for (const key of Object.keys(value)) {
    if (ruleContractKeys.has(key)) {
      throw new Error(`Craft catalog must not carry rule-contract fields (${key}): ${at}`);
    }
  }
  if (!hasOnlyKeys(value, catalogKeys)) throw new Error(`Invalid craft catalog contract: ${at}`);
  if (value.schemaVersion !== "1.0") throw new Error(`Craft catalog schemaVersion must be 1.0: ${at}`);
  if (!isNonEmptyString(value.id)) throw new Error(`Craft catalog requires a non-empty id: ${at}`);
  if (!isNonEmptyString(value.displayName)) throw new Error(`Craft catalog requires a non-empty displayName: ${at}`);
  if (!isNonEmptyString(value.description)) throw new Error(`Craft catalog requires a non-empty description: ${at}`);
  if (!isRecord(value.categories) || !hasOnlyKeys(value.categories, craftReferenceKinds)) {
    throw new Error(`Craft catalog must declare exactly the four reference kinds: ${at}`);
  }
  const categories = value.categories as Record<CraftReferenceKind, string>;
  for (const kind of craftReferenceKinds) {
    const file = categories[kind];
    if (typeof file !== "string" || !markdownReferencePathPattern.test(file)) {
      throw new Error(`Craft catalog ${kind} must name a safe markdown reference file: ${at}`);
    }
  }
  if (new Set(Object.values(categories)).size !== craftReferenceKinds.length) {
    throw new Error(`Craft catalog must map each kind to a unique reference file: ${at}`);
  }
  const catalog = {
    schemaVersion: "1.0" as const,
    id: value.id,
    displayName: value.displayName,
    description: value.description,
    categories: Object.fromEntries(
      craftReferenceKinds.map((kind) => [kind, categories[kind]]),
    ) as CraftCatalog["categories"],
    provenance: validateCraftEvidenceLadder(value.provenance, `${at}.provenance`),
  };
  return catalog;
};

const resolveContainedPath = (root: string, relativePath: string, label: string) => {
  if (!markdownReferencePathPattern.test(relativePath)) {
    throw new Error(`${label} is not a safe markdown reference path: ${relativePath}`);
  }
  const resolved = path.resolve(root, relativePath);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes its craft root: ${relativePath}`);
  }
  return resolved;
};

export const validateCraftMarkdownProvenance = (markdown: string, file: string) => {
  const lines = markdown.split("\n").map((line) => line.trimEnd());
  const provenanceIndex = lines.findIndex((line) => line === "## Provenance");
  if (provenanceIndex === -1) {
    throw new Error(`Craft reference ${file} must include a ## Provenance section`);
  }
  const sections = ["### Observed", "### Inferred", "### Assumed", "### Unknown"] as const;
  const sectionIndices = sections.map((section) => lines.indexOf(section, provenanceIndex + 1));
  for (let i = 0; i < sections.length; i += 1) {
    const index = sectionIndices[i];
    if (index === -1) {
      throw new Error(`Craft reference ${file} must include a ${sections[i]} provenance section`);
    }
    const nextIndex = i + 1 < sections.length ? sectionIndices[i + 1] : lines.length;
    const hasEvidenceEntry = lines
      .slice(index + 1, nextIndex)
      .some((line) => line.trim() !== "" && !line.startsWith("#"));
    if (!hasEvidenceEntry) {
      throw new Error(`Craft reference ${file} must record at least one evidence entry under ${sections[i]}`);
    }
  }
};

export const loadCraftCatalog = async (
  craftRoot = path.join(defaultDomainsRoot, "frontend", "craft"),
): Promise<LoadedCraftCatalog> => {
  const root = path.resolve(craftRoot);
  const catalog = validateCraftCatalog(
    JSON.parse(await readFile(path.join(root, "craft-catalog.json"), "utf8")) as unknown,
  );
  const references = await Promise.all(
    craftReferenceKinds.map(async (kind) => {
      const file = catalog.categories[kind];
      const referencePath = resolveContainedPath(root, file, `craft ${kind}`);
      const markdown = await readFile(referencePath, "utf8");
      validateCraftMarkdownProvenance(markdown, file);
      return { kind, path: referencePath, file };
    }),
  );
  return { catalog, references };
};

let defaultCatalogCache: LoadedCraftCatalog | undefined;

export const loadCraftCatalogSync = (
  craftRoot = path.join(defaultDomainsRoot, "frontend", "craft"),
): LoadedCraftCatalog => {
  const root = path.resolve(craftRoot);
  const defaultRoot = path.resolve(defaultDomainsRoot, "frontend", "craft");
  if (root === defaultRoot && defaultCatalogCache) return defaultCatalogCache;
  const catalog = validateCraftCatalog(
    JSON.parse(readFileSync(path.join(root, "craft-catalog.json"), "utf8")) as unknown,
  );
  const references = craftReferenceKinds.map((kind) => {
    const file = catalog.categories[kind];
    const referencePath = resolveContainedPath(root, file, `craft ${kind}`);
    validateCraftMarkdownProvenance(readFileSync(referencePath, "utf8"), file);
    return { kind, path: referencePath, file };
  });
  const loaded = { catalog, references };
  if (root === defaultRoot) defaultCatalogCache = loaded;
  return loaded;
};

// Non-participation in the six-family rule-selection contract is structural: the
// rule library loader reads only the rules root, craft kinds are disjoint from the
// rule families, and the catalog schema cannot carry rule-contract fields. Tests
// assert the disjointness against the stable rule corpus directly.

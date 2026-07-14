import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultDomainsRoot } from "../../../paths.ts";
import { frontendRecipeIds } from "./catalog.ts";
import type {
  DesignRule,
  DesignRuleFamily,
  DesignRuleIndex,
  DesignRuleLibrary,
} from "./library-types.ts";
import { designRuleFamilies } from "./library-types.ts";

const families: DesignRuleFamily[] = [...designRuleFamilies];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const isNonEmptyStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
};

const ruleKeys = [
  "schemaVersion", "id", "version", "family", "name", "recipeIds", "preconditions",
  "intent", "constraints", "rolesConsumed", "responsiveBehavior", "accessibility",
  "antiPatterns", "verification", "provenance",
] as const;

const resolveContainedPath = (root: string, relativePath: string) => {
  const resolved = path.resolve(root, relativePath);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Design rule path escapes rules root: ${relativePath}`);
  }
  return resolved;
};

const validateRule = (value: unknown, family: DesignRuleFamily): DesignRule => {
  if (!isRecord(value) || !hasOnlyKeys(value, ruleKeys)) {
    throw new Error("Invalid design rule contract: unknown");
  }
  const provenanceValid = Array.isArray(value.provenance) && value.provenance.length > 0 &&
    value.provenance.every((entry) => isRecord(entry) &&
      hasOnlyKeys(entry, ["source", "reviewedAt"]) &&
      isNonEmptyString(entry.source) &&
      typeof entry.reviewedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.reviewedAt));
  if (
    value.schemaVersion !== "1.0" ||
    value.version !== "1.0.0" ||
    value.family !== family ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.intent) ||
    !isNonEmptyStringArray(value.recipeIds) ||
    !isNonEmptyStringArray(value.preconditions) ||
    !isNonEmptyStringArray(value.constraints) ||
    !isNonEmptyStringArray(value.rolesConsumed) ||
    !isNonEmptyStringArray(value.responsiveBehavior) ||
    !isNonEmptyStringArray(value.accessibility) ||
    !isNonEmptyStringArray(value.antiPatterns) ||
    !isNonEmptyStringArray(value.verification) ||
    !provenanceValid
  ) {
    throw new Error(`Invalid design rule contract: ${isNonEmptyString(value.id) ? value.id : "unknown"}`);
  }
  const rule = value as DesignRule;
  if (!rule.recipeIds.every((id) => id === "*" || frontendRecipeIds.includes(id))) {
    throw new Error(`Unknown recipe id in design rule ${rule.id}`);
  }
  return rule;
};

const parseRuleFile = (value: unknown, family: DesignRuleFamily, file: string): DesignRule[] => {
  if (!isRecord(value) || value.schemaVersion !== "1.0" || value.family !== family || !Array.isArray(value.rules)) {
    throw new Error(`Invalid design rule file: ${file}`);
  }
  return value.rules.map((rule) => validateRule(rule, family));
};

const validateIndex = (value: unknown): DesignRuleIndex => {
  if (!isRecord(value) || value.schemaVersion !== "1.0" || !isRecord(value.files) ||
    !hasOnlyKeys(value, ["schemaVersion", "files"])) {
    throw new Error("Invalid design rule index");
  }
  const declaredFamilies = Object.keys(value.files);
  if (declaredFamilies.length !== families.length || families.some((family) => !declaredFamilies.includes(family))) {
    throw new Error("Design rule index must declare all six families");
  }
  return value as DesignRuleIndex;
};

const rejectDuplicateRuleIds = (rules: DesignRule[]) => {
  const ids = new Set<string>();
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new Error(`Duplicate design rule id: ${rule.id}`);
    ids.add(rule.id);
  }
};

export const loadDesignRuleLibrary = async (
  rulesRoot = path.join(defaultDomainsRoot, "frontend", "rules"),
): Promise<DesignRuleLibrary> => {
  const root = path.resolve(rulesRoot);
  const indexPath = resolveContainedPath(root, "index.json");
  const index = validateIndex(JSON.parse(await readFile(indexPath, "utf8")) as unknown);

  const rules = (
    await Promise.all(families.map(async (family) => {
      const file = index.files[family];
      if (typeof file !== "string" || file.trim() === "") throw new Error(`Missing design rule file for ${family}`);
      const value = JSON.parse(await readFile(resolveContainedPath(root, file), "utf8")) as unknown;
      return parseRuleFile(value, family, file);
    }))
  ).flat();

  rejectDuplicateRuleIds(rules);
  return { index, rules };
};

let defaultLibraryCache: DesignRuleLibrary | undefined;

export const loadDesignRuleLibrarySync = (
  rulesRoot = path.join(defaultDomainsRoot, "frontend", "rules"),
): DesignRuleLibrary => {
  const root = path.resolve(rulesRoot);
  const defaultRoot = path.resolve(defaultDomainsRoot, "frontend", "rules");
  if (root === defaultRoot && defaultLibraryCache) return defaultLibraryCache;
  const index = validateIndex(JSON.parse(readFileSync(resolveContainedPath(root, "index.json"), "utf8")) as unknown);
  const rules = families.flatMap((family) => {
    const file = index.files[family];
    if (!isNonEmptyString(file)) throw new Error(`Missing design rule file for ${family}`);
    const value = JSON.parse(readFileSync(resolveContainedPath(root, file), "utf8")) as unknown;
    return parseRuleFile(value, family, file);
  });
  rejectDuplicateRuleIds(rules);
  const library = { index, rules };
  if (root === defaultRoot) defaultLibraryCache = library;
  return library;
};

export const selectDesignRules = (
  library: DesignRuleLibrary,
  input: { recipeId: string; families: DesignRuleFamily[] },
) => input.families.map((family) => {
  const rule = library.rules.find((candidate) =>
    candidate.family === family &&
    (candidate.recipeIds.includes(input.recipeId) || candidate.recipeIds.includes("*")),
  );
  if (!rule) throw new Error(`No compatible ${family} rule for recipe ${input.recipeId}`);
  return rule;
});

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultDomainsRoot } from "../../../paths.ts";
import { frontendRecipeIds } from "./catalog.ts";
import type {
  DesignRule,
  DesignRuleId,
  DesignRuleFamily,
  DesignRuleIndex,
  DesignRuleLibrary,
} from "./library-types.ts";
import {
  designRuleEvidenceStatuses,
  designRuleFamilies,
  designRuleIds,
  designRuleNormativeBaselines,
} from "./library-types.ts";

const families: DesignRuleFamily[] = [...designRuleFamilies];
const stableRuleIds = new Set<string>(designRuleIds);
const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const isNonEmptyStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);

const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const match = value.match(datePattern);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
};

const ruleKeys = [
  "schemaVersion", "id", "version", "family", "name", "recipeIds", "preconditions",
  "intent", "constraints", "rolesConsumed", "responsiveBehavior", "accessibility",
  "antiPatterns", "verification", "provenance",
] as const;

const provenanceKeys = [
  "source", "page", "state", "productId", "reviewedAt", "capturedAt", "extractionMethod",
  "extractionSchema", "evidenceStatus",
] as const;

const ruleFileKeys = ["schemaVersion", "family", "rules"] as const;
const normativeRuleKeys = [
  "family", "recipeIds", "preconditions", "intent", "constraints", "rolesConsumed",
  "responsiveBehavior", "accessibility", "antiPatterns", "verification",
] as const;

const resolveContainedPath = (root: string, relativePath: string) => {
  const resolved = path.resolve(root, relativePath);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Design rule path escapes rules root: ${relativePath}`);
  }
  return resolved;
};

const validateProvenance = (value: unknown, ruleId: string) => {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`Design rule provenance requires two independent sources: ${ruleId}`);
  }
  for (const entry of value) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, provenanceKeys)) {
      throw new Error(`Invalid design rule provenance: ${ruleId}`);
    }
    const suppliedDatesAreValid =
      (entry.reviewedAt === undefined || isIsoDate(entry.reviewedAt)) &&
      (entry.capturedAt === undefined || isIsoDate(entry.capturedAt));
    const hasReviewOrCaptureDate = isIsoDate(entry.reviewedAt) || isIsoDate(entry.capturedAt);
    const evidenceStatus = entry.evidenceStatus;
    if (
      !isNonEmptyString(entry.source) ||
      (entry.page !== undefined && !isNonEmptyString(entry.page)) ||
      (entry.state !== undefined && !isNonEmptyString(entry.state)) ||
      (entry.productId !== undefined && !isNonEmptyString(entry.productId)) ||
      !suppliedDatesAreValid ||
      !hasReviewOrCaptureDate ||
      !isNonEmptyString(entry.extractionMethod) ||
      !isNonEmptyString(entry.extractionSchema) ||
      typeof evidenceStatus !== "string" ||
      !designRuleEvidenceStatuses.includes(evidenceStatus as (typeof designRuleEvidenceStatuses)[number])
    ) {
      throw new Error(`Invalid design rule provenance: ${ruleId}`);
    }
  }
  if (new Set(value.map((entry) => isRecord(entry) ? entry.source : undefined)).size < 2) {
    throw new Error(`Design rule provenance requires two independent sources: ${ruleId}`);
  }
  return value;
};

const normativeDigest = (rule: Record<string, unknown>) =>
  createHash("sha256").update(JSON.stringify(normativeRuleKeys.map((key) => [key, rule[key]]))).digest("hex");

const validateRule = (value: unknown, family: DesignRuleFamily): DesignRule => {
  if (!isRecord(value) || !hasOnlyKeys(value, ruleKeys)) {
    throw new Error("Invalid design rule contract: unknown");
  }
  if (
    value.schemaVersion !== "1.1" ||
    typeof value.version !== "string" ||
    !semanticVersionPattern.test(value.version) ||
    value.family !== family ||
    !isNonEmptyString(value.id) ||
    !stableRuleIds.has(value.id) ||
    !value.id.startsWith(family === "signature-move" ? "signature." : `${family}.`) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.intent) ||
    !isNonEmptyStringArray(value.recipeIds) ||
    !isNonEmptyStringArray(value.preconditions) ||
    !isNonEmptyStringArray(value.constraints) ||
    !isNonEmptyStringArray(value.rolesConsumed) ||
    !isNonEmptyStringArray(value.responsiveBehavior) ||
    !isNonEmptyStringArray(value.accessibility) ||
    !isNonEmptyStringArray(value.antiPatterns) ||
    !isNonEmptyStringArray(value.verification)
  ) {
    if (typeof value.version === "string" && !semanticVersionPattern.test(value.version)) {
      throw new Error(`Invalid design rule semantic version: ${isNonEmptyString(value.id) ? value.id : "unknown"}`);
    }
    if (isNonEmptyString(value.id) && !stableRuleIds.has(value.id)) {
      throw new Error(`Unknown stable design rule id: ${value.id}`);
    }
    throw new Error(`Invalid design rule contract: ${isNonEmptyString(value.id) ? value.id : "unknown"}`);
  }
  validateProvenance(value.provenance, value.id);
  const rule = value as DesignRule;
  if (!rule.recipeIds.every((id) => id === "*" || frontendRecipeIds.includes(id))) {
    throw new Error(`Unknown recipe id in design rule ${rule.id}`);
  }
  return rule;
};

const validateNormativeVersions = (rules: DesignRule[]) => {
  for (const rule of rules) {
    const expected = designRuleNormativeBaselines[rule.id as DesignRuleId];
    if (expected && expected.digest !== normativeDigest(rule)) {
      if (expected.version === rule.version) {
        throw new Error(`Normative change to ${rule.id} requires an explicit semantic version change`);
      }
      const productIds = new Set(rule.provenance.map(({ productId }) => productId).filter(isNonEmptyString));
      if (productIds.size < 2) {
        throw new Error(`Normative change to ${rule.id} requires evidence from two independent products`);
      }
    }
  }
};

const validateLoadedRules = (rules: DesignRule[]) => {
  rejectDuplicateRuleIds(rules);
  validateNormativeVersions(rules);
  if (rules.length !== designRuleIds.length || designRuleIds.some((id) => !rules.some((rule) => rule.id === id))) {
    throw new Error("Design rule library must contain exactly the 18 stable rule identifiers");
  }
  return rules;
};

const parseRuleFile = (value: unknown, family: DesignRuleFamily, file: string): DesignRule[] => {
  if (!isRecord(value) || !hasOnlyKeys(value, ruleFileKeys) || value.schemaVersion !== "1.0" || value.family !== family || !Array.isArray(value.rules)) {
    throw new Error(`Invalid design rule file: ${file}`);
  }
  return value.rules.map((rule) => validateRule(rule, family));
};

const validateIndex = (value: unknown): DesignRuleIndex => {
  if (!isRecord(value) || value.schemaVersion !== "1.0" || !isRecord(value.files) ||
    !hasOnlyKeys(value, ["schemaVersion", "files"])) {
    throw new Error("Invalid design rule index");
  }
  const filesRecord = value.files as Record<string, unknown>;
  const declaredFamilies = Object.keys(filesRecord);
  if (declaredFamilies.length !== families.length || declaredFamilies.some((family, index) => family !== families[index])) {
    throw new Error("Design rule index must declare all six families in order");
  }
  const files = families.map((family) => filesRecord[family]);
  if (!files.every(isNonEmptyString) || new Set(files).size !== files.length) {
    throw new Error("Design rule index must declare one unique file for each ordered family");
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

  const loadedRuleGroups = await Promise.all(families.map(async (family) => {
    const file = index.files[family];
    if (typeof file !== "string" || file.trim() === "") throw new Error(`Missing design rule file for ${family}`);
    const value = JSON.parse(await readFile(resolveContainedPath(root, file), "utf8")) as unknown;
    return parseRuleFile(value, family, file);
  }));
  const rules = validateLoadedRules(loadedRuleGroups.flat());
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
  const rules = validateLoadedRules(families.flatMap((family) => {
    const file = index.files[family];
    if (!isNonEmptyString(file)) throw new Error(`Missing design rule file for ${family}`);
    const value = JSON.parse(readFileSync(resolveContainedPath(root, file), "utf8")) as unknown;
    return parseRuleFile(value, family, file);
  }));
  const library = { index, rules };
  if (root === defaultRoot) defaultLibraryCache = library;
  return library;
};

export const selectDesignRules = (
  library: DesignRuleLibrary,
  input: { recipeId: string; families?: readonly DesignRuleFamily[] },
) => {
  if (!frontendRecipeIds.includes(input.recipeId)) {
    throw new Error(`Unknown frontend recipe: ${input.recipeId}`);
  }
  const requestedFamilies = [...(input.families ?? families)];
  if (
    requestedFamilies.length !== families.length ||
    requestedFamilies.some((family, index) => family !== families[index])
  ) {
    throw new Error("Rule selection must choose exactly one rule from each ordered family");
  }
  return requestedFamilies.map((family) => {
    const compatible = library.rules.filter((candidate) =>
      candidate.family === family &&
      (candidate.recipeIds.includes(input.recipeId) || candidate.recipeIds.includes("*")),
    );
    const rule = compatible.find((candidate) => candidate.recipeIds.includes(input.recipeId)) ?? compatible[0];
    if (!rule) throw new Error(`No compatible ${family} rule for recipe ${input.recipeId}`);
    return rule;
  });
};

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

const families: DesignRuleFamily[] = [
  "typography",
  "layout",
  "responsive",
  "color",
  "state",
  "signature-move",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const resolveContainedPath = (root: string, relativePath: string) => {
  const resolved = path.resolve(root, relativePath);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Design rule path escapes rules root: ${relativePath}`);
  }
  return resolved;
};

const parseRuleFile = (value: unknown, family: DesignRuleFamily, file: string): DesignRule[] => {
  if (!isRecord(value) || value.schemaVersion !== "1.0" || value.family !== family || !Array.isArray(value.rules)) {
    throw new Error(`Invalid design rule file: ${file}`);
  }
  return value.rules as DesignRule[];
};

const validateRule = (rule: DesignRule, family: DesignRuleFamily) => {
  if (rule.schemaVersion !== "1.0" || rule.version !== "1.0.0" || rule.family !== family) {
    throw new Error(`Invalid design rule contract: ${rule.id ?? "unknown"}`);
  }
  if (!rule.recipeIds.every((id) => id === "*" || frontendRecipeIds.includes(id))) {
    throw new Error(`Unknown recipe id in design rule ${rule.id}`);
  }
};

export const loadDesignRuleLibrary = async (
  rulesRoot = path.join(defaultDomainsRoot, "frontend", "rules"),
): Promise<DesignRuleLibrary> => {
  const root = path.resolve(rulesRoot);
  const indexPath = resolveContainedPath(root, "index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8")) as DesignRuleIndex;
  if (!isRecord(index) || index.schemaVersion !== "1.0" || !isRecord(index.files)) {
    throw new Error("Invalid design rule index");
  }
  const declaredFamilies = Object.keys(index.files);
  if (declaredFamilies.length !== families.length || families.some((family) => !declaredFamilies.includes(family))) {
    throw new Error("Design rule index must declare all six families");
  }

  const rules = (
    await Promise.all(families.map(async (family) => {
      const file = index.files[family];
      if (typeof file !== "string" || file.trim() === "") throw new Error(`Missing design rule file for ${family}`);
      const value = JSON.parse(await readFile(resolveContainedPath(root, file), "utf8")) as unknown;
      const familyRules = parseRuleFile(value, family, file);
      familyRules.forEach((rule) => validateRule(rule, family));
      return familyRules;
    }))
  ).flat();

  const ids = new Set<string>();
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new Error(`Duplicate design rule id: ${rule.id}`);
    ids.add(rule.id);
  }
  return { index, rules };
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

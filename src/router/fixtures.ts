import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { taskActionIds, type RiskLevel, type RouterSkillRole, type TaskAction } from "./types.ts";
import type { RequiredEvidenceRef } from "../domains/types.ts";
import type { RoutingVocabularyFile } from "./vocabulary/types.ts";

export type RouterGoldenExpected = {
  status: "prepared" | "clarification_required" | "decomposition_required" | "no_matching_skills" | "strict_requirements_unmet" | "context_budget_exceeded";
  domainIds: string[];
  reasonCode?: string;
  requiredSignals?: string[];
  primarySkillId?: string;
  requiredPrimaryExclusionReasons?: Record<string, string[]>;
  requiredCompanionSkillIds?: string[];
  allowedOptionalSkillIds?: string[];
  forbiddenSkillIds?: string[];
};

export type RouterGoldenCase = {
  id: string;
  prompt: string;
  fixture: "empty" | "frontend" | "synthetic";
  registry: "bundled" | "test-fixture";
  strict: boolean;
  capabilities: string[];
  expected: RouterGoldenExpected;
};

export type RouterFixtureDomain = {
  id: string;
  displayName: string;
  targetSurface?: string;
  routing: {
    aliases: string[];
    intentTags: string[];
    artifactTypes: string[];
    technologyTags: string[];
    projectTags: string[];
  };
};

export type RouterFixturePackBase = {
  domain: RouterFixtureDomain;
  skills: Array<{
    id: string;
    displayName: string;
    version: string;
    riskLevel: RiskLevel;
    roles: RouterSkillRole[];
    domains: string[];
    actions: TaskAction[];
    artifactTypes: string[];
    intentTags: string[];
    technologyTags: string[];
    environmentSignals: string[];
    qualityGoals: string[];
    requiredCapabilities: string[];
    optionalCapabilities: string[];
    complements: string[];
    dependencies: string[];
    conflictsWith: string[];
    supersedes: string[];
    instructionBytes: number;
    strictContract: "valid" | "missing" | "input-required";
  }>;
};

export type RouterFixturePack =
  | (RouterFixturePackBase & { schemaVersion: "router-fixture-pack/1.0" })
  | (Omit<RouterFixturePackBase, "domain"> & {
      schemaVersion: "router-fixture-pack/1.1";
      domain: RouterFixtureDomain & {
        ownership?: Array<{
          intent: string;
          primarySkill: string;
          supportingSkills: string[];
          requiresEvidence?: RequiredEvidenceRef[];
        }>;
      };
      vocabulary?: RoutingVocabularyFile;
    });

const goldenStatuses = new Set<RouterGoldenExpected["status"]>([
  "prepared",
  "clarification_required",
  "decomposition_required",
  "no_matching_skills",
  "strict_requirements_unmet",
  "context_budget_exceeded",
]);
const riskLevels = new Set<RiskLevel>(["low", "medium", "high", "block"]);
const routerRoles = new Set<RouterSkillRole>(["environment", "primary", "companion", "verification", "agent-context"]);
const taskActions = new Set<TaskAction>(taskActionIds);
const strictContracts = new Set(["valid", "missing", "input-required"]);
const canonicalId = /^[a-z0-9][a-z0-9._-]{1,127}$/;

const record = (value: unknown, at: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${at} must be an object`);
  return value as Record<string, unknown>;
};

const exactKeys = (value: Record<string, unknown>, required: string[], optional: string[], at: string) => {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${at} contains unknown property ${unknown}`);
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (missing) throw new Error(`${at} is missing required property ${missing}`);
};

const string = (value: unknown, at: string) => {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${at} must be a non-empty string`);
  return value;
};

const id = (value: unknown, at: string) => {
  const result = string(value, at);
  if (!canonicalId.test(result)) throw new Error(`${at} must be a canonical ID`);
  return result;
};

const stringArray = (value: unknown, at: string, canonical = true) => {
  if (!Array.isArray(value)) throw new Error(`${at} must be an array`);
  const result = value.map((item, index) => canonical ? id(item, `${at}[${index}]`) : string(item, `${at}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${at} must contain unique values`);
  return result;
};

const enumArray = <T extends string>(value: unknown, allowed: Set<T>, at: string): T[] => {
  const result = stringArray(value, at, false);
  if (result.some((item) => !allowed.has(item as T))) throw new Error(`${at} contains an invalid value`);
  return result as T[];
};

const parseJson = async (filePath: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`invalid router fixture JSON at ${filePath}`, { cause: error });
  }
  return parsed;
};

const signalId = (value: unknown, at: string) => {
  const result = string(value, at);
  if (!/^(action|artifact|intent|technology|quality|domain|constraint|acceptance):[a-z0-9][a-z0-9._-]{0,127}$/.test(result)) {
    throw new Error(`${at} must be a canonical signal id`);
  }
  return result;
};

const stringArrayLoose = (value: unknown, at: string) => {
  if (!Array.isArray(value)) throw new Error(`${at} must be an array`);
  const result = value.map((item, index) => string(item, `${at}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${at} must contain unique values`);
  return result;
};

const validateGoldenExpected = (input: unknown, at: string): RouterGoldenExpected => {
  const expected = record(input, at);
  exactKeys(
    expected,
    ["status", "domainIds"],
    [
      "reasonCode",
      "requiredSignals",
      "primarySkillId",
      "requiredPrimaryExclusionReasons",
      "requiredCompanionSkillIds",
      "allowedOptionalSkillIds",
      "forbiddenSkillIds",
    ],
    at,
  );
  if (!goldenStatuses.has(expected.status as RouterGoldenExpected["status"])) throw new Error(`${at}.status is invalid`);
  stringArray(expected.domainIds, `${at}.domainIds`);
  if (Object.hasOwn(expected, "reasonCode")) id(expected.reasonCode, `${at}.reasonCode`);
  if (Object.hasOwn(expected, "requiredSignals")) {
    const signals = stringArrayLoose(expected.requiredSignals, `${at}.requiredSignals`);
    signals.forEach((signal, index) => signalId(signal, `${at}.requiredSignals[${index}]`));
  }
  if (Object.hasOwn(expected, "primarySkillId")) id(expected.primarySkillId, `${at}.primarySkillId`);
  if (Object.hasOwn(expected, "requiredPrimaryExclusionReasons")) {
    const reasons = record(expected.requiredPrimaryExclusionReasons, `${at}.requiredPrimaryExclusionReasons`);
    for (const [skillId, values] of Object.entries(reasons)) {
      id(skillId, `${at}.requiredPrimaryExclusionReasons.${skillId}`);
      stringArrayLoose(values, `${at}.requiredPrimaryExclusionReasons.${skillId}`);
    }
  }
  for (const key of ["requiredCompanionSkillIds", "allowedOptionalSkillIds", "forbiddenSkillIds"] as const) {
    if (Object.hasOwn(expected, key)) stringArray(expected[key], `${at}.${key}`);
  }
  return expected as unknown as RouterGoldenExpected;
};

const validateGoldenCase = (input: unknown, index: number): RouterGoldenCase => {
  const at = `router case ${index}`;
  const value = record(input, at);
  exactKeys(value, ["id", "prompt", "fixture", "registry", "strict", "capabilities", "expected"], [], at);
  id(value.id, `${at}.id`);
  string(value.prompt, `${at}.prompt`);
  if (!new Set(["empty", "frontend", "synthetic"]).has(value.fixture as string)) throw new Error(`${at}.fixture is invalid`);
  if (!new Set(["bundled", "test-fixture"]).has(value.registry as string)) throw new Error(`${at}.registry is invalid`);
  if (typeof value.strict !== "boolean") throw new Error(`${at}.strict must be a boolean`);
  stringArray(value.capabilities, `${at}.capabilities`);
  validateGoldenExpected(value.expected, `${at}.expected`);
  return structuredClone(value) as RouterGoldenCase;
};

export const loadRouterGoldenCases = async (filePath: string): Promise<RouterGoldenCase[]> => {
  const parsed = await parseJson(filePath);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("router golden cases must be a non-empty array");
  const cases = parsed.map(validateGoldenCase);
  if (new Set(cases.map(({ id: caseId }) => caseId)).size !== cases.length) throw new Error("router golden case IDs must be unique");
  return cases;
};

const validatePack = (input: unknown, filePath: string): RouterFixturePack => {
  const value = record(input, `fixture pack ${filePath}`);
  const v11 = value.schemaVersion === "router-fixture-pack/1.1";
  exactKeys(value, ["schemaVersion", "domain", "skills"], v11 ? ["vocabulary"] : [], `fixture pack ${filePath}`);
  if (value.schemaVersion !== "router-fixture-pack/1.0" && !v11) throw new Error(`fixture pack ${filePath} has an unsupported schemaVersion`);
  const domain = record(value.domain, `fixture pack ${filePath}.domain`);
  exactKeys(domain, ["id", "displayName", "routing"], v11 ? ["targetSurface", "ownership"] : ["targetSurface"], `fixture pack ${filePath}.domain`);
  const domainId = id(domain.id, `fixture pack ${filePath}.domain.id`);
  string(domain.displayName, `fixture pack ${filePath}.domain.displayName`);
  if (domain.targetSurface !== undefined) id(domain.targetSurface, `fixture pack ${filePath}.domain.targetSurface`);
  const routing = record(domain.routing, `fixture pack ${filePath}.domain.routing`);
  const routingKeys = ["aliases", "intentTags", "artifactTypes", "technologyTags", "projectTags"];
  exactKeys(routing, routingKeys, [], `fixture pack ${filePath}.domain.routing`);
  routingKeys.forEach((key) => stringArray(routing[key], `fixture pack ${filePath}.domain.routing.${key}`));
  if (!Array.isArray(value.skills)) throw new Error(`fixture pack ${filePath}.skills must be an array`);
  const skills = value.skills.map((inputSkill, index) => {
    const at = `fixture pack ${filePath}.skills[${index}]`;
    const skill = record(inputSkill, at);
    const keys = ["id", "displayName", "version", "riskLevel", "roles", "domains", "actions", "artifactTypes", "intentTags", "technologyTags", "environmentSignals", "qualityGoals", "requiredCapabilities", "optionalCapabilities", "complements", "dependencies", "conflictsWith", "supersedes", "instructionBytes", "strictContract"];
    exactKeys(skill, keys, [], at);
    id(skill.id, `${at}.id`);
    string(skill.displayName, `${at}.displayName`);
    string(skill.version, `${at}.version`);
    if (!riskLevels.has(skill.riskLevel as RiskLevel)) throw new Error(`${at}.riskLevel is invalid`);
    enumArray(skill.roles, routerRoles, `${at}.roles`);
    const domains = stringArray(skill.domains, `${at}.domains`);
    if (!domains.includes(domainId)) throw new Error(`${at}.domains must include ${domainId}`);
    enumArray(skill.actions, taskActions, `${at}.actions`);
    ["artifactTypes", "intentTags", "technologyTags", "qualityGoals", "requiredCapabilities", "optionalCapabilities", "complements", "dependencies", "conflictsWith", "supersedes"].forEach((key) => stringArray(skill[key], `${at}.${key}`));
    stringArray(skill.environmentSignals, `${at}.environmentSignals`, false);
    if (!Number.isInteger(skill.instructionBytes) || (skill.instructionBytes as number) < 1 || (skill.instructionBytes as number) > 1_000_000) throw new Error(`${at}.instructionBytes is invalid`);
    if (!strictContracts.has(skill.strictContract as string)) throw new Error(`${at}.strictContract is invalid`);
    return skill;
  });
  if (new Set(skills.map((skill) => skill.id)).size !== skills.length) throw new Error(`fixture pack ${filePath} has duplicate skill IDs`);
  if (v11 && domain.ownership !== undefined) {
    if (!Array.isArray(domain.ownership)) throw new Error(`fixture pack ${filePath}.domain.ownership must be an array`);
    for (const [index, rawRule] of domain.ownership.entries()) {
      const at = `fixture pack ${filePath}.domain.ownership[${index}]`;
      const rule = record(rawRule, at);
      exactKeys(rule, ["intent", "primarySkill", "supportingSkills"], ["requiresEvidence"], at);
      id(rule.intent, `${at}.intent`);
      const primarySkill = id(rule.primarySkill, `${at}.primarySkill`);
      const supportingSkills = stringArray(rule.supportingSkills, `${at}.supportingSkills`);
      const skillIds = new Set(skills.map((skill) => skill.id));
      if (!skillIds.has(primarySkill) || supportingSkills.some((skillId) => !skillIds.has(skillId))) throw new Error(`${at} references an unknown fixture skill`);
      if (rule.requiresEvidence !== undefined && !Array.isArray(rule.requiresEvidence)) throw new Error(`${at}.requiresEvidence must be an array`);
    }
  }
  return structuredClone(value) as RouterFixturePack;
};

export const loadRouterFixturePacks = async (root: string): Promise<RouterFixturePack[]> => {
  const entries = await readdir(root, { withFileTypes: true });
  const packs: RouterFixturePack[] = [];
  for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    if (!entry.isDirectory() || !canonicalId.test(entry.name)) throw new Error(`unsupported fixture entry ${entry.name}`);
    const packRoot = path.join(root, entry.name);
    const packEntries = await readdir(packRoot, { withFileTypes: true });
    for (const packEntry of packEntries) {
      if (packEntry.name !== "pack.json" || !packEntry.isFile()) throw new Error(`unsupported fixture entry ${packEntry.name}`);
    }
    if (!packEntries.some(({ name }) => name === "pack.json")) throw new Error(`fixture pack ${entry.name} is missing pack.json`);
    packs.push(validatePack(await parseJson(path.join(packRoot, "pack.json")), path.join(entry.name, "pack.json")));
  }
  const domainIds = packs.map(({ domain }) => domain.id);
  if (new Set(domainIds).size !== domainIds.length) throw new Error("fixture domain IDs must be unique");
  const skillIds = packs.flatMap(({ skills }) => skills.map(({ id: skillId }) => skillId));
  if (new Set(skillIds).size !== skillIds.length) throw new Error("fixture skill IDs must be unique across packs");
  return packs;
};

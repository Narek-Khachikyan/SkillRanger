import { existsSync } from "node:fs";
import path from "node:path";
import { skillLanes, type EvaluationStatus, type RiskLevel, type SkillLane, type SkillManifest } from "../types.ts";
import {
  objectDepth,
  routerMetadataLimits,
  validateEnvironmentSignal,
  validateMetadataArray,
} from "../router/metadata.ts";
import { taskActionIds, type RouterSkillRole, type TaskAction } from "../router/types.ts";

export type RegistryValidationIssue = {
  path: string;
  message: string;
};

export class RegistryValidationError extends Error {
  issues: RegistryValidationIssue[];

  constructor(message: string, issues: RegistryValidationIssue[]) {
    super(message);
    this.name = "RegistryValidationError";
    this.issues = issues;
  }
}

const riskLevels = new Set<RiskLevel>(["low", "medium", "high", "block"]);
const compatibilityLevels = new Set([
  "native",
  "convertible",
  "packageable",
  "unsupported",
]);
const installScopes = new Set(["repo", "user"]);
const evaluationStatusSet: Record<EvaluationStatus, true> = {
  none: true,
  "trigger-eval": true,
  "task-eval": true,
  "real-project-smoke": true,
  curated: true,
};
const skillLaneSet: Record<SkillLane, true> = Object.fromEntries(
  skillLanes.map((lane) => [lane, true]),
) as Record<SkillLane, true>;
const idPattern = /^[a-z0-9][a-z0-9._-]+$/;
const slugPattern = /^[a-z0-9][a-z0-9._-]*$/;
const qualityScoreFields = [
  "usefulness",
  "triggerSpecificity",
  "progressiveDisclosure",
  "verifiability",
  "maintainability",
  "portability",
];
const qualityRubricFields = [...qualityScoreFields, "safety"];
const routerRoles = new Set<RouterSkillRole>(["environment", "primary", "companion", "verification", "agent-context"]);
const taskActions = new Set<TaskAction>(taskActionIds);
const routingFields = new Set([
  "lane", "category", "roles", "domains", "actions", "artifactTypes", "intentTags",
  "technologyTags", "environmentSignals", "qualityGoals", "requiredCapabilities",
  "optionalCapabilities", "complements",
]);
const routerMetadataFields = [...routingFields].filter((field) => field !== "lane" && field !== "category");

type ValidationContext = {
  folderName?: string;
  registryRoot?: string;
  skillRoot?: string;
  skillText?: string;
};

type SkillFrontmatter = {
  name?: string;
  description?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isFiniteScore = (value: unknown) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

const averageScore = (scores: Record<string, unknown>, fields: string[]) => {
  const total = fields.reduce(
    (sum, field) =>
      sum + (typeof scores[field] === "number" ? scores[field] : 0),
    0,
  );
  return Number((total / fields.length).toFixed(2));
};

const hasPathTraversal = (value: string) => {
  const normalized = value.replace(/\\/g, "/");
  return normalized.split("/").includes("..");
};

const normalizedRelativePath = (value: string) =>
  value.replace(/\\/g, "/").replace(/^\.\//, "");

const tokenize = (value: string) =>
  new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 2),
  );

const tokenOverlap = (left: string, right: string) => {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let hits = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) hits += 1;
  }
  return hits / Math.max(leftTokens.size, rightTokens.size);
};

export const parseSkillFrontmatter = (skillText: string) => {
  const issues: RegistryValidationIssue[] = [];
  if (!skillText.startsWith("---\n")) {
    return {
      frontmatter: undefined,
      issues: [
        {
          path: "SKILL.md.frontmatter",
          message: "SKILL.md must start with frontmatter.",
        },
      ],
    };
  }

  const closingIndex = skillText.indexOf("\n---", 4);
  if (closingIndex === -1) {
    return {
      frontmatter: undefined,
      issues: [
        {
          path: "SKILL.md.frontmatter",
          message: "SKILL.md frontmatter must be closed with ---.",
        },
      ],
    };
  }

  const frontmatter: SkillFrontmatter = {};
  const lines = skillText.slice(4, closingIndex).split("\n");
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) {
      issues.push({
        path: `SKILL.md.frontmatter:${index + 2}`,
        message: "Frontmatter entries must use key: value syntax.",
      });
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (key === "name" || key === "description") {
      if (frontmatter[key] !== undefined) {
        issues.push({
          path: `SKILL.md.frontmatter.${key}`,
          message: "Duplicate frontmatter key.",
        });
      }
      frontmatter[key] = value;
    }
  }

  if (!frontmatter.name) {
    issues.push({
      path: "SKILL.md.frontmatter.name",
      message: "Frontmatter must include name.",
    });
  }
  if (!frontmatter.description) {
    issues.push({
      path: "SKILL.md.frontmatter.description",
      message: "Frontmatter must include description.",
    });
  }

  return { frontmatter, issues };
};

const requireString = (
  issues: RegistryValidationIssue[],
  manifest: Record<string, unknown>,
  key: string,
  displayPath = key,
) => {
  const value = manifest[key];
  if (typeof value !== "string" || value.trim() === "") {
    issues.push({ path: displayPath, message: "Must be a non-empty string." });
  }
};

const requireStringArray = (
  issues: RegistryValidationIssue[],
  manifest: Record<string, unknown>,
  key: string,
  displayPath = key,
) => {
  if (!isStringArray(manifest[key])) {
    issues.push({ path: displayPath, message: "Must be an array of strings." });
  }
};

export const validateSkillManifest = (
  input: unknown,
  context: ValidationContext = {},
): RegistryValidationIssue[] => {
  const issues: RegistryValidationIssue[] = [];
  if (!isRecord(input)) {
    return [{ path: "$", message: "Manifest must be a JSON object." }];
  }

  if (objectDepth(input) > routerMetadataLimits.maxObjectDepth) {
    issues.push({ path: "$", message: `Manifest object depth must not exceed ${routerMetadataLimits.maxObjectDepth}.` });
  }

  for (const key of [
    "id",
    "name",
    "displayName",
    "description",
    "version",
    "license",
  ]) {
    requireString(issues, input, key);
  }

  for (const key of [
    "stackTags",
    "taskTags",
    "supportedAgents",
    "scripts",
    "dependencies",
    "installTargets",
    "conflictsWith",
    "supersedes",
  ]) {
    requireStringArray(issues, input, key);
  }

  if (
    typeof input.id === "string" &&
    (!idPattern.test(input.id) || hasPathTraversal(input.id))
  ) {
    issues.push({
      path: "id",
      message: "Must be a safe registry id like domain.skill-name.",
    });
  }

  if (
    typeof input.name === "string" &&
    (!slugPattern.test(input.name) ||
      input.name === "." ||
      input.name === ".." ||
      hasPathTraversal(input.name))
  ) {
    issues.push({ path: "name", message: "Must be a safe install slug." });
  }

  if (
    context.folderName &&
    typeof input.id === "string" &&
    input.id !== context.folderName
  ) {
    issues.push({
      path: "id",
      message: `Must match skill folder name (${context.folderName}).`,
    });
  }

  if (context.skillText) {
    const parsed = parseSkillFrontmatter(context.skillText);
    issues.push(...parsed.issues);
    const frontmatter = parsed.frontmatter;
    if (
      frontmatter?.name &&
      typeof input.name === "string" &&
      frontmatter.name !== input.name
    ) {
      issues.push({
        path: "SKILL.md.frontmatter.name",
        message: "Must match manifest name.",
      });
    }
    if (
      frontmatter?.description &&
      typeof input.description === "string" &&
      tokenOverlap(frontmatter.description, input.description) < 0.6
    ) {
      issues.push({
        path: "SKILL.md.frontmatter.description",
        message: "Must describe the same intent as manifest description.",
      });
    }
  }

  if (
    typeof input.riskLevel !== "string" ||
    !riskLevels.has(input.riskLevel as RiskLevel)
  ) {
    issues.push({
      path: "riskLevel",
      message: "Must be one of low, medium, high, block.",
    });
  }

  if (input.routing !== undefined) {
    if (!isRecord(input.routing)) {
      issues.push({ path: "routing", message: "Must be an object when present." });
    } else {
      const routing = input.routing;
      for (const key of Object.keys(routing)) {
        if (!routingFields.has(key)) issues.push({ path: `routing.${key}`, message: "Unknown routing property." });
      }
      if (
        typeof routing.lane !== "string" ||
        !skillLaneSet[routing.lane as SkillLane]
      ) {
        issues.push({
          path: "routing.lane",
          message:
            "Must be one of framework, design, implementation, qa, or agent-context.",
        });
      }
      if (
        typeof routing.category !== "string" ||
        routing.category.trim() === "" ||
        !slugPattern.test(routing.category) ||
        hasPathTraversal(routing.category)
      ) {
        issues.push({
          path: "routing.category",
          message: "Must be a non-empty safe category slug.",
        });
      }
      const hasRouterMetadata = routerMetadataFields.some((field) => routing[field] !== undefined);
      if (hasRouterMetadata) {
        for (const field of routerMetadataFields) {
          if (routing[field] === undefined) {
            issues.push({ path: `routing.${field}`, message: "Required when universal router metadata is declared." });
          }
        }
        issues.push(...validateMetadataArray(routing.roles, "routing.roles", { allowed: routerRoles }));
        issues.push(...validateMetadataArray(routing.domains, "routing.domains"));
        issues.push(...validateMetadataArray(routing.actions, "routing.actions", { allowed: taskActions }));
        for (const field of ["artifactTypes", "intentTags", "technologyTags", "qualityGoals", "requiredCapabilities", "optionalCapabilities", "complements"] as const) {
          issues.push(...validateMetadataArray(routing[field], `routing.${field}`));
        }
        if (Array.isArray(routing.environmentSignals)) {
          if (routing.environmentSignals.length > routerMetadataLimits.maxArrayItems) {
            issues.push({ path: "routing.environmentSignals", message: `Must contain at most ${routerMetadataLimits.maxArrayItems} items.` });
          }
          const normalizedSignals = new Set<string>();
          routing.environmentSignals.forEach((signal, index) => {
            if (typeof signal !== "string") {
              issues.push({ path: `routing.environmentSignals.${index}`, message: "Must be a string." });
              return;
            }
            const normalized = signal.normalize("NFKC").toLowerCase();
            if (normalizedSignals.has(normalized)) {
              issues.push({ path: "routing.environmentSignals", message: "Values must be unique after NFKC lowercase normalization." });
            }
            normalizedSignals.add(normalized);
            issues.push(...validateEnvironmentSignal(signal, `routing.environmentSignals.${index}`));
          });
        } else {
          issues.push({ path: "routing.environmentSignals", message: "Must be an array of strings." });
        }
        if (Array.isArray(routing.complements)) {
          routing.complements.forEach((skillId, index) => {
            if (skillId === input.id) issues.push({ path: `routing.complements.${index}`, message: "A skill cannot complement itself." });
            if (Array.isArray(input.conflictsWith) && input.conflictsWith.includes(skillId)) {
              issues.push({ path: `routing.complements.${index}`, message: "A complement cannot also conflict with this skill." });
            }
          });
        }
      }
    }
  }

  if (Array.isArray(input.dependencies) && Array.isArray(input.conflictsWith)) {
    const conflictsWith = input.conflictsWith;
    const conflictingDependency = input.dependencies.find((skillId) => conflictsWith.includes(skillId));
    if (conflictingDependency) issues.push({ path: "dependencies", message: `Dependency also appears in conflictsWith: ${conflictingDependency}.` });
  }

  for (const key of ["qualityScore", "securityScore"]) {
    if (!isFiniteScore(input[key])) {
      issues.push({ path: key, message: "Must be a number from 0 to 1." });
    }
  }

  if (input.quality !== undefined) {
    if (!isRecord(input.quality)) {
      issues.push({
        path: "quality",
        message: "Must be an object when present.",
      });
    } else {
      const quality = input.quality;
      if (quality.rubricVersion !== "1.0") {
        issues.push({ path: "quality.rubricVersion", message: "Must be 1.0." });
      }
      if (!isRecord(quality.scores)) {
        issues.push({ path: "quality.scores", message: "Must be an object." });
      } else {
        const qualityScores = quality.scores;
        for (const field of qualityRubricFields) {
          if (!isFiniteScore(qualityScores[field])) {
            issues.push({
              path: `quality.scores.${field}`,
              message: "Must be a number from 0 to 1.",
            });
          }
        }
        if (
          typeof input.qualityScore === "number" &&
          qualityScoreFields.every((field) =>
            isFiniteScore(qualityScores[field]),
          )
        ) {
          const derivedQualityScore = averageScore(
            qualityScores,
            qualityScoreFields,
          );
          if (Math.abs(input.qualityScore - derivedQualityScore) > 0.005) {
            issues.push({
              path: "qualityScore",
              message: `Must equal derived quality rubric score ${derivedQualityScore.toFixed(2)}.`,
            });
          }
        }
      }
    }
  }

  if (input.evaluation !== undefined) {
    if (!isRecord(input.evaluation)) {
      issues.push({
        path: "evaluation",
        message: "Must be an object when present.",
      });
    } else {
      const evaluation = input.evaluation;
      if (
        typeof evaluation.status !== "string" ||
        !evaluationStatusSet[evaluation.status as EvaluationStatus]
      ) {
        issues.push({
          path: "evaluation.status",
          message: "Must be one of none, trigger-eval, task-eval, real-project-smoke, or curated.",
        });
      }
      if (
        evaluation.lastRunAt !== undefined &&
        (typeof evaluation.lastRunAt !== "string" || Number.isNaN(Date.parse(evaluation.lastRunAt)))
      ) {
        issues.push({
          path: "evaluation.lastRunAt",
          message: "Must be a parseable date string when present.",
        });
      }
      for (const key of ["benchmarkVersion", "evidenceUri"]) {
        const value = evaluation[key];
        if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
          issues.push({ path: `evaluation.${key}`, message: "Must be a non-empty string when present." });
        }
      }
      if (evaluation.score !== undefined && !isFiniteScore(evaluation.score)) {
        issues.push({ path: "evaluation.score", message: "Must be a number from 0 to 1 when present." });
      }
    }
  }

  if (input.verification !== undefined) {
    if (!isRecord(input.verification)) {
      issues.push({ path: "verification", message: "Must be an object when present." });
    } else {
      if (
        !isStringArray(input.verification.requiredCapabilities) ||
        input.verification.requiredCapabilities.length === 0
      ) {
        issues.push({
          path: "verification.requiredCapabilities",
          message: "Must be a non-empty array of strings.",
        });
      }
      if (
        input.verification.fallback !== "unverified" &&
        input.verification.fallback !== "blocked"
      ) {
        issues.push({
          path: "verification.fallback",
          message: "Must be unverified or blocked.",
        });
      }
    }
  }

  if (input.execution !== undefined) {
    if (!isRecord(input.execution)) {
      issues.push({ path: "execution", message: "Must be an object when present." });
    } else {
      const execution = input.execution;
      const v1Fields = ["contractVersion", "inputSchema", "outputSchema", "workflow", "gates", "evals", "modelProfiles"] as const;
      const v2Fields = ["contractVersion", "contract", "inputSchema", "outputSchema", "evals", "modelProfiles"] as const;
      const allowedExecutionFields = new Set([...v1Fields, "contract", "sharedContracts"]);
      const unknownExecutionField = Object.keys(input.execution).find((key) => !allowedExecutionFields.has(key as typeof v1Fields[number] | "contract" | "sharedContracts"));
      if (unknownExecutionField) issues.push({ path: `execution.${unknownExecutionField}`, message: "Unknown execution property." });
      const structuredExecution = [...v1Fields, "contract" as const].some((key) => execution[key] !== undefined);
      if (!structuredExecution && input.execution.sharedContracts === undefined) {
        issues.push({ path: "execution", message: "Must be a complete structured execution contract or declare sharedContracts." });
      }
      if (structuredExecution) {
        const requiredFields = execution.contractVersion === "2.0" ? v2Fields : v1Fields;
        for (const key of requiredFields) {
          if (input.execution[key] === undefined) issues.push({ path: `execution.${key}`, message: "Required for structured execution." });
        }
      }
      if (structuredExecution && input.execution.contractVersion !== "1.0" && input.execution.contractVersion !== "2.0") {
        issues.push({ path: "execution.contractVersion", message: "Must be 1.0 or 2.0." });
      }
      const pathFields = execution.contractVersion === "2.0"
        ? ["contract", "inputSchema", "outputSchema", "workflow", "gates", "evals"] as const
        : ["inputSchema", "outputSchema", "workflow", "gates", "evals"] as const;
      for (const key of pathFields) {
        if (!structuredExecution) continue;
        const value = input.execution[key];
        if (execution.contractVersion === "2.0" && (key === "workflow" || key === "gates") && value === undefined) continue;
        if (
          typeof value !== "string" ||
          value.trim() === "" ||
          path.isAbsolute(value) ||
          hasPathTraversal(value)
        ) {
          issues.push({ path: `execution.${key}`, message: "Must be a safe relative path." });
        } else if (context.skillRoot && !existsSync(path.join(context.skillRoot, value))) {
          issues.push({ path: `execution.${key}`, message: `Referenced file does not exist: ${value}.` });
        }
      }
      if (input.execution.sharedContracts !== undefined) {
        const contracts = input.execution.sharedContracts;
        const contractPattern = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
        if (!isStringArray(contracts) || contracts.length === 0) {
          issues.push({ path: "execution.sharedContracts", message: "Must be a non-empty array of shared contract ids." });
        } else {
          contracts.forEach((contract, index) => {
            if (!contractPattern.test(contract) || hasPathTraversal(contract)) {
              issues.push({ path: `execution.sharedContracts.${index}`, message: "Must be a safe domain/contract id." });
            }
          });
          if (new Set(contracts).size !== contracts.length) {
            issues.push({ path: "execution.sharedContracts", message: "Shared contract ids must be unique." });
          }
        }
      }
      const profiles = input.execution.modelProfiles;
      const allowedProfiles = new Set(["constrained", "standard", "advanced"]);
      if (
        structuredExecution && (!isStringArray(profiles) ||
        profiles.length === 0 ||
        !profiles.every((profile) => allowedProfiles.has(profile)))
      ) {
        issues.push({
          path: "execution.modelProfiles",
          message: "Must contain constrained, standard, or advanced profiles.",
        });
      }
    }
  }

  if (!isRecord(input.source)) {
    issues.push({ path: "source", message: "Must be an object." });
  } else {
    for (const key of ["type", "registry", "path"]) {
      requireString(issues, input.source, key, `source.${key}`);
    }

    if (typeof input.source.path === "string") {
      if (
        path.isAbsolute(input.source.path) ||
        hasPathTraversal(input.source.path)
      ) {
        issues.push({
          path: "source.path",
          message: "Must be a relative path without traversal.",
        });
      }

      if (context.registryRoot && context.skillRoot) {
        const expected = normalizedRelativePath(
          path.relative(path.dirname(context.registryRoot), context.skillRoot),
        );
        if (normalizedRelativePath(input.source.path) !== expected) {
          issues.push({
            path: "source.path",
            message: `Must point at ${expected}.`,
          });
        }
      }
    }
  }

  if (input.compatibility !== undefined) {
    if (!isRecord(input.compatibility)) {
      issues.push({
        path: "compatibility",
        message: "Must be an object when present.",
      });
    } else {
      for (const [agent, entry] of Object.entries(input.compatibility)) {
        if (!agent.trim()) {
          issues.push({
            path: "compatibility",
            message: "Agent keys must be non-empty.",
          });
          continue;
        }
        if (!isRecord(entry)) {
          issues.push({
            path: `compatibility.${agent}`,
            message: "Must be an object.",
          });
          continue;
        }
        if (
          typeof entry.level !== "string" ||
          !compatibilityLevels.has(entry.level)
        ) {
          issues.push({
            path: `compatibility.${agent}.level`,
            message:
              "Must be native, convertible, packageable, or unsupported.",
          });
        }
        if (
          entry.scopes !== undefined &&
          (!isStringArray(entry.scopes) ||
            !entry.scopes.every((scope) => installScopes.has(scope)))
        ) {
          issues.push({
            path: `compatibility.${agent}.scopes`,
            message: "Must be an array of repo/user scopes when present.",
          });
        }
        if (
          entry.adapter !== undefined &&
          (typeof entry.adapter !== "string" || entry.adapter.trim() === "")
        ) {
          issues.push({
            path: `compatibility.${agent}.adapter`,
            message: "Must be a non-empty string when present.",
          });
        }
        if (
          entry.requiresAdapter !== undefined &&
          typeof entry.requiresAdapter !== "boolean"
        ) {
          issues.push({
            path: `compatibility.${agent}.requiresAdapter`,
            message: "Must be a boolean when present.",
          });
        }
        if (entry.requires !== undefined && !isStringArray(entry.requires)) {
          issues.push({
            path: `compatibility.${agent}.requires`,
            message: "Must be an array of strings when present.",
          });
        }
      }

      if (isStringArray(input.supportedAgents)) {
        for (const agent of input.supportedAgents) {
          const compatibility = input.compatibility[agent];
          if (!isRecord(compatibility) || compatibility.level !== "native") {
            issues.push({
              path: `compatibility.${agent}`,
              message:
                "supportedAgents entries must have native compatibility.",
            });
          }
        }
      }
    }
  }

  if (!isRecord(input.permissions)) {
    issues.push({ path: "permissions", message: "Must be an object." });
  } else {
    if (!isStringArray(input.permissions.filesystem)) {
      issues.push({
        path: "permissions.filesystem",
        message: "Must be an array of strings.",
      });
    }
    if (typeof input.permissions.network !== "boolean") {
      issues.push({
        path: "permissions.network",
        message: "Must be a boolean.",
      });
    }
    if (typeof input.permissions.shell !== "boolean") {
      issues.push({ path: "permissions.shell", message: "Must be a boolean." });
    }
    if (
      input.permissions.writes !== undefined &&
      !isStringArray(input.permissions.writes)
    ) {
      issues.push({
        path: "permissions.writes",
        message: "Must be an array of strings when present.",
      });
    }
  }

  if (!isRecord(input.maintainer)) {
    issues.push({ path: "maintainer", message: "Must be an object." });
  } else {
    for (const key of ["name", "trustTier"]) {
      requireString(issues, input.maintainer, key, `maintainer.${key}`);
    }
  }

  if (input.freshness !== undefined) {
    if (!isRecord(input.freshness)) {
      issues.push({
        path: "freshness",
        message: "Must be an object when present.",
      });
    } else {
      const reviewedAt = input.freshness.lastReviewedAt;
      if (
        reviewedAt !== undefined &&
        (typeof reviewedAt !== "string" || Number.isNaN(Date.parse(reviewedAt)))
      ) {
        issues.push({
          path: "freshness.lastReviewedAt",
          message: "Must be a parseable date string when present.",
        });
      }
      const versions = input.freshness.targetFrameworkVersions;
      if (versions !== undefined && !isRecord(versions)) {
        issues.push({
          path: "freshness.targetFrameworkVersions",
          message: "Must be an object when present.",
        });
      }
    }
  }

  return issues;
};

export const extractMarkdownLinks = (
  skillText: string,
): Array<{ path: string; lineNumber: number }> => {
  const links: Array<{ path: string; lineNumber: number }> = [];
  const lines = skillText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const refMatch = line.match(/^\[([^\]]+)\]:\s*(\S+)/);
    if (refMatch) {
      links.push({ path: refMatch[2], lineNumber: i + 1 });
      continue;
    }
    const inlineRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = inlineRegex.exec(line)) !== null) {
      links.push({ path: match[2], lineNumber: i + 1 });
    }
  }
  return links;
};

const isExternalOrAnchorPath = (value: string): boolean =>
  /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value) ||
  /^mailto:/i.test(value) ||
  value.startsWith("#");

const OVERSIZED_THRESHOLD = 200;

const markdownDestination = (rawValue: string) => {
  const trimmed = rawValue.trim();
  if (trimmed.startsWith("<")) {
    const closing = trimmed.indexOf(">");
    return closing === -1 ? trimmed : trimmed.slice(1, closing);
  }
  return trimmed.match(/^(\S+)(?:\s+["'(].*)?$/)?.[1] ?? trimmed;
};

export const validateSkillReferences = (
  skillText: string,
  skillRoot: string,
  materializedSharedContractPaths: ReadonlySet<string> = new Set(),
): RegistryValidationIssue[] => {
  const issues: RegistryValidationIssue[] = [];
  const links = extractMarkdownLinks(skillText);
  for (const { path: rawLinkPath, lineNumber } of links) {
    const linkPath = markdownDestination(rawLinkPath);
    if (isExternalOrAnchorPath(linkPath)) continue;
    const filePath = linkPath.split(/[?#]/, 1)[0] ?? linkPath;
    if (hasPathTraversal(filePath)) {
      issues.push({
        path: `SKILL.md:${lineNumber}`,
        message: `Reference path traversal not allowed: ${filePath}.`,
      });
      continue;
    }
    const resolved = path.resolve(skillRoot, filePath);
    if (!resolved.startsWith(skillRoot + path.sep) && resolved !== skillRoot) {
      issues.push({
        path: `SKILL.md:${lineNumber}`,
        message: `Reference path escapes skill package: ${linkPath}.`,
      });
      continue;
    }
    const materializedSharedContract = /^references\/shared\/[a-z0-9][a-z0-9._-]*--[a-z0-9][a-z0-9._-]*\.md$/.test(filePath);
    if (!existsSync(resolved) && !(materializedSharedContract && materializedSharedContractPaths.has(filePath))) {
      issues.push({
        path: `SKILL.md:${lineNumber}`,
        message: `Reference path does not resolve: ${linkPath}.`,
      });
    }
  }
  return issues;
};

export const validateContentContracts = (
  skillText: string,
): RegistryValidationIssue[] => {
  const issues: RegistryValidationIssue[] = [];
  const hasTrigger = /\bUse\s+(this\s+)?skill\s+(?:when|for|to)\b/i.test(
    skillText,
  );
  const hasNonTrigger = /\bDo\s+not\s+use\b/i.test(skillText);
  if (!hasTrigger && !hasNonTrigger) {
    issues.push({
      path: "SKILL.md.content",
      message:
        "Must define an explicit trigger/non-trigger boundary (use when / do not use).",
    });
  }
  const requiredSections = [
    { heading: "Workflow" },
    { heading: "Validation" },
    { heading: "Output Contract" },
  ];
  for (const { heading } of requiredSections) {
    if (!skillText.includes(`## ${heading}`)) {
      issues.push({
        path: "SKILL.md.content",
        message: `Must include a ## ${heading} section.`,
      });
    }
  }
  const hasReferencesSection = skillText.includes("## References");
  const hasNoReferencesJustification = /\bno\s+packaged\s+references?\b/i.test(
    skillText,
  );
  if (!hasReferencesSection && !hasNoReferencesJustification) {
    issues.push({
      path: "SKILL.md.content",
      message:
        "Must include a ## References section or an explicit 'no packaged references' justification.",
    });
  }
  return issues;
};

export const validateLaneAwareContracts = (
  skillText: string,
  lane?: string,
  requiredCapabilities: string[] = [],
): RegistryValidationIssue[] => {
  const issues: RegistryValidationIssue[] = [];
  const requiresRenderedEvidence = requiredCapabilities.some((capability) =>
    ["browser", "screenshots", "lighthouse", "measurement"].includes(
      capability,
    ),
  );
  const hasVerificationOutcome = /## Verification Outcome/.test(skillText);
  if ((lane === "design" || requiresRenderedEvidence) && !hasVerificationOutcome) {
    issues.push({
      path: "SKILL.md.content",
      message:
        "Design lane skills and skills that require rendered evidence must include a ## Verification Outcome section.",
    });
  }
  return issues;
};

export const validateOversizedSkill = (
  skillText: string,
): RegistryValidationIssue[] => {
  const issues: RegistryValidationIssue[] = [];
  const lines = skillText.split("\n").length;
  if (lines > OVERSIZED_THRESHOLD) {
    issues.push({
      path: "SKILL.md",
      message: `SKILL.md is ${lines} lines (threshold: ${OVERSIZED_THRESHOLD}). Consider splitting references into separate files.`,
    });
  }
  return issues;
};

export const validateCrossSkillReferences = (
  skills: Array<{
    manifest: { id: string; conflictsWith: string[] };
  }>,
): RegistryValidationIssue[] => {
  const issues: RegistryValidationIssue[] = [];
  const allIds = new Set(skills.map((s) => s.manifest.id));
  for (const skill of skills) {
    for (const ref of skill.manifest.conflictsWith) {
      if (ref && !allIds.has(ref)) {
        issues.push({
          path: `skills/${skill.manifest.id}/skill.manifest.json`,
          message: `conflictsWith references unknown skill id: ${ref}.`,
        });
      }
    }
  }
  return issues;
};

export const validateSkillContent = (
  skillText: string,
  skillRoot: string,
  context: {
    lane?: string;
    skillId?: string;
    requiredCapabilities?: string[];
    enforceContracts?: boolean;
    materializedSharedContractPaths?: ReadonlySet<string>;
  } = {},
): RegistryValidationIssue[] => {
  const issues: RegistryValidationIssue[] = [];
  issues.push(...validateSkillReferences(skillText, skillRoot, context.materializedSharedContractPaths));
  if (context.enforceContracts === false) return issues;
  issues.push(...validateContentContracts(skillText));
  issues.push(
    ...validateLaneAwareContracts(
      skillText,
      context.lane,
      context.requiredCapabilities,
    ),
  );
  if (context.skillId) {
    issues.push(...validateOversizedSkill(skillText));
  }
  return issues;
};


export const assertValidSkillManifest = (
  input: unknown,
  manifestPath: string,
  context: ValidationContext = {},
): SkillManifest => {
  const issues = validateSkillManifest(input, context);
  if (issues.length > 0) {
    const detail = issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    throw new RegistryValidationError(
      `Invalid skill manifest at ${manifestPath}: ${detail}`,
      issues,
    );
  }
  return input as SkillManifest;
};

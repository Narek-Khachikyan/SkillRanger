import path from "node:path";
import { auditSkill } from "../../audit/index.ts";
import { getAdapter } from "../../installers/codex.ts";
import { readLockfile } from "../../lockfile/index.ts";
import { findSkill } from "../../registry/index.ts";
import type { McpToolDefinition, McpToolHandler } from "./types.ts";
import { McpToolError } from "./types.ts";
import {
  asInstallScope,
  asString,
  codedErrorToolResult,
  jsonToolResult,
  projectRootProperty,
  registryRootProperty,
  requireString,
  requireStringArray,
  resolveRegistryRoot,
  sameStrings
} from "./utils.ts";

export const installToolDefinitions: McpToolDefinition[] = [
  {
    name: "list_installed_skills",
    title: "List Installed Skills",
    description: "Read a project's SkillRanger lockfile and return installed skill entries.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: projectRootProperty
      },
      additionalProperties: false
    }
  },
  {
    name: "plan_skill_install",
    title: "Plan Skill Install",
    description: "Return a dry-run install plan for a skill without writing files or updating the lockfile.",
    inputSchema: {
      type: "object",
      properties: {
        skillId: {
          type: "string",
          description: "Registry skill id to plan installing."
        },
        projectRoot: projectRootProperty,
        registryRoot: registryRootProperty,
        targetAgent: {
          type: "string",
          description: "Target agent id. Defaults to codex."
        },
        scope: {
          type: "string",
          enum: ["repo", "user"],
          description: "Install scope. Defaults to repo."
        }
      },
      required: ["skillId"],
      additionalProperties: false
    }
  },
  {
    name: "install_skill",
    title: "Install Skill",
    description:
      "Install a skill only after explicit confirmation and an exact match with a prior dry-run plan. Writes skill files and updates the lockfile.",
    inputSchema: {
      type: "object",
      properties: {
        skillId: {
          type: "string",
          description: "Registry skill id to install."
        },
        projectRoot: projectRootProperty,
        registryRoot: registryRootProperty,
        targetAgent: {
          type: "string",
          description: "Target agent id. Defaults to codex."
        },
        scope: {
          type: "string",
          enum: ["repo", "user"],
          description: "Install scope. Defaults to repo."
        },
        confirm: {
          type: "boolean",
          description: "Must be true. Hosts should expose this as an explicit user-approved action."
        },
        expectedWrites: {
          type: "array",
          items: { type: "string" },
          description: "The writes array returned by plan_skill_install."
        },
        expectedLockfileUpdates: {
          type: "array",
          items: { type: "string" },
          description: "The lockfileUpdates array returned by plan_skill_install."
        }
      },
      required: ["skillId", "confirm", "expectedWrites", "expectedLockfileUpdates"],
      additionalProperties: false
    }
  }
];

const listInstalledSkills: McpToolHandler = async (args) => {
  const projectRoot = path.resolve(asString(args.projectRoot, "."));
  return jsonToolResult({
    projectRoot,
    installed: (await readLockfile(projectRoot)).installed
  });
};

const planSkillInstall: McpToolHandler = async (args) => {
  const skillId = requireString(args.skillId, "skillId");
  const projectRoot = path.resolve(asString(args.projectRoot, "."));
  const registryRoot = resolveRegistryRoot(args.registryRoot);
  const targetAgent = asString(args.targetAgent, "codex");
  const scope = asInstallScope(args.scope);
  const skill = await findSkill(skillId, registryRoot);
  if (!skill) throw new McpToolError("skill-not-found", `Skill not found: ${skillId}`, { skillId });
  const plan = await getAdapter(targetAgent).planInstall(skill, {
    projectRoot,
    targetAgent,
    scope,
    dryRun: true
  });
  return jsonToolResult({
    projectRoot,
    plan
  });
};

const installSkill: McpToolHandler = async (args) => {
  if (args.confirm !== true) {
    throw new McpToolError("confirmation-required", "install_skill requires confirm: true after reviewing plan_skill_install output.");
  }
  const skillId = requireString(args.skillId, "skillId");
  const projectRoot = path.resolve(asString(args.projectRoot, "."));
  const registryRoot = resolveRegistryRoot(args.registryRoot);
  const targetAgent = asString(args.targetAgent, "codex");
  const scope = asInstallScope(args.scope);
  const expectedWrites = requireStringArray(args.expectedWrites, "expectedWrites");
  const expectedLockfileUpdates = requireStringArray(args.expectedLockfileUpdates, "expectedLockfileUpdates");
  const skill = await findSkill(skillId, registryRoot);
  if (!skill) throw new McpToolError("skill-not-found", `Skill not found: ${skillId}`, { skillId });
  const adapter = getAdapter(targetAgent);
  const planned = await adapter.planInstall(skill, {
    projectRoot,
    targetAgent,
    scope,
    dryRun: true
  });

  if (!sameStrings(expectedWrites, planned.writes)) {
    throw new McpToolError("stale-plan", "expectedWrites does not match the current install plan.", {
      field: "expectedWrites",
      expectedWrites,
      currentWrites: planned.writes
    });
  }
  if (!sameStrings(expectedLockfileUpdates, planned.lockfileUpdates)) {
    throw new McpToolError("stale-plan", "expectedLockfileUpdates does not match the current install plan.", {
      field: "expectedLockfileUpdates",
      expectedLockfileUpdates,
      currentLockfileUpdates: planned.lockfileUpdates
    });
  }

  const audit = await auditSkill(skill);
  if (audit.riskLevel === "block") {
    return codedErrorToolResult("audit-blocked", `Blocked install for ${skill.manifest.id}: audit risk is block.`, {
      reason: "audit-blocked",
      projectRoot,
      plan: planned,
      audit
    });
  }

  const appliedPlan = await adapter.applyInstall(skill, {
    projectRoot,
    targetAgent,
    scope,
    dryRun: false
  });
  const installed = (await readLockfile(projectRoot)).installed.find(
    (entry) => entry.skillId === skill.manifest.id && entry.targetAgent === targetAgent && entry.scope === scope
  );
  return jsonToolResult({
    ok: true,
    projectRoot,
    plan: appliedPlan,
    audit,
    installed
  });
};

export const installToolHandlers: Record<string, McpToolHandler> = {
  list_installed_skills: listInstalledSkills,
  plan_skill_install: planSkillInstall,
  install_skill: installSkill
};

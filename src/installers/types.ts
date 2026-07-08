import type { InstallPlan, InstallScope, RegistrySkill } from "../types.ts";

export type InstallMode = "copy" | "symlink";

export type InstallInput = {
  projectRoot: string;
  targetAgent: string;
  scope: InstallScope;
  dryRun: boolean;
  mode?: InstallMode;
};

export type AgentAdapter = {
  id: string;
  planInstall(skill: RegistrySkill, input: InstallInput): Promise<InstallPlan>;
  applyInstall(skill: RegistrySkill, input: InstallInput): Promise<InstallPlan>;
};

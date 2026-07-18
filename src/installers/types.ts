import type {
  AuditReport,
  InstalledSkill,
  InstallPlan,
  InstallScope,
  RegistrySkill,
} from "../types.ts";

export type InstallMode = "copy" | "symlink";

export type InstallInput = {
  projectRoot: string;
  targetAgent: string;
  scope: InstallScope;
  dryRun: boolean;
  mode?: InstallMode;
};

export type ApplyInstallInput = Omit<InstallInput, "dryRun"> & { dryRun: false };

export type InstallApplyResult = {
  plan: InstallPlan;
  audit: AuditReport;
  installed: InstalledSkill;
};

export class InstallAuditBlockedError extends Error {
  readonly code = "audit-blocked";
  readonly plan: InstallPlan;
  readonly audit: AuditReport;

  constructor(plan: InstallPlan, audit: AuditReport) {
    super(`Blocked install for ${audit.skillId}: audit risk is block.`);
    this.name = "InstallAuditBlockedError";
    this.plan = plan;
    this.audit = audit;
  }
}

export type AgentAdapter = {
  id: string;
  planInstall(skill: RegistrySkill, input: InstallInput): Promise<InstallPlan>;
  applyInstall(skill: RegistrySkill, input: ApplyInstallInput): Promise<InstallApplyResult>;
};

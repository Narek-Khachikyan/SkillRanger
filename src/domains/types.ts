import type { ProjectFingerprint, Recommendation, RegistrySkill, SkillLane } from "../types.ts";
import type { SkillRunPolicyDecision } from "../runtime/skill-run/types.ts";

export type DomainCapability =
  | "project-signals"
  | "intent-routing"
  | "structured-artifacts"
  | "verification"
  | "repair"
  | "evaluation";

export type DomainOwnershipRule = {
  intent: string;
  primarySkill: string;
  supportingSkills: string[];
  requiresEvidence?: string[];
};

export type DomainRoutingMetadata = {
  aliases: string[];
  intentTags: string[];
  artifactTypes: string[];
  technologyTags: string[];
  projectTags: string[];
};

export type DomainPackManifest = {
  schemaVersion: "1.0";
  id: string;
  displayName: string;
  version: string;
  coreApi: string;
  skillIdPrefix: string;
  capabilities: DomainCapability[];
  artifacts: {
    intents: string[];
    schemas: string[];
    recipes: string[];
    rules?: string[];
    examples?: string[];
    workflows: string[];
    validators: string[];
    evalSuite?: string;
    capabilityRecords?: string[];
  };
  ownership: DomainOwnershipRule[];
  routing?: DomainRoutingMetadata;
};

export type DomainRoutingPolicy = {
  rejectIntent(intent?: string): boolean;
  laneAdjustment(lane: SkillLane, intent?: string): number;
  skillAdjustment(skill: RegistrySkill, intent?: string): number;
  includeSkill(
    fingerprint: ProjectFingerprint,
    skill: RegistrySkill,
    intent?: string,
  ): boolean;
  compose(recommendations: Recommendation[]): Recommendation[];
};

export type DomainRunPolicyInput = {
  intent: string;
  recommendations: Recommendation[];
  artifacts?: Record<string, unknown>;
};

export type DomainRunPolicy = {
  evaluate(input: DomainRunPolicyInput): SkillRunPolicyDecision;
};

export type DomainPack = {
  manifest: DomainPackManifest;
  root: string;
  routing: DomainRoutingPolicy;
  runPolicy?: DomainRunPolicy;
};

export type DomainPackRegistration = {
  manifest: DomainPackManifest;
  routing: DomainRoutingPolicy;
  runPolicy?: DomainRunPolicy;
  root?: string;
};

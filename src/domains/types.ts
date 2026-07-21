import type { ProjectFingerprint, Recommendation, RegistrySkill, SkillLane } from "../types.ts";
import type { SkillRunPolicyDecision } from "../runtime/skill-run/types.ts";

export type DomainCapability =
  | "project-signals"
  | "intent-routing"
  | "structured-artifacts"
  | "verification"
  | "repair"
  | "evaluation";

export type EvidenceSignalSource =
  | "prompt-exact"
  | "prompt-normalized"
  | "prompt-inferred"
  | "fingerprint"
  | "host-semantic";

export type RequiredEvidenceKind =
  | "domain"
  | "action"
  | "artifact"
  | "intent"
  | "technology"
  | "quality"
  | "constraint"
  | "acceptance";

export type RequiredEvidenceSource = Extract<
  EvidenceSignalSource,
  "prompt-exact" | "prompt-normalized" | "prompt-inferred"
>;

export type RequiredEvidenceRef = {
  kind: RequiredEvidenceKind;
  id: string;
  allowedSources: RequiredEvidenceSource[];
};

export type DomainOwnershipRuleV10 = {
  intent: string;
  primarySkill: string;
  supportingSkills: string[];
  requiresEvidence?: string[];
};

export type DomainOwnershipRuleV11 = Omit<DomainOwnershipRuleV10, "requiresEvidence"> & {
  requiresEvidence?: RequiredEvidenceRef[];
};

export type DomainOwnershipRule = DomainOwnershipRuleV10 | DomainOwnershipRuleV11;

export type DomainRoutingMetadata = {
  aliases: string[];
  intentTags: string[];
  artifactTypes: string[];
  technologyTags: string[];
  projectTags: string[];
};

export type DomainPackArtifactsBase = {
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

export type DomainPackArtifactsV10 = DomainPackArtifactsBase;
export type DomainPackArtifactsV11 = DomainPackArtifactsBase & {
  routingVocabulary?: string;
};

export type DomainPackManifestBase<TArtifacts extends DomainPackArtifactsBase> = {
  id: string;
  displayName: string;
  version: string;
  coreApi: string;
  skillIdPrefix: string;
  capabilities: DomainCapability[];
  artifacts: TArtifacts;
  routing?: DomainRoutingMetadata;
};

export type DomainPackManifest =
  | (DomainPackManifestBase<DomainPackArtifactsV10> & {
      schemaVersion: "1.0";
      ownership: DomainOwnershipRuleV10[];
    })
  | (DomainPackManifestBase<DomainPackArtifactsV11> & {
      schemaVersion: "1.1";
      ownership: DomainOwnershipRuleV11[];
    });

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

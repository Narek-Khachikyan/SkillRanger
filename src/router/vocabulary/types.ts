import type { RequiredEvidenceKind } from "../../domains/types.ts";
import type { DomainPackManifest } from "../../domains/types.ts";
import type { CanonicalSkillRoutingDocument } from "../metadata.ts";
import { taskActionIds, type TaskAction } from "../types.ts";

export const universalArtifactIds = [
  "application",
  "component",
  "form",
  "page",
  "service",
] as const;

export const coreQualityIds = [
  "accessibility",
  "correctness",
  "coverage",
  "performance",
  "security",
  "usability",
] as const;

export const coreConstraintIds = [
  "no-installation",
  "no-network",
  "read-only",
] as const;

export const coreAcceptanceIds = [
  "accessibility-gates-pass",
  "deployment-smoke-pass",
  "performance-measured",
  "schema-valid",
  "security-gates-pass",
  "static-analysis-pass",
  "tests-pass",
] as const;

export type RoutingSignalKind = RequiredEvidenceKind;
export type RoutingVocabularyLocale = "en" | "ru" | "mixed";

export type RoutingVocabularyEntry = {
  kind: RoutingSignalKind;
  id: string;
  locale: RoutingVocabularyLocale;
  phrases: string[];
  negativePhrases?: string[];
  weight?: number;
  priority?: number;
};

export type RoutingIntentMapping = {
  signalId: string;
  skillIntentIds: string[];
};

export type RoutingVocabularyFile = {
  schemaVersion: "routing-vocabulary/1.0";
  owner: { kind: "core" | "domain"; id: string };
  intentMappings?: RoutingIntentMapping[];
  creatableArtifactIds?: string[];
  entries: RoutingVocabularyEntry[];
};

export type OwnerCanonicalAllowlists = {
  domainIds: ReadonlySet<string>;
  actionIds: ReadonlySet<TaskAction>;
  artifactIds: ReadonlySet<string>;
  intentIds: ReadonlySet<string>;
  technologyIds: ReadonlySet<string>;
  qualityIds: ReadonlySet<string>;
  constraintIds: ReadonlySet<string>;
  acceptanceIds: ReadonlySet<string>;
};

export type CanonicalAllowlists = OwnerCanonicalAllowlists;

const set = <T extends string>(values: Iterable<T>) => new Set(values);
const union = <T extends string>(...values: Iterable<T>[]) => set(values.flatMap((items) => [...items]));

export const buildCanonicalAllowlists = (input: {
  domains: Array<{ manifest: DomainPackManifest; skills: CanonicalSkillRoutingDocument[] }>;
}): CanonicalAllowlists => ({
  domainIds: set(input.domains.map(({ manifest }) => manifest.id)),
  actionIds: set(taskActionIds),
  artifactIds: union(
    universalArtifactIds,
    ...input.domains.map(({ manifest }) => manifest.routing?.artifactTypes ?? []),
    ...input.domains.flatMap(({ skills }) => skills.map(({ canonical }) => canonical.artifactTypes)),
  ),
  intentIds: union(
    ...input.domains.map(({ manifest }) => manifest.routing?.intentTags ?? []),
    ...input.domains.map(({ manifest }) => manifest.ownership.map(({ intent }) => intent)),
    ...input.domains.flatMap(({ skills }) => skills.map(({ canonical }) => canonical.intentTags)),
  ),
  technologyIds: union(
    ...input.domains.map(({ manifest }) => manifest.routing?.technologyTags ?? []),
    ...input.domains.flatMap(({ skills }) => skills.map(({ canonical }) => canonical.technologyTags)),
  ),
  qualityIds: union(
    coreQualityIds,
    ...input.domains.flatMap(({ skills }) => skills.map(({ canonical }) => canonical.qualityGoals)),
  ),
  constraintIds: set(coreConstraintIds),
  acceptanceIds: set(coreAcceptanceIds),
});

export const coreCanonicalAllowlists = (): OwnerCanonicalAllowlists => ({
  domainIds: new Set(),
  actionIds: set(taskActionIds),
  artifactIds: set(universalArtifactIds),
  intentIds: new Set(),
  technologyIds: new Set(),
  qualityIds: set(coreQualityIds),
  constraintIds: set(coreConstraintIds),
  acceptanceIds: set(coreAcceptanceIds),
});

export const buildOwnerCanonicalAllowlists = (input: {
  core: OwnerCanonicalAllowlists;
  domains: Array<{
    domainId: string;
    manifest: DomainPackManifest;
    skills: CanonicalSkillRoutingDocument[];
  }>;
}): ReadonlyMap<`core:core` | `domain:${string}`, OwnerCanonicalAllowlists> => {
  const result = new Map<`core:core` | `domain:${string}`, OwnerCanonicalAllowlists>();
  result.set("core:core", input.core);
  for (const domain of input.domains) {
    const skills = domain.skills.filter(({ domains }) => domains.includes(domain.domainId));
    result.set(`domain:${domain.domainId}`, {
      domainIds: new Set([domain.domainId]),
      actionIds: set(taskActionIds),
      artifactIds: union(
        universalArtifactIds,
        domain.manifest.routing?.artifactTypes ?? [],
        ...skills.map(({ canonical }) => canonical.artifactTypes),
      ),
      intentIds: union(
        domain.manifest.routing?.intentTags ?? [],
        domain.manifest.ownership.map(({ intent }) => intent),
        ...skills.map(({ canonical }) => canonical.intentTags),
      ),
      technologyIds: union(
        domain.manifest.routing?.technologyTags ?? [],
        ...skills.map(({ canonical }) => canonical.technologyTags),
      ),
      qualityIds: union(coreQualityIds, ...skills.map(({ canonical }) => canonical.qualityGoals)),
      constraintIds: set(coreConstraintIds),
      acceptanceIds: set(coreAcceptanceIds),
    });
  }
  return result;
};


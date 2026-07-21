import type {
  DomainOwnershipRuleV10,
  DomainOwnershipRuleV11,
  RequiredEvidenceKind,
  RequiredEvidenceRef,
  RequiredEvidenceSource,
} from "../domains/types.ts";
import { routerRecordDigest } from "./store.ts";
import type { CanonicalSkillRoutingDocument } from "./metadata.ts";
import {
  buildOwnerCanonicalAllowlists,
  coreCanonicalAllowlists,
  type OwnerCanonicalAllowlists,
  type RoutingIntentMapping,
  type RoutingSignalKind,
  type RoutingVocabularyFile,
  universalArtifactIds,
} from "./vocabulary/types.ts";
import type { LoadedRouterPack } from "./vocabulary/load.ts";
import {
  validateRoutingVocabulary,
  validateRoutingVocabularyRegistry,
  type ValidatedRoutingClaim,
  type ValidatedRoutingVocabulary,
} from "./vocabulary/validate.ts";
import { buildCanonicalBaselineEntries, compileRoutingVocabulary, type CompiledRoutingVocabulary, type OwnedRoutingVocabularyEntry } from "./vocabulary/match.ts";

export type NormalizedDomainOwnershipRule = {
  intent: string;
  primarySkill: string;
  supportingSkills: string[];
  requiresEvidence: RequiredEvidenceRef[];
};

export type DomainRoutingContext = {
  domainId: string;
  ownership: ReadonlyArray<NormalizedDomainOwnershipRule>;
  intentMappings: ReadonlyMap<string, RoutingIntentMapping>;
};

export type RoutingContext = {
  domains: ReadonlyMap<string, DomainRoutingContext>;
  ownerAllowlists: ReadonlyMap<`core:core` | `domain:${string}`, OwnerCanonicalAllowlists>;
  compiledVocabulary: CompiledRoutingVocabulary;
  creatableArtifactIds: ReadonlySet<string>;
  vocabularyDigest: string;
  routingRegistryDigest: string;
};

export class RoutingContextError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

const evidenceSourceOrder: RequiredEvidenceSource[] = ["prompt-exact", "prompt-normalized", "prompt-inferred"];
const kindOrder: RoutingSignalKind[] = ["domain", "action", "artifact", "intent", "technology", "quality", "constraint", "acceptance"];
const allowlist = (owner: OwnerCanonicalAllowlists, kind: RequiredEvidenceKind): ReadonlySet<string> => {
  switch (kind) {
    case "domain": return owner.domainIds;
    case "action": return owner.actionIds;
    case "artifact": return owner.artifactIds;
    case "intent": return owner.intentIds;
    case "technology": return owner.technologyIds;
    case "quality": return owner.qualityIds;
    case "constraint": return owner.constraintIds;
    case "acceptance": return owner.acceptanceIds;
  }
};
const normalizedSources = (sources: RequiredEvidenceSource[]) => evidenceSourceOrder.filter((source) => sources.includes(source));

const normalizeOwnership = (
  rules: ReadonlyArray<DomainOwnershipRuleV10 | DomainOwnershipRuleV11>,
  owner: OwnerCanonicalAllowlists,
): NormalizedDomainOwnershipRule[] => rules.map((rule) => {
  const raw = rule.requiresEvidence ?? [];
  const requiresEvidence: RequiredEvidenceRef[] = raw.map((evidence) => {
    if (typeof evidence === "string") {
      const kinds = kindOrder.filter((kind) => allowlist(owner, kind).has(evidence));
      if (kinds.length !== 1) throw new RoutingContextError("domain-evidence-reference-invalid");
      return { kind: kinds[0], id: evidence, allowedSources: ["prompt-exact", "prompt-normalized"] };
    }
    if (!allowlist(owner, evidence.kind).has(evidence.id) || evidence.allowedSources.length === 0 ||
      evidence.allowedSources.some((source) => !evidenceSourceOrder.includes(source))) {
      throw new RoutingContextError("domain-evidence-reference-invalid");
    }
    return { ...evidence, allowedSources: normalizedSources(evidence.allowedSources) };
  });
  const seen = new Map<string, string>();
  for (const evidence of requiresEvidence) {
    const key = `${evidence.kind}:${evidence.id}`;
    const sources = evidence.allowedSources.join(",");
    const existing = seen.get(key);
    if (existing !== undefined && existing !== sources) throw new RoutingContextError("domain-evidence-reference-invalid");
    seen.set(key, sources);
  }
  return {
    intent: rule.intent,
    primarySkill: rule.primarySkill,
    supportingSkills: [...rule.supportingSkills].sort(),
    requiresEvidence: requiresEvidence.filter((evidence, index, all) =>
      all.findIndex((candidate) => candidate.kind === evidence.kind && candidate.id === evidence.id &&
        candidate.allowedSources.join(",") === evidence.allowedSources.join(",")) === index),
  };
}).map((rule) => ({
  ...rule,
  requiresEvidence: [...rule.requiresEvidence].sort((left, right) =>
    `${left.kind}:${left.id}:${left.allowedSources.join(",")}`.localeCompare(`${right.kind}:${right.id}:${right.allowedSources.join(",")}`)),
})).sort((left, right) =>
  `${left.intent}:${left.primarySkill}`.localeCompare(`${right.intent}:${right.primarySkill}`));

const baselineVocabulary = (
  owner: { kind: "core" | "domain"; id: string },
  allowlists: OwnerCanonicalAllowlists,
  aliases: string[] = [],
): RoutingVocabularyFile => {
  const claims = kindOrder.flatMap((kind) => [...allowlist(allowlists, kind)].sort().map((id) => ({ kind, id })));
  const entries = buildCanonicalBaselineEntries({
    ownerId: owner.id,
    claims,
    ...(owner.kind === "domain" ? { domainAliases: aliases } : {}),
  }).map(({ kind, id, phrases, weight, priority }) => ({ kind, id, locale: "mixed" as const, phrases, weight, priority }));
  return { schemaVersion: "routing-vocabulary/1.0", owner, entries };
};

const ownedEntry = (claim: ValidatedRoutingClaim): OwnedRoutingVocabularyEntry => ({
  kind: claim.kind,
  id: claim.id,
  phrases: claim.exactPhrases,
  ...(claim.negativePhrases.length ? { negativePhrases: claim.negativePhrases } : {}),
  locales: claim.locales,
  ownerIds: claim.ownerIds,
  localeMultiplier: claim.origin === "baseline" || claim.locales.some((locale) => locale !== "mixed") ? 1 : 0.9,
  origin: claim.origin,
  evidenceEligible: claim.evidenceEligible,
  weight: claim.weight,
  priority: claim.priority,
});

const normalizeRouting = (routing: LoadedRouterPack["routing"]) => ({
  aliases: [...routing.aliases].sort(),
  intentTags: [...routing.intentTags].sort(),
  artifactTypes: [...routing.artifactTypes].sort(),
  technologyTags: [...routing.technologyTags].sort(),
  projectTags: [...routing.projectTags].sort(),
});

export const buildRoutingContext = (input: {
  packs: LoadedRouterPack[];
  skills: CanonicalSkillRoutingDocument[];
  coreVocabulary: RoutingVocabularyFile;
  baseRegistryDigest: string;
}): RoutingContext => {
  const ownerAllowlists = buildOwnerCanonicalAllowlists({
    core: coreCanonicalAllowlists(),
    domains: input.packs.map((pack) => ({
      domainId: pack.domainId,
      manifest: {
        schemaVersion: "1.0",
        id: pack.domainId,
        displayName: pack.domainId,
        version: "routing",
        coreApi: "routing",
        skillIdPrefix: `${pack.domainId}.`,
        capabilities: ["intent-routing"],
        artifacts: { intents: [], schemas: [], recipes: [], workflows: [], validators: [] },
        ownership: pack.ownership.map(({ intent, primarySkill, supportingSkills }) => ({ intent, primarySkill, supportingSkills: [...supportingSkills] })),
        routing: pack.routing,
      },
      skills: input.skills.filter(({ domains }) => domains.includes(pack.domainId)),
    })),
  });

  const validated: ValidatedRoutingVocabulary[] = [];
  const core = validateRoutingVocabulary({
    vocabulary: input.coreVocabulary,
    ownerKey: "core:core",
    allowlists: ownerAllowlists.get("core:core")!,
    skillIntentIds: new Set(),
  });
  validated.push(core);
  for (const pack of input.packs) {
    if (!pack.vocabulary) continue;
    const ownerKey = `domain:${pack.domainId}` as const;
    const ownerSkills = input.skills.filter(({ domains }) => domains.includes(pack.domainId));
    validated.push(validateRoutingVocabulary({
      vocabulary: pack.vocabulary,
      ownerKey,
      allowlists: ownerAllowlists.get(ownerKey)!,
      skillIntentIds: new Set(ownerSkills.flatMap(({ canonical }) => canonical.intentTags)),
      ...(pack.vocabularyBytes === undefined ? {} : { byteLength: pack.vocabularyBytes }),
    }));
  }
  for (const [ownerKey, allowlists] of ownerAllowlists) {
    const [kind, id] = ownerKey.split(":") as ["core" | "domain", string];
    const aliases = kind === "domain" ? input.packs.find(({ domainId }) => domainId === id)?.routing.aliases ?? [] : [];
    validated.push(validateRoutingVocabulary({
      vocabulary: baselineVocabulary({ kind, id }, allowlists, aliases),
      ownerKey,
      allowlists,
      skillIntentIds: new Set(input.skills.filter(({ domains }) => domains.includes(id)).flatMap(({ canonical }) => canonical.intentTags)),
      origin: "baseline",
    }));
  }
  const claims = validateRoutingVocabularyRegistry(validated);
  const creatableArtifactIds = new Set<string>(universalArtifactIds);
  validated.forEach(({ creatableArtifactIds: ids }) => ids.forEach((id) => creatableArtifactIds.add(id)));

  const domains = new Map<string, DomainRoutingContext>();
  for (const pack of input.packs) {
    const ownerKey = `domain:${pack.domainId}` as const;
    const source = validated.find(({ ownerKey: key, claims: sourceClaims }) => key === ownerKey && sourceClaims.some(({ origin }) => origin === "explicit"));
    domains.set(pack.domainId, {
      domainId: pack.domainId,
      ownership: normalizeOwnership(pack.ownership, ownerAllowlists.get(ownerKey)!),
      intentMappings: new Map([...(source?.intentMappings ?? [])]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([signalId, skillIntentIds]) => [signalId, { signalId, skillIntentIds: [...skillIntentIds].sort() }])),
    });
  }
  const vocabularyDigest = routerRecordDigest({
    claims: claims.map((claim) => ({
      phrase: claim.normalizedPhrase,
      exactPhrases: claim.exactPhrases,
      kind: claim.kind,
      id: claim.id,
      ownerIds: claim.ownerIds,
      locales: claim.locales,
      negativePhrases: claim.negativePhrases,
      weight: claim.weight,
      priority: claim.priority,
      origin: claim.origin,
    })),
    intentMappings: [...domains].flatMap(([domainId, domain]) => [...domain.intentMappings.values()].map((mapping) => ({ domainId, ...mapping })))
      .sort((left, right) => `${left.domainId}:${left.signalId}`.localeCompare(`${right.domainId}:${right.signalId}`)),
    creatableArtifactIds: [...creatableArtifactIds].sort(),
  });
  const routingRegistryDigest = routerRecordDigest({
    baseRegistryDigest: input.baseRegistryDigest,
    domains: input.packs.map((pack) => ({
      id: pack.domainId,
      routing: normalizeRouting(pack.routing),
      ownership: domains.get(pack.domainId)?.ownership.map((rule) => ({
        ...rule,
        supportingSkills: [...rule.supportingSkills].sort(),
        requiresEvidence: rule.requiresEvidence.map((evidence) => ({ ...evidence, allowedSources: [...evidence.allowedSources] })),
      })),
    })).sort((left, right) => left.id.localeCompare(right.id)),
    vocabularyDigest,
  });
  return {
    domains,
    ownerAllowlists,
    compiledVocabulary: compileRoutingVocabulary(claims.map(ownedEntry)),
    creatableArtifactIds,
    vocabularyDigest,
    routingRegistryDigest,
  };
};

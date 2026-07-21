import { createHash } from "node:crypto";
import { canonicalizeJson } from "../store.ts";
import type { TaskAction } from "../types.ts";
import type {
  OwnerCanonicalAllowlists,
  RoutingSignalKind,
  RoutingVocabularyFile,
  RoutingVocabularyLocale,
} from "./types.ts";
import { normalizeRoutingText } from "./normalize.ts";

export const routingVocabularyLimits = {
  maxFileBytes: 524_288,
  maxEntries: 512,
  maxPhrasesPerEntry: 128,
  maxPhraseBytes: 256,
  maxNegativePhrasesPerEntry: 64,
  maxTotalBytes: 8_388_608,
  maxTotalNormalizedPhrases: 65_536,
  maxTotalNormalizedPhraseTokens: 524_288,
} as const;

export type RoutingVocabularyFailureReason =
  | "routing-vocabulary-invalid"
  | "routing-vocabulary-limit-exceeded"
  | "routing-vocabulary-collision";

export class RoutingVocabularyValidationError extends Error {
  readonly reason: RoutingVocabularyFailureReason;
  constructor(reason: RoutingVocabularyFailureReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

export type ValidatedRoutingClaim = {
  normalizedPhrase: string;
  kind: RoutingSignalKind;
  id: string;
  ownerIds: string[];
  locales: RoutingVocabularyLocale[];
  negativePhrases: string[];
  weight: number;
  priority: number;
  origin: "explicit" | "baseline";
  evidenceEligible: boolean;
};

export type ValidatedRoutingVocabulary = {
  ownerKey: `core:core` | `domain:${string}`;
  bytes: number;
  claims: ValidatedRoutingClaim[];
  intentMappings: ReadonlyMap<string, readonly string[]>;
  creatableArtifactIds: ReadonlySet<string>;
};

const kindOrder: RoutingSignalKind[] = [
  "domain", "action", "artifact", "intent", "technology", "quality", "constraint", "acceptance",
];
const kinds = new Set<RoutingSignalKind>(kindOrder);
const locales = new Set<RoutingVocabularyLocale>(["en", "ru", "mixed"]);
const canonicalId = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[], at: string) => {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) invalid(`${at}.${unknown} is an unknown property`);
};
const record = (value: unknown, at: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${at} must be an object`);
  return value as Record<string, unknown>;
};
const invalid = (message: string): never => { throw new RoutingVocabularyValidationError("routing-vocabulary-invalid", message); };
const limit = (message: string): never => { throw new RoutingVocabularyValidationError("routing-vocabulary-limit-exceeded", message); };
const normalizedPhrase = (value: string) => normalizeRoutingText(value).normalized;
const unsafePhrase = (value: string) => /[`\0]|\$\(|[\[\]{}*?]|\.\*/u.test(value);
const strings = (value: unknown, at: string, options: { min: number; max: number; canonical?: boolean }) => {
  if (!Array.isArray(value)) invalid(`${at} must be an array`);
  const items = value as unknown[];
  if (items.length < options.min) invalid(`${at} must contain at least ${options.min} item`);
  if (items.length > options.max) limit(`${at} exceeds ${options.max} items`);
  const result = items.map((item, index) => {
    const text = typeof item === "string" ? item : invalid(`${at}[${index}] must be a string`);
    if (text.trim() === "") invalid(`${at}[${index}] must be a non-empty string`);
    if (options.canonical && !canonicalId.test(text)) invalid(`${at}[${index}] must be a canonical id`);
    return text;
  });
  if (new Set(result).size !== result.length) invalid(`${at} must contain unique values`);
  return result;
};
const allowlistFor = (allowlists: OwnerCanonicalAllowlists, kind: RoutingSignalKind): ReadonlySet<string> => {
  switch (kind) {
    case "domain": return allowlists.domainIds;
    case "action": return allowlists.actionIds as ReadonlySet<TaskAction>;
    case "artifact": return allowlists.artifactIds;
    case "intent": return allowlists.intentIds;
    case "technology": return allowlists.technologyIds;
    case "quality": return allowlists.qualityIds;
    case "constraint": return allowlists.constraintIds;
    case "acceptance": return allowlists.acceptanceIds;
  }
};
const ownerKeyFor = (owner: { kind: "core" | "domain"; id: string }) =>
  (owner.kind === "core" ? `core:${owner.id}` : `domain:${owner.id}`) as `core:core` | `domain:${string}`;

export const validateRoutingVocabulary = (input: {
  vocabulary: unknown;
  ownerKey: `core:core` | `domain:${string}`;
  allowlists: OwnerCanonicalAllowlists;
  skillIntentIds?: ReadonlySet<string>;
  byteLength?: number;
  origin?: "explicit" | "baseline";
}): ValidatedRoutingVocabulary => {
  const value = record(input.vocabulary, "routing vocabulary");
  exactKeys(value, ["schemaVersion", "owner", "intentMappings", "creatableArtifactIds", "entries"], "routing vocabulary");
  if (value.schemaVersion !== "routing-vocabulary/1.0") invalid("routing vocabulary schemaVersion is invalid");
  const owner = record(value.owner, "routing vocabulary.owner");
  exactKeys(owner, ["kind", "id"], "routing vocabulary.owner");
  if ((owner.kind !== "core" && owner.kind !== "domain") || typeof owner.id !== "string" || !canonicalId.test(owner.id)) {
    invalid("routing vocabulary.owner is invalid");
  }
  const actualOwnerKey = ownerKeyFor(owner as { kind: "core" | "domain"; id: string });
  if (actualOwnerKey !== input.ownerKey || (owner.kind === "core" && owner.id !== "core")) {
    invalid(`routing vocabulary owner does not match ${input.ownerKey}`);
  }

  const bytes = input.byteLength ?? Buffer.byteLength(canonicalizeJson(input.vocabulary), "utf8");
  if (bytes > routingVocabularyLimits.maxFileBytes) limit("routing vocabulary file exceeds byte limit");
  if (!Array.isArray(value.entries)) invalid("routing vocabulary.entries must be an array");
  const entries = value.entries as unknown[];
  if (entries.length < 1) invalid("routing vocabulary.entries must be non-empty");
  if (entries.length > routingVocabularyLimits.maxEntries) limit("routing vocabulary.entries exceeds limit");

  const claims: ValidatedRoutingClaim[] = [];
  for (const [entryIndex, rawEntry] of entries.entries()) {
    const at = `routing vocabulary.entries[${entryIndex}]`;
    const entry = record(rawEntry, at);
    exactKeys(entry, ["kind", "id", "locale", "phrases", "negativePhrases", "weight", "priority"], at);
    if (!kinds.has(entry.kind as RoutingSignalKind)) invalid(`${at}.kind is invalid`);
    const kind = entry.kind as RoutingSignalKind;
    if (typeof entry.id !== "string" || !canonicalId.test(entry.id)) invalid(`${at}.id is invalid`);
    const entryId = typeof entry.id === "string" ? entry.id : invalid(`${at}.id is invalid`);
    if (!allowlistFor(input.allowlists, kind).has(entryId)) invalid(`${at}.id is not allowed for ${input.ownerKey}`);
    if (!locales.has(entry.locale as RoutingVocabularyLocale)) invalid(`${at}.locale is invalid`);
    if (entry.weight !== undefined && (typeof entry.weight !== "number" || !Number.isFinite(entry.weight) || entry.weight < 0.1 || entry.weight > 1)) invalid(`${at}.weight is invalid`);
    if (entry.priority !== undefined && (!Number.isInteger(entry.priority) || (entry.priority as number) < 0 || (entry.priority as number) > 100)) invalid(`${at}.priority is invalid`);
    const phrases = strings(entry.phrases, `${at}.phrases`, { min: 1, max: routingVocabularyLimits.maxPhrasesPerEntry });
    const negativePhrases = entry.negativePhrases === undefined ? [] : strings(entry.negativePhrases, `${at}.negativePhrases`, { min: 1, max: routingVocabularyLimits.maxNegativePhrasesPerEntry });
    const normalizedPositive = new Set<string>();
    const normalizedNegative = new Set<string>();
    for (const [phraseIndex, phrase] of phrases.entries()) {
      const normalized = normalizedPhrase(phrase);
      if (Buffer.byteLength(phrase, "utf8") > routingVocabularyLimits.maxPhraseBytes || Buffer.byteLength(normalized, "utf8") > routingVocabularyLimits.maxPhraseBytes) limit(`${at}.phrases[${phraseIndex}] exceeds byte limit`);
      if (!normalized || unsafePhrase(phrase)) invalid(`${at}.phrases[${phraseIndex}] is unsafe`);
      if (normalizedPositive.has(normalized)) invalid(`${at}.phrases contains duplicate normalized phrases`);
      normalizedPositive.add(normalized);
      claims.push({
        normalizedPhrase: normalized,
        kind,
        id: entryId,
        ownerIds: [owner.id as string],
        locales: [entry.locale as RoutingVocabularyLocale],
        negativePhrases: [],
        weight: (entry.weight as number | undefined) ?? 1,
        priority: (entry.priority as number | undefined) ?? 50,
        origin: input.origin ?? "explicit",
        evidenceEligible: (input.origin ?? "explicit") === "explicit",
      });
    }
    for (const [phraseIndex, phrase] of negativePhrases.entries()) {
      const normalized = normalizedPhrase(phrase);
      if (Buffer.byteLength(phrase, "utf8") > routingVocabularyLimits.maxPhraseBytes || Buffer.byteLength(normalized, "utf8") > routingVocabularyLimits.maxPhraseBytes) limit(`${at}.negativePhrases[${phraseIndex}] exceeds byte limit`);
      if (!normalized || unsafePhrase(phrase)) invalid(`${at}.negativePhrases[${phraseIndex}] is unsafe`);
      if (normalizedNegative.has(normalized)) invalid(`${at}.negativePhrases contains duplicate normalized phrases`);
      if (normalizedPositive.has(normalized)) invalid(`${at} uses the same positive and negative phrase`);
      normalizedNegative.add(normalized);
    }
    for (const claim of claims.slice(claims.length - phrases.length)) claim.negativePhrases = [...normalizedNegative].sort();
  }

  const intentMappings = new Map<string, readonly string[]>();
  if (value.intentMappings !== undefined) {
    if (!Array.isArray(value.intentMappings)) invalid("routing vocabulary.intentMappings must be an array");
    const mappings = value.intentMappings as unknown[];
    if (mappings.length === 0) invalid("routing vocabulary.intentMappings must be non-empty");
    for (const [index, rawMapping] of mappings.entries()) {
      const at = `routing vocabulary.intentMappings[${index}]`;
      const mapping = record(rawMapping, at);
      exactKeys(mapping, ["signalId", "skillIntentIds"], at);
      const signalId = typeof mapping.signalId === "string" ? mapping.signalId : invalid(`${at}.signalId is invalid`);
      if (!input.allowlists.intentIds.has(signalId)) invalid(`${at}.signalId is invalid`);
      if (intentMappings.has(signalId)) invalid(`${at}.signalId is duplicated`);
      const skillIntentIds = strings(mapping.skillIntentIds, `${at}.skillIntentIds`, { min: 1, max: 512, canonical: true });
      if (skillIntentIds.some((id) => !input.skillIntentIds?.has(id))) invalid(`${at}.skillIntentIds contains an unknown owner skill intent`);
      intentMappings.set(signalId, skillIntentIds);
    }
  }
  const creatableArtifactIds = new Set<string>(value.creatableArtifactIds === undefined
    ? []
    : strings(value.creatableArtifactIds, "routing vocabulary.creatableArtifactIds", { min: 1, max: 512, canonical: true }));
  if ([...creatableArtifactIds].some((id) => !input.allowlists.artifactIds.has(id))) invalid("routing vocabulary.creatableArtifactIds contains an unknown owner artifact");
  return { ownerKey: input.ownerKey, bytes, claims, intentMappings, creatableArtifactIds };
};

const digestPhrase = (phrase: string) => createHash("sha256").update(phrase).digest("hex");
const intersect = (sets: string[][]) => sets.slice(1).reduce<string[]>((shared, values) => shared.filter((value) => values.includes(value)), sets[0] ?? []);
const claimKey = (claim: ValidatedRoutingClaim) => `${claim.normalizedPhrase}\0${claim.kind}\0${claim.id}`;

export const validateRoutingVocabularyRegistry = (
  sources: ValidatedRoutingVocabulary[],
): ValidatedRoutingClaim[] => {
  const totalBytes = sources.reduce((sum, source) => sum + source.bytes, 0);
  if (totalBytes > routingVocabularyLimits.maxTotalBytes) limit("routing vocabulary registry exceeds byte limit");
  const grouped = new Map<string, ValidatedRoutingClaim[]>();
  for (const claim of sources.flatMap(({ claims }) => claims)) {
    const key = claimKey(claim);
    grouped.set(key, [...(grouped.get(key) ?? []), claim]);
  }
  const merged: ValidatedRoutingClaim[] = [];
  for (const group of grouped.values()) {
    const explicit = group.filter(({ origin }) => origin === "explicit");
    const owners = [...new Set(explicit.flatMap(({ ownerIds }) => ownerIds))];
    if (owners.length > 1) {
      const claim = group[0];
      throw new RoutingVocabularyValidationError("routing-vocabulary-collision", `phrase ${digestPhrase(claim.normalizedPhrase)} has duplicate explicit ${claim.kind}:${claim.id} owners`);
    }
    const selected = explicit.length > 0 ? explicit : group;
    const first = selected[0];
    merged.push({
      ...first,
      ownerIds: [...new Set(selected.flatMap(({ ownerIds }) => ownerIds))].sort(),
      locales: [...new Set(selected.flatMap(({ locales }) => locales))].sort() as RoutingVocabularyLocale[],
      negativePhrases: [...new Set(selected.flatMap(({ negativePhrases }) => negativePhrases))].sort(),
      weight: Math.max(...selected.map(({ weight }) => weight)),
      priority: Math.max(...selected.map(({ priority }) => priority)),
      origin: explicit.length > 0 ? "explicit" : "baseline",
      evidenceEligible: explicit.length > 0,
    });
  }
  const byPhraseKind = new Map<string, ValidatedRoutingClaim[]>();
  for (const claim of merged) {
    const key = `${claim.normalizedPhrase}\0${claim.kind}`;
    byPhraseKind.set(key, [...(byPhraseKind.get(key) ?? []), claim]);
  }
  for (const group of byPhraseKind.values()) {
    if (new Set(group.map(({ id }) => id)).size > 1 && intersect(group.map(({ ownerIds }) => ownerIds)).length === 0) {
      throw new RoutingVocabularyValidationError("routing-vocabulary-collision", `phrase ${digestPhrase(group[0].normalizedPhrase)} has conflicting ${group[0].kind} claims`);
    }
  }
  if (merged.length > routingVocabularyLimits.maxTotalNormalizedPhrases) limit("routing vocabulary registry exceeds normalized phrase limit");
  const tokenCount = merged.reduce((sum, claim) => sum + claim.normalizedPhrase.split(" ").length, 0);
  if (tokenCount > routingVocabularyLimits.maxTotalNormalizedPhraseTokens) limit("routing vocabulary registry exceeds normalized token limit");
  return merged.sort((left, right) =>
    left.normalizedPhrase.localeCompare(right.normalizedPhrase) ||
    kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind) ||
    left.id.localeCompare(right.id));
};

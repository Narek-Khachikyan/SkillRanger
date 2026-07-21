import test from "node:test";
import assert from "node:assert/strict";
import type { DomainPackManifest } from "../src/domains/types.ts";
import type { CanonicalSkillRoutingDocument } from "../src/router/metadata.ts";
import {
  buildCanonicalAllowlists,
  buildOwnerCanonicalAllowlists,
  coreCanonicalAllowlists,
  type RoutingVocabularyFile,
} from "../src/router/vocabulary/types.ts";
import {
  RoutingVocabularyValidationError,
  routingVocabularyLimits,
  validateRoutingVocabulary,
  validateRoutingVocabularyRegistry,
} from "../src/router/vocabulary/validate.ts";

const manifest = (id: string, artifact: string, intent: string): DomainPackManifest => ({
  schemaVersion: "1.0",
  id,
  displayName: id,
  version: "1.0.0",
  coreApi: "1.0",
  skillIdPrefix: `${id}.`,
  capabilities: ["intent-routing"],
  artifacts: { intents: [], schemas: [], recipes: [], workflows: [], validators: [] },
  ownership: [{ intent, primarySkill: `${id}.primary`, supportingSkills: [] }],
  routing: { aliases: [], intentTags: [intent], artifactTypes: [artifact], technologyTags: [`${id}-tech`], projectTags: [] },
});

const skill = (domain: string, artifact: string, intent: string): CanonicalSkillRoutingDocument => ({
  skillId: `${domain}.primary`,
  domains: [domain],
  canonical: {
    actions: ["create"], artifactTypes: [artifact], intentTags: [intent], technologyTags: [`${domain}-tech`], qualityGoals: [`${domain}-quality`],
  },
});

const domains = [
  { domainId: "alpha", manifest: manifest("alpha", "alpha-artifact", "alpha-intent"), skills: [skill("alpha", "alpha-artifact", "alpha-intent")] },
  { domainId: "beta", manifest: manifest("beta", "beta-artifact", "beta-intent"), skills: [skill("beta", "beta-artifact", "beta-intent")] },
];
const globalAllowlists = buildCanonicalAllowlists({ domains });
const ownerAllowlists = buildOwnerCanonicalAllowlists({ core: coreCanonicalAllowlists(), domains });

const vocabulary = (owner: "alpha" | "beta", entries: RoutingVocabularyFile["entries"], extra: Partial<RoutingVocabularyFile> = {}): RoutingVocabularyFile => ({
  schemaVersion: "routing-vocabulary/1.0",
  owner: { kind: "domain", id: owner },
  entries,
  ...extra,
});
const validate = (owner: "alpha" | "beta", value: unknown, options: { origin?: "explicit" | "baseline"; byteLength?: number } = {}) => validateRoutingVocabulary({
  vocabulary: value,
  ownerKey: `domain:${owner}`,
  allowlists: ownerAllowlists.get(`domain:${owner}`)!,
  skillIntentIds: new Set([`${owner}-intent`]),
  ...options,
});

test("canonical allowlists are global unions while owner allowlists isolate domain metadata", () => {
  assert.ok(globalAllowlists.artifactIds.has("alpha-artifact"));
  assert.ok(globalAllowlists.artifactIds.has("beta-artifact"));
  assert.ok(ownerAllowlists.get("domain:alpha")?.artifactIds.has("alpha-artifact"));
  assert.equal(ownerAllowlists.get("domain:alpha")?.artifactIds.has("beta-artifact"), false);
  assert.deepEqual([...ownerAllowlists.get("core:core")!.artifactIds], ["application", "component", "form", "page", "service"]);
});

test("vocabulary validation enforces owner IDs, mappings, creatable artifacts, and limits", () => {
  const valid = vocabulary("alpha", [
    { kind: "artifact", id: "alpha-artifact", locale: "en", phrases: ["alpha thing"] },
    { kind: "intent", id: "alpha-intent", locale: "en", phrases: ["alpha work"] },
  ], {
    intentMappings: [{ signalId: "alpha-intent", skillIntentIds: ["alpha-intent"] }],
    creatableArtifactIds: ["alpha-artifact"],
  });
  assert.equal(validate("alpha", valid).claims.length, 2);

  const failures: Array<[string, unknown]> = [
    ["owner mismatch", { ...valid, owner: { kind: "domain", id: "beta" } }],
    ["cross-domain borrowing", vocabulary("alpha", [{ kind: "artifact", id: "beta-artifact", locale: "en", phrases: ["borrowed"] }])],
    ["unknown mapping", { ...valid, intentMappings: [{ signalId: "alpha-intent", skillIntentIds: ["missing-intent"] }] }],
    ["unknown creatable", { ...valid, creatableArtifactIds: ["beta-artifact"] }],
    ["normalized duplicate", vocabulary("alpha", [{ kind: "artifact", id: "alpha-artifact", locale: "en", phrases: ["Alpha Thing", "alpha  thing"] }])],
    ["positive-negative collision", vocabulary("alpha", [{ kind: "artifact", id: "alpha-artifact", locale: "en", phrases: ["alpha thing"], negativePhrases: ["ALPHA THING"] }])],
    ["unsafe expression", vocabulary("alpha", [{ kind: "artifact", id: "alpha-artifact", locale: "en", phrases: ["$(run)"] }])],
  ];
  for (const [label, value] of failures) assert.throws(() => validate("alpha", value), RoutingVocabularyValidationError, label);
  assert.throws(() => validate("alpha", valid, { byteLength: routingVocabularyLimits.maxFileBytes + 1 }), (error: unknown) =>
    error instanceof RoutingVocabularyValidationError && error.reason === "routing-vocabulary-limit-exceeded");
});

test("global collision validation dedupes safe groups and rejects cross-owner hijacking", () => {
  const sameOwner = validate("alpha", vocabulary("alpha", [
    { kind: "artifact", id: "alpha-artifact", locale: "en", phrases: ["shared phrase"], weight: 0.5 },
    { kind: "artifact", id: "alpha-artifact", locale: "mixed", phrases: ["Shared Phrase"], weight: 1 },
  ]));
  const deduped = validateRoutingVocabularyRegistry([sameOwner]);
  assert.equal(deduped.length, 1);
  assert.deepEqual(deduped[0].locales, ["en", "mixed"]);
  assert.equal(deduped[0].weight, 1);

  const alpha = validate("alpha", vocabulary("alpha", [{ kind: "artifact", id: "page", locale: "en", phrases: ["collision"] }]));
  const betaSameClaim = validate("beta", vocabulary("beta", [{ kind: "artifact", id: "page", locale: "en", phrases: ["collision"] }]));
  assert.throws(() => validateRoutingVocabularyRegistry([alpha, betaSameClaim]), (error: unknown) =>
    error instanceof RoutingVocabularyValidationError && error.reason === "routing-vocabulary-collision");

  const baselineAlpha = validate("alpha", vocabulary("alpha", [{ kind: "artifact", id: "page", locale: "en", phrases: ["page"] }]), { origin: "baseline" });
  const baselineBeta = validate("beta", vocabulary("beta", [{ kind: "artifact", id: "page", locale: "en", phrases: ["page"] }]), { origin: "baseline" });
  assert.deepEqual(validateRoutingVocabularyRegistry([baselineAlpha, baselineBeta])[0].ownerIds, ["alpha", "beta"]);
});

test("multi-kind and shared-owner aliases coexist but unrelated same-kind claims reject", () => {
  const shared = validate("alpha", vocabulary("alpha", [
    { kind: "artifact", id: "alpha-artifact", locale: "en", phrases: ["alpha alias"] },
    { kind: "artifact", id: "page", locale: "en", phrases: ["alpha alias"] },
    { kind: "intent", id: "alpha-intent", locale: "en", phrases: ["alpha alias"] },
  ]));
  assert.deepEqual(validateRoutingVocabularyRegistry([shared]).map(({ kind, id }) => `${kind}:${id}`), [
    "artifact:alpha-artifact", "artifact:page", "intent:alpha-intent",
  ]);

  const alpha = validate("alpha", vocabulary("alpha", [{ kind: "artifact", id: "alpha-artifact", locale: "en", phrases: ["hijack"] }]));
  const beta = validate("beta", vocabulary("beta", [{ kind: "artifact", id: "beta-artifact", locale: "en", phrases: ["hijack"] }]));
  assert.throws(() => validateRoutingVocabularyRegistry([alpha, beta]), (error: unknown) =>
    error instanceof RoutingVocabularyValidationError && error.reason === "routing-vocabulary-collision");
});

test("aggregate registry limits are checked before matcher construction", () => {
  const base = validate("alpha", vocabulary("alpha", [{ kind: "artifact", id: "alpha-artifact", locale: "en", phrases: ["alpha"] }]), {
    origin: "baseline",
    byteLength: 500_000,
  });
  assert.throws(() => validateRoutingVocabularyRegistry(Array.from({ length: 17 }, () => base)), (error: unknown) =>
    error instanceof RoutingVocabularyValidationError && error.reason === "routing-vocabulary-limit-exceeded");

  const phraseClaims = Array.from({ length: routingVocabularyLimits.maxTotalNormalizedPhrases + 1 }, (_, index) => ({
    ...base.claims[0], normalizedPhrase: `phrase ${index}`,
  }));
  assert.throws(() => validateRoutingVocabularyRegistry([{ ...base, bytes: 1, claims: phraseClaims }]), (error: unknown) =>
    error instanceof RoutingVocabularyValidationError && error.reason === "routing-vocabulary-limit-exceeded");

  const tokenClaims = Array.from({ length: 65_536 }, (_, index) => ({
    ...base.claims[0], normalizedPhrase: `token ${index} a b c d e f g`,
  }));
  tokenClaims[0].normalizedPhrase += " extra";
  assert.throws(() => validateRoutingVocabularyRegistry([{ ...base, bytes: 1, claims: tokenClaims }]), (error: unknown) =>
    error instanceof RoutingVocabularyValidationError && error.reason === "routing-vocabulary-limit-exceeded");
});

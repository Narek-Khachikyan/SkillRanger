import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalBaselineEntries,
  compileRoutingVocabulary,
  matchRoutingVocabulary,
  type OwnedRoutingVocabularyEntry,
} from "../src/router/vocabulary/match.ts";
import { normalizeRoutingText } from "../src/router/vocabulary/normalize.ts";
import type { RoutingSignalKind } from "../src/router/vocabulary/types.ts";

const entry = (input: {
  kind: RoutingSignalKind;
  id: string;
  phrases: string[];
  negativePhrases?: string[];
  locale?: "en" | "ru" | "mixed";
  priority?: number;
  evidenceEligible?: boolean;
}): OwnedRoutingVocabularyEntry => ({
  kind: input.kind,
  id: input.id,
  phrases: input.phrases,
  ...(input.negativePhrases ? { negativePhrases: input.negativePhrases } : {}),
  locales: [input.locale ?? "en"],
  ownerIds: ["test"],
  localeMultiplier: input.locale === "mixed" ? 0.9 : 1,
  origin: input.evidenceEligible === false ? "baseline" : "explicit",
  evidenceEligible: input.evidenceEligible ?? true,
  weight: 1,
  priority: input.priority ?? 50,
});
const match = (prompt: string, entries: OwnedRoutingVocabularyEntry[]) =>
  matchRoutingVocabulary({ text: normalizeRoutingText(prompt), vocabulary: compileRoutingVocabulary(entries) });

test("matcher keeps the longest span per kind and coexisting cross-kind claims", () => {
  const result = match("integration tests for the web site", [
    entry({ kind: "artifact", id: "page", phrases: ["site"] }),
    entry({ kind: "artifact", id: "web-interface", phrases: ["web site"], priority: 60 }),
    entry({ kind: "artifact", id: "integration-test", phrases: ["integration tests"] }),
    entry({ kind: "action", id: "test", phrases: ["integration tests"] }),
  ]);
  assert.deepEqual(result.signals.map(({ kind, id }) => `${kind}:${id}`), [
    "artifact:integration-test", "action:test", "artifact:web-interface",
  ]);
});

test("matcher suppresses explicit create and evidence phrases before overlap selection", () => {
  const entries = [
    entry({
      kind: "action", id: "create", phrases: ["create", "build", "создай"],
      negativePhrases: ["не создавай", "не делай", "do not create", "don't create", "do not build", "don't build"],
    }),
    entry({ kind: "intent", id: "visual-reference", phrases: ["screenshot"], negativePhrases: ["no screenshot", "без скриншота"] }),
  ];
  for (const prompt of ["do not create a site", "don't build a site", "не создавай сайт"]) {
    const result = match(prompt, entries);
    assert.equal(result.signals.some(({ kind, id }) => kind === "action" && id === "create"), false, prompt);
  }
  for (const prompt of ["no screenshot", "без скриншота"]) {
    const result = match(prompt, entries);
    assert.equal(result.signals.some(({ id }) => id === "visual-reference"), false, prompt);
  }
});

test("noun-only design remains an intent while an explicit verb adds action design", () => {
  const entries = [
    entry({ kind: "intent", id: "visual-design", phrases: ["красивый дизайн"] }),
    entry({ kind: "action", id: "design", phrases: ["спроектируй"] }),
    entry({ kind: "artifact", id: "page", phrases: ["страница", "страницы"] }),
  ];
  assert.deepEqual(match("красивый дизайн", entries).signals.map(({ kind, id }) => `${kind}:${id}`), ["intent:visual-design"]);
  assert.deepEqual(match("спроектируй красивый дизайн страницы", entries).signals.map(({ kind, id }) => `${kind}:${id}`), [
    "action:design", "intent:visual-design", "artifact:page",
  ]);
});

test("literal provenance distinguishes exact from normalized spans and preserves original offsets", () => {
  const entries = [entry({ kind: "intent", id: "responsive-design", phrases: ["мобайл адаптация"], locale: "ru" })];
  const exact = match("МОБАЙЛ АДАПТАЦИЯ", entries).signals[0];
  const normalized = match("мобайл‑адаптация", entries).signals[0];
  assert.equal(exact.source, "prompt-exact");
  assert.equal(normalized.source, "prompt-normalized");
  assert.equal("мобайл‑адаптация".slice(normalized.originalStart, normalized.originalEnd), "мобайл‑адаптация");
});

test("canonical baseline matches only exact and spaced IDs and never becomes evidence", () => {
  const baseline = buildCanonicalBaselineEntries({
    ownerId: "mobile",
    claims: [{ kind: "artifact", id: "mobile-screen" }],
  });
  assert.equal(match("mobile-screen", baseline).signals[0]?.evidenceEligible, false);
  assert.equal(match("mobile screen", baseline).signals[0]?.id, "mobile-screen");
  assert.equal(match("mobile screens", baseline).signals.length, 0);
  assert.equal(match("mobile", baseline).signals.length, 0);
});

test("matcher protects separators inside phrases and stays within the trie operation bound", () => {
  const entries = [entry({ kind: "domain", id: "mobile", phrases: ["ios и android"], locale: "ru" })];
  const text = normalizeRoutingText("сделай ios и android приложение");
  const vocabulary = compileRoutingVocabulary(entries);
  const result = matchRoutingVocabulary({ text, vocabulary });
  assert.deepEqual(result.protectedBoundaryIndexes, [0]);
  assert.ok(result.operationCount <= text.tokens.length * (vocabulary.maxPhraseTokens + 1));
});

test("mixed declarations apply their fixed locale multiplier", () => {
  const signal = match("mixed phrase", [entry({ kind: "intent", id: "mixed-intent", phrases: ["mixed phrase"], locale: "mixed" })]).signals[0];
  assert.equal(signal.confidence, 0.9);
});

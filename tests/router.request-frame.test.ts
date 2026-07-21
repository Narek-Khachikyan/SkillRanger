import test from "node:test";
import assert from "node:assert/strict";
import { inferRequestFrameActions } from "../src/router/request-frame.ts";
import type { MatchedRoutingSignal } from "../src/router/vocabulary/match.ts";
import { normalizeRoutingText } from "../src/router/vocabulary/normalize.ts";

const signal = (text: ReturnType<typeof normalizeRoutingText>, kind: "artifact" | "action", id: string, phrase: string): MatchedRoutingSignal => {
  const start = text.normalized.indexOf(phrase);
  const end = start + phrase.length;
  const tokens = text.tokens.filter((token) => token.normalizedStart < end && start < token.normalizedEnd);
  return {
    kind, id, confidence: 1, source: "prompt-exact", evidenceEligible: true, phrase, ownerIds: ["test"], start, end,
    originalStart: Math.min(...tokens.map(({ originalStart }) => originalStart)),
    originalEnd: Math.max(...tokens.map(({ originalEnd }) => originalEnd)),
  };
};

const infer = (prompt: string, definitions: Array<["artifact" | "action", string, string]>) => {
  const text = normalizeRoutingText(prompt);
  return { text, inferred: inferRequestFrameActions({
    text,
    matchedSignals: definitions.map(([kind, id, phrase]) => signal(text, kind, id, phrase)),
    suppressions: [],
    creatableArtifactIds: new Set(["web-interface", "page", "application", "service", "component", "form"]),
  }) };
};

test("request frames infer create only for a following creatable artifact", () => {
  const { text, inferred } = infer("дай мне сайт", [["artifact", "web-interface", "сайт"]]);
  assert.equal(inferred.length, 1);
  assert.deepEqual(inferred[0], {
    kind: "action", id: "create", confidence: 0.75, source: "prompt-inferred", evidenceEligible: true,
    phrase: "дай мне", ownerIds: ["core"], start: 0, end: 7, originalStart: 0, originalEnd: 7,
  });
  assert.equal(text.normalized.slice(inferred[0].start, inferred[0].end), "дай мне");
});

test("explicit actions block inference only in their provisional segment", () => {
  assert.equal(infer("дай аудит сайта", [
    ["action", "review", "аудит"], ["artifact", "web-interface", "сайт"],
  ]).inferred.length, 0);
  const result = infer("дай аудит сайта, потом дай мне страницу", [
    ["action", "review", "аудит"], ["artifact", "web-interface", "сайт"], ["artifact", "page", "страницу"],
  ]).inferred;
  assert.equal(result.length, 1);
  assert.equal(result[0].phrase, "дай мне");
});

test("request-frame and artifact-local negation reject false create inference", () => {
  const cases = [
    ["мне не нужен сайт", "сайт"],
    ["I do not need a website", "website"],
    ["give me no website", "website"],
    ["give me without a website", "website"],
  ] as const;
  for (const [prompt, artifact] of cases) {
    assert.equal(infer(prompt, [["artifact", "web-interface", artifact]]).inferred.length, 0, prompt);
  }
  assert.equal(infer("I need a no code website", [["artifact", "web-interface", "website"]]).inferred.length, 1);
});

test("non-creatable or absent artifacts do not infer create", () => {
  assert.equal(infer("дай объяснение архитектуры", []).inferred.length, 0);
  const text = normalizeRoutingText("дай аудит сайта");
  const inferred = inferRequestFrameActions({
    text,
    matchedSignals: [signal(text, "artifact", "audit-report", "аудит")],
    suppressions: [],
    creatableArtifactIds: new Set(["page"]),
  });
  assert.deepEqual(inferred, []);
});

test("an overlapping explicit create suppression blocks request-frame inference", () => {
  const text = normalizeRoutingText("give me website");
  const inferred = inferRequestFrameActions({
    text,
    matchedSignals: [signal(text, "artifact", "web-interface", "website")],
    suppressions: [{ signalKind: "action", id: "create", start: 0, end: 7, originalStart: 0, originalEnd: 7 }],
    creatableArtifactIds: new Set(["web-interface"]),
  });
  assert.deepEqual(inferred, []);
});

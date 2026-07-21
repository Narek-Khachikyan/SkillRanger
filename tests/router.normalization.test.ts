import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRoutingText } from "../src/router/vocabulary/normalize.ts";

test("routing normalization handles RU/EN technology punctuation without stemming", () => {
  const cases = [
    ["Мобайл‑адаптация, АНИМАЦИИ!", "мобайл адаптация анимации"],
    ["Ёлка — это ЁЛКА", "елка это елка"],
    ["Ｃ＋＋ and C#; .NET", "c++ and c# .net"],
    ["api / service", "api service"],
    ["ios/android", "ios/android"],
    ["  quoted ‘Text’  ", "quoted text"],
  ] as const;
  for (const [input, expected] of cases) assert.equal(normalizeRoutingText(input).normalized, expected, input);
});

test("normalization retains enclosing original spans and segmentation boundaries", () => {
  const input = "ﬃ, ios и android; потом сайт";
  const normalized = normalizeRoutingText(input);
  assert.equal(normalized.normalized, "ffi ios и android потом сайт");
  assert.deepEqual(normalized.boundaries.map(({ separator }) => separator), [",", "и", ";", "потом"]);
  for (const token of normalized.tokens) {
    assert.ok(token.normalizedStart < token.normalizedEnd);
    assert.ok(token.originalStart < token.originalEnd);
    assert.ok(token.originalStart >= 0 && token.originalEnd <= input.length);
  }
  assert.deepEqual(normalized.tokens[0], {
    value: "ffi",
    normalizedStart: 0,
    normalizedEnd: 3,
    originalStart: 0,
    originalEnd: 1,
  });
});


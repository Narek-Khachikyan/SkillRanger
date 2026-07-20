import test from "node:test";
import assert from "node:assert/strict";
import { parseTrigger } from "../src/router/trigger.ts";

const explicit = (prompt: string, maxIntentBytes?: number) => parseTrigger({
  prompt,
  mode: "explicit",
  ...(maxIntentBytes === undefined ? {} : { maxIntentBytes }),
});

test("explicit mode recognizes every terminal alias case-insensitively", () => {
  for (const [prompt, trigger] of [
    ["Fix the tests @skillranger", "@skillranger"],
    ["Fix the tests @SkillRanger", "@skillranger"],
    ["Fix the tests SKILLRANGER", "skillranger"],
    ["Fix the tests skiLLranger", "skillranger"],
    ["Fix the tests /SR", "/sr"],
    ["Fix the tests /Sr", "/sr"],
  ] as const) {
    assert.deepEqual(explicit(prompt), {
      activated: true,
      mode: "explicit",
      trigger,
      originalPrompt: prompt,
      normalizedIntent: "Fix the tests",
    });
  }
});

test("explicit mode applies NFKC and accepts terminal whitespace and multiline intent", () => {
  const prompt = "  Исправь тесты\nи проверь сборку　＠ＳＫＩＬＬＲＡＮＧＥＲ \n\t";
  assert.deepEqual(explicit(prompt), {
    activated: true,
    mode: "explicit",
    trigger: "@skillranger",
    originalPrompt: prompt,
    normalizedIntent: "Исправь тесты\nи проверь сборку",
  });
});

test("punctuation may precede an explicit trigger", () => {
  assert.equal(explicit("Fix the tests!@skillranger").activated, true);
  assert.equal(explicit("Fix the tests. @skillranger").activated, true);
});

test("punctuation after a trigger prevents activation", () => {
  assert.deepEqual(explicit("Fix the tests @skillranger."), {
    activated: false,
    mode: "explicit",
    originalPrompt: "Fix the tests @skillranger.",
    reason: "trigger-required",
  });
});

test("triggers inside fenced or inline code do not activate", () => {
  for (const prompt of [
    "Review this:\n```text\n@skillranger",
    "Review this:\n~~~\n@skillranger",
    "Review `@skillranger",
    "Review ``@skillranger",
  ]) {
    assert.equal(explicit(prompt).activated, false, prompt);
  }
  assert.equal(explicit("`not a trigger`\nReview this @skillranger").activated, true);
  assert.equal(explicit("```text\nnot a trigger\n```\nReview this @skillranger").activated, true);
});

test("URLs, filenames, paths, and substrings do not activate", () => {
  for (const prompt of [
    "See https://example.test/@skillranger",
    "See https://example.test#skillranger",
    "See https://example.test?skillranger",
    "See example.test#skillranger",
    "See /search?q=skillranger",
    "Email mailto:skillranger",
    "See www.example.test#skillranger",
    "See docs/@skillranger",
    "Open notes.skillranger",
    "Open skillranger.md",
    "Use myskillranger",
    "Use @skillranger-extra",
    "Open ./sr",
  ]) {
    assert.equal(explicit(prompt).activated, false, prompt);
  }
});

test("an explicit trigger without intent reports empty-intent", () => {
  for (const prompt of ["@skillranger", " \n /sr\t"]) {
    assert.deepEqual(explicit(prompt), {
      activated: false,
      mode: "explicit",
      originalPrompt: prompt,
      reason: "empty-intent",
    });
  }
});

test("the UTF-8 byte limit is checked before trigger analysis", () => {
  const prompt = "я @skillranger";
  assert.equal(prompt.length < Buffer.byteLength(prompt, "utf8"), true);
  assert.deepEqual(explicit(prompt, prompt.length), {
    activated: false,
    mode: "explicit",
    originalPrompt: prompt,
    reason: "intent-too-large",
  });
});

test("direct core mode does not require or remove a trigger", () => {
  const prompt = "　Build the API @skillranger  ";
  assert.deepEqual(parseTrigger({ prompt, mode: "direct" }), {
    activated: true,
    mode: "direct",
    originalPrompt: prompt,
    normalizedIntent: "Build the API @skillranger",
  });
  assert.deepEqual(parseTrigger({ prompt: " \n\t", mode: "direct" }), {
    activated: false,
    mode: "direct",
    originalPrompt: " \n\t",
    reason: "empty-intent",
  });
});

test("explicit mode always requires a terminal trigger", () => {
  assert.deepEqual(explicit("Fix the tests"), {
    activated: false,
    mode: "explicit",
    originalPrompt: "Fix the tests",
    reason: "trigger-required",
  });
});

test("adversarial markdown input is handled without recursive or superlinear parsing", () => {
  const prompt = `${"x`x`".repeat(40_000)} @skillranger`;
  const startedAt = performance.now();
  const result = explicit(prompt, 300_000);
  assert.equal(result.activated, true);
  assert.ok(performance.now() - startedAt < 2_000);
});

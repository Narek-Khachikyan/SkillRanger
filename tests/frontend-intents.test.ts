import test from "node:test";
import assert from "node:assert/strict";
import { analyzeFrontendIntent, normalizeFrontendText } from "../src/domains/frontend/intents/index.ts";

test("normalizes Russian case, punctuation, and ё", () => {
  assert.equal(normalizeFrontendText("  ПРОВЕРЬ, всё Ёмкое!  "), "проверь все емкое");
});

test("maps Russian specialist requests to canonical intents", () => {
  assert.deepEqual(
    [...analyzeFrontendIntent("Проверь доступность: клавиатуру, фокус и контраст").intents],
    ["accessibility-review"],
  );
  assert.deepEqual(
    [...analyzeFrontendIntent("Страница тормозит, проверь LCP и размер бандла").intents],
    ["performance-review"],
  );
});

test("detects explicit skill-use control intent without inventing a task intent", () => {
  const analysis = analyzeFrontendIntent("Почему ты не используешь скиллы?");
  assert.deepEqual([...analysis.controlIntents], ["require-skill-lifecycle"]);
  assert.deepEqual([...analysis.intents], []);
});

test("reports mixed locale for Russian prompts containing frontend terms", () => {
  assert.equal(analyzeFrontendIntent("Используй frontend skill и проверь responsive layout").locale, "mixed");
});

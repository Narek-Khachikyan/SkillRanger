import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadBackendEvalSuite, runBackendRoutingEval } from "../src/evals/backend.ts";
import path from "node:path";

test("backend eval suite loads and has correct counts", async () => {
  const suite = await loadBackendEvalSuite();
  assert.equal(suite.name, "backend-skill-quality-v1");
  assert.equal(suite.targetCounts.triggerPrompts, suite.triggerPrompts.length);
  assert.ok(suite.triggerPrompts.length >= 8);
});

test("backend eval package scripts include bilingual eval", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(pkg.scripts["eval:backend"], /backend/);
  assert.match(pkg.scripts["eval:backend:ru"], /ru/);
  assert.match(pkg.scripts["release:check"], /eval:backend/);
});

test("backend routing eval passes for en and ru prompts", async () => {
  const en = await runBackendRoutingEval({ projectRoot: path.resolve("fixtures/next-react-ts"), locale: "en" });
  assert.ok(en.passed > 0, `en passed ${en.passed}/${en.total}`);
  assert.equal(en.failed, 0, JSON.stringify(en.failures));
  const ru = await runBackendRoutingEval({ projectRoot: path.resolve("fixtures/next-react-ts"), locale: "ru" });
  assert.ok(ru.passed > 0);
  assert.equal(ru.failed, 0, JSON.stringify(ru.failures));
});

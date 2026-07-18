import test from "node:test";
import assert from "node:assert/strict";
import { summarizeSetupRecommendations } from "../src/cli/setup-recommendations.ts";
import type { Recommendation } from "../src/types.ts";

const recommendation = (skillId: string, score: number) => ({ skillId, score }) as Recommendation;

test("setup recommendation summary keeps the best score and compatible targets", () => {
  const summary = summarizeSetupRecommendations([
    { targetAgent: "codex", recommendations: [recommendation("frontend.shared", 0.8), recommendation("frontend.codex", 0.7)] },
    { targetAgent: "claude-code", recommendations: [recommendation("frontend.shared", 0.6), recommendation("frontend.claude", 0.9)] },
  ]);

  assert.deepEqual(summary.recommendations.map(({ skillId }) => skillId), [
    "frontend.claude",
    "frontend.shared",
    "frontend.codex",
  ]);
  assert.deepEqual(summary.targetsBySkillId.get("frontend.shared"), ["codex", "claude-code"]);
  assert.deepEqual(summary.targetsBySkillId.get("frontend.codex"), ["codex"]);
  assert.deepEqual(summary.targetsBySkillId.get("frontend.claude"), ["claude-code"]);
});

test("setup recommendation summary records targets with no recommendations", () => {
  const summary = summarizeSetupRecommendations([
    { targetAgent: "codex", recommendations: [recommendation("frontend.shared", 0.8)] },
    { targetAgent: "cursor", recommendations: [] },
  ]);
  assert.deepEqual(summary.targetsWithoutRecommendations, ["cursor"]);
  assert.deepEqual(summary.targetsBySkillId.get("frontend.shared"), ["codex"]);
});

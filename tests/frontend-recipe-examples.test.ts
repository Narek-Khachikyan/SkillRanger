import test from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import {
  loadRecipeExamplePacks,
  renderExamplePlate,
  type ExampleScene,
} from "../src/domains/frontend/design/index.ts";

test("ships complete good/bad desktop/mobile/state packs", async () => {
  const packs = await loadRecipeExamplePacks();
  assert.equal(packs.length, 8);
  let assetCount = 0;
  for (const pack of packs) {
    const keys = new Set(pack.scenes.map((scene) => `${scene.quality}:${scene.viewport}:${scene.state}`));
    for (const required of [
      "good:desktop:success", "bad:desktop:success", "good:mobile:success", "bad:mobile:success",
      "good:mobile:loading", "bad:mobile:loading", "good:mobile:empty", "bad:mobile:empty",
      "good:mobile:error", "bad:mobile:error",
    ]) assert.ok(keys.has(required), `${pack.recipeId} lacks ${required}`);
    assert.equal(pack.scenes.length, 10);
    assert.ok(pack.differenceExplanation.length >= 3);
    for (const scene of pack.scenes) {
      assert.ok((await stat(scene.assetPath)).size > 100);
      if (scene.quality === "good") assert.ok(scene.appliedRuleIds.length >= 6);
      else assert.ok(scene.violatedRuleIds.length >= 3);
      assetCount += 1;
    }
  }
  assert.equal(assetCount, 80);
});

test("renders deterministic escaped semantic SVG plates", () => {
  const scene: ExampleScene = {
    id: "escape-check",
    quality: "bad",
    viewport: "mobile",
    state: "error",
    title: "Try <again>",
    primaryAction: "Try again",
    blocks: [{ kind: "status", label: "Offline & Unavailable", emphasis: 2 }],
    appliedRuleIds: [],
    violatedRuleIds: ["state.recovery-first", "color.semantic-roles", "layout.action-evidence"],
    asset: "assets/escape-check.svg",
  };
  const first = renderExamplePlate(scene);
  assert.equal(first, renderExamplePlate(scene));
  assert.match(first, /viewBox="0 0 390 844"/);
  assert.match(first, /Try &lt;again&gt;/);
  assert.match(first, /Offline &amp; Unavailable/);
  assert.doesNotMatch(first, /<again>/);
});

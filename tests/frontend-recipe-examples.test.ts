import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  generateExampleAssets,
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

test("rejects incomplete example packs at runtime", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-examples-"));
  try {
    await cp("domains/frontend/examples", root, { recursive: true });
    const file = path.join(root, "consumer-discovery", "example.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    source.scenes.pop();
    await writeFile(file, JSON.stringify(source), "utf8");
    await assert.rejects(loadRecipeExamplePacks(root), /Invalid recipe example pack/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generator rejects assets that do not match the scene id", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-example-output-"));
  try {
    await cp("domains/frontend/examples", root, { recursive: true });
    const file = path.join(root, "operational-command-center", "example.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    source.scenes[0].asset = "example.json";
    await writeFile(file, JSON.stringify(source), "utf8");
    await assert.rejects(generateExampleAssets(root), /asset must match assets\/good-desktop-success\.svg/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

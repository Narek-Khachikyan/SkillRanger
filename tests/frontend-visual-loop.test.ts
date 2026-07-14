import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type {
  DesignVariantMetadata,
  VisualCriticReport,
  VisualRun,
} from "../src/domains/frontend/design/index.ts";

test("exports immutable visual orchestration artifacts", () => {
  const variant: DesignVariantMetadata = {
    schemaVersion: "1.0",
    id: "variant-a",
    recipeId: "saas-workspace",
    directionPath: ".design/variants/variant-a/direction.json",
    ruleIds: ["layout.list-detail", "state.recovery-first"],
    createdOrder: 1,
    generatorActorId: "generator-1",
    implementationArtifact: "git-diff:abc",
    evidenceIds: ["evidence-initial-a"],
  };
  const run: VisualRun = {
    schemaVersion: "1.0",
    id: "visual-run-1",
    policyPath: ".design/execution-policy.json",
    state: "implemented",
    variantIds: [variant.id],
    artifacts: {},
    history: [{ state: "policy-resolved", at: "2026-07-14T00:00:00.000Z" }],
  };
  assert.equal(run.state, "implemented");
});

test("publishes visual variant, critic, and run schemas", async () => {
  const manifest = JSON.parse(await readFile("domains/frontend/domain.manifest.json", "utf8"));
  for (const file of ["design-variant", "visual-critic-report", "visual-run"]) {
    assert.ok(manifest.artifacts.schemas.includes(`schemas/${file}.schema.json`));
  }
});

test("visual contracts are strict and bound critic scores", async () => {
  const [variantSchema, criticSchema, runSchema] = await Promise.all(
    ["design-variant", "visual-critic-report", "visual-run"].map(async (file) =>
      JSON.parse(await readFile(`domains/frontend/schemas/${file}.schema.json`, "utf8")),
    ),
  );
  assert.equal(variantSchema.additionalProperties, false);
  assert.equal(variantSchema.properties.evidenceIds.uniqueItems, true);
  assert.equal(criticSchema.additionalProperties, false);
  assert.equal(criticSchema.properties.candidateVariantIds.uniqueItems, true);
  assert.equal(criticSchema.properties.evidenceIds.uniqueItems, true);
  assert.equal(criticSchema.$defs.score.minimum, 0);
  assert.equal(criticSchema.$defs.score.maximum, 1);
  assert.equal(criticSchema.properties.confidence.minimum, 0);
  assert.equal(criticSchema.properties.confidence.maximum, 1);
  assert.equal(runSchema.additionalProperties, false);
  assert.equal(runSchema.properties.variantIds.uniqueItems, true);
});

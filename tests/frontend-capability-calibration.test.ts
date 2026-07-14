import test from "node:test";import assert from "node:assert/strict";import {calibrateCapabilityRecord,constraintsFromCapabilityRecord,loadCapabilityRecord} from "../src/evals/visual/calibration.ts";import {makeMetrics} from "./helpers/visual-benchmark-fixtures.ts";
test("selects constrained for unstable or insufficient evidence",()=>{assert.equal(calibrateCapabilityRecord(makeMetrics({sampleCount:7})).profile,"constrained");assert.equal(calibrateCapabilityRecord(makeMetrics({catastrophicFailureRate:.11,verificationSuccessRate:.9})).profile,"constrained");});
test("selects advanced only for high quality stable evidence",()=>{const record=calibrateCapabilityRecord(makeMetrics({meanQuality:.86,catastrophicFailureRate:.01,verificationSuccessRate:.94,withinConditionVariance:.03,meanRepairIterations:1.2}));assert.equal(record.profile,"advanced");assert.equal(constraintsFromCapabilityRecord(record).maxVariants,3);assert.equal(constraintsFromCapabilityRecord(record).maxPrimitiveFreedom,"new-primitives");});
test("does not use model id to classify and loads conservative default",async()=>{const metrics=makeMetrics();assert.equal(calibrateCapabilityRecord({...metrics,modelIds:["provider/a"]}).profile,calibrateCapabilityRecord({...metrics,modelIds:["provider/b"]}).profile);assert.equal((await loadCapabilityRecord()).profile,"constrained");});


test("rejects forged capability schema, provenance, metrics, and policy constraints", async () => {
  const valid = calibrateCapabilityRecord(makeMetrics());
  const forged = {
    ...valid,
    modelIds: [42],
    evaluatedAt: "not-a-date",
    profile: "advanced",
    constraints: { ...valid.constraints, profile: "advanced", maxVariants: 999, allowedRecipeIds: ["unknown-recipe"] },
  } as any;
  assert.throws(() => constraintsFromCapabilityRecord(forged), /Invalid model capability record/);
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const root = await mkdtemp(path.join(os.tmpdir(), "capability-record-"));
  const file = path.join(root, "forged.json");
  await writeFile(file, JSON.stringify(forged));
  await assert.rejects(loadCapabilityRecord(file), /Invalid model capability record/);
});

test("rejects unsafe evidence paths and out-of-range finite metrics", () => {
  assert.throws(() => calibrateCapabilityRecord(makeMetrics({ meanQuality: 2 })), /meanQuality/);
  assert.throws(() => calibrateCapabilityRecord({ ...makeMetrics(), evidencePaths: ["../outside/report.json"] }), /evidencePaths/);
});

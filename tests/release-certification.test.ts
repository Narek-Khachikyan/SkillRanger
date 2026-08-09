import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReleaseHandoff,
  validateFrontendReleaseArtifacts,
  frontendReleaseVersion,
} from "../src/release/certification.ts";

test("validates the 0.4.1 frontend release artifact contract", async () => {
  const report = await validateFrontendReleaseArtifacts();

  assert.equal(frontendReleaseVersion, "0.4.1");
  assert.equal(report.ok, true, report.issues.join("; "));
  assert.equal(report.releaseVersion, "0.4.1");
  assert.equal(report.packageVersion, "0.4.1");
  assert.deepEqual(report.ruleContract.families, [
    "typography", "layout", "responsive", "color", "state", "signature-move",
  ]);
  assert.equal(report.ruleContract.ruleCount, 18);
  assert.equal(report.ruleContract.recipeCount, 8);
  assert.equal(report.ruleContract.examplePackCount, 8);
  assert.equal(report.ruleContract.exampleSceneCount, 80);
  assert.equal(report.ruleContract.assetCount, 80);
});

test("never certifies a handoff when a required evidence source is missing", () => {
  const report = evaluateReleaseHandoff({
    releaseArtifacts: {
      schemaVersion: "1.0",
      releaseVersion: "0.4.0",
      packageVersion: "0.4.0",
      domain: { id: "frontend", version: "1.0.0", releaseVersion: "0.4.0" },
      ruleContract: {
        families: ["typography", "layout", "responsive", "color", "state", "signature-move"],
        ruleCount: 18,
        recipeCount: 8,
        examplePackCount: 8,
        exampleSceneCount: 80,
        assetCount: 80,
      },
      files: [],
      issues: [],
      ok: true,
    },
    sourceIssues: ["visual review package is missing"],
    evidenceFiles: [],
  });

  assert.equal(report.verdict, "not-promotable");
  assert.ok(report.blockingReasons.some((reason) => reason.includes("visual review package is missing")));
  assert.ok(report.blockingReasons.some((reason) => reason.includes("visual benchmark gate")));
  assert.equal(report.gates.visual.verdict, "not-promotable");
  assert.equal(report.gates.baseline.verdict, "not-promotable");
});

test("turns malformed baseline evidence into a blocked handoff instead of throwing", () => {
  const report = evaluateReleaseHandoff({
    releaseArtifacts: {
      schemaVersion: "1.0",
      releaseVersion: "0.4.0",
      packageVersion: "0.4.0",
      domain: { id: "frontend", version: "1.0.0", releaseVersion: "0.4.0" },
      ruleContract: {
        families: ["typography", "layout", "responsive", "color", "state", "signature-move"],
        ruleCount: 18,
        recipeCount: 8,
        examplePackCount: 8,
        exampleSceneCount: 80,
        assetCount: 80,
      },
      files: [],
      issues: [],
      ok: true,
    },
    baseline: { suite: {} as never, evidence: {} as never },
    evidenceFiles: [],
  });

  assert.equal(report.verdict, "not-promotable");
  assert.equal(report.gates.baseline.verdict, "not-promotable");
  assert.ok(report.blockingReasons.some((reason) => reason.includes("baseline gate")));
});

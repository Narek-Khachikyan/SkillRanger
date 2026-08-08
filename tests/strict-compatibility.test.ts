import test from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  StrictSkillRunError,
  StrictSkillRunStore,
  assertValidStrictSkillRun,
  deriveStrictValidatorResults,
  type SkillRunV2,
} from "../src/runtime/strict/index.ts";
import { deriveStrictCertificationProjection } from "../src/runtime/strict/certification.ts";

const fixturesRoot = "tests/fixtures/strict-runs";

const loadFixture = async (name: string): Promise<{ root: string; run: SkillRunV2 }> => {
  const fixtureDir = path.join(fixturesRoot, name);
  const run = JSON.parse(await readFile(path.join(fixtureDir, "run.json"), "utf8")) as SkillRunV2;
  assertValidStrictSkillRun(run);
  const root = await mkdtemp(path.join(os.tmpdir(), `strict-fixture-${name}-`));
  await mkdir(path.join(root, ".skillranger", "runs"), { recursive: true });
  const blobs = await readdir(path.join(fixtureDir, "artifacts"));
  for (const blob of blobs) {
    const artifact = run.artifacts.find((entry) => path.basename(entry.path) === blob);
    assert.ok(artifact, `fixture blob ${blob} is not referenced by the persisted run ${name}`);
    const target = path.join(root, artifact.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(path.join(fixtureDir, "artifacts", blob)));
  }
  return { root, run };
};

const fixtureNames = ["pre-refactor-visual-tailwind", "pre-refactor-performance"];

for (const name of fixtureNames) {
  test(`pre-refactor persisted run ${name} loads, verifies, and finalizes without migration`, async () => {
    const { root, run } = await loadFixture(name);
    const store = new StrictSkillRunStore(root);
    assert.equal(run.state, "verifying");
    await store.create(run);

    const loaded = await store.read(run.runId);
    assert.equal(loaded.state, "verifying");

    for (const ledger of run.skillLedgers) {
      const frozenReport = ledger.verificationReports.at(-1)!;
      const currentLedger = loaded.skillLedgers.find((entry) => entry.skillId === ledger.skillId)!;
      assert.equal(currentLedger.outcome, "used");
      const derivation = await deriveStrictValidatorResults(root, loaded, currentLedger);
      const expected = deriveStrictCertificationProjection(loaded, currentLedger, derivation);
      assert.ok(isDeepStrictEqual(expected.gateResults, frozenReport.gateResults),
        `re-derived gate results for ${ledger.skillId} must match the pre-refactor report`);
      assert.ok(isDeepStrictEqual(expected.evidenceIds, frozenReport.evidenceIds),
        `re-derived evidence ids for ${ledger.skillId} must match the pre-refactor report`);
    }

    const finalized = await store.finalizeRun(run.runId);
    assert.equal(finalized.state, "verified");
  });
}

test("a pre-refactor run with a tampered verification report cannot be finalized", async () => {
  const { root, run } = await loadFixture("pre-refactor-performance");
  const report = run.skillLedgers[0].verificationReports.at(-1)!;
  const outputGate = report.gateResults.find(({ gateId }) => gateId.endsWith("/output-schema-valid"))!;
  outputGate.message = "tampered after certification";
  const store = new StrictSkillRunStore(root);
  await store.create(run);
  await assert.rejects(
    store.finalizeRun(run.runId),
    (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity",
  );
});

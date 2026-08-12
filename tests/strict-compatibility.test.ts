import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  StrictSkillRunError,
  StrictSkillRunStore,
  assertValidStrictSkillRun,
  createContentChunks,
  deriveStrictValidatorResults,
  type ExecutionContractV2,
  type SkillContentChunk,
  type SkillRunV2,
} from "../src/runtime/strict/index.ts";
import { deriveStrictCertificationProjection } from "../src/runtime/strict/certification.ts";
import { findSkill } from "../src/registry/index.ts";

const fixturesRoot = "tests/fixtures/strict-runs";
const sha256 = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

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

const contractsFixture = "contracts-v1.1-visual-tailwind";
const fixtureNames = ["pre-refactor-visual-tailwind", "pre-refactor-performance", contractsFixture];

for (const name of fixtureNames) {
  test(`persisted run ${name} loads, verifies, and finalizes without migration`, async () => {
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

const registryTextChunks = async (skillId: string): Promise<SkillContentChunk[]> => {
  const skill = await findSkill(skillId);
  assert.ok(skill, `bundled registry must contain ${skillId}`);
  const contract = JSON.parse(await readFile(path.join(skill.path, "execution.contract.json"), "utf8")) as ExecutionContractV2;
  const sourceByInstallPath = new Map((skill.sharedContracts ?? []).map(({ installPath, path: sourcePath }) => [installPath, sourcePath]));
  const allChunks: SkillContentChunk[] = [];
  for (const mustRead of contract.mustRead) {
    const source = sourceByInstallPath.get(mustRead) ?? path.join(skill.path, mustRead);
    allChunks.push(...createContentChunks(mustRead, await readFile(source, "utf8")));
  }
  return allChunks.map((chunk, ordinal) => ({ ...chunk, ordinal, total: allChunks.length }));
};

test("contracts-v1.1 fixture pins the delivered full skill text, schemas, and execution contract to the bundled registry", async () => {
  const run = JSON.parse(
    await readFile(path.join(fixturesRoot, contractsFixture, "run.json"), "utf8"),
  ) as SkillRunV2;
  for (const ledger of run.skillLedgers) {
    const skill = await findSkill(ledger.skillId);
    assert.ok(skill, `bundled registry must contain ${ledger.skillId}`);
    const contract = JSON.parse(await readFile(path.join(skill.path, "execution.contract.json"), "utf8")) as ExecutionContractV2;
    assert.ok(isDeepStrictEqual(ledger.contract, contract),
      `${ledger.skillId}: pinned execution contract drifted from the bundled registry; `
      + `regenerate tests/fixtures/strict-runs/${contractsFixture}`);
    assert.ok(isDeepStrictEqual(ledger.contentChunks, await registryTextChunks(ledger.skillId)),
      `${ledger.skillId}: pinned full skill text drifted from the bundled registry; `
      + `regenerate tests/fixtures/strict-runs/${contractsFixture}`);
    const readSchema = async (relativePath: string) => JSON.parse(await readFile(path.join(skill.path, relativePath), "utf8"));
    const expectedSchemaChecksums = {
      input: sha256(JSON.stringify(await readSchema(contract.inputSchema))),
      output: sha256(JSON.stringify(await readSchema(contract.outputSchema))),
    };
    assert.ok(isDeepStrictEqual(ledger.schemaChecksums, expectedSchemaChecksums),
      `${ledger.skillId}: pinned input/output schemas drifted from the bundled registry; `
      + `regenerate tests/fixtures/strict-runs/${contractsFixture}`);
  }
  const directionArtifact = run.artifacts.find(({ kind }) => kind === "design-direction");
  assert.ok(directionArtifact, "the fixture must carry a certified design-direction artifact");
  const direction = JSON.parse(await readFile(
    path.join(fixturesRoot, contractsFixture, "artifacts", path.basename(directionArtifact.path)),
    "utf8",
  )) as Record<string, unknown>;
  assert.equal(direction.schemaVersion, "1.1");
  assert.equal(typeof direction.macrostructure, "string");
  assert.deepEqual(Object.keys((direction.themeAxes as Record<string, unknown>) ?? {}).sort(),
    ["accentHue", "displayStyle", "paperBand"]);
});

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

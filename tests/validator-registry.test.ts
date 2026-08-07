import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getAdapter } from "../src/installers/codex.ts";
import { getDomainPack, registerDomainPack, unregisterDomainPack } from "../src/domains/registry.ts";
import type { DomainPackManifest, DomainRoutingPolicy } from "../src/domains/types.ts";
import { loadLocalRegistry } from "../src/registry/index.ts";
import { prepareTask } from "../src/router/prepare.ts";
import {
  StrictSkillRunError,
  StrictSkillRunStore,
  TrustedValidatorRegistry,
  assertBundledContractValidatorOwnership,
  assertRunTrustedValidatorOwnership,
  assertSelectionsTrustedValidatorOwnership,
  beginStrictStep,
  buildTrustedValidatorRegistry,
  completeStrictStep,
  coreValidatorIds,
  createContentChunks,
  createStrictSkillRun,
  parseValidatorId,
  readNextStrictChunk,
  resolveTrustedValidatorRegistry,
  startPreparedStrictSkillRun,
  type ExecutionContractV2,
  type SkillRunV2,
  type StrictSkillSelection,
} from "../src/runtime/strict/index.ts";

const sha = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const syntheticRouting: DomainRoutingPolicy = {
  rejectIntent: () => false,
  laneAdjustment: () => 0,
  skillAdjustment: () => 0,
  includeSkill: () => true,
  compose: (recommendations) => recommendations,
};

const syntheticManifest = (id: string, validators: string[] = []): DomainPackManifest => ({
  schemaVersion: "1.0",
  id,
  displayName: `Synthetic ${id}`,
  version: "1.0.0",
  coreApi: "1.0",
  skillIdPrefix: `${id}.`,
  capabilities: ["verification"],
  artifacts: { intents: [], schemas: [], recipes: [], workflows: [], validators: [] },
  ownership: [{ intent: `${id}-task`, primarySkill: `${id}.primary-skill`, supportingSkills: [] }],
});

const withSyntheticPack = async <T>(
  id: string,
  validators: string[],
  run: () => Promise<T>,
): Promise<T> => {
  assert.equal(getDomainPack(id), undefined, `synthetic pack ${id} must not pre-exist`);
  registerDomainPack({ manifest: syntheticManifest(id, validators), routing: syntheticRouting, validators });
  try {
    return await run();
  } finally {
    unregisterDomainPack(id);
  }
};

const validatorContract = (skillId: string, validatorId: string): ExecutionContractV2 => ({
  schemaVersion: "2.0",
  skillId,
  contractVersion: "2.0.0",
  inputSchema: "input.schema.json",
  outputSchema: "output.schema.json",
  mustRead: ["SKILL.md"],
  applicability: { op: "tag", value: "frontend" },
  prerequisites: [],
  maxRepairIterations: 1,
  rules: [{ id: `${skillId}/rule/evidence`, description: "Record evidence." }],
  steps: [{ id: `${skillId}/step/collect`, type: "collect", requiredEvidenceKinds: ["report"], ruleIds: [`${skillId}/rule/evidence`] }],
  gates: [
    { id: `${skillId}/gate/report`, level: "hard", evaluator: { type: "evidence-present", evidenceKind: "report" }, ruleIds: [`${skillId}/rule/evidence`] },
    { id: `${skillId}/gate/validator`, level: "hard", evaluator: { type: "validator", validatorId }, ruleIds: [`${skillId}/rule/evidence`] },
  ],
});

const selection = (skillId: string, validatorId: string): StrictSkillSelection => {
  const contract = validatorContract(skillId, validatorId);
  return {
    skillId,
    role: "primary",
    mandatory: true,
    version: "1.0.0",
    packageChecksum: sha("package"),
    contractChecksum: sha(JSON.stringify(contract)),
    contract,
    schemaSnapshots: { input: { type: "object" }, output: { type: "object" } },
    schemaChecksums: { input: sha(JSON.stringify({ type: "object" })), output: sha(JSON.stringify({ type: "object" })) },
    contentChunks: createContentChunks("SKILL.md", "# Test\n"),
    applicable: true,
    unmetPrerequisites: [],
  };
};

test("parses only syntactically valid core/<name> and <domain>/<name> validator ids", () => {
  for (const [id, owner] of [
    ["core/artifact-integrity", "core"],
    ["frontend/browser-hard-gates", "frontend"],
    ["a-1.2/x_3", "a-1.2"],
  ] as const) {
    assert.deepEqual(parseValidatorId(id), { owner, name: id.slice(owner.length + 1) });
  }
  for (const malformed of ["core", "core/", "/name", "Core/name", "core/name/extra", "", "a b/c", "a//b", "a/b/", "-a/b", "a/-b"]) {
    assert.equal(parseValidatorId(malformed), undefined, malformed);
  }
});

test("builds an immutable registry from core and selected ledgers' domain packs", () => {
  const registry = buildTrustedValidatorRegistry([{ skillId: "frontend.performance-review" }]);

  for (const core of coreValidatorIds) assert.equal(registry.has(core), true);
  assert.equal(registry.has("frontend/performance-claims"), true);
  assert.equal(registry.has("frontend/browser-hard-gates"), true);
  assert.equal(registry.has("frontend/tailwind-source"), true);
  assert.equal(registry.ownerOf("frontend/performance-claims"), "frontend");
  assert.equal(registry.ownerOf("core/artifact-integrity"), "core");
  assert.equal(registry.size, coreValidatorIds.length + 3);
  assert.deepEqual(registry.domainIds(), ["core", "frontend"]);

  const snapshot = registry.domainIds();
  assert.equal(snapshot.length, 2);
  assert.throws(() => TrustedValidatorRegistry.fromIds(["malformed"]), /syntactically valid/);
});

test("registry excludes unselected registered domain packs and includes selected ones", async () => {
  await withSyntheticPack("analytics", ["analytics/analytics-check"], async () => {
    const frontendOnly = buildTrustedValidatorRegistry([{ skillId: "frontend.performance-review" }]);
    assert.equal(frontendOnly.has("analytics/analytics-check"), false);

    const multi = buildTrustedValidatorRegistry([
      { skillId: "frontend.performance-review" },
      { skillId: "analytics.some-skill" },
    ]);
    assert.equal(multi.has("analytics/analytics-check"), true);
    assert.deepEqual(multi.domainIds(), ["analytics", "core", "frontend"]);
  });
});

test("domain registration rejects core validators, cross-domain ids, duplicates, and malformed ids", async () => {
  const cases: Array<[string[], RegExp]> = [
    [["core/artifact-integrity"], /core validator/i],
    [["other-domain/thing"], /owned by domain testdomain/],
    [["testdomain/alpha", "testdomain/alpha"], /duplicate validator id/],
    [["no-slash"], /<domain>\/<name>/],
    [["testdomain/"], /<domain>\/<name>/],
  ];
  for (const [validators, pattern] of cases) {
    assert.equal(getDomainPack("testdomain"), undefined);
    assert.throws(
      () => registerDomainPack({ manifest: syntheticManifest("testdomain", validators), routing: syntheticRouting, validators }),
      pattern,
    );
  }
  const pack = registerDomainPack({
    manifest: syntheticManifest("testdomain"),
    routing: syntheticRouting,
    validators: ["testdomain/beta", "testdomain/alpha"],
  });
  try {
    assert.deepEqual(pack.validators, ["testdomain/alpha", "testdomain/beta"]);
  } finally {
    unregisterDomainPack("testdomain");
  }
});

test("phase 2 accepts only validators owned by selected domain packs and rejects cross-domain use", async () => {
  assert.doesNotThrow(() =>
    assertSelectionsTrustedValidatorOwnership([selection("frontend.performance-review", "frontend/performance-claims")]));
  assert.doesNotThrow(() =>
    assertSelectionsTrustedValidatorOwnership([selection("frontend.performance-review", "core/artifact-integrity")]));
  assert.doesNotThrow(() =>
    assertRunTrustedValidatorOwnership({
      skillLedgers: [{ skillId: "frontend.performance-review", contract: validatorContract("frontend.performance-review", "frontend/performance-claims") }],
    } as unknown as SkillRunV2));

  await withSyntheticPack("analytics", ["analytics/analytics-check"], async () => {
    assert.throws(
      () => assertSelectionsTrustedValidatorOwnership([selection("frontend.performance-review", "analytics/analytics-check")]),
      (error: unknown) => error instanceof StrictSkillRunError
        && error.code === "strict-contract-missing"
        && /not owned by a selected domain pack/.test(error.message)
        && error.details?.reason === "validator-ownership",
    );

    assert.throws(
      () => assertSelectionsTrustedValidatorOwnership([
        selection("frontend.performance-review", "frontend/performance-claims"),
        selection("analytics.some-skill", "frontend/performance-claims"),
      ]),
      (error: unknown) => error instanceof StrictSkillRunError
        && /belongs to domain frontend, not analytics/.test(error.message),
    );

    assert.doesNotThrow(() => assertSelectionsTrustedValidatorOwnership([
      selection("frontend.performance-review", "frontend/performance-claims"),
      selection("analytics.some-skill", "analytics/analytics-check"),
    ]));
  });

  assert.throws(
    () => assertSelectionsTrustedValidatorOwnership([selection("frontend.performance-review", "core/unknown-core")]),
    (error: unknown) => error instanceof StrictSkillRunError && /not part of the trusted runtime catalog/.test(error.message),
  );
  assert.throws(
    () => assertSelectionsTrustedValidatorOwnership([selection("frontend.performance-review", "unregistered-domain/thing")]),
    (error: unknown) => error instanceof StrictSkillRunError && /not owned by a selected domain pack/.test(error.message),
  );
});

test("bundled registry validation stays fail-fast for unknown or misspelled validator ids", async () => {
  const contract = validatorContract("frontend.performance-review", "frontend/performance-claims");
  assert.doesNotThrow(() => assertBundledContractValidatorOwnership(contract));
  assert.doesNotThrow(() =>
    assertBundledContractValidatorOwnership({
      ...contract,
      gates: [{ ...contract.gates[1], evaluator: { type: "validator", validatorId: "frontend/browser-hard-gates" } }],
    }));

  const misspelled = { ...contract, gates: [{ ...contract.gates[1], evaluator: { type: "validator", validatorId: "frontend/perfrmance-claims" } }] };
  assert.throws(() => assertBundledContractValidatorOwnership(misspelled), /not registered by a bundled domain pack/);

  const unknownDomain = { ...contract, gates: [{ ...contract.gates[1], evaluator: { type: "validator", validatorId: "unregistered-domain/thing" } }] };
  assert.throws(() => assertBundledContractValidatorOwnership(unknownDomain), /not registered by a bundled domain pack/);

  const unknownCore = { ...contract, gates: [{ ...contract.gates[1], evaluator: { type: "validator", validatorId: "core/unknown-core" } }] };
  assert.throws(() => assertBundledContractValidatorOwnership(unknownCore), /not a registered core validator/);

  const malformed = { ...contract, gates: [{ ...contract.gates[1], evaluator: { type: "validator", validatorId: "no-slash" } }] };
  assert.throws(() => assertBundledContractValidatorOwnership(malformed), /syntactically valid/);
});

test("loadLocalRegistry rejects a bundled contract with a misspelled validator id without executing skill code", async () => {
  const registryRoot = path.join(await mkdtemp(path.join(os.tmpdir(), "validator-registry-temp-")), "registry");
  await cp("registry", registryRoot, { recursive: true });
  const contractPath = path.join(registryRoot, "skills", "frontend.performance-review", "execution.contract.json");
  const contract = JSON.parse(await readFile(contractPath, "utf8")) as { gates: Array<{ evaluator: { type: string; validatorId?: string } }> };
  contract.gates[0].evaluator = { type: "validator", validatorId: "frontend/perfrmance-claims" };
  await writeFile(contractPath, `${JSON.stringify(contract)}\n`);

  await assert.rejects(loadLocalRegistry(registryRoot), /not registered by a bundled domain pack/);
});

test("loadLocalRegistry accepts a syntactically valid validator id registered by a selected-capable domain pack", async () => {
  await withSyntheticPack("analytics", ["analytics/analytics-check"], async () => {
    const registryRoot = path.join(await mkdtemp(path.join(os.tmpdir(), "validator-registry-temp-ok-")), "registry");
    await cp("registry", registryRoot, { recursive: true });
    const contractPath = path.join(registryRoot, "skills", "frontend.performance-review", "execution.contract.json");
    const contract = JSON.parse(await readFile(contractPath, "utf8")) as { gates: Array<{ evaluator: { type: string; validatorId?: string } }> };
    contract.gates[0].evaluator = { type: "validator", validatorId: "analytics/analytics-check" };
    await writeFile(contractPath, `${JSON.stringify(contract)}\n`);

    const skills = await loadLocalRegistry(registryRoot);
    assert.ok(skills.some(({ manifest }) => manifest.id === "frontend.performance-review"));
  });
});

const installTempSkill = async (projectRoot: string, registryRoot: string, skillId: string) => {
  const skills = await loadLocalRegistry(registryRoot);
  const skill = skills.find((candidate) => candidate.manifest.id === skillId);
  assert.ok(skill);
  await getAdapter("codex").applyInstall(skill, {
    projectRoot,
    targetAgent: "codex",
    scope: "repo",
    dryRun: false,
    mode: "copy",
  });
};

const tamperPerformanceContract = async (registryRoot: string, validatorId: string) => {
  const contractPath = path.join(registryRoot, "skills", "frontend.performance-review", "execution.contract.json");
  const contract = JSON.parse(await readFile(contractPath, "utf8")) as { gates: Array<{ evaluator: { type: string; validatorId?: string } }> };
  contract.gates[0].evaluator = { type: "validator", validatorId };
  await writeFile(contractPath, `${JSON.stringify(contract)}\n`);
};

const strictRunFiles = async (root: string) => {
  const runtime = (await readdir(path.join(root, ".skillranger", "runs")).catch(() => []))
    .filter((entry) => entry.endsWith(".json"));
  const router = (await readdir(path.join(root, ".skillranger", "runs", "router")).catch(() => []))
    .filter((entry) => entry.endsWith(".json"));
  return { runtime, router };
};

test("legacy strict path reports strict-contract-missing for an unselected trusted domain without creating a run", async () => {
  await withSyntheticPack("analytics", ["analytics/analytics-check"], async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "validator-legacy-missing-domain-"));
    await cp("fixtures/vite-react-ts", root, { recursive: true });
    const registryRoot = path.join(await mkdtemp(path.join(os.tmpdir(), "validator-legacy-registry-")), "registry");
    await cp("registry", registryRoot, { recursive: true });
    await tamperPerformanceContract(registryRoot, "analytics/analytics-check");
    await installTempSkill(root, registryRoot, "frontend.performance-review");

    await assert.rejects(
      startPreparedStrictSkillRun({
        projectRoot: root,
        registryRoot,
        targetAgent: "codex",
        domain: "frontend",
        intent: "Review frontend performance",
        skillInputs: { "frontend.performance-review": { mode: "risk-review", affectedFlows: ["initial load"] } },
      }),
      (error: unknown) => error instanceof StrictSkillRunError
        && error.code === "strict-contract-missing"
        && error.details?.reason === "validator-ownership",
    );
    assert.deepEqual((await strictRunFiles(root)).runtime, []);
  });
});

test("legacy strict path still creates a run when the trusted validator domain is selected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "validator-legacy-selected-"));
  await cp("fixtures/vite-react-ts", root, { recursive: true });
  await installTempSkill(root, path.resolve("registry"), "frontend.performance-review");

  const run = await startPreparedStrictSkillRun({
    projectRoot: root,
    registryRoot: path.resolve("registry"),
    targetAgent: "codex",
    domain: "frontend",
    intent: "Review frontend performance",
    skillInputs: { "frontend.performance-review": { mode: "risk-review", affectedFlows: ["initial load"] } },
  });
  assert.ok(run.runId.startsWith("run_"));
  assert.equal((await strictRunFiles(root)).runtime.length, 1);
});

test("router path reports strict_requirements_unmet for an unselected trusted domain without creating a run", async () => {
  await withSyntheticPack("analytics", ["analytics/analytics-check"], async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "validator-router-missing-domain-"));
    await cp("fixtures/vite-react-ts", root, { recursive: true });
    const registryRoot = path.join(await mkdtemp(path.join(os.tmpdir(), "validator-router-registry-")), "registry");
    await cp("registry", registryRoot, { recursive: true });
    await tamperPerformanceContract(registryRoot, "analytics/analytics-check");
    await installTempSkill(root, registryRoot, "frontend.performance-review");

    const result = await prepareTask({
      projectRoot: root,
      registry: { kind: "bundled", root: registryRoot },
      prompt: "Review bundle size, loading speed, and runtime performance @skillranger",
      activation: { mode: "explicit" },
      targetAgent: "codex",
      strict: true,
      skillInputs: { "frontend.performance-review": { mode: "risk-review", affectedFlows: ["initial load"] } },
    });

    assert.equal(result.status, "strict_requirements_unmet");
    if (result.status === "strict_requirements_unmet") {
      assert.deepEqual(result.missing, [{ skillId: "frontend.performance-review", requirement: "strict-contract-v2" }]);
      assert.deepEqual(result.installationSuggestions, []);
    }
    assert.deepEqual(await strictRunFiles(root), { runtime: [], router: [] });
  });
});

test("store rebuilds a fresh trusted registry from persisted ledgers for verification and finalization", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "validator-store-fresh-"));
  const contract = validatorContract("frontend.registry-test", "core/artifact-integrity");
  const fixtureRun = () => createStrictSkillRun({
    runId: "run_validator_store", domain: "frontend", targetAgent: "codex", locale: "en",
    intent: { sha256: sha("store"), normalizedGoal: "store evidence" }, now: "2026-07-15T10:00:00.000Z",
    selectedSkills: [{
      skillId: contract.skillId, role: "primary", mandatory: true, version: "1.0.0",
      packageChecksum: sha("package"), contractChecksum: sha(JSON.stringify(contract)), contract,
      schemaSnapshots: { input: { type: "object" }, output: { type: "object" } },
      schemaChecksums: { input: sha(JSON.stringify({ type: "object" })), output: sha(JSON.stringify({ type: "object" })) },
      contentChunks: createContentChunks("SKILL.md", "# Store Test\n"), applicable: true, unmetPrerequisites: [],
    }],
  });
  const observed: Array<{ revision: number; outcome?: string }> = [];
  const store = new StrictSkillRunStore(root, (run) => {
    observed.push({ revision: run.revision, outcome: run.skillLedgers[0].outcome });
    return buildTrustedValidatorRegistry(run.skillLedgers);
  });

  const source = path.join(root, "report.json");
  await writeFile(source, "{}\n");
  let run = beginStrictStep(
    readNextStrictChunk(fixtureRun(), contract.skillId).run,
    contract.skillId,
    contract.steps[0].id,
  );
  await store.create(run);
  run = await store.ingestEvidence(run.runId, {
    sourcePath: source,
    kind: "report",
    attributions: [{ skillId: contract.skillId, stepId: contract.steps[0].id, attempt: 1, relation: "produced", ruleIds: contract.rules.map(({ id }) => id) }],
  });
  run = await store.update(run.runId, (current) => completeStrictStep(current, contract.skillId, contract.steps[0].id));
  assert.equal(observed.length, 0);

  run = await store.verifySkill(run.runId, contract.skillId);
  assert.equal(run.skillLedgers[0].outcome, "used");
  assert.equal(observed.length, 1);
  assert.equal(observed[0].revision, run.revision - 1);

  await store.finalizeRun(run.runId);
  assert.equal(observed.length, 2);
  assert.equal(observed[1].revision, observed[0].revision + 1);
  assert.equal(observed[1].outcome, "used");
});

test("the default store resolver rebuilds from persisted ledgers and never caches a prepare-time registry", () => {
  const contract = validatorContract("frontend.performance-review", "frontend/performance-claims");
  const registry = resolveTrustedValidatorRegistry({
    skillLedgers: [{ skillId: "frontend.performance-review", contract }],
  } as unknown as SkillRunV2);
  assert.equal(registry.has("frontend/performance-claims"), true);
  assert.equal(registry.has("frontend/browser-hard-gates"), true);

  assert.throws(
    () => resolveTrustedValidatorRegistry({
      skillLedgers: [{ skillId: "frontend.performance-review", contract: validatorContract("frontend.performance-review", "core/unknown-core") }],
    } as unknown as SkillRunV2),
    (error: unknown) => error instanceof StrictSkillRunError && /not part of the trusted runtime catalog/.test(error.message),
  );
});

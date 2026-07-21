import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initializeRouterContext } from "../src/mcp/router-context.ts";
import { callMcpTool } from "../src/mcp/tools.ts";
import { analyzeTask } from "../src/router/analyzer.ts";
import { buildRoutingContext } from "../src/router/context.ts";
import { loadRouterFixturePacks, type RouterFixturePack } from "../src/router/fixtures.ts";
import { canonicalSkillRoutingDocument } from "../src/router/metadata.ts";
import { prepareTask, RouterPrepareError } from "../src/router/prepare.ts";
import { combineDomainSemanticScore, resolveDomains } from "../src/router/resolver.ts";
import { validateSemanticHints } from "../src/router/semantic-hints.ts";
import { routerRecordDigest } from "../src/router/store.ts";
import { coreRoutingVocabulary } from "../src/router/vocabulary/core.ts";
import { adaptFixtureRoutingPacks } from "../src/router/vocabulary/load.ts";

const packsPath = path.resolve("tests/fixtures/router-packs");

const metadata = (packs: RouterFixturePack[]) => {
  const skills = packs.flatMap(({ skills: values }) => values.map((skill) => ({
    domains: skill.domains,
    roles: skill.roles,
    actions: skill.actions,
    artifactTypes: skill.artifactTypes,
    intentTags: skill.intentTags,
    technologyTags: skill.technologyTags,
    qualityGoals: skill.qualityGoals,
    environmentSignals: skill.environmentSignals,
  })));
  return {
    domains: packs.map(({ domain }) => domain),
    skills,
    routingContext: buildRoutingContext({
      packs: adaptFixtureRoutingPacks(packs),
      skills: packs.flatMap(({ skills: values }) => values.map(canonicalSkillRoutingDocument)),
      coreVocabulary: coreRoutingVocabulary,
      baseRegistryDigest: "semantic-hints-test",
    }),
  };
};

test("semantic hints are owner-scoped, bounded, deduplicated, and privacy-projected", async () => {
  const context = metadata(await loadRouterFixturePacks(packsPath)).routingContext;
  const hint = { kind: "intent", id: "authentication", evidenceText: "Blue Horizon", confidence: 1 } as const;
  const valid = validateSemanticHints({
    semanticHints: { schemaVersion: "semantic-hints/1.0", signals: [hint, hint] },
    prompt: "Please handle blue   horizon.",
    context,
  });

  assert.deepEqual(valid.issues, []);
  assert.equal(valid.signals.length, 1);
  assert.equal(valid.signals[0].source, "host-semantic");
  assert.equal(valid.signals[0].evidenceEligible, false);
  assert.equal(valid.signals[0].confidence, 0.75);
  assert.deepEqual(valid.signals[0].ownerIds, ["backend-api"]);
  assert.doesNotMatch(valid.digest, /blue|horizon/i);
  assert.equal(validateSemanticHints({ semanticHints: undefined, prompt: "anything", context }).digest, routerRecordDigest([]));
});

test("semantic hint validation reports structural, size, evidence, confidence, and owner errors", async () => {
  const context = metadata(await loadRouterFixturePacks(packsPath)).routingContext;
  const invalid = validateSemanticHints({
    semanticHints: {
      schemaVersion: "semantic-hints/1.0",
      selectedSkills: "forbidden",
      padding: "x".repeat(17_000),
      signals: [
        { kind: "intent", id: "missing-owner-id", evidenceText: "present", confidence: 0.4, score: 1 },
        { kind: "intent", id: "authentication", evidenceText: "absent", confidence: 1 },
        { kind: "intent", id: "authentication", evidenceText: "ü".repeat(129), confidence: 1 },
      ],
    },
    prompt: "present",
    context,
  });

  assert.ok(invalid.issues.some((issue) => issue.includes("exceeds 16384")));
  assert.ok(invalid.issues.some((issue) => issue.includes("selectedSkills") && issue.includes("unknown property")));
  assert.ok(invalid.issues.some((issue) => issue.includes("score") && issue.includes("unknown property")));
  assert.ok(invalid.issues.some((issue) => issue.includes("owner-scoped")));
  assert.ok(invalid.issues.some((issue) => issue.includes("between 0.5 and 1.0")));
  assert.ok(invalid.issues.some((issue) => issue.includes("not present")));
  assert.ok(invalid.issues.some((issue) => issue.includes("exceeds 256")));
  assert.deepEqual(invalid.signals, []);

  const tooMany = validateSemanticHints({
    semanticHints: { schemaVersion: "semantic-hints/1.0", signals: Array.from({ length: 33 }, () => ({ kind: "intent", id: "authentication", evidenceText: "present", confidence: 1 })) },
    prompt: "present",
    context,
  });
  assert.ok(tooMany.issues.some((issue) => issue.includes("exceeds 32")));
});

test("host scoring caps one kind, requires agreement, and zeroes conflicting lanes", () => {
  const base = {
    projectMatch: 0,
    directTaskIntentMatch: 0,
    hostTaskIntentMatch: 0.75,
    directArtifactMatch: 0,
    hostArtifactMatch: 0,
    directTechnologyMatch: 0,
    hostTechnologyMatch: 0,
    directProfileDomainConfidence: 0,
    hostProfileDomainConfidence: 0.75,
    matchingHostSignalKinds: ["domain"] as const,
    hasDirectDomainEvidence: false,
    hasFingerprintEvidence: false,
    hostSignalsAgree: true,
    hasDirectConflict: false,
  };
  assert.equal(combineDomainSemanticScore(base), 0.44);
  assert.equal(combineDomainSemanticScore({ ...base, matchingHostSignalKinds: ["domain", "intent"] }), 0.75);
  assert.equal(combineDomainSemanticScore({ ...base, matchingHostSignalKinds: ["domain", "intent"], hostSignalsAgree: false }), 0);
  assert.equal(combineDomainSemanticScore({ ...base, matchingHostSignalKinds: ["domain", "intent"], hasDirectConflict: true }), 0);
});

test("host signals keep direct provenance, cannot create subtasks, and emit conflicts", async () => {
  const input = metadata(await loadRouterFixturePacks(packsPath));
  const agreedHints = validateSemanticHints({
    semanticHints: { schemaVersion: "semantic-hints/1.0", signals: [
      { kind: "domain", id: "backend-api", evidenceText: "blue horizon", confidence: 1 },
      { kind: "artifact", id: "api", evidenceText: "blue horizon", confidence: 1 },
    ] },
    prompt: "blue horizon",
    context: input.routingContext,
  });
  const agreedAnalysis = analyzeTask({ prompt: "blue horizon", ...input, semanticSignals: agreedHints.signals });
  const agreedResolution = resolveDomains({ profile: agreedAnalysis.profile, ...input, routingIntentTags: agreedAnalysis.routingIntentTags, routingSignals: agreedAnalysis.matchedSignals });
  assert.equal(agreedResolution.primaryDomainId, "backend-api");

  const oneHintAnalysis = analyzeTask({ prompt: "blue horizon", ...input, semanticSignals: agreedHints.signals.slice(0, 1) });
  const oneHintResolution = resolveDomains({ profile: oneHintAnalysis.profile, ...input, routingIntentTags: oneHintAnalysis.routingIntentTags, routingSignals: oneHintAnalysis.matchedSignals });
  assert.equal(oneHintResolution.primaryDomainId, undefined);

  const duplicateHints = validateSemanticHints({
    semanticHints: { schemaVersion: "semantic-hints/1.0", signals: [{ kind: "intent", id: "authentication", evidenceText: "authentication", confidence: 1 }] },
    prompt: "authentication",
    context: input.routingContext,
  });
  const duplicateAnalysis = analyzeTask({ prompt: "authentication", ...input, semanticSignals: duplicateHints.signals });
  const requirement = duplicateAnalysis.requirements.find(({ kind, id }) => kind === "intent" && id === "authentication");
  assert.deepEqual(requirement?.sources, ["prompt-exact", "host-semantic"]);
  assert.equal(requirement?.requirementClass, "explicit");
  assert.equal(duplicateAnalysis.matchedSignals.filter(({ kind, id }) => kind === "intent" && id === "authentication").length, 2);

  const conflictHints = validateSemanticHints({
    semanticHints: { schemaVersion: "semantic-hints/1.0", signals: [
      { kind: "domain", id: "backend-api", evidenceText: "blue horizon", confidence: 1 },
      { kind: "intent", id: "authentication", evidenceText: "blue horizon", confidence: 1 },
    ] },
    prompt: "blue horizon and optimize a sql query",
    context: input.routingContext,
  });
  const analysis = analyzeTask({ prompt: "blue horizon and optimize a sql query", ...input, semanticSignals: conflictHints.signals });
  assert.deepEqual(analysis.profile.subtasks, []);
  const resolution = resolveDomains({ profile: analysis.profile, ...input, routingIntentTags: analysis.routingIntentTags, routingSignals: analysis.matchedSignals });
  assert.deepEqual(resolution.warnings, ["host-semantic-conflict:backend-api"]);
});

test("Core maps invalid hints and persisted runs contain no raw semantic evidence", async () => {
  const invalidRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-semantic-invalid-"));
  await assert.rejects(() => prepareTask({
    projectRoot: invalidRoot,
    registry: { kind: "test-fixture", root: packsPath },
    prompt: "Create an authentication API @skillranger",
    activation: { mode: "explicit" },
    semanticHints: { schemaVersion: "semantic-hints/1.0", signals: [{ kind: "intent", id: "authentication", evidenceText: "not in prompt", confidence: 1 }] },
  }), (error: unknown) => error instanceof RouterPrepareError && error.code === "semantic-hint-invalid");

  const root = await mkdtemp(path.join(os.tmpdir(), "skillranger-semantic-privacy-"));
  const canary = "PRIVATE_SEMANTIC_CANARY_913";
  const result = await prepareTask({
    projectRoot: root,
    registry: { kind: "test-fixture", root: packsPath },
    prompt: `Implement an authentication API for ${canary} @skillranger`,
    activation: { mode: "explicit" },
    capabilities: [{ id: "terminal", source: "host-reported" }],
    semanticHints: { schemaVersion: "semantic-hints/1.0", signals: [{ kind: "technology", id: "nestjs", evidenceText: canary, confidence: 1 }] },
  });
  assert.equal(result.status, "prepared");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(canary));
  if (result.status !== "prepared") return;
  const persisted = await readFile(path.join(root, ".skillranger", "runs", "router", `${result.run.routerRunId}.json`), "utf8");
  assert.doesNotMatch(persisted, new RegExp(canary));
});

test("MCP semantic payload errors preserve the Core error code", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillranger-semantic-mcp-"));
  process.env.SKILLRANGER_PROJECT_ROOT = root;
  initializeRouterContext();
  const result = await callMcpTool("prepare_task", {
    prompt: "Create an authentication API @skillranger",
    semanticHints: { schemaVersion: "semantic-hints/1.0", signals: [{ kind: "intent", id: "authentication", evidenceText: "absent evidence", confidence: 1 }] },
  });
  assert.equal(result.isError, true);
  assert.equal((result.structuredContent as { code: string }).code, "semantic-hint-invalid");
});

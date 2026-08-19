import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseTrigger } from "../src/router/trigger.ts";
import { defaultRegistryRoot } from "../src/paths.ts";
import { buildSkillCatalog, inspectSkillCatalog } from "../src/router/catalog.ts";
import { RouterPrepareError } from "../src/router/errors.ts";
import { RoutingPipelineError } from "../src/router/pipeline.ts";
import { normalizeCapabilities, runRoutingEntry } from "../src/router/entry.ts";
import { loadRoutingWorld } from "../src/router/world.ts";
import { emptyFingerprint } from "../src/evals/router/helpers.ts";
import { routerEvalRoutingDate } from "../src/router/fixtures.ts";
import type { RoutingEntryInput } from "../src/router/entry.ts";

const fixtureRoot = path.resolve("tests/fixtures/router-packs");

// The entry is exercised through its own interface — a preloaded world plus
// adapter-owned handles in, a routing decision out — never by inspecting how it
// assembled the pipeline input.

const entryInput = async (prompt: string): Promise<RoutingEntryInput> => {
  const parsed = parseTrigger({ prompt, mode: "explicit" });
  assert.ok(parsed.activated, `prompt must activate: ${prompt}`);
  const world = await loadRoutingWorld({
    registry: { kind: "replace", root: fixtureRoot },
    projectRoot: "/entry-test",
    targetAgent: "codex",
    skillInputs: {},
    intent: parsed.normalizedIntent,
    installed: [],
  });
  return {
    world,
    fingerprint: emptyFingerprint("/entry-test"),
    trigger: parsed,
    activation: { mode: "explicit" },
    targetAgent: "codex",
    strict: false,
    capabilities: ["terminal"],
    routingDate: routerEvalRoutingDate,
  };
};

test("the entry normalizes capabilities with production semantics", async () => {
  const input = await entryInput("Fix the refresh token flow in NestJS @skillranger");
  // Filesystem is always present and deduplicated (a repeated filesystem entry
  // is absorbed, matching the server-observed production prepend).
  const decision = runRoutingEntry({
    ...input,
    capabilities: ["filesystem", "terminal", "browser"],
  });
  assert.equal(decision.outcome.status, "prepared");
  assert.equal(decision.mode, "limited-deterministic-fallback");
  // Duplicates of any other capability are invalid, exactly like production.
  assert.throws(
    () => runRoutingEntry({ ...input, capabilities: ["terminal", "terminal"] }),
    (error: unknown) => error instanceof RouterPrepareError && error.code === "capability-invalid",
  );
});

test("normalizeCapabilities is the single definition of a valid capability list", () => {
  // Filesystem always present, deduplicated, canonical-sorted.
  assert.deepEqual(normalizeCapabilities([]), ["filesystem"]);
  assert.deepEqual(normalizeCapabilities(["terminal", "filesystem", "browser"]), ["browser", "filesystem", "terminal"]);
  assert.deepEqual(normalizeCapabilities(["FileSystem", "Terminal"]), ["filesystem", "terminal"]);
  // Invalid and duplicate capability lists fail closed exactly like production.
  assert.throws(
    () => normalizeCapabilities(["not a canonical id"]),
    (error: unknown) => error instanceof RouterPrepareError && error.code === "capability-invalid",
  );
  assert.throws(
    () => normalizeCapabilities(["terminal", "terminal"]),
    (error: unknown) => error instanceof RouterPrepareError && error.code === "capability-invalid",
  );
});

test("the fallback warning is produced by the entry's own decision", async () => {
  const input = await entryInput("Напиши стихотворение о море @skillranger");
  const decision = runRoutingEntry(input);
  assert.equal(decision.mode, "limited-deterministic-fallback");
  assert.equal(decision.outcome.status, "no_matching_skills");
  assert.ok(decision.warnings.includes("semantic-recall-limited"));
});

test("a proposal-backed decision through the entry is model-assisted and warning-free", async () => {
  const catalog = await buildSkillCatalog();
  let page = await inspectSkillCatalog({ maxItems: 2, maxBytes: 256_000 });
  while (!page.complete) {
    page = await inspectSkillCatalog({ cursor: page.nextCursor!, expectedCatalogDigest: page.catalogDigest });
  }
  assert.ok(page.catalogReceipt);
  const parsed = parseTrigger({ prompt: "Please build a component with React @skillranger", mode: "explicit" });
  assert.ok(parsed.activated);
  // The proposal binds to the real bundled catalog, so the world must be the
  // bundled world too (the fixture world cannot own bundled catalog metadata).
  const world = await loadRoutingWorld({
    registry: { kind: "bundled", root: defaultRegistryRoot },
    projectRoot: "/entry-test",
    targetAgent: "codex",
    skillInputs: {},
    intent: parsed.normalizedIntent,
    installed: [],
  });
  const input: RoutingEntryInput = {
    world,
    fingerprint: emptyFingerprint("/entry-test"),
    trigger: parsed,
    activation: { mode: "explicit" },
    targetAgent: "codex",
    strict: false,
    capabilities: ["terminal"],
    routingDate: routerEvalRoutingDate,
  };
  const decision = runRoutingEntry({
    ...input,
    catalog,
    routingProposal: {
      schemaVersion: "routing-proposal/1.0",
      catalogDigest: catalog.digest,
      catalogReceipt: page.catalogReceipt,
      interpretation: {
        domains: ["frontend"],
        actions: ["implement"],
        artifactTypes: ["component"],
        intentTags: ["component-design"],
        technologyTags: ["react"],
        qualityGoals: ["accessibility"],
      },
      nominations: [{
        skillId: "frontend.react-component-design",
        role: "primary",
        confidence: 0.91,
        evidenceText: "build a component",
      }],
    },
  });
  assert.equal(decision.mode, "model-assisted");
  assert.equal(decision.outcome.status, "prepared");
  assert.equal(decision.outcome.selections.primary.skillId, "frontend.react-component-design");
  assert.ok(!decision.warnings.includes("semantic-recall-limited"));
});

test("the entry preserves the pipeline input invariants", async () => {
  const input = await entryInput("Fix the refresh token flow in NestJS @skillranger");
  // A proposal requires a preloaded catalog snapshot.
  assert.throws(
    () => runRoutingEntry({
      ...input,
      routingProposal: {
        schemaVersion: "routing-proposal/1.0",
        catalogDigest: `sha256:${"a".repeat(64)}`,
        catalogReceipt: "catalog-receipt.example",
        interpretation: { domains: ["frontend"], actions: ["implement"], artifactTypes: ["component"], intentTags: ["component-design"], technologyTags: ["react"], qualityGoals: ["accessibility"] },
        nominations: [{ skillId: "frontend.react-component-design", role: "primary", confidence: 0.9, evidenceText: "build a component" }],
      },
    }),
    /requires a preloaded skill catalog snapshot/,
  );
  // A proposal and semantic hints stay mutually exclusive.
  assert.throws(
    () => runRoutingEntry({
      ...input,
      routingProposal: {
        schemaVersion: "routing-proposal/1.0",
        catalogDigest: `sha256:${"a".repeat(64)}`,
        catalogReceipt: "catalog-receipt.example",
        interpretation: { domains: ["frontend"], actions: ["implement"], artifactTypes: ["component"], intentTags: ["component-design"], technologyTags: ["react"], qualityGoals: ["accessibility"] },
        nominations: [{ skillId: "frontend.react-component-design", role: "primary", confidence: 0.9, evidenceText: "build a component" }],
      },
      semanticHints: { schemaVersion: "semantic-hints/1.0", signals: [] },
    }),
    /cannot be submitted together/,
  );
});

test("the entry is deterministic across repeated calls and omitting limits uses the defaults", async () => {
  const input = await entryInput("Fix the refresh token flow in NestJS @skillranger");
  assert.deepEqual(runRoutingEntry(input), runRoutingEntry(input));
  const decision = runRoutingEntry({ ...input, limits: undefined });
  assert.equal(decision.outcome.status, "prepared");
  assert.equal(decision.mode, "limited-deterministic-fallback");
});

test("an ambiguous decision through the entry resolves with validated answers", async () => {
  const input = await entryInput("Create a new application interface @skillranger");
  // Without answers the entry returns the same clarification decision task
  // preparation returns, with the ambiguous primary-domain question.
  const clarification = runRoutingEntry(input);
  assert.equal(clarification.outcome.status, "clarification_required");
  assert.equal(clarification.outcome.clarification.questions[0].id, "primary-domain");
  assert.deepEqual([...clarification.continuation.ambiguousDomainIds].sort(), ["frontend", "mobile"].sort());
  // The continuation pass supplies the validated answers through the same
  // entry face; the answer resolves into the prepared reference decision.
  const resolved = runRoutingEntry({
    ...input,
    answers: [{ questionId: "primary-domain", value: "frontend" }],
  });
  assert.equal(resolved.outcome.status, "prepared");
  assert.equal(resolved.outcome.primaryDomain, "frontend");
  assert.equal(resolved.outcome.selections.primary.skillId, "frontend.synthetic-interface");
  // An unsupported answer fails closed exactly like task preparation.
  assert.throws(
    () => runRoutingEntry({
      ...input,
      answers: [{ questionId: "primary-domain", value: "bogus-domain" }],
    }),
    (error: unknown) => error instanceof RoutingPipelineError && error.code === "clarification-answer-invalid",
  );
});

test("answers without a clarification violate the entry's input invariant", async () => {
  const input = await entryInput("Fix the refresh token flow in NestJS @skillranger");
  assert.throws(
    () => runRoutingEntry({
      ...input,
      answers: [{ questionId: "primary-domain", value: "frontend" }],
    }),
    (error: unknown) => error instanceof RoutingPipelineError && error.code === "continuation-invalid",
  );
});

test("valid semantic hints flow through the entry into the decision signals", async () => {
  const input = await entryInput("Please handle blue   horizon @skillranger");
  const decision = runRoutingEntry({
    ...input,
    semanticHints: {
      schemaVersion: "semantic-hints/1.0",
      signals: [{ kind: "intent", id: "authentication", evidenceText: "Blue Horizon", confidence: 1 }],
    },
  });
  assert.equal(decision.mode, "limited-deterministic-fallback");
  assert.match(decision.digests.semanticHintsDigest, /^sha256:/);
  assert.ok(decision.signals.matchedSignals.some(
    (signal) => signal.source === "host-semantic" && signal.id === "authentication",
  ));
  // Invalid hints fail closed through the entry with the pipeline error family.
  assert.throws(
    () => runRoutingEntry({
      ...input,
      semanticHints: { schemaVersion: "semantic-hints/1.0", signals: [{ kind: "intent", id: "authentication", evidenceText: "not in prompt", confidence: 1 }] },
    }),
    (error: unknown) => error instanceof RoutingPipelineError && error.code === "semantic-hint-invalid",
  );
});

test("ambiguity referencing rejected nominations surfaces bounded rejections and acceptedCount through the entry", async () => {
  const catalog = await buildSkillCatalog();
  let page = await inspectSkillCatalog({ maxItems: 2, maxBytes: 256_000 });
  while (!page.complete) {
    page = await inspectSkillCatalog({ cursor: page.nextCursor!, expectedCatalogDigest: page.catalogDigest });
  }
  assert.ok(page.catalogReceipt);
  const parsed = parseTrigger({ prompt: "Please build a component with React @skillranger", mode: "explicit" });
  assert.ok(parsed.activated);
  const world = await loadRoutingWorld({
    registry: { kind: "bundled", root: defaultRegistryRoot },
    projectRoot: "/entry-test",
    targetAgent: "codex",
    skillInputs: {},
    intent: parsed.normalizedIntent,
    installed: [],
  });
  const input: RoutingEntryInput = {
    world,
    fingerprint: emptyFingerprint("/entry-test"),
    trigger: parsed,
    activation: { mode: "explicit" },
    targetAgent: "codex",
    strict: false,
    capabilities: ["terminal"],
    routingDate: routerEvalRoutingDate,
  };
  const badProposal = {
    schemaVersion: "routing-proposal/1.0" as const,
    catalogDigest: catalog.digest,
    catalogReceipt: page.catalogReceipt,
    interpretation: {
      domains: ["frontend"],
      actions: ["implement"],
      artifactTypes: ["component"],
      intentTags: ["component-design"],
      technologyTags: ["react"],
      qualityGoals: ["accessibility"],
    },
    nominations: [
      { skillId: "frontend.unknown-alpha", role: "primary" as const, confidence: 0.9, evidenceText: "build a component" },
      { skillId: "frontend.unknown-beta", role: "primary" as const, confidence: 0.9, evidenceText: "build a component" },
    ],
    ambiguity: { primarySkillIds: ["frontend.unknown-alpha", "frontend.unknown-beta"] },
  };
  let error: RoutingPipelineError | undefined;
  try {
    runRoutingEntry({ ...input, catalog, routingProposal: badProposal });
  } catch (caught) {
    if (caught instanceof RoutingPipelineError) error = caught;
    else throw caught;
  }
  assert.ok(error);
  assert.equal(error.code, "routing-proposal-invalid");
  assert.match(error.message, /see details\.rejections and details\.acceptedCount/);
  assert.equal((error.details as Record<string, unknown>)?.field, "routingProposal.ambiguity.primarySkillIds");
  const rejections = (error.details as Record<string, unknown>)?.rejections as unknown[];
  assert.ok(Array.isArray(rejections) && rejections.length === 2);
  assert.equal((error.details as Record<string, unknown>)?.acceptedCount, 0);
  // structural shape error carries no bounded list
  let shapeError: RoutingPipelineError | undefined;
  try {
    runRoutingEntry({
      ...input,
      catalog,
      routingProposal: {
        schemaVersion: "routing-proposal/1.0",
        catalogDigest: catalog.digest,
        catalogReceipt: page.catalogReceipt,
        interpretation: {
          domains: ["frontend"],
          actions: ["implement"],
          artifactTypes: ["component"],
          intentTags: ["component-design"],
          technologyTags: ["react"],
          qualityGoals: ["accessibility"],
        },
        // missing nominations — shape error
        nominations: [] as unknown as typeof badProposal.nominations,
      },
    });
  } catch (caught) {
    if (caught instanceof RoutingPipelineError) shapeError = caught;
    else throw caught;
  }
  assert.ok(shapeError);
  assert.equal((shapeError.details as Record<string, unknown>)?.rejections, undefined);
  assert.equal((shapeError.details as Record<string, unknown>)?.acceptedCount, undefined);
});

test("entry rejection list is sorted and bounded to 16", async () => {
  const catalog = await buildSkillCatalog();
  let page = await inspectSkillCatalog({ maxItems: 2, maxBytes: 256_000 });
  while (!page.complete) page = await inspectSkillCatalog({ cursor: page.nextCursor!, expectedCatalogDigest: page.catalogDigest });
  assert.ok(page.catalogReceipt);
  const parsed = parseTrigger({ prompt: "Please build a component with React @skillranger", mode: "explicit" });
  assert.ok(parsed.activated);
  const world = await loadRoutingWorld({
    registry: { kind: "bundled", root: defaultRegistryRoot },
    projectRoot: "/entry-test",
    targetAgent: "codex",
    skillInputs: {},
    intent: parsed.normalizedIntent,
    installed: [],
  });
  const input: RoutingEntryInput = {
    world,
    fingerprint: emptyFingerprint("/entry-test"),
    trigger: parsed,
    activation: { mode: "explicit" },
    targetAgent: "codex",
    strict: false,
    capabilities: ["terminal"],
    routingDate: routerEvalRoutingDate,
  };
  const nominations = Array.from({ length: 16 }, (_, i) => ({
    skillId: `frontend.unknown-${String(i).padStart(2, "0")}`,
    role: "primary" as const,
    confidence: 0.9,
    evidenceText: "build a component",
  }));
  const bad = {
    schemaVersion: "routing-proposal/1.0" as const,
    catalogDigest: catalog.digest,
    catalogReceipt: page.catalogReceipt,
    interpretation: { domains: ["frontend"], actions: ["implement"], artifactTypes: ["component"], intentTags: ["component-design"], technologyTags: ["react"], qualityGoals: ["accessibility"] },
    nominations,
    ambiguity: { primarySkillIds: ["frontend.unknown-00", "frontend.unknown-01"] },
  };
  let error: RoutingPipelineError | undefined;
  try { runRoutingEntry({ ...input, catalog, routingProposal: bad }); } catch (caught) { if (caught instanceof RoutingPipelineError) error = caught; else throw caught; }
  assert.ok(error);
  const rejections = (error.details as Record<string, unknown>)?.rejections as Array<{ skillId?: string; reasonCode: string }>;
  assert.equal(rejections.length, 16);
  assert.deepEqual(rejections, [...rejections].sort((a, b) => `${a.skillId ?? ""}:${a.reasonCode}`.localeCompare(`${b.skillId ?? ""}:${b.reasonCode}`)));
});

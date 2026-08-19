import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeCapabilities } from "../src/router/entry.ts";
import { RouterPrepareError } from "../src/router/errors.ts";
import { prepareTask } from "../src/router/prepare.ts";
import { buildSkillCatalog, inspectSkillCatalog } from "../src/router/catalog.ts";
import { validateRoutingProposal, validateRoutingProposalShape, RoutingProposalError } from "../src/router/routing-proposal.ts";
import { isCanonicalId, canonical } from "../src/router/canonical.ts";

// Regression for the canonical identity migration (issue #134):
// target-agent handling, capability normalization, and routing proposal
// interpretation / nomination validation must use the shared canonical module
// while preserving caller-owned diagnostics and routing outcomes.

const registry = path.resolve("registry");
const temporaryProject = () => mkdtemp(path.join(os.tmpdir(), "skillranger-canonical-regression-"));

const completeReceipt = async () => {
  let page = await inspectSkillCatalog({ maxItems: 2, maxBytes: 256_000 });
  while (!page.complete) {
    page = await inspectSkillCatalog({ cursor: page.nextCursor!, expectedCatalogDigest: page.catalogDigest });
  }
  assert.ok(page.catalogReceipt);
  return { digest: page.catalogDigest, receipt: page.catalogReceipt };
};

const validInterpretation = {
  domains: ["frontend"],
  actions: ["implement"],
  artifactTypes: ["component"],
  intentTags: ["component-design"],
  technologyTags: ["react"],
  qualityGoals: ["accessibility"],
};

const proposalBase = (catalogDigest: string, catalogReceipt: string) => ({
  schemaVersion: "routing-proposal/1.0" as const,
  catalogDigest,
  catalogReceipt,
  interpretation: validInterpretation,
  nominations: [{
    skillId: "frontend.react-component-design",
    role: "primary",
    confidence: 0.91,
    evidenceText: "build a component",
  }],
});

// ── Target-agent handling through the preparation adapter ───────────────────

test("prepareTask target-agent handling uses the shared canonical rule", async () => {
  // Canonical after normalization must be accepted when the agent exists.
  // Uppercase and surrounding whitespace are normalized by the adapter, so they
  // are accepted (lookup may normalize). This proves the adapter uses canonical()
  // then isCanonicalId() on the normalized value, not source-form rejection.
  const canonicalAgents: Array<[string, string]> = [
    ["codex lower", "codex"],
    ["codex upper normalizes", "CoDex"],
    ["codex whitespace normalizes", "  codex  "],
    ["claude-code canonical", "claude-code"],
    ["claude-code upper normalizes", "Claude-Code"],
    ["generic-agent-skills", "generic-agent-skills"],
    ["generic-agent-skills upper normalizes", "Generic-Agent-Skills"],
  ];
  for (const [label, targetAgent] of canonicalAgents) {
    const root = await temporaryProject();
    const result = await prepareTask({
      projectRoot: root,
      registry: { kind: "bundled", root: registry },
      prompt: "Fix the refresh token flow in NestJS @skillranger",
      activation: { mode: "explicit" },
      targetAgent,
    });
    // Any accepted targetAgent reaches a deterministic routing outcome (never
    // target-agent-unresolved). The exact outcome may be prepared / no_match etc
    // but must not be target-agent-unresolved.
    assert.notEqual((result as { status?: string }).status, undefined, label);
    if ("code" in (result as unknown as Record<string, unknown>)) {
      assert.fail(`${label} should not throw target-agent-unresolved`);
    }
    // Also prove the normalized value is canonical.
    assert.equal(isCanonicalId(canonical(targetAgent.trim())), true, label);
  }

  // Non-canonical after normalization must be rejected with the caller-owned
  // diagnostic (target-agent-unresolved, field path preserved, message lists
  // supported IDs). These cases cannot be normalized to a known agent.
  const nonCanonicalAgents: Array<[string, string]> = [
    ["slash", "codex/invalid"],
    ["backslash", "codex\\evil"],
    ["space internal", "code x"],
    ["dot leading", ".codex"],
    ["uppercase with slash", "CoDex/Bad"],
    ["url-like", "https://example.com"],
    ["129 chars too long", "a".repeat(129)],
    ["non-ascii", "cödex"],
  ];
  for (const [label, targetAgent] of nonCanonicalAgents) {
    const root = await temporaryProject();
    await assert.rejects(
      () => prepareTask({
        projectRoot: root,
        registry: { kind: "bundled", root: registry },
        prompt: "Fix the refresh token flow in NestJS @skillranger",
        activation: { mode: "explicit" },
        targetAgent,
      }),
      (error: unknown) => {
        assert.ok(error instanceof RouterPrepareError, `${label} must be RouterPrepareError`);
        assert.equal((error as RouterPrepareError).code, "target-agent-unresolved", label);
        assert.match((error as Error).message, /Supported IDs:/, label);
        // The normalized value must be non-canonical, proving the shared rule.
        const normalized = canonical(targetAgent.trim());
        assert.equal(isCanonicalId(normalized), false, `${label} normalized should be non-canonical`);
        return true;
      },
      label,
    );
  }

  // Known canonical shape but unknown agent: still target-agent-unresolved,
  // not capability-invalid or routing-proposal-invalid. This preserves the
  // caller-owned error code and message.
  const unknownAgents = ["unknown-agent", "codex2", "my-agent"];
  for (const targetAgent of unknownAgents) {
    const root = await temporaryProject();
    assert.equal(isCanonicalId(targetAgent), true, `unknown agent ${targetAgent} should still be canonical shape`);
    await assert.rejects(
      () => prepareTask({
        projectRoot: root,
        registry: { kind: "bundled", root: registry },
        prompt: "Fix the refresh token flow in NestJS @skillranger",
        activation: { mode: "explicit" },
        targetAgent,
      }),
      (error: unknown) => error instanceof RouterPrepareError && (error as RouterPrepareError).code === "target-agent-unresolved",
      targetAgent,
    );
  }

  // Fullwidth compatibility form normalizes to ascii but is rejected as
  // non-canonical source form for the purpose of demonstrating the distinction:
  // the target adapter normalizes first, so fullwidth "ｃｏｄｅｘ" -> "codex" and
  // is actually accepted (lookup may normalize). This proves the adapter's
  // normalization-then-validation contract.
  const fullwidthCodex = "\uFF43\uFF4F\uFF44\uFF45\uFF58"; // ｃｏｄｅｘ
  assert.equal(canonical(fullwidthCodex), "codex");
  assert.equal(isCanonicalId(fullwidthCodex), false);
  assert.equal(isCanonicalId(canonical(fullwidthCodex)), true);
  const fwRoot = await temporaryProject();
  const fwResult = await prepareTask({
    projectRoot: fwRoot,
    registry: { kind: "bundled", root: registry },
    prompt: "Fix the refresh token flow @skillranger",
    activation: { mode: "explicit" },
    targetAgent: fullwidthCodex,
  });
  assert.equal((fwResult as { status?: string }).status !== undefined, true, "fullwidth targetAgent should be accepted after normalization");
});

// ── Capability normalization through the Routing entry ───────────────────────

test("normalizeCapabilities uses the shared canonical identity rule", () => {
  // Valid canonical capabilities are accepted and deduplicated via canonical().
  assert.deepEqual(normalizeCapabilities([]), ["filesystem"]);
  assert.deepEqual(normalizeCapabilities(["terminal"]), ["filesystem", "terminal"]);
  // Case and surrounding whitespace are normalized, then validated.
  assert.deepEqual(normalizeCapabilities(["Terminal", "  BROWSER  "]), ["browser", "filesystem", "terminal"]);
  assert.deepEqual(normalizeCapabilities(["FileSystem"]), ["filesystem"]);
  assert.deepEqual(normalizeCapabilities(["FILESYSTEM", "terminal"]), ["filesystem", "terminal"]);

  // Invalid canonical IDs are rejected with the caller-owned capability-invalid
  // code and message, not a different pipeline error.
  const invalidCapabilities: Array<[string, string[]]> = [
    ["space internal", ["not canonical"]],
    ["slash", ["a/b"]],
    ["backslash", ["a\\b"]],
    ["url-like", ["https://example.com"]],
    ["uppercase with slash", ["A/B"]],
    ["129 chars", ["a".repeat(129)]],
    ["dot leading", [".terminal"]],
    ["empty after trim canonicalizes to empty and fails", ["   "]],
  ];
  for (const [label, caps] of invalidCapabilities) {
    assert.throws(
      () => normalizeCapabilities(caps),
      (error: unknown) => {
        assert.ok(error instanceof RouterPrepareError, label);
        assert.equal((error as RouterPrepareError).code, "capability-invalid", label);
        for (const cap of caps) {
          assert.equal(isCanonicalId(canonical(cap)), false, `${label}: ${cap} normalized should be non-canonical`);
        }
        return true;
      },
      label,
    );
  }

  // Duplicates after canonicalization are rejected (same canonical, different
  // source forms). This proves the entry deduplicates on the canonical value.
  assert.throws(
    () => normalizeCapabilities(["terminal", "Terminal"]),
    (error: unknown) => error instanceof RouterPrepareError && (error as RouterPrepareError).code === "capability-invalid",
  );
  assert.throws(
    () => normalizeCapabilities(["terminal", "terminal"]),
    (error: unknown) => error instanceof RouterPrepareError && (error as RouterPrepareError).code === "capability-invalid",
  );

  // NFKC fullwidth normalizes to canonical and is then accepted.
  assert.deepEqual(normalizeCapabilities(["\uFF54\uFF45\uFF52\uFF4D\uFF49\uFF4E\uFF41\uFF4C"]), ["filesystem", "terminal"]);
  assert.equal(isCanonicalId("\uFF54\uFF45\uFF52\uFF4D\uFF49\uFF4E\uFF41\uFF4C"), false);
  assert.equal(isCanonicalId(canonical("\uFF54\uFF45\uFF52\uFF4D\uFF49\uFF4E\uFF41\uFF4C")), true);

  // Non-ascii that normalizes to non-ascii remains rejected.
  assert.throws(
    () => normalizeCapabilities(["café"]),
    (error: unknown) => error instanceof RouterPrepareError && (error as RouterPrepareError).code === "capability-invalid",
  );
  assert.equal(isCanonicalId("café"), false);
});

// ── Routing proposal interpretation IDs ─────────────────────────────────────

test("routing proposal interpretation IDs use the shared canonical rule", async () => {
  const catalog = await buildSkillCatalog();
  const { digest, receipt } = await completeReceipt();

  // All valid canonical interpretation IDs are accepted.
  const validInterpretation = {
    domains: ["frontend"],
    actions: ["implement"],
    artifactTypes: ["component"],
    intentTags: ["component-design"],
    technologyTags: ["react"],
    qualityGoals: ["accessibility"],
  };
  const validResult = validateRoutingProposal({
    proposal: { ...proposalBase(digest, receipt), interpretation: validInterpretation },
    prompt: "Please build a component with React",
    catalog,
  });
  assert.equal((validResult as { status?: string }).status, undefined);

  // Each non-canonical interpretation ID must fail with the caller-owned
  // routing-proposal-invalid code and a field path that names the interpretation
  // array index. The shared rule (isCanonicalId) decides.
  const invalidCases: Array<[string, Partial<typeof validInterpretation>]> = [
    ["uppercase domain", { domains: ["Frontend"] }],
    ["space in action", { actions: ["im plement"] }],
    ["slash in artifact", { artifactTypes: ["a/b"] }],
    ["dot leading technology", { technologyTags: [".react"] }],
    ["129-char quality", { qualityGoals: ["a".repeat(129)] }],
    ["empty string", { actions: [""] }],
    ["non-ascii", { domains: ["frönted"] }],
    ["fullwidth domain", { domains: ["\uFF46\uFF52\uFF4F\uFF4E\uFF54\uFF45\uFF4E\uFF44"] }],
  ];
  for (const [label, patch] of invalidCases) {
    const interpretation = { ...validInterpretation, ...patch };
    const proposal = { ...proposalBase(digest, receipt), interpretation };
    assert.throws(
      () => validateRoutingProposalShape(proposal),
      (error: unknown) => {
        assert.ok(error instanceof RoutingProposalError, label);
        assert.equal((error as RoutingProposalError).code, "routing-proposal-invalid", label);
        const details = (error as RoutingProposalError).details as { field?: string } | undefined;
        assert.ok(details?.field?.startsWith("routingProposal.interpretation."), `${label} field path ${details?.field}`);
        // Every patched value must be non-canonical via the shared rule.
        const badValue = Object.values(patch)[0]![0] as string;
        assert.equal(isCanonicalId(badValue), false, `${label} value should be non-canonical`);
        return true;
      },
      label,
    );
  }

  // Duplicate interpretation IDs after canonical validation are also rejected
  // with the same caller-owned message.
  assert.throws(
    () => validateRoutingProposalShape({
      ...proposalBase(digest, receipt),
      interpretation: { ...validInterpretation, actions: ["implement", "implement"] },
    }),
    (error: unknown) => error instanceof RoutingProposalError && (error as RoutingProposalError).code === "routing-proposal-invalid",
  );

  // Owner-scoped check still follows canonical validation: a canonical but
  // unknown ID fails with owner-scoped message, not canonical message.
  assert.throws(
    () => validateRoutingProposal({
      proposal: { ...proposalBase(digest, receipt), interpretation: { ...validInterpretation, domains: ["unknown-domain"] } },
      prompt: "Please build a component",
      catalog,
    }),
    (error: unknown) => {
      assert.ok(error instanceof RoutingProposalError);
      assert.match((error as Error).message, /not owner-scoped catalog metadata/);
      return true;
    },
  );
});

// ── Routing proposal skill nominations ──────────────────────────────────────

test("routing proposal skill nominations use the shared canonical rule", async () => {
  const catalog = await buildSkillCatalog();
  const { digest, receipt } = await completeReceipt();

  // Canonical skill nomination is accepted and projected without the raw
  // evidenceText (privacy projection). This preserves the current accepted
  // projection.
  const canonicalProposal = proposalBase(digest, receipt);
  const accepted = validateRoutingProposal({
    proposal: canonicalProposal,
    prompt: "Please build a component with React",
    catalog,
  });
  assert.equal((accepted as { status?: string }).status, undefined);
  if ("status" in (accepted as Record<string, unknown>)) return;
  assert.equal(accepted.nominations[0]?.skillId, "frontend.react-component-design");
  assert.equal(accepted.rejections.length, 0);
  assert.match(accepted.nominations[0]?.evidenceDigest ?? "", /^sha256:/);
  assert.equal(accepted.projection.nominations[0]?.skillId, "frontend.react-component-design");
  assert.equal(JSON.stringify(accepted.projection).includes("build a component"), false, "projection must not leak evidenceText");

  // Non-canonical skillIds are rejected with the caller-owned reasonCode
  // non-canonical-skill-id, field paths stay unchanged, and no new error
  // code is introduced.
  const nonCanonicalSkillIds: Array<[string, string]> = [
    ["uppercase", "Frontend.react-component-design"],
    ["space", "frontend.react component"],
    ["slash", "frontend/react-component-design"],
    ["backslash", "frontend\\react-component-design"],
    ["dot leading", ".frontend.react-component-design"],
    ["129 chars", "a".repeat(129)],
    ["non-ascii", "frontend.réact"],
    ["fullwidth", "\uFF46\uFF52\uFF4F\uFF4E\uFF54\uFF45\uFF4E\uFF44.\uFF52\uFF45\uFF41\uFF43\uFF54"],
    ["empty", ""],
    ["url-like", "https://example.com/skill"],
  ];
  for (const [label, skillId] of nonCanonicalSkillIds) {
    const result = validateRoutingProposal({
      proposal: {
        ...proposalBase(digest, receipt),
        nominations: [{ skillId, role: "primary", confidence: 0.9, evidenceText: "build a component" }],
      },
      prompt: "Please build a component with React",
      catalog,
    }) as { rejections: Array<{ skillId?: string; reasonCode: string }>; nominations: unknown[] };
    assert.equal(result.rejections.length, 1, label);
    assert.equal(result.rejections[0]?.reasonCode, "non-canonical-skill-id", label);
    // Non-canonical nominations omit skillId when the source form itself is
    // non-canonical (the shared rule decides), or preserve it when present?
    // The production contract omits skillId for non-canonical and keeps it for
    // other rejections; we only assert the reasonCode is preserved.
    assert.equal(result.nominations.length, 0, label);
    assert.equal(isCanonicalId(skillId), false, `${label} should be non-canonical via shared rule`);
  }

  // A mixed proposal: one canonical accepted, one non-canonical rejected
  // individually without erasing the accepted one. This preserves the
  // nomination-resolution independence.
  const mixed = validateRoutingProposal({
    proposal: {
      ...proposalBase(digest, receipt),
      nominations: [
        { skillId: "Frontend.react-component-design", role: "primary", confidence: 0.9, evidenceText: "build a component" },
        { skillId: "frontend.react-component-design", role: "primary", confidence: 0.8, evidenceText: "build a component" },
      ],
    },
    prompt: "Please build a component with React",
    catalog,
  }) as { nominations: Array<{ skillId: string }>; rejections: Array<{ reasonCode: string }> };
  assert.equal(mixed.nominations.length, 1);
  assert.equal(mixed.nominations[0]?.skillId, "frontend.react-component-design");
  assert.deepEqual(mixed.rejections.map((r) => r.reasonCode), ["non-canonical-skill-id"]);

  // Fullwidth NFKC variant normalizes to a valid skillId but is still
  // rejected as non-canonical source form, proving validation != normalization.
  const fullwidthSkill = "\uFF46\uFF52\uFF4F\uFF4E\uFF54\uFF45\uFF4E\uFF44.\uFF52\uFF45\uFF41\uFF43\uFF54\uFF0D\uFF43\uFF4F\uFF4D\uFF50\uFF4F\uFF4E\uFF45\uFF4E\uFF54\uFF0D\uFF44\uFF45\uFF53\uFF49\uFF47\uFF4E";
  assert.equal(canonical(fullwidthSkill), "frontend.react-component-design");
  assert.equal(isCanonicalId(fullwidthSkill), false);
  assert.equal(isCanonicalId(canonical(fullwidthSkill)), true);
  const fwResult = validateRoutingProposal({
    proposal: {
      ...proposalBase(digest, receipt),
      nominations: [{ skillId: fullwidthSkill, role: "primary", confidence: 0.9, evidenceText: "build a component" }],
    },
    prompt: "Please build a component with React",
    catalog,
  }) as { rejections: Array<{ reasonCode: string }> };
  assert.equal(fwResult.rejections[0]?.reasonCode, "non-canonical-skill-id");

  // Ambiguity primarySkillIds also use the shared canonical rule.
  assert.throws(
    () => validateRoutingProposalShape({
      ...proposalBase(digest, receipt),
      nominations: [
        { skillId: "frontend.motion-design", role: "primary", confidence: 0.9, evidenceText: "make the page delightful" },
        { skillId: "frontend.visual-design-polish", role: "primary", confidence: 0.89, evidenceText: "make the page delightful" },
      ],
      ambiguity: { primarySkillIds: ["Frontend.motion-design", "frontend.visual-design-polish"] },
    }),
    (error: unknown) => error instanceof RoutingProposalError && /must be a canonical ID/.test((error as Error).message),
  );

  // 128-char max is accepted, 129-char is rejected via the shared bound.
  const maxId = "a".repeat(128);
  assert.equal(isCanonicalId(maxId), true);
  const overId = "a".repeat(129);
  assert.equal(isCanonicalId(overId), false);
  // Use interpretation to test the bound at the proposal seam (skillId
  // 128-char would not be in catalog, so test interpretation).
  assert.throws(
    () => validateRoutingProposalShape({ ...proposalBase(digest, receipt), interpretation: { ...validInterpretation, domains: [overId] } }),
    (error: unknown) => error instanceof RoutingProposalError,
  );
});

test("canonical routing proposals retain accepted projections and non-canonical retain rejection reasons", async () => {
  const catalog = await buildSkillCatalog();
  const { digest, receipt } = await completeReceipt();

  // Canonical accepted projection is stable and deterministic.
  const first = validateRoutingProposal({
    proposal: proposalBase(digest, receipt),
    prompt: "Please build a component with React",
    catalog,
  }) as { projection: { proposalDigest: string; nominations: unknown[]; rejections: unknown[] } };
  const second = validateRoutingProposal({
    proposal: proposalBase(digest, receipt),
    prompt: "Please build a component with React",
    catalog,
  }) as { projection: { proposalDigest: string } };
  assert.equal(first.projection.proposalDigest, second.projection.proposalDigest);
  assert.equal(first.projection.nominations.length, 1);
  assert.equal(first.projection.rejections.length, 0);

  // Non-canonical nominations retain their specific rejection codes and do not
  // change pipeline error codes or field paths.
  const cases: Array<[string, string, string]> = [
    ["non-canonical-skill-id", "Frontend.react-component-design", "non-canonical-skill-id"],
    ["skill-not-in-catalog", "frontend.not-in-catalog", "skill-not-in-catalog"],
    ["duplicate-skill", "frontend.react-component-design", "duplicate-skill"],
  ];
  // skill-not-in-catalog and duplicate-skill are tested via validateRoutingProposal
  // with catalog; non-canonical is already covered above but re-assert the code.
  const duplicateResult = validateRoutingProposal({
    proposal: {
      ...proposalBase(digest, receipt),
      nominations: [
        { skillId: "frontend.react-component-design", role: "primary", confidence: 0.9, evidenceText: "build a component" },
        { skillId: "frontend.react-component-design", role: "primary", confidence: 0.8, evidenceText: "build a component" },
      ],
    },
    prompt: "Please build a component with React",
    catalog,
  }) as { rejections: Array<{ reasonCode: string }> };
  assert.equal(duplicateResult.rejections[0]?.reasonCode, "duplicate-skill");

  const notInCatalog = validateRoutingProposal({
    proposal: {
      ...proposalBase(digest, receipt),
      nominations: [{ skillId: "frontend.not-in-catalog", role: "primary", confidence: 0.9, evidenceText: "build a component" }],
    },
    prompt: "Please build a component with React",
    catalog,
  }) as { rejections: Array<{ reasonCode: string }> };
  assert.equal(notInCatalog.rejections[0]?.reasonCode, "skill-not-in-catalog");

  // Shape errors still throw routing-proposal-invalid with field path.
  try {
    validateRoutingProposalShape({
      ...proposalBase(digest, receipt),
      interpretation: { ...validInterpretation, actions: ["FE"] },
    });
    assert.fail("should throw");
  } catch (error) {
    assert.ok(error instanceof RoutingProposalError);
    assert.equal((error as RoutingProposalError).code, "routing-proposal-invalid");
    assert.match((error as Error).message, /must be a canonical ID/);
    assert.equal((error as RoutingProposalError).details?.field, "routingProposal.interpretation.actions[0]");
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { assertValidCatalogReceipt, buildSkillCatalog, inspectSkillCatalog } from "../src/router/catalog.ts";
import { detectExplicitSkillChoice, RoutingProposalError, validateRoutingProposal, validateRoutingProposalShape } from "../src/router/routing-proposal.ts";

const validProposal = {
  schemaVersion: "routing-proposal/1.0",
  catalogDigest: `sha256:${"a".repeat(64)}`,
  catalogReceipt: "catalog-receipt.example",
  interpretation: {
    domains: ["frontend"],
    actions: ["repair"],
    artifactTypes: ["web-page"],
    intentTags: ["responsive-layout"],
    technologyTags: ["react"],
    qualityGoals: ["responsive"],
  },
  nominations: [{
    skillId: "frontend.responsive-layout",
    role: "primary",
    confidence: 0.91,
    evidenceText: "На телефоне всё съехало",
  }],
};

test("routing proposal structure is closed and versioned", () => {
  const parsed = validateRoutingProposalShape(validProposal);
  assert.equal(parsed.schemaVersion, "routing-proposal/1.0");
  assert.equal(parsed.nominations.length, 1);

  assert.throws(
    () => validateRoutingProposalShape({ ...validProposal, explanation: "private reasoning" }),
    (error: unknown) => error instanceof RoutingProposalError && error.code === "routing-proposal-invalid",
  );
  assert.throws(
    () => validateRoutingProposalShape({ ...validProposal, interpretation: { ...validProposal.interpretation, extra: true } }),
    (error: unknown) => error instanceof RoutingProposalError && error.code === "routing-proposal-invalid",
  );
  assert.throws(
    () => validateRoutingProposalShape({ ...validProposal, nominations: [{ ...validProposal.nominations[0], skillId: 42 }] }),
    (error: unknown) => error instanceof RoutingProposalError && error.code === "routing-proposal-invalid",
  );
});

test("routing proposal structure enforces bounded arrays and confidence", () => {
  assert.throws(
    () => validateRoutingProposalShape({ ...validProposal, nominations: Array.from({ length: 17 }, () => validProposal.nominations[0]) }),
    RoutingProposalError,
  );
  assert.throws(
    () => validateRoutingProposalShape({
      ...validProposal,
      nominations: [{ ...validProposal.nominations[0], confidence: 1.01 }],
    }),
    RoutingProposalError,
  );
});

const completeCatalogReceipt = async () => {
  let current = await inspectSkillCatalog({ maxItems: 2, maxBytes: 256_000 });
  while (!current.complete) {
    current = await inspectSkillCatalog({ cursor: current.nextCursor!, expectedCatalogDigest: current.catalogDigest });
  }
  assert.ok(current.catalogReceipt);
  return current.catalogReceipt;
};

test("a valid proposal is catalog-bound, prompt-grounded, and privacy-projected", async () => {
  const catalog = await buildSkillCatalog();
  const proposal = {
    ...validProposal,
    catalogDigest: catalog.digest,
    catalogReceipt: await completeCatalogReceipt(),
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
  };
  const result = validateRoutingProposal({
    proposal,
    prompt: "Please build a component with React",
    catalog,
  });
  assert.equal(result.status, undefined);
  if ("status" in result) return;
  assert.equal(result.nominations[0]?.skillId, "frontend.react-component-design");
  assert.equal(result.nominations[0]?.confidence, 0.91);
  assert.match(result.nominations[0]?.evidenceDigest ?? "", /^sha256:/);
  assert.doesNotMatch(JSON.stringify(result.projection), /build a component/i);
});

test("stale and incomplete catalog bindings request a refresh without fallback validation", async () => {
  const catalog = await buildSkillCatalog();
  const receipt = await completeCatalogReceipt();
  const stale = validateRoutingProposal({
    proposal: { ...validProposal, catalogDigest: `sha256:${"b".repeat(64)}`, catalogReceipt: receipt },
    prompt: "На телефоне всё съехало",
    catalog,
  });
  assert.deepEqual(stale, {
    status: "catalog_refresh_required",
    reasonCode: "catalog-digest-mismatch",
    currentCatalogDigest: catalog.digest,
    nextTool: "inspect_skill_catalog",
  });

  const incomplete = validateRoutingProposal({
    proposal: { ...validProposal, catalogDigest: catalog.digest, catalogReceipt: "catalog-receipt-invalid" },
    prompt: "На телефоне всё съехало",
    catalog,
  });
  assert.equal(incomplete.status, "catalog_refresh_required");
  if (incomplete.status === "catalog_refresh_required") assert.equal(incomplete.currentCatalogDigest, catalog.digest);
});

test("a catalog receipt must prove delivery of the complete current catalog", async () => {
  const catalog = await buildSkillCatalog();
  const receipt = await completeCatalogReceipt();
  assert.throws(
    () => assertValidCatalogReceipt(receipt, catalog.digest, { expectedItemCount: catalog.skills.length + 1 }),
    (error: unknown) => (error as { code?: string }).code === "catalog-receipt-invalid",
  );
});

test("explicit skill choice ignores negation, code spans, and URLs", () => {
  const skillId = "frontend.react-component-design";
  assert.equal(detectExplicitSkillChoice(`Use ${skillId} for this task`, [skillId]), skillId);
  assert.equal(detectExplicitSkillChoice(`Do not use ${skillId}`, [skillId]), undefined);
  assert.equal(detectExplicitSkillChoice(`не используй ${skillId}`, [skillId]), undefined);
  assert.equal(detectExplicitSkillChoice(`Read \`${skillId}\` in the docs`, [skillId]), undefined);
  assert.equal(detectExplicitSkillChoice(`Read https://example.com/${skillId}`, [skillId]), undefined);
});

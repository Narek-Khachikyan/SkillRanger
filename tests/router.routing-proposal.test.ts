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

test("ambiguity declarations are closed to two or three unique canonical skill IDs", () => {
  const valid = validateRoutingProposalShape({
    ...validProposal,
    ambiguity: { primarySkillIds: ["frontend.motion-design", "frontend.visual-design-polish"] },
  });
  assert.deepEqual(valid.ambiguity, { primarySkillIds: ["frontend.motion-design", "frontend.visual-design-polish"] });

  for (const primarySkillIds of [
    ["frontend.motion-design"],
    ["frontend.motion-design", "frontend.visual-design-polish", "frontend.react-component-design", "frontend.design-system"],
    ["frontend.motion-design", "frontend.motion-design"],
    ["frontend.motion-design", "FRONTEND.VISUAL-DESIGN-POLISH"],
  ]) {
    assert.throws(
      () => validateRoutingProposalShape({ ...validProposal, ambiguity: { primarySkillIds } }),
      (error: unknown) => error instanceof RoutingProposalError && error.code === "routing-proposal-invalid",
    );
  }
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

test("an invalid nomination does not consume the duplicate slot of a later valid nomination", async () => {
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
    nominations: [
      {
        skillId: "frontend.react-component-design",
        role: "environment",
        confidence: 0.99,
        evidenceText: "build a component",
      },
      {
        skillId: "frontend.react-component-design",
        role: "primary",
        confidence: 0.8,
        evidenceText: "build a component",
      },
    ],
  };

  const result = validateRoutingProposal({
    proposal,
    prompt: "Please build a component with React",
    catalog,
  });

  assert.equal(result.status, undefined);
  if ("status" in result) return;
  assert.deepEqual(result.nominations.map(({ skillId, role }) => ({ skillId, role })), [
    { skillId: "frontend.react-component-design", role: "primary" },
  ]);
  assert.deepEqual(result.rejections, [{ skillId: "frontend.react-component-design", reasonCode: "role-not-allowed" }]);
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

test("explicit skill choice requires an affirmative exact canonical request", () => {
  const skillId = "frontend.react-component-design";
  assert.equal(detectExplicitSkillChoice(`Use ${skillId} for this task`, [skillId]), skillId);
  assert.equal(detectExplicitSkillChoice(`Use: ${skillId} for this task`, [skillId]), skillId);
  assert.equal(detectExplicitSkillChoice(`Please select ${skillId} as the primary workflow`, [skillId]), skillId);
  assert.equal(detectExplicitSkillChoice(`The relevant workflow is ${skillId}`, [skillId]), undefined);
  assert.equal(detectExplicitSkillChoice(`Use React Component Design for this task`, [skillId]), undefined);
  assert.equal(detectExplicitSkillChoice(`Use frontend for this task`, [skillId]), undefined);
  assert.equal(detectExplicitSkillChoice(`Use FRONTEND.REACT-COMPONENT-DESIGN for this task`, [skillId]), undefined);
});

test("explicit skill choice ignores negation, code spans, and URLs", () => {
  const skillId = "frontend.react-component-design";
  assert.equal(detectExplicitSkillChoice(`Do not use ${skillId}`, [skillId]), undefined);
  assert.equal(detectExplicitSkillChoice(`Do not use ${skillId}, use ${skillId}`, [skillId]), skillId);
  assert.equal(detectExplicitSkillChoice(`Do not use ${skillId} and use ${skillId}`, [skillId]), skillId);
  assert.equal(detectExplicitSkillChoice(`не используй ${skillId}`, [skillId]), undefined);
  assert.equal(detectExplicitSkillChoice(`Read \`${skillId}\` in the docs`, [skillId]), undefined);
  assert.equal(detectExplicitSkillChoice(`Read https://example.com/${skillId}`, [skillId]), undefined);
});

test("ambiguity referencing rejected primary nominations fails with bounded rejections and accepted count", async () => {
  const catalog = await buildSkillCatalog();
  const receipt = await completeCatalogReceipt();
  const baseProposal = {
    schemaVersion: "routing-proposal/1.0" as const,
    catalogDigest: catalog.digest,
    catalogReceipt: receipt,
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
  let error: RoutingProposalError | undefined;
  try {
    validateRoutingProposal({ proposal: baseProposal, prompt: "Please build a component with React", catalog });
  } catch (caught) {
    if (caught instanceof RoutingProposalError) error = caught;
    else throw caught;
  }
  assert.ok(error, "expected RoutingProposalError for ambiguity referencing rejected nominations");
  assert.equal(error.code, "routing-proposal-invalid");
  assert.match(error.message, /see details\.rejections and details\.acceptedCount/);
  assert.equal(error.details?.field, "routingProposal.ambiguity.primarySkillIds");
  const rejections = error.details?.rejections as Array<{ skillId?: string; reasonCode: string }>;
  assert.ok(Array.isArray(rejections));
  assert.equal(rejections.length, 2);
  // rejections are sorted by skillId:reasonCode and bounded to 16
  assert.deepEqual(rejections, [...rejections].sort((a, b) => `${a.skillId ?? ""}:${a.reasonCode}`.localeCompare(`${b.skillId ?? ""}:${b.reasonCode}`)));
  assert.equal(error.details?.acceptedCount, 0);
  // every rejection is enumerated with reasonCode
  assert.ok(rejections.every((r) => typeof r.reasonCode === "string" && r.reasonCode.length > 0));
  assert.ok(rejections.some((r) => r.reasonCode === "skill-not-in-catalog"));
});

test("structurally invalid proposal fails without rejections list", () => {
  const invalid: unknown = {
    schemaVersion: "routing-proposal/1.0",
    catalogDigest: `sha256:${"a".repeat(64)}`,
    catalogReceipt: "receipt",
    interpretation: {
      domains: ["frontend"],
      actions: ["implement"],
      artifactTypes: ["component"],
      intentTags: ["component-design"],
      technologyTags: ["react"],
      qualityGoals: ["accessibility"],
    },
    // missing nominations entirely — structural shape error
  };
  let error: RoutingProposalError | undefined;
  try {
    validateRoutingProposalShape(invalid);
  } catch (caught) {
    if (caught instanceof RoutingProposalError) error = caught;
    else throw caught;
  }
  assert.ok(error);
  assert.equal(error.code, "routing-proposal-invalid");
  // structural failures carry only field, no bounded rejection list
  assert.equal(typeof error.details?.field, "string");
  assert.equal(error.details?.rejections, undefined);
  assert.equal(error.details?.acceptedCount, undefined);
});

test("rejection list in ambiguity error is sorted and bounded to 16 items", async () => {
  const catalog = await buildSkillCatalog();
  const receipt = await completeCatalogReceipt();
  const nominations = Array.from({ length: 16 }, (_, i) => ({
    skillId: `frontend.unknown-${String(i).padStart(2, "0")}`,
    role: "primary" as const,
    confidence: 0.9,
    evidenceText: "build a component",
  }));
  const proposal = {
    schemaVersion: "routing-proposal/1.0" as const,
    catalogDigest: catalog.digest,
    catalogReceipt: receipt,
    interpretation: {
      domains: ["frontend"],
      actions: ["implement"],
      artifactTypes: ["component"],
      intentTags: ["component-design"],
      technologyTags: ["react"],
      qualityGoals: ["accessibility"],
    },
    nominations,
    ambiguity: { primarySkillIds: ["frontend.unknown-00", "frontend.unknown-01"] },
  };
  let error: RoutingProposalError | undefined;
  try {
    validateRoutingProposal({ proposal, prompt: "Please build a component with React", catalog });
  } catch (caught) {
    if (caught instanceof RoutingProposalError) error = caught;
    else throw caught;
  }
  assert.ok(error);
  const rejections = error.details?.rejections as unknown[];
  assert.ok(Array.isArray(rejections));
  assert.equal(rejections.length, 16);
  assert.equal(error.details?.acceptedCount, 0);
  const sorted = [...(rejections as Array<{ skillId?: string; reasonCode: string }>)].sort((a, b) => `${a.skillId ?? ""}:${a.reasonCode}`.localeCompare(`${b.skillId ?? ""}:${b.reasonCode}`));
  assert.deepEqual(rejections, sorted);
});

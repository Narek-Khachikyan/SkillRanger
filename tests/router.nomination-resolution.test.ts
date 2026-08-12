import test from "node:test";
import assert from "node:assert/strict";
import { loadRouterFixturePacks, type RouterFixturePack } from "../src/router/fixtures.ts";
import {
  applyPrimarySkillAmbiguityAnswer,
  explicitSkillChoiceReasonCode,
  primarySkillAmbiguityQuestionFor,
  primarySkillAmbiguityQuestionId,
  primarySkillAmbiguityQuestionText,
  resolveDeclaredPrimarySkillAmbiguity,
  resolveDeclaredPrimarySkillClarification,
  resolveNomination,
  resolvePrimaryArbitration,
  type ResolvedNomination,
} from "../src/router/nomination-resolution.ts";
import {
  buildNominatedPrimaryEligibilityFacts,
  composeSkillSet,
  defaultRouterLimits,
  retrieveSkillCandidates,
  type RetrieveSkillCandidatesInput,
  type RouterSkillMetadata,
} from "../src/router/composer.ts";
import { createRetrievalBoundary } from "../src/router/retrieval-boundary.ts";
import type { TaskProfile } from "../src/router/types.ts";

const fixtureRoot = "tests/fixtures/router-packs";

// Mirrors the unified retrieval input the boundary factory consumes for a
// composition input: the same profile, skills, domains, capabilities, and
// nomination resolution, plus the composed max-selected-risk limit.
const boundaryFor = (input: RetrieveSkillCandidatesInput & { resolvedNomination?: ResolvedNomination }) => createRetrievalBoundary({
  ...input,
  maxSelectedRisk: defaultRouterLimits.maxSelectedRisk,
  ...(input.resolvedNomination === undefined ? {} : {
    nominatedSkillIds: input.resolvedNomination.nominatedSkillIds,
    nominatedPrimarySkillIds: input.resolvedNomination.nominatedPrimarySkillIds,
    nominatedRoles: input.resolvedNomination.nominatedRoles,
  }),
});

const profile = (overrides: Partial<TaskProfile> = {}): TaskProfile => ({
  schemaVersion: "task-profile/1.0",
  normalizedGoal: "implement api",
  locale: "en",
  actions: ["implement"],
  artifactTypes: ["api"],
  technologies: [],
  constraints: [],
  qualityGoals: ["correctness"],
  acceptanceCriteria: [],
  domains: [{ id: "backend-api", confidence: 1, role: "primary", available: true, reasons: [], evidence: [] }],
  subtasks: [],
  evidence: [],
  ...overrides,
});

const fixtureSkills = (packs: RouterFixturePack[]) => packs.flatMap(({ skills }) => skills.map((skill) => ({
  ...skill,
  packageChecksum: `sha256:${skill.id}`,
  source: "test-fixture-registry" as const,
  auditPassed: true,
} satisfies RouterSkillMetadata)));

test("explicit choice reason codes preserve the exact prefix and suffix strings", () => {
  assert.equal(explicitSkillChoiceReasonCode("risk-blocked"), "explicit-skill-choice-risk-blocked");
  assert.equal(explicitSkillChoiceReasonCode("candidate-not-found"), "explicit-skill-choice-candidate-not-found");
  assert.equal(explicitSkillChoiceReasonCode("primary-role-ineligible"), "explicit-skill-choice-primary-role-ineligible");
  assert.equal(explicitSkillChoiceReasonCode("dependency-cycle"), "explicit-skill-choice-dependency-cycle");
  assert.equal(
    explicitSkillChoiceReasonCode("missing-required-evidence:intent:visual-reference"),
    "explicit-skill-choice-missing-required-evidence:intent:visual-reference",
  );
});

test("primary arbitration blocks an ineligible explicit choice with the exact reason code", () => {
  assert.deepEqual(resolvePrimaryArbitration({
    explicitSkillId: "backend.high-risk",
    eligibilityFacts: [
      { skillId: "backend.high-risk", primaryRoleEligible: false, baseRejectionReason: "risk-blocked" },
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
    ],
    primaryNominationOrder: ["backend.high-risk", "backend.auth-implementation"],
  }), {
    kind: "explicit-choice-blocked",
    reasonCode: "explicit-skill-choice-risk-blocked",
    baseRejectionReason: "risk-blocked",
  });
});

test("primary arbitration never substitutes a blocked explicit choice", () => {
  const decision = resolvePrimaryArbitration({
    explicitSkillId: "backend.auth-implementation",
    eligibilityFacts: [
      { skillId: "backend.auth-implementation", primaryRoleEligible: false, baseRejectionReason: "dependency-cycle" },
    ],
    primaryNominationOrder: ["backend.auth-implementation"],
  });
  assert.equal(decision.kind, "explicit-choice-blocked");
  if (decision.kind === "explicit-choice-blocked") {
    assert.equal(decision.reasonCode, "explicit-skill-choice-dependency-cycle");
    assert.equal(decision.baseRejectionReason, "dependency-cycle");
  }
});

test("an ineligible explicit choice never stands without an explicit base rejection reason", () => {
  assert.deepEqual(resolvePrimaryArbitration({
    explicitSkillId: "backend.high-risk",
    eligibilityFacts: [{ skillId: "backend.high-risk", primaryRoleEligible: false }],
    primaryNominationOrder: ["backend.high-risk"],
  }), {
    kind: "explicit-choice-blocked",
    reasonCode: "explicit-skill-choice-ineligible",
    baseRejectionReason: "ineligible",
  });
  assert.deepEqual(resolvePrimaryArbitration({
    explicitSkillId: "backend.undeclared",
    eligibilityFacts: [],
    primaryNominationOrder: ["backend.undeclared"],
  }), {
    kind: "explicit-choice-blocked",
    reasonCode: "explicit-skill-choice-ineligible",
    baseRejectionReason: "ineligible",
  });
});

test("primary arbitration carries the complete effective order beside a standing explicit choice", () => {
  assert.deepEqual(resolvePrimaryArbitration({
    explicitSkillId: "backend.auth-implementation",
    eligibilityFacts: [
      { skillId: "backend.high-risk", primaryRoleEligible: false },
      { skillId: "backend.semantic-primary", primaryRoleEligible: true },
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
    ],
    primaryNominationOrder: ["backend.high-risk", "backend.semantic-primary", "backend.auth-implementation", "backend.semantic-primary"],
  }), {
    kind: "explicit-choice-stands",
    skillId: "backend.auth-implementation",
    primaryOrder: ["backend.auth-implementation", "backend.semantic-primary"],
  });
});

test("primary arbitration orders only the explicit choice when no other eligible nomination exists", () => {
  assert.deepEqual(resolvePrimaryArbitration({
    explicitSkillId: "backend.auth-implementation",
    eligibilityFacts: [{ skillId: "backend.auth-implementation", primaryRoleEligible: true }],
    primaryNominationOrder: ["backend.auth-implementation"],
  }), {
    kind: "explicit-choice-stands",
    skillId: "backend.auth-implementation",
    primaryOrder: ["backend.auth-implementation"],
  });
});

test("primary arbitration considers eligible non-explicit nominations in declared order", () => {
  assert.deepEqual(resolvePrimaryArbitration({
    eligibilityFacts: [
      { skillId: "backend.high-risk", primaryRoleEligible: false },
      { skillId: "backend.semantic-primary", primaryRoleEligible: true },
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
    ],
    primaryNominationOrder: ["backend.high-risk", "backend.semantic-primary", "backend.auth-implementation"],
  }), {
    kind: "ordered-nominations",
    primaryOrder: ["backend.semantic-primary", "backend.auth-implementation"],
  });
});

test("primary arbitration collapses duplicate nominations and keeps the explicit choice first", () => {
  assert.deepEqual(resolvePrimaryArbitration({
    explicitSkillId: "backend.auth-implementation",
    eligibilityFacts: [
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
      { skillId: "backend.semantic-primary", primaryRoleEligible: true },
    ],
    primaryNominationOrder: [
      "backend.auth-implementation",
      "backend.semantic-primary",
      "backend.auth-implementation",
      "backend.semantic-primary",
    ],
  }), {
    kind: "explicit-choice-stands",
    skillId: "backend.auth-implementation",
    primaryOrder: ["backend.auth-implementation", "backend.semantic-primary"],
  });
});

test("primary arbitration falls back deterministically when no non-explicit nomination remains eligible", () => {
  assert.deepEqual(resolvePrimaryArbitration({
    eligibilityFacts: [{ skillId: "backend.high-risk", primaryRoleEligible: false }],
    primaryNominationOrder: ["backend.high-risk"],
  }), { kind: "deterministic-fallback" });
  assert.deepEqual(resolvePrimaryArbitration({ eligibilityFacts: [], primaryNominationOrder: [] }), { kind: "deterministic-fallback" });
});

test("a declared ambiguity between eligible primary nominations requires a typed closed-option clarification", () => {
  const resolution = resolveDeclaredPrimarySkillAmbiguity({
    declaredAmbiguityIds: ["backend.auth-implementation", "backend.semantic-primary"],
    eligibilityFacts: [
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
      { skillId: "backend.semantic-primary", primaryRoleEligible: true },
    ],
  });
  assert.deepEqual(resolution, { kind: "ambiguity-eligible", skillIds: ["backend.auth-implementation", "backend.semantic-primary"] });
});

test("a declared ambiguity keeps its declared order and collapses duplicates", () => {
  const resolution = resolveDeclaredPrimarySkillAmbiguity({
    declaredAmbiguityIds: ["backend.semantic-primary", "backend.auth-implementation", "backend.semantic-primary"],
    eligibilityFacts: [
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
      { skillId: "backend.semantic-primary", primaryRoleEligible: true },
    ],
  });
  assert.deepEqual(resolution, { kind: "ambiguity-eligible", skillIds: ["backend.semantic-primary", "backend.auth-implementation"] });
});

test("an ineligible declared ambiguity is rejected with the ineligible ids in declared order", () => {
  const resolution = resolveDeclaredPrimarySkillAmbiguity({
    declaredAmbiguityIds: ["backend.semantic-primary", "backend.high-risk", "backend.auth-implementation"],
    eligibilityFacts: [
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
      { skillId: "backend.high-risk", primaryRoleEligible: false },
      { skillId: "backend.semantic-primary", primaryRoleEligible: true },
    ],
  });
  assert.deepEqual(resolution, { kind: "ambiguity-ineligible", ineligibleSkillIds: ["backend.high-risk"] });
});

test("a declared ambiguity id absent from the eligibility facts is ineligible", () => {
  const resolution = resolveDeclaredPrimarySkillAmbiguity({
    declaredAmbiguityIds: ["backend.auth-implementation", "backend.undeclared"],
    eligibilityFacts: [{ skillId: "backend.auth-implementation", primaryRoleEligible: true }],
  });
  assert.deepEqual(resolution, { kind: "ambiguity-ineligible", ineligibleSkillIds: ["backend.undeclared"] });
});

test("the explicit user choice outranks a declared ambiguity", () => {
  assert.deepEqual(resolveDeclaredPrimarySkillAmbiguity({
    declaredAmbiguityIds: ["backend.auth-implementation", "backend.semantic-primary"],
    explicitSkillId: "backend.semantic-primary",
    eligibilityFacts: [
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
      { skillId: "backend.semantic-primary", primaryRoleEligible: true },
    ],
  }), { kind: "no-ambiguity" });
});

test("an empty ambiguity declaration never requires a skill clarification", () => {
  assert.deepEqual(resolveDeclaredPrimarySkillAmbiguity({ declaredAmbiguityIds: [], eligibilityFacts: [] }), { kind: "no-ambiguity" });
});

test("the ambiguity question is a typed closed-option question over the declared ids", () => {
  const question = primarySkillAmbiguityQuestionFor({
    skillIds: ["backend.auth-implementation", "backend.semantic-primary"],
    displayNameFor: (skillId) => skillId === "backend.auth-implementation" ? "Auth Implementation" : undefined,
  });
  assert.equal(question.id, "primary-skill");
  assert.equal(question.id, primarySkillAmbiguityQuestionId);
  assert.equal(question.text, "Which nominated skill should be the primary workflow?");
  assert.equal(question.text, primarySkillAmbiguityQuestionText);
  assert.deepEqual(question.options, [
    { value: "backend.auth-implementation", label: "Auth Implementation" },
    { value: "backend.semantic-primary", label: "backend.semantic-primary" },
  ]);
});

test("a valid answer selects exactly one declared eligible primary nomination", () => {
  assert.deepEqual(applyPrimarySkillAmbiguityAnswer({
    answer: "backend.semantic-primary",
    eligibleSkillIds: ["backend.auth-implementation", "backend.semantic-primary"],
  }), { kind: "selected-primary", skillId: "backend.semantic-primary" });
  assert.deepEqual(applyPrimarySkillAmbiguityAnswer({
    answer: "BACKEND.Auth-Implementation",
    eligibleSkillIds: ["backend.auth-implementation", "backend.semantic-primary"],
  }), { kind: "selected-primary", skillId: "backend.auth-implementation" });
});

test("a missing or non-declared answer is rejected", () => {
  const eligibleSkillIds = ["backend.auth-implementation", "backend.semantic-primary"];
  assert.deepEqual(applyPrimarySkillAmbiguityAnswer({ answer: undefined, eligibleSkillIds }), { kind: "not-a-declared-option" });
  assert.deepEqual(applyPrimarySkillAmbiguityAnswer({ answer: "backend.high-risk", eligibleSkillIds }), { kind: "not-a-declared-option" });
  assert.deepEqual(applyPrimarySkillAmbiguityAnswer({ answer: "free-form", eligibleSkillIds }), { kind: "not-a-declared-option" });
});

const declaredNominations = [
  { skillId: "backend.auth-implementation", role: "primary" as const },
  { skillId: "backend.semantic-primary", role: "primary" as const },
];

test("the cohesive decision requires a typed closed-option clarification for an eligible declared ambiguity", () => {
  const decision = resolveDeclaredPrimarySkillClarification({
    declaredAmbiguityIds: ["backend.auth-implementation", "backend.semantic-primary"],
    eligibilityFacts: [
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
      { skillId: "backend.semantic-primary", primaryRoleEligible: true },
    ],
    displayNameFor: (skillId) => skillId === "backend.auth-implementation" ? "Auth Implementation" : undefined,
  });
  assert.equal(decision.kind, "clarification-required");
  if (decision.kind !== "clarification-required") return;
  assert.deepEqual(decision.eligibleSkillIds, ["backend.auth-implementation", "backend.semantic-primary"]);
  assert.equal(decision.question.id, primarySkillAmbiguityQuestionId);
  assert.equal(decision.question.text, primarySkillAmbiguityQuestionText);
  assert.deepEqual(decision.question.options, [
    { value: "backend.auth-implementation", label: "Auth Implementation" },
    { value: "backend.semantic-primary", label: "backend.semantic-primary" },
  ]);
});

test("the explicit user choice outranks a declared ambiguity in the cohesive decision", () => {
  const decision = resolveDeclaredPrimarySkillClarification({
    declaredAmbiguityIds: ["backend.auth-implementation", "backend.semantic-primary"],
    explicitSkillId: "backend.semantic-primary",
    eligibilityFacts: [
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
      { skillId: "backend.semantic-primary", primaryRoleEligible: true },
    ],
    displayNameFor: () => undefined,
  });
  assert.deepEqual(decision, { kind: "no-clarification" });
});

test("an ineligible or inconsistent declared ambiguity fails closed in the cohesive decision", () => {
  const decision = resolveDeclaredPrimarySkillClarification({
    declaredAmbiguityIds: ["backend.auth-implementation", "backend.high-risk", "backend.undeclared"],
    eligibilityFacts: [
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
      { skillId: "backend.high-risk", primaryRoleEligible: false },
    ],
    displayNameFor: () => undefined,
  });
  assert.deepEqual(decision, { kind: "ambiguity-ineligible", ineligibleSkillIds: ["backend.high-risk", "backend.undeclared"] });
});

test("an empty ambiguity declaration never requires a skill clarification", () => {
  assert.deepEqual(resolveDeclaredPrimarySkillClarification({
    declaredAmbiguityIds: [],
    eligibilityFacts: [],
    displayNameFor: () => undefined,
  }), { kind: "no-clarification" });
});

test("a valid continuation answer selects exactly one eligible primary and updates the effective nomination order", () => {
  const decision = resolveDeclaredPrimarySkillClarification({
    declaredAmbiguityIds: ["backend.auth-implementation", "backend.semantic-primary"],
    eligibilityFacts: [
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
      { skillId: "backend.semantic-primary", primaryRoleEligible: true },
    ],
    declaredNominations,
    answer: "backend.semantic-primary",
    displayNameFor: () => undefined,
  });
  assert.equal(decision.kind, "answer-accepted");
  if (decision.kind !== "answer-accepted") return;
  assert.equal(decision.selectedPrimarySkillId, "backend.semantic-primary");
  assert.equal(decision.resolvedNomination.requiredPrimarySkillId, "backend.semantic-primary");
  assert.deepEqual(decision.resolvedNomination.nominationOrder, ["backend.semantic-primary", "backend.auth-implementation"]);
  assert.deepEqual(decision.resolvedNomination.primaryNominationOrder, ["backend.semantic-primary", "backend.auth-implementation"]);
});

test("a valid continuation answer is canonicalized before selection", () => {
  const decision = resolveDeclaredPrimarySkillClarification({
    declaredAmbiguityIds: ["backend.auth-implementation", "backend.semantic-primary"],
    eligibilityFacts: [
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
      { skillId: "backend.semantic-primary", primaryRoleEligible: true },
    ],
    declaredNominations,
    answer: "BACKEND.Auth-Implementation",
    displayNameFor: () => undefined,
  });
  assert.equal(decision.kind, "answer-accepted");
  if (decision.kind !== "answer-accepted") return;
  assert.equal(decision.selectedPrimarySkillId, "backend.auth-implementation");
  assert.deepEqual(decision.resolvedNomination.nominationOrder, ["backend.auth-implementation", "backend.semantic-primary"]);
});

test("a missing, free-form, or non-declared answer is rejected by the cohesive decision", () => {
  const input = {
    declaredAmbiguityIds: ["backend.auth-implementation", "backend.semantic-primary"],
    eligibilityFacts: [
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
      { skillId: "backend.semantic-primary", primaryRoleEligible: true },
    ],
    declaredNominations,
    displayNameFor: () => undefined,
  };
  assert.deepEqual(resolveDeclaredPrimarySkillClarification({ ...input, answer: "free-form" }), { kind: "answer-invalid" });
  assert.deepEqual(resolveDeclaredPrimarySkillClarification({ ...input, answer: "backend.high-risk" }), { kind: "answer-invalid" });
});

test("an eligible answer that is not a declared nomination is rejected without a resolution", () => {
  const decision = resolveDeclaredPrimarySkillClarification({
    declaredAmbiguityIds: ["backend.eligibility-only"],
    eligibilityFacts: [{ skillId: "backend.eligibility-only", primaryRoleEligible: true }],
    declaredNominations: [],
    answer: "backend.eligibility-only",
    displayNameFor: () => undefined,
  });
  assert.deepEqual(decision, { kind: "answer-invalid" });
});

test("the cohesive decision carries only the resolution, never token or transport artifacts", () => {
  const decision = resolveDeclaredPrimarySkillClarification({
    declaredAmbiguityIds: ["backend.auth-implementation", "backend.semantic-primary"],
    eligibilityFacts: [
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
      { skillId: "backend.semantic-primary", primaryRoleEligible: true },
    ],
    declaredNominations,
    answer: "backend.semantic-primary",
    displayNameFor: () => undefined,
  });
  assert.equal(decision.kind, "answer-accepted");
  assert.equal(Object.keys(decision).includes("resolvedNomination"), true);
  assert.equal("expiresAt" in (decision as object), false);
  assert.equal("token" in (decision as object), false);
});

test("nomination resolution is a pure projection that never mutates its inputs", () => {
  const facts = [
    { skillId: "backend.high-risk", primaryRoleEligible: false },
    { skillId: "backend.auth-implementation", primaryRoleEligible: true },
  ];
  const order = ["backend.high-risk", "backend.auth-implementation"];
  const declared = ["backend.high-risk", "backend.auth-implementation"];
  const snapshot = JSON.parse(JSON.stringify({ facts, order, declared })) as unknown;
  resolvePrimaryArbitration({
    explicitSkillId: "backend.auth-implementation",
    primaryNominationOrder: order,
    eligibilityFacts: facts,
  });
  resolveDeclaredPrimarySkillAmbiguity({ declaredAmbiguityIds: declared, eligibilityFacts: facts });
  applyPrimarySkillAmbiguityAnswer({ answer: "backend.auth-implementation", eligibleSkillIds: declared });
  primarySkillAmbiguityQuestionFor({ skillIds: declared, displayNameFor: (skillId) => skillId });
  resolveDeclaredPrimarySkillClarification({
    declaredAmbiguityIds: declared,
    eligibilityFacts: facts,
    declaredNominations: [{ skillId: "backend.auth-implementation", role: "primary" }],
    answer: "backend.auth-implementation",
    displayNameFor: (skillId) => skillId,
  });
  assert.deepEqual(JSON.parse(JSON.stringify({ facts, order, declared })) as unknown, snapshot);
});

test("an explicit choice outranks the declared nomination order and lexical score in composition", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const base = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const higherScored = { ...base, id: "backend.higher-scored", displayName: "Higher Scored", score: 0.99 };
  const resolvedNomination: ResolvedNomination = {
    requiredPrimarySkillId: base.id,
    nominationOrder: [higherScored.id, base.id],
    primaryNominationOrder: [higherScored.id, base.id],
    nominatedSkillIds: [higherScored.id, base.id],
    nominatedPrimarySkillIds: [higherScored.id, base.id],
    nominatedRoles: new Map([[higherScored.id, "primary"], [base.id, "primary"]]),
  };
  const input = {
    profile: profile(),
    skills: [higherScored, base],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    resolvedNomination,
  };
  const result = composeSkillSet({ ...input, boundary: boundaryFor(input) });
  assert.equal(result.status, "prepared");
  if (result.status === "prepared") assert.equal(result.composed.primary.skill.id, base.id);
});

test("an ineligible explicit choice fails composition with the exact reason code and no substitution", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const base = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const highRisk = { ...base, id: "backend.high-risk", riskLevel: "high" };
  const input = {
    profile: profile(),
    skills: [highRisk, base],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    resolvedNomination: {
      requiredPrimarySkillId: highRisk.id,
      nominationOrder: [highRisk.id],
      primaryNominationOrder: [highRisk.id],
      nominatedSkillIds: [highRisk.id],
      nominatedPrimarySkillIds: [highRisk.id],
      nominatedRoles: new Map([[highRisk.id, "primary"]]),
    } satisfies ResolvedNomination,
  };
  const result = composeSkillSet({ ...input, boundary: boundaryFor(input) });
  assert.equal(result.status, "no_matching_skills");
  if (result.status === "no_matching_skills") {
    assert.equal(result.reasonCode, "explicit-skill-choice-risk-blocked");
    assert.ok(result.rejections.some(({ skillId, reason }) => skillId === highRisk.id && reason === "risk-blocked"));
  }
});

test("a composition hard veto on the explicit choice returns the exact reason code without substitution", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const base = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const cycleA = skills.find(({ id }) => id === "backend.cycle-a")!;
  const input = {
    profile: profile(),
    skills: [cycleA, base],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    resolvedNomination: {
      requiredPrimarySkillId: cycleA.id,
      nominationOrder: [cycleA.id],
      primaryNominationOrder: [cycleA.id],
      nominatedSkillIds: [cycleA.id],
      nominatedPrimarySkillIds: [cycleA.id],
      nominatedRoles: new Map([[cycleA.id, "primary"]]),
    } satisfies ResolvedNomination,
  };
  const result = composeSkillSet({ ...input, boundary: boundaryFor(input) });
  assert.equal(result.status, "no_matching_skills");
  if (result.status === "no_matching_skills") assert.equal(result.reasonCode, "explicit-skill-choice-dependency-cycle");
});

test("an invalid nomination falls through to the next valid nomination in composition", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const base = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const highRisk = { ...base, id: "backend.high-risk", riskLevel: "high" };
  const input = {
    profile: profile(),
    skills: [highRisk, base],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    resolvedNomination: {
      nominationOrder: [highRisk.id, base.id],
      primaryNominationOrder: [highRisk.id, base.id],
      nominatedSkillIds: [highRisk.id, base.id],
      nominatedPrimarySkillIds: [highRisk.id, base.id],
      nominatedRoles: new Map([[highRisk.id, "primary"], [base.id, "primary"]]),
    } satisfies ResolvedNomination,
  };
  const result = composeSkillSet({ ...input, boundary: boundaryFor(input) });
  assert.equal(result.status, "prepared");
  if (result.status === "prepared") assert.equal(result.composed.primary.skill.id, base.id);
  assert.ok(result.rejections.some(({ skillId, reason }) => skillId === highRisk.id && reason === "risk-blocked"));
});

test("composition falls back deterministically when no nomination remains eligible", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const base = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const highRisk = { ...base, id: "backend.high-risk", riskLevel: "high" };
  const blocked = { ...base, id: "backend.blocked", riskLevel: "block" };
  const input = {
    profile: profile(),
    skills: [highRisk, blocked, base],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    resolvedNomination: {
      nominationOrder: [highRisk.id, blocked.id],
      primaryNominationOrder: [highRisk.id, blocked.id],
      nominatedSkillIds: [highRisk.id, blocked.id],
      nominatedPrimarySkillIds: [highRisk.id, blocked.id],
      nominatedRoles: new Map([[highRisk.id, "primary"], [blocked.id, "primary"]]),
    } satisfies ResolvedNomination,
  };
  const result = composeSkillSet({ ...input, boundary: boundaryFor(input) });
  assert.equal(result.status, "prepared");
  if (result.status === "prepared") assert.equal(result.composed.primary.skill.id, base.id);
});

test("strict mode never substitutes the explicit choice with another workflow", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const base = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const highRisk = { ...base, id: "backend.high-risk", riskLevel: "high" };
  const inputRequired = skills.find(({ id }) => id === "backend.input-required")!;
  const installed = { ...base, installed: true, source: "installed" as const, lockfileMatch: true, installedFileSetMatch: true, strictContract: "valid" as const, contractInputAccepted: true, contractMustRead: ["SKILL.md"] };
  const input = {
    profile: profile(),
    skills: [highRisk, installed, inputRequired],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    strict: true,
    installedSkillIds: [installed.id],
    resolvedNomination: {
      nominationOrder: [highRisk.id, installed.id],
      primaryNominationOrder: [highRisk.id, installed.id],
      nominatedSkillIds: [highRisk.id, installed.id],
      nominatedPrimarySkillIds: [highRisk.id, installed.id],
      nominatedRoles: new Map([[highRisk.id, "primary"], [installed.id, "primary"]]),
    } satisfies ResolvedNomination,
  };
  const hardVeto = composeSkillSet({ ...input, resolvedNomination: { ...input.resolvedNomination, requiredPrimarySkillId: highRisk.id }, boundary: boundaryFor(input) });
  assert.equal(hardVeto.status, "no_matching_skills");
  if (hardVeto.status === "no_matching_skills") assert.equal(hardVeto.reasonCode, "explicit-skill-choice-risk-blocked");
  const uninstalled = composeSkillSet({ ...input, resolvedNomination: { ...input.resolvedNomination, requiredPrimarySkillId: "backend.input-required" }, boundary: boundaryFor(input) });
  assert.equal(uninstalled.status, "strict_requirements_unmet");
  if (uninstalled.status === "strict_requirements_unmet") {
    assert.ok(uninstalled.missing.some(({ skillId, requirement }) => skillId === "backend.input-required" && requirement === "installed-skill"));
  }
});

test("a nominationOrder-only caller keeps declared-order primary ranking", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const base = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const higherScored = { ...base, id: "backend.higher-scored", displayName: "Higher Scored", score: 0.99 };
  const composeInput = {
    profile: profile(),
    skills: [base, higherScored],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    resolvedNomination: {
      nominationOrder: [base.id, higherScored.id],
      primaryNominationOrder: [],
      nominatedSkillIds: [base.id, higherScored.id],
      nominatedPrimarySkillIds: [],
      nominatedRoles: new Map([[base.id, "primary"], [higherScored.id, "primary"]]),
    },
  };
  const result = composeSkillSet({ ...composeInput, boundary: boundaryFor(composeInput) });
  assert.equal(result.status, "prepared");
  if (result.status === "prepared") assert.equal(result.composed.primary.skill.id, base.id);
});

test("facts-driven nomination decisions match the composition outcome", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const base = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const highRisk = { ...base, id: "backend.high-risk", riskLevel: "high" };
  const nominatedPrimarySkillIds = [highRisk.id, base.id];
  const retrieval = retrieveSkillCandidates({
    profile: profile(),
    skills: [highRisk, base],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    nominatedPrimarySkillIds,
    maxSelectedRisk: "medium",
  });
  const facts = buildNominatedPrimaryEligibilityFacts({ retrieval, skillIds: nominatedPrimarySkillIds });
  const blocked = resolvePrimaryArbitration({
    explicitSkillId: highRisk.id,
    eligibilityFacts: facts,
    primaryNominationOrder: nominatedPrimarySkillIds,
  });
  assert.equal(blocked.kind, "explicit-choice-blocked");
  if (blocked.kind === "explicit-choice-blocked") {
    assert.equal(blocked.reasonCode, "explicit-skill-choice-risk-blocked");
  }
  const ordered = resolvePrimaryArbitration({ eligibilityFacts: facts, primaryNominationOrder: nominatedPrimarySkillIds });
  assert.deepEqual(ordered, { kind: "ordered-nominations", primaryOrder: [base.id] });
  const composeInput = {
    profile: profile(),
    skills: [highRisk, base],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    resolvedNomination: {
      nominationOrder: nominatedPrimarySkillIds,
      primaryNominationOrder: nominatedPrimarySkillIds,
      nominatedSkillIds: nominatedPrimarySkillIds,
      nominatedPrimarySkillIds,
      nominatedRoles: new Map([[highRisk.id, "primary"], [base.id, "primary"]]),
    },
  };
  const composed = composeSkillSet({ ...composeInput, boundary: boundaryFor(composeInput) });
  assert.equal(composed.status, "prepared");
  if (composed.status === "prepared") assert.equal(composed.composed.primary.skill.id, base.id);
});

test("composition outcome maps one-to-one onto the primary arbitration decision", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const base = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const higherScored = { ...base, id: "backend.higher-scored", displayName: "Higher Scored", qualityScore: 0.99, score: 0.99 };
  const nominatedPrimarySkillIds = [higherScored.id, base.id];
  const retrieval = retrieveSkillCandidates({
    profile: profile(),
    skills: [higherScored, base],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    nominatedPrimarySkillIds,
    maxSelectedRisk: "medium",
  });
  const eligibilityFacts = buildNominatedPrimaryEligibilityFacts({ retrieval, skillIds: nominatedPrimarySkillIds });
  const decision = resolvePrimaryArbitration({ eligibilityFacts, primaryNominationOrder: nominatedPrimarySkillIds });
  assert.deepEqual(decision, { kind: "ordered-nominations", primaryOrder: [higherScored.id, base.id] });
  const composeInput = {
    profile: profile(),
    skills: [higherScored, base],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    resolvedNomination: {
      nominationOrder: nominatedPrimarySkillIds,
      primaryNominationOrder: nominatedPrimarySkillIds,
      nominatedSkillIds: nominatedPrimarySkillIds,
      nominatedPrimarySkillIds,
      nominatedRoles: new Map([[higherScored.id, "primary"], [base.id, "primary"]]),
    } satisfies ResolvedNomination,
  };
  const composed = composeSkillSet({ ...composeInput, boundary: boundaryFor(composeInput) });
  assert.equal(composed.status, "prepared");
  if (composed.status === "prepared" && decision.kind === "ordered-nominations") {
    assert.equal(composed.composed.primary.skill.id, decision.primaryOrder[0]);
  }
});

test("strict routing never substitutes a less relevant installed workflow for the nominated workflow", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const base = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const installed = (skill: RouterSkillMetadata, score: number, qualityScore: number): RouterSkillMetadata => ({
    ...skill,
    score,
    qualityScore,
    installed: true,
    source: "installed",
    lockfileMatch: true,
    installedFileSetMatch: true,
    strictContract: "valid",
    contractInputAccepted: true,
    contractMustRead: ["SKILL.md"],
  });
  const nominated = installed(base, 0.7, 0.8);
  const substitute = installed({ ...base, id: "backend.a-substitute", displayName: "Substitute" }, 0.99, 0.95);
  const input = {
    profile: profile(),
    skills: [substitute, nominated],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    strict: true,
    installedSkillIds: [nominated.id, substitute.id],
  };
  const withoutNomination = composeSkillSet({ ...input, boundary: boundaryFor(input) });
  assert.equal(withoutNomination.status, "prepared");
  if (withoutNomination.status === "prepared") assert.equal(withoutNomination.composed.primary.skill.id, substitute.id);
  const withNominationInput = {
    ...input,
    resolvedNomination: {
      nominationOrder: [nominated.id],
      primaryNominationOrder: [nominated.id],
      nominatedSkillIds: [nominated.id],
      nominatedPrimarySkillIds: [nominated.id],
      nominatedRoles: new Map([[nominated.id, "primary"]]),
    } satisfies ResolvedNomination,
  };
  const withNomination = composeSkillSet({ ...withNominationInput, boundary: boundaryFor(withNominationInput) });
  assert.equal(withNomination.status, "prepared");
  if (withNomination.status === "prepared") assert.equal(withNomination.composed.primary.skill.id, nominated.id);
});

test("resolveNomination puts the explicit choice first and keeps the declared order for the rest", () => {
  const resolved = resolveNomination({
    explicitSkillId: "backend.explicit",
    declaredNominations: [
      { skillId: "backend.alpha", role: "primary" },
      { skillId: "backend.beta", role: "primary" },
      { skillId: "backend.gamma", role: "companion" },
    ],
  });
  assert.deepEqual(resolved, {
    requiredPrimarySkillId: "backend.explicit",
    nominationOrder: ["backend.explicit", "backend.alpha", "backend.beta", "backend.gamma"],
    primaryNominationOrder: ["backend.explicit", "backend.alpha", "backend.beta"],
    nominatedSkillIds: ["backend.explicit", "backend.alpha", "backend.beta", "backend.gamma"],
    nominatedPrimarySkillIds: ["backend.explicit", "backend.alpha", "backend.beta"],
    nominatedRoles: new Map([
      ["backend.alpha", "primary"],
      ["backend.beta", "primary"],
      ["backend.gamma", "companion"],
      ["backend.explicit", "primary"],
    ]),
  });
});

test("resolveNomination applies the ambiguity answer by moving it to the front of both orders", () => {
  const resolved = resolveNomination({
    selectedNominationPrimary: "backend.beta",
    declaredNominations: [
      { skillId: "backend.alpha", role: "primary" },
      { skillId: "backend.beta", role: "primary" },
    ],
  });
  assert.deepEqual(resolved?.nominationOrder, ["backend.beta", "backend.alpha"]);
  assert.deepEqual(resolved?.primaryNominationOrder, ["backend.beta", "backend.alpha"]);
  assert.equal(resolved?.requiredPrimarySkillId, "backend.beta");
});

test("resolveNomination rejects an ambiguity answer that is not a declared nomination", () => {
  assert.equal(resolveNomination({
    selectedNominationPrimary: "backend.undeclared",
    declaredNominations: [
      { skillId: "backend.alpha", role: "primary" },
      { skillId: "backend.beta", role: "primary" },
    ],
  }), undefined);
  assert.equal(resolveNomination({
    selectedNominationPrimary: "BACKEND.DELTA",
    declaredNominations: [{ skillId: "backend.beta", role: "primary" }],
  }), undefined);
});

test("resolveNomination keeps the declared order and no required primary without an explicit choice or answer", () => {
  const resolved = resolveNomination({
    declaredNominations: [
      { skillId: "backend.alpha", role: "primary" },
      { skillId: "backend.beta", role: "companion" },
    ],
  });
  assert.deepEqual(resolved, {
    nominationOrder: ["backend.alpha", "backend.beta"],
    primaryNominationOrder: ["backend.alpha"],
    nominatedSkillIds: ["backend.alpha", "backend.beta"],
    nominatedPrimarySkillIds: ["backend.alpha"],
    nominatedRoles: new Map([
      ["backend.alpha", "primary"],
      ["backend.beta", "companion"],
    ]),
  });
  assert.equal(resolved?.requiredPrimarySkillId, undefined);
});

test("resolveNomination returns undefined without an explicit choice or declared nominations", () => {
  assert.equal(resolveNomination({}), undefined);
  assert.equal(resolveNomination({ explicitSkillId: undefined, declaredNominations: [] }), undefined);
});

test("the resolved nomination drives composition exactly like the scattered facts it replaces", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const base = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const higherScored = { ...base, id: "backend.higher-scored", displayName: "Higher Scored", score: 0.99 };
  const resolved = resolveNomination({
    explicitSkillId: base.id,
    declaredNominations: [
      { skillId: higherScored.id, role: "primary" },
      { skillId: base.id, role: "primary" },
    ],
  });
  assert.equal(resolved?.requiredPrimarySkillId, base.id);
  const composeInput = {
    profile: profile(),
    skills: [higherScored, base],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    resolvedNomination: resolved,
  };
  const result = composeSkillSet({ ...composeInput, boundary: boundaryFor(composeInput) });
  assert.equal(result.status, "prepared");
  if (result.status === "prepared") assert.equal(result.composed.primary.skill.id, base.id);
});

import test from "node:test";
import assert from "node:assert/strict";
import { loadRouterFixturePacks, type RouterFixturePack } from "../src/router/fixtures.ts";
import {
  applyPrimarySkillAmbiguityAnswer,
  buildNominatedPrimaryEligibilityFacts,
  explicitSkillChoiceReasonCode,
  primarySkillAmbiguityQuestionFor,
  primarySkillAmbiguityQuestionId,
  primarySkillAmbiguityQuestionText,
  resolveDeclaredPrimarySkillAmbiguity,
  resolveExplicitSkillChoice,
  resolveNomination,
  resolveOrderedPrimaryNominations,
  resolvePrimaryArbitration,
  type ResolvedNomination,
} from "../src/router/nomination-resolution.ts";
import {
  composeSkillSet,
  retrieveSkillCandidates,
  type RouterSkillMetadata,
} from "../src/router/composer.ts";
import type { TaskProfile } from "../src/router/types.ts";

const fixtureRoot = "tests/fixtures/router-packs";

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

test("an eligible explicit choice stands above nominations and lexical routing", () => {
  const resolution = resolveExplicitSkillChoice({ explicitSkillId: "backend.auth-implementation" });
  assert.deepEqual(resolution, { kind: "explicit-choice-stands", skillId: "backend.auth-implementation" });
});

test("without an explicit choice no explicit-choice decision is imposed", () => {
  assert.equal(resolveExplicitSkillChoice({}), undefined);
  assert.equal(resolveExplicitSkillChoice({ baseRejectionReason: "risk-blocked" }), undefined);
});

test("an ineligible explicit choice is blocked with the composer base reason and never substituted", () => {
  assert.deepEqual(resolveExplicitSkillChoice({
    explicitSkillId: "backend.high-risk",
    baseRejectionReason: "risk-blocked",
  }), {
    kind: "explicit-choice-blocked",
    reasonCode: "explicit-skill-choice-risk-blocked",
    baseRejectionReason: "risk-blocked",
  });
});

test("an explicit choice without a composer base reason stands", () => {
  assert.deepEqual(resolveExplicitSkillChoice({ explicitSkillId: "backend.unknown" }), {
    kind: "explicit-choice-stands",
    skillId: "backend.unknown",
  });
});

test("valid primary nominations are considered in declared order and ineligible ones fall through", () => {
  const resolution = resolveOrderedPrimaryNominations({
    primaryNominationOrder: ["backend.high-risk", "backend.auth-implementation", "backend.semantic-primary"],
    eligibilityFacts: [
      { skillId: "backend.high-risk", primaryRoleEligible: false },
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
      { skillId: "backend.semantic-primary", primaryRoleEligible: true },
    ],
  });
  assert.deepEqual(resolution, {
    kind: "ordered-nominations",
    primarySkillIds: ["backend.auth-implementation", "backend.semantic-primary"],
  });
});

test("the explicit choice is excluded from ordered nominations and duplicates collapse", () => {
  const resolution = resolveOrderedPrimaryNominations({
    explicitSkillId: "backend.auth-implementation",
    primaryNominationOrder: [
      "backend.auth-implementation",
      "backend.semantic-primary",
      "backend.auth-implementation",
      "backend.semantic-primary",
    ],
    eligibilityFacts: [
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
      { skillId: "backend.semantic-primary", primaryRoleEligible: true },
    ],
  });
  assert.deepEqual(resolution, { kind: "ordered-nominations", primarySkillIds: ["backend.semantic-primary"] });
});

test("no eligible nominations yields deterministic fallback", () => {
  assert.deepEqual(resolveOrderedPrimaryNominations({
    primaryNominationOrder: ["backend.high-risk", "backend.unknown"],
    eligibilityFacts: [
      { skillId: "backend.high-risk", primaryRoleEligible: false },
      { skillId: "backend.unknown", primaryRoleEligible: false },
    ],
  }), { kind: "no-eligible-nomination" });
  assert.deepEqual(resolveOrderedPrimaryNominations({ primaryNominationOrder: [], eligibilityFacts: [] }), { kind: "no-eligible-nomination" });
});

test("primary arbitration blocks an ineligible explicit choice with the exact reason code", () => {
  assert.deepEqual(resolvePrimaryArbitration({
    explicitSkillId: "backend.high-risk",
    baseRejectionReason: "risk-blocked",
    eligibilityFacts: [
      { skillId: "backend.high-risk", primaryRoleEligible: false },
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
    baseRejectionReason: "dependency-cycle",
    eligibilityFacts: [{ skillId: "backend.auth-implementation", primaryRoleEligible: false }],
    primaryNominationOrder: ["backend.auth-implementation"],
  });
  assert.equal(decision.kind, "explicit-choice-blocked");
  if (decision.kind === "explicit-choice-blocked") {
    assert.equal(decision.reasonCode, "explicit-skill-choice-dependency-cycle");
    assert.equal(decision.baseRejectionReason, "dependency-cycle");
  }
});

test("primary arbitration keeps ordered eligible nominations beside a standing explicit choice", () => {
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
    orderedPrimarySkillIds: ["backend.semantic-primary"],
  });
});

test("primary arbitration orders nothing when a standing explicit choice has no other eligible nomination", () => {
  assert.deepEqual(resolvePrimaryArbitration({
    explicitSkillId: "backend.auth-implementation",
    eligibilityFacts: [{ skillId: "backend.auth-implementation", primaryRoleEligible: true }],
    primaryNominationOrder: ["backend.auth-implementation"],
  }), {
    kind: "explicit-choice-stands",
    skillId: "backend.auth-implementation",
    orderedPrimarySkillIds: [],
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
    primarySkillIds: ["backend.semantic-primary", "backend.auth-implementation"],
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

test("nomination resolution is a pure projection that never mutates its inputs", () => {
  const facts = [
    { skillId: "backend.high-risk", primaryRoleEligible: false },
    { skillId: "backend.auth-implementation", primaryRoleEligible: true },
  ];
  const order = ["backend.high-risk", "backend.auth-implementation"];
  const declared = ["backend.high-risk", "backend.auth-implementation"];
  const snapshot = JSON.parse(JSON.stringify({ facts, order, declared })) as unknown;
  resolveExplicitSkillChoice({ explicitSkillId: "backend.high-risk", baseRejectionReason: "risk-blocked" });
  resolveOrderedPrimaryNominations({ explicitSkillId: "backend.auth-implementation", primaryNominationOrder: order, eligibilityFacts: facts });
  resolvePrimaryArbitration({
    explicitSkillId: "backend.auth-implementation",
    baseRejectionReason: "risk-blocked",
    primaryNominationOrder: order,
    eligibilityFacts: facts,
  });
  resolveDeclaredPrimarySkillAmbiguity({ declaredAmbiguityIds: declared, eligibilityFacts: facts });
  applyPrimarySkillAmbiguityAnswer({ answer: "backend.auth-implementation", eligibleSkillIds: declared });
  primarySkillAmbiguityQuestionFor({ skillIds: declared, displayNameFor: (skillId) => skillId });
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
  const result = composeSkillSet(input);
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
  const result = composeSkillSet(input);
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
  const result = composeSkillSet(input);
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
  const result = composeSkillSet(input);
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
  const result = composeSkillSet(input);
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
  const hardVeto = composeSkillSet({ ...input, resolvedNomination: { ...input.resolvedNomination, requiredPrimarySkillId: highRisk.id } });
  assert.equal(hardVeto.status, "no_matching_skills");
  if (hardVeto.status === "no_matching_skills") assert.equal(hardVeto.reasonCode, "explicit-skill-choice-risk-blocked");
  const uninstalled = composeSkillSet({ ...input, resolvedNomination: { ...input.resolvedNomination, requiredPrimarySkillId: "backend.input-required" } });
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
  const result = composeSkillSet({
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
  });
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
  const explicitResolution = resolveExplicitSkillChoice({
    explicitSkillId: highRisk.id,
    baseRejectionReason: "risk-blocked",
  });
  assert.equal(explicitResolution?.kind, "explicit-choice-blocked");
  if (explicitResolution?.kind === "explicit-choice-blocked") {
    assert.equal(explicitResolution.reasonCode, "explicit-skill-choice-risk-blocked");
  }
  const ordered = resolveOrderedPrimaryNominations({ primaryNominationOrder: nominatedPrimarySkillIds, eligibilityFacts: facts });
  assert.deepEqual(ordered, { kind: "ordered-nominations", primarySkillIds: [base.id] });
  const composed = composeSkillSet({
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
  });
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
  assert.deepEqual(decision, { kind: "ordered-nominations", primarySkillIds: [higherScored.id, base.id] });
  const composed = composeSkillSet({
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
  });
  assert.equal(composed.status, "prepared");
  if (composed.status === "prepared" && decision.kind === "ordered-nominations") {
    assert.equal(composed.composed.primary.skill.id, decision.primarySkillIds[0]);
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
  const withoutNomination = composeSkillSet(input);
  assert.equal(withoutNomination.status, "prepared");
  if (withoutNomination.status === "prepared") assert.equal(withoutNomination.composed.primary.skill.id, substitute.id);
  const withNomination = composeSkillSet({
    ...input,
    resolvedNomination: {
      nominationOrder: [nominated.id],
      primaryNominationOrder: [nominated.id],
      nominatedSkillIds: [nominated.id],
      nominatedPrimarySkillIds: [nominated.id],
      nominatedRoles: new Map([[nominated.id, "primary"]]),
    } satisfies ResolvedNomination,
  });
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
  const result = composeSkillSet({
    profile: profile(),
    skills: [higherScored, base],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    resolvedNomination: resolved,
  });
  assert.equal(result.status, "prepared");
  if (result.status === "prepared") assert.equal(result.composed.primary.skill.id, base.id);
});

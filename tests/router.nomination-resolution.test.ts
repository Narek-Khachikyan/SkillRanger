import test from "node:test";
import assert from "node:assert/strict";
import { loadRouterFixturePacks, type RouterFixturePack } from "../src/router/fixtures.ts";
import {
  buildNominatedPrimaryEligibilityFacts,
  explicitSkillChoiceReasonCode,
  resolveExplicitSkillChoice,
  resolveOrderedPrimaryNominations,
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
  const resolution = resolveExplicitSkillChoice({
    explicitSkillId: "backend.auth-implementation",
    eligibilityFacts: [
      { skillId: "backend.auth-implementation", primaryRoleEligible: true },
      { skillId: "backend.semantic-primary", primaryRoleEligible: true },
    ],
  });
  assert.deepEqual(resolution, { kind: "explicit-choice-stands", skillId: "backend.auth-implementation" });
});

test("without an explicit choice no explicit-choice decision is imposed", () => {
  assert.equal(resolveExplicitSkillChoice({ explicitSkillId: undefined, eligibilityFacts: [] }), undefined);
  assert.equal(
    resolveExplicitSkillChoice({ explicitSkillId: undefined, eligibilityFacts: [], baseRejectionReason: "risk-blocked" }),
    undefined,
  );
});

test("an ineligible explicit choice is blocked with the composer base reason and never substituted", () => {
  assert.deepEqual(resolveExplicitSkillChoice({
    explicitSkillId: "backend.high-risk",
    eligibilityFacts: [{ skillId: "backend.high-risk", primaryRoleEligible: false, baseRejectionReason: "risk-blocked" }],
    baseRejectionReason: "risk-blocked",
  }), {
    kind: "explicit-choice-blocked",
    reasonCode: "explicit-skill-choice-risk-blocked",
    baseRejectionReason: "risk-blocked",
  });
});

test("an ineligible explicit choice falls back to fact reasons when no composer base reason is supplied", () => {
  assert.deepEqual(resolveExplicitSkillChoice({
    explicitSkillId: "backend.audit-failed",
    eligibilityFacts: [{ skillId: "backend.audit-failed", primaryRoleEligible: false, baseRejectionReason: "audit-failed" }],
  }), {
    kind: "explicit-choice-blocked",
    reasonCode: "explicit-skill-choice-audit-failed",
    baseRejectionReason: "audit-failed",
  });
  assert.deepEqual(resolveExplicitSkillChoice({
    explicitSkillId: "backend.unknown",
    eligibilityFacts: [{ skillId: "backend.unknown", primaryRoleEligible: false }],
  }), {
    kind: "explicit-choice-blocked",
    reasonCode: "explicit-skill-choice-primary-role-ineligible",
    baseRejectionReason: "primary-role-ineligible",
  });
});

test("valid primary nominations are considered in declared order and ineligible ones fall through", () => {
  const resolution = resolveOrderedPrimaryNominations({
    primaryNominationOrder: ["backend.high-risk", "backend.auth-implementation", "backend.semantic-primary"],
    eligibilityFacts: [
      { skillId: "backend.high-risk", primaryRoleEligible: false, baseRejectionReason: "risk-blocked" },
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
      { skillId: "backend.high-risk", primaryRoleEligible: false, baseRejectionReason: "risk-blocked" },
      { skillId: "backend.unknown", primaryRoleEligible: false },
    ],
  }), { kind: "no-eligible-nomination" });
  assert.deepEqual(resolveOrderedPrimaryNominations({ primaryNominationOrder: [], eligibilityFacts: [] }), { kind: "no-eligible-nomination" });
});

test("nomination resolution is a pure projection that never mutates its inputs", () => {
  const facts = [
    { skillId: "backend.high-risk", primaryRoleEligible: false, baseRejectionReason: "risk-blocked" },
    { skillId: "backend.auth-implementation", primaryRoleEligible: true },
  ];
  const order = ["backend.high-risk", "backend.auth-implementation"];
  const snapshot = JSON.parse(JSON.stringify({ facts, order })) as unknown;
  resolveExplicitSkillChoice({ explicitSkillId: "backend.high-risk", eligibilityFacts: facts, baseRejectionReason: "risk-blocked" });
  resolveOrderedPrimaryNominations({ explicitSkillId: "backend.auth-implementation", primaryNominationOrder: order, eligibilityFacts: facts });
  assert.deepEqual(JSON.parse(JSON.stringify({ facts, order })) as unknown, snapshot);
});

test("an explicit choice outranks the declared nomination order and lexical score in composition", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const base = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const higherScored = { ...base, id: "backend.higher-scored", displayName: "Higher Scored", score: 0.99 };
  const input = {
    profile: profile(),
    skills: [higherScored, base],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    nominatedPrimarySkillIds: [higherScored.id, base.id],
    nominationOrder: [higherScored.id, base.id],
    primaryNominationOrder: [higherScored.id, base.id],
    requiredPrimarySkillId: base.id,
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
    nominatedPrimarySkillIds: [highRisk.id],
    nominationOrder: [highRisk.id],
    primaryNominationOrder: [highRisk.id],
    requiredPrimarySkillId: highRisk.id,
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
    nominatedPrimarySkillIds: [cycleA.id],
    nominationOrder: [cycleA.id],
    primaryNominationOrder: [cycleA.id],
    requiredPrimarySkillId: cycleA.id,
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
    nominatedPrimarySkillIds: [highRisk.id, base.id],
    nominationOrder: [highRisk.id, base.id],
    primaryNominationOrder: [highRisk.id, base.id],
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
    nominatedPrimarySkillIds: [highRisk.id, blocked.id],
    nominationOrder: [highRisk.id, blocked.id],
    primaryNominationOrder: [highRisk.id, blocked.id],
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
    nominatedPrimarySkillIds: [highRisk.id, installed.id],
    nominationOrder: [highRisk.id, installed.id],
    primaryNominationOrder: [highRisk.id, installed.id],
  };
  const hardVeto = composeSkillSet({ ...input, requiredPrimarySkillId: highRisk.id });
  assert.equal(hardVeto.status, "no_matching_skills");
  if (hardVeto.status === "no_matching_skills") assert.equal(hardVeto.reasonCode, "explicit-skill-choice-risk-blocked");
  const uninstalled = composeSkillSet({ ...input, requiredPrimarySkillId: "backend.input-required" });
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
    nominationOrder: [base.id, higherScored.id],
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
  const facts = buildNominatedPrimaryEligibilityFacts({ retrieval, nominatedPrimarySkillIds });
  const explicitResolution = resolveExplicitSkillChoice({
    explicitSkillId: highRisk.id,
    eligibilityFacts: facts,
    baseRejectionReason: facts.find(({ skillId }) => skillId === highRisk.id)?.baseRejectionReason,
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
    nominatedPrimarySkillIds,
    nominationOrder: nominatedPrimarySkillIds,
    primaryNominationOrder: nominatedPrimarySkillIds,
  });
  assert.equal(composed.status, "prepared");
  if (composed.status === "prepared") assert.equal(composed.composed.primary.skill.id, base.id);
});

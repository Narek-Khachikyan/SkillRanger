import test from "node:test";
import assert from "node:assert/strict";
import { loadRouterFixturePacks, type RouterFixturePack } from "../src/router/fixtures.ts";
import { buildNominatedPrimaryEligibilityFacts } from "../src/router/nomination-resolution.ts";
import {
  composeSkillSet,
  defaultRouterLimits,
  retrieveSkillCandidates,
  type RetrieveSkillCandidatesResult,
  type RouterCandidate,
  type RouterSkillMetadata,
} from "../src/router/composer.ts";
import { canonicalizeJson } from "../src/router/store.ts";
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

test("eligibility facts report eligible and ineligible declared primary nominations", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const base = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const nominated: RouterSkillMetadata[] = [
    base,
    { ...base, id: "backend.high-risk", riskLevel: "high" },
    { ...base, id: "backend.missing-capability", requiredCapabilities: ["docker", "terminal"] },
  ];
  const nominatedPrimarySkillIds = nominated.map(({ id }) => id);
  const retrieval = retrieveSkillCandidates({
    profile: profile(),
    skills: nominated,
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    nominatedSkillIds: nominatedPrimarySkillIds,
    nominatedPrimarySkillIds,
    nominatedRoles: new Map(nominated.map(({ id }) => [id, "primary" as const])),
  });
  const facts = buildNominatedPrimaryEligibilityFacts({ retrieval, skillIds: nominatedPrimarySkillIds });

  assert.deepEqual(facts, [
    { skillId: "backend.auth-implementation", primaryRoleEligible: true },
    { skillId: "backend.high-risk", primaryRoleEligible: false, baseRejectionReason: "risk-blocked" },
    { skillId: "backend.missing-capability", primaryRoleEligible: false, baseRejectionReason: "required-capability-missing" },
  ]);
  for (const fact of facts) {
    const keys = Object.keys(fact).sort();
    assert.deepEqual(keys, fact.primaryRoleEligible
      ? ["primaryRoleEligible", "skillId"]
      : ["baseRejectionReason", "primaryRoleEligible", "skillId"]);
  }
});

test("eligibility facts are a bounded pure projection of the existing retrieval result", () => {
  const eligible: RouterSkillMetadata = {
    id: "backend.eligible",
    displayName: "Eligible",
    version: "1.0.0",
    riskLevel: "low",
    domains: ["backend-api"],
    roles: ["primary"],
    actions: ["implement"],
    artifactTypes: ["api"],
    intentTags: [],
    technologyTags: [],
    qualityGoals: ["correctness"],
    requiredCapabilities: [],
    optionalCapabilities: [],
    dependencies: [],
    conflictsWith: [],
    supersedes: [],
    complements: [],
  };
  const candidate: RouterCandidate = {
    skill: eligible,
    score: 0.9,
    eligibleRoles: ["primary"],
    reasons: [],
    missingCapabilities: [],
    missingOptionalCapabilities: [],
    verificationStatus: "ready",
  };
  const retrieval: RetrieveSkillCandidatesResult = {
    candidates: [candidate],
    primaryCandidates: [candidate],
    rejections: [
      { skillId: "backend.audit-failed", reason: "audit-failed" },
      { skillId: "backend.audit-failed", reason: "risk-blocked" },
    ],
  };
  const snapshot = JSON.parse(JSON.stringify(retrieval)) as unknown;
  const facts = buildNominatedPrimaryEligibilityFacts({
    retrieval,
    skillIds: ["backend.eligible", "backend.audit-failed", "backend.eligible", "backend.unknown"],
  });

  assert.deepEqual(facts, [
    { skillId: "backend.eligible", primaryRoleEligible: true },
    { skillId: "backend.audit-failed", primaryRoleEligible: false, baseRejectionReason: "audit-failed" },
    { skillId: "backend.unknown", primaryRoleEligible: false, baseRejectionReason: "candidate-not-found" },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(retrieval)) as unknown, snapshot);
});

test("composition reuses the supplied retrieval result instead of recomputing eligibility", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const base = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const nominated: RouterSkillMetadata[] = [
    base,
    { ...base, id: "backend.high-risk", riskLevel: "high" },
  ];
  const nominatedIds = nominated.map(({ id }) => id);
  const retrievalInput = {
    profile: profile(),
    skills: nominated,
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    nominatedSkillIds: nominatedIds,
    nominatedPrimarySkillIds: nominatedIds,
    nominatedRoles: new Map(nominated.map(({ id }) => [id, "primary" as const])),
    maxSelectedRisk: defaultRouterLimits.maxSelectedRisk,
  };
  const resolvedNomination = {
    nominationOrder: nominatedIds,
    primaryNominationOrder: nominatedIds,
    nominatedSkillIds: nominatedIds,
    nominatedPrimarySkillIds: nominatedIds,
    nominatedRoles: new Map(nominated.map(({ id }) => [id, "primary" as const])),
  };
  const precomputed = retrieveSkillCandidates(retrievalInput);
  const direct = composeSkillSet({ ...retrievalInput, resolvedNomination });
  const reused = composeSkillSet({ ...retrievalInput, resolvedNomination, retrievalResult: precomputed });

  assert.equal(canonicalizeJson(direct), canonicalizeJson(reused));
  assert.equal(direct.status, "prepared");
  if (direct.status === "prepared") {
    assert.equal(direct.composed.primary.skill.id, "backend.auth-implementation");
    assert.deepEqual(reused.composed.selections, direct.composed.selections);
  }
});

test("composition binds the eligibility decision to the supplied retrieval result", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const base = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const explicit = { ...base, id: "backend.explicit-choice", riskLevel: "low" };
  const nominatedIds = [explicit.id];
  const precomputed = retrieveSkillCandidates({
    profile: profile(),
    skills: [explicit],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    nominatedSkillIds: nominatedIds,
    nominatedPrimarySkillIds: nominatedIds,
    nominatedRoles: new Map([[explicit.id, "primary" as const]]),
  });
  // The input skills would reject the explicit choice as high-risk, but the
  // supplied retrieval result is authoritative: facts are derived from it, never
  // recomputed from the input skills.
  const highRiskInRegistry = { ...base, id: explicit.id, riskLevel: "high" };
  const reused = composeSkillSet({
    profile: profile(),
    skills: [highRiskInRegistry],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    retrievalResult: precomputed,
    resolvedNomination: {
      requiredPrimarySkillId: explicit.id,
      nominationOrder: nominatedIds,
      primaryNominationOrder: nominatedIds,
      nominatedSkillIds: nominatedIds,
      nominatedPrimarySkillIds: nominatedIds,
      nominatedRoles: new Map([[explicit.id, "primary" as const]]),
    },
  });
  assert.equal(reused.status, "prepared");
  if (reused.status === "prepared") assert.equal(reused.composed.primary.skill.id, explicit.id);
});

test("reused eligibility result keeps explicit-choice blocking with the exact reason code", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const base = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const ineligible: RouterSkillMetadata = { ...base, id: "backend.high-risk", riskLevel: "high" };
  const retrievalInput = {
    profile: profile(),
    skills: [ineligible],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    nominatedSkillIds: ["backend.high-risk"],
    nominatedPrimarySkillIds: ["backend.high-risk"],
    nominatedRoles: new Map([["backend.high-risk", "primary" as const]]),
    maxSelectedRisk: defaultRouterLimits.maxSelectedRisk,
  };
  const resolvedNomination = {
    requiredPrimarySkillId: "backend.high-risk",
    nominationOrder: ["backend.high-risk"],
    primaryNominationOrder: ["backend.high-risk"],
    nominatedSkillIds: ["backend.high-risk"],
    nominatedPrimarySkillIds: ["backend.high-risk"],
    nominatedRoles: new Map([["backend.high-risk", "primary" as const]]),
  };
  const precomputed = retrieveSkillCandidates(retrievalInput);
  const direct = composeSkillSet({ ...retrievalInput, resolvedNomination });
  const reused = composeSkillSet({ ...retrievalInput, resolvedNomination, retrievalResult: precomputed });

  assert.equal(canonicalizeJson(direct), canonicalizeJson(reused));
  assert.equal(direct.status, "no_matching_skills");
  if (direct.status === "no_matching_skills") {
    assert.equal(direct.reasonCode, "explicit-skill-choice-risk-blocked");
    assert.deepEqual(reused.rejections, direct.rejections);
  }
});

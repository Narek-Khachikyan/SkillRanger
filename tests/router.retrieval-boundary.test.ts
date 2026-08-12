import test from "node:test";
import assert from "node:assert/strict";
import {
  composeSkillSet,
  defaultRouterLimits,
  retrieveSkillCandidates,
  type ComposeSkillSetInput,
  type RetrieveSkillCandidatesInput,
  type RouterCandidate,
  type RouterSkillMetadata,
} from "../src/router/composer.ts";
import type { ResolvedNomination } from "../src/router/nomination-resolution.ts";
import {
  createRetrievalBoundary,
  createTestRetrievalBoundary,
} from "../src/router/retrieval-boundary.ts";
import { canonicalizeJson } from "../src/router/store.ts";
import type { TaskProfile } from "../src/router/types.ts";

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

const skill = (overrides: Partial<RouterSkillMetadata> = {}): RouterSkillMetadata => ({
  id: "backend.skill",
  displayName: "Synthetic Skill",
  version: "1.0.0",
  riskLevel: "low",
  domains: ["backend-api"],
  roles: ["primary"],
  actions: ["implement"],
  artifactTypes: ["api"],
  intentTags: ["authentication"],
  technologyTags: [],
  qualityGoals: ["correctness"],
  requiredCapabilities: [],
  optionalCapabilities: [],
  dependencies: [],
  conflictsWith: [],
  supersedes: [],
  complements: [],
  ...overrides,
});

const candidate = (skillMetadata: RouterSkillMetadata, overrides: Partial<RouterCandidate> = {}): RouterCandidate => ({
  skill: skillMetadata,
  score: 0.9,
  eligibleRoles: skillMetadata.roles ?? [],
  reasons: [],
  missingCapabilities: [],
  missingOptionalCapabilities: [],
  verificationStatus: "ready",
  ...overrides,
});

test("production factory runs the retrieval and binds eligibility facts to its own result", () => {
  const nominated = [
    skill({ id: "backend.auth", requiredCapabilities: ["filesystem", "terminal"] }),
    skill({ id: "backend.high-risk", riskLevel: "high" }),
    skill({ id: "backend.missing-capability", requiredCapabilities: ["docker", "terminal"] }),
  ];
  const nominatedPrimarySkillIds = nominated.map(({ id }) => id);
  const input: RetrieveSkillCandidatesInput = {
    profile: profile(),
    skills: nominated,
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    nominatedSkillIds: nominatedPrimarySkillIds,
    nominatedPrimarySkillIds,
    nominatedRoles: new Map(nominated.map(({ id }) => [id, "primary" as const])),
    maxSelectedRisk: defaultRouterLimits.maxSelectedRisk,
  };
  const boundary = createRetrievalBoundary(input);

  assert.deepEqual(boundary.retrieval, retrieveSkillCandidates(input));
  assert.deepEqual(boundary.eligibilityFacts(nominatedPrimarySkillIds), [
    { skillId: "backend.auth", primaryRoleEligible: true },
    { skillId: "backend.high-risk", primaryRoleEligible: false, baseRejectionReason: "risk-blocked" },
    { skillId: "backend.missing-capability", primaryRoleEligible: false, baseRejectionReason: "required-capability-missing" },
  ]);
});

test("boundary facts are a pure per-set projection of the stored retrieval", () => {
  const boundary = createRetrievalBoundary({
    profile: profile(),
    skills: [
      skill({ id: "backend.eligible" }),
      skill({ id: "backend.high-risk", riskLevel: "high" }),
    ],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: [],
  });
  const snapshot = JSON.parse(JSON.stringify(boundary.retrieval)) as unknown;

  assert.deepEqual(boundary.eligibilityFacts(["backend.eligible", "backend.high-risk", "backend.unknown"]), [
    { skillId: "backend.eligible", primaryRoleEligible: true },
    { skillId: "backend.high-risk", primaryRoleEligible: false, baseRejectionReason: "risk-blocked" },
    { skillId: "backend.unknown", primaryRoleEligible: false, baseRejectionReason: "candidate-not-found" },
  ]);
  assert.deepEqual(boundary.eligibilityFacts(["backend.unknown", "backend.eligible"]), [
    { skillId: "backend.unknown", primaryRoleEligible: false, baseRejectionReason: "candidate-not-found" },
    { skillId: "backend.eligible", primaryRoleEligible: true },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(boundary.retrieval)) as unknown, snapshot);
});

test("test factory synthesizes the candidate feed result from hand-built candidates", () => {
  const primaryCandidate = candidate(skill({ id: "backend.primary" }));
  const companionCandidate = candidate(skill({ id: "backend.companion", roles: ["companion"] }));
  const boundary = createTestRetrievalBoundary({ candidates: [primaryCandidate, companionCandidate] });

  assert.deepEqual(boundary.retrieval, {
    candidates: [primaryCandidate, companionCandidate],
    primaryCandidates: [primaryCandidate],
    rejections: [],
  });
  assert.deepEqual(boundary.eligibilityFacts(["backend.primary", "backend.companion", "backend.unknown"]), [
    { skillId: "backend.primary", primaryRoleEligible: true },
    { skillId: "backend.companion", primaryRoleEligible: false, baseRejectionReason: "primary-role-ineligible" },
    { skillId: "backend.unknown", primaryRoleEligible: false, baseRejectionReason: "candidate-not-found" },
  ]);
});

test("factory retrieval output matches composition's internal retrieval for identical inputs", () => {
  const skills = [
    skill({ id: "backend.primary-a", requiredCapabilities: ["filesystem"] }),
    skill({ id: "backend.primary-b", roles: ["primary", "companion"], requiredCapabilities: ["filesystem", "terminal"] }),
    skill({ id: "backend.assistant", roles: ["companion"], requiredCapabilities: [] }),
  ];
  const shared = {
    profile: profile(),
    skills,
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    routingDate: "2026-08-12",
  };
  const retrievalInput: RetrieveSkillCandidatesInput = { ...shared, maxSelectedRisk: defaultRouterLimits.maxSelectedRisk };
  const composeInput: ComposeSkillSetInput = { ...shared, limits: { maxSelectedRisk: defaultRouterLimits.maxSelectedRisk } };
  const boundary = createRetrievalBoundary(retrievalInput);
  const internal = composeSkillSet(composeInput);
  const viaBoundary = composeSkillSet({ ...composeInput, boundary });

  assert.deepEqual(boundary.retrieval, retrieveSkillCandidates(retrievalInput));
  assert.equal(canonicalizeJson(viaBoundary), canonicalizeJson(internal));
  assert.equal(internal.status, "prepared");
  if (internal.status === "prepared" && viaBoundary.status === "prepared") {
    assert.deepEqual(viaBoundary.composed.selections, internal.composed.selections);
  }
});

test("factory parity holds for the proposal-driven strict retrieval input", () => {
  const base = skill({
    id: "backend.strict-primary",
    requiredCapabilities: ["filesystem", "terminal"],
    strictContract: "valid",
    installed: true,
    source: "installed",
    lockfileMatch: true,
    installedFileSetMatch: true,
    contractInputAccepted: true,
    contractMustRead: ["SKILL.md"],
  });
  const nominatedIds = [base.id];
  // The exact retrieval input the boundary factory derives for a proposal-driven
  // strict composition: strict off, defer disabled.
  const retrievalInput: RetrieveSkillCandidatesInput = {
    profile: profile(),
    skills: [base],
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    strict: false,
    deferRequiredCapabilities: false,
    installedSkillIds: nominatedIds,
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    nominatedSkillIds: nominatedIds,
    nominatedPrimarySkillIds: nominatedIds,
    nominatedRoles: new Map([[base.id, "primary" as const]]),
    maxSelectedRisk: defaultRouterLimits.maxSelectedRisk,
  };
  const resolvedNomination: ResolvedNomination = {
    requiredPrimarySkillId: base.id,
    nominationOrder: nominatedIds,
    primaryNominationOrder: nominatedIds,
    nominatedSkillIds: nominatedIds,
    nominatedPrimarySkillIds: nominatedIds,
    nominatedRoles: new Map([[base.id, "primary" as const]]),
  };
  const composeInput: ComposeSkillSetInput = {
    profile: profile(),
    skills: [base],
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    strict: true,
    deferRequiredCapabilities: false,
    installedSkillIds: nominatedIds,
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    resolvedNomination,
    limits: { maxSelectedRisk: defaultRouterLimits.maxSelectedRisk },
  };
  const boundary = createRetrievalBoundary(retrievalInput);
  const internal = composeSkillSet(composeInput);
  const viaBoundary = composeSkillSet({ ...composeInput, boundary });

  assert.deepEqual(boundary.retrieval, retrieveSkillCandidates(retrievalInput));
  assert.equal(canonicalizeJson(viaBoundary), canonicalizeJson(internal));
  assert.equal(internal.status, "prepared");
  if (internal.status === "prepared" && viaBoundary.status === "prepared") {
    assert.equal(viaBoundary.composed.primary.skill.id, base.id);
  }
});

test("composition consumes the supplied boundary over every other retrieval feed", () => {
  const base = skill({ id: "backend.base", requiredCapabilities: ["filesystem"] });
  const boundaryPrimary = skill({ id: "backend.boundary-primary" });
  const boundary = createTestRetrievalBoundary({ candidates: [candidate(boundaryPrimary)] });
  // The registry copy of the boundary primary is high-risk, so the internal
  // retrieval would reject it; the hand-built boundary carries a low-risk
  // eligible copy that composition must consume.
  const registrySkills = [base, { ...boundaryPrimary, riskLevel: "high" }];
  const competingResult = retrieveSkillCandidates({
    profile: profile(),
    skills: [skill({ id: "backend.other-primary" })],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    maxSelectedRisk: defaultRouterLimits.maxSelectedRisk,
  });
  const composed = composeSkillSet({
    profile: profile(),
    skills: registrySkills,
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    candidates: [candidate(skill({ id: "backend.candidates-primary" }))],
    retrievalResult: competingResult,
    boundary,
  });
  assert.equal(composed.status, "prepared");
  if (composed.status === "prepared") assert.equal(composed.composed.primary.skill.id, "backend.boundary-primary");
});

test("eligibility facts bind to the supplied boundary's own retrieval", () => {
  const base = skill({ id: "backend.base", requiredCapabilities: ["filesystem"] });
  const boundaryPrimary = skill({ id: "backend.explicit-primary" });
  const boundary = createTestRetrievalBoundary({ candidates: [candidate(boundaryPrimary)] });
  // The registry copy of the explicit primary is high-risk, so facts derived
  // from the internal retrieval would block the explicit choice; the boundary
  // carries an eligible copy, so the explicit choice must stand.
  const composed = composeSkillSet({
    profile: profile(),
    skills: [{ ...boundaryPrimary, riskLevel: "high" }, base],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
    boundary,
    resolvedNomination: {
      requiredPrimarySkillId: "backend.explicit-primary",
      nominationOrder: ["backend.explicit-primary"],
      primaryNominationOrder: ["backend.explicit-primary"],
      nominatedSkillIds: ["backend.explicit-primary"],
      nominatedPrimarySkillIds: ["backend.explicit-primary"],
      nominatedRoles: new Map([["backend.explicit-primary", "primary" as const]]),
    },
  });
  assert.equal(composed.status, "prepared");
  if (composed.status === "prepared") assert.equal(composed.composed.primary.skill.id, "backend.explicit-primary");
});

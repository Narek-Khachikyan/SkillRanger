import test from "node:test";
import assert from "node:assert/strict";
import { loadRouterFixturePacks, type RouterFixturePack } from "../src/router/fixtures.ts";
import {
  composeSkillSet,
  retrieveSkillCandidates,
  type RouterCandidate,
  type RouterSkillMetadata,
} from "../src/router/composer.ts";
import type { TaskProfile } from "../src/router/types.ts";
import { scoreFreshness, scoreSharedFeatures } from "../src/recommender/scoring.ts";

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

const backendInput = (packs: RouterFixturePack[]) => ({
  profile: profile(),
  skills: fixtureSkills(packs),
  selectedDomainIds: ["backend-api"],
  capabilities: ["filesystem", "terminal"],
});

test("retrieval enforces role, target, risk, audit, and required capability eligibility", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const result = retrieveSkillCandidates({
    profile: profile(),
    skills: [
      ...skills,
      { ...skills[0], id: "backend.high-risk", riskLevel: "high" },
      { ...skills[0], id: "backend.failed-audit", auditPassed: false },
      { ...skills[0], id: "backend.other-agent", supportedTargets: ["claude-code"] },
      { ...skills[0], id: "backend.needs-docker", requiredCapabilities: ["docker"] },
    ],
    selectedDomainIds: ["backend-api"],
    targetAgent: "codex",
    capabilities: ["filesystem", "terminal"],
  });

  assert.ok(result.candidates.some(({ skill }) => skill.id === "backend.auth-implementation"));
  assert.deepEqual(
    result.rejections.filter(({ skillId }) => skillId.startsWith("backend.")).map(({ reason }) => reason).sort(),
    ["audit-failed", "required-capability-missing", "risk-blocked", "target-incompatible"].sort(),
  );
});

test("strict retrieval is installed-only and requires valid strict contracts", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const result = retrieveSkillCandidates({
    profile: profile({ normalizedGoal: "implement contractless workflow" }),
    skills,
    selectedDomainIds: ["backend-api"],
    strict: true,
    installedSkillIds: ["backend.contractless"],
    capabilities: ["filesystem", "terminal"],
  });

  assert.equal(result.candidates.some(({ skill }) => skill.id === "backend.contractless"), false);
  assert.ok(result.rejections.some(({ skillId, reason }) => skillId === "backend.contractless" && reason === "strict-contract-v2"));
});

test("applicability signal demotes Tailwind without project evidence or explicit intent", () => {
  const skill: RouterSkillMetadata = {
    id: "frontend.tailwind-ui-polish",
    displayName: "Tailwind UI polish",
    version: "1.0.0",
    riskLevel: "low",
    domains: ["frontend"],
    roles: ["primary", "companion"],
    actions: ["implement"],
    artifactTypes: ["web-interface"],
    intentTags: [],
    technologyTags: ["tailwind"],
    qualityGoals: [],
    score: 0.9,
    applicabilitySignal: { collection: "styling", name: "tailwindcss", minConfidence: 0.5 },
  };
  const base = {
    profile: profile({ normalizedGoal: "implement web interface", artifactTypes: ["web-interface"] }),
    skills: [skill],
    selectedDomainIds: ["frontend"],
  };
  const withoutEvidence = retrieveSkillCandidates(base);
  assert.equal(withoutEvidence.candidates.length, 0);
  assert.deepEqual(withoutEvidence.rejections, [{ skillId: skill.id, reason: "environment-signal-unmet" }]);
  const explicit = retrieveSkillCandidates({ ...base, profile: { ...base.profile, normalizedGoal: "implement Tailwind web interface", technologies: ["tailwind"] } });
  assert.equal(explicit.candidates.length, 1);
  const withFingerprint = retrieveSkillCandidates({ ...base, fingerprint: { schemaVersion: "1.0", root: ".", styling: [{ name: "tailwindcss", confidence: 0.9, evidence: [] }], projectTypes: [], frameworks: [], languages: [], testing: [], infrastructure: [], dependencies: [], agentContext: { agentsMd: { present: false, paths: [] }, codexSkills: { present: false, paths: [] }, claudeSkills: { present: false, paths: [] } }, signals: [], tags: [], warnings: [] } });
  assert.equal(withFingerprint.candidates.length, 1);
});

test("composer closes dependencies and preserves one primary", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const input = backendInput(packs);
  const result = composeSkillSet({ ...input, primaryDomainId: "backend-api" });

  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") return;
  assert.equal(result.composed.primary.skill.id, "backend.auth-implementation");
  assert.equal(result.composed.all.filter(({ role }) => role === "primary").length, 1);
  assert.ok(result.composed.all.length <= 7);
  assert.deepEqual(result.composed.all.map(({ skill }) => skill.id), ["backend.auth-implementation"]);
});

test("composer reports dependency cycles and symmetric conflicts", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const input = backendInput(packs);
  const cycle = composeSkillSet({
    ...input,
    profile: profile({ normalizedGoal: "implement cyclic workflow", artifactTypes: ["api"] }),
    candidates: input.skills.filter((skill) => ["backend.cycle-a", "backend.cycle-b"].includes(skill.id)).map((skill) => ({
      skill,
      score: 0.9,
      eligibleRoles: [skill.roles?.includes("primary") ? "primary" as const : "companion" as const],
      reasons: [],
      missingCapabilities: [],
      missingOptionalCapabilities: [],
      verificationStatus: "not-required" as const,
    })),
  });
  assert.equal(cycle.status, "no_matching_skills");
  assert.ok(cycle.rejections.some(({ reason }) => reason === "dependency-cycle"));

  const conflict = composeSkillSet({
    ...input,
    profile: profile({ normalizedGoal: "implement conflicting workflow" }),
    candidates: input.skills.filter((skill) => ["backend.conflict-a", "backend.conflict-b"].includes(skill.id)).map((skill) => ({
      skill,
      score: 0.9,
      eligibleRoles: [skill.roles?.includes("primary") ? "primary" as const : "companion" as const],
      reasons: [],
      missingCapabilities: [],
      missingOptionalCapabilities: [],
      verificationStatus: "not-required" as const,
    })),
  });
  assert.equal(conflict.status, "no_matching_skills");
  assert.ok(conflict.rejections.some(({ reason }) => reason === "skill-conflict"));
});

test("composer selects verification for acceptance criteria and limits companions", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const input = backendInput(packs);
  const result = composeSkillSet({
    ...input,
    profile: profile({ acceptanceCriteria: ["tests-pass"] }),
    candidates: input.skills.filter((skill) => [
      "backend.auth-implementation",
      "qa.api-integration-testing",
      "security.auth-review",
    ].includes(skill.id)).map((skill) => ({
      skill,
      score: skill.id === "backend.auth-implementation" ? 0.9 : 0.8,
      eligibleRoles: [skill.roles?.includes("primary") ? "primary" as const : skill.roles?.includes("verification") ? "verification" as const : "companion" as const],
      reasons: [],
      missingCapabilities: [],
      missingOptionalCapabilities: [],
      verificationStatus: "ready" as const,
    })),
  });
  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") return;
  assert.ok(result.composed.verification.some(({ skill }) => skill.id === "qa.api-integration-testing"));
  assert.ok(result.composed.all.length <= 7);
});

test("composer returns budget overflow for a required oversized primary", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const input = backendInput(packs);
  const result = composeSkillSet({
    ...input,
    profile: profile({ normalizedGoal: "use oversized workflow" }),
    candidates: input.skills.filter((skill) => skill.id === "backend.oversized").map((skill) => ({
      skill,
      score: 0.9,
      eligibleRoles: ["primary" as const],
      reasons: [],
      missingCapabilities: [],
      missingOptionalCapabilities: [],
      verificationStatus: "not-required" as const,
    })),
  });
  assert.deepEqual(result.status, "context_budget_exceeded");
  if (result.status === "context_budget_exceeded") assert.deepEqual(result.blockingSkillIds, ["backend.oversized"]);
});

test("composer asks for decomposition when independent subtasks have no primary workflow", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const input = backendInput(packs);
  const result = composeSkillSet({
    ...input,
    profile: profile({
      subtasks: [
        { id: "database-migrate", normalizedGoal: "migrate database", actions: ["migrate"], artifactTypes: [], candidateDomainIds: ["database"] },
        { id: "mobile-design", normalizedGoal: "design mobile", actions: ["design"], artifactTypes: [], candidateDomainIds: ["mobile"] },
      ],
    }),
    candidates: [],
  });
  assert.equal(result.status, "decomposition_required");
  if (result.status === "decomposition_required") assert.equal(result.subtasks.length, 2);
});

test("retrieval rejects incomplete router metadata and scores declared environment signals", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const backend = skills.find(({ id }) => id === "backend.auth-implementation")!;
  const result = retrieveSkillCandidates({
    profile: profile({ technologies: ["nestjs"] }),
    skills: [{ ...backend, roles: undefined }, backend],
    selectedDomainIds: ["backend-api"],
    capabilities: ["filesystem", "terminal"],
    fingerprint: {
      schemaVersion: "1.0", root: "/project", projectTypes: [], languages: [],
      frameworks: [{ name: "nestjs", confidence: 1, evidence: [] }], styling: [], testing: [], infrastructure: [],
      dependencies: ["@nestjs/core", "passport"], agentContext: {
        agentsMd: { present: false, paths: [] }, codexSkills: { present: false, paths: [] }, claudeSkills: { present: false, paths: [] },
      }, signals: [], tags: [], warnings: [],
    },
  });
  assert.ok(result.rejections.some(({ reason }) => reason === "router-metadata-incomplete"));
  assert.ok(result.candidates.some(({ skill, reasons }) => skill.id === backend.id && reasons.includes(`environment-match:${backend.id}`)));
});

test("router retrieval uses the shared scorer with an injected routing date", () => {
  const skill: RouterSkillMetadata = {
    id: "backend.shared-score", displayName: "Shared Score", version: "1.0.0", riskLevel: "low", roles: ["primary"],
    domains: ["backend-api"], actions: ["implement"], artifactTypes: ["api"], intentTags: ["api"], technologyTags: [],
    qualityGoals: ["correctness"], requiredCapabilities: [], optionalCapabilities: [], dependencies: [], conflictsWith: [], supersedes: [], complements: [],
    qualityScore: 0.8, securityScore: 0.9, freshnessDate: "2026-01-01", compatibilityScore: 1,
  };
  const routingDate = "2026-07-19";
  const result = retrieveSkillCandidates({ profile: profile(), skills: [skill], selectedDomainIds: ["backend-api"], routingDate });
  assert.equal(result.candidates[0]?.score, scoreSharedFeatures({
    stackMatch: 1, userIntentMatch: 1, effectiveQualityScore: 0.8, securityScore: 0.9,
    freshnessScore: scoreFreshness(skill.freshnessDate, routingDate), compatibilityScore: 1,
    duplicatePenalty: 0, evaluationPenalty: 0, laneAdjustment: 0, skillAdjustment: 0,
  }));
});

test("router retrieval prefers broad task-signal coverage over one generic quality match", () => {
  const exact: RouterSkillMetadata = {
    id: "frontend.performance-review", displayName: "Performance Review", version: "1.0.0", riskLevel: "low", roles: ["primary"],
    domains: ["frontend"], actions: ["review"], artifactTypes: ["bundle"], intentTags: ["performance", "bundle-size"],
    technologyTags: [], qualityGoals: ["performance"], requiredCapabilities: [], optionalCapabilities: [], dependencies: [],
    conflictsWith: [], supersedes: [], complements: [], qualityScore: 0.8, securityScore: 0.9,
  };
  const generic: RouterSkillMetadata = {
    ...exact,
    id: "frontend.motion-design",
    displayName: "Motion Design",
    actions: ["design"],
    artifactTypes: ["animation"],
    intentTags: ["motion-design"],
    qualityScore: 0.95,
  };
  const result = retrieveSkillCandidates({
    profile: profile({
      normalizedGoal: "review bundle performance",
      actions: ["review"],
      artifactTypes: ["bundle"],
      qualityGoals: ["performance"],
      domains: [{ id: "frontend", confidence: 1, role: "primary", available: true, reasons: [], evidence: [] }],
      evidence: [{ source: "prompt", kind: "quality", id: "performance" }],
    }),
    skills: [generic, exact],
    selectedDomainIds: ["frontend"],
    primaryDomainId: "frontend",
    routingIntentTags: ["bundle-size", "performance"],
  });
  assert.equal(result.primaryCandidates[0]?.skill.id, exact.id);
});

test("strict composition reports semantic-best feasibility without substituting another workflow", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = fixtureSkills(packs);
  const result = composeSkillSet({
    profile: profile({ normalizedGoal: "fix authentication" }),
    skills,
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    capabilities: ["filesystem", "terminal"],
    strict: true,
    installedSkillIds: [],
  });
  assert.equal(result.status, "strict_requirements_unmet");
  if (result.status === "strict_requirements_unmet") {
    assert.ok(result.missing.some(({ skillId, requirement }) => skillId === "backend.auth-implementation" && requirement === "installed-skill"));
  }
});

test("proposal-driven strict retrieval treats missing routing capabilities as a hard veto", () => {
  const first: RouterSkillMetadata = {
    id: "backend.semantic-first", displayName: "Semantic First", version: "1.0.0", riskLevel: "low", roles: ["primary"],
    domains: ["backend-api"], actions: ["implement"], artifactTypes: ["api"], intentTags: ["api"], technologyTags: [], qualityGoals: ["correctness"],
    requiredCapabilities: ["docker"], routingRequiredCapabilities: ["docker"], optionalCapabilities: [], dependencies: [], conflictsWith: [], supersedes: [], complements: [], score: 0.99,
  };
  const second: RouterSkillMetadata = {
    ...first,
    id: "backend.semantic-second",
    displayName: "Semantic Second",
    requiredCapabilities: [],
    routingRequiredCapabilities: [],
    score: 0.8,
  };
  const result = composeSkillSet({
    profile: profile(),
    skills: [first, second],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    capabilities: ["filesystem"],
    strict: true,
    nominatedPrimarySkillIds: [first.id, second.id],
    nominationOrder: [first.id, second.id],
    primaryNominationOrder: [first.id, second.id],
  });
  assert.equal(result.status, "strict_requirements_unmet");
  assert.ok(result.rejections.some(({ skillId, reason }) => skillId === first.id && reason === "required-capability-missing"));
  if (result.status === "strict_requirements_unmet") assert.ok(result.missing.some(({ skillId }) => skillId === second.id));
});

test("proposal-driven composition advances past a primary that exceeds the context budget", () => {
  const first: RouterSkillMetadata = {
    id: "backend.oversized-first", displayName: "Oversized First", version: "1.0.0", riskLevel: "low", roles: ["primary"],
    domains: ["backend-api"], actions: ["implement"], artifactTypes: ["api"], intentTags: ["api"], technologyTags: [], qualityGoals: ["correctness"],
    requiredCapabilities: [], optionalCapabilities: [], dependencies: [], conflictsWith: [], supersedes: [], complements: [], instructionBytes: 200,
  };
  const second: RouterSkillMetadata = { ...first, id: "backend.fits-second", displayName: "Fits Second", instructionBytes: 40 };
  const candidate = (skill: RouterSkillMetadata, score: number): RouterCandidate => ({
    skill,
    score,
    eligibleRoles: ["primary"],
    reasons: [],
    missingCapabilities: [],
    missingOptionalCapabilities: [],
    verificationStatus: "not-required",
  });
  const result = composeSkillSet({
    profile: profile(),
    skills: [first, second],
    candidates: [candidate(first, 0.99), candidate(second, 0.8)],
    selectedDomainIds: ["backend-api"],
    primaryDomainId: "backend-api",
    nominatedPrimarySkillIds: [first.id, second.id],
    nominationOrder: [first.id, second.id],
    primaryNominationOrder: [first.id, second.id],
    limits: { maxInstructionBytes: 100 },
  });
  assert.equal(result.status, "prepared");
  if (result.status === "prepared") assert.equal(result.composed.primary.skill.id, second.id);
  assert.ok(result.rejections.some(({ skillId, reason }) => skillId === first.id && reason === "context-budget-exceeded"));
});

test("composer keeps compatible subtasks together when one primary covers all of them", async () => {
  const primarySkill: RouterSkillMetadata = {
    id: "backend.general", displayName: "Backend General", version: "1.0.0", riskLevel: "low", roles: ["primary"],
    domains: ["backend-api"], actions: ["implement", "test"], artifactTypes: ["api", "test-suite"], intentTags: ["api"],
    technologyTags: [], qualityGoals: ["correctness"], requiredCapabilities: [], optionalCapabilities: [], dependencies: [], conflictsWith: [], supersedes: [], complements: [], instructionBytes: 100,
  };
  const result = composeSkillSet({
    profile: profile({ subtasks: [
      { id: "api-implement", normalizedGoal: "implement api", actions: ["implement"], artifactTypes: ["api"], candidateDomainIds: ["backend-api"] },
      { id: "api-test", normalizedGoal: "test api", actions: ["test"], artifactTypes: ["test-suite"], candidateDomainIds: ["backend-api"] },
    ] }),
    skills: [primarySkill], selectedDomainIds: ["backend-api"], capabilities: [],
  });
  assert.equal(result.status, "prepared");
});

test("retrieval preserves every declared eligible role and selection assigns one role once", () => {
  const skill: RouterSkillMetadata = {
    id: "backend.multi-role", displayName: "Multi Role", version: "1.0.0", riskLevel: "low",
    roles: ["primary", "companion", "verification"], domains: ["backend-api"], actions: ["implement"],
    artifactTypes: ["api"], intentTags: ["api"], technologyTags: [], qualityGoals: ["correctness"],
    requiredCapabilities: [], optionalCapabilities: [], dependencies: [], conflictsWith: [], supersedes: [], complements: [], score: 0.9,
  };
  const retrieved = retrieveSkillCandidates({ profile: profile(), skills: [skill], selectedDomainIds: ["backend-api"] });
  assert.deepEqual(retrieved.candidates[0]?.eligibleRoles, ["primary", "companion", "verification"]);

  const composed = composeSkillSet({ profile: profile(), skills: [skill], selectedDomainIds: ["backend-api"] });
  assert.equal(composed.status, "prepared");
  if (composed.status !== "prepared") return;
  assert.deepEqual(composed.composed.all.map(({ skill: selected, role }) => ({ id: selected.id, role })), [
    { id: skill.id, role: "primary" },
  ]);
});

test("composer preserves nominated roles when it receives pre-retrieved candidates", () => {
  const primary = {
    id: "backend.primary-choice",
    displayName: "Primary Choice",
    version: "1.0.0",
    riskLevel: "low" as const,
    roles: ["primary", "companion"] as const,
    domains: ["backend-api"],
    actions: ["implement"],
    artifactTypes: ["api"],
    intentTags: ["api"],
    technologyTags: [],
    qualityGoals: ["correctness"],
    requiredCapabilities: [],
    optionalCapabilities: [],
    dependencies: [],
    conflictsWith: [],
    supersedes: [],
    complements: [],
    score: 0.99,
  } satisfies RouterSkillMetadata;
  const fallback = { ...primary, id: "backend.primary-fallback", displayName: "Primary Fallback", score: 0.5, roles: ["primary"] as const } satisfies RouterSkillMetadata;
  const candidate = (skill: RouterSkillMetadata): RouterCandidate => ({
    skill,
    score: skill.score!,
    eligibleRoles: [...skill.roles!] as RouterCandidate["eligibleRoles"],
    reasons: [],
    missingCapabilities: [],
    missingOptionalCapabilities: [],
    verificationStatus: "not-required",
  });

  const result = composeSkillSet({
    profile: profile(),
    skills: [primary, fallback],
    candidates: [candidate(primary), candidate(fallback)],
    selectedDomainIds: ["backend-api"],
    nominationOrder: [primary.id, fallback.id],
    nominatedRoles: new Map([[primary.id, "companion" as const], [fallback.id, "primary" as const]]),
  });

  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") return;
  assert.equal(result.composed.primary.skill.id, fallback.id);
  assert.ok(result.composed.companions.some(({ skill }) => skill.id === primary.id));
});

test("composer reports a hard-vetoed nominated companion instead of dropping it silently", () => {
  const primary: RouterSkillMetadata = {
    id: "backend.primary-with-conflict", displayName: "Primary", version: "1.0.0", riskLevel: "low", roles: ["primary"],
    domains: ["backend-api"], actions: ["implement"], artifactTypes: ["api"], intentTags: ["api"], technologyTags: [],
    qualityGoals: ["correctness"], requiredCapabilities: [], optionalCapabilities: [], dependencies: [], conflictsWith: ["backend.nominated-companion"],
    supersedes: [], complements: [], score: 0.9,
  };
  const companion: RouterSkillMetadata = {
    id: "backend.nominated-companion", displayName: "Companion", version: "1.0.0", riskLevel: "low", roles: ["companion"],
    domains: ["backend-api"], actions: ["implement"], artifactTypes: ["api"], intentTags: ["api"], technologyTags: [],
    qualityGoals: [], requiredCapabilities: [], optionalCapabilities: [], dependencies: [], conflictsWith: [], supersedes: [], complements: [], score: 0.8,
  };
  const candidate = (skill: RouterSkillMetadata): RouterCandidate => ({
    skill,
    score: skill.score!,
    eligibleRoles: [...skill.roles!],
    reasons: [],
    missingCapabilities: [],
    missingOptionalCapabilities: [],
    verificationStatus: "not-required",
  });

  const result = composeSkillSet({
    profile: profile(),
    skills: [primary, companion],
    candidates: [candidate(primary), candidate(companion)],
    selectedDomainIds: ["backend-api"],
    nominationOrder: [primary.id, companion.id],
    nominatedRoles: new Map([[primary.id, "primary" as const], [companion.id, "companion" as const]]),
  });

  assert.equal(result.status, "prepared");
  assert.ok(result.rejections.some(({ skillId, reason }) => skillId === companion.id && reason === "skill-conflict"));
});

test("composer reports when supersession removes a nominated companion", () => {
  const primary: RouterSkillMetadata = {
    id: "backend.superseding-primary", displayName: "Primary", version: "1.0.0", riskLevel: "low", roles: ["primary"],
    domains: ["backend-api"], actions: ["implement"], artifactTypes: ["api"], intentTags: ["api"], technologyTags: [],
    qualityGoals: ["correctness"], requiredCapabilities: [], optionalCapabilities: [], dependencies: [], conflictsWith: [],
    supersedes: ["backend.superseded-companion"], complements: [], score: 0.9,
  };
  const companion: RouterSkillMetadata = {
    id: "backend.superseded-companion", displayName: "Companion", version: "1.0.0", riskLevel: "low", roles: ["companion"],
    domains: ["backend-api"], actions: ["implement"], artifactTypes: ["api"], intentTags: ["api"], technologyTags: [],
    qualityGoals: [], requiredCapabilities: [], optionalCapabilities: [], dependencies: [], conflictsWith: [], supersedes: [], complements: [], score: 0.8,
  };
  const candidate = (skill: RouterSkillMetadata): RouterCandidate => ({
    skill,
    score: skill.score!,
    eligibleRoles: [...skill.roles!],
    reasons: [],
    missingCapabilities: [],
    missingOptionalCapabilities: [],
    verificationStatus: "not-required",
  });

  const result = composeSkillSet({
    profile: profile(),
    skills: [primary, companion],
    candidates: [candidate(primary), candidate(companion)],
    selectedDomainIds: ["backend-api"],
    nominationOrder: [primary.id, companion.id],
    nominatedRoles: new Map([[primary.id, "primary" as const], [companion.id, "companion" as const]]),
  });

  assert.equal(result.status, "prepared");
  assert.ok(result.rejections.some(({ skillId, reason }) => skillId === companion.id && reason === "superseded"));
});

test("composer reports a deterministic fallback budget failure after nominations are exhausted", () => {
  const nominated: RouterSkillMetadata = {
    id: "backend.nominated-oversized", displayName: "Nominated", version: "1.0.0", riskLevel: "low", roles: ["primary"],
    domains: ["backend-api"], actions: ["implement"], artifactTypes: ["api"], intentTags: ["api"], technologyTags: [],
    qualityGoals: ["correctness"], requiredCapabilities: [], optionalCapabilities: [], dependencies: [], conflictsWith: [],
    supersedes: [], complements: [], instructionBytes: 200,
  };
  const fallback: RouterSkillMetadata = { ...nominated, id: "backend.fallback-oversized", displayName: "Fallback", instructionBytes: 150 };
  const candidate = (skill: RouterSkillMetadata, score: number): RouterCandidate => ({
    skill,
    score,
    eligibleRoles: ["primary"],
    reasons: [],
    missingCapabilities: [],
    missingOptionalCapabilities: [],
    verificationStatus: "not-required",
  });

  const result = composeSkillSet({
    profile: profile(),
    skills: [nominated, fallback],
    candidates: [candidate(nominated, 0.99), candidate(fallback, 0.9)],
    selectedDomainIds: ["backend-api"],
    nominatedPrimarySkillIds: [nominated.id],
    nominationOrder: [nominated.id],
    limits: { maxInstructionBytes: 100 },
  });

  assert.equal(result.status, "context_budget_exceeded");
  if (result.status === "context_budget_exceeded") assert.deepEqual(result.blockingSkillIds, [fallback.id]);
});

test("composer reports when a nominated companion is removed by the total-skill budget", () => {
  const primary: RouterSkillMetadata = {
    id: "backend.budget-primary", displayName: "Primary", version: "1.0.0", riskLevel: "low", roles: ["primary"],
    domains: ["backend-api"], actions: ["implement"], artifactTypes: ["api"], intentTags: ["api"], technologyTags: [],
    qualityGoals: ["correctness"], requiredCapabilities: [], optionalCapabilities: [], dependencies: [], conflictsWith: [],
    supersedes: [], complements: [], instructionBytes: 10,
  };
  const companion: RouterSkillMetadata = {
    ...primary,
    id: "backend.budget-companion",
    displayName: "Companion",
    roles: ["companion"],
    instructionBytes: 10,
  };
  const candidate = (skill: RouterSkillMetadata): RouterCandidate => ({
    skill,
    score: 0.9,
    eligibleRoles: [...skill.roles!],
    reasons: [],
    missingCapabilities: [],
    missingOptionalCapabilities: [],
    verificationStatus: "not-required",
  });

  const result = composeSkillSet({
    profile: profile(),
    skills: [primary, companion],
    candidates: [candidate(primary), candidate(companion)],
    selectedDomainIds: ["backend-api"],
    nominationOrder: [primary.id, companion.id],
    nominatedRoles: new Map([[primary.id, "primary" as const], [companion.id, "companion" as const]]),
    limits: { maxTotalSelectedSkills: 1 },
  });

  assert.equal(result.status, "prepared");
  assert.ok(result.rejections.some(({ skillId, reason }) => skillId === companion.id && reason === "skill-limit"));
});

test("a primary-only dependency cannot become a second primary", () => {
  const dependency: RouterSkillMetadata = {
    id: "backend.primary-dependency", displayName: "Primary Dependency", version: "1.0.0", riskLevel: "low",
    roles: ["primary"], domains: ["backend-api"], actions: ["implement"], artifactTypes: ["api"], intentTags: ["api"],
    technologyTags: [], qualityGoals: [], requiredCapabilities: [], optionalCapabilities: [], dependencies: [], conflictsWith: [], supersedes: [], complements: [], score: 0.8,
  };
  const root: RouterSkillMetadata = { ...dependency, id: "backend.root", displayName: "Root", dependencies: [dependency.id], score: 0.9 };
  const candidate = (skill: RouterSkillMetadata) => ({
    skill, score: skill.score!, eligibleRoles: ["primary" as const], reasons: [], missingCapabilities: [], missingOptionalCapabilities: [], verificationStatus: "not-required" as const,
  });
  const result = composeSkillSet({
    profile: profile(), skills: [root, dependency], selectedDomainIds: ["backend-api"], candidates: [candidate(root), candidate(dependency)],
  });
  assert.ok(result.rejections.some(({ skillId, reason }) => skillId === root.id && reason === "dependency-role-unassignable"));
  if (result.status === "prepared") assert.equal(result.composed.all.filter(({ role }) => role === "primary").length, 1);
});

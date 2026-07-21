import test from "node:test";
import assert from "node:assert/strict";
import { actionCompatibilityScore, scoreActionCompatibility } from "../src/router/action-compatibility.ts";
import { composeSkillSet, retrieveSkillCandidates, type RouterCandidate, type RouterSkillMetadata } from "../src/router/composer.ts";
import { actionRequirementCovered, calculateRequirementCoverage } from "../src/router/coverage.ts";
import { loadLocalRegistry } from "../src/registry/index.ts";
import type { CanonicalRequirement } from "../src/router/requirements.ts";
import type { TaskProfile } from "../src/router/types.ts";

const profile = (overrides: Partial<TaskProfile> = {}): TaskProfile => ({
  schemaVersion: "task-profile/1.0", normalizedGoal: "create page", locale: "en", actions: ["create"],
  artifactTypes: ["page"], technologies: [], constraints: [], qualityGoals: [], acceptanceCriteria: [],
  domains: [{ id: "frontend", confidence: 1, role: "primary", available: true, reasons: [], evidence: [] }], subtasks: [], evidence: [],
  ...overrides,
});

const requirement = (
  kind: CanonicalRequirement["kind"],
  id: string,
  requirementClass: CanonicalRequirement["requirementClass"] = "explicit",
  baseWeight = kind === "intent" ? 3 : kind === "artifact" ? 2 : kind === "quality" ? 1.5 : 1,
): CanonicalRequirement => ({ kind, id, confidence: 1, baseWeight, sources: requirementClass === "explicit" ? ["prompt-exact"] : requirementClass === "inferred" ? ["prompt-inferred"] : ["fingerprint"], requirementClass });

const skill = (id: string, overrides: Partial<RouterSkillMetadata> = {}): RouterSkillMetadata => ({
  id, displayName: id, version: "1.0.0", riskLevel: "low", roles: ["primary"], domains: ["frontend"], actions: ["implement"],
  artifactTypes: [], intentTags: [], technologyTags: [], qualityGoals: [], qualityScore: 0.5, securityScore: 0.5,
  dependencies: [], conflictsWith: [], supersedes: [], complements: [], score: 0.8,
  ...overrides,
});

const candidate = (metadata: RouterSkillMetadata, eligibleRoles = metadata.roles ?? []): RouterCandidate => ({
  skill: metadata, score: metadata.score ?? 0.8, eligibleRoles, reasons: [], missingCapabilities: [], missingOptionalCapabilities: [], verificationStatus: "not-required",
});

test("action compatibility follows the directional matrix and averages per requested action", () => {
  assert.equal(actionCompatibilityScore("create", "implement"), 0.85);
  assert.equal(actionCompatibilityScore("implement", "create"), 0.7);
  assert.equal(actionCompatibilityScore("create", "design"), 0.65);
  assert.equal(actionCompatibilityScore("fix", "implement"), 0);
  assert.equal(scoreActionCompatibility({ requestedActions: [], skillActions: ["implement"] }), 0);
  assert.ok(Math.abs(scoreActionCompatibility({ requestedActions: ["create", "modify"], skillActions: ["implement"] }) - 0.775) < Number.EPSILON);
});

test("design helps create ranking without covering it, while implement covers create", () => {
  assert.equal(actionRequirementCovered("create", ["design"]), false);
  assert.equal(actionRequirementCovered("create", ["implement"]), true);
  const actionSkill = (id: string, actions: RouterSkillMetadata["actions"]): RouterSkillMetadata => ({
    id, displayName: id, version: "1.0.0", riskLevel: "low", roles: ["primary"], domains: ["frontend"], actions,
    artifactTypes: [], intentTags: [], technologyTags: [], qualityGoals: [], qualityScore: 0.5, securityScore: 0.5,
  });
  const result = retrieveSkillCandidates({
    profile: profile({ artifactTypes: [] }),
    skills: [actionSkill("frontend.none", []), actionSkill("frontend.design", ["design"])],
    selectedDomainIds: ["frontend"],
    primaryDomainId: "frontend",
    primaryThreshold: 0,
  });
  assert.equal(result.primaryCandidates[0]?.skill.id, "frontend.design");
});

test("structured coverage maps every requirement kind and reports weighted reasons", () => {
  const requirements = [
    requirement("action", "create"), requirement("artifact", "page"), requirement("intent", "motion-design"),
    requirement("technology", "react"), requirement("quality", "performance"),
  ];
  const coverage = calculateRequirementCoverage({
    requirements,
    skill: skill("frontend.coverage", {
      actions: ["implement"], artifactTypes: ["page"], intentTags: ["motion-design"], technologyTags: ["react"], qualityGoals: ["performance"],
    }),
  });
  assert.equal(coverage.ratio, 1);
  assert.equal(coverage.coveredWeight, 8.5);
  assert.deepEqual(coverage.reasonCodes, requirements
    .map(({ kind, id }) => `coverage:${kind}:${id}`)
    .sort());
  assert.throws(() => calculateRequirementCoverage({ requirements: [{ ...requirements[0], confidence: Number.NaN }], skill: skill("frontend.invalid") }), /requirement-weight-invalid/);
});

test("primary equal-score ordering uses weighted coverage before quality and skill id", () => {
  const covered = skill("frontend.z-covered", { artifactTypes: ["page"], qualityScore: 0.1 });
  const uncovered = skill("frontend.a-uncovered", { qualityScore: 1 });
  const result = retrieveSkillCandidates({
    profile: profile(), requirements: [requirement("artifact", "page")], skills: [uncovered, covered],
    selectedDomainIds: ["frontend"], primaryDomainId: "frontend",
  });
  assert.equal(result.primaryCandidates[0]?.skill.id, covered.id);
});

test("inferred and context requirements create neither companions nor uncovered warnings", () => {
  const primary = skill("frontend.primary");
  const companion = skill("frontend.motion", { roles: ["companion"], intentTags: ["motion-design"], complements: [primary.id] });
  const result = composeSkillSet({
    profile: profile(), requirements: [requirement("intent", "motion-design", "inferred"), requirement("quality", "performance", "context")],
    skills: [primary, companion], selectedDomainIds: ["frontend"], primaryDomainId: "frontend",
    candidates: [candidate(primary), candidate(companion)],
  });
  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") return;
  assert.deepEqual(result.composed.companions, []);
  assert.deepEqual(result.composed.warnings, []);
});

test("an action-incompatible review skill cannot cover an explicit create request", () => {
  const primary = skill("frontend.primary");
  const review = skill("frontend.review", { roles: ["companion"], actions: ["review"], qualityGoals: ["performance"] });
  const result = composeSkillSet({
    profile: profile(), requirements: [requirement("action", "create"), requirement("quality", "performance")],
    skills: [primary, review], selectedDomainIds: ["frontend"], primaryDomainId: "frontend",
    candidates: [candidate(primary), candidate(review)],
  });
  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") return;
  assert.deepEqual(result.composed.companions, []);
  assert.ok(result.composed.warnings.includes("uncovered-requirement:quality:performance"));
});

test("zero explicit weight disables coverage companions", () => {
  const primary = skill("frontend.primary");
  const companion = skill("frontend.companion", { roles: ["companion"], intentTags: ["motion-design"] });
  const result = composeSkillSet({
    profile: profile(), requirements: [requirement("intent", "motion-design", "explicit", 0)],
    skills: [primary, companion], selectedDomainIds: ["frontend"], primaryDomainId: "frontend",
    candidates: [candidate(primary), candidate(companion)],
  });
  assert.equal(result.status, "prepared");
  if (result.status === "prepared") assert.deepEqual(result.composed.companions, []);
});

test("coverage companions recompute marginal gain deterministically on every iteration", () => {
  const primary = skill("frontend.primary", { complements: ["frontend.a", "frontend.b"] });
  const first = skill("frontend.a", { roles: ["companion"], intentTags: ["a", "b"] });
  const second = skill("frontend.b", { roles: ["companion"], intentTags: ["a", "c"] });
  const result = composeSkillSet({
    profile: profile(), requirements: [requirement("intent", "a"), requirement("intent", "b"), requirement("intent", "c")],
    skills: [primary, first, second], selectedDomainIds: ["frontend"], primaryDomainId: "frontend",
    candidates: [candidate(primary), candidate(second), candidate(first)], limits: { maxTaskCompanions: 2 },
  });
  assert.equal(result.status, "prepared");
  if (result.status !== "prepared") return;
  assert.deepEqual(result.composed.companions.map(({ skill: selected }) => selected.id), [first.id, second.id]);
  assert.deepEqual(result.composed.companions[0].reasons, ["coverage-add:a", "coverage-add:b"]);
  assert.deepEqual(result.composed.companions[1].reasons, ["coverage-add:c"]);
});

test("complements changes companion score as a bonus, not an allowlist", () => {
  const primary = skill("frontend.primary", { complements: ["frontend.complement"] });
  const complement = skill("frontend.complement", { roles: ["companion"], intentTags: ["motion-design"], score: 0.7 });
  const ordinary = skill("frontend.ordinary", { roles: ["companion"], intentTags: ["responsive-design"], score: 0.8 });
  const result = composeSkillSet({
    profile: profile(), requirements: [requirement("intent", "motion-design"), requirement("intent", "responsive-design")],
    skills: [primary, complement, ordinary], selectedDomainIds: ["frontend"], primaryDomainId: "frontend",
    candidates: [candidate(primary), candidate(ordinary), candidate(complement)], limits: { maxTaskCompanions: 2 },
  });
  assert.equal(result.status, "prepared");
  if (result.status === "prepared") assert.deepEqual(result.composed.companions.map(({ skill: selected }) => selected.id), [complement.id, ordinary.id]);
});

test("bundled visual design and motion skills truthfully cover create through implement", async () => {
  const skills = await loadLocalRegistry("registry");
  for (const id of ["frontend.visual-design-polish", "frontend.motion-design"]) {
    const skill = skills.find(({ manifest }) => manifest.id === id);
    assert.ok(skill?.manifest.routing?.actions.includes("implement"), id);
    assert.equal(scoreActionCompatibility({ requestedActions: ["create"], skillActions: skill!.manifest.routing!.actions! }), 0.85, id);
  }
});

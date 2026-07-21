import test from "node:test";
import assert from "node:assert/strict";
import { actionCompatibilityScore, scoreActionCompatibility } from "../src/router/action-compatibility.ts";
import { retrieveSkillCandidates, type RouterSkillMetadata } from "../src/router/composer.ts";
import { actionRequirementCovered } from "../src/router/coverage.ts";
import { loadLocalRegistry } from "../src/registry/index.ts";
import type { TaskProfile } from "../src/router/types.ts";

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
  const profile: TaskProfile = {
    schemaVersion: "task-profile/1.0", normalizedGoal: "create page", locale: "en", actions: ["create"],
    artifactTypes: [], technologies: [], constraints: [], qualityGoals: [], acceptanceCriteria: [],
    domains: [{ id: "frontend", confidence: 1, role: "primary", available: true, reasons: [], evidence: [] }], subtasks: [], evidence: [],
  };
  const skill = (id: string, actions: RouterSkillMetadata["actions"]): RouterSkillMetadata => ({
    id, displayName: id, version: "1.0.0", riskLevel: "low", roles: ["primary"], domains: ["frontend"], actions,
    artifactTypes: [], intentTags: [], technologyTags: [], qualityGoals: [], qualityScore: 0.5, securityScore: 0.5,
  });
  const result = retrieveSkillCandidates({
    profile,
    skills: [skill("frontend.none", []), skill("frontend.design", ["design"])],
    selectedDomainIds: ["frontend"],
    primaryDomainId: "frontend",
    primaryThreshold: 0,
  });
  assert.equal(result.primaryCandidates[0]?.skill.id, "frontend.design");
});

test("bundled visual design and motion skills truthfully cover create through implement", async () => {
  const skills = await loadLocalRegistry("registry");
  for (const id of ["frontend.visual-design-polish", "frontend.motion-design"]) {
    const skill = skills.find(({ manifest }) => manifest.id === id);
    assert.ok(skill?.manifest.routing?.actions.includes("implement"), id);
    assert.equal(scoreActionCompatibility({ requestedActions: ["create"], skillActions: skill!.manifest.routing!.actions! }), 0.85, id);
  }
});

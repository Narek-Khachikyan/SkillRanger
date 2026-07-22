import test from "node:test";
import assert from "node:assert/strict";
import { phaseForFinding, planFrontendPhases } from "../src/domains/frontend/phases.ts";

test("plans the full material frontend ownership chain", () => {
  const plan = planFrontendPhases({ intent: "Reimagine this Tailwind SaaS workspace with motion and verify accessibility", recommendedSkillIds: ["frontend.visual-design-polish", "frontend.ux-critique", "frontend.design-system", "frontend.tailwind-ui-polish", "frontend.motion-design", "frontend.accessibility-review", "frontend.audit"] });
  assert.deepEqual(plan.entries.map(({ phase, ownerSkillId }) => [phase, ownerSkillId]), [["visual-direction","frontend.visual-design-polish"],["ux","frontend.ux-critique"],["design-system","frontend.design-system"],["implementation","frontend.tailwind-ui-polish"],["motion","frontend.motion-design"],["accessibility","frontend.accessibility-review"],["final-audit","frontend.audit"]]);
  assert.ok(plan.entries.every(({status})=>status==="required"));
});

test("records explicit skips and routes repairs to one owner", () => {
  const plan=planFrontendPhases({intent:"Repair the invisible keyboard focus",recommendedSkillIds:["frontend.accessibility-review","frontend.audit"],repairFindingCodes:["invisible-focus"]});
  assert.equal(phaseForFinding("invisible-focus"),"accessibility");assert.equal(plan.repairEntryPhase,"accessibility");assert.equal(plan.rejoinsAt,"evidence-capture");assert.ok(plan.entries.filter(({status})=>status==="skipped").every(({skipReason})=>Boolean(skipReason)));
});

test("required phase owners are subset of selected skills invariant", () => {
  const recommendedSkillIds = ["frontend.visual-design-polish", "frontend.motion-design"];
  const plan = planFrontendPhases({
    intent: "Create a page with visual design and motion",
    recommendedSkillIds,
    primarySkillId: "frontend.visual-design-polish",
  });
  const selectedSet = new Set(recommendedSkillIds);
  const requiredEntries = plan.entries.filter((entry) => entry.status === "required");

  for (const entry of requiredEntries) {
    assert.ok(
      selectedSet.has(entry.ownerSkillId),
      `Required phase ${entry.phase} owner ${entry.ownerSkillId} must be in selected skills`,
    );
  }
});

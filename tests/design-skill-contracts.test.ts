import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const readSkill = (name: string) =>
  readFile(path.resolve("registry/skills", `frontend.${name}`, "SKILL.md"), "utf8");

test("visual skills declare a verification outcome when browser evidence is unavailable", async () => {
  for (const name of [
    "visual-design-polish",
    "design-to-code",
    "tailwind-ui-polish",
    "interaction-polish",
  ]) {
    assert.match(await readSkill(name), /## Verification Outcome/);
  }
});

test("design skills carry the anti-slop decision contracts", async () => {
  assert.match(await readSkill("visual-design-polish"), /## Scope Triage/);
  assert.match(await readSkill("visual-design-polish"), /## Evidence Ledger/);
  assert.match(await readSkill("design-to-code"), /## Reference Intake/);
  assert.match(await readSkill("design-system"), /## Systemization Gate/);
  assert.match(await readSkill("tailwind-ui-polish"), /## Project Archetype/);
  assert.match(await readSkill("ux-critique"), /## Evidence Ledger/);
});

test("motion skills declare a verification outcome", async () => {
  for (const name of ["motion-design", "motion-audit"]) {
    assert.match(await readSkill(name), /## Verification Outcome/);
  }
});

test("design skills carry positive direction rules beyond anti-slop keywords", async () => {
  const entries = await readdir(path.resolve("registry/skills"), {
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name.replace("frontend.", "");
    const text = await readSkill(name);
    const hasAntiSlop = /\b(anti.slop|generic|avoid|reject|do not|must not)\b/i.test(text);
    const hasPositiveDirection = /\b(prefer|use|choose|start from|keep|preserve)\b/i.test(text);
    if (hasAntiSlop) {
      assert.ok(
        hasPositiveDirection,
        `${name}: anti-slop gate without positive direction (must also guide what TO do)`,
      );
    }
  }
});

test("design skills encode product-specific genericity safeguards", async () => {
  const text = await readSkill("visual-design-polish");
  assert.match(text, /product\S*\s+(subject|audience|domain)/i);
  assert.match(text, /\bdesign\s+(variance|tension|constraints)\b/i);
  assert.ok(/## Design Constraints/.test(text) || /## Decision Rules/.test(text));
});

test("design-to-code has reference ethics and positive translation rules", async () => {
  const text = await readSkill("design-to-code");
  assert.match(text, /## Ethical Reference Handling/);
  assert.match(text, /## Decision Rules/);
  assert.match(text, /\bpreserve\b/i);
  assert.match(text, /\breusable attributes?\b/i);
});

test("motion design carries positive choreography rules, not only anti-slop", async () => {
  const text = await readSkill("motion-design");
  assert.match(text, /## Motion Direction And Choreography/);
  assert.match(text, /\bproduct-specific\s+rhythm\b/i);
  assert.match(text, /\bsemantic\s+motion\b/i);
});

test("design-system carries positive extraction rules, not only anti-drift", async () => {
  const text = await readSkill("design-system");
  assert.match(text, /## Token Architecture/);
  assert.match(text, /## Distinctiveness Without Drift/);
  assert.match(text, /\bpreserve\s+(distinctive|product)/i);
});

test("ux-critique carries positive flow-first gate, not only anti-slop checks", async () => {
  const text = await readSkill("ux-critique");
  assert.match(text, /## Flow First Gate/);
  assert.match(text, /## UX Copy Rules/);
});

test("constrained skill profiles forbid arbitrary JSX before structured direction", async () => {
  for (const file of [
    "registry/skills/frontend.visual-design-polish/workflow.json",
    "registry/skills/frontend.tailwind-ui-polish/workflow.json",
  ]) {
    const workflow = JSON.parse(await readFile(file, "utf8"));
    assert.ok(workflow.profileInstructions.constrained.some((line: string) => line.includes("structured direction")));
    assert.ok(workflow.profileInstructions.constrained.some((line: string) => line.includes("verified patterns")));
    assert.ok(workflow.profileInstructions.constrained.some((line: string) => line.includes("mandatory corrective pass")));
  }
});

test("skill workflows enforce policy, bounded repair, and fresh viewport rechecks", async () => {
  for (const file of [
    "registry/skills/frontend.visual-design-polish/workflow.json",
    "registry/skills/frontend.tailwind-ui-polish/workflow.json",
  ]) {
    const workflow = JSON.parse(await readFile(file, "utf8"));
    const ids: string[] = workflow.steps;
    const implementationStep = file.includes("tailwind-ui-polish") ? "implement-bounded-fix" : "implement";
    const before = (left: string, right: string) => {
      assert.notEqual(ids.indexOf(left), -1, `${file}: missing ${left}`);
      assert.notEqual(ids.indexOf(right), -1, `${file}: missing ${right}`);
      assert.ok(ids.indexOf(left) < ids.indexOf(right), `${file}: ${left} must precede ${right}`);
    };

    before("resolve-execution-policy", "define-structured-direction");
    before("define-structured-direction", implementationStep);
    before("independent-critique", "bounded-repair");
    before("bounded-repair", "capture-recheck-evidence-390");
    before("capture-recheck-evidence-390", "capture-recheck-evidence-768");
    before("capture-recheck-evidence-768", "capture-recheck-evidence-1440");
    before("capture-recheck-evidence-1440", "final-verify");
    before("final-verify", "final-report");
  }
});

test("repair-loop documentation requires equal-or-higher-severity regression checks", async () => {
  const repairLoop = await readFile("docs/repair-loop.md", "utf8");
  assert.match(repairLoop, /equal-or-higher-severity regression/i);
  assert.doesNotMatch(repairLoop, /new critical or high regression/i);
});

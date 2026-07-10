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

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

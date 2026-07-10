import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import {
  validateSkillContent,
  validateContentContracts,
  validateLaneAwareContracts,
  validateOversizedSkill,
  validateSkillReferences,
  extractMarkdownLinks,
} from "../src/registry/validation.ts";

const validMinimal = `---
name: test-skill
description: Test skill for contract validation.
---

# Test Skill

Use this skill when testing content contracts. Do not use it for production.

## Workflow

1. Do the thing.

## Validation

Check the thing works.

## Output Contract

Return the result.

## References

- [official docs](https://example.com/docs)
`;

test("extractMarkdownLinks parses inline and reference links", () => {
  const text = [
    "[text](path/to/file.md)",
    "![alt](img.png)",
    "[ref]: references/doc.md",
    "[anchor](#section)",
    "[external](https://example.com)",
  ].join("\n");
  const links = extractMarkdownLinks(text);
  assert.equal(links.length, 5);
  assert.deepEqual(links[0], { path: "path/to/file.md", lineNumber: 1 });
  assert.deepEqual(links[1], { path: "img.png", lineNumber: 2 });
  assert.deepEqual(links[2], { path: "references/doc.md", lineNumber: 3 });
  assert.deepEqual(links[3], { path: "#section", lineNumber: 4 });
  assert.deepEqual(links[4], { path: "https://example.com", lineNumber: 5 });
});

test("validateSkillReferences skips external URLs and anchors", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "skill-content-"));
  const text = [
    "[external](https://example.com)",
    "[anchor](#section)",
    "[mail](mailto:test@example.com)",
  ].join("\n");
  const issues = validateSkillReferences(text, tmp);
  assert.deepEqual(issues, []);
});

test("validateSkillReferences rejects path traversal", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "skill-content-"));
  const text = "[traverse](../outside/file.md)";
  const issues = validateSkillReferences(text, tmp);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /traversal/);
});

test("validateSkillReferences rejects path escaping package", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "skill-content-"));
  const text = "[escape](../../../etc/passwd)";
  const issues = validateSkillReferences(text, tmp);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /traversal/);
});

test("validateSkillReferences rejects unresolved paths", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "skill-content-"));
  await mkdir(tmp, { recursive: true });
  const text = "[missing](references/nonexistent.md)";
  const issues = validateSkillReferences(text, tmp);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /does not resolve/);
});

test("validateSkillReferences accepts resolved reference paths", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "skill-content-"));
  await mkdir(path.join(tmp, "references"), { recursive: true });
  await writeFile(path.join(tmp, "references", "doc.md"), "# Reference");
  const text = "[doc](references/doc.md)";
  const issues = validateSkillReferences(text, tmp);
  assert.deepEqual(issues, []);
});

test("validateSkillReferences accepts local anchors and markdown titles", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "skill-content-"));
  await mkdir(path.join(tmp, "references"), { recursive: true });
  await writeFile(path.join(tmp, "references", "doc.md"), "# Reference");
  const text = '[doc](references/doc.md#section "Read this section")';
  assert.deepEqual(validateSkillReferences(text, tmp), []);
});

test("validateContentContracts accepts valid minimal content", () => {
  const issues = validateContentContracts(validMinimal);
  assert.deepEqual(issues, []);
});

test("validateContentContracts requires trigger/non-trigger boundary", () => {
  const text = validMinimal.replace(
    "Use this skill when testing content contracts. Do not use it for production.",
    "This skill does testing.",
  );
  const issues = validateContentContracts(text);
  assert.ok(issues.some((i) => i.message.includes("trigger/non-trigger")));
});

test("validateContentContracts requires Workflow section", () => {
  const text = validMinimal.replace("## Workflow\n\n1. Do the thing.\n\n", "");
  const issues = validateContentContracts(text);
  assert.ok(issues.some((i) => i.message.includes("Workflow")));
});

test("validateContentContracts requires Validation section", () => {
  const text = validMinimal.replace(
    "## Validation\n\nCheck the thing works.\n\n",
    "",
  );
  const issues = validateContentContracts(text);
  assert.ok(issues.some((i) => i.message.includes("Validation")));
});

test("validateContentContracts requires Output Contract section", () => {
  const text = validMinimal.replace(
    "## Output Contract\n\nReturn the result.\n\n",
    "",
  );
  const issues = validateContentContracts(text);
  assert.ok(issues.some((i) => i.message.includes("Output Contract")));
});

test("validateContentContracts requires References or explicit no-packaged-references", () => {
  const text = validMinimal.replace(
    "## References\n\n- [official docs](https://example.com/docs)\n",
    "",
  );
  const issues = validateContentContracts(text);
  assert.ok(
    issues.some((i) => i.message.includes("References")),
  );
});

test("validateContentContracts accepts explicit no-packaged-references justification", () => {
  const text = validMinimal
    .replace("## References\n\n- [official docs](https://example.com/docs)\n", "")
    .replace(
      "## Output Contract\n\nReturn the result.\n\n",
      "## Output Contract\n\nReturn the result.\n\n## References\n\nNo packaged references are required for this skill.\n",
    );
  const issues = validateContentContracts(text);
  assert.ok(!issues.some((i) => i.message.includes("References")));
});

test("validateLaneAwareContracts requires Verification Outcome for visual evidence mentions", () => {
  const text = validMinimal + "\nUse browser screenshots for evidence.\n";
  const issues = validateLaneAwareContracts(text, undefined, ["browser", "screenshots"]);
  assert.ok(
    issues.some((i) => i.message.includes("Verification Outcome")),
  );
});

test("validateLaneAwareContracts passes when Verification Outcome is present with visual evidence", () => {
  const text =
    validMinimal +
    "\n## Verification Outcome\n\nVerify with browser evidence.\n";
  const issues = validateLaneAwareContracts(text);
  assert.ok(!issues.some((i) => i.message.includes("Verification Outcome")));
});

test("validateLaneAwareContracts requires Verification Outcome for design lane", () => {
  const issues = validateLaneAwareContracts(validMinimal, "design");
  assert.ok(
    issues.some((i) => /design lane/i.test(i.message)),
  );
});

test("validateOversizedSkill warns above threshold", () => {
  const lines: string[] = [];
  for (let i = 0; i < 250; i++) lines.push(`line ${i}`);
  const text = lines.join("\n");
  const issues = validateOversizedSkill(text);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /threshold/);
});

test("validateOversizedSkill does not allowlist named skills", () => {
  const lines: string[] = [];
  for (let i = 0; i < 250; i++) lines.push(`line ${i}`);
  const text = lines.join("\n");
  const issues = validateOversizedSkill(text);
  assert.equal(issues.length, 1);
});

test("validateOversizedSkill passes for small skills", () => {
  const issues = validateOversizedSkill(validMinimal);
  assert.deepEqual(issues, []);
});

test("validateSkillContent combines all validations", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "skill-content-"));
  const skillRoot = path.join(tmp, "skills", "test.skill");
  await mkdir(skillRoot, { recursive: true });
  const issues = validateSkillContent(validMinimal, skillRoot, {
    lane: "design",
    skillId: "test.skill",
  });
  const designLaneIssues = issues.filter((i) =>
    /design lane/i.test(i.message),
  );
  const otherIssues = issues.filter(
    (i) => !/design lane/i.test(i.message),
  );
  assert.equal(
    designLaneIssues.length,
    1,
    "design lane should require Verification Outcome",
  );
  assert.equal(
    otherIssues.length,
    0,
    "no other content issues expected",
  );
});

test("validateSkillContent reports link issues", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "skill-content-"));
  const skillRoot = path.join(tmp, "skills", "test.skill");
  await mkdir(skillRoot, { recursive: true });
  const brokenText = validMinimal.replace(
    "## References\n\n- [official docs](https://example.com/docs)\n",
    "## References\n\n- [broken](references/missing.md)\n",
  );
  const issues = validateSkillContent(brokenText, skillRoot);
  assert.ok(issues.some((i) => i.message.includes("does not resolve")));
});

test("all curated skills pass reference link validation", async () => {
  const skillsRoot = path.resolve("registry/skills");
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const errors: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillRoot = path.join(skillsRoot, entry.name);
    const skillText = await readFile(
      path.join(skillRoot, "SKILL.md"),
      "utf8",
    );
    const manifestText = await readFile(
      path.join(skillRoot, "skill.manifest.json"),
      "utf8",
    );
    const manifest = JSON.parse(manifestText) as {
      id: string;
    };
    const issues = validateSkillReferences(skillText, skillRoot);
    for (const issue of issues) {
      errors.push(`${manifest.id}: ${issue.path}: ${issue.message}`);
    }
  }
  assert.deepEqual(errors, []);
});

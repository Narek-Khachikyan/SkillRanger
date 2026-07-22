import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveInstalledSkillRoot, InvalidInstalledPathError } from "../src/installers/installed-path.ts";
import { getAdapter } from "../src/installers/codex.ts";
import { findSkill } from "../src/registry/index.ts";
import { upsertSkillRangerAgentContext } from "../src/installers/agent-context.ts";
import { assertInstalledMatches } from "../src/runtime/strict/service.ts";

test("Stage 1 - claude-code install -> install is idempotent", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage1-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const adapter = getAdapter("claude-code");

  const res1 = await adapter.applyInstall(skill, {
    projectRoot,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: false
  });
  assert.equal(res1.installed.skillId, skill.manifest.id);

  const res2 = await adapter.applyInstall(skill, {
    projectRoot,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: false
  });
  assert.equal(res2.installed.skillId, skill.manifest.id);

  const resolved = await resolveInstalledSkillRoot(projectRoot, res2.installed.installedPath);
  assert.ok(resolved.endsWith(path.join(".agents", "skills", "next-app-router-review")));
});

test("Stage 1 - setup -> setup is idempotent", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage1-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  await upsertSkillRangerAgentContext(projectRoot);
  await upsertSkillRangerAgentContext(projectRoot);
});

test("Stage 1 - safe final symlink resolves to canonical directory", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage1-"));
  const projectRoot = path.join(tmpRoot, "project");
  await mkdir(path.join(projectRoot, ".agents", "skills", "my-skill"), { recursive: true });
  await writeFile(path.join(projectRoot, ".agents", "skills", "my-skill", "SKILL.md"), "# Skill");
  await mkdir(path.join(projectRoot, ".claude", "skills"), { recursive: true });
  await symlink(
    path.join("..", "..", ".agents", "skills", "my-skill"),
    path.join(projectRoot, ".claude", "skills", "my-skill"),
    "dir"
  );

  const resolved = await resolveInstalledSkillRoot(projectRoot, ".claude/skills/my-skill");
  const expected = await realpath(path.resolve(projectRoot, ".agents/skills/my-skill"));
  assert.equal(resolved, expected);
});

test("Stage 1 - wrong final symlink target is rejected", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage1-"));
  const projectRoot = path.join(tmpRoot, "project");
  await mkdir(path.join(projectRoot, "other-dir"), { recursive: true });
  await mkdir(path.join(projectRoot, ".claude", "skills"), { recursive: true });
  await symlink(
    path.join("..", "..", "other-dir"),
    path.join(projectRoot, ".claude", "skills", "my-skill"),
    "dir"
  );

  await assert.rejects(
    resolveInstalledSkillRoot(projectRoot, ".claude/skills/my-skill"),
    InvalidInstalledPathError
  );
});

test("Stage 1 - parent symlink remains rejected", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage1-"));
  const projectRoot = path.join(tmpRoot, "project");
  await mkdir(path.join(projectRoot, "real-claude", "skills", "my-skill"), { recursive: true });
  await symlink(
    path.join("real-claude"),
    path.join(projectRoot, ".claude"),
    "dir"
  );

  await assert.rejects(
    resolveInstalledSkillRoot(projectRoot, ".claude/skills/my-skill"),
    InvalidInstalledPathError
  );
});

test("Stage 1 - tampered canonical content remains rejected", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage1-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const adapter = getAdapter("claude-code");
  const res = await adapter.applyInstall(skill, {
    projectRoot,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: false
  });

  const canonicalDir = await resolveInstalledSkillRoot(projectRoot, res.installed.installedPath);
  await writeFile(path.join(canonicalDir, "SKILL.md"), "# Tampered Skill\n");

  await assert.rejects(
    assertInstalledMatches(skill, canonicalDir, res.installed.checksum)
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getAdapter } from "../src/installers/codex.ts";
import { findSkill } from "../src/registry/index.ts";
import { verifyInstalledSkills } from "../src/installers/verify.ts";
import { applyUninstall, planUninstall } from "../src/installers/uninstall.ts";
import { readLockfile, writeLockfile } from "../src/lockfile/index.ts";

test("Stage 2 - verify clean install", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage2-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const adapter = getAdapter("claude-code");
  await adapter.applyInstall(skill, {
    projectRoot,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: false,
  });

  const res = await verifyInstalledSkills({ projectRoot });
  assert.equal(res.verified, true);
  assert.equal(res.entries[0].status, "verified");
});

test("Stage 2 - verify tampered file", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage2-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const adapter = getAdapter("claude-code");
  await adapter.applyInstall(skill, {
    projectRoot,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: false,
  });

  await writeFile(path.join(projectRoot, ".agents", "skills", "next-app-router-review", "SKILL.md"), "# Modified\n");

  const res = await verifyInstalledSkills({ projectRoot });
  assert.equal(res.verified, false);
  assert.equal(res.entries[0].status, "modified");
});

test("Stage 2 - verify missing path", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage2-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const adapter = getAdapter("claude-code");
  await adapter.applyInstall(skill, {
    projectRoot,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: false,
  });

  await rm(path.join(projectRoot, ".claude", "skills", "next-app-router-review"), { recursive: true, force: true });
  await rm(path.join(projectRoot, ".agents", "skills", "next-app-router-review"), { recursive: true, force: true });

  const res = await verifyInstalledSkills({ projectRoot });
  assert.equal(res.verified, false);
  assert.equal(res.entries[0].status, "missing");
});

test("Stage 2 - verify wrong symlink target", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage2-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const adapter = getAdapter("claude-code");
  await adapter.applyInstall(skill, {
    projectRoot,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: false,
  });

  await rm(path.join(projectRoot, ".claude", "skills", "next-app-router-review"), { recursive: true, force: true });
  await mkdir(path.join(projectRoot, "outside-dir"), { recursive: true });
  await symlink(path.join("..", "..", "outside-dir"), path.join(projectRoot, ".claude", "skills", "next-app-router-review"), "dir");

  const res = await verifyInstalledSkills({ projectRoot });
  assert.equal(res.verified, false);
  assert.equal(res.entries[0].status, "invalid-path");
});

test("Stage 3 - uninstall preview does not change files", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage3-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const adapter = getAdapter("claude-code");
  await adapter.applyInstall(skill, {
    projectRoot,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: false,
  });

  const plan = await planUninstall({
    projectRoot,
    skillId: skill.manifest.id,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: true,
  });

  assert.equal(plan.wouldRemove.length > 0, true);

  const lockfile = await readLockfile(projectRoot);
  assert.equal(lockfile.installed.length, 1);
});

test("Stage 3 - apply uninstall removes install and lock entry", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage3-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const adapter = getAdapter("claude-code");
  await adapter.applyInstall(skill, {
    projectRoot,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: false,
  });

  const res = await applyUninstall({
    projectRoot,
    skillId: skill.manifest.id,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: false,
  });

  assert.equal(res.applied, true);

  const lockfile = await readLockfile(projectRoot);
  assert.equal(lockfile.installed.length, 0);
});

test("Stage 3 - multi target uninstall preserves canonical until last target", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage3-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const codexAdapter = getAdapter("codex");
  const claudeAdapter = getAdapter("claude-code");

  await codexAdapter.applyInstall(skill, { projectRoot, targetAgent: "codex", scope: "repo", dryRun: false });
  await claudeAdapter.applyInstall(skill, { projectRoot, targetAgent: "claude-code", scope: "repo", dryRun: false });

  // Uninstall claude-code target only
  await applyUninstall({
    projectRoot,
    skillId: skill.manifest.id,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: false,
  });

  let lockfile = await readLockfile(projectRoot);
  assert.equal(lockfile.installed.length, 1);
  assert.equal(lockfile.installed[0].targetAgent, "codex");

  // Uninstall codex target (last target)
  await applyUninstall({
    projectRoot,
    skillId: skill.manifest.id,
    targetAgent: "codex",
    scope: "repo",
    dryRun: false,
  });

  lockfile = await readLockfile(projectRoot);
  assert.equal(lockfile.installed.length, 0);
});

test("Stage 3 - modified package blocks uninstall", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage3-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const adapter = getAdapter("claude-code");
  await adapter.applyInstall(skill, {
    projectRoot,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: false,
  });

  await writeFile(path.join(projectRoot, ".agents", "skills", "next-app-router-review", "SKILL.md"), "# Modified\n");

  await assert.rejects(
    applyUninstall({
      projectRoot,
      skillId: skill.manifest.id,
      targetAgent: "claude-code",
      scope: "repo",
      dryRun: false,
    }),
    /Cannot uninstall modified skill/
  );
});

test("Stage 4 - lockfile malformed JSON error", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage4-"));
  const projectRoot = path.join(tmpRoot, "project");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "skillranger.lock.json"), "{ invalid json ");

  await assert.rejects(
    readLockfile(projectRoot),
    /file contains malformed JSON/
  );
});

test("Stage 4 - lockfile unsupported schema version", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage4-"));
  const projectRoot = path.join(tmpRoot, "project");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "skillranger.lock.json"), JSON.stringify({ schemaVersion: "9.9", installed: [] }));

  await assert.rejects(
    readLockfile(projectRoot),
    /Unsupported lockfile schema/
  );
});

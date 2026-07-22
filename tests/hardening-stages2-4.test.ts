import test from "node:test";
import assert from "node:assert/strict";
import { cp, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

test("Stage 3 - corrupted lockfile installedPath 'src' blocks uninstall and preserves src", async () => {
  const { readFile } = await import("node:fs/promises");
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-corrupt-"));
  const projectRoot = path.join(tmpRoot, "project");
  await mkdir(path.join(projectRoot, "src"), { recursive: true });
  await writeFile(path.join(projectRoot, "src", "index.ts"), "console.log('important code');\n");
  await writeFile(
    path.join(projectRoot, "skillranger.lock.json"),
    JSON.stringify({
      schemaVersion: "1.0",
      installed: [
        {
          skillId: "frontend.next-app-router-review",
          version: "1.0.0",
          checksum: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          source: { type: "local", registry: "default", path: "registry/skills/frontend.next-app-router-review" },
          audit: { riskLevel: "low", securityScore: 1, findings: [] },
          installedAt: "2026-07-22T00:00:00.000Z",
          installedPath: "src",
          targetAgent: "codex",
          scope: "repo"
        }
      ]
    })
  );

  await assert.rejects(
    applyUninstall({
      projectRoot,
      skillId: "frontend.next-app-router-review",
      targetAgent: "codex",
      scope: "repo",
      dryRun: false,
    }),
    /does not match expected managed installation directory|checksum does not match/
  );

  const srcContent = await readFile(path.join(projectRoot, "src", "index.ts"), "utf8");
  assert.equal(srcContent, "console.log('important code');\n");
});

test("Stage 3 - Claude install -> uninstall removes canonical directory", async () => {
  const { lstat } = await import("node:fs/promises");
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-claude-"));
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

  const canonicalDir = path.join(projectRoot, ".agents", "skills", "next-app-router-review");
  const agentSymlink = path.join(projectRoot, ".claude", "skills", "next-app-router-review");

  assert.ok(await lstat(canonicalDir).catch(() => undefined));
  assert.ok(await lstat(agentSymlink).catch(() => undefined));

  await applyUninstall({
    projectRoot,
    skillId: skill.manifest.id,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: false,
  });

  assert.equal(await lstat(canonicalDir).catch(() => undefined), undefined);
  assert.equal(await lstat(agentSymlink).catch(() => undefined), undefined);
});

test("CLI command parser resolves verify, uninstall, and installed --verify", async () => {
  const { parseCliInvocation } = await import("../src/cli/commands.ts");

  const verifyResult = parseCliInvocation(["verify", "my-project", "--skill", "frontend.next-app-router-review", "--target", "claude-code"]);
  assert.equal(verifyResult.kind, "command");
  if (verifyResult.kind === "command") {
    assert.equal(verifyResult.command, "verify");
    assert.deepEqual(verifyResult.positionals, ["my-project"]);
    assert.equal(verifyResult.flags.skill, "frontend.next-app-router-review");
    assert.equal(verifyResult.flags.target, "claude-code");
  }

  const uninstallResult = parseCliInvocation(["uninstall", "frontend.next-app-router-review", "--yes"]);
  assert.equal(uninstallResult.kind, "command");
  if (uninstallResult.kind === "command") {
    assert.equal(uninstallResult.command, "uninstall");
    assert.equal(uninstallResult.flags.yes, true);
  }

  const installedResult = parseCliInvocation(["installed", "--verify"]);
  assert.equal(installedResult.kind, "command");
  if (installedResult.kind === "command") {
    assert.equal(installedResult.command, "installed");
    assert.equal(installedResult.flags.verify, true);
  }
});

test("Codex + Claude -> uninstall Codex preserves canonical and Claude remains verified", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-shared-canonical-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const codexAdapter = getAdapter("codex");
  const claudeAdapter = getAdapter("claude-code");

  await codexAdapter.applyInstall(skill, { projectRoot, targetAgent: "codex", scope: "repo", dryRun: false });
  await claudeAdapter.applyInstall(skill, { projectRoot, targetAgent: "claude-code", scope: "repo", dryRun: false });

  await applyUninstall({
    projectRoot,
    skillId: skill.manifest.id,
    targetAgent: "codex",
    scope: "repo",
    dryRun: false,
  });

  const canonicalDir = path.join(projectRoot, ".agents", "skills", "next-app-router-review");
  const claudeSymlink = path.join(projectRoot, ".claude", "skills", "next-app-router-review");

  assert.ok(await lstat(canonicalDir).catch(() => undefined));
  assert.ok(await lstat(claudeSymlink).catch(() => undefined));

  const verification = await verifyInstalledSkills({ projectRoot, targetAgent: "claude-code" });
  assert.equal(verification.verified, true);
  assert.equal(verification.entries[0].status, "verified");
});

test("Missing Claude symlink + modified canonical -> uninstall removes lock entry only and preserves canonical", async () => {
  const { readFile } = await import("node:fs/promises");
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stale-canonical-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const adapter = getAdapter("claude-code");
  await adapter.applyInstall(skill, { projectRoot, targetAgent: "claude-code", scope: "repo", dryRun: false });

  // Tamper with canonical directory content
  const canonicalFile = path.join(projectRoot, ".agents", "skills", "next-app-router-review", "SKILL.md");
  await writeFile(canonicalFile, "# Tampered content\n");

  // Remove Claude symlink to simulate stale agent entry
  const claudeSymlink = path.join(projectRoot, ".claude", "skills", "next-app-router-review");
  await rm(claudeSymlink, { recursive: true, force: true });

  const result = await applyUninstall({
    projectRoot,
    skillId: skill.manifest.id,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: false,
  });

  assert.equal(result.applied, true);

  // Canonical directory must NOT be deleted
  const canonicalContent = await readFile(canonicalFile, "utf8");
  assert.equal(canonicalContent, "# Tampered content\n");

  const lockfile = await readLockfile(projectRoot);
  assert.equal(lockfile.installed.length, 0);
});

test("Copy install + unrelated canonical directory -> uninstall preserves unrelated canonical directory", async () => {
  const { readFile } = await import("node:fs/promises");
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-unrelated-canonical-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  // Install via copy-mode adapter (claude-code with mode: "copy")
  const claudeAdapter = getAdapter("claude-code");
  await claudeAdapter.applyInstall(skill, {
    projectRoot,
    targetAgent: "claude-code",
    scope: "repo",
    mode: "copy",
    dryRun: false,
  });

  // Create unrelated canonical directory in .agents/skills
  const unrelatedCanonical = path.join(projectRoot, ".agents", "skills", "next-app-router-review");
  await mkdir(unrelatedCanonical, { recursive: true });
  await writeFile(path.join(unrelatedCanonical, "unrelated.txt"), "important data");

  await applyUninstall({
    projectRoot,
    skillId: skill.manifest.id,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: false,
  });

  const unrelatedData = await readFile(path.join(unrelatedCanonical, "unrelated.txt"), "utf8");
  assert.equal(unrelatedData, "important data");
});

const withIsolatedUserEnv = async (
  options: { tmpHome: string; claudeConfigDir?: string },
  fn: () => Promise<void>
) => {
  const envKeys = ["HOME", "USERPROFILE", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME"] as const;
  const initialEnv: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};

  for (const key of envKeys) {
    initialEnv[key] = process.env[key];
  }

  process.env.HOME = options.tmpHome;
  process.env.USERPROFILE = options.tmpHome;
  process.env.CLAUDE_CONFIG_DIR = options.claudeConfigDir ?? path.join(options.tmpHome, ".claude");
  process.env.CODEX_HOME = path.join(options.tmpHome, ".codex");
  process.env.XDG_CONFIG_HOME = path.join(options.tmpHome, ".config");

  try {
    await fn();
  } finally {
    for (const key of envKeys) {
      if (initialEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = initialEnv[key];
      }
    }
  }
};

test("User-scope install -> verify returns verified and options --skill / --target work", async () => {
  const tmpHome = await mkdtemp(path.join(os.tmpdir(), "skillranger-user-home-"));

  await withIsolatedUserEnv({ tmpHome }, async () => {
    const projectRoot = path.join(tmpHome, "project");
    await mkdir(projectRoot, { recursive: true });

    const skill = await findSkill("frontend.next-app-router-review", "registry");
    assert.ok(skill);

    const adapter = getAdapter("claude-code");
    await adapter.applyInstall(skill, {
      projectRoot,
      targetAgent: "claude-code",
      scope: "user",
      dryRun: false,
    });

    const verification = await verifyInstalledSkills({
      projectRoot,
      skillId: skill.manifest.id,
      targetAgent: "claude-code",
    });

    assert.equal(verification.verified, true);
    assert.equal(verification.entries[0].status, "verified");
    assert.equal(verification.entries[0].scope, "user");
  });
});

test("Custom CLAUDE_CONFIG_DIR outside home -> user install, verify, and uninstall succeed", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-custom-claude-"));
  const fakeHome = path.join(tmpRoot, "home");
  const customClaudeConfig = path.join(tmpRoot, "custom-claude-config");
  const projectRoot = path.join(tmpRoot, "project");

  await mkdir(fakeHome, { recursive: true });
  await mkdir(customClaudeConfig, { recursive: true });
  await mkdir(projectRoot, { recursive: true });

  await withIsolatedUserEnv({ tmpHome: fakeHome, claudeConfigDir: customClaudeConfig }, async () => {
    const skill = await findSkill("frontend.next-app-router-review", "registry");
    assert.ok(skill);

    const adapter = getAdapter("claude-code");
    await adapter.applyInstall(skill, {
      projectRoot,
      targetAgent: "claude-code",
      scope: "user",
      dryRun: false,
    });

    const verification = await verifyInstalledSkills({
      projectRoot,
      skillId: skill.manifest.id,
      targetAgent: "claude-code",
    });

    assert.equal(verification.verified, true);
    assert.equal(verification.entries[0].status, "verified");

    const uninstallRes = await applyUninstall({
      projectRoot,
      skillId: skill.manifest.id,
      targetAgent: "claude-code",
      scope: "user",
      dryRun: false,
    });

    assert.equal(uninstallRes.applied, true);
  });
});

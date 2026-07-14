import test from "node:test";
import assert from "node:assert/strict";
import { cp, lstat, mkdir, mkdtemp, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findSkill } from "../src/registry/index.ts";
import { getAdapter } from "../src/installers/codex.ts";
import { readLockfile } from "../src/lockfile/index.ts";
import type { RegistrySkill, SkillManifest } from "../src/types.ts";

const exists = async (filePath: string) => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

test("codex installer writes repo skill and lockfile", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-install-"));
  const projectRoot = path.join(tmpRoot, "next-react-ts");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const adapter = getAdapter("codex");
  const dryRun = await adapter.planInstall(skill, {
    projectRoot,
    targetAgent: "codex",
    scope: "repo",
    dryRun: true
  });

  assert.ok(dryRun.writes.some((filePath) => filePath.endsWith(".agents/skills/next-app-router-review/SKILL.md")));
  assert.equal(await exists(path.join(projectRoot, ".agents/skills/next-app-router-review/SKILL.md")), false);

  await adapter.applyInstall(skill, {
    projectRoot,
    targetAgent: "codex",
    scope: "repo",
    dryRun: false
  });

  assert.equal(await exists(path.join(projectRoot, ".agents/skills/next-app-router-review/SKILL.md")), true);
  assert.equal(await exists(path.join(projectRoot, "skillranger.lock.json")), true);
});

test("codex installer copies skill support files", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-install-"));
  const projectRoot = path.join(tmpRoot, "next-react-ts");
  const skillRoot = path.join(tmpRoot, "registry", "skills", "fixture.supported-skill");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });
  await mkdir(path.join(skillRoot, "references"), { recursive: true });

  const manifest: SkillManifest = {
    id: "fixture.supported-skill",
    name: "supported-skill",
    displayName: "Supported Skill Fixture",
    description: "Fixture used to verify skill support files are installed.",
    stackTags: ["frontend"],
    taskTags: ["fixture"],
    supportedAgents: ["codex"],
    source: {
      type: "fixture",
      registry: "local",
      path: "./registry/skills/fixture.supported-skill"
    },
    version: "0.0.0",
    riskLevel: "low",
    permissions: {
      filesystem: ["read-project"],
      network: false,
      shell: false,
      writes: []
    },
    scripts: [],
    dependencies: [],
    qualityScore: 0.5,
    securityScore: 0.9,
    installTargets: ["repo"],
    conflictsWith: [],
    supersedes: [],
    maintainer: {
      name: "fixture",
      trustTier: "trusted"
    },
    license: "MIT"
  };
  await writeFile(path.join(skillRoot, "SKILL.md"), "---\nname: supported-skill\ndescription: Fixture.\n---\n\n# Fixture\n");
  await writeFile(path.join(skillRoot, "skill.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(skillRoot, "references", "design.md"), "# Design Reference\n");

  const skill: RegistrySkill = {
    manifest,
    path: skillRoot,
    skillPath: path.join(skillRoot, "SKILL.md"),
    checksum: "sha256:fixture"
  };

  const adapter = getAdapter("codex");
  const dryRun = await adapter.planInstall(skill, {
    projectRoot,
    targetAgent: "codex",
    scope: "repo",
    dryRun: true
  });

  assert.ok(dryRun.writes.some((filePath) => filePath.endsWith(".agents/skills/supported-skill/references/design.md")));

  await adapter.applyInstall(skill, {
    projectRoot,
    targetAgent: "codex",
    scope: "repo",
    dryRun: false
  });

  assert.equal(await exists(path.join(projectRoot, ".agents/skills/supported-skill/references/design.md")), true);
});

test("codex installer keeps structured design skills self-contained", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-install-"));
  const projectRoot = path.join(tmpRoot, "next-react-ts");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.visual-design-polish", "registry");
  assert.ok(skill);
  const adapter = getAdapter("codex");
  const plan = await adapter.planInstall(skill, {
    projectRoot,
    targetAgent: "codex",
    scope: "repo",
    dryRun: true,
  });
  for (const file of [
    "input.schema.json",
    "output.schema.json",
    "workflow.json",
    "gates.json",
    "evals.json",
  ]) {
    assert.ok(plan.writes.some((filePath) => filePath.endsWith(`visual-design-polish/${file}`)));
  }

  await adapter.applyInstall(skill, {
    projectRoot,
    targetAgent: "codex",
    scope: "repo",
    dryRun: false,
  });
  const installedRoot = path.join(projectRoot, ".agents/skills/visual-design-polish");
  for (const file of [
    "SKILL.md",
    "skill.manifest.json",
    "input.schema.json",
    "output.schema.json",
    "workflow.json",
    "gates.json",
    "evals.json",
  ]) {
    assert.equal(await exists(path.join(installedRoot, file)), true, file);
  }
});

test("codex installer upserts repeat installs into one lockfile entry", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-install-"));
  const projectRoot = path.join(tmpRoot, "next-react-ts");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const adapter = getAdapter("codex");
  for (let index = 0; index < 2; index += 1) {
    await adapter.applyInstall(skill, {
      projectRoot,
      targetAgent: "codex",
      scope: "repo",
      dryRun: false
    });
  }

  const lockfile = await readLockfile(projectRoot);
  assert.equal(lockfile.installed.length, 1);
  assert.equal(lockfile.installed[0]?.skillId, "frontend.next-app-router-review");
  assert.match(lockfile.installed[0]?.checksum ?? "", /^sha256:[a-f0-9]{64}$/);
});

test("codex installer rejects unsafe install slugs", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-install-"));
  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const adapter = getAdapter("codex");
  await assert.rejects(
    adapter.planInstall(
      {
        ...skill,
        manifest: {
          ...skill.manifest,
          id: "fixture.bad-slug",
          name: ".."
        }
      },
      {
        projectRoot: tmpRoot,
        targetAgent: "codex",
        scope: "repo",
        dryRun: true
      }
    ),
    /Invalid install slug/
  );
});

test("installer rejects unsupported target agents", () => {
  assert.throws(() => getAdapter("unknown-agent"), /Unsupported target agent/);
});

test("codex installer plans user-scope install into global canonical skills", async () => {
  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const adapter = getAdapter("codex");
  const plan = await adapter.planInstall(skill, {
    projectRoot: await mkdtemp(path.join(os.tmpdir(), "skillranger-install-")),
    targetAgent: "codex",
    scope: "user",
    dryRun: true
  });

  assert.ok(plan.writes.some((filePath) => filePath.endsWith(".agents/skills/next-app-router-review/SKILL.md")));
  assert.ok(plan.writes.some((filePath) => filePath.startsWith(os.homedir())));
});

test("claude-code installer writes canonical skill and links agent-specific directory", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-install-"));
  const projectRoot = path.join(tmpRoot, "next-react-ts");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skill = await findSkill("frontend.next-app-router-review", "registry");
  assert.ok(skill);

  const adapter = getAdapter("claude-code");
  const dryRun = await adapter.planInstall(skill, {
    projectRoot,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: true
  });

  assert.ok(dryRun.writes.some((filePath) => filePath.endsWith(".agents/skills/next-app-router-review/SKILL.md")));
  assert.ok(dryRun.writes.some((filePath) => filePath.endsWith(".claude/skills/next-app-router-review")));

  await adapter.applyInstall(skill, {
    projectRoot,
    targetAgent: "claude-code",
    scope: "repo",
    dryRun: false
  });

  assert.equal(await exists(path.join(projectRoot, ".agents/skills/next-app-router-review/SKILL.md")), true);
  const agentLink = await lstat(path.join(projectRoot, ".claude/skills/next-app-router-review"));
  assert.equal(agentLink.isSymbolicLink() || agentLink.isDirectory(), true);
});

test("codex installer blocks risky skill before writing files", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-install-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  const skillRoot = path.resolve("fixtures/malicious-skill");
  const manifest = (await import("../fixtures/malicious-skill/skill.manifest.json", { with: { type: "json" } })).default as SkillManifest;
  const skill: RegistrySkill = {
    manifest,
    path: skillRoot,
    skillPath: path.join(skillRoot, "SKILL.md"),
    checksum: ""
  };

  const adapter = getAdapter("codex");
  await assert.rejects(
    adapter.applyInstall(skill, {
      projectRoot,
      targetAgent: "codex",
      scope: "repo",
      dryRun: false
    }),
    /Blocked install/
  );

  assert.equal(await exists(path.join(projectRoot, ".agents/skills/malicious-skill/SKILL.md")), false);
  assert.equal(await exists(path.join(projectRoot, "skillranger.lock.json")), false);
});

test("repo installer rejects symlink components in canonical and agent-specific parents", async () => {
  const skill = await findSkill("frontend.visual-design-polish", "registry"); assert.ok(skill);
  const adapter = getAdapter("codex");
  for (const component of [".agents", ".agents/skills"]) {
    const root = await mkdtemp(path.join(os.tmpdir(), "skillranger-symlink-parent-"));
    const projectRoot = path.join(root, "project"); const outside = path.join(root, "outside");
    await mkdir(projectRoot); await mkdir(outside); await mkdir(path.dirname(path.join(projectRoot, component)), { recursive: true });
    await symlink(outside, path.join(projectRoot, component), "dir");
    const input = { projectRoot, targetAgent: "codex", scope: "repo" as const, dryRun: false, mode: "copy" as const };
    await assert.rejects(adapter.planInstall(skill, input), /symlink component/);
    await assert.rejects(adapter.applyInstall(skill, input), /symlink component/);
    assert.equal(await exists(path.join(outside, "visual-design-polish", "references/shared/frontend--browser-evidence.md")), false);
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "skillranger-agent-symlink-")); const projectRoot = path.join(root, "project"); const outside = path.join(root, "outside");
  await mkdir(projectRoot); await mkdir(outside); await symlink(outside, path.join(projectRoot, ".claude"), "dir");
  const claude = getAdapter("claude-code");
  await assert.rejects(claude.planInstall(skill, { projectRoot, targetAgent: "claude-code", scope: "repo", dryRun: true }), /symlink component/);
  assert.equal(await exists(path.join(outside, "skills", "visual-design-polish")), false);
});

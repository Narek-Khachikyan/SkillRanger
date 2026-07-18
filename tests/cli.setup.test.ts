import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const exists = async (filePath: string) => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

test("setup CLI refuses to run without an interactive terminal", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      "src/cli/index.ts",
      "setup",
      "fixtures/next-react-ts",
    ]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        (error as Error & { stderr?: string }).stderr ?? "",
        /skillranger setup requires an interactive terminal/,
      );
      return true;
    },
  );
});

test("setup CLI requires an intent before --yes installs a composed skill set", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-setup-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        "src/cli/index.ts",
        "setup",
        projectRoot,
        "--target",
        "codex",
        "--yes",
      ]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(
          (error as Error & { stderr?: string }).stderr ?? "",
          /setup --yes requires --intent/,
        );
        return true;
      },
    );
    assert.equal(await exists(path.join(projectRoot, "skillranger.lock.json")), false);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("setup CLI applies recommendations non-interactively with --yes and explicit target", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-setup-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "src/cli/index.ts",
      "setup",
      projectRoot,
      "--target",
      "codex",
      "--intent",
      "Review this Next.js App Router's route handlers, Server Actions, and RSC boundaries.",
      "--scope",
      "repo",
      "--yes",
    ]);

    assert.match(stdout, /Targets: codex/);
    assert.match(stdout, /Scope: repo/);
    assert.match(stdout, /Done\. Installed \d+ skills\./);
    assert.equal(await exists(path.join(projectRoot, ".agents/skills/next-app-router-review/SKILL.md")), true);
    assert.equal(await exists(path.join(projectRoot, "skillranger.lock.json")), true);
    assert.match(stdout, /AGENTS\.md/);
    assert.match(await readFile(path.join(projectRoot, "AGENTS.md"), "utf8"), /skillranger run:begin/);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("setup CLI uses detected setup targets when --target is omitted", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-setup-"));
  const projectRoot = path.join(tmpRoot, "project");
  const codexHome = path.join(tmpRoot, ".codex");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });
  await mkdir(codexHome);

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "src/cli/index.ts", "setup", projectRoot,
        "--intent", "Review this Next.js App Router's route handlers, Server Actions, and RSC boundaries.",
        "--scope", "repo", "--copy", "--no-agent-context", "--yes",
      ],
      {
        env: {
          ...process.env,
          HOME: tmpRoot,
          CODEX_HOME: codexHome,
          CLAUDE_CONFIG_DIR: path.join(tmpRoot, ".claude"),
          XDG_CONFIG_HOME: path.join(tmpRoot, ".config"),
        },
      },
    );

    assert.match(stdout, /Targets: codex/);
    assert.match(stdout, /Detected agents: codex/);
    assert.match(stdout, /Installed frontend\.next-app-router-review for codex/);
    assert.equal(await exists(path.join(projectRoot, ".agents/skills/next-app-router-review/SKILL.md")), true);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("setup CLI preserves AGENTS user text and does not duplicate its block on rerun", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-setup-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });
  const agentPath = path.join(projectRoot, "AGENTS.md");
  const preamble = "# User rules\n\nKeep this byte-for-byte.\n\n";
  await writeFile(agentPath, preamble);
  const setupArgs = [
    "src/cli/index.ts",
    "setup",
    projectRoot,
    "--target",
    "codex,opencode",
    "--intent",
    "Review this Next.js App Router's route handlers, Server Actions, and RSC boundaries.",
    "--scope",
    "repo",
    "--yes",
  ];

  try {
    await execFileAsync(process.execPath, setupArgs);
    await execFileAsync(process.execPath, setupArgs);
    const text = await readFile(agentPath, "utf8");
    assert.ok(text.startsWith(preamble));
    assert.equal(text.match(/<!-- SKILLRANGER_START -->/g)?.length, 1);
    assert.equal(text.match(/<!-- SKILLRANGER_END -->/g)?.length, 1);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("setup CLI supports opting out of agent context", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-setup-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  try {
    await execFileAsync(process.execPath, [
      "src/cli/index.ts", "setup", projectRoot,
      "--target", "codex",
      "--intent", "Review this Next.js App Router's route handlers, Server Actions, and RSC boundaries.",
      "--scope", "repo", "--no-agent-context", "--yes",
    ]);
    assert.equal(await exists(path.join(projectRoot, "AGENTS.md")), false);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("setup CLI does not write project agent context for user scope", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-setup-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  try {
    await execFileAsync(
      process.execPath,
      [
        "src/cli/index.ts", "setup", projectRoot,
        "--target", "codex",
        "--intent", "Review this Next.js App Router's route handlers, Server Actions, and RSC boundaries.",
        "--scope", "user", "--copy", "--yes",
      ],
      {
        env: {
          ...process.env,
          HOME: tmpRoot,
          CODEX_HOME: path.join(tmpRoot, ".codex"),
        },
      },
    );
    assert.equal(await exists(path.join(projectRoot, "AGENTS.md")), false);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("setup CLI supports comma-separated multi-agent targets", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-setup-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "src/cli/index.ts",
      "setup",
      projectRoot,
      "--target",
      "codex,claude-code",
      "--intent",
      "Review this Next.js App Router's route handlers, Server Actions, and RSC boundaries.",
      "--scope",
      "repo",
      "--yes",
    ]);

    assert.match(stdout, /Targets: codex, claude-code/);
    assert.match(stdout, /Installed frontend\.next-app-router-review for codex/);
    assert.match(stdout, /Installed frontend\.next-app-router-review for claude-code/);
    assert.equal(await exists(path.join(projectRoot, ".agents/skills/next-app-router-review/SKILL.md")), true);
    assert.equal(await exists(path.join(projectRoot, ".claude/skills/next-app-router-review")), true);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("setup installs recommendations for every advertised target in isolation", async () => {
  const cases = [
    ["codex", ".agents/skills/next-app-router-review/SKILL.md"],
    ["claude-code", ".claude/skills/next-app-router-review/SKILL.md"],
    ["opencode", ".agents/skills/next-app-router-review/SKILL.md"],
    ["cursor", ".agents/skills/next-app-router-review/SKILL.md"],
    ["gemini-cli", ".agents/skills/next-app-router-review/SKILL.md"],
  ] as const;

  for (const [target, installedSkillPath] of cases) {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), `skillranger-setup-${target}-`));
    const projectRoot = path.join(tmpRoot, "project");
    await cp("fixtures/next-react-ts", projectRoot, { recursive: true });
    try {
      const { stdout } = await execFileAsync(process.execPath, [
        "src/cli/index.ts", "setup", projectRoot,
        "--target", target,
        "--intent", "Review this Next.js App Router's route handlers, Server Actions, and RSC boundaries.",
        "--scope", "repo", "--copy", "--no-agent-context", "--yes",
      ]);
      assert.match(stdout, new RegExp(`Installed frontend\\.next-app-router-review for ${target}`));
      assert.equal(await exists(path.join(projectRoot, installedSkillPath)), true, target);
      const lockfile = JSON.parse(await readFile(path.join(projectRoot, "skillranger.lock.json"), "utf8")) as {
        installed: Array<{ skillId: string; targetAgent: string }>;
      };
      assert.ok(
        lockfile.installed.some(
          (entry) => entry.skillId === "frontend.next-app-router-review" && entry.targetAgent === target,
        ),
        target,
      );
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  }
});

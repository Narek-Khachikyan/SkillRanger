import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
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

const repoCtaUrl = "https://github.com/Narek-Khachikyan/SkillRanger";

const runSetupInPty = (
  args: string[],
  env: NodeJS.ProcessEnv = {},
  interactions: Array<{ waitFor: string; value: string }> = [],
): Promise<{ stdout: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      "python3",
      ["tests/helpers/pty-driver.py", process.execPath, "src/cli/index.ts", ...args],
      {
        env: {
          ...process.env,
          ...env,
          SR_PTY_KEYS: JSON.stringify(interactions.map((interaction) => [interaction.waitFor, interaction.value])),
        },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", () => {
      if (stdout === "" && stderr !== "") reject(new Error(`PTY driver failed: ${stderr}`));
      else resolve({ stdout });
    });
  });

const setupPtyArgs = (projectRoot: string) => [
  "setup", projectRoot,
  "--target", "codex",
  "--intent", "Review this Next.js App Router's route handlers, Server Actions, and RSC boundaries.",
  "--scope", "repo", "--copy",
];

test("setup CLI refuses to run without an interactive terminal", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      "src/cli/index.ts",
      "setup",
      "fixtures/next-react-ts",
    ]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const execError = error as Error & { stderr?: string; stdout?: string };
      assert.match(execError.stderr ?? "", /skillranger setup requires an interactive terminal/);
      assert.ok(!execError.stdout?.includes(repoCtaUrl));
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
    // Preflight audit summary: risk level + findings count per recommended skill, before install proceeds.
    assert.match(stdout, /Audit summary:/);
    assert.match(stdout, /- frontend\.\S+: risk low, \d+ findings?/);
    // The repository CTA is interactive-terminal-only: a piped non-TTY run must not print it.
    assert.ok(!stdout.includes(repoCtaUrl));
    assert.equal(await exists(path.join(projectRoot, ".agents/skills/next-app-router-review/SKILL.md")), true);
    assert.equal(await exists(path.join(projectRoot, "skillranger.lock.json")), true);
    assert.match(stdout, /AGENTS\.md/);
    assert.match(await readFile(path.join(projectRoot, "AGENTS.md"), "utf8"), /read_run_skill_file/);
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
    const lockfile = JSON.parse(await readFile(path.join(projectRoot, "skillranger.lock.json"), "utf8")) as {
      installed: Array<{ skillId: string; targetAgent: string }>;
    };
    const targets = lockfile.installed
      .filter((entry) => entry.skillId === "frontend.next-app-router-review")
      .map((entry) => entry.targetAgent);
    assert.deepEqual(targets, ["codex", "claude-code"]);
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

const posixPtyOnly = { skip: process.platform === "win32" && "PTY tests require the POSIX script(1) utility" };

test("setup CLI prints exactly one repository CTA after a successful interactive run", posixPtyOnly, async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-setup-pty-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  try {
    const { stdout } = await runSetupInPty(setupPtyArgs(projectRoot), { CI: "" }, [
      { waitFor: "Recommended skills:", value: "\r" },
      { waitFor: "Install selected skills into this project?", value: "y" },
    ]);
    assert.match(stdout, /Done\. Installed \d+ skills\./);
    assert.equal(stdout.split(`SkillRanger: ${repoCtaUrl}`).length - 1, 1);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("setup CLI suppresses the CTA when CI is set even on a TTY", posixPtyOnly, async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-setup-pty-ci-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  try {
    const { stdout } = await runSetupInPty(setupPtyArgs(projectRoot), { CI: "true" }, [
      { waitFor: "Recommended skills:", value: "\r" },
      { waitFor: "Install selected skills into this project?", value: "y" },
    ]);
    assert.match(stdout, /Done\. Installed \d+ skills\./);
    assert.ok(!stdout.includes(repoCtaUrl));
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("setup CLI does not print the CTA when the user cancels the skill selection", posixPtyOnly, async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-setup-pty-cancel-"));
  const projectRoot = path.join(tmpRoot, "project");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });

  try {
    const { stdout } = await runSetupInPty(setupPtyArgs(projectRoot), { CI: "" }, [
      { waitFor: "Recommended skills:", value: "q" },
    ]);
    assert.match(stdout, /Cancelled\. No files were changed\./);
    assert.ok(!stdout.includes(repoCtaUrl));
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("setup CLI does not print the CTA when it cannot recommend compatible skills", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-setup-empty-"));
  const projectRoot = path.join(tmpRoot, "empty-project");
  await mkdir(projectRoot);

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "src/cli/index.ts", "setup", projectRoot,
      "--target", "codex",
      "--intent", "Review this Next.js App Router before release",
      "--scope", "repo", "--copy", "--yes",
    ]);
    assert.match(stdout, /No recommendations found/);
    assert.match(stdout, /No files were changed\./);
    assert.ok(!stdout.includes(repoCtaUrl));
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

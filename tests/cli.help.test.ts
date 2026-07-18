import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const canonicalCommands = [
  "scan",
  "domain:list",
  "domain:inspect",
  "design:brief",
  "design:recommend-recipe",
  "design:observe",
  "design:validate",
  "design:validate-source",
  "design:verify",
  "design:repair",
  "design:compile",
  "recommend",
  "run:start",
  "run:record-read",
  "run:resolve-clarifications",
  "run:begin",
  "run:complete",
  "run:verify",
  "run:inspect",
  "run:read-next",
  "run:step:begin",
  "run:evidence:add",
  "run:step:complete",
  "run:skill:verify",
  "run:finalize",
  "setup",
  "audit",
  "validate:registry",
  "audit:registry",
  "lint:skills",
  "publish:check",
  "eval:visual",
  "eval:frontend",
  "install",
  "installed",
  "mcp",
  "doctor",
] as const;

const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["src/cli/index.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    input: "",
    timeout: 5_000,
  });

test("root help supports no args, help, --help, and -h", () => {
  for (const args of [[], ["help"], ["--help"], ["-h"]]) {
    const result = cli(...args);
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
    assert.match(result.stdout, /^skillranger\n\nUsage:/);
    assert.equal(result.stderr, "");
  }
});

test("every canonical command provides non-executing command help", () => {
  for (const command of canonicalCommands) {
    const result = cli(command, "--help");
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.equal(result.stdout.startsWith(`skillranger ${command}\n\n`), true, command);
    assert.match(result.stdout, /Usage:/);
    assert.equal(result.stderr, "");
  }
});

test("run:start help works through --help, -h, and help command", () => {
  for (const args of [
    ["run:start", "--help"],
    ["run:start", "-h"],
    ["help", "run:start"],
  ]) {
    const result = cli(...args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skillranger run:start/);
    assert.doesNotMatch(result.stderr, /--target requires a value/);
  }
});

test("help never executes a command that otherwise has no required arguments", () => {
  const result = cli("scan", "--help");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^skillranger scan/);
  assert.doesNotMatch(result.stdout, /^Project:/m);
});

test("list-installed alias resolves to installed help", () => {
  const result = cli("list-installed", "--help");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^skillranger installed/);
});

test("--version prints the package version", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    version: string;
  };
  const result = cli("--version");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${packageJson.version}\n`);
  assert.equal(result.stderr, "");
});

test("unknown long and short options fail before command execution", () => {
  for (const option of ["--definitely-invalid", "-x"]) {
    const result = cli("scan", option);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, `Unknown option for scan: ${option}\n`);
    assert.equal(result.stdout, "");
  }
});

test("help for an unknown command fails concisely", () => {
  const result = cli("help", "not-a-command");
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Unknown command: not-a-command\n");
});

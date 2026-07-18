import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commandOptions = { cwd: repositoryRoot, maxBuffer: 10 * 1024 * 1024 };

const runPackagedMcpInitialize = async (tarball, version, cwd) => {
  const child = spawn(
    "npm",
    ["exec", "--yes", "--package", tarball, "--", "skillranger", "mcp"],
    { cwd, stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Packaged MCP exited with code ${code} signal ${signal ?? "none"}: ${stderr}`));
    });
  });
  const timeout = setTimeout(() => child.kill(), 15_000);

  try {
    child.stdin.end(`${JSON.stringify({
      jsonrpc: "2.0",
      id: "package-smoke",
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "package-smoke", version: "1.0.0" },
      },
    })}\n`);
    await completed;
  } finally {
    clearTimeout(timeout);
  }

  const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  assert.equal(lines.length, 1, `Expected one MCP response line, received: ${stdout}`);
  const response = JSON.parse(lines[0]);
  assert.equal(response.id, "package-smoke");
  assert.equal(response.result?.serverInfo?.name, "skillranger");
  assert.equal(response.result?.serverInfo?.title, "SkillRanger");
  assert.equal(response.result?.serverInfo?.version, version);
};

const smokeRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-package-smoke-"));

try {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  const { stdout: packStdout } = await exec(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", smokeRoot],
    commandOptions,
  );
  const packed = JSON.parse(packStdout);
  assert.equal(packed.length, 1, "npm pack must emit exactly one package");
  assert.equal(typeof packed[0]?.filename, "string");
  assert.equal(path.basename(packed[0].filename), packed[0].filename, "npm pack emitted an unsafe filename");
  const tarball = path.join(smokeRoot, packed[0].filename);

  const { stdout: packagedDoctor } = await exec(
    "npm",
    ["exec", "--yes", "--package", tarball, "--", "skillranger", "doctor"],
    { ...commandOptions, cwd: smokeRoot },
  );
  assert.match(packagedDoctor, /compiled-binary/);

  const fixturePath = path.join(repositoryRoot, "fixtures", "next-react-ts");
  await exec(
    "npm",
    ["exec", "--yes", "--package", tarball, "--", "skillranger", "scan", fixturePath, "--json"],
    { ...commandOptions, cwd: smokeRoot },
  );
  await exec(
    "npm",
    ["exec", "--yes", "--package", tarball, "--", "skillranger", "recommend", fixturePath, "--target", "codex", "--json"],
    { ...commandOptions, cwd: smokeRoot },
  );

  const extracted = path.join(smokeRoot, "extracted");
  await mkdir(extracted);
  await exec("tar", ["-xzf", tarball, "-C", extracted], commandOptions);
  const { stdout: extractedDoctor } = await exec(
    process.execPath,
    [path.join(extracted, "package", "dist", "cli", "index.js"), "doctor"],
    { ...commandOptions, cwd: extracted },
  );
  assert.match(extractedDoctor, /compiled-binary/);

  await runPackagedMcpInitialize(tarball, packageJson.version, smokeRoot);
  process.stdout.write(`Package smoke passed for ${packed[0].filename}\n`);
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}

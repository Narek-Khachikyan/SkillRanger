import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commandOptions = { cwd: repositoryRoot, maxBuffer: 10 * 1024 * 1024 };

const runPackagedMcp = async (tarball, version, cwd) => {
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
    const request = (id, method, params) => JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });
    child.stdin.end(`${request("package-smoke-init", "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "package-smoke", version: "1.0.0" },
      })}\n${request("package-smoke-tools", "tools/list", {})}\n`);
    await completed;
  } finally {
    clearTimeout(timeout);
  }

  const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  assert.equal(lines.length, 2, `Expected two MCP response lines, received: ${stdout}`);
  const responses = lines.map((line) => JSON.parse(line));
  const initialized = responses.find(({ id }) => id === "package-smoke-init");
  assert.equal(initialized?.result?.serverInfo?.name, "skillranger");
  assert.equal(initialized?.result?.serverInfo?.title, "SkillRanger");
  assert.equal(initialized?.result?.serverInfo?.version, version);
  const tools = responses.find(({ id }) => id === "package-smoke-tools")?.result?.tools;
  assert.ok(Array.isArray(tools), "Expected MCP tools/list result.");
  const read = tools.find(({ name }) => name === "read_run_skill_file");
  assert.equal(read?.annotations?.idempotentHint, true);
  assert.deepEqual(read?.outputSchema?.oneOf?.map((entry) => entry.properties?.schemaVersion?.const).filter(Boolean), ["router-read-result/1.0"]);
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

  const mcpProject = path.join(smokeRoot, "mcp-project");
  await cp(fixturePath, mcpProject, { recursive: true });
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

  await runPackagedMcp(tarball, packageJson.version, mcpProject);
  process.stdout.write(`Package smoke passed for ${packed[0].filename}\n`);
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}

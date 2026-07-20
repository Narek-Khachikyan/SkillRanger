import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { validateJsonSchema } from "../src/runtime/strict/json-schema.ts";

const execFileAsync = promisify(execFile);
const cli = (args: string[]) => execFileAsync(process.execPath, ["src/cli/index.ts", ...args]);

const temporaryProject = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillranger-cli-task-"));
  await cp("fixtures/next-react-ts", root, { recursive: true });
  return root;
};

const rejectedJson = async (args: string[]) => {
  try {
    await cli(args);
    assert.fail("Expected CLI command to fail.");
  } catch (error) {
    assert.ok(error instanceof Error);
    const stdout = (error as Error & { stdout?: string }).stdout ?? "";
    return JSON.parse(stdout) as { ok: false; code: string; message: string };
  }
};

test("task --explain adds a schema-valid privacy-safe JSON explanation", async () => {
  const root = await temporaryProject();
  try {
    const { stdout } = await cli([
      "task", root,
      "--intent", "Create a responsive web interface",
      "--target", "codex",
      "--explain",
      "--json",
    ]);
    const result = JSON.parse(stdout) as {
      routing: { deterministicKey: string };
      explanation: {
        deterministicKey: string;
        selectedRoles: Record<string, string[]>;
      };
    };
    assert.equal(result.explanation.deterministicKey, result.routing.deterministicKey);
    assert.equal(result.explanation.selectedRoles.primary.length, 1);
    assert.doesNotMatch(JSON.stringify(result.explanation), /Create a responsive web interface/);

    const schema = JSON.parse(await readFile("schemas/router-tool-result.schema.json", "utf8"));
    assert.deepEqual(validateJsonSchema(schema, result), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("task returns the typed raw-intent confirmation error", async () => {
  const root = await temporaryProject();
  try {
    const result = await rejectedJson([
      "task", root,
      "--intent", "Create a responsive web interface",
      "--store-intent",
      "--json",
    ]);
    assert.equal(result.code, "raw-intent-confirmation-required");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("task:read requires both optional-file selectors", async () => {
  const root = await temporaryProject();
  try {
    for (const incomplete of [["--skill", "frontend.audit"], ["--path", "SKILL.md"]]) {
      const result = await rejectedJson([
        "task:read", root,
        "--router-run", "route_missing00",
        "--expected-read-revision", "0",
        ...incomplete,
        "--json",
      ]);
      assert.equal(result.code, "invalid-arguments");
      assert.match(result.message, /requires exactly one/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("task bounds and validates strict skill input JSON before routing", async () => {
  const root = await temporaryProject();
  const oversized = path.join(root, "oversized-inputs.json");
  const unknown = path.join(root, "unknown-inputs.json");
  try {
    await writeFile(oversized, "x".repeat(256_001));
    await writeFile(unknown, JSON.stringify({ "unknown.skill": {} }));

    const oversizedResult = await rejectedJson([
      "task", root,
      "--intent", "Review frontend performance",
      "--strict",
      "--skill-inputs", oversized,
      "--json",
    ]);
    assert.equal(oversizedResult.code, "invalid-arguments");
    assert.match(oversizedResult.message, /exceeds 256000 bytes/);

    const unknownResult = await rejectedJson([
      "task", root,
      "--intent", "Review frontend performance",
      "--strict",
      "--skill-inputs", unknown,
      "--json",
    ]);
    assert.equal(unknownResult.code, "invalid-arguments");
    assert.match(unknownResult.message, /unknown bundled skill ID/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

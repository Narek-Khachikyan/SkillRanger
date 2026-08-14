import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { validateJsonSchema } from "../src/runtime/strict/json-schema.ts";
import type { SkillRun } from "../src/runtime/skill-run/index.ts";

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

test("task human-readable output visibly reports limited deterministic fallback", async () => {
  const root = await temporaryProject();
  try {
    const { stdout } = await cli([
      "task", root,
      "--intent", "Create a responsive web interface",
      "--target", "codex",
    ]);
    assert.match(stdout, /limited deterministic fallback/);
    assert.match(stdout, /semantic-recall-limited/);
    assert.match(stdout, /Prepared/);
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

test("task:read bridges completed mandatory reads into the lifecycle runtime run", async () => {
  const root = await temporaryProject();
  try {
    const { stdout } = await cli([
      "task", root,
      "--intent", "Review and fix accessibility in this web interface, then verify the result",
      "--target", "codex",
      "--capabilities", "browser,screenshots",
      "--json",
    ]);
    const prepared = JSON.parse(stdout) as {
      status: string;
      run: { routerRunId: string; runtimeRunId: string; readRevision: number };
    };
    assert.equal(prepared.status, "prepared");

    let readRevision = prepared.run.readRevision;
    for (let guard = 0; guard < 32; guard += 1) {
      const readOut = JSON.parse((await cli([
        "task:read", root,
        "--router-run", prepared.run.routerRunId,
        "--expected-read-revision", String(readRevision),
        "--mandatory-next",
        "--json",
      ])).stdout) as { readRevision: number; readStatus: { runMandatoryReadsComplete: boolean } };
      readRevision = readOut.readRevision;
      if (readOut.readStatus.runMandatoryReadsComplete) break;
    }

    // The bridged reads must land in the runtime run as content-delivered records, core
    // (universal) skills included; an unbridged read path leaves the run skills-selected forever.
    const inspected = JSON.parse((await cli([
      "run:inspect", root, "--run", prepared.run.runtimeRunId, "--json",
    ])).stdout) as { run: SkillRun; notices: string[] };
    assert.equal(inspected.run.state, "skills-read");
    const coreReads = inspected.run.skillReads.filter((read) => read.skillId.startsWith("core."));
    assert.ok(coreReads.length > 0, "expected content-delivered reads for the core universal skills");
    assert.ok(inspected.run.skillReads.every((read) => read.source === "content-delivered"));

    const begun = JSON.parse((await cli([
      "run:begin", root, "--run", prepared.run.runtimeRunId, "--json",
    ])).stdout) as { run: SkillRun };
    assert.equal(begun.run.state, "running");
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

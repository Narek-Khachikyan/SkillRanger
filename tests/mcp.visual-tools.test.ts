import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { digestDesignExecutionPolicy, loadRecipeExamplePacks, resolveDesignExecutionPolicy } from "../src/domains/frontend/design/index.ts";
import { callMcpTool, mcpTools } from "../src/mcp/tools.ts";
import { validateJsonSchema } from "../src/runtime/strict/json-schema.ts";
import { makeBrief, makeBundle, makeVerificationInput } from "./helpers/frontend-visual-fixtures.ts";

const execFileAsync = promisify(execFile);

const captureArgs = async (projectRoot: string, outputDir: string) => {
  const adapterPath = path.join(projectRoot, "capture-adapter.mjs");
  await writeFile(adapterPath, `
    import { mkdir, writeFile } from "node:fs/promises";
    import path from "node:path";
    const [screenshotPath] = process.argv.slice(2);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await writeFile(screenshotPath, "screenshot");
    process.stdout.write(JSON.stringify({
      horizontalOverflow: false,
      clippedControls: [], unreachableActions: [], stickyOverlaps: [], consoleErrors: [],
      keyboardTraps: [], invisibleFocus: [], criticalAxeViolations: [], reducedMotionVerified: true,
      stateRendered: true, overlaps: [], focusOrderViolations: [], contrastViolations: [],
      stateSynchronization: {
        status: "not-applicable",
        path: "requested capture state",
        observations: ["This fixture has no state-changing primary action."],
        changes: [{ locator: "#status", before: "idle", after: "idle", adapterInternalId: "leak" }],
        reason: "This fixture has no state-changing primary action.",
      },
      mechanicalSnapshot: {
        spacingContexts: [], colors: [], radii: [], shadows: [], cards: [], typography: [],
        textBlocks: [], touchTargets: [], motion: [],
      },
    }));
  `, "utf8");
  const brief = makeBrief({ requiredStates: ["success"] });
  return {
    brief,
    policy: resolveDesignExecutionPolicy({
      mode: "refine",
      profile: "standard",
      rankedRecipeIds: ["developer-tool"],
      requiredStates: brief.surface.requiredStates,
    }),
    evidenceId: "e1",
    variantId: "v1",
    sourceIdentity: "git:abc",
    baseUrl: "http://127.0.0.1:3000",
    commandTemplate: `${process.execPath} "${adapterPath}" "{{screenshotPath}}"`,
    outputDir,
    projectRoot,
  };
};

test("registers exactly the three visual tool names",()=>{const names=mcpTools.map(({name})=>name);for(const name of ["capture_ui_evidence","compare_design_variants","verify_visual_result"])assert.equal(names.filter((candidate)=>candidate===name).length,1);});
test("both critic tools publish the canonical VisualCriticReport v1 schema", async () => {
  const canonical = JSON.parse(await readFile("registry/skills/frontend.visual-critic/output.schema.json", "utf8"));
  const byName = new Map(mcpTools.map((tool) => [tool.name, tool]));
  for (const name of ["compare_design_variants", "verify_visual_result"]) {
    const published = (byName.get(name)?.inputSchema.properties as any).criticReport;
    // Compared whole, not just `required`: a partial copy would drift from the enforced contract.
    assert.deepEqual(published, canonical, name);
    assert.match(byName.get(name)?.description ?? "", /VisualCriticReport v1/, name);
    assert.match(byName.get(name)?.description ?? "", /CriticReportV2/, name);
  }
});

test("visual MCP array inputs publish item schemas",()=>{
  const byName = new Map(mcpTools.map((tool) => [tool.name, tool]));
  // A bare {type:"object"} item left agents guessing candidate field names from the rejection
  // text; the required contract is published so a host can see and pre-validate it.
  const candidates = (byName.get("compare_design_variants")?.inputSchema.properties as any).candidates;
  assert.equal(candidates.minItems, 1);
  assert.equal(candidates.maxItems, 3);
  assert.deepEqual(candidates.items.required, ["variantId", "directionPath", "evidenceId", "screenshotPaths"]);
  assert.equal(candidates.items.properties.screenshotPaths.minItems, 1);
  const requiredStates = (byName.get("capture_ui_evidence")?.inputSchema.properties as any)
    .brief.properties.surface.properties.requiredStates;
  assert.equal(requiredStates.minItems, 1);
  assert.equal(requiredStates.items.minLength, 1);
  assert.match(requiredStates.description, /evidence at every supported viewport/);
  const verifiedCapture = (byName.get("verify_visual_result")?.inputSchema.properties as any)
    .recheckEvidence.properties.captures.items;
  assert.equal(verifiedCapture.required.includes("stateRendered"), false);
  assert.deepEqual((byName.get("verify_visual_result")?.inputSchema.properties as any).boundedRepairFindings.items,{type:"object"});
});

test("verify visual publishes closed example-pack and execution-trace schemas", async () => {
  const schema = (mcpTools.find(({ name }) => name === "verify_visual_result")?.inputSchema.properties as any);
  assert.deepEqual(schema.examplePack.required, [
    "schemaVersion", "recipeId", "productScenario", "differenceExplanation", "sourcePath", "scenes",
  ]);
  assert.equal(schema.examplePack.additionalProperties, false);
  assert.deepEqual(schema.examplePack.properties.scenes.items.required, [
    "id", "quality", "viewport", "state", "title", "primaryAction", "blocks",
    "appliedRuleIds", "violatedRuleIds", "asset", "assetPath",
  ]);
  assert.equal(schema.examplePack.properties.scenes.items.additionalProperties, false);
  const examplePack = (await loadRecipeExamplePacks()).find(({ recipeId }) => recipeId === "developer-tool");
  assert.ok(examplePack);
  assert.deepEqual(validateJsonSchema(schema.examplePack, examplePack), []);
  assert.deepEqual(schema.executionTrace.required, [
    "schemaVersion", "id", "directionPath", "directionDigest", "recipeId",
    "examplePackPath", "examplePackDigest", "ruleSelectionDigest",
  ]);
  assert.equal(schema.executionTrace.additionalProperties, false);
  assert.equal(schema.executionTrace.properties.directionDigest.pattern, "^sha256:[a-f0-9]{64}$");
});
test("compare tool returns a critic exchange before validation",async()=>{const result=await callMcpTool("compare_design_variants",{policyId:"p1",generatorActorId:"g1",criticActorId:"c1",candidates:[{variantId:"v1",directionPath:"v1.json",evidenceId:"e1",screenshotPaths:["v1.png"]}]});assert.equal(result.isError,false);assert.equal((result.structuredContent as any).status,"critic-required");});

test("compare tool describes actor separation as host-attested, not proven independence", () => {
  const description = mcpTools.find(({ name }) => name === "compare_design_variants")?.description ?? "";
  assert.match(description, /host-attested actor-separated/);
  assert.match(description, /do not technically prove independent execution/);
});

test("visual contract violations surface as tool-level codes, not internal errors", async () => {
  // Real host traffic hit both of these as JSON-RPC -32603, which a host cannot branch on.
  // Blank-but-present strings satisfy the published schema and reach the domain guard, so this
  // exercises the handler's mapping rather than centralized schema validation.
  const blank = { variantId: " ", directionPath: " ", evidenceId: " ", screenshotPaths: [" "] };
  const semantic = await callMcpTool("compare_design_variants", {
    policyId: "p1",
    generatorActorId: "g1",
    criticActorId: "c1",
    candidates: [blank, { ...blank, variantId: "  " }],
  });
  assert.equal(semantic.isError, true);
  assert.equal((semantic.structuredContent as { code?: string }).code, "invalid-arguments");

  const projectRoot = await mkdtemp(path.join(tmpdir(), "skillranger-mcp-capture-policy-"));
  try {
    const args = await captureArgs(projectRoot, path.join(projectRoot, "evidence"));
    const { requiredStates, ...policyWithoutStates } = args.policy as { requiredStates: string[] };
    const missingStates = await callMcpTool("capture_ui_evidence", { ...args, policy: policyWithoutStates, confirm: true });
    assert.equal(missingStates.isError, true);
    assert.equal((missingStates.structuredContent as { code?: string }).code, "invalid-arguments");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("capture requires explicit confirmation", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "skillranger-mcp-capture-confirm-"));
  const outputDir = path.join(projectRoot, "evidence");
  try {
    const result = await callMcpTool(
      "capture_ui_evidence",
      // confirm: false keeps the call schema-valid under CHG-03 (confirm is a required field),
      // so the handler's confirmation gate is exercised rather than centralized schema validation.
      { ...(await captureArgs(projectRoot, outputDir)), confirm: false },
    );

    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as { code?: string }).code, "confirmation-required");
    assert.equal(existsSync(outputDir), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("confirmed capture returns the canonical bundle with recheck identity and no temporary publication", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "skillranger-mcp-capture-bundle-"));
  const outputDir = path.join(projectRoot, "evidence");
  try {
    const result = await callMcpTool("capture_ui_evidence", {
      ...await captureArgs(projectRoot, outputDir),
      confirm: true,
      iteration: 2,
    });

    assert.equal(result.isError, false);
    const bundle = result.structuredContent as {
      id: string;
      variantId: string;
      sourceIdentity: string;
      iteration: number;
      captures: unknown[];
    };
    assert.equal(bundle.id, "e1");
    assert.equal(bundle.variantId, "v1");
    assert.equal(bundle.sourceIdentity, "git:abc");
    assert.equal(bundle.iteration, 2);
    assert.equal(bundle.captures.length, 3);
    assert.ok((bundle.captures as Array<{ stateSynchronization: { changes?: Array<Record<string, unknown>> } }>).every(({ stateSynchronization }) =>
      stateSynchronization.changes?.every((change) => Object.keys(change).sort().join(",") === "after,before,locator")));
    assert.deepEqual(JSON.parse(await readFile(path.join(outputDir, "bundle.json"), "utf8")), bundle);
    assert.ok((await readdir(outputDir, { recursive: true })).every((entry) => !entry.endsWith(".tmp")));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("capture classifies malformed mechanical facts as capture failures", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "skillranger-mcp-capture-mechanical-"));
  const outputDir = path.join(projectRoot, "evidence");
  const adapterPath = path.join(projectRoot, "malformed-mechanical.mjs");
  try {
    await writeFile(adapterPath, `
      import { mkdir, writeFile } from "node:fs/promises";
      import path from "node:path";
      const [screenshotPath] = process.argv.slice(2);
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await writeFile(screenshotPath, "screenshot");
      process.stdout.write(JSON.stringify({
        horizontalOverflow: false,
        clippedControls: [], unreachableActions: [], stickyOverlaps: [], consoleErrors: [],
        keyboardTraps: [], invisibleFocus: [], criticalAxeViolations: [], reducedMotionVerified: true,
        stateRendered: true, overlaps: [], focusOrderViolations: [], contrastViolations: [],
        stateSynchronization: {
          status: "not-applicable",
          path: "requested capture state",
          observations: ["No state-changing primary action is available."],
          reason: "No state-changing primary action is available.",
        },
        mechanicalSnapshot: {
          spacingContexts: [null], colors: [], radii: [], shadows: [], cards: [], typography: [],
          textBlocks: [], touchTargets: [], motion: [],
        },
      }));
    `, "utf8");
    const args = await captureArgs(projectRoot, outputDir);
    args.commandTemplate = `${process.execPath} "${adapterPath}" "{{screenshotPath}}"`;

    const result = await callMcpTool("capture_ui_evidence", { ...args, confirm: true });

    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as { code?: string }).code, "capture-failed");
    assert.equal(existsSync(path.join(outputDir, "bundle.json")), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("capture classifies a missing project context as invalid arguments", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "skillranger-mcp-capture-project-"));
  const missingProjectRoot = path.join(projectRoot, "missing-project");
  try {
    const args = await captureArgs(projectRoot, "evidence");
    const result = await callMcpTool("capture_ui_evidence", {
      ...args,
      projectRoot: missingProjectRoot,
      outputDir: "evidence",
      confirm: true,
    });

    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as { code?: string }).code, "invalid-arguments");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("capture rejects a file used as the output context before invoking the adapter", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "skillranger-mcp-capture-output-file-"));
  const outputFile = path.join(projectRoot, "evidence");
  try {
    await writeFile(outputFile, "existing");
    const args = await captureArgs(projectRoot, outputFile);
    const result = await callMcpTool("capture_ui_evidence", { ...args, confirm: true });

    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as { code?: string }).code, "invalid-arguments");
    assert.equal(await readFile(outputFile, "utf8"), "existing");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("capture rejects an output context nested beneath a regular file", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "skillranger-mcp-capture-output-ancestor-file-"));
  const blockedPath = path.join(projectRoot, "blocked");
  try {
    await writeFile(blockedPath, "existing");
    const args = await captureArgs(projectRoot, path.join(blockedPath, "evidence"));
    const result = await callMcpTool("capture_ui_evidence", { ...args, confirm: true });

    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as { code?: string }).code, "invalid-arguments");
    assert.equal(await readFile(blockedPath, "utf8"), "existing");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("CLI and MCP classify missing screenshots through their shared capture matrix", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "skillranger-capture-failure-parity-"));
  const briefPath = path.join(projectRoot, "brief.json");
  const adapterPath = path.join(projectRoot, "missing-screenshot-adapter.mjs");
  const cliOutputPath = path.join(projectRoot, "cli-output", "observations.json");
  const mcpOutputDir = path.join(projectRoot, "mcp-output");
  try {
    const brief = makeBrief({ requiredStates: ["success"], supportedViewports: [390, 768, 1440] });
    await writeFile(briefPath, `${JSON.stringify(brief)}\n`, "utf8");
    await writeFile(adapterPath, `
      process.stdout.write(JSON.stringify({
        horizontalOverflow: false,
        clippedControls: [], unreachableActions: [], stickyOverlaps: [], consoleErrors: [],
        keyboardTraps: [], invisibleFocus: [], criticalAxeViolations: [], reducedMotionVerified: true,
      }));
    `, "utf8");

    const commandTemplate = `${process.execPath} "${adapterPath}" "{{screenshotPath}}"`;
    let cliError: { stderr?: string } | undefined;
    try {
      await execFileAsync(process.execPath, [
        "src/cli/index.ts", "design:observe", "--brief", briefPath,
        "--base-url", "http://127.0.0.1:3000/", "--command", commandTemplate,
        "--output", cliOutputPath, "--project", projectRoot, "--json",
      ]);
    } catch (error) {
      cliError = error as { stderr?: string };
    }
    assert.match(cliError?.stderr ?? "", /did not create screenshot/);

    const policy = resolveDesignExecutionPolicy({
      mode: "refine", profile: "standard", rankedRecipeIds: ["developer-tool"],
      requiredStates: brief.surface.requiredStates,
    });
    const mcpResult = await callMcpTool("capture_ui_evidence", {
      brief, policy, evidenceId: "e1", variantId: "v1", sourceIdentity: "git:abc",
      baseUrl: "http://127.0.0.1:3000/", commandTemplate, outputDir: mcpOutputDir,
      projectRoot, confirm: true,
    });
    assert.equal(mcpResult.isError, true);
    assert.equal((mcpResult.structuredContent as { code?: string }).code, "capture-failed");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("CLI and MCP captures agree on common observations and adapter replacements", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "skillranger-capture-parity-"));
  const briefPath = path.join(projectRoot, "brief.json");
  const adapterPath = path.join(projectRoot, "parity-adapter.mjs");
  const cliOutputDir = path.join(projectRoot, "cli-output");
  const mcpOutputDir = path.join(projectRoot, "mcp-output");
  const cliRecordsDir = path.join(projectRoot, "cli-records");
  const mcpRecordsDir = path.join(projectRoot, "mcp-records");
  try {
    const brief = makeBrief({ requiredStates: ["success"], supportedViewports: [390, 768, 1440] });
    await writeFile(briefPath, `${JSON.stringify(brief)}\n`, "utf8");
    await writeFile(adapterPath, `
      import { mkdir, writeFile } from "node:fs/promises";
      import path from "node:path";
      const [url, route, width, height, state, screenshotPath, recordsDir] = process.argv.slice(2);
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await mkdir(recordsDir, { recursive: true });
      await writeFile(screenshotPath, "screenshot");
      await writeFile(path.join(recordsDir, width + "-" + state + ".json"), JSON.stringify({ url, route, width, height, state, screenshotPath }));
      process.stdout.write(JSON.stringify({
        horizontalOverflow: false,
        clippedControls: [], unreachableActions: [], stickyOverlaps: [], consoleErrors: [],
        keyboardTraps: [], invisibleFocus: [], criticalAxeViolations: [], reducedMotionVerified: true,
        stateRendered: true, overlaps: [], focusOrderViolations: [], contrastViolations: [],
        stateSynchronization: {
          status: "not-applicable",
          path: "parity capture",
          observations: ["This fixture has no state-changing primary action."],
          reason: "This fixture has no state-changing primary action.",
        },
        mechanicalSnapshot: {
          spacingContexts: [], colors: [], radii: [], shadows: [], cards: [], typography: [],
          textBlocks: [], touchTargets: [], motion: [],
        },
      }));
    `, "utf8");

    const cliCommand = `${process.execPath} "${adapterPath}" "{{url}}" "{{route}}" "{{width}}" "{{height}}" "{{state}}" "{{screenshotPath}}" "${cliRecordsDir}"`;
    const cliOutputPath = path.join(cliOutputDir, "observations.json");
    const { stdout } = await execFileAsync(process.execPath, [
      "src/cli/index.ts", "design:observe", "--brief", briefPath,
      "--base-url", "http://127.0.0.1:3000/", "--route", "/runs",
      "--command", cliCommand, "--output", cliOutputPath, "--project", projectRoot, "--json",
    ]);
    const cliResult = JSON.parse(stdout) as { observations: Array<Record<string, unknown>> };

    const policy = resolveDesignExecutionPolicy({
      mode: "refine", profile: "standard", rankedRecipeIds: ["developer-tool"],
      requiredStates: brief.surface.requiredStates,
    });
    const mcpCommand = `${process.execPath} "${adapterPath}" "{{url}}" "{{route}}" "{{width}}" "{{height}}" "{{state}}" "{{screenshotPath}}" "${mcpRecordsDir}"`;
    const mcpResult = await callMcpTool("capture_ui_evidence", {
      brief, policy, evidenceId: "e1", variantId: "v1", sourceIdentity: "git:abc",
      baseUrl: "http://127.0.0.1:3000/", route: "/runs", commandTemplate: mcpCommand,
      outputDir: mcpOutputDir, projectRoot, confirm: true,
    });
    assert.equal(mcpResult.isError, false);
    const mcpBundle = mcpResult.structuredContent as { captures: Array<{ observation: Record<string, unknown> }> };
    const normalizeObservation = (observation: Record<string, unknown>) => ({
      ...observation,
      screenshotPath: path.basename(String(observation.screenshotPath)),
    });
    assert.deepEqual(
      mcpBundle.captures.map(({ observation }) => normalizeObservation(observation)),
      cliResult.observations.map(normalizeObservation),
    );

    const readRecords = async (directory: string) => Promise.all(
      (await readdir(directory)).sort().map(async (name) => {
        const record = JSON.parse(await readFile(path.join(directory, name), "utf8")) as Record<string, unknown>;
        return { ...record, screenshotPath: path.basename(String(record.screenshotPath)) };
      }),
    );
    assert.deepEqual(await readRecords(mcpRecordsDir), await readRecords(cliRecordsDir));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("capture rejects an in-project output symlink that resolves outside projectRoot", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "skillranger-mcp-capture-symlink-root-"));
  const outsideOutputDir = await mkdtemp(path.join(tmpdir(), "skillranger-mcp-capture-symlink-outside-"));
  const linkedOutputDir = path.join(projectRoot, "linked-evidence");
  try {
    await symlink(outsideOutputDir, linkedOutputDir, "dir");
    const result = await callMcpTool("capture_ui_evidence", {
      ...await captureArgs(projectRoot, linkedOutputDir),
      confirm: true,
    });

    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as { code?: string }).code, "invalid-arguments");
    assert.deepEqual(await readdir(outsideOutputDir), []);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(outsideOutputDir, { recursive: true, force: true });
  }
});

test("capture rejects a nested screenshots directory symlink that resolves outside projectRoot", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "skillranger-mcp-capture-nested-symlink-root-"));
  const outsideOutputDir = await mkdtemp(path.join(tmpdir(), "skillranger-mcp-capture-nested-symlink-outside-"));
  const outputDir = path.join(projectRoot, "evidence");
  try {
    await mkdir(outputDir);
    await symlink(outsideOutputDir, path.join(outputDir, "screenshots"), "dir");
    const result = await callMcpTool("capture_ui_evidence", {
      ...await captureArgs(projectRoot, outputDir),
      confirm: true,
    });

    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as { code?: string }).code, "invalid-arguments");
    assert.deepEqual(await readdir(outsideOutputDir), []);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(outsideOutputDir, { recursive: true, force: true });
  }
});

test("capture rejects a dangling screenshot symlink that points outside projectRoot", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "skillranger-mcp-capture-dangling-symlink-root-"));
  const outsideOutputDir = await mkdtemp(path.join(tmpdir(), "skillranger-mcp-capture-dangling-symlink-outside-"));
  const outputDir = path.join(projectRoot, "evidence");
  const outsideScreenshot = path.join(outsideOutputDir, "escaped.png");
  try {
    await mkdir(path.join(outputDir, "screenshots"), { recursive: true });
    await symlink(outsideScreenshot, path.join(outputDir, "screenshots", "390-success.png"));
    const result = await callMcpTool("capture_ui_evidence", {
      ...await captureArgs(projectRoot, outputDir),
      confirm: true,
    });

    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as { code?: string }).code, "invalid-arguments");
    assert.equal(existsSync(outsideScreenshot), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(outsideOutputDir, { recursive: true, force: true });
  }
});

test("confirmed capture accepts a contained output directory named ..cache", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "skillranger-mcp-capture-contained-"));
  const outputDir = path.join(projectRoot, "..cache");
  try {
    const result = await callMcpTool("capture_ui_evidence", {
      ...await captureArgs(projectRoot, "..cache"),
      confirm: true,
    });

    assert.equal(result.isError, false);
    assert.equal(existsSync(outputDir), true);
    assert.ok((await readdir(outputDir, { recursive: true })).length > 0);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("capture rejects output directories outside projectRoot before creating artifacts", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "skillranger-mcp-capture-root-"));
  const outsideOutputDir = `${projectRoot}-outside`;
  try {
    const result = await callMcpTool("capture_ui_evidence", {
      ...await captureArgs(projectRoot, outsideOutputDir),
      confirm: true,
    });

    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as { code?: string }).code, "invalid-arguments");
    assert.equal(existsSync(outsideOutputDir), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(outsideOutputDir, { recursive: true, force: true });
  }
});

test("verify_visual_result rejects missing dereferenced containers as invalid-arguments", async () => {
  // A bare {} visualRun/policy passed the old published schema and crashed the verifier into a
  // JSON-RPC -32603 internal error a host cannot branch on.
  const args = makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:abc" }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:abc" }),
  });
  const { artifactExists: _artifactExists, ...serializable } = args;
  const result = await callMcpTool("verify_visual_result", { ...serializable, visualRun: {}, policy: {} } as never);
  assert.equal(result.isError, true);
  assert.equal((result.structuredContent as { code?: string }).code, "invalid-arguments");

  // Shapes one level deeper than the published schema subset can express (a capture with only
  // stateSynchronization) must also reject as invalid-arguments, not a JSON-RPC internal error.
  const brokenCapture = await callMcpTool("verify_visual_result", {
    ...serializable,
    initialEvidence: {
      ...serializable.initialEvidence,
      captures: [{ stateSynchronization: { status: "verified", path: "p", observations: ["a", "b"] } }],
    },
  } as never);
  assert.equal(brokenCapture.isError, true);
  assert.equal((brokenCapture.structuredContent as { code?: string }).code, "invalid-arguments");
});

test("verify_visual_result rejects malformed material containers before dispatch", async () => {
  const args = makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:abc" }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:def" }),
  });
  const { artifactExists: _artifactExists, ...serializable } = args;
  for (const field of ["examplePack", "executionTrace"]) {
    const result = await callMcpTool("verify_visual_result", { ...serializable, [field]: {} } as never);
    assert.equal(result.isError, true, field);
    assert.equal((result.structuredContent as { code?: string }).code, "invalid-arguments", field);
  }
});

test("visual verification delegates stale and mismatched evidence to the strict verifier",async()=>{const args=makeVerificationInput({initialEvidence:makeBundle({id:"e1",variantId:"v1",sourceIdentity:"git:abc"}),recheckEvidence:makeBundle({id:"e1",variantId:"v2",sourceIdentity:"git:abc",captures:[]})});args.policy.requiredStates=["success"];args.visualRun.policyDigest=digestDesignExecutionPolicy(args.policy);const {artifactExists:_artifactExists,...serializable}=args;const result=await callMcpTool("verify_visual_result",serializable as any);assert.equal(result.isError,false);const report=result.structuredContent as any;assert.equal(report.outcome,"failed");assert.ok(report.findings.some((finding:any)=>finding.code==="visual-evidence-stale"));assert.ok(report.findings.some((finding:any)=>finding.code==="visual-evidence-matrix-incomplete"));});

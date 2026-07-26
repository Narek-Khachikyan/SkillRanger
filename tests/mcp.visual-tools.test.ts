import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveDesignExecutionPolicy } from "../src/domains/frontend/design/index.ts";
import { callMcpTool, mcpTools } from "../src/mcp/tools.ts";
import { makeBrief, makeBundle, makeVerificationInput } from "./helpers/frontend-visual-fixtures.ts";

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
      },
      mechanicalSnapshot: {
        spacingContexts: [], colors: [], radii: [], shadows: [], cards: [], typography: [],
        textBlocks: [], touchTargets: [],
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
  assert.deepEqual(candidates.items.required, ["variantId", "directionPath", "evidenceId", "screenshotPaths"]);
  assert.equal(candidates.items.properties.screenshotPaths.minItems, 1);
  assert.deepEqual((byName.get("verify_visual_result")?.inputSchema.properties as any).boundedRepairFindings.items,{type:"object"});
});
test("compare tool returns a critic exchange before validation",async()=>{const result=await callMcpTool("compare_design_variants",{policyId:"p1",generatorActorId:"g1",criticActorId:"c1",candidates:[{variantId:"v1",directionPath:"v1.json",evidenceId:"e1",screenshotPaths:["v1.png"]},{variantId:"v2",directionPath:"v2.json",evidenceId:"e2",screenshotPaths:["v2.png"]}]});assert.equal(result.isError,false);assert.equal((result.structuredContent as any).status,"critic-required");});

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
    await symlink(outsideScreenshot, path.join(outputDir, "screenshots", "390-loading.png"));
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

test("visual verification delegates stale and mismatched evidence to the strict verifier",async()=>{const args=makeVerificationInput({initialEvidence:makeBundle({id:"e1",variantId:"v1",sourceIdentity:"git:abc"}),recheckEvidence:makeBundle({id:"e1",variantId:"v2",sourceIdentity:"git:abc",captures:[]})});const {artifactExists:_artifactExists,...serializable}=args;const result=await callMcpTool("verify_visual_result",serializable as any);assert.equal(result.isError,false);const report=result.structuredContent as any;assert.equal(report.outcome,"failed");assert.ok(report.findings.some((finding:any)=>finding.code==="visual-evidence-stale"));assert.ok(report.findings.some((finding:any)=>finding.code==="visual-evidence-matrix-incomplete"));});

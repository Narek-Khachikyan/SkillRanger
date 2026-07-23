import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
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
test("compare tool returns a critic exchange before validation",async()=>{const result=await callMcpTool("compare_design_variants",{policyId:"p1",generatorActorId:"g1",criticActorId:"c1",candidates:[{variantId:"v1",directionPath:"v1.json",evidenceId:"e1",screenshotPaths:["v1.png"]},{variantId:"v2",directionPath:"v2.json",evidenceId:"e2",screenshotPaths:["v2.png"]}]});assert.equal(result.isError,false);assert.equal((result.structuredContent as any).status,"critic-required");});

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

test("visual verification delegates stale and mismatched evidence to the strict verifier",async()=>{const args=makeVerificationInput({initialEvidence:makeBundle({id:"e1",variantId:"v1",sourceIdentity:"git:abc"}),recheckEvidence:makeBundle({id:"e1",variantId:"v2",sourceIdentity:"git:abc",captures:[]})});const {artifactExists:_artifactExists,...serializable}=args;const result=await callMcpTool("verify_visual_result",serializable as any);assert.equal(result.isError,false);const report=result.structuredContent as any;assert.equal(report.outcome,"failed");assert.ok(report.findings.some((finding:any)=>finding.code==="visual-evidence-stale"));assert.ok(report.findings.some((finding:any)=>finding.code==="visual-evidence-matrix-incomplete"));});

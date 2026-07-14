import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  compileDesignMarkdown,
  createBrowserObservationPlan,
  executeBrowserObservationPlan,
  loadFrontendRecipes,
  recommendFrontendRecipe,
  validateDesignBrief,
  validateDesignDirection,
  validateDesignResult,
  validateFrontendSources,
  type BrowserObservation,
  type DesignBrief,
  type DesignDirection,
} from "../src/domains/frontend/design/index.ts";
import { createRepairRequest, executeRepairLoop } from "../src/runtime/verification.ts";
import { callMcpTool } from "../src/mcp/tools.ts";

const execFileAsync = promisify(execFile);

const brief = (): DesignBrief => ({
  schemaVersion: "1.0",
  product: {
    domain: "developer tool",
    primaryUserOrActor: "software developer",
    primaryTask: "inspect and install agent skills",
    contentTypes: ["recommendations", "project evidence", "commands"],
    usageFrequency: "frequent",
    stakes: ["unsafe installation"],
  },
  surface: {
    type: "dashboard",
    primaryAction: "inspect recommendation",
    supportedViewports: [390, 1440],
    requiredStates: ["loading", "empty", "error", "success"],
  },
  direction: {
    requestedTone: ["technical", "quiet"],
    antiGoals: ["generic SaaS metrics"],
    existingDirection: "local neutral tokens",
  },
  evidence: {
    observed: [{ statement: "The project exposes CLI commands.", source: "README.md" }],
    inferred: [],
    assumed: [],
    unknown: [],
  },
});

const direction = (): DesignDirection => ({
  schemaVersion: "1.0",
  recipeId: "developer-tool",
  selectedRuleIds: [
    "typography.role-contrast",
    "layout.list-detail",
    "responsive.list-detail-drill-in",
    "color.operational-status",
    "state.recovery-first",
    "signature.repeated-action-feedback",
  ],
  thesis: "A compact evidence-first workspace for comparing skills and install risk.",
  productReason: "Developers repeatedly compare project evidence, risk, and commands.",
  axes: {
    density: "compact",
    hierarchy: "exception-first",
    composition: "split-pane",
    material: "bordered",
    motionIntensity: "low",
    expressionLevel: "restrained",
  },
  typographyRoles: { body: "UI sans", code: "monospace" },
  colorRoles: { danger: "installation risk", accent: "selected recommendation" },
  signatureMove: "Recommendation evidence remains pinned beside the selected skill.",
  rejectedDefaults: ["decorative metric cards"],
  destructiveCritique: "A split pane can become cramped on mobile and must become a list-detail flow.",
});

const observation = (width: number, state: string): BrowserObservation => ({
  schemaVersion: "1.0",
  viewport: { width, height: width === 390 ? 844 : 900 },
  route: "/",
  state,
  horizontalOverflow: false,
  clippedControls: [],
  unreachableActions: [],
  stickyOverlaps: [],
  consoleErrors: [],
  keyboardTraps: [],
  invisibleFocus: [],
  criticalAxeViolations: [],
  reducedMotionVerified: true,
  screenshotPath: `screenshots/${width}-${state}.png`,
});

test("frontend recipes recommend a developer-tool grammar from product evidence", async () => {
  const recipes = await loadFrontendRecipes();
  assert.equal(recipes.length, 8);
  const recommendations = recommendFrontendRecipe(brief(), recipes);
  assert.equal(recommendations[0]?.recipe.id, "developer-tool");
});

test("design contracts reject mixed evidence and incompatible axes", () => {
  const invalidBrief = brief();
  invalidBrief.evidence.assumed.push({ statement: "The project exposes CLI commands." });
  assert.ok(validateDesignBrief(invalidBrief).some((finding) => finding.code === "brief-mixed-evidence"));

  const regulated = brief();
  regulated.product.domain = "health portal";
  const highMotion = direction();
  highMotion.axes.motionIntensity = "high";
  assert.ok(validateDesignDirection(regulated, highMotion).some((finding) => finding.code === "constraint-regulated-motion"));
});

test("malformed design artifacts fail structurally without throwing", () => {
  const result = validateDesignResult({
    workflowId: "frontend.design-generation",
    brief: { schemaVersion: "1.0" } as DesignBrief,
    direction: {
      schemaVersion: "1.0",
      recipeId: "missing-recipe",
      thesis: "x",
      productReason: "x",
      axes: { motionIntensity: "banana" },
      signatureMove: "x",
      rejectedDefaults: ["x"],
      destructiveCritique: "x",
    } as unknown as DesignDirection,
    capabilities: [],
  });
  assert.equal(result.report.outcome, "failed");
  assert.ok(result.findings.some((finding) => finding.code === "brief-structure-contract"));
  assert.ok(result.findings.some((finding) => finding.code === "direction-axes-contract"));
});

test("malformed evidence entries cannot receive verified outcomes", () => {
  const invalidBrief = brief();
  invalidBrief.evidence.observed = [
    { statement: "Observed statement", source: 42 } as unknown as DesignBrief["evidence"]["observed"][number],
  ];
  const observations = ["loading", "empty", "error", "success"].flatMap((state) => [
    observation(390, state),
    observation(1440, state),
  ]);
  const result = validateDesignResult({
    workflowId: "frontend.design-generation",
    brief: invalidBrief,
    direction: direction(),
    observations,
    capabilities: ["browser", "screenshots"],
    artifactExists: () => true,
  });
  assert.equal(result.report.outcome, "failed");
  assert.ok(result.findings.some((finding) => finding.code === "brief-evidence-entry-contract"));
});

test("missing screenshot artifacts block verified outcomes", () => {
  const observations = ["loading", "empty", "error", "success"].flatMap((state) => [
    observation(390, state),
    observation(1440, state),
  ]);
  const result = validateDesignResult({
    workflowId: "frontend.design-generation",
    brief: brief(),
    direction: direction(),
    observations,
    capabilities: ["browser", "screenshots"],
    artifactExists: () => false,
  });
  assert.equal(result.report.outcome, "failed");
  assert.ok(result.findings.some((finding) => finding.code === "screenshot-evidence-missing"));
  assert.deepEqual(result.report.evidence, []);
});

test("directories do not count as screenshot artifacts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "skillranger-screenshot-directory-"));
  try {
    const observations = ["loading", "empty", "error", "success"].flatMap((state) => [
      { ...observation(390, state), screenshotPath: dir },
      { ...observation(1440, state), screenshotPath: dir },
    ]);
    const result = validateDesignResult({
      workflowId: "frontend.design-generation",
      brief: brief(),
      direction: direction(),
      observations,
      capabilities: ["browser", "screenshots"],
    });
    assert.equal(result.report.outcome, "failed");
    assert.ok(result.findings.some((finding) => finding.code === "screenshot-evidence-missing"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("browser hard gates produce failed and verified outcomes deterministically", () => {
  const observations = ["loading", "empty", "error", "success"].flatMap((state) => [
    observation(390, state),
    observation(1440, state),
  ]);
  const passed = validateDesignResult({
    workflowId: "frontend.design-generation",
    brief: brief(),
    direction: direction(),
    observations,
    capabilities: ["browser", "screenshots"],
    artifactExists: () => true,
  });
  assert.equal(passed.report.outcome, "verified");
  assert.equal(passed.report.gates.hardPassed, true);

  observations[0]!.horizontalOverflow = true;
  const failed = validateDesignResult({
    workflowId: "frontend.design-generation",
    brief: brief(),
    direction: direction(),
    observations,
    capabilities: ["browser", "screenshots"],
    artifactExists: () => true,
  });
  assert.equal(failed.report.outcome, "failed");
  assert.equal(failed.report.findings[0]?.code, "horizontal-overflow");
});

test("soft design findings remain verified when every hard gate passes", () => {
  const softBrief = brief();
  softBrief.surface.requiredStates = ["success"];
  const result = validateDesignResult({
    workflowId: "frontend.design-generation",
    brief: softBrief,
    direction: direction(),
    observations: [observation(390, "success"), observation(1440, "success")],
    capabilities: ["browser", "screenshots"],
    artifactExists: () => true,
  });
  assert.ok(result.findings.some((finding) => finding.gate === "soft"));
  assert.equal(result.report.gates.hardPassed, true);
  assert.equal(result.report.verificationStatus, "passed");
  assert.equal(result.report.outcome, "verified");
});

test("browser observation screenshot paths remain contained in the output directory", () => {
  const unsafeBrief = brief();
  unsafeBrief.surface.requiredStates = ["../../../../escaped"];
  const outputDir = path.resolve(tmpdir(), "skillranger-observations");
  const plan = createBrowserObservationPlan({
    brief: unsafeBrief,
    baseUrl: "http://127.0.0.1:3000/",
    outputDir,
  });
  for (const entry of plan.entries) {
    const relative = path.relative(outputDir, entry.screenshotPath);
    assert.equal(relative.startsWith("..") || path.isAbsolute(relative), false, entry.screenshotPath);
  }
});

test("browser observation runner rejects adapters that do not create screenshots", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "skillranger-browser-missing-screenshot-"));
  const adapterPath = path.join(dir, "adapter.mjs");
  await writeFile(
    adapterPath,
    `process.stdout.write(JSON.stringify({
  horizontalOverflow: false,
  clippedControls: [],
  unreachableActions: [],
  stickyOverlaps: [],
  consoleErrors: [],
  keyboardTraps: [],
  invisibleFocus: [],
  criticalAxeViolations: [],
  reducedMotionVerified: true
}));\n`,
    "utf8",
  );
  try {
    const plan = createBrowserObservationPlan({
      brief: brief(),
      baseUrl: "http://127.0.0.1:3000/",
      outputDir: dir,
    });
    await assert.rejects(
      executeBrowserObservationPlan({
        plan,
        commandTemplate: `node "${adapterPath}"`,
      }),
      /did not create screenshot/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("browser observation runner rejects plans whose screenshots escape output directory", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "skillranger-browser-escaped-plan-"));
  const adapterPath = path.join(dir, "adapter.mjs");
  await writeFile(
    adapterPath,
    `process.stdout.write(JSON.stringify({
  horizontalOverflow: false,
  clippedControls: [],
  unreachableActions: [],
  stickyOverlaps: [],
  consoleErrors: [],
  keyboardTraps: [],
  invisibleFocus: [],
  criticalAxeViolations: [],
  reducedMotionVerified: true
}));\n`,
    "utf8",
  );
  try {
    const plan = createBrowserObservationPlan({
      brief: brief(),
      baseUrl: "http://127.0.0.1:3000/",
      outputDir: dir,
    });
    plan.entries[0]!.screenshotPath = path.resolve(dir, "..", "escaped.png");
    await assert.rejects(
      executeBrowserObservationPlan({
        plan,
        commandTemplate: `node "${adapterPath}"`,
      }),
      /escapes output directory/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("browser observation runner executes a host adapter for the full matrix", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "skillranger-browser-adapter-"));
  const adapterPath = path.join(dir, "adapter.mjs");
  const outputPath = path.join(dir, "observations.json");
  await writeFile(
    adapterPath,
    `import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const [url, width, height, state, screenshotPath] = process.argv.slice(2);
await mkdir(path.dirname(screenshotPath), { recursive: true });
await writeFile(screenshotPath, "screenshot");
process.stdout.write(JSON.stringify({
  url,
  width: Number(width),
  height: Number(height),
  state,
  screenshotPath,
  horizontalOverflow: false,
  clippedControls: [],
  unreachableActions: [],
  stickyOverlaps: [],
  consoleErrors: [],
  keyboardTraps: [],
  invisibleFocus: [],
  criticalAxeViolations: [],
  reducedMotionVerified: true
}));\n`,
    "utf8",
  );
  try {
    const plan = createBrowserObservationPlan({
      brief: brief(),
      baseUrl: "http://127.0.0.1:3000/",
      route: "/skills",
      outputDir: dir,
    });
    assert.equal(plan.entries.length, 2 * 4);
    const observations = await executeBrowserObservationPlan({
      plan,
      commandTemplate: `node "${adapterPath}" "{{url}}" "{{width}}" "{{height}}" "{{state}}" "{{screenshotPath}}"`,
      outputPath,
    });
    assert.equal(observations.length, 8);
    assert.equal(observations[0]?.route, "/skills");
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), observations);
    const verified = validateDesignResult({
      workflowId: "frontend.design-generation",
      brief: brief(),
      direction: direction(),
      observations,
      capabilities: ["browser", "screenshots"],
    });
    assert.equal(verified.report.outcome, "verified");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing browser capability is implemented-unverified, not falsely verified", () => {
  const result = validateDesignResult({
    workflowId: "frontend.design-generation",
    brief: brief(),
    direction: direction(),
    capabilities: [],
  });
  assert.equal(result.report.outcome, "implemented-unverified");
  assert.deepEqual(result.report.residualRisks, ["Browser and screenshot evidence were not available."]);
});

test("frontend source validator blocks dynamic Tailwind construction and reports advisory drift", () => {
  const findings = validateFrontendSources([
    {
      path: "src/Card.tsx",
      content: `export const Card = ({ color }) => (
        <div className={\`flex-\${color} bg-\${color}-600 text-slate-700 w-full w-1/2\`}>
          Trusted by thousands - 10,000+ users
        </div>
      );`,
    },
  ], { semanticTokensPresent: true });
  assert.ok(findings.some((finding) => finding.code === "tailwind-dynamic-class" && finding.gate === "hard"));
  assert.ok(findings.some((finding) => finding.code === "design-system-raw-color" && finding.gate === "soft"));
  assert.ok(findings.some((finding) => finding.code === "generic-testimonial-copy"));
  assert.ok(findings.some((finding) => finding.code === "generic-fake-metric"));
});

test("frontend source validator accepts static semantic utilities", () => {
  const findings = validateFrontendSources([
    {
      path: "src/Button.tsx",
      content: `export const Button = () => <button className="bg-primary text-primary-foreground focus-visible:ring-ring">Save</button>;`,
    },
  ], { semanticTokensPresent: true });
  assert.deepEqual(findings, []);
});

test("repair requests are bounded and preserve normalized findings", async () => {
  const brokenObservation = observation(390, "loading");
  brokenObservation.horizontalOverflow = true;
  const initialReport = validateDesignResult({
    workflowId: "frontend.design-generation",
    brief: brief(),
    direction: direction(),
    observations: [brokenObservation],
    capabilities: ["browser", "screenshots"],
  }).report;
  const request = createRepairRequest(initialReport, 2);
  assert.equal(request.iteration, 1);
  assert.match(request.instructions[0] ?? "", /Preserve approved direction/);

  const loop = await executeRepairLoop({
    initial: { fixed: false },
    maxIterations: 2,
    validate: async (value, iteration) => ({
      ...initialReport,
      iteration,
      outcome: value.fixed ? "verified" : "failed",
      gates: { ...initialReport.gates, hardPassed: value.fixed },
      findings: value.fixed ? [] : initialReport.findings,
    }),
    repair: async () => ({ fixed: true }),
  });
  assert.equal(loop.stopReason, "hard-gates-passed");
  assert.equal(loop.reports.length, 2);
});

test("repair loop stops at its iteration limit and never repairs blocked work", async () => {
  const failedReport = validateDesignResult({
    workflowId: "frontend.design-generation",
    brief: brief(),
    direction: direction(),
    observations: [],
    capabilities: ["browser", "screenshots"],
  }).report;
  let repairs = 0;
  const exhausted = await executeRepairLoop({
    initial: {},
    maxIterations: 2,
    validate: async (_value, iteration) => ({ ...failedReport, iteration }),
    repair: async (value) => {
      repairs += 1;
      return value;
    },
  });
  assert.equal(exhausted.stopReason, "iteration-limit");
  assert.equal(repairs, 2);
  assert.equal(exhausted.reports.length, 3);

  const blockedReport = {
    ...failedReport,
    executionStatus: "blocked" as const,
    outcome: "blocked" as const,
  };
  const blocked = await executeRepairLoop({
    initial: {},
    maxIterations: 2,
    validate: async () => blockedReport,
    repair: async (value) => {
      repairs += 1;
      return value;
    },
  });
  assert.equal(blocked.stopReason, "blocked");
  assert.equal(blocked.reports.length, 1);
  assert.equal(repairs, 2);
});

test("DESIGN.md compilation is deterministic and generated from canonical artifacts", () => {
  const markdown = compileDesignMarkdown(brief(), direction());
  assert.match(markdown, /# Design Contract/);
  assert.match(markdown, /Recipe: `developer-tool`/);
  assert.match(markdown, /390px/);
  assert.match(markdown, /Outcome: not-run/);
});

test("CLI and MCP expose the same structured frontend brief and recipe workflow", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "skillranger-design-"));
  const briefPath = path.join(dir, "brief.json");
  try {
    const { stdout } = await execFileAsync("node", [
      "src/cli/index.ts",
      "design:brief",
      "fixtures/next-react-ts",
      "--domain", "developer tool",
      "--user", "software developer",
      "--task", "inspect skills",
      "--surface", "dashboard",
      "--action", "inspect recommendation",
      "--output", briefPath,
      "--json",
    ]);
    const cli = JSON.parse(stdout) as { brief: DesignBrief };
    assert.equal(cli.brief.product.domain, "developer tool");
    assert.equal(JSON.parse(await readFile(briefPath, "utf8")).product.primaryTask, "inspect skills");

    const mcp = await callMcpTool("recommend_frontend_recipe", { brief: cli.brief });
    const content = mcp.structuredContent as { recommendations: Array<{ recipe: { id: string } }> };
    assert.equal(content.recommendations[0]?.recipe.id, "developer-tool");

    const compiled = await callMcpTool("compile_frontend_design_spec", {
      brief: cli.brief,
      direction: direction(),
    });
    const compiledContent = compiled.structuredContent as { ok: boolean; markdown: string };
    assert.equal(compiledContent.ok, true);
    assert.match(compiledContent.markdown, /# Design Contract/);

    const evalPlan = await callMcpTool("run_domain_eval", {
      domainId: "frontend",
      suitePath: "evals/frontend/slices/design-to-code.json",
      repetitions: 3,
      baselines: ["without-skill", "old-skill", "current-skill"],
    });
    const evalContent = evalPlan.structuredContent as {
      execution: string;
      plan: { entries: unknown[] };
    };
    assert.equal(evalContent.execution, "host-required");
    assert.equal(evalContent.plan.entries.length, 5 * 3 * 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("structured design skill packages contain complete local execution artifacts", async () => {
  for (const skill of ["frontend.visual-design-polish", "frontend.tailwind-ui-polish", "frontend.design-to-code"]) {
    const root = path.resolve("registry/skills", skill);
    const manifest = JSON.parse(await readFile(path.join(root, "skill.manifest.json"), "utf8"));
    for (const key of ["inputSchema", "outputSchema", "workflow", "gates", "evals"]) {
      const artifact = manifest.execution[key];
      assert.doesNotReject(readFile(path.join(root, artifact), "utf8"));
    }
  }
});

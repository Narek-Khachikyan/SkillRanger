import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  type FrontendEvalSuite,
  loadFrontendEvalSuite,
  type FrontendTaskEvidence,
  runFrontendRoutingEval,
  scoreSkillUtility,
  summarizeFrontendEvalSuite,
  validateFrontendTaskEvidence,
  validateFrontendEvalSuite,
} from "../src/evals/frontend.ts";

const execFileAsync = promisify(execFile);

const fixtureProject = path.resolve("fixtures/next-react-ts");

const routingSuite = (triggerPrompts: FrontendEvalSuite["triggerPrompts"]): FrontendEvalSuite => ({
  schemaVersion: "1.0",
  name: "frontend-routing-test",
  targetCounts: {
    triggerPrompts: triggerPrompts.length,
    taskEvals: 1,
  },
  triggerPrompts,
  taskBands: [
    {
      id: "routing-smoke",
      targetCount: 1,
      seedTasks: [
        {
          id: "routing-smoke-task",
          prompt: "Review a frontend page.",
          assertions: ["A routing smoke assertion exists."],
        },
      ],
    },
  ],
  scoring: {
    utilityWeights: {
      functionalCorrectness: 1,
    },
    promotionGates: {},
  },
});

test("frontend eval suite validates and summarizes seed coverage", async () => {
  const suite = await loadFrontendEvalSuite();
  assert.deepEqual(validateFrontendEvalSuite(suite), []);

  const summary = summarizeFrontendEvalSuite(suite);
  assert.equal(summary.triggerPrompts.total, summary.triggerPrompts.target);
  assert.equal(summary.triggerPrompts.target, 87);
  assert.equal(summary.taskEvals.seedTasks, summary.taskEvals.target);
  assert.equal(summary.taskEvals.target, 42);
  assert.equal(
    summary.triggerPrompts.shouldTrigger + summary.triggerPrompts.shouldNotTrigger + summary.triggerPrompts.ambiguous,
    summary.triggerPrompts.total,
  );
  assert.deepEqual(summary.taskEvals.bands, [
    "greenfield-ui",
    "existing-project-modification",
    "repair",
    "polish",
  ]);
});

test("frontend eval suite accepts routing expectations and artifact-aware assertions", () => {
  const suite = {
    schemaVersion: "1.0",
    name: "frontend-routing-schema-test",
    targetCounts: {
      triggerPrompts: 2,
      taskEvals: 1,
    },
    triggerPrompts: [
      {
        id: "trigger-a11y-review",
        kind: "should-trigger",
        text: "Review the signup form accessibility.",
        routingExpected: {
          expectedSkill: "frontend.accessibility-review",
          acceptableAlternates: ["frontend.testing-strategy"],
          shouldNotTrigger: false,
          triageOnly: false,
          falsePositiveSeverity: "high",
        },
      },
      {
        id: "nontrigger-backend-api",
        kind: "should-not-trigger",
        text: "Add pagination to a backend API route.",
        routingExpected: {
          shouldNotTrigger: true,
          falsePositiveSeverity: "medium",
        },
      },
    ],
    taskBands: [
      {
        id: "repair",
        targetCount: 1,
        seedTasks: [
          {
            id: "contrast-regression",
            prompt: "Fix insufficient contrast in a Tailwind dark-mode page.",
            assertions: [
              "Text and focus contrast are checked.",
              {
                text: "Axe violations are resolved or explicitly justified.",
                graderType: "axe",
                requiredArtifacts: ["axe-report"],
              },
              {
                text: "Before and after screenshots show the changed states.",
                graderType: "screenshot",
                requiredArtifacts: ["before-screenshot", "after-screenshot"],
              },
            ],
          },
        ],
      },
    ],
    artifactContract: {
      screenshots: ["before", "after"],
      requiredMetadata: ["viewport", "route"],
      optionalArtifacts: ["trace", "lighthouse"],
    },
    scoring: {
      utilityWeights: {
        functionalCorrectness: 0.5,
        visualQa: 0.5,
      },
      promotionGates: {
        minimumTriggerRecall: 0.85,
      },
    },
  };

  assert.deepEqual(validateFrontendEvalSuite(suite), []);

  const summary = summarizeFrontendEvalSuite(suite);
  assert.deepEqual(summary.triggerPrompts, {
    total: 2,
    shouldTrigger: 1,
    shouldNotTrigger: 1,
    ambiguous: 0,
    target: 2,
  });
  assert.equal(summary.taskEvals.seedTasks, 1);
  assert.deepEqual(summary.taskEvals.bands, ["repair"]);
});

test("frontend eval suite rejects declared coverage that drifts from seeded cases", () => {
  const suite = routingSuite([
    {
      id: "trigger-a11y-review",
      kind: "should-trigger",
      text: "Review the signup form accessibility.",
      routingExpected: { expectedSkill: "frontend.accessibility-review" },
    },
  ]);
  suite.targetCounts.triggerPrompts = 2;
  suite.targetCounts.taskEvals = 2;
  suite.taskBands[0]!.targetCount = 2;

  const issues = validateFrontendEvalSuite(suite);

  assert.ok(issues.includes("targetCounts.triggerPrompts must equal seeded prompts (1)."));
  assert.ok(issues.includes("targetCounts.taskEvals must equal seeded tasks (1)."));
  assert.ok(issues.includes("task band routing-smoke targetCount must equal seeded tasks (1)."));
});

test("frontend eval suite rejects malformed routing, grader, and artifact contracts", () => {
  const issues = validateFrontendEvalSuite({
    schemaVersion: "1.0",
    name: "frontend-routing-schema-test",
    targetCounts: {
      triggerPrompts: 1,
      taskEvals: 1,
    },
    triggerPrompts: [
      {
        id: "trigger-bad-routing",
        kind: "should-trigger",
        text: "Review a page.",
        routingExpected: {
          expectedSkill: " ",
          acceptableAlternates: ["frontend.visual-design-polish", ""],
          shouldNotTrigger: "no",
          triageOnly: "sometimes",
          falsePositiveSeverity: "catastrophic",
        },
      },
    ],
    taskBands: [
      {
        id: "repair",
        targetCount: 1,
        seedTasks: [
          {
            id: "bad-assertion",
            prompt: "Fix the UI.",
            assertions: [
              {
                text: " ",
                graderType: "vision",
                requiredArtifacts: ["screenshot", ""],
              },
            ],
          },
        ],
      },
    ],
    artifactContract: {
      screenshots: ["desktop", ""],
      requiredMetadata: "viewport",
      optionalArtifacts: ["trace", ""],
    },
    scoring: {
      utilityWeights: {
        functionalCorrectness: 1,
      },
      promotionGates: {},
    },
  });

  assert.deepEqual(issues, [
    "trigger prompt trigger-bad-routing routingExpected.expectedSkill is required when present",
    "trigger prompt trigger-bad-routing routingExpected.acceptableAlternates must be non-empty strings",
    "trigger prompt trigger-bad-routing routingExpected.shouldNotTrigger must be boolean",
    "trigger prompt trigger-bad-routing routingExpected.triageOnly must be boolean",
    "trigger prompt trigger-bad-routing routingExpected.falsePositiveSeverity is invalid",
    "task bad-assertion assertion 0 text is required",
    "task bad-assertion assertion 0 graderType is invalid",
    "task bad-assertion assertion 0 requiredArtifacts must be non-empty strings",
    "artifactContract.screenshots must be non-empty strings when present",
    "artifactContract.requiredMetadata must be non-empty strings when present",
    "artifactContract.optionalArtifacts must be non-empty strings when present",
  ]);
});

test("frontend task evidence requires traceable metadata, task coverage, and asserted artifacts", () => {
  const suite = routingSuite([]);
  suite.taskBands[0]!.seedTasks[0]!.assertions = [
    {
      text: "A screenshot proves the responsive state.",
      graderType: "screenshot",
      requiredArtifacts: ["screenshots"],
    },
  ];

  const evidence: FrontendTaskEvidence = {
    schemaVersion: "1.0",
    suiteName: suite.name,
    runs: [
      {
        runId: "candidate-a",
        taskId: "routing-smoke-task",
        skillId: "frontend.visual-design-polish",
        skillVersion: "1.0.0",
        skillChecksum: "sha256:abc123",
        model: "test-model",
        fixture: "fixtures/next-react-ts",
        command: "agent run --task routing-smoke-task",
        durationMs: 1250,
        artifacts: [{ name: "screenshots", path: "artifacts/responsive.png" }],
        assertions: [{ text: "A screenshot proves the responsive state.", status: "passed" }],
      },
    ],
  };

  assert.deepEqual(validateFrontendTaskEvidence(suite, evidence), {
    issues: [],
    metrics: {
      expectedTasks: 1,
      recordedTasks: 1,
      artifactCount: 1,
      passedAssertions: 1,
      failedAssertions: 0,
      unassessedAssertions: 0,
      promotionReady: true,
    },
  });

  evidence.runs[0]!.artifacts = [];
  evidence.runs[0]!.assertions[0]!.status = "not-assessed";
  const invalid = validateFrontendTaskEvidence(suite, evidence);
  assert.ok(invalid.issues.includes("task evidence routing-smoke-task is missing required artifact screenshots"));
  assert.equal(invalid.metrics.promotionReady, false);
  assert.equal(invalid.metrics.unassessedAssertions, 1);
});

test("frontend eval skill utility score applies configured weights", async () => {
  const suite = await loadFrontendEvalSuite();
  const score = scoreSkillUtility(
    {
      functionalCorrectness: 90,
      visualQa: 80,
      accessibility: 70,
      performance: 60,
      projectFit: 80,
      reviewQuality: 75,
      costEfficiency: 85,
      contentDesign: 80,
      tokenDiscipline: 75,
      screenshotEvidence: 85,
      responsiveCoverage: 70,
    },
    suite.scoring.utilityWeights,
  );
  assert.equal(score, 78.4);
});

test("frontend eval routing runner matches Playwright trigger on Next fixture", async () => {
  const report = await runFrontendRoutingEval(
    routingSuite([
      {
        id: "trigger-playwright-flake",
        kind: "should-trigger",
        expectedSkill: "frontend.playwright-debug",
        text: "Our Playwright checkout spec flakes in CI but passes locally. Find the likely cause using trace and artifact evidence.",
        routingExpected: {
          expectedSkill: "frontend.playwright-debug",
        },
      },
    ]),
    { projectRoot: fixtureProject },
  );

  assert.equal(report.metrics.total, 1);
  assert.equal(report.metrics.evaluated, 1);
  assert.equal(report.metrics.passed, 1);
  assert.equal(report.failures.length, 0);
});

test("frontend eval routing runner treats backend prompt as should-not-trigger", async () => {
  const report = await runFrontendRoutingEval(
    routingSuite([
      {
        id: "nontrigger-backend-api",
        kind: "should-not-trigger",
        text: "Add cursor pagination to this Express API endpoint and update the database query.",
        routingExpected: {
          shouldNotTrigger: true,
        },
      },
    ]),
    { projectRoot: fixtureProject },
  );

  assert.equal(report.metrics.total, 1);
  assert.equal(report.metrics.evaluated, 1);
  assert.equal(report.metrics.passed, 1);
  assert.equal(report.metrics.shouldNotTriggerSpecificity, 1);
  assert.equal(report.failures.length, 0);
});

test("frontend eval routing runner passes the full Next fixture suite", async () => {
  const suite = await loadFrontendEvalSuite();
  const report = await runFrontendRoutingEval(suite, { projectRoot: fixtureProject });

  assert.equal(report.metrics.failed, 0);
  assert.equal(report.metrics.overallPassRate, 1);
  assert.equal(report.metrics.expectedSkillRecall, 1);
  assert.equal(report.metrics.shouldNotTriggerSpecificity, 1);
  assert.deepEqual(report.failures, []);
});

test("eval:frontend CLI reports suite summary as JSON", async () => {
  const { stdout } = await execFileAsync("node", [
    "src/cli/index.ts",
    "eval:frontend",
    "--json",
  ]);
  const report = JSON.parse(stdout) as {
    ok: boolean;
    issues: string[];
    summary: { triggerPrompts: { target: number }; taskEvals: { target: number } };
  };
  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
  assert.equal(report.summary.triggerPrompts.target, 87);
  assert.equal(report.summary.taskEvals.target, 42);
  assert.equal("routingEval" in report, false);
});

test("eval:frontend --run-routing --json returns routing metrics", async () => {
  const suite = routingSuite([
    {
      id: "trigger-playwright-flake",
      kind: "should-trigger",
      expectedSkill: "frontend.playwright-debug",
      text: "Our Playwright checkout spec flakes in CI but passes locally. Find the likely cause using trace and artifact evidence.",
      routingExpected: {
        expectedSkill: "frontend.playwright-debug",
      },
    },
    {
      id: "nontrigger-backend-api",
      kind: "should-not-trigger",
      text: "Add cursor pagination to this Express API endpoint and update the database query.",
      routingExpected: {
        shouldNotTrigger: true,
      },
    },
  ]);
  const dir = await mkdtemp(path.join(tmpdir(), "skillranger-frontend-eval-"));
  const suitePath = path.join(dir, "suite.json");
  await writeFile(suitePath, JSON.stringify(suite), "utf8");

  const { stdout } = await execFileAsync("node", [
    "src/cli/index.ts",
    "eval:frontend",
    "--run-routing",
    "--project",
    "fixtures/next-react-ts",
    "--suite",
    suitePath,
    "--json",
  ]);
  const report = JSON.parse(stdout) as {
    ok: boolean;
    routingEval: { metrics: { total: number; evaluated: number; passed: number; overallPassRate: number } };
  };

  assert.equal(report.ok, true);
  assert.equal(report.routingEval.metrics.total, 2);
  assert.equal(report.routingEval.metrics.evaluated, 2);
  assert.equal(report.routingEval.metrics.passed, 2);
  assert.equal(report.routingEval.metrics.overallPassRate, 1);
});

test("eval:frontend verifies complete task evidence as a promotion gate", async () => {
  const suite = routingSuite([]);
  const evidence: FrontendTaskEvidence = {
    schemaVersion: "1.0",
    suiteName: suite.name,
    runs: [
      {
        runId: "candidate-a",
        taskId: "routing-smoke-task",
        skillId: "frontend.visual-design-polish",
        skillVersion: "1.0.0",
        skillChecksum: "sha256:abc123",
        model: "test-model",
        fixture: "fixtures/next-react-ts",
        command: "agent run --task routing-smoke-task",
        durationMs: 1250,
        artifacts: [],
        assertions: [{ text: "A routing smoke assertion exists.", status: "passed" }],
      },
    ],
  };
  const dir = await mkdtemp(path.join(tmpdir(), "skillranger-frontend-eval-"));
  const suitePath = path.join(dir, "suite.json");
  const evidencePath = path.join(dir, "task-evidence.json");
  await writeFile(suitePath, JSON.stringify(suite), "utf8");
  await writeFile(evidencePath, JSON.stringify(evidence), "utf8");

  const { stdout } = await execFileAsync("node", [
    "src/cli/index.ts",
    "eval:frontend",
    "--suite",
    suitePath,
    "--verify-task-evidence",
    evidencePath,
    "--json",
  ]);
  const report = JSON.parse(stdout) as {
    ok: boolean;
    taskEvidence: { metrics: { promotionReady: boolean; passedAssertions: number } };
  };

  assert.equal(report.ok, true);
  assert.equal(report.taskEvidence.metrics.promotionReady, true);
  assert.equal(report.taskEvidence.metrics.passedAssertions, 1);
});

test("eval:frontend exits non-zero when routing evaluation fails", async () => {
  const suite = routingSuite([
    {
      id: "wrong-routing-expectation",
      kind: "should-trigger",
      text: "Improve the Tailwind page spacing and responsive layout.",
      routingExpected: {
        expectedSkill: "frontend.accessibility-review",
      },
    },
  ]);
  const dir = await mkdtemp(path.join(tmpdir(), "skillranger-frontend-eval-"));
  const suitePath = path.join(dir, "suite.json");
  await writeFile(suitePath, JSON.stringify(suite), "utf8");

  await assert.rejects(
    execFileAsync("node", [
      "src/cli/index.ts",
      "eval:frontend",
      "--run-routing",
      "--project",
      "fixtures/next-react-ts",
      "--suite",
      suitePath,
      "--json",
    ]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const stdout = (error as Error & { stdout?: string }).stdout ?? "";
      const report = JSON.parse(stdout) as { ok: boolean; routingEval: { failures: unknown[] } };
      assert.equal(report.ok, false);
      assert.equal(report.routingEval.failures.length, 1);
      return true;
    },
  );
});

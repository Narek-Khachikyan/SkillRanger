import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  type FrontendEvalSuite,
  type FrontendPairwiseReview,
  loadFrontendEvalSuite,
  type FrontendTaskEvidence,
  runFrontendRoutingEval,
  scoreSkillUtility,
  selectFrontendTriggerPrompts,
  summarizeFrontendEvalSuite,
  summarizeFrontendVariance,
  validateFrontendPairwiseReview,
  validateFrontendTaskEvidence,
  validateFrontendEvalSuite,
} from "../src/evals/frontend.ts";
import { frontendDomainManifest } from "../src/domains/frontend/routing.ts";
import { loadLocalRegistry } from "../src/registry/index.ts";

const execFileAsync = promisify(execFile);

const fixtureProject = path.resolve("fixtures/next-react-ts");

test("release check includes bilingual frontend routing evidence", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(packageJson.scripts["eval:frontend:ru"], /--locale ru/);
  assert.match(packageJson.scripts["eval:frontend:ru"], /--run-routing/);
  assert.match(packageJson.scripts["release:check"], /npm run eval:frontend:ru/);
});

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
  assert.equal(summary.triggerPrompts.target, 157);
  assert.equal(summary.taskEvals.seedTasks, summary.taskEvals.target);
  assert.equal(summary.taskEvals.target, 54);
  assert.equal(
    summary.triggerPrompts.shouldTrigger + summary.triggerPrompts.shouldNotTrigger + summary.triggerPrompts.ambiguous,
    summary.triggerPrompts.total,
  );
  assert.deepEqual(summary.taskEvals.bands, [
    "greenfield-ui",
    "existing-project-modification",
    "repair",
    "polish",
    "motion-quality",
  ]);
});

test("frontend eval locale selection assigns Cyrillic and mixed prompts to Russian", () => {
  const suite = routingSuite([
    { id: "english", kind: "should-trigger", text: "Review the frontend layout." },
    { id: "russian", kind: "should-trigger", text: "Проверь доступность формы." },
    { id: "cyrillic", kind: "should-trigger", text: "І" },
    { id: "mixed", kind: "ambiguous", text: "Проверь Tailwind layout." },
    { id: "symbols", kind: "should-not-trigger", text: "1234 — ?" },
  ]);

  assert.deepEqual(selectFrontendTriggerPrompts(suite, "ru").map((prompt) => prompt.id), ["russian", "cyrillic", "mixed"]);
  assert.deepEqual(selectFrontendTriggerPrompts(suite, "en").map((prompt) => prompt.id), ["english"]);
  assert.deepEqual(selectFrontendTriggerPrompts(suite, "all").map((prompt) => prompt.id), [
    "english",
    "russian",
    "cyrillic",
    "mixed",
    "symbols",
  ]);
});

test("frontend eval locale summary preserves selected and full-suite targets", async () => {
  const suite = await loadFrontendEvalSuite();
  const all = summarizeFrontendEvalSuite(suite, "all");
  const russian = summarizeFrontendEvalSuite(suite, "ru");

  assert.equal(all.locale, "all");
  assert.equal(all.triggerPrompts.total, 157);
  assert.equal(all.triggerPrompts.target, 157);
  assert.equal(all.triggerPrompts.suiteTarget, 157);
  assert.equal(russian.locale, "ru");
  assert.equal(russian.triggerPrompts.total > 0, true);
  assert.equal(russian.triggerPrompts.total < 157, true);
  assert.equal(russian.triggerPrompts.target, russian.triggerPrompts.total);
  assert.equal(russian.triggerPrompts.suiteTarget, 157);
});

test("frontend suite freezes Russian routing coverage for every owned skill", async () => {
  const [suite, skills] = await Promise.all([
    loadFrontendEvalSuite(),
    loadLocalRegistry("registry"),
  ]);
  const owned = new Set(
    frontendDomainManifest.ownership.flatMap((rule) => [rule.primarySkill, ...rule.supportingSkills]),
  );
  for (const skillId of owned) {
    const prompts = suite.triggerPrompts.filter(
      (prompt) => /[А-Яа-яЁё]/u.test(prompt.text) &&
        (prompt.expectedSkill === skillId || prompt.routingExpected?.expectedSkill === skillId),
    );
    assert.equal(prompts.filter((prompt) => prompt.kind === "should-trigger").length >= 3, true, skillId);
    assert.equal(prompts.filter((prompt) => prompt.kind === "ambiguous").length >= 1, true, skillId);
  }
  const russianTaskIds = new Set(
    suite.taskBands
      .flatMap((band) => band.seedTasks)
      .filter((task) => /[А-Яа-яЁё]/u.test(task.prompt))
      .map((task) => task.id),
  );
  assert.equal(russianTaskIds.size >= 3, true);
  const promoted = skills.filter((skill) =>
    ["task-eval", "curated"].includes(skill.manifest.evaluation?.status ?? "none"),
  );
  for (const skill of promoted) {
    const slice = suite.skillSlices?.find((item) => item.skillId === skill.manifest.id);
    assert.equal(
      slice?.taskIds.some((taskId) => russianTaskIds.has(taskId)),
      true,
      `${skill.manifest.id} needs Russian task evidence`,
    );
  }
});

test("dedicated design skill eval suites each provide five valid tasks", async () => {
  for (const suitePath of [
    "evals/frontend/slices/visual-direction.json",
    "evals/frontend/slices/tailwind-execution.json",
    "evals/frontend/slices/design-to-code.json",
  ]) {
    const suite = await loadFrontendEvalSuite(path.resolve(suitePath));
    assert.deepEqual(validateFrontendEvalSuite(suite), [], suitePath);
    assert.equal(summarizeFrontendEvalSuite(suite).taskEvals.seedTasks, 5, suitePath);
  }
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
    suiteTarget: 2,
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

test("frontend eval suite rejects string values for numeric promotion gates", () => {
  const suite = routingSuite([]);
  suite.scoring.promotionGates.minimumRepetitions = "3";
  assert.ok(
    validateFrontendEvalSuite(suite).includes(
      "promotionGates.minimumRepetitions must be a finite number when present",
    ),
  );
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
      expectedRuns: 1,
      recordedRuns: 1,
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

test("A/B/C evidence requires the same model and fixture across baselines", () => {
  const suite = routingSuite([]);
  const run = (
    baseline: string,
    model: string,
    fixture: string,
  ): FrontendTaskEvidence["runs"][number] => ({
    runId: baseline,
    taskId: "routing-smoke-task",
    baseline,
    skillId: baseline === "without-skill" ? "(none)" : "frontend.visual-design-polish",
    skillVersion: baseline === "without-skill" ? "(none)" : "1.0.0",
    skillChecksum: baseline === "without-skill" ? "(none)" : "sha256:test",
    model,
    fixture,
    command: "agent run",
    durationMs: 1,
    exitCode: 0,
    artifacts: [],
    assertions: [{ text: "A routing smoke assertion exists.", status: "passed" }],
  });
  const evidence: FrontendTaskEvidence = {
    schemaVersion: "1.0",
    suiteName: suite.name,
    baselines: ["without-skill", "current-skill"],
    runs: [
      run("without-skill", "model-a", "fixture-a"),
      run("current-skill", "model-b", "fixture-b"),
    ],
  };
  const report = validateFrontendTaskEvidence(suite, evidence);
  assert.ok(report.issues.includes("task evidence routing-smoke-task must use the same model across baselines"));
  assert.ok(report.issues.includes("task evidence routing-smoke-task must use the same fixture across baselines"));
  assert.equal(report.metrics.promotionReady, false);
});

test("frontend pairwise review requires blinded human coverage before promotion", () => {
  const suite = routingSuite([]);
  suite.scoring.promotionGates.minimumBlindPreferenceShare = 0.6;
  const review: FrontendPairwiseReview = {
    schemaVersion: "1.0",
    suiteName: suite.name,
    candidateUnderTestLabel: "A",
    comparisons: [
      {
        comparisonId: "routing-smoke-task-v1",
        taskId: "routing-smoke-task",
        labels: ["A", "B"],
        winner: "A",
        reviewer: { kind: "human", id: "reviewer-1" },
      },
    ],
  };

  assert.deepEqual(validateFrontendPairwiseReview(suite, review), {
    issues: [],
    metrics: {
      expectedTasks: 1,
      reviewedTasks: 1,
      decisiveComparisons: 1,
      candidateWins: 1,
      candidateLosses: 0,
      ties: 0,
      abstains: 0,
      candidatePreferenceShare: 1,
      promotionReady: true,
    },
  });

  review.comparisons[0]!.reviewer.kind = "llm_judge" as "human";
  const invalid = validateFrontendPairwiseReview(suite, review);
  assert.ok(invalid.issues.includes("pairwise review routing-smoke-task reviewer must be human"));
  assert.equal(invalid.metrics.promotionReady, false);
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

test("Russian routing report evaluates every frontend-owned canonical skill", async () => {
  const suite = await loadFrontendEvalSuite();
  const russianPrompts = selectFrontendTriggerPrompts(suite, "ru");
  const report = await runFrontendRoutingEval(suite, {
    projectRoot: fixtureProject,
    locale: "ru",
  });
  const owned = new Set(frontendDomainManifest.ownership.map((rule) => rule.primarySkill));

  assert.equal(report.locale, "ru");
  assert.equal(report.selectedPrompts, russianPrompts.length);
  assert.equal(report.suitePrompts, 157);
  assert.equal(report.metrics.total, russianPrompts.length);
  assert.equal(report.metrics.failed, 0);
  for (const skillId of owned) {
    assert.equal(
      russianPrompts.some((prompt) =>
        (prompt.routingExpected?.expectedSkill ?? prompt.expectedSkill) === skillId),
      true,
      `${skillId} needs an evaluated Russian routing prompt`,
    );
  }
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
  assert.equal(report.summary.triggerPrompts.target, 157);
  assert.equal(report.summary.taskEvals.target, 54);
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

test("eval:frontend rejects an invalid locale", async () => {
  await assert.rejects(
    execFileAsync("node", [
      "src/cli/index.ts",
      "eval:frontend",
      "--locale",
      "mixed",
      "--json",
    ]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match((error as Error & { stderr?: string }).stderr ?? "", /--locale must be one of: en, ru, all\./);
      return true;
    },
  );
});

test("eval:frontend human output distinguishes selected and suite prompt targets", async () => {
  const { stdout } = await execFileAsync("node", [
    "src/cli/index.ts",
    "eval:frontend",
    "--locale",
    "ru",
  ]);

  assert.match(stdout, /Locale: ru/);
  assert.match(stdout, /Trigger prompts: 58\/58 selected; suite target: 157/);
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

test("eval:frontend verifies a blinded human pairwise review", async () => {
  const suite = routingSuite([]);
  suite.scoring.promotionGates.minimumBlindPreferenceShare = 0.6;
  const review: FrontendPairwiseReview = {
    schemaVersion: "1.0",
    suiteName: suite.name,
    candidateUnderTestLabel: "A",
    comparisons: [
      {
        comparisonId: "routing-smoke-task-v1",
        taskId: "routing-smoke-task",
        labels: ["A", "B"],
        winner: "A",
        reviewer: { kind: "human", id: "reviewer-1" },
      },
    ],
  };
  const dir = await mkdtemp(path.join(tmpdir(), "skillranger-frontend-eval-"));
  const suitePath = path.join(dir, "suite.json");
  const reviewPath = path.join(dir, "pairwise-review.json");
  await writeFile(suitePath, JSON.stringify(suite), "utf8");
  await writeFile(reviewPath, JSON.stringify(review), "utf8");

  const { stdout } = await execFileAsync("node", [
    "src/cli/index.ts",
    "eval:frontend",
    "--suite",
    suitePath,
    "--verify-pairwise-review",
    reviewPath,
    "--json",
  ]);
  const report = JSON.parse(stdout) as {
    ok: boolean;
    pairwiseReview: { metrics: { promotionReady: boolean; candidatePreferenceShare: number } };
  };

  assert.equal(report.ok, true);
  assert.equal(report.pairwiseReview.metrics.promotionReady, true);
  assert.equal(report.pairwiseReview.metrics.candidatePreferenceShare, 1);
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

import {
  BASELINE_KINDS,
  executeRunPlan,
  generateRunPlan,
  type BaselineConfigMap,
} from "../src/evals/runner.ts";

const fullSuite = () => loadFrontendEvalSuite();

const smallSuite = (): FrontendEvalSuite => ({
  schemaVersion: "1.0",
  name: "runner-test",
  targetCounts: { triggerPrompts: 0, taskEvals: 2 },
  triggerPrompts: [],
  taskBands: [
    {
      id: "test-band",
      targetCount: 2,
      seedTasks: [
        { id: "task-a", prompt: "Do task A", assertions: ["Task A assertion"] },
        { id: "task-b", prompt: "Do task B", assertions: ["Task B assertion"] },
      ],
    },
  ],
  scoring: { utilityWeights: { functionalCorrectness: 1 }, promotionGates: {} },
});

test("runner generates correct plan size for all baselines", async () => {
  const suite = await fullSuite();
  const plan = generateRunPlan(suite, { baselines: ["without-skill", "current-skill"] });
  assert.equal(plan.suiteName, suite.name);
  assert.equal(plan.entries.length, (suite.taskBands ?? []).reduce((c, b) => c + b.seedTasks.length, 0) * 2);
});

test("runner generates correct plan size with three baselines", async () => {
  const suite = await fullSuite();
  const plan = generateRunPlan(suite, { baselines: ["without-skill", "old-skill", "current-skill"] });
  const taskCount = (suite.taskBands ?? []).reduce((c, b) => c + b.seedTasks.length, 0);
  assert.equal(plan.entries.length, taskCount * 3);
});

test("runner generates plan with single baseline", async () => {
  const suite = await fullSuite();
  const plan = generateRunPlan(suite, { baselines: ["current-skill"] });
  const taskCount = (suite.taskBands ?? []).reduce((c, b) => c + b.seedTasks.length, 0);
  assert.equal(plan.entries.length, taskCount);
  assert.ok(plan.entries.every((e) => e.baselineKind === "current-skill"));
});

test("runner plan respects task id filter", async () => {
  const suite = await fullSuite();
  const plan = generateRunPlan(suite, {
    baselines: ["without-skill"],
    filter: ["greenfield-crm-first-screen"],
  });
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0]!.taskId, "greenfield-crm-first-screen");
});

test("runner plan filter matches substring", async () => {
  const suite = await fullSuite();
  const plan = generateRunPlan(suite, {
    baselines: ["without-skill"],
    filter: ["greenfield"],
  });
  assert.ok(plan.entries.length > 0);
  assert.ok(plan.entries.every((e) => e.taskId.includes("greenfield")));
});

test("runner plan exposes prompt and bandId", async () => {
  const plan = generateRunPlan(smallSuite(), { baselines: ["without-skill"] });
  assert.equal(plan.entries.length, 2);
  assert.equal(plan.entries[0]!.prompt, "Do task A");
  assert.equal(plan.entries[0]!.bandId, "test-band");
  assert.equal(plan.entries[0]!.assertions.length, 1);
});

test("runner filters a skill slice and expands deterministic repetitions", async () => {
  const suite = await fullSuite();
  const plan = generateRunPlan(suite, {
    baselines: ["without-skill", "old-skill", "current-skill"],
    skillSlice: "visual-direction",
    repetitions: 3,
  });
  assert.equal(plan.repetitions, 3);
  assert.equal(plan.entries.length, 6 * 3 * 3);
  assert.deepEqual([...new Set(plan.entries.map((entry) => entry.repetition))], [1, 2, 3]);
  assert.ok(plan.entries.every((entry) => entry.taskId !== "greenfield-single-reference-fidelity"));
});

test("runner rejects an unknown skill slice", () => {
  assert.throws(
    () => generateRunPlan(smallSuite(), { baselines: ["current-skill"], skillSlice: "missing" }),
    /Skill slice not found/,
  );
});

test("runner rejects empty baseline plans", () => {
  assert.throws(
    () => generateRunPlan(smallSuite(), { baselines: [] }),
    /at least one baseline/,
  );
});

test("runner rejects duplicate baseline plans", () => {
  assert.throws(
    () => generateRunPlan(smallSuite(), {
      baselines: ["current-skill", "current-skill"],
    }),
    /baseline values must be unique/,
  );
});

test("variance promotion requires complete A/B/C model groups", () => {
  const suite = routingSuite([]);
  suite.scoring.promotionGates.minimumRepetitions = 3;
  suite.scoring.promotionGates.minimumNoSkillDelta = 10;
  suite.scoring.promotionGates.minimumOldSkillDelta = 5;
  const evidence: FrontendTaskEvidence = {
    schemaVersion: "1.0",
    suiteName: suite.name,
    repetitions: 3,
    baselines: ["current-skill"],
    runs: [1, 2, 3].map((repetition) => ({
      runId: `current-${repetition}`,
      taskId: "routing-smoke-task",
      baseline: "current-skill",
      repetition,
      skillId: "frontend.visual-design-polish",
      skillVersion: "1.0.0",
      skillChecksum: "sha256:test",
      model: "test-model",
      fixture: "fixture",
      command: "agent run",
      durationMs: 1,
      artifacts: [],
      assertions: [{ text: "A routing smoke assertion exists.", status: "passed" }],
    })),
  };
  const summary = summarizeFrontendVariance(evidence, suite);
  assert.equal(summary.promotionReady, false);
  assert.ok(summary.issues.some((issue) => issue.includes("without-skill")));
  assert.ok(summary.issues.some((issue) => issue.includes("old-skill")));
});

test("variance summary reports mean, worst run, and variance deltas", () => {
  const makeRun = (
    baseline: string,
    repetition: number,
    statuses: Array<"passed" | "failed">,
  ): FrontendTaskEvidence["runs"][number] => ({
    runId: `${baseline}-${repetition}`,
    taskId: "routing-smoke-task",
    baseline,
    repetition,
    skillId: baseline === "without-skill" ? "(none)" : "frontend.visual-design-polish",
    skillVersion: baseline === "without-skill" ? "(none)" : "1.0.0",
    skillChecksum: baseline === "without-skill" ? "(none)" : "sha256:test",
    model: "test-model",
    fixture: "fixture",
    command: "agent run",
    durationMs: 100,
    artifacts: [],
    assertions: statuses.map((status, index) => ({ text: `assertion-${index}`, status })),
  });
  const evidence: FrontendTaskEvidence = {
    schemaVersion: "1.0",
    suiteName: "frontend-routing-test",
    repetitions: 3,
    baselines: ["without-skill", "current-skill"],
    runs: [
      makeRun("without-skill", 1, ["passed", "failed"]),
      makeRun("without-skill", 2, ["failed", "failed"]),
      makeRun("without-skill", 3, ["passed", "failed"]),
      makeRun("current-skill", 1, ["passed", "passed"]),
      makeRun("current-skill", 2, ["passed", "passed"]),
      makeRun("current-skill", 3, ["passed", "failed"]),
    ],
  };
  const summary = summarizeFrontendVariance(evidence);
  const candidate = summary.groups.find((group) => group.baseline === "current-skill");
  assert.equal(candidate?.passRate, 0.8333);
  assert.equal(candidate?.worstRunPassRate, 0.5);
  assert.ok((candidate?.passRateStdDev ?? 0) > 0);
  assert.ok((summary.comparisons[0]?.passRateDelta ?? 0) > 0);
  assert.ok((summary.comparisons[0]?.worstRunDelta ?? 0) > 0);
  assert.equal(summary.promotionReady, true);
});

test("task evidence validates only the declared skill slice across repetitions", async () => {
  const suite = await fullSuite();
  const plan = generateRunPlan(suite, {
    baselines: ["without-skill"],
    skillSlice: "design-to-code",
    repetitions: 2,
  });
  const evidence = await executeRunPlan({
    plan,
    commandTemplate: 'echo "{{taskId}} {{repetition}}"',
    outputDir: await mkdtemp(path.join(tmpdir(), "runner-slice-evidence-")),
    dryRun: true,
    baselinesConfig: {
      "without-skill": { kind: "without-skill", model: "test-model", fixture: "fixture" },
    },
    projectRoot: ".",
  });
  assert.equal(evidence.skillSlice, "design-to-code");
  assert.equal(evidence.runs.length, 4);
  for (const run of evidence.runs) {
    run.durationMs = 1;
    run.exitCode = 0;
    run.artifacts = [
      { name: "screenshots", path: "screenshots/result.png" },
      { name: "responsiveMatrix", path: "artifacts/responsive.json" },
    ];
    for (const assertion of run.assertions) assertion.status = "passed";
  }
  const report = validateFrontendTaskEvidence(suite, evidence);
  assert.equal(report.metrics.expectedTasks, 2);
  assert.equal(report.metrics.expectedRuns, 4);
  assert.deepEqual(report.issues, []);
});

test("variance summary detects a false verified completion claim", () => {
  const evidence: FrontendTaskEvidence = {
    schemaVersion: "1.0",
    suiteName: "test",
    runs: [{
      runId: "false-claim",
      taskId: "task",
      baseline: "current-skill",
      skillId: "frontend.visual-design-polish",
      skillVersion: "1.0.0",
      skillChecksum: "sha256:test",
      model: "test-model",
      fixture: "fixture",
      command: "agent run",
      durationMs: 1,
      artifacts: [],
      assertions: [{ text: "hard gate", status: "failed" }],
      verification: {
        outcome: "verified",
        hardGatesPassed: false,
        criticalFindings: 1,
      },
    }],
  };
  const summary = summarizeFrontendVariance(evidence);
  assert.equal(summary.groups[0]?.falseCompletionClaims, 1);
  assert.equal(summary.promotionReady, false);
});

test("variance promotion applies repetition, delta, and standard-deviation gates", () => {
  const suite = routingSuite([]);
  suite.scoring.promotionGates.minimumRepetitions = 3;
  suite.scoring.promotionGates.minimumNoSkillDelta = 10;
  suite.scoring.promotionGates.minimumOldSkillDelta = 5;
  suite.scoring.promotionGates.maximumPassRateStdDev = 0.15;
  const run = (
    baseline: string,
    repetition: number,
    statuses: Array<"passed" | "failed">,
  ): FrontendTaskEvidence["runs"][number] => ({
    runId: `${baseline}-${repetition}`,
    taskId: "routing-smoke-task",
    baseline,
    repetition,
    skillId: baseline === "without-skill" ? "(none)" : "frontend.visual-design-polish",
    skillVersion: baseline === "without-skill" ? "(none)" : "1.0.0",
    skillChecksum: baseline === "without-skill" ? "(none)" : "sha256:test",
    model: "test-model",
    fixture: "fixture",
    command: "agent run",
    durationMs: 1,
    artifacts: [],
    assertions: statuses.map((status, index) => ({ text: `assertion-${index}`, status })),
  });
  const evidence: FrontendTaskEvidence = {
    schemaVersion: "1.0",
    suiteName: suite.name,
    repetitions: 2,
    baselines: ["without-skill", "old-skill", "current-skill"],
    runs: [
      run("without-skill", 1, ["passed", "failed"]),
      run("without-skill", 2, ["passed", "failed"]),
      run("old-skill", 1, ["passed", "failed"]),
      run("old-skill", 2, ["passed", "failed"]),
      run("current-skill", 1, ["passed", "passed"]),
      run("current-skill", 2, ["failed", "failed"]),
    ],
  };
  const summary = summarizeFrontendVariance(evidence, suite);
  assert.equal(summary.promotionReady, false);
  assert.ok(summary.issues.some((issue) => issue.includes("at least 3 repetitions")));
  assert.ok(summary.issues.some((issue) => issue.includes("variance")));
  assert.ok(summary.issues.some((issue) => issue.includes("pass-rate delta")));
});

test("runner dry run does not execute or write output", async () => {
  const suite = smallSuite();
  const plan = generateRunPlan(suite, { baselines: ["without-skill"] });
  const outputDir = await mkdtemp(path.join(tmpdir(), "runner-dry-run-"));
  try {
    const evidence = await executeRunPlan({
      plan, commandTemplate: 'echo "hello"', outputDir, dryRun: true, baselinesConfig: {}, projectRoot: ".",
    });
    assert.equal(evidence.runs.length, 2);
    assert.equal(evidence.runs[0]!.durationMs, 0);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("runner rejects an unterminated command quote", async () => {
  const plan = generateRunPlan(smallSuite(), {
    baselines: ["without-skill"],
  });
  await assert.rejects(
    executeRunPlan({
      plan,
      commandTemplate: 'node -e "broken',
      outputDir: path.join(tmpdir(), "runner-invalid-command"),
      dryRun: true,
      baselinesConfig: {},
    }),
    /unterminated quote/,
  );
});

test("eval task runner emits clean JSON in dry-run mode", async () => {
  const suite = smallSuite();
  const dir = await mkdtemp(path.join(tmpdir(), "runner-json-"));
  const suitePath = path.join(dir, "suite.json");
  await writeFile(suitePath, JSON.stringify(suite));
  try {
    const { stdout } = await execFileAsync("node", [
      "src/cli/index.ts",
      "eval:frontend",
      "--suite",
      suitePath,
      "--run-tasks",
      "--project",
      ".",
      "--baselines",
      "without-skill,current-skill",
      "--command",
      'echo "{{taskId}}:{{baseline}}"',
      "--dry-run",
      "--json",
    ]);
    const evidence = JSON.parse(stdout) as FrontendTaskEvidence;
    assert.equal(evidence.runs.length, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runner executes command and records stdout/stderr", async () => {
  const suite = smallSuite();
  const plan = generateRunPlan(suite, { baselines: ["without-skill"] });
  const outputDir = await mkdtemp(path.join(tmpdir(), "runner-exec-"));
  try {
    const evidence = await executeRunPlan({
      plan, commandTemplate: 'echo "task={{taskId}} baseline={{baseline}}"', outputDir, baselinesConfig: {}, projectRoot: ".",
    });
    assert.equal(evidence.runs.length, 2);
    for (const run of evidence.runs) {
      assert.ok(run.durationMs > 0);
      assert.ok(run.artifacts.length >= 2);
      const stdoutContent = await readFile(run.artifacts.find((a) => a.name === "stdout")!.path, "utf8");
      assert.ok(stdoutContent.includes(`task=${run.taskId}`));
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("runner records exit code and signal in task-meta.json", async () => {
  const suite = smallSuite();
  const plan = generateRunPlan(suite, { baselines: ["without-skill"] });
  const outputDir = await mkdtemp(path.join(tmpdir(), "runner-meta-"));
  try {
    await executeRunPlan({
      plan, commandTemplate: 'node -e "process.exit(42)"', outputDir, baselinesConfig: {}, projectRoot: ".",
    });
    const metaPath = path.join(outputDir, "task-a", "without-skill", "task-meta.json");
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    assert.equal(meta.exitCode, 42);
    assert.ok(meta.durationMs > 0);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("runner respects resume flag and skips completed runs", async () => {
  const suite = smallSuite();
  const plan = generateRunPlan(suite, { baselines: ["without-skill"] });
  const outputDir = await mkdtemp(path.join(tmpdir(), "runner-resume-"));
  try {
    await executeRunPlan({
      plan, commandTemplate: 'echo "first"', outputDir, baselinesConfig: {}, projectRoot: ".",
    });
    const evidence2 = await executeRunPlan({
      plan, commandTemplate: 'echo "second"', outputDir, resume: true, baselinesConfig: {}, projectRoot: ".",
    });
    assert.equal(evidence2.runs.length, 2);
    for (const run of evidence2.runs) assert.ok(run.durationMs > 0);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("runner includes metadata from baseline config", async () => {
  const suite = smallSuite();
  const plan = generateRunPlan(suite, { baselines: ["current-skill"] });
  const outputDir = await mkdtemp(path.join(tmpdir(), "runner-meta-config-"));
  const baselinesConfig: BaselineConfigMap = {
    "current-skill": { kind: "current-skill", skillId: "frontend.test-skill", skillVersion: "1.0.0", skillChecksum: "sha256:abc", model: "test-model", fixture: "test-fixture" },
  };
  try {
    const evidence = await executeRunPlan({
      plan, commandTemplate: 'echo "test"', outputDir, baselinesConfig, projectRoot: ".",
    });
    assert.equal(evidence.runs.length, 2);
    const run = evidence.runs[0]!;
    assert.equal(run.skillId, "frontend.test-skill");
    assert.equal(run.skillVersion, "1.0.0");
    assert.equal(run.skillChecksum, "sha256:abc");
    assert.equal(run.model, "test-model");
    assert.equal(run.fixture, "test-fixture");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("runner output is compatible with validateFrontendTaskEvidence", async () => {
  const suite = smallSuite();
  const plan = generateRunPlan(suite, { baselines: ["current-skill"] });
  const outputDir = await mkdtemp(path.join(tmpdir(), "runner-compat-"));
  const baselinesConfig: BaselineConfigMap = {
    "current-skill": { kind: "current-skill", skillId: "frontend.test-skill", skillVersion: "1.0.0", skillChecksum: "sha256:abc", model: "test-model", fixture: "test-fixture" },
  };
  try {
    const evidence = await executeRunPlan({
      plan, commandTemplate: 'echo "test"', outputDir, baselinesConfig, projectRoot: ".",
    });
    const report = validateFrontendTaskEvidence(suite, evidence);
    assert.equal(report.metrics.expectedTasks, report.metrics.recordedTasks);
    assert.equal(report.metrics.expectedRuns, report.metrics.recordedRuns);
    assert.equal(report.metrics.passedAssertions, 0);
    assert.equal(report.metrics.unassessedAssertions, 2);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("runner evidence keeps each baseline as a distinct run", async () => {
  const suite = smallSuite();
  const plan = generateRunPlan(suite, {
    baselines: ["without-skill", "current-skill"],
  });
  const outputDir = await mkdtemp(path.join(tmpdir(), "runner-baselines-"));
  try {
    const evidence = await executeRunPlan({
      plan,
      commandTemplate: 'echo "{{baseline}}"',
      outputDir,
      baselinesConfig: {},
      projectRoot: ".",
    });
    const report = validateFrontendTaskEvidence(suite, evidence);
    assert.deepEqual(evidence.baselines, ["without-skill", "current-skill"]);
    assert.equal(report.metrics.expectedTasks, 2);
    assert.equal(report.metrics.recordedTasks, 2);
    assert.equal(report.metrics.expectedRuns, 4);
    assert.equal(report.metrics.recordedRuns, 4);
    assert.ok(!report.issues.some((issue) => issue.includes("duplicate")));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

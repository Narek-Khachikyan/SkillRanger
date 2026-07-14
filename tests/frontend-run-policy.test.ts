import test from "node:test";
import assert from "node:assert/strict";
import type { Recommendation } from "../src/types.ts";
import type { DesignBrief } from "../src/domains/frontend/design/index.ts";
import { evaluateFrontendRunPolicy } from "../src/domains/frontend/run-policy.ts";
import { getDomainPack } from "../src/domains/registry.ts";
import "../src/domains/bundled.ts";
import { createSkillRun, reduceSkillRun } from "../src/runtime/skill-run/reducer.ts";
import { readFile } from "node:fs/promises";

const recommendation = (skillId: string, role: "primary" | "companion") =>
  ({ skillId, role }) as Recommendation;

const visualRecommendations = [
  recommendation("frontend.visual-design-polish", "primary"),
  recommendation("frontend.accessibility-review", "companion"),
];

const tailwindRecommendations = [
  recommendation("frontend.tailwind-ui-polish", "primary"),
];

const completeBrief: DesignBrief = {
  schemaVersion: "1.0",
  product: {
    domain: "developer tools",
    primaryUserOrActor: "frontend engineers",
    primaryTask: "inspect build regressions",
    contentTypes: ["build results"],
    usageFrequency: "frequent",
    stakes: ["release quality"],
  },
  surface: {
    type: "dashboard",
    primaryAction: "open a failed build",
    supportedViewports: [390, 1440],
    requiredStates: ["loading", "empty", "error", "success"],
  },
  direction: {
    requestedTone: ["focused"],
    antiGoals: ["generic dashboard"],
    existingDirection: "dense developer tooling",
  },
  evidence: { observed: [], inferred: [], assumed: [], unknown: [] },
};

test("material workflows resolve policy and bounded repair explicitly", async () => {
  for (const file of [
    "domains/frontend/workflows/design-generation.workflow.json",
    "domains/frontend/workflows/design-to-code.workflow.json",
  ]) {
    const workflow = JSON.parse(await readFile(file, "utf8"));
    const ids = workflow.steps.map((step: { id: string }) => step.id);
    assert.ok(ids.indexOf("resolve-execution-policy") < ids.indexOf("define-direction"));
    assert.ok(ids.indexOf("validate-implementation-prerequisites") < ids.indexOf("implement"));
    assert.ok(ids.indexOf("bounded-repair") < ids.indexOf("report"));
  }
});

test("sparse Russian material redesign requires field-linked clarification", () => {
  const decision = evaluateFrontendRunPolicy({
    intent: "Сделай необычный редизайн лендинга и используй скиллы",
    recommendations: visualRecommendations,
  });
  assert.equal(decision.lifecycleRequired, true);
  assert.equal(decision.clarification.required, true);
  assert.deepEqual(
    decision.clarification.questions.flatMap((item) => item.fields),
    ["primaryUserOrActor", "primaryTask", "primaryAction"],
  );
  assert.equal(decision.clarification.questions.length <= 3, true);
});

test("bounded responsive repair records assumptions without blocking", () => {
  const decision = evaluateFrontendRunPolicy({
    intent: "Почини overlap кнопки на 390px",
    recommendations: tailwindRecommendations,
  });
  assert.equal(decision.clarification.required, false);
});

test("explicit skill control requires the lifecycle for bounded work", () => {
  const decision = evaluateFrontendRunPolicy({
    intent: "Use frontend skills to fix the overlap at 390px",
    recommendations: tailwindRecommendations,
  });
  assert.equal(decision.lifecycleRequired, true);
  assert.equal(decision.clarification.required, false);
});

test("new frontend generation is material without a material skill", () => {
  const decision = evaluateFrontendRunPolicy({
    intent: "Build a new landing page from scratch",
    recommendations: tailwindRecommendations,
  });
  assert.equal(decision.lifecycleRequired, true);
  assert.equal(decision.clarification.required, true);
  assert.equal(decision.verificationRequired, true);
});

test("Russian new frontend generation is material without a material skill", () => {
  const decision = evaluateFrontendRunPolicy({
    intent: "Сделай новый лендинг с нуля",
    recommendations: tailwindRecommendations,
  });
  assert.equal(decision.lifecycleRequired, true);
  assert.equal(decision.clarification.required, true);
});

test("English revamp aliases are material without a material recommendation", () => {
  const decision = evaluateFrontendRunPolicy({
    intent: "Revamp the landing",
    recommendations: tailwindRecommendations,
  });
  assert.equal(decision.lifecycleRequired, true);
  assert.equal(decision.clarification.required, true);
});

test("Russian refresh aliases are material without a material recommendation", () => {
  const decision = evaluateFrontendRunPolicy({
    intent: "Освежить дизайн лендинга",
    recommendations: tailwindRecommendations,
  });
  assert.equal(decision.lifecycleRequired, true);
  assert.equal(decision.clarification.required, true);
});

test("generic design-system intent is not material by itself", () => {
  const decision = evaluateFrontendRunPolicy({
    intent: "Review the design tokens",
    recommendations: tailwindRecommendations,
  });
  assert.equal(decision.lifecycleRequired, false);
  assert.equal(decision.clarification.required, false);
});

test("frontend registration preserves its optional run policy", () => {
  const pack = getDomainPack("frontend");
  assert.equal(typeof pack?.runPolicy?.evaluate, "function");
  const decision = pack?.runPolicy?.evaluate({
    intent: "Почини overlap кнопки на 390px",
    recommendations: tailwindRecommendations,
  });
  assert.equal(decision?.clarification.required, false);
});

test("a complete material brief asks no redundant questions", () => {
  const decision = evaluateFrontendRunPolicy({
    intent: "Redesign the developer dashboard",
    recommendations: visualRecommendations,
    artifacts: { designBrief: completeBrief },
  });
  assert.equal(decision.lifecycleRequired, true);
  assert.equal(decision.clarification.required, false);
  assert.deepEqual(decision.clarification.questions, []);
  assert.equal(decision.verificationRequired, true);
  assert.deepEqual(decision.mandatorySkillIds, visualRecommendations.map(({ skillId }) => skillId));
});

test("literal unknown brief values are clarified without repeating known fields", () => {
  const brief = structuredClone(completeBrief);
  brief.product.primaryUserOrActor = "unknown";
  const decision = evaluateFrontendRunPolicy({
    intent: "Redesign the developer dashboard",
    recommendations: visualRecommendations,
    artifacts: { designBrief: brief },
  });
  assert.deepEqual(
    decision.clarification.questions.map(({ fields }) => fields),
    [["primaryUserOrActor"]],
  );
});

test("declined material clarification records one constrained assumption per field", () => {
  const policy = evaluateFrontendRunPolicy({
    intent: "Redesign this landing page",
    recommendations: visualRecommendations,
  });
  const checksum = `sha256:${"a".repeat(64)}`;
  let run = createSkillRun({
    runId: "frontend-declined-material",
    domain: "frontend",
    targetAgent: "codex",
    locale: "en",
    intent: { sha256: `sha256:${"b".repeat(64)}`, normalizedGoal: "redesign landing page" },
    policy,
  });
  run = reduceSkillRun(run, {
    type: "select-skills",
    skills: visualRecommendations.map(({ skillId, role }) => ({
      skillId,
      role: role ?? "companion",
      version: "1.0.0",
      checksum,
      mandatory: true,
    })),
  });
  for (const { skillId } of visualRecommendations) {
    run = reduceSkillRun(run, { type: "record-skill-read", skillId, checksum });
  }
  run = reduceSkillRun(run, {
    type: "resolve-clarification",
    answers: [],
    declinedFields: ["primaryUserOrActor", "primaryTask", "primaryAction"],
    assumptions: [
      "Assume the primary actor is a prospective customer until validated.",
      "Assume the primary task is evaluating the product until validated.",
      "Assume the primary action is requesting a demo until validated.",
    ],
  });
  assert.equal(run.clarification.status, "declined");
  assert.equal(run.clarification.assumptions.length, run.clarification.declinedFields.length);
  assert.equal(reduceSkillRun(run, { type: "start-execution" }).state, "running");
});

test("unsupported metrics and testimonials require non-declinable provenance", () => {
  const policy = evaluateFrontendRunPolicy({
    intent: "Add benchmark metrics and customer testimonials to this landing page",
    recommendations: tailwindRecommendations,
    artifacts: { designBrief: completeBrief },
  });
  const provenance = policy.clarification.questions.find((question) =>
    question.fields.includes("contentProvenance"));
  assert.deepEqual(provenance?.fields, ["contentProvenance"]);
  assert.equal(provenance?.allowDecline, false);

  const checksum = `sha256:${"c".repeat(64)}`;
  let run = createSkillRun({
    runId: "frontend-content-provenance",
    domain: "frontend",
    targetAgent: "codex",
    locale: "en",
    intent: { sha256: `sha256:${"d".repeat(64)}`, normalizedGoal: "add benchmark metrics" },
    policy,
  });
  run = reduceSkillRun(run, {
    type: "select-skills",
    skills: [{
      skillId: tailwindRecommendations[0].skillId,
      role: "primary",
      version: "1.0.0",
      checksum,
      mandatory: true,
    }],
  });
  run = reduceSkillRun(run, {
    type: "record-skill-read",
    skillId: tailwindRecommendations[0].skillId,
    checksum,
  });
  assert.throws(
    () => reduceSkillRun(run, {
      type: "resolve-clarification",
      answers: [],
      declinedFields: ["contentProvenance"],
      assumptions: ["Assume the claims are accurate."],
    }),
    { code: "clarification-required" },
  );
  assert.throws(
    () => reduceSkillRun(run, { type: "start-execution" }),
    { code: "clarification-required" },
  );
});

test("unsupported Russian brand and testimonial aliases require provenance", () => {
  const decision = evaluateFrontendRunPolicy({
    intent: "Добавь отзывы клиентов и бренды на лендинг",
    recommendations: tailwindRecommendations,
    artifacts: { designBrief: completeBrief },
  });
  const provenance = decision.clarification.questions.find((question) =>
    question.fields.includes("contentProvenance"));
  assert.equal(provenance?.allowDecline, false);
});

test("malformed observed evidence is treated as unsourced without throwing", () => {
  const decision = evaluateFrontendRunPolicy({
    intent: "Add benchmark metrics to this landing page",
    recommendations: tailwindRecommendations,
    artifacts: {
      designBrief: {
        ...completeBrief,
        evidence: { ...completeBrief.evidence, observed: "analytics/benchmark.csv" },
      },
    },
  });
  const provenance = decision.clarification.questions.find((question) =>
    question.fields.includes("contentProvenance"));
  assert.equal(provenance?.allowDecline, false);
});

test("sourced observed evidence suppresses provenance clarification", () => {
  const brief = structuredClone(completeBrief);
  brief.evidence.observed.push({
    statement: "Conversion benchmark is 18%.",
    source: "analytics/benchmark.csv",
  });
  const decision = evaluateFrontendRunPolicy({
    intent: "Add the benchmark metric and testimonial",
    recommendations: tailwindRecommendations,
    artifacts: { designBrief: brief },
  });
  assert.equal(decision.clarification.questions.some((question) =>
    question.fields.includes("contentProvenance")), false);
});

test("verification-capable selected skills require verification", () => {
  const decision = evaluateFrontendRunPolicy({
    intent: "Review keyboard focus behavior",
    recommendations: [recommendation("frontend.accessibility-review", "primary")],
  });
  assert.equal(decision.verificationRequired, true);
});

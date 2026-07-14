import test from "node:test";
import assert from "node:assert/strict";
import { scanProject } from "../src/scanner/index.ts";
import { loadLocalRegistry } from "../src/registry/index.ts";
import {
  groupRecommendationsByLane,
  recommendSkills,
  type RecommendSkillsOptions,
} from "../src/recommender/index.ts";

const nextFixtureRecommendations = async (
  options: RecommendSkillsOptions = {},
) => {
  const fingerprint = await scanProject("fixtures/next-react-ts");
  const skills = await loadLocalRegistry("registry");
  return recommendSkills(fingerprint, skills, {
    targetAgent: "codex",
    ...options,
  });
};

const fixtureRecommendations = async (
  projectRoot: string,
  options: RecommendSkillsOptions = {},
) => {
  const fingerprint = await scanProject(projectRoot);
  const skills = await loadLocalRegistry("registry");
  return recommendSkills(fingerprint, skills, {
    targetAgent: "codex",
    ...options,
  });
};

test("recommender ranks Next.js review first for Next.js fixture", async () => {
  const recommendations = await nextFixtureRecommendations();
  assert.equal(recommendations[0]?.skillId, "frontend.next-app-router-review");
  assert.equal(recommendations[0]?.scoreBreakdown.finalScore, recommendations[0]?.score);
  assert.equal(recommendations[0]?.scoreBreakdown.compatibilityScore, 1);
  assert.ok((recommendations[0]?.scoreBreakdown.stackMatch ?? 0) > 0);
  assert.ok(
    recommendations.some(
      (item) => item.skillId === "frontend.accessibility-review",
    ),
  );
});

test("visual critic routing requires rendered evidence and comparison intent", async () => {
  const compare = await nextFixtureRecommendations({
    userIntent: "Compare these two rendered variants using their mobile and desktop screenshots",
  });
  assert.equal(compare[0]?.skillId, "frontend.visual-critic");

  const implementationCollision = await nextFixtureRecommendations({
    userIntent: "Implement two rendered variants of this pricing page in React and Tailwind",
  });
  assert.equal(
    implementationCollision.some(({ skillId }) => skillId === "frontend.visual-critic"),
    false,
  );

  const russianCompare = await nextFixtureRecommendations({
    userIntent: "Сравни два отрисованных варианта по мобильным и десктопным скриншотам",
  });
  assert.equal(russianCompare[0]?.skillId, "frontend.visual-critic");

  const screenshotOnlyCompare = await nextFixtureRecommendations({
    userIntent: "Compare these two screenshots and select the stronger design.",
  });
  assert.equal(screenshotOnlyCompare[0]?.skillId, "frontend.visual-critic");

  const russianScreenshotOnlyCompare = await nextFixtureRecommendations({
    userIntent: "Сравни эти два скриншота и выбери лучший дизайн.",
  });
  assert.equal(russianScreenshotOnlyCompare[0]?.skillId, "frontend.visual-critic");

  const russianImplementationCollision = await nextFixtureRecommendations({
    userIntent: "Реализуй два отрисованных варианта страницы тарифов на React и Tailwind",
  });
  assert.equal(
    russianImplementationCollision.some(({ skillId }) => skillId === "frontend.visual-critic"),
    false,
  );

  const screenshotImplementationCollision = await nextFixtureRecommendations({
    userIntent: "Implement two screenshots for this pricing page in React and Tailwind.",
  });
  assert.equal(
    screenshotImplementationCollision.some(({ skillId }) => skillId === "frontend.visual-critic"),
    false,
  );
});

test("recommender omits the final audit without an explicit audit intent", async () => {
  const recommendations = await nextFixtureRecommendations();

  assert.equal(
    recommendations.some((item) => item.skillId === "frontend.audit"),
    false,
  );
});

test("recommender promotes the final audit for explicit release-readiness work", async () => {
  const recommendations = await nextFixtureRecommendations({
    userIntent:
      "Run a final frontend release-readiness audit with a scorecard for browser checks, a11y, performance, and visual quality.",
  });

  assert.equal(recommendations[0]?.skillId, "frontend.audit");
});

test("recommender routes a Russian redesign request to visual design polish", async () => {
  const recommendations = await nextFixtureRecommendations({
    userIntent: "Сделай редизайн главной страницы и убери ощущение типового AI-интерфейса.",
  });

  assert.equal(recommendations[0]?.skillId, "frontend.visual-design-polish");
  assert.equal(recommendations[0]?.lane, "design");
});

test("recommender suppresses backend architecture design requests", async () => {
  for (const userIntent of [
    "Design the database schema for the billing service.",
    "Review the API design for this backend endpoint.",
    "Сделай дизайн схемы базы данных для сервиса оплаты.",
  ]) {
    const recommendations = await nextFixtureRecommendations({ userIntent });
    assert.deepEqual(recommendations, [], userIntent);
  }
});

test("recommender keeps Next.js Server Actions in the frontend lane", async () => {
  const recommendations = await nextFixtureRecommendations({
    userIntent:
      "Review this Next.js App Router's route handlers, Server Actions, and RSC boundaries.",
  });

  assert.equal(recommendations[0]?.skillId, "frontend.next-app-router-review");
});

test("recommender recognizes visual refresh synonyms", async () => {
  for (const userIntent of [
    "Modernize this app.",
    "Refresh the visual design of this page.",
    "Rebrand this landing page without changing its product flow.",
  ]) {
    const recommendations = await nextFixtureRecommendations({ userIntent });
    assert.equal(recommendations[0]?.skillId, "frontend.visual-design-polish", userIntent);
  }
});

test("recommender keeps a Tailwind token audit in the design-system lane", async () => {
  const recommendations = await nextFixtureRecommendations({
    userIntent:
      "Audit this Tailwind app for token drift, arbitrary values, inconsistent radii, and shadcn theme misuse.",
  });

  assert.equal(recommendations[0]?.skillId, "frontend.design-system");
});

test("recommender lets component API intent override redesign wording", async () => {
  const recommendations = await nextFixtureRecommendations({
    userIntent:
      "Redesign a React form component API that mixes controlled and uncontrolled state, render props, and duplicated validation state.",
  });

  assert.equal(recommendations[0]?.skillId, "frontend.react-component-design");
});

test("recommender reports when visual verification capabilities are missing", async () => {
  const withoutVisualQa = await nextFixtureRecommendations({
    userIntent: "Redesign this product page with stronger visual hierarchy.",
  });
  const withVisualQa = await nextFixtureRecommendations({
    userIntent: "Redesign this product page with stronger visual hierarchy.",
    hostCapabilities: ["browser", "screenshots"],
  });

  assert.equal(withoutVisualQa[0]?.skillId, "frontend.visual-design-polish");
  assert.deepEqual(withoutVisualQa[0]?.verification, {
    status: "unverified",
    missingCapabilities: ["browser", "screenshots"],
  });
  assert.deepEqual(withVisualQa[0]?.verification, {
    status: "ready",
    missingCapabilities: [],
  });
});

test("recommender confidence-adjusts editorial quality without task evidence", async () => {
  const recommendations = await nextFixtureRecommendations({
    userIntent: "Redesign this product page with stronger visual hierarchy.",
  });
  const visualDesign = recommendations.find(
    (item) => item.skillId === "frontend.visual-design-polish",
  );

  assert.equal(visualDesign?.scoreBreakdown.qualityScore, 0.88);
  assert.equal(visualDesign?.scoreBreakdown.effectiveQualityScore, 0.595);
  assert.equal(visualDesign?.scoreBreakdown.evaluationPenalty, 0.03);
});

test("recommender gives frozen task evidence more weight than editorial score alone", async () => {
  const fingerprint = await scanProject("fixtures/next-react-ts");
  const skills = await loadLocalRegistry("registry");
  const visualDesign = skills.find(
    (skill) => skill.manifest.id === "frontend.visual-design-polish",
  );
  assert.ok(visualDesign);

  const withoutEvidence = recommendSkills(fingerprint, skills, {
    targetAgent: "codex",
    userIntent: "Redesign this product page with stronger visual hierarchy.",
  }).find((item) => item.skillId === visualDesign.manifest.id);

  visualDesign.manifest.evaluation = {
    status: "task-eval",
    benchmarkVersion: "frontend-skill-quality-v1",
    evidenceUri: "evals/frontend/results/task-evidence.json",
    score: 0.9,
  };
  const withEvidence = recommendSkills(fingerprint, skills, {
    targetAgent: "codex",
    userIntent: "Redesign this product page with stronger visual hierarchy.",
  }).find((item) => item.skillId === visualDesign.manifest.id);

  assert.ok(
    (withEvidence?.scoreBreakdown.effectiveQualityScore ?? 0) >
      (withoutEvidence?.scoreBreakdown.effectiveQualityScore ?? 0),
  );
  assert.equal(withEvidence?.scoreBreakdown.evaluationPenalty, 0.01);
});

test("recommender composes a visual task around one primary and compatible companions", async () => {
  const recommendations = await nextFixtureRecommendations({
    userIntent:
      "Redesign this product page with stronger visual hierarchy, responsive spacing, and interaction feedback.",
    hostCapabilities: ["browser", "screenshots"],
  });

  assert.deepEqual(
    recommendations.map((item) => [item.skillId, item.role]),
    [
      ["frontend.visual-design-polish", "primary"],
      ["frontend.tailwind-ui-polish", "companion"],
      ["frontend.interaction-polish", "companion"],
    ],
  );
});

test("recommender includes the full curated frontend MVP pack for Next.js fixture", async () => {
  const recommendations = await nextFixtureRecommendations();
  assert.deepEqual(
    recommendations.map((item) => item.skillId),
    [
      "frontend.next-app-router-review",
      "frontend.playwright-debug",
      "frontend.tailwind-ui-polish",
      "frontend.visual-design-polish",
      "frontend.react-app-review",
      "frontend.accessibility-review",
      "frontend.design-system",
      "frontend.design-to-code",
      "frontend.interaction-polish",
      "frontend.react-component-design",
      "frontend.testing-strategy",
      "frontend.ux-critique",
      "frontend.performance-review",
      "frontend.agents-md-bootstrap",
    ],
  );
  assert.deepEqual(
    recommendations.map((item) => [item.skillId, item.lane, item.category]),
    [
      ["frontend.next-app-router-review", "framework", "next-app-router"],
      ["frontend.playwright-debug", "qa", "playwright-debug"],
      ["frontend.tailwind-ui-polish", "design", "tailwind-ui-polish"],
      ["frontend.visual-design-polish", "design", "visual-design-polish"],
      ["frontend.react-app-review", "implementation", "react-app-review"],
      ["frontend.accessibility-review", "qa", "accessibility-review"],
      ["frontend.design-system", "design", "design-system"],
      ["frontend.design-to-code", "design", "design-to-code"],
      ["frontend.interaction-polish", "design", "interaction-polish"],
      ["frontend.react-component-design", "implementation", "react-component-design"],
      ["frontend.testing-strategy", "qa", "testing-strategy"],
      ["frontend.ux-critique", "design", "ux-critique"],
      ["frontend.performance-review", "implementation", "performance-review"],
      ["frontend.agents-md-bootstrap", "agent-context", "agents-md-bootstrap"],
    ],
  );
  assert.deepEqual(
    groupRecommendationsByLane(recommendations).map((group) => [
      group.lane,
      group.recommendations.map((item) => item.skillId),
    ]),
    [
      ["framework", ["frontend.next-app-router-review"]],
      ["qa", ["frontend.playwright-debug", "frontend.accessibility-review", "frontend.testing-strategy"]],
      [
        "design",
        [
          "frontend.tailwind-ui-polish",
          "frontend.visual-design-polish",
          "frontend.design-system",
          "frontend.design-to-code",
          "frontend.interaction-polish",
          "frontend.ux-critique",
        ],
      ],
      ["implementation", ["frontend.react-app-review", "frontend.react-component-design", "frontend.performance-review"]],
      ["agent-context", ["frontend.agents-md-bootstrap"]],
    ],
  );
});

test("recommender filters recommendations by lane", async () => {
  const recommendations = await nextFixtureRecommendations({ lane: "design" });

  assert.deepEqual(
    recommendations.map((item) => item.skillId),
    [
      "frontend.tailwind-ui-polish",
      "frontend.visual-design-polish",
      "frontend.design-system",
      "frontend.design-to-code",
      "frontend.interaction-polish",
      "frontend.ux-critique",
    ],
  );
  assert.equal(recommendations.every((item) => item.lane === "design"), true);
});

test("recommender limits recommendations per lane", async () => {
  const recommendations = await nextFixtureRecommendations({ limitPerLane: 1 });

  assert.deepEqual(
    recommendations.map((item) => item.skillId),
    [
      "frontend.next-app-router-review",
      "frontend.playwright-debug",
      "frontend.tailwind-ui-polish",
      "frontend.react-app-review",
      "frontend.agents-md-bootstrap",
    ],
  );
  assert.deepEqual(
    groupRecommendationsByLane(recommendations).map((group) => [
      group.lane,
      group.recommendations.map((item) => item.skillId),
    ]),
    [
      ["framework", ["frontend.next-app-router-review"]],
      ["qa", ["frontend.playwright-debug"]],
      ["design", ["frontend.tailwind-ui-polish"]],
      ["implementation", ["frontend.react-app-review"]],
      ["agent-context", ["frontend.agents-md-bootstrap"]],
    ],
  );
});

test("recommender filters by lane before limiting per lane", async () => {
  const recommendations = await nextFixtureRecommendations({
    lane: "design",
    limitPerLane: 2,
  });

  assert.deepEqual(
    recommendations.map((item) => item.skillId),
    ["frontend.tailwind-ui-polish", "frontend.visual-design-polish"],
  );
  assert.deepEqual(
    groupRecommendationsByLane(recommendations).map((group) => group.lane),
    ["design"],
  );
});

test("recommender uses user intent to promote specialized frontend skills", async () => {
  assert.equal(
    (await nextFixtureRecommendations({ userIntent: "performance" }))[0]
      ?.skillId,
    "frontend.performance-review",
  );
  assert.equal(
    (
      await nextFixtureRecommendations({
        userIntent: "playwright e2e debugging",
      })
    )[0]?.skillId,
    "frontend.playwright-debug",
  );
  assert.equal(
    (await nextFixtureRecommendations({ userIntent: "testing strategy" }))[0]
      ?.skillId,
    "frontend.testing-strategy",
  );
  assert.equal(
    (await nextFixtureRecommendations({ userIntent: "AGENTS.md" }))[0]?.skillId,
    "frontend.agents-md-bootstrap",
  );
  assert.equal(
    (await nextFixtureRecommendations({ userIntent: "visual design polish" }))[0]
      ?.skillId,
    "frontend.visual-design-polish",
  );
  assert.equal(
    (await nextFixtureRecommendations({ userIntent: "design system tokens" }))[0]
      ?.skillId,
    "frontend.design-system",
  );
  assert.equal(
    (
      await nextFixtureRecommendations({
        userIntent: "design to code screenshot",
      })
    )[0]?.skillId,
    "frontend.design-to-code",
  );
  assert.equal(
    (await nextFixtureRecommendations({ userIntent: "ux critique onboarding" }))[0]
      ?.skillId,
    "frontend.ux-critique",
  );
  assert.equal(
    (await nextFixtureRecommendations({ userIntent: "interaction polish motion" }))[0]
      ?.skillId,
    "frontend.interaction-polish",
  );
});

test("recommender keeps design intent out of Playwright debug", async () => {
  const recommendations = await nextFixtureRecommendations({
    userIntent: "Make the landing page more visually polished and distinctive on mobile",
  });

  assert.equal(recommendations[0]?.lane, "design");
  assert.notEqual(recommendations[0]?.skillId, "frontend.playwright-debug");
});

test("recommender requires debug evidence before selecting Playwright debug", async () => {
  assert.equal(
    (
      await nextFixtureRecommendations({
        userIntent: "Create a frontend testing strategy for a React app with critical forms, shared components, and one happy-path Playwright flow.",
      })
    )[0]?.skillId,
    "frontend.testing-strategy",
  );

  assert.equal(
    (
      await nextFixtureRecommendations({
        userIntent: "Our Playwright checkout spec flakes in CI but passes locally. Find the likely cause using trace and artifact evidence.",
      })
    )[0]?.skillId,
    "frontend.playwright-debug",
  );
});

test("recommender handles frontend routing regression prompts", async () => {
  assert.equal(
    (
      await nextFixtureRecommendations({
        userIntent: "Review Server Actions that mutate account settings but leave stale cached route data and unclear pending/error UI.",
      })
    )[0]?.skillId,
    "frontend.next-app-router-review",
  );
  assert.equal(
    (
      await nextFixtureRecommendations({
        userIntent: "Fix the mobile navigation where labels wrap badly, icons shift, and the active state is hard to see.",
      })
    )[0]?.skillId,
    "frontend.tailwind-ui-polish",
  );
  assert.equal(
    (
      await nextFixtureRecommendations({
        userIntent: "Create an AGENTS.md for a frontend repo documenting build/test commands, design conventions, screenshots, accessibility checks, and browser QA expectations.",
      })
    )[0]?.skillId,
    "frontend.agents-md-bootstrap",
  );
  assert.equal(
    (
      await nextFixtureRecommendations({
        userIntent: "Plan a migration from hard-coded Tailwind colors and spacing to semantic tokens across buttons, cards, forms, and dark mode.",
      })
    )[0]?.skillId,
    "frontend.design-system",
  );
  assert.equal(
    (
      await nextFixtureRecommendations({
        userIntent: "Audit a modal dialog implementation for focus trap, escape close, return focus, accessible name, inert background, and reduced motion.",
      })
    )[0]?.skillId,
    "frontend.accessibility-review",
  );
});

test("recommender suppresses non-frontend routing regression prompts", async () => {
  assert.deepEqual(
    await nextFixtureRecommendations({
      userIntent: "Write unit tests for this pure date formatting helper.",
    }),
    [],
  );
  assert.deepEqual(
    await nextFixtureRecommendations({
      userIntent: "Add a CSV export endpoint for monthly order reports.",
    }),
    [],
  );
  assert.deepEqual(
    await nextFixtureRecommendations({
      userIntent: "Analyze a slow PostgreSQL query plan and add the right covering index.",
    }),
    [],
  );
});

test("recommender returns no frontend skills for backend-only intent", async () => {
  const recommendations = await nextFixtureRecommendations({
    userIntent: "Optimize backend database migration and API cache invalidation for a Node service",
  });

  assert.deepEqual(recommendations, []);
});

test("recommender filters skills incompatible with the requested target agent", async () => {
  const recommendations = await nextFixtureRecommendations({
    targetAgent: "unknown-agent",
  });
  assert.deepEqual(recommendations, []);
});

test("recommender avoids Next-specific skills for Vite React fixture", async () => {
  const recommendations = await fixtureRecommendations("fixtures/vite-react-ts");
  const skillIds = recommendations.map((item) => item.skillId);
  assert.ok(skillIds.includes("frontend.accessibility-review"));
  assert.ok(skillIds.includes("frontend.react-component-design"));
  assert.ok(!skillIds.includes("frontend.next-app-router-review"));
  assert.ok(!skillIds.includes("frontend.playwright-debug"));
  assert.ok(!skillIds.includes("frontend.agents-md-bootstrap"));
});

test("recommender does not return frontend pack for backend Node fixture", async () => {
  const recommendations = await fixtureRecommendations("fixtures/backend-node");
  assert.deepEqual(recommendations, []);
});

test("recommender routes UX critique for information architecture and cognitive load", async () => {
  for (const userIntent of [
    "Evaluate the information architecture of this settings page for findability and task completion.",
    "Critique the cognitive load of this multi-step form with recovery and error states.",
    "Review the navigation and search usability on this dashboard for wayfinding issues.",
    "The empty state and error recovery on this settings page are confusing; improve the user flow.",
  ]) {
    const recommendations = await nextFixtureRecommendations({ userIntent });
    assert.equal(recommendations[0]?.skillId, "frontend.ux-critique", userIntent);
  }
});

test("recommender routes preflight and quality-gate audit for comprehensive wording", async () => {
  for (const userIntent of [
    "Run a preflight audit on this feature covering a11y, perf, responsive layout, and visual quality.",
    "Do a go/no-go frontend quality gate review before we ship this feature.",
    "Run a final ship review with a frontend scorecard for release blockers.",
  ]) {
    const recommendations = await nextFixtureRecommendations({ userIntent });
    assert.equal(recommendations[0]?.skillId, "frontend.audit", userIntent);
  }
});

test("recommender prevents narrow review phrases from routing to audit", async () => {
  for (const userIntent of [
    "Review this component for accessibility issues.",
    "Review this page and fix the layout bug.",
    "Can you review the navigation on mobile?",
  ]) {
    const recommendations = await nextFixtureRecommendations({ userIntent });
    assert.equal(
      recommendations.some((r) => r.skillId === "frontend.audit"),
      false,
      userIntent,
    );
  }
});

test("recommender distinguishes art direction from Tailwind implementation", async () => {
  const artDirection = await nextFixtureRecommendations({
    userIntent: "Define the art direction and visual language for this landing page with a style guide and subject-specific design thesis.",
  });
  assert.equal(artDirection[0]?.skillId, "frontend.visual-design-polish");

  const tailwindFix = await nextFixtureRecommendations({
    userIntent: "Fix the Tailwind responsive breakpoints and cleanup className bundles on this card component.",
  });
  assert.equal(tailwindFix[0]?.skillId, "frontend.tailwind-ui-polish");

  const cssRepair = await nextFixtureRecommendations({
    userIntent: "Repair the CSS spacing and wrapping on this navigation so labels don't overflow on mobile.",
  });
  assert.equal(cssRepair[0]?.skillId, "frontend.tailwind-ui-polish");
});

test("recommender routes navigation fix to tailwind not UX critique", async () => {
  const recommendations = await nextFixtureRecommendations({
    userIntent: "Fix the navigation bar on mobile — labels overlap and the active state is invisible.",
  });
  assert.equal(recommendations[0]?.skillId, "frontend.tailwind-ui-polish");
});

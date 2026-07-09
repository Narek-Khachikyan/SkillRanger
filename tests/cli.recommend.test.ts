import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const parseRecommendations = (stdout: string) =>
  JSON.parse(stdout) as {
    recommendations: Array<{
      skillId: string;
      lane: string;
      scoreBreakdown: { finalScore: number; compatibilityScore: number };
    }>;
    recommendationGroups: Array<{
      lane: string;
      recommendations: Array<{ skillId: string }>;
    }>;
  };

test("recommend CLI filters JSON recommendations by lane", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    "src/cli/index.ts",
    "recommend",
    "fixtures/next-react-ts",
    "--lane",
    "design",
    "--json",
  ]);
  const report = parseRecommendations(stdout);

  assert.deepEqual(
    report.recommendations.map((item) => item.skillId),
    [
      "frontend.tailwind-ui-polish",
      "frontend.visual-design-polish",
      "frontend.design-system",
      "frontend.design-to-code",
      "frontend.interaction-polish",
      "frontend.ux-critique",
    ],
  );
  assert.equal(report.recommendations.every((item) => item.lane === "design"), true);
});

test("recommend CLI accepts visual verification capabilities", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    "src/cli/index.ts",
    "recommend",
    "fixtures/next-react-ts",
    "--intent",
    "Redesign this product page with stronger visual hierarchy.",
    "--capabilities",
    "browser,screenshots",
    "--json",
  ]);
  const report = parseRecommendations(stdout) as typeof parseRecommendations extends (stdout: string) => infer T
    ? T & { recommendations: Array<{ verification: { status: string; missingCapabilities: string[] } }> }
    : never;

  assert.deepEqual(report.recommendations[0]?.verification, {
    status: "ready",
    missingCapabilities: [],
  });
});

test("recommend CLI explains score drivers in human output", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    "src/cli/index.ts",
    "recommend",
    "fixtures/next-react-ts",
    "--limit-per-lane",
    "1",
    "--explain",
  ]);

  assert.match(stdout, /score drivers: stack/);
  assert.match(stdout, /compatibility 1\.000/);
});

test("recommend CLI limits JSON recommendations per lane", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    "src/cli/index.ts",
    "recommend",
    "fixtures/next-react-ts",
    "--limit-per-lane",
    "1",
    "--json",
  ]);
  const report = parseRecommendations(stdout);

  assert.equal(
    report.recommendationGroups.every((group) => group.recommendations.length === 1),
    true,
  );
  assert.deepEqual(
    report.recommendations.map((item) => item.skillId),
    [
      "frontend.next-app-router-review",
      "frontend.playwright-debug",
      "frontend.tailwind-ui-polish",
      "frontend.react-app-review",
      "frontend.agents-md-bootstrap",
    ],
  );
});

test("recommend CLI rejects invalid lane", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      "src/cli/index.ts",
      "recommend",
      "fixtures/next-react-ts",
      "--lane",
      "nope",
      "--json",
    ]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        (error as Error & { stderr?: string }).stderr ?? "",
        /--lane must be one of framework, design, implementation, qa, agent-context\./,
      );
      return true;
    },
  );
});

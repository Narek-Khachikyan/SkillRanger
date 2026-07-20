import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { analyzeTask } from "../src/router/analyzer.ts";
import { loadRouterFixturePacks, type RouterFixturePack } from "../src/router/fixtures.ts";
import type { ProjectFingerprint } from "../src/types.ts";

const fixtureRoot = path.resolve("tests/fixtures/router-packs");

const analyzerMetadata = (packs: RouterFixturePack[]) => ({
  domains: packs.map(({ domain }) => domain),
  skills: packs.flatMap(({ skills }) => skills.map((skill) => ({
    domains: skill.domains,
    actions: skill.actions,
    artifactTypes: skill.artifactTypes,
    intentTags: skill.intentTags,
    technologyTags: skill.technologyTags,
    qualityGoals: skill.qualityGoals,
    environmentSignals: skill.environmentSignals,
  }))),
});

const frontendMetadata = {
  domains: [{
    id: "frontend",
    routing: {
      aliases: ["frontend-web"],
      intentTags: ["website"],
      artifactTypes: ["web-interface"],
      technologyTags: ["react"],
      projectTags: ["frontend"],
    },
  }],
  skills: [{
    domains: ["frontend"],
    actions: ["create" as const],
    artifactTypes: ["web-interface"],
    intentTags: ["website"],
    technologyTags: ["react"],
    qualityGoals: [],
  }],
};

const fingerprint = (overrides: Partial<ProjectFingerprint> = {}): ProjectFingerprint => ({
  schemaVersion: "1.0",
  root: "/private/project",
  projectTypes: [],
  languages: [],
  frameworks: [],
  styling: [],
  testing: [],
  infrastructure: [],
  agentContext: {
    agentsMd: { present: false, paths: [] },
    codexSkills: { present: false, paths: [] },
    claudeSkills: { present: false, paths: [] },
  },
  signals: [],
  tags: [],
  warnings: [],
  ...overrides,
});

test("analyzer extracts canonical mixed-locale task signals from metadata", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const metadata = analyzerMetadata(packs);
  const result = analyzeTask({
    prompt: "Исправь refresh token в NestJS, добавь integration tests и проверь, что тесты проходят без сети.",
    ...metadata,
    fingerprint: fingerprint({
      frameworks: [{ name: "NestJS", confidence: 0.95, evidence: ["package.json"] }],
      tags: ["backend", "nodejs"],
    }),
  });

  assert.equal(result.profile.locale, "mixed");
  assert.deepEqual(result.profile.actions, ["fix", "create", "test", "verify"]);
  assert.deepEqual(result.profile.artifactTypes, ["authentication-flow", "integration-test", "test-suite"]);
  assert.deepEqual(result.profile.technologies, ["nestjs", "nodejs"]);
  assert.deepEqual(result.profile.constraints, ["no-network"]);
  assert.deepEqual(result.profile.acceptanceCriteria, ["tests-pass"]);
  assert.match(result.profile.normalizedGoal, /^fix create test verify /);
  assert.deepEqual(result.profile.domains.map(({ id, role }) => ({ id, role })), [
    { id: "backend-api", role: "primary" },
    { id: "security-appsec", role: "supporting" },
    { id: "qa-testing", role: "supporting" },
  ]);
  assert.ok(result.profile.evidence.some((item) => item.kind === "domain" && item.id === "backend-api"));
  assert.ok(result.profile.evidence.some((item) => item.source === "fingerprint" && item.id === "nodejs"));
});

test("analyzer output is privacy-safe and ignores content subjects and unknown tokens", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const metadata = analyzerMetadata(packs);
  const prompt = "Создай сайт про SECRET_CANARY_7f4c для клиента https://private.example/customer.";
  const first = analyzeTask({ prompt, ...frontendMetadata });
  const second = analyzeTask({ prompt, ...frontendMetadata });

  assert.deepEqual(first, second);
  assert.equal(first.profile.normalizedGoal, "create web-interface");
  assert.deepEqual(first.profile.artifactTypes, ["web-interface"]);
  const persisted = JSON.stringify(first.profile);
  assert.doesNotMatch(persisted, /SECRET_CANARY|private\.example|customer|клиент/u);
  assert.deepEqual(first.profile.evidence.every(({ id }) => /^[a-z0-9][a-z0-9._-]{1,127}$/.test(id)), true);
});

test("analyzer has no frontend fallback when frontend vocabulary is unavailable", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const databaseOnly = analyzerMetadata(packs.filter(({ domain }) => domain.id === "database"));
  const result = analyzeTask({ prompt: "Создай красивый сайт для пекарни.", ...databaseOnly });

  assert.deepEqual(result.profile.actions, ["create"]);
  assert.deepEqual(result.profile.artifactTypes, []);
  assert.deepEqual(result.profile.technologies, []);
  assert.equal(result.profile.normalizedGoal, "create");
  assert.equal(result.profile.evidence.some(({ kind }) => kind === "domain"), false);
});

test("analyzer creates canonical subtask candidates for separate action groups", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const result = analyzeTask({
    prompt: "Migrate PostgreSQL and redesign the mobile application.",
    ...analyzerMetadata(packs),
  });

  assert.equal(result.profile.locale, "en");
  assert.deepEqual(result.profile.actions, ["migrate", "design"]);
  assert.deepEqual(result.profile.subtasks, [
    {
      id: "database-migrate",
      normalizedGoal: "migrate postgresql",
      actions: ["migrate"],
      artifactTypes: [],
      candidateDomainIds: ["database"],
    },
    {
      id: "mobile-design",
      normalizedGoal: "design mobile-interface",
      actions: ["design"],
      artifactTypes: ["mobile-interface"],
      candidateDomainIds: ["mobile"],
    },
  ]);
});

test("analyzer reports an unknown technology signal without persisting its value", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const result = analyzeTask({
    prompt: "Implement the API using SecretDBCanary.",
    ...analyzerMetadata(packs),
  });

  assert.deepEqual(result.warnings, ["unclassified-technology-signal"]);
  assert.doesNotMatch(JSON.stringify(result), /SecretDBCanary/i);
});

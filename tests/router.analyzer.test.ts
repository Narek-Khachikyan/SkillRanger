import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { analyzeTask } from "../src/router/analyzer.ts";
import { analyzeFrontendIntent } from "../src/domains/frontend/intents/index.ts";
import { loadRouterFixturePacks, type RouterFixturePack } from "../src/router/fixtures.ts";
import type { ProjectFingerprint } from "../src/types.ts";
import { buildRoutingContext } from "../src/router/context.ts";
import { canonicalSkillRoutingDocument } from "../src/router/metadata.ts";
import { coreRoutingVocabulary } from "../src/router/vocabulary/core.ts";
import { adaptFixtureRoutingPacks } from "../src/router/vocabulary/load.ts";
import { buildCanonicalRequirements } from "../src/router/requirements.ts";

const fixtureRoot = path.resolve("tests/fixtures/router-packs");

const analyzerMetadata = (packs: RouterFixturePack[]) => {
  const skills = packs.flatMap(({ skills }) => skills.map((skill) => ({
    domains: skill.domains,
    actions: skill.actions,
    artifactTypes: skill.artifactTypes,
    intentTags: skill.intentTags,
    technologyTags: skill.technologyTags,
    qualityGoals: skill.qualityGoals,
    environmentSignals: skill.environmentSignals,
  })));
  return {
    domains: packs.map(({ domain }) => domain),
    skills,
    routingContext: buildRoutingContext({
      packs: adaptFixtureRoutingPacks(packs),
      skills: packs.flatMap(({ skills: packSkills }) => packSkills.map(canonicalSkillRoutingDocument)),
      coreVocabulary: coreRoutingVocabulary,
      baseRegistryDigest: "analyzer-test",
    }),
  };
};

const frontendSkills = [{
  id: "frontend.primary",
  domains: ["frontend"],
  actions: ["create" as const],
  artifactTypes: ["web-interface"],
  intentTags: ["website"],
  technologyTags: ["react"],
  qualityGoals: [],
}];
const frontendDomains = [{
  id: "frontend",
  routing: {
    aliases: ["frontend-web"],
    intentTags: ["website"],
    artifactTypes: ["web-interface"],
    technologyTags: ["react"],
    projectTags: ["frontend"],
  },
}];
const frontendMetadata = {
  domains: frontendDomains,
  skills: frontendSkills,
  routingContext: buildRoutingContext({
    packs: [{
      domainId: "frontend",
      routing: frontendDomains[0].routing,
      ownership: [],
      vocabulary: {
        schemaVersion: "routing-vocabulary/1.0",
        owner: { kind: "domain", id: "frontend" },
        entries: [{ kind: "artifact", id: "web-interface", locale: "ru", phrases: ["сайт"] }],
      },
    }],
    skills: frontendSkills.map(canonicalSkillRoutingDocument),
    coreVocabulary: coreRoutingVocabulary,
    baseRegistryDigest: "frontend-test",
  }),
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
    prompt: "Migrate PostgreSQL and redesign the mobile app.",
    ...analyzerMetadata(packs),
  });

  assert.equal(result.profile.locale, "en");
  assert.deepEqual(result.profile.actions, ["migrate", "design"]);
  assert.deepEqual(result.profile.subtasks, [
    {
      id: "task-d006b1789a8e",
      normalizedGoal: "action:migrate technology:postgresql",
      actions: ["migrate"],
      artifactTypes: [],
      candidateDomainIds: ["database"],
    },
    {
      id: "task-62210c8dc5e4",
      normalizedGoal: "action:design artifact:mobile-interface",
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

test("requirements dedupe provenance and keep the winning requirement class confidence", () => {
  const requirements = buildCanonicalRequirements([
    { kind: "technology", id: "react", source: "fingerprint", evidenceEligible: false, ownerIds: ["frontend"], confidence: 1 },
    { kind: "technology", id: "react", source: "prompt-normalized", evidenceEligible: false, ownerIds: ["frontend"], confidence: 0.8 },
    { kind: "technology", id: "react", source: "prompt-exact", evidenceEligible: true, ownerIds: ["frontend"], confidence: 0.9 },
    { kind: "action", id: "create", source: "prompt-inferred", evidenceEligible: true, ownerIds: ["core"], confidence: 0.75 },
  ]);
  assert.deepEqual(requirements, [
    { kind: "action", id: "create", confidence: 0.75, baseWeight: 1, sources: ["prompt-inferred"], requirementClass: "inferred" },
    { kind: "technology", id: "react", confidence: 0.9, baseWeight: 1, sources: ["prompt-exact", "prompt-normalized", "fingerprint"], requirementClass: "explicit" },
  ]);
});

test("analyzer keeps intents internal, infers guarded create, and produces a stable signal digest", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const metadata = analyzerMetadata(packs);
  const intent = analyzeTask({ prompt: "Fix refresh token authentication.", ...metadata });
  assert.ok(intent.requirements.some(({ kind, id }) => kind === "intent" && id === "refresh-token"));
  assert.ok(intent.routingIntentTags.includes("refresh-token"));
  assert.equal(intent.profile.evidence.some(({ kind }) => (kind as string) === "intent"), false);

  const inferred = analyzeTask({ prompt: "I need a page.", ...metadata });
  assert.ok(inferred.requirements.some(({ kind, id, requirementClass, confidence }) =>
    kind === "action" && id === "create" && requirementClass === "inferred" && confidence === 0.75));
  assert.equal(inferred.signalDigest, analyzeTask({ prompt: "I need a page.", ...metadata }).signalDigest);
});

test("noun-only design does not become an action", async () => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const metadata = analyzerMetadata(packs);
  assert.equal(analyzeTask({ prompt: "Красивый дизайн страницы.", ...metadata }).profile.actions.includes("design"), false);
  assert.equal(analyzeTask({ prompt: "Design the page.", ...metadata }).profile.actions.includes("design"), true);
});

test("analyzer extracts explicit visual, motion, and accessibility intents for Russian Bleach prompt", async () => {
  const prompt = "Создай современный одностраничный сайт по Bleach с узнаваемым нешаблонным визуальным дизайном, атмосферными анимациями, интерактивными элементами, адаптивностью и доступностью. @skillranger";
  const result = analyzeFrontendIntent(prompt);

  assert.ok(result.intents.has("visual-design-polish"));
  assert.ok(result.intents.has("motion-design"));
  assert.ok(result.intents.has("accessibility-review"));
});

test("analyzer extracts explicit visual, motion, and accessibility intents for English Dragon Ball prompt", async () => {
  const prompt = "Create a visually impressive responsive one-page Dragon Ball website. Avoid generic AI design. Add subtle hover and scroll interactions. Animations should be fast but not distracting. Respect prefers-reduced-motion. Ensure keyboard navigation, visible focus, semantic HTML and contrast. Maintain good Core Web Vitals. skillranger";
  const result = analyzeFrontendIntent(prompt);

  assert.ok(result.intents.has("visual-design-polish"));
  assert.ok(result.intents.has("motion-design"));
  assert.ok(result.intents.has("accessibility-review"));
});

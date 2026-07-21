import test from "node:test";
import assert from "node:assert/strict";
import { loadRouterFixturePacks, type RouterFixturePack } from "../src/router/fixtures.ts";
import { analyzeTask } from "../src/router/analyzer.ts";
import { normalizeDomainAlias, resolveDomains } from "../src/router/resolver.ts";
import type { ProjectFingerprint } from "../src/types.ts";
import { buildRoutingContext } from "../src/router/context.ts";
import { canonicalSkillRoutingDocument } from "../src/router/metadata.ts";
import { coreRoutingVocabulary } from "../src/router/vocabulary/core.ts";
import { adaptFixtureRoutingPacks } from "../src/router/vocabulary/load.ts";

const packsPath = "tests/fixtures/router-packs";

const metadata = (packs: RouterFixturePack[]) => {
  const skills = packs.flatMap(({ skills }) => skills.map((skill) => ({
    domains: skill.domains,
    roles: skill.roles,
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
      baseRegistryDigest: "resolver-test",
    }),
  };
};

const fingerprint = (overrides: Partial<ProjectFingerprint> = {}): ProjectFingerprint => ({
  schemaVersion: "1.0",
  root: "/project",
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

test("resolver separates semantic score from pack availability", async () => {
  const packs = await loadRouterFixturePacks(packsPath);
  const input = metadata(packs);
  const profile = analyzeTask({
    prompt: "Fix refresh token authentication in NestJS.",
    ...input,
    fingerprint: fingerprint({
      frameworks: [{ name: "NestJS", confidence: 1, evidence: [] }],
      tags: ["backend", "nodejs"],
    }),
  }).profile;
  const result = resolveDomains({
    profile,
    ...input,
    fingerprint: fingerprint({
      frameworks: [{ name: "NestJS", confidence: 1, evidence: [] }],
      tags: ["backend", "nodejs"],
    }),
    availableDomainIds: ["database", "mobile", "qa-testing", "security-appsec"],
  });

  const backend = result.scores.find(({ id }) => id === "backend-api");
  assert.ok(backend);
  assert.ok(backend.semanticScore > 0);
  assert.equal(backend.available, false);
  assert.equal(result.primaryDomainId, undefined);
  assert.equal(result.candidates.some(({ id }) => id === "backend-api"), false);
});

test("resolver uses intent first when repository has no project signals", async () => {
  const packs = await loadRouterFixturePacks(packsPath);
  const input = metadata(packs);
  const empty = fingerprint();
  const profile = analyzeTask({
    prompt: "Implement a mobile screen in the React Native app.",
    ...input,
    fingerprint: empty,
  }).profile;
  const result = resolveDomains({ profile, ...input, fingerprint: empty });

  assert.equal(result.primaryDomainId, "mobile");
  assert.equal(result.clarificationRequired, false);
  assert.equal(result.candidates[0]?.id, "mobile");
});

test("resolver normalizes aliases to canonical domain ids", async () => {
  const packs = await loadRouterFixturePacks(packsPath);
  const input = metadata(packs);
  assert.equal(normalizeDomainAlias(" BACKEND ", input.domains), "backend-api");
  assert.equal(normalizeDomainAlias("frontend-web", [{
    id: "frontend",
    routing: { aliases: ["frontend-web"], intentTags: [], artifactTypes: [], technologyTags: [], projectTags: [] },
  }]), "frontend");
});

test("resolver returns supporting domains while keeping a primary domain", async () => {
  const packs = await loadRouterFixturePacks(packsPath);
  const input = metadata(packs);
  const profile = analyzeTask({
    prompt: "Fix authentication API and add integration tests.",
    ...input,
  }).profile;
  const result = resolveDomains({ profile, ...input });

  assert.equal(result.primaryDomainId, "backend-api");
  assert.ok(result.supportingDomainIds.includes("qa-testing"));
  assert.ok(result.candidates.some(({ id, role }) => id === "backend-api" && role === "primary"));
  assert.ok(result.candidates.some(({ id, role }) => id === "qa-testing" && role === "supporting"));
  assert.ok(result.candidates.every(({ reasons }) => reasons.every((reason) => /^[a-z-]+:[a-z0-9._-]+$/.test(reason))));
});

test("resolver applies the exact ambiguity rule without project evidence", async () => {
  const packs = await loadRouterFixturePacks(packsPath);
  const input = metadata(packs.filter(({ domain }) => domain.id !== "frontend"));
  input.domains.push({
    id: "frontend",
    targetSurface: "web",
    routing: {
      aliases: ["frontend-web"],
      intentTags: ["web-interface", "application-interface"],
      artifactTypes: ["web-interface", "application-interface"],
      technologyTags: ["react"],
      projectTags: ["frontend", "web"],
    },
  });
  const mobile = input.domains.find(({ id }) => id === "mobile");
  if (mobile) mobile.targetSurface = "mobile";
  input.skills.push({
    domains: ["frontend"],
    roles: ["primary"],
    actions: ["create"],
    artifactTypes: ["web-interface", "application-interface"],
    intentTags: ["web-interface", "application-interface"],
    technologyTags: ["react"],
    qualityGoals: [],
  });
  input.routingContext = buildRoutingContext({
    packs: [
      ...adaptFixtureRoutingPacks(packs.filter(({ domain }) => domain.id !== "frontend")),
      { domainId: "frontend", routing: input.domains.at(-1)!.routing, ownership: [] },
    ],
    skills: input.skills.map((skill, index) => canonicalSkillRoutingDocument({ id: `test.skill-${index}`, ...skill })),
    coreVocabulary: coreRoutingVocabulary,
    baseRegistryDigest: "resolver-ambiguity-test",
  });
  const profile = analyzeTask({
    prompt: "Create a new application interface.",
    ...input,
  }).profile;
  const result = resolveDomains({ profile, ...input });

  assert.equal(result.clarificationRequired, true);
  assert.deepEqual(result.ambiguousDomainIds, ["frontend", "mobile"]);
  assert.equal(result.primaryDomainId, undefined);
});

import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTask } from "../src/router/analyzer.ts";
import { buildRoutingContext } from "../src/router/context.ts";
import { loadRouterFixturePacks } from "../src/router/fixtures.ts";
import { canonicalSkillRoutingDocument } from "../src/router/metadata.ts";
import { coreRoutingVocabulary } from "../src/router/vocabulary/core.ts";
import { adaptFixtureRoutingPacks } from "../src/router/vocabulary/load.ts";

const fixtureRoot = "tests/fixtures/router-packs";

const input = async (protectMobilePhrase = false) => {
  const packs = await loadRouterFixturePacks(fixtureRoot);
  const skills = packs.flatMap(({ skills }) => skills);
  const loaded = adaptFixtureRoutingPacks(packs).map((pack) => protectMobilePhrase && pack.domainId === "mobile" ? {
    ...pack,
    vocabulary: {
      ...pack.vocabulary!,
      entries: [...pack.vocabulary!.entries, {
        kind: "technology" as const,
        id: "react-native",
        locale: "mixed" as const,
        phrases: ["ios и android"],
      }],
    },
  } : pack);
  return {
    domains: packs.map(({ domain }) => domain),
    skills,
    routingContext: buildRoutingContext({
      packs: loaded,
      skills: skills.map(canonicalSkillRoutingDocument),
      coreVocabulary: coreRoutingVocabulary,
      baseRegistryDigest: "segmentation-test",
    }),
  };
};

test("comma, semicolon, and adjacent word separators preserve three task heads", async () => {
  const result = analyzeTask({
    prompt: "Migrate PostgreSQL, redesign the mobile app; then deploy with Docker.",
    ...await input(),
  });
  assert.deepEqual(result.profile.subtasks.map(({ candidateDomainIds }) => candidateDomainIds[0]), [
    "database", "mobile", "devops-platform",
  ]);
  assert.ok(result.profile.subtasks.every(({ normalizedGoal }) => /^(?:action|artifact|intent|technology|quality):/.test(normalizedGoal)));
});

test("a separator inside an accepted ios и android phrase does not split or lose the signal", async () => {
  const result = analyzeTask({
    prompt: "Implement a mobile app for ios и android and test integration tests.",
    ...await input(true),
  });
  assert.deepEqual(result.profile.subtasks.map(({ candidateDomainIds }) => candidateDomainIds[0]), ["mobile", "qa-testing"]);
  assert.match(result.profile.subtasks[0].normalizedGoal, /technology:react-native/);
});

test("same-domain heads merge and do not request decomposition", async () => {
  const result = analyzeTask({
    prompt: "Create a web interface, review the web interface; then optimize the web interface.",
    ...await input(),
  });
  assert.deepEqual(result.profile.subtasks, []);
});

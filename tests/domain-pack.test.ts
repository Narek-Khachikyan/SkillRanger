import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import "../src/domains/bundled.ts";
import {
  getDomainPack,
  listDomainPacks,
  readDomainPackManifest,
  registerDomainPack,
  unregisterDomainPack,
  validateDomainPackManifest,
} from "../src/domains/registry.ts";
import { recommendSkills } from "../src/recommender/index.ts";
import { scanProject } from "../src/scanner/index.ts";
import { loadLocalRegistry } from "../src/registry/index.ts";

test("bundled frontend domain registers through the generic domain API", async () => {
  const domain = getDomainPack("frontend");
  assert.ok(domain);
  assert.equal(domain.manifest.skillIdPrefix, "frontend.");
  assert.ok(domain.manifest.capabilities.includes("verification"));
  assert.ok(domain.manifest.ownership.some((rule) => rule.primarySkill === "frontend.design-to-code"));
  assert.equal(listDomainPacks().some((pack) => pack.manifest.id === "frontend"), true);

  const diskManifest = await readDomainPackManifest("frontend");
  assert.deepEqual(validateDomainPackManifest(diskManifest), []);
  assert.deepEqual(diskManifest, domain.manifest);
});

test("bundled frontend domain resolves its eval suite through the generic registry", async () => {
  const registry = await import("../src/domains/registry.ts") as typeof import("../src/domains/registry.ts") & {
    resolveDomainEvalSuitePath?: (pack: NonNullable<ReturnType<typeof getDomainPack>>) => Promise<string | undefined>;
  };
  assert.equal(typeof registry.resolveDomainEvalSuitePath, "function");
  const domain = getDomainPack("frontend");
  assert.ok(domain);
  const suitePath = await registry.resolveDomainEvalSuitePath(domain);
  assert.ok(suitePath);
  const suite = JSON.parse(await readFile(suitePath, "utf8")) as { name?: string };
  assert.equal(suite.name, "frontend-skill-quality-v1");
});

test("a synthetic non-frontend domain can register without changing core", () => {
  const manifest = {
    schemaVersion: "1.0" as const,
    id: "backend-test",
    displayName: "Backend Test",
    version: "0.0.1",
    coreApi: "1.0",
    skillIdPrefix: "backend-test.",
    capabilities: ["intent-routing" as const],
    artifacts: { intents: ["intents.json"], schemas: [], recipes: [], workflows: [], validators: [] },
    ownership: [{ intent: "api-review", primarySkill: "backend-test.api-review", supportingSkills: [] }],
  };
  const pack = registerDomainPack({
    manifest,
    routing: {
      rejectIntent: () => false,
      laneAdjustment: () => 0,
      skillAdjustment: () => 0,
      includeSkill: () => true,
      compose: (recommendations) => recommendations,
    },
  });
  assert.equal(getDomainPack("backend-test"), pack);
  assert.equal(unregisterDomainPack("backend-test"), true);
});

test("generic recommender preserves frontend routing through the domain adapter", async () => {
  const [fingerprint, skills] = await Promise.all([
    scanProject(path.resolve("fixtures/next-react-ts")),
    loadLocalRegistry("registry"),
  ]);
  const recommendations = recommendSkills(fingerprint, skills, {
    domainId: "frontend",
    userIntent: "Implement this supplied product screenshot in the React app.",
  });
  assert.equal(recommendations[0]?.skillId, "frontend.design-to-code");
});

test("core source does not contain concrete frontend skill ids", async () => {
  const coreFiles = [
    "src/recommender/index.ts",
    "src/domains/registry.ts",
    "src/runtime/verification.ts",
  ];
  for (const file of coreFiles) {
    assert.doesNotMatch(await readFile(file, "utf8"), /frontend\.[a-z]/, file);
  }
});

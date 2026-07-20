import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import "../src/domains/bundled.ts";
import {
  getDomainPack,
  listDomainPacks,
  loadBundledRouterPacks,
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

test("bundled router packs are discovered as validated declarative data", async () => {
  const packs = await loadBundledRouterPacks();
  assert.deepEqual(packs.map(({ id }) => id), ["frontend"]);
  assert.equal(packs[0]?.id, "frontend");
  assert.deepEqual(packs[0]?.routing.aliases, ["frontend-web", "web-ui"]);
  assert.ok(packs[0]?.routing.projectTags.includes("react"));
});

test("domain routing metadata validates aliases, bounds, conflicts, and unknown fields", () => {
  const base = structuredClone(getDomainPack("frontend")?.manifest);
  assert.ok(base);
  base.routing = {
    aliases: ["frontend-web", "FRONTEND-WEB", "frontend"],
    intentTags: Array.from({ length: 65 }, (_, index) => `intent-${index}`),
    artifactTypes: ["web-interface"],
    technologyTags: ["x".repeat(129)],
    projectTags: ["react"],
    unexpected: [],
  } as typeof base.routing;

  const issues = validateDomainPackManifest(base);
  assert.ok(issues.some((issue) => issue.includes("routing.aliases") && issue.includes("unique")));
  assert.ok(issues.some((issue) => issue.includes("canonical domain id")));
  assert.ok(issues.some((issue) => issue.includes("routing.intentTags") && issue.includes("64")));
  assert.ok(issues.some((issue) => issue.includes("routing.technologyTags.0") && issue.includes("128")));
  assert.ok(issues.some((issue) => issue.includes("routing.unexpected") && issue.includes("unknown")));
});

test("bundled router pack loader reads manifests without executing pack code", async () => {
  const { mkdir, mkdtemp, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const root = await mkdtemp(path.join(os.tmpdir(), "skillranger-domain-packs-"));
  const packRoot = path.join(root, "safe-pack");
  await mkdir(packRoot);
  const manifest = structuredClone(getDomainPack("frontend")?.manifest);
  assert.ok(manifest);
  manifest.id = "safe-pack";
  manifest.skillIdPrefix = "safe-pack.";
  manifest.routing!.aliases = ["safe-pack-alias"];
  await writeFile(path.join(packRoot, "domain.manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(packRoot, "index.js"), "throw new Error('must not execute');\n");

  const packs = await loadBundledRouterPacks(root);
  assert.equal(packs[0]?.id, "safe-pack");
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

test("frontend routing selects Russian accessibility, performance, and audit intents", async () => {
  const [fingerprint, skills] = await Promise.all([
    scanProject(path.resolve("fixtures/next-react-ts")),
    loadLocalRegistry("registry"),
  ]);
  const cases = [
    ["Проверь доступность формы, клавиатуру, фокус и контраст", "frontend.accessibility-review"],
    ["Страница тормозит: проверь LCP, INP и размер бандла", "frontend.performance-review"],
    ["Сделай финальный аудит фронтенда перед релизом", "frontend.audit"],
  ] as const;
  for (const [intent, expected] of cases) {
    const recommendations = recommendSkills(fingerprint, skills, {
      domainId: "frontend",
      userIntent: intent,
      targetAgent: "generic-agent-skills",
    });
    assert.equal(recommendations[0]?.skillId, expected);
  }
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

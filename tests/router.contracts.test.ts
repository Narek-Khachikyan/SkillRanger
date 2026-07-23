import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mcpTools } from "../src/mcp/tools.ts";
import { loadRouterGoldenCases, loadRouterFixturePacks } from "../src/router/fixtures.ts";
import { validateJsonSchema } from "../src/runtime/strict/json-schema.ts";

const schemaFiles = [
  "task-profile.schema.json",
  "task-routing-result.schema.json",
  "router-tool-result.schema.json",
  "router-run.schema.json",
  "router-config.schema.json",
  "domain-manifest.schema.json",
  "router-vocabulary.schema.json",
] as const;

const resolvePointer = (root: unknown, reference: string) => {
  assert.match(reference, /^#\//);
  return reference.slice(2).split("/").reduce<unknown>((value, segment) => {
    assert.ok(value && typeof value === "object" && !Array.isArray(value));
    return (value as Record<string, unknown>)[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
  }, root);
};

const visitSchema = (root: unknown, value: unknown) => {
  if (Array.isArray(value)) {
    value.forEach((item) => visitSchema(root, item));
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.$ref === "string") assert.ok(resolvePointer(root, record.$ref), record.$ref);
  if (record.type === "object") assert.equal(record.additionalProperties, false, "object schemas must be closed");
  if (record.type === "object" && Array.isArray(record.required)) {
    const properties = record.properties;
    if (properties && typeof properties === "object" && !Array.isArray(properties)) {
      for (const key of record.required) {
        assert.equal(typeof key, "string");
        assert.ok(Object.hasOwn(properties, key), `required property ${key} must have a schema`);
      }
    }
  }
  for (const child of Object.values(record)) visitSchema(root, child);
};

test("router schemas are closed JSON Schema 2020-12 documents with resolvable local references", async () => {
  for (const name of schemaFiles) {
    const schema = JSON.parse(await readFile(path.join("schemas", name), "utf8")) as Record<string, unknown>;
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema", name);
    assert.equal(schema.type, "object", name);
    assert.equal(schema.additionalProperties, false, name);
    visitSchema(schema, schema);
  }
});

test("router schemas validate real instances and reject malformed contracts", async () => {
  const schema = JSON.parse(await readFile("schemas/task-profile.schema.json", "utf8")) as Record<string, unknown>;
  const profile = {
    schemaVersion: "task-profile/1.0",
    normalizedGoal: "create web-interface",
    locale: "en",
    actions: ["create"],
    artifactTypes: ["web-interface"],
    technologies: [],
    constraints: [],
    qualityGoals: [],
    acceptanceCriteria: [],
    domains: [],
    subtasks: [],
    evidence: [{ source: "prompt", kind: "action", id: "create" }],
  };
  assert.deepEqual(validateJsonSchema(schema, profile), []);
  assert.ok(validateJsonSchema(schema, { ...profile, locale: "secret", rawPrompt: "canary" }).length > 0);
});

test("domain manifest schema keeps v1.0 and v1.1 fields version-bound", async () => {
  const schema = JSON.parse(await readFile("schemas/domain-manifest.schema.json", "utf8")) as Record<string, unknown>;
  const bundled = JSON.parse(await readFile("domains/frontend/domain.manifest.json", "utf8")) as Record<string, unknown>;
  const { routingVocabulary: _routingVocabulary, ...artifacts } = bundled.artifacts as Record<string, unknown>;
  const ownership = (bundled.ownership as Array<Record<string, unknown>>).map((rule) => ({
    ...rule,
    ...(Array.isArray(rule.requiresEvidence)
      ? { requiresEvidence: rule.requiresEvidence.map((evidence) => typeof evidence === "string" ? evidence : (evidence as { id: string }).id) }
      : {}),
  }));
  const v10 = { ...bundled, schemaVersion: "1.0", artifacts, ownership };
  const v11 = {
    ...bundled,
    schemaVersion: "1.1",
    artifacts: { ...artifacts, routingVocabulary: "routing.vocabulary.json" },
    ownership: ownership.map((rule) => rule.primarySkill === "frontend.design-to-code"
      ? { ...rule, requiresEvidence: [{ kind: "intent", id: "visual-reference", allowedSources: ["prompt-exact"] }] }
      : rule),
  };
  assert.deepEqual(validateJsonSchema(schema, v10), []);
  assert.deepEqual(validateJsonSchema(schema, v11), []);
  assert.ok(validateJsonSchema(schema, { ...v10, artifacts: v11.artifacts }).length > 0);
  assert.ok(validateJsonSchema(schema, { ...v11, ownership }).length > 0);
});

test("public router types are independent from MCP transport types", async () => {
  const source = await readFile("src/router/types.ts", "utf8");
  assert.doesNotMatch(source, /from\s+["'][^"']*mcp/i);
  assert.doesNotMatch(source, /McpTool|McpInput|McpResult/);
});

test("semantic hints use a permissive MCP envelope and one public Core error code", async () => {
  const prepare = mcpTools.find(({ name }) => name === "prepare_task");
  assert.ok(prepare);
  const properties = (prepare.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
  assert.deepEqual(properties.semanticHints, { type: "object" });

  const schema = JSON.parse(await readFile("schemas/router-tool-result.schema.json", "utf8")) as {
    $defs: { errorCode: { enum: string[] } };
  };
  assert.ok(schema.$defs.errorCode.enum.includes("semantic-hint-invalid"));
  for (const file of ["src/router/prepare.ts", "src/mcp/tools/router.ts", "src/mcp/tools/types.ts"]) {
    assert.match(await readFile(file, "utf8"), /semantic-hint-invalid/, file);
  }
});

test("package scripts include router tests through npm test and the router eval release gate", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  assert.match(packageJson.scripts?.test ?? "", /tests\/\*\.test\.ts/);
  assert.equal(packageJson.scripts?.["eval:router"], "node src/evals/router/index.ts");
  assert.match(packageJson.scripts?.["release:check"] ?? "", /npm run eval:router/);
  assert.match(packageJson.scripts?.check ?? "", /tsc -p tsconfig\.json --noEmit/);
  const packageFiles = JSON.parse(await readFile("package.json", "utf8")) as { files?: string[] };
  assert.ok(packageFiles.files?.includes("tests/fixtures/router-cases.json"));
  assert.ok(packageFiles.files?.includes("tests/fixtures/router-packs/"));
});

test("router golden fixture covers every Task 1 scenario", async () => {
  const cases = await loadRouterGoldenCases("tests/fixtures/router-cases.json");
  assert.deepEqual(cases.map(({ id }) => id), [
    "frontend-create",
    "frontend-review",
    "frontend-accessibility-fix",
     "backend-auth-synthetic",
     "database-optimization-synthetic",
     "mobile-feature-synthetic",
     "devops-deployment-synthetic",
     "docs-api-synthetic",
     "observability-synthetic",
     "iac-cloud-synthetic",
     "package-library-synthetic",
     "compliance-privacy-synthetic",
     "frontend-synthetic",
     "mixed-synthetic-domains",
    "unrelated-subtasks",
    "ambiguous-web-mobile",
    "empty-repository",
    "missing-production-pack",
    "strict-installed",
    "strict-not-installed",
    "strict-contract-missing",
    "missing-skill-input",
    "missing-capabilities",
    "dependency-cycle",
    "conflict",
    "budget-overflow",
    "prompt-injection",
    "privacy-canary",
  ]);
  assert.equal(new Set(cases.map(({ id }) => id)).size, cases.length);
  assert.deepEqual(cases.filter(({ reviewNote }) => reviewNote !== undefined).map(({ id, reviewNote }) => ({ id, reviewNote })), [
    { id: "backend-auth-synthetic", reviewNote: "router/2.0 decomposition contract" },
    { id: "mixed-synthetic-domains", reviewNote: "router/2.0 decomposition contract" },
  ]);
});

test("natural-language quarantine freezes 60 validated cases and rich selection expectations", async () => {
  const cases = await loadRouterGoldenCases("tests/fixtures/router-paraphrase-cases.json");
  assert.equal(cases.length, 60);
  assert.equal(new Set(cases.map(({ id }) => id)).size, 60);
  const cupcake = cases.find(({ id }) => id === "frontend-cupcake-natural-language");
  assert.deepEqual(cupcake?.expected, {
    status: "prepared",
    domainIds: ["frontend"],
    requiredSignals: [
      "action:create",
      "artifact:web-interface",
      "intent:visual-design",
      "intent:motion-design",
      "intent:responsive-design",
    ],
    primarySkillId: "frontend.visual-design-polish",
    requiredPrimaryExclusionReasons: {
      "frontend.design-to-code": ["missing-required-evidence:intent:visual-reference"],
    },
    requiredCompanionSkillIds: ["frontend.motion-design"],
    allowedOptionalSkillIds: ["frontend.tailwind-ui-polish", "frontend.accessibility-review"],
    forbiddenSkillIds: ["frontend.design-to-code", "frontend.motion-audit"],
  });
});

test("synthetic fixture packs load as declarative data in stable order", async () => {
  const packs = await loadRouterFixturePacks("tests/fixtures/router-packs");
   assert.deepEqual(packs.map(({ domain }) => domain.id), [
     "backend-api",
     "compliance-privacy",
     "database",
     "devops-platform",
     "docs-techwriting",
     "frontend",
     "iac-cloud",
     "mobile",
     "observability-sre",
     "package-library",
     "qa-testing",
     "security-appsec",
   ]);
   assert.equal(packs.length, 12);
   assert.ok(packs.every((pack) => pack.skills.length > 0));
});

test("fixture pack loader rejects executable files instead of importing them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillranger-router-pack-"));
  const packRoot = path.join(root, "unsafe");
  await mkdir(packRoot);
  await writeFile(path.join(packRoot, "pack.json"), JSON.stringify({
    schemaVersion: "router-fixture-pack/1.0",
    domain: {
      id: "unsafe",
      displayName: "Unsafe",
      routing: { aliases: [], intentTags: [], artifactTypes: [], technologyTags: [], projectTags: [] },
    },
    skills: [],
  }));
  await writeFile(path.join(packRoot, "index.js"), "throw new Error('must not execute');\n");

  await assert.rejects(() => loadRouterFixturePacks(root), /unsupported fixture entry index\.js/);
});

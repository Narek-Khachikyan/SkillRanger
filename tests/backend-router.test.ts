import test from "node:test";
import assert from "node:assert/strict";
import { recommendSkills } from "../src/recommender/index.ts";
import { scanProject } from "../src/scanner/index.ts";
import { loadLocalRegistry } from "../src/registry/index.ts";
import path from "node:path";

const nextFixture = path.resolve("fixtures/next-react-ts");
const backendFixture = path.resolve("fixtures/backend-node");

test("backend router selects en api-design as primary", async () => {
  const [fingerprint, skills] = await Promise.all([scanProject(nextFixture), loadLocalRegistry("registry")]);
  const recs = recommendSkills(fingerprint, skills, { userIntent: "Design the OpenAPI contract for a REST endpoint with Route Handlers", targetAgent: "codex" });
  // Should be backend api-design
  const primary = recs.find((r) => r.skillId === "backend.api-design");
  assert.ok(primary, "backend.api-design should be recommended");
  assert.equal(recs[0]?.skillId, "backend.api-design");
});

test("backend router selects ru persistence as primary", async () => {
  const [fingerprint, skills] = await Promise.all([scanProject(nextFixture), loadLocalRegistry("registry")]);
  const recs = recommendSkills(fingerprint, skills, { userIntent: "Сделай миграцию базы данных для призма схемы без DROP", targetAgent: "codex" });
  const primary = recs.find((r) => r.skillId === "backend.persistence");
  assert.ok(primary);
  assert.equal(recs[0]?.skillId, "backend.persistence");
});

test("backend router selects ru auth as primary", async () => {
  const [fingerprint, skills] = await Promise.all([scanProject(nextFixture), loadLocalRegistry("registry")]);
  const recs = recommendSkills(fingerprint, skills, { userIntent: "Сделай аутентификацию через next-auth с JWT", targetAgent: "codex" });
  assert.ok(recs.find((r) => r.skillId === "backend.auth"));
  assert.equal(recs[0]?.skillId, "backend.auth");
});

test("backend router respects backend fixture tags", async () => {
  // backend-node fixture has backend tags, should get backend recommendations
  const [fingerprint, skills] = await Promise.all([scanProject(backendFixture), loadLocalRegistry("registry")]);
  // If fixture doesn't exist, skip
  if (fingerprint.tags.length === 0) {
    console.log("backend fixture not found, skipping");
    return;
  }
  const recs = recommendSkills(fingerprint, skills, { userIntent: "Design API contract", targetAgent: "codex" });
  assert.ok(recs.some((r) => r.skillId.startsWith("backend.")));
});

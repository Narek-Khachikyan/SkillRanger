import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deterministicRoutingKey, prepareTask } from "../src/router/prepare.ts";
import type { DeterministicRoutingProjection } from "../src/router/types.ts";

const project = () => mkdtemp(path.join(os.tmpdir(), "skillranger-determinism-"));
const bundledRegistry = path.resolve("registry");
const fixtureRegistry = path.resolve("tests/fixtures/router-packs");

test("prepared replays keep the deterministic key while run identities differ", async () => {
  const input = {
    registry: { kind: "bundled" as const, root: bundledRegistry },
    prompt: "Create a responsive web interface @skillranger",
    activation: { mode: "explicit" as const },
    routingDate: "2026-07-21",
  };
  const [first, second] = await Promise.all([
    prepareTask({ ...input, projectRoot: await project() }),
    prepareTask({ ...input, projectRoot: await project() }),
  ]);
  assert.equal(first.status, "prepared");
  assert.equal(second.status, "prepared");
  if (first.status !== "prepared" || second.status !== "prepared") return;
  assert.equal(first.routing.deterministicKey, second.routing.deterministicKey);
  assert.notEqual(first.run.routerRunId, second.run.routerRunId);
  assert.notEqual(first.run.runtimeRunId, second.run.runtimeRunId);
});

test("clarification replays exclude token identity and expiry from the deterministic key", async () => {
  const ambiguousRegistry = await mkdtemp(path.join(os.tmpdir(), "skillranger-ambiguous-registry-"));
  for (const domainId of ["frontend", "mobile"]) {
    const pack = JSON.parse(await readFile(path.join(fixtureRegistry, domainId, "pack.json"), "utf8")) as {
      domain: { targetSurface?: string };
    };
    if (domainId === "mobile") pack.domain.targetSurface = "native";
    const destination = path.join(ambiguousRegistry, domainId);
    await mkdir(destination);
    await writeFile(path.join(destination, "pack.json"), JSON.stringify(pack));
  }
  const input = {
    registry: { kind: "test-fixture" as const, root: ambiguousRegistry },
    prompt: "Create a new application interface. @skillranger",
    activation: { mode: "explicit" as const },
    routingDate: "2026-07-21",
  };
  const first = await prepareTask({ ...input, projectRoot: await project() });
  const second = await prepareTask({ ...input, projectRoot: await project() });
  assert.equal(first.status, "clarification_required");
  assert.equal(second.status, "clarification_required");
  if (first.status !== "clarification_required" || second.status !== "clarification_required") return;
  assert.equal(first.routing.deterministicKey, second.routing.deterministicKey);
  assert.notEqual(first.continuationToken, second.continuationToken);
});

test("the canonical outcome variant participates in the deterministic key", () => {
  const base = {
    routerAlgorithmVersion: "router/2.0" as const,
    routingDate: "2026-07-21",
    activation: { mode: "direct" as const },
    targetAgent: "codex",
    strict: false,
    capabilities: ["filesystem"],
    taskProfile: {
      schemaVersion: "task-profile/1.0" as const,
      normalizedGoal: "",
      locale: "en" as const,
      actions: [], artifactTypes: [], technologies: [], constraints: [], qualityGoals: [], acceptanceCriteria: [], domains: [], subtasks: [], evidence: [],
    },
    signalDigest: "sha256:a",
    semanticHintsDigest: "sha256:b",
    fingerprintDigest: "sha256:c",
    vocabularyDigest: "sha256:d",
    routingRegistryDigest: "sha256:e",
    configDigest: "sha256:f",
    domains: [],
    warnings: [],
  };
  const noMatch: DeterministicRoutingProjection = { ...base, outcome: { status: "no_matching_skills", suggestedAction: "proceed" } };
  const clarification: DeterministicRoutingProjection = { ...base, outcome: { status: "clarification_required", clarification: { questions: [] } } };
  assert.notEqual(deterministicRoutingKey(noMatch), deterministicRoutingKey(clarification));
});

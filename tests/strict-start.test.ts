import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findSkill } from "../src/registry/index.ts";
import { getAdapter } from "../src/installers/codex.ts";
import {
  StrictSkillRunError,
  startPreparedStrictSkillRun,
} from "../src/runtime/strict/index.ts";

const install = async (projectRoot: string, skillId: string) => {
  const skill = await findSkill(skillId);
  assert.ok(skill);
  await getAdapter("codex").applyInstall(skill!, {
    projectRoot, targetAgent: "codex", scope: "repo", dryRun: false, mode: "copy",
  });
};

test("starts a strict run from the installed checksum-bound performance contract", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-start-"));
  await cp("fixtures/vite-react-ts", root, { recursive: true });
  await install(root, "frontend.performance-review");

  const run = await startPreparedStrictSkillRun({
    projectRoot: root,
    registryRoot: path.resolve("registry"),
    targetAgent: "codex",
    domain: "frontend",
    intent: "Review frontend performance risks",
    skillInputs: {
      "frontend.performance-review": { mode: "risk-review", affectedFlows: ["initial load"] },
    },
    hostCapabilities: [],
    now: "2026-07-15T10:00:00.000Z",
  });

  assert.equal(run.schemaVersion, "2.0");
  assert.equal(run.certification, "strict");
  assert.equal(run.state, "reading");
  assert.deepEqual(run.skillLedgers.map(({ skillId }) => skillId), ["frontend.performance-review"]);
  assert.ok(run.skillLedgers[0].contentChunks.length > 0);
  assert.equal(run.skillLedgers[0].contractChecksum.startsWith("sha256:"), true);
});

test("fails closed when the recommended strict skill is not installed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-start-missing-"));
  await cp("fixtures/vite-react-ts", root, { recursive: true });
  await assert.rejects(startPreparedStrictSkillRun({
    projectRoot: root, registryRoot: path.resolve("registry"), targetAgent: "codex", domain: "frontend",
    intent: "Review frontend performance risks",
    skillInputs: { "frontend.performance-review": { mode: "risk-review", affectedFlows: ["initial load"] } },
  }), (error: unknown) => error instanceof StrictSkillRunError && error.code === "strict-skill-not-installed");
});

test("rejects strict inputs that do not satisfy the immutable contract input schema", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-start-input-"));
  await cp("fixtures/vite-react-ts", root, { recursive: true });
  await install(root, "frontend.performance-review");
  await assert.rejects(startPreparedStrictSkillRun({
    projectRoot: root, registryRoot: path.resolve("registry"), targetAgent: "codex", domain: "frontend",
    intent: "Review frontend performance risks",
    skillInputs: { "frontend.performance-review": { mode: "risk-review", affectedFlows: ["initial load"], callerOutcome: "verified" } },
  }), (error: unknown) => error instanceof StrictSkillRunError && error.code === "run-integrity" && /input schema/i.test(error.message));
});

test("marks a missing contract prerequisite as blocked rather than no-op", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-start-prerequisite-"));
  await cp("fixtures/vite-react-ts", root, { recursive: true });
  await install(root, "frontend.performance-review");
  const run = await startPreparedStrictSkillRun({
    projectRoot: root, registryRoot: path.resolve("registry"), targetAgent: "codex", domain: "frontend",
    intent: "Review frontend performance risks", skillInputs: { "frontend.performance-review": { mode: "risk-review" } },
  });
  assert.equal(run.skillLedgers[0].outcome, "blocked");
  assert.deepEqual(run.skillLedgers[0].applicability.unmetPrerequisites, ["affected-flows"]);
});

test("rejects an installed package changed after lockfile creation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-start-tamper-"));
  await cp("fixtures/vite-react-ts", root, { recursive: true });
  await install(root, "frontend.performance-review");
  await writeFile(path.join(root, ".agents", "skills", "performance-review", "SKILL.md"), "tampered\n");
  await assert.rejects(startPreparedStrictSkillRun({
    projectRoot: root, registryRoot: path.resolve("registry"), targetAgent: "codex", domain: "frontend",
    intent: "Review frontend performance risks",
    skillInputs: { "frontend.performance-review": { mode: "risk-review", affectedFlows: ["initial load"] } },
  }), (error: unknown) => error instanceof StrictSkillRunError && error.code === "strict-skill-not-installed");
});

test("records legacy companions as excluded in a strict Tailwind preview", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-start-tailwind-"));
  await cp("fixtures/next-react-ts", root, { recursive: true });
  await install(root, "frontend.tailwind-ui-polish");
  const run = await startPreparedStrictSkillRun({
    projectRoot: root, registryRoot: path.resolve("registry"), targetAgent: "codex", domain: "frontend",
    intent: "Polish the existing Tailwind UI without changing its direction",
    skillInputs: { "frontend.tailwind-ui-polish": { brief: {}, existingDirection: { source: "existing" }, capabilityProfile: "standard" } },
    hostCapabilities: ["browser", "screenshots"],
  });
  assert.deepEqual(run.skillLedgers.map(({ skillId }) => skillId), ["frontend.tailwind-ui-polish"]);
  assert.ok(run.excludedRecommendations.some(({ skillId, reason }) => skillId === "frontend.accessibility-review" && reason === "strict-contract-missing"));
});

test("blocks an applicable Tailwind ledger when browser evidence capability is unavailable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "strict-start-tailwind-blocked-"));
  await cp("fixtures/next-react-ts", root, { recursive: true });
  await install(root, "frontend.tailwind-ui-polish");
  const run = await startPreparedStrictSkillRun({
    projectRoot: root, registryRoot: path.resolve("registry"), targetAgent: "codex", domain: "frontend",
    intent: "Polish the existing Tailwind UI without changing its direction",
    skillInputs: { "frontend.tailwind-ui-polish": { brief: {}, existingDirection: { source: "existing" }, capabilityProfile: "standard" } },
    hostCapabilities: [],
  });
  assert.equal(run.skillLedgers[0].outcome, "blocked");
  assert.ok(run.skillLedgers[0].applicability.unmetPrerequisites.length > 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultRegistryRoot } from "../src/paths.ts";
import { startPreparedSkillRun } from "../src/runs/start.ts";
import { SkillRunStore } from "../src/runtime/skill-run/index.ts";

test("shared run start prepares and persists the canonical lifecycle snapshot", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-run-start-"));
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });
  const intent = "Сделай редизайн landing page и используй скиллы";
  const designBrief = {
    schemaVersion: "1.0",
    product: {
      domain: "developer tooling",
      primaryUserOrActor: "Skill author",
      primaryTask: "Review lifecycle state",
      contentTypes: [],
      usageFrequency: "frequent",
      stakes: [],
    },
    surface: {
      type: "landing page",
      primaryAction: "Start a verified run",
      supportedViewports: [390, 1440],
      requiredStates: ["loading", "empty", "error", "success"],
    },
    direction: { requestedTone: [], antiGoals: [], existingDirection: "existing" },
    evidence: { observed: [], inferred: [], assumed: [], unknown: [] },
  };

  const run = await startPreparedSkillRun({
    projectRoot,
    registryRoot: defaultRegistryRoot,
    targetAgent: "opencode",
    domain: "frontend",
    intent,
    artifacts: { designBrief },
    storeRawIntent: true,
  });

  assert.equal(run.targetAgent, "opencode");
  assert.equal(run.locale, "mixed");
  assert.equal(run.intent.raw, intent);
  assert.doesNotMatch(run.intent.normalizedGoal, /редизайн|landing page/u);
  assert.equal(run.clarification.status, "not-required");
  assert.ok(run.selectedSkills.length > 0);
  assert.ok(run.selectedSkills.every((skill) => skill.version && skill.checksum.startsWith("sha256:")));
  assert.deepEqual(await new SkillRunStore(projectRoot).read(run.runId), run);
});

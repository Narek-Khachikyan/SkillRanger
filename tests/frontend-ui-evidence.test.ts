import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  createUiEvidenceCapturePlan,
  resolveDesignExecutionPolicy,
} from "../src/domains/frontend/design/index.ts";
import { makeBrief } from "./helpers/frontend-visual-fixtures.ts";

const brief = makeBrief({ requiredStates: ["success", "offline"], supportedViewports: [390, 1440] });
const policy = resolveDesignExecutionPolicy({
  mode: "refine", profile: "standard", rankedRecipeIds: ["mobile-consumer-app"], requiredStates: brief.surface.requiredStates,
});

test("expands the fixed viewport and baseline-state matrix", () => {
  const plan = createUiEvidenceCapturePlan({
    evidenceId: "evidence-1", brief, policy, variantId: "v1",
    sourceIdentity: "git:abc", baseUrl: "http://127.0.0.1:3000", route: "/app", outputDir: ".design/evidence/evidence-1",
  });
  assert.deepEqual([...new Set(plan.entries.map(({ viewport }) => viewport.width))], [390, 768, 1440]);
  assert.deepEqual([...new Set(plan.entries.map(({ state }) => state))], ["loading", "empty", "error", "success", "offline"]);
  assert.equal(plan.entries.length, 15);
  assert.ok(plan.entries.every(({ screenshotPath }) => path.resolve(screenshotPath).startsWith(path.resolve(plan.outputDir) + path.sep)));
});

test("rejects unsafe evidence and variant ids", () => {
  assert.throws(() => createUiEvidenceCapturePlan({
    evidenceId: "../escape", brief, policy, variantId: "v1", sourceIdentity: "git:abc",
    baseUrl: "http://127.0.0.1:3000", route: "/", outputDir: ".design/evidence",
  }), /safe path segment/);
  assert.throws(() => createUiEvidenceCapturePlan({
    evidenceId: "e1", brief, policy, variantId: "../escape", sourceIdentity: "git:abc",
    baseUrl: "http://127.0.0.1:3000", route: "/", outputDir: ".design/evidence",
  }), /safe path segment/);
});

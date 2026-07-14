import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createUiEvidenceCapturePlan,
  executeUiEvidenceCapture,
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


test("captures observations and extended mechanical evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-evidence-"));
  const adapter = path.join(root, "adapter.mjs");
  const adapterFixtureSource = `
    import { mkdir, writeFile } from "node:fs/promises";
    import path from "node:path";
    const [width, state, screenshotPath] = process.argv.slice(2);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    process.stdout.write(JSON.stringify({
      horizontalOverflow: false,
      clippedControls: [], unreachableActions: [], stickyOverlaps: [], consoleErrors: [],
      keyboardTraps: [], invisibleFocus: [], criticalAxeViolations: [], reducedMotionVerified: true,
      stateRendered: true, overlaps: [], focusOrderViolations: [], contrastViolations: [],
      mechanicalSnapshot: {
        spacingContexts: [], colors: [], radii: [], shadows: [], cards: [], typography: [], textBlocks: [],
        touchTargets: [{ locator: "button.icon", widthPx: 28, heightPx: 28, interactive: true }],
      },
      width: Number(width), state,
    }));
  `;
  await writeFile(adapter, adapterFixtureSource);
  const captureBrief = makeBrief({ requiredStates: ["success"] });
  const capturePolicy = resolveDesignExecutionPolicy({
    mode: "refine", profile: "standard", rankedRecipeIds: ["developer-tool"], requiredStates: captureBrief.surface.requiredStates,
  });
  const plan = createUiEvidenceCapturePlan({
    evidenceId: "e1", brief: captureBrief, policy: capturePolicy,
    variantId: "v1", sourceIdentity: "git:abc", baseUrl: "http://127.0.0.1:3000",
    route: "/", outputDir: path.join(root, "e1"),
  });
  const bundle = await executeUiEvidenceCapture({
    plan,
    commandTemplate: `node ${adapter} "{{width}}" "{{state}}" "{{screenshotPath}}"`,
    projectRoot: root,
  });
  assert.equal(bundle.captures.length, 12);
  assert.ok(bundle.captures.every(({ screenshotPath }) => existsSync(screenshotPath)));
  assert.ok(bundle.captures.some(({ checks }) => checks.some(({ code }) => code === "touch-target")));
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "e1", "bundle.json"), "utf8")), bundle);
  await assert.rejects(() => executeUiEvidenceCapture({ plan, commandTemplate: `node ${adapter}`, projectRoot: root }), /already exists/);
});

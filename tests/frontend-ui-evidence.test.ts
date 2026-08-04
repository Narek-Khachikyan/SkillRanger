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

test("expands the fixed viewport and explicitly required state matrix", () => {
  const plan = createUiEvidenceCapturePlan({
    evidenceId: "evidence-1", brief, policy, variantId: "v1",
    sourceIdentity: "git:abc", baseUrl: "http://127.0.0.1:3000", route: "/app", outputDir: ".design/evidence/evidence-1",
  });
  assert.deepEqual([...new Set(plan.entries.map(({ viewport }) => viewport.width))], [390, 768, 1440]);
  assert.deepEqual([...new Set(plan.entries.map(({ state }) => state))], ["success", "offline"]);
  assert.equal(plan.entries.length, 6);
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
      stateSynchronization: state === "success"
        ? {
            status: "verified",
            path: "run[failed] -> log -> recovery",
            observations: ["log=failed", "recovery=retry"],
            action: "Select the failed run",
            changes: [{ locator: "#run-status", before: "pending", after: "failed" }],
            adapterInternalId: "leak",
          }
        : {
            status: "not-applicable",
            path: state + " capture",
            observations: ["No state-changing primary action is available in this requested state."],
            reason: "The requested state exposes no state-changing primary action.",
            adapterInternalId: "leak",
          },
      mechanicalSnapshot: {
        spacingContexts: [], colors: [], radii: [], shadows: [], cards: [], typography: [], textBlocks: [],
        touchTargets: [{ locator: "button.icon", widthPx: 28, heightPx: 28, interactive: true }],
      },
      width: Number(width), state,
    }));
  `;
  await writeFile(adapter, adapterFixtureSource);
  const captureBrief = makeBrief({ requiredStates: ["success", "offline"] });
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
  assert.equal(bundle.captures.length, 6);
  assert.ok(bundle.captures.every(({ screenshotPath }) => existsSync(screenshotPath)));
  assert.ok(bundle.captures.some(({ checks }) => checks.some(({ code }) => code === "touch-target")));
  assert.ok(bundle.captures.some(({ stateSynchronization }) =>
    stateSynchronization.status === "verified"
    && stateSynchronization.action === "Select the failed run"
    && stateSynchronization.changes?.some(({ before, after }) => before !== after)));
  assert.ok(bundle.captures.some(({ stateSynchronization, checks }) =>
    stateSynchronization.status === "not-applicable"
    && stateSynchronization.reason?.includes("no state-changing")
    && checks.some(({ code }) => code === "ui-state-action-missing")
    && !checks.some(({ code }) => code === "ui-state-desynchronized")));
  assert.ok(bundle.captures.every(({ mechanicalSnapshot, overlaps, focusOrderViolations, contrastViolations }) =>
    mechanicalSnapshot !== undefined
    && Array.isArray(overlaps)
    && Array.isArray(focusOrderViolations)
    && Array.isArray(contrastViolations)));
  // The adapter leaks an extra key; the published bundle schema forbids additional properties here,
  // so it must survive neither into the returned bundle nor into the persisted one.
  assert.ok(bundle.captures.every(({ stateSynchronization }) =>
    Object.keys(stateSynchronization).every((key) =>
      ["action", "changes", "observations", "path", "reason", "status"].includes(key))));
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "e1", "bundle.json"), "utf8")), bundle);
  await assert.rejects(() => executeUiEvidenceCapture({ plan, commandTemplate: `node ${adapter}`, projectRoot: root }), /already exists/);
});

test("rejects missing or empty state synchronization evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-evidence-invalid-"));
  const adapter = path.join(root, "adapter.mjs");
  await writeFile(adapter, `
    import { mkdir, writeFile } from "node:fs/promises";
    import path from "node:path";
    const [screenshotPath, mode] = process.argv.slice(2);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await writeFile(screenshotPath, "png");
    const payload = {
      horizontalOverflow: false, clippedControls: [], unreachableActions: [], stickyOverlaps: [],
      consoleErrors: [], keyboardTraps: [], invisibleFocus: [], criticalAxeViolations: [],
      reducedMotionVerified: true, stateRendered: true, overlaps: [], focusOrderViolations: [],
      contrastViolations: [],
      mechanicalSnapshot: {
        spacingContexts: [], colors: [], radii: [], shadows: [], cards: [], typography: [],
        textBlocks: [], touchTargets: []
      }
    };
    if (mode === "empty") {
      payload.stateSynchronization = { status: "not-applicable", path: "", observations: [] };
    }
    process.stdout.write(JSON.stringify(payload));
  `);
  for (const mode of ["missing", "empty"]) {
    const plan = createUiEvidenceCapturePlan({
      evidenceId: `invalid-${mode}`, brief: makeBrief({ requiredStates: ["success"] }), policy,
      variantId: "v1", sourceIdentity: `git:${mode}`, baseUrl: "http://127.0.0.1:3000",
      route: "/", outputDir: path.join(root, `invalid-${mode}`),
    });
    await assert.rejects(
      () => executeUiEvidenceCapture({
        plan,
        commandTemplate: `node ${adapter} "{{screenshotPath}}" ${mode}`,
        projectRoot: root,
      }),
      /stateSynchronization/,
    );
  }
});


test("publishes the UI evidence bundle schema", async () => {
  const manifest = JSON.parse(await readFile("domains/frontend/domain.manifest.json", "utf8"));
  assert.ok(manifest.artifacts.schemas.includes("schemas/ui-evidence-bundle.schema.json"));
  const schema = JSON.parse(await readFile("domains/frontend/schemas/ui-evidence-bundle.schema.json", "utf8"));
  assert.equal(schema.$defs.capture.required.includes("stateRendered"), false);
  assert.ok(schema.$defs.check.properties.code.enum.includes("state-not-rendered"));
  assert.ok(schema.$defs.check.properties.code.enum.includes("state-mismatch"));
  assert.equal(schema.$defs.stateSynchronization.allOf.length, 1);
  assert.equal(schema.$defs.mechanicalSnapshot.properties.touchTargets.items.$ref, "#/$defs/touchTargetSample");
  assert.equal(schema.$defs.mechanicalSnapshot.properties.typography.items.$ref, "#/$defs/typographySample");
});

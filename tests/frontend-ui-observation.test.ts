import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createBrowserObservationPlan,
  executeBrowserObservationPlan,
} from "../src/domains/frontend/design/index.ts";
import { makeBrief } from "./helpers/frontend-visual-fixtures.ts";

test("browser observation capture rejects duplicate screenshot outputs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-browser-observation-duplicate-"));
  const adapter = path.join(root, "adapter.mjs");
  try {
    await writeFile(adapter, "process.stdout.write(JSON.stringify({}));\n", "utf8");
    const plan = createBrowserObservationPlan({
      brief: makeBrief({ requiredStates: ["success", "error"], supportedViewports: [390] }),
      baseUrl: "http://127.0.0.1:3000",
      outputDir: root,
    });
    plan.entries[1]!.screenshotPath = plan.entries[0]!.screenshotPath;

    await assert.rejects(
      executeBrowserObservationPlan({ plan, commandTemplate: `node "${adapter}"` }),
      /duplicate capture output path/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser observation capture rejects empty screenshots", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-browser-observation-empty-"));
  const adapter = path.join(root, "adapter.mjs");
  try {
    await writeFile(adapter, `
      import { writeFile } from "node:fs/promises";
      const screenshotPath = process.argv[2];
      await writeFile(screenshotPath, "");
      process.stdout.write(JSON.stringify({
        horizontalOverflow: false,
        clippedControls: [],
        unreachableActions: [],
        stickyOverlaps: [],
        consoleErrors: [],
        keyboardTraps: [],
        invisibleFocus: [],
        criticalAxeViolations: [],
        reducedMotionVerified: true
      }));
    `, "utf8");
    const plan = createBrowserObservationPlan({
      brief: makeBrief({ requiredStates: ["success"], supportedViewports: [390] }),
      baseUrl: "http://127.0.0.1:3000",
      outputDir: root,
    });

    await assert.rejects(
      executeBrowserObservationPlan({
        plan,
        commandTemplate: `node "${adapter}" "{{screenshotPath}}"`,
      }),
      /non-empty screenshot/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser observation capture preserves the adapter replacement contract", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-browser-observation-success-"));
  const adapter = path.join(root, "adapter.mjs");
  const records = path.join(root, "records");
  try {
    await writeFile(adapter, `
      import { mkdir, writeFile } from "node:fs/promises";
      import path from "node:path";
      const [url, route, width, height, state, screenshotPath, recordsDir] = process.argv.slice(2);
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await mkdir(recordsDir, { recursive: true });
      await writeFile(screenshotPath, "png");
      await writeFile(path.join(recordsDir, width + "-" + state + ".json"), JSON.stringify({ url, route, width, height, state, screenshotPath }));
      process.stdout.write(JSON.stringify({
        horizontalOverflow: false,
        clippedControls: [],
        unreachableActions: [],
        stickyOverlaps: [],
        consoleErrors: [],
        keyboardTraps: [],
        invisibleFocus: [],
        criticalAxeViolations: [],
        reducedMotionVerified: true
      }));
    `, "utf8");
    const plan = createBrowserObservationPlan({
      brief: makeBrief({ requiredStates: ["success", "empty"], supportedViewports: [390, 768] }),
      baseUrl: "http://127.0.0.1:3000/",
      route: "/skills",
      outputDir: root,
    });
    const outputPath = path.join(root, "observations.json");
    const observations = await executeBrowserObservationPlan({
      plan,
      outputPath,
      commandTemplate: `node "${adapter}" "{{url}}" "{{route}}" "{{width}}" "{{height}}" "{{state}}" "{{screenshotPath}}" "${records}"`,
    });

    assert.equal(observations.length, 4);
    assert.deepEqual(JSON.parse(await readFile(path.join(records, "390-success.json"), "utf8")), {
      url: "http://127.0.0.1:3000/skills",
      route: "/skills",
      width: "390",
      height: "844",
      state: "success",
      screenshotPath: plan.entries[0]!.screenshotPath,
    });
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), observations);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser observation capture rejects unsafe screenshot outputs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-browser-observation-unsafe-"));
  const adapter = path.join(root, "adapter.mjs");
  try {
    await writeFile(adapter, "process.stdout.write(JSON.stringify({}));\n", "utf8");
    const plan = createBrowserObservationPlan({
      brief: makeBrief({ requiredStates: ["success"], supportedViewports: [390] }),
      baseUrl: "http://127.0.0.1:3000",
      outputDir: root,
    });
    plan.entries[0]!.screenshotPath = path.resolve(root, "..", "escaped.png");

    await assert.rejects(
      executeBrowserObservationPlan({ plan, commandTemplate: `node "${adapter}"` }),
      /escapes output directory/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser observation capture rejects screenshot ancestor symlinks outside its output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-browser-observation-symlink-"));
  const outside = await mkdtemp(path.join(tmpdir(), "skillranger-browser-observation-symlink-outside-"));
  const adapter = path.join(root, "adapter.mjs");
  try {
    await writeFile(adapter, "process.stdout.write(JSON.stringify({}));\n", "utf8");
    await symlink(outside, path.join(root, "screenshots"), "dir");
    const plan = createBrowserObservationPlan({
      brief: makeBrief({ requiredStates: ["success"], supportedViewports: [390] }),
      baseUrl: "http://127.0.0.1:3000",
      outputDir: root,
    });

    await assert.rejects(
      executeBrowserObservationPlan({ plan, commandTemplate: `node "${adapter}"` }),
      /escapes output directory/i,
    );
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("browser observation capture rejects a screenshot replaced by an escaping symlink", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-browser-observation-post-capture-"));
  const outside = await mkdtemp(path.join(tmpdir(), "skillranger-browser-observation-post-capture-outside-"));
  const adapter = path.join(root, "adapter.mjs");
  const outsideScreenshot = path.join(outside, "external.png");
  try {
    await writeFile(outsideScreenshot, "external");
    await writeFile(adapter, `
      import { symlink } from "node:fs/promises";
      const [screenshotPath, target] = process.argv.slice(2);
      await symlink(target, screenshotPath);
      process.stdout.write(JSON.stringify({
        horizontalOverflow: false,
        clippedControls: [],
        unreachableActions: [],
        stickyOverlaps: [],
        consoleErrors: [],
        keyboardTraps: [],
        invisibleFocus: [],
        criticalAxeViolations: [],
        reducedMotionVerified: true
      }));
    `, "utf8");
    const plan = createBrowserObservationPlan({
      brief: makeBrief({ requiredStates: ["success"], supportedViewports: [390] }),
      baseUrl: "http://127.0.0.1:3000",
      outputDir: root,
    });

    await assert.rejects(
      executeBrowserObservationPlan({
        plan,
        commandTemplate: `node "${adapter}" "{{screenshotPath}}" "${outsideScreenshot}"`,
      }),
      /escapes output directory/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("browser observation capture rejects an output artifact replaced by an escaping symlink", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-browser-observation-output-symlink-"));
  const outside = await mkdtemp(path.join(tmpdir(), "skillranger-browser-observation-output-symlink-outside-"));
  const adapter = path.join(root, "adapter.mjs");
  const outputPath = path.join(root, "observations.json");
  const outsideOutput = path.join(outside, "observations.json");
  try {
    await writeFile(adapter, `
      import { symlink, writeFile } from "node:fs/promises";
      const [screenshotPath, outputPath, outsideOutput] = process.argv.slice(2);
      await writeFile(screenshotPath, "png");
      await symlink(outsideOutput, outputPath);
      process.stdout.write(JSON.stringify({
        horizontalOverflow: false,
        clippedControls: [],
        unreachableActions: [],
        stickyOverlaps: [],
        consoleErrors: [],
        keyboardTraps: [],
        invisibleFocus: [],
        criticalAxeViolations: [],
        reducedMotionVerified: true
      }));
    `, "utf8");
    const plan = createBrowserObservationPlan({
      brief: makeBrief({ requiredStates: ["success"], supportedViewports: [390] }),
      baseUrl: "http://127.0.0.1:3000",
      outputDir: root,
    });

    await assert.rejects(
      executeBrowserObservationPlan({
        plan,
        outputPath,
        commandTemplate: `node "${adapter}" "{{screenshotPath}}" "${outputPath}" "${outsideOutput}"`,
      }),
      /escapes output directory/i,
    );
    await assert.rejects(readFile(outsideOutput));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("browser observation capture rejects missing screenshots", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-browser-observation-missing-"));
  const adapter = path.join(root, "adapter.mjs");
  try {
    await writeFile(adapter, `
      process.stdout.write(JSON.stringify({
        horizontalOverflow: false,
        clippedControls: [],
        unreachableActions: [],
        stickyOverlaps: [],
        consoleErrors: [],
        keyboardTraps: [],
        invisibleFocus: [],
        criticalAxeViolations: [],
        reducedMotionVerified: true
      }));
    `, "utf8");
    const plan = createBrowserObservationPlan({
      brief: makeBrief({ requiredStates: ["success"], supportedViewports: [390] }),
      baseUrl: "http://127.0.0.1:3000",
      outputDir: root,
    });

    await assert.rejects(
      executeBrowserObservationPlan({ plan, commandTemplate: `node "${adapter}"` }),
      /did not create screenshot/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

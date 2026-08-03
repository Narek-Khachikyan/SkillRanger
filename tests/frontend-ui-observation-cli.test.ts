import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { makeBrief } from "./helpers/frontend-visual-fixtures.ts";

const execFileAsync = promisify(execFile);

test("design:observe preserves the legacy observation output through canonical capture", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-cli-observe-"));
  const briefPath = path.join(root, "brief.json");
  const adapterPath = path.join(root, "adapter.mjs");
  const outputPath = path.join(root, "observations.json");
  try {
    await writeFile(briefPath, JSON.stringify(makeBrief({ requiredStates: ["success"], supportedViewports: [390] })));
    await writeFile(adapterPath, `
      import { writeFile } from "node:fs/promises";
      const screenshotPath = process.argv[2];
      await writeFile(screenshotPath, "png");
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

    const { stdout } = await execFileAsync(process.execPath, [
      "src/cli/index.ts",
      "design:observe",
      "--brief", briefPath,
      "--base-url", "http://127.0.0.1:3000/",
      "--route", "/skills",
      "--command", `node "${adapterPath}" "{{screenshotPath}}"`,
      "--output", outputPath,
      "--project", root,
      "--json",
    ]);
    const result = JSON.parse(stdout) as {
      observations: Array<Record<string, unknown>>;
    };
    assert.deepEqual(result.observations, [{
      schemaVersion: "1.0",
      viewport: { width: 390, height: 844 },
      route: "/skills",
      state: "success",
      horizontalOverflow: false,
      clippedControls: [],
      unreachableActions: [],
      stickyOverlaps: [],
      consoleErrors: [],
      keyboardTraps: [],
      invisibleFocus: [],
      criticalAxeViolations: [],
      reducedMotionVerified: true,
      screenshotPath: path.join(root, "screenshots", "390-success.png"),
    }]);
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), result.observations);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

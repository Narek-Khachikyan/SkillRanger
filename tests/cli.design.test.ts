import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { makeBrief } from "./helpers/frontend-visual-fixtures.ts";

const execFileAsync = promisify(execFile);

test("design:verify rejects a UI evidence bundle passed as observations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-cli-design-"));
  const briefPath = path.join(root, "brief.json");
  const directionPath = path.join(root, "direction.json");
  const observationsPath = path.join(root, "observations.json");
  try {
    await Promise.all([
      writeFile(briefPath, JSON.stringify(makeBrief())),
      writeFile(directionPath, JSON.stringify({})),
      writeFile(observationsPath, JSON.stringify({ schemaVersion: "1.0", captures: [] })),
    ]);

    await assert.rejects(
      execFileAsync(process.execPath, [
        "src/cli/index.ts",
        "design:verify",
        "--brief", briefPath,
        "--direction", directionPath,
        "--observations", observationsPath,
      ]),
      (error: Error & { stderr?: string; code?: number }) => {
        assert.notEqual(error.code, 0);
        assert.match(error.stderr ?? "", /--observations must contain a JSON array of BrowserObservation objects/);
        assert.match(error.stderr ?? "", /UiEvidenceBundle is consumed by verify_visual_result/);
        assert.doesNotMatch(error.stderr ?? "", /observations is not iterable/);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

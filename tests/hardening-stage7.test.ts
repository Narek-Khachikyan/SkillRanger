import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanProject } from "../src/scanner/index.ts";

test("Stage 7 - Python language detection", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage7-"));
  const projectRoot = path.join(tmpRoot, "py-project");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "pyproject.toml"), "[tool.poetry]\nname = 'py-app'\n");
  await writeFile(path.join(projectRoot, "main.py"), "print('hello')\n");

  const fingerprint = await scanProject(projectRoot);
  assert.equal(fingerprint.languages.some((l) => l.name === "python"), true);
});

test("Stage 7 - Scanner truncation warning", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-stage7-"));
  const projectRoot = path.join(tmpRoot, "large-project");
  await mkdir(projectRoot, { recursive: true });

  // Create 505 dummy files
  for (let i = 0; i < 505; i++) {
    await writeFile(path.join(projectRoot, `file_${i}.txt`), "data\n");
  }

  const fingerprint = await scanProject(projectRoot);
  assert.equal(
    fingerprint.warnings.some((w) => w.includes("File scan stopped after 500 entries")),
    true
  );
});

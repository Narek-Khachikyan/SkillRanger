import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanProject } from "../src/scanner/index.ts";

test("scanner detects Next.js React TypeScript fixture", async () => {
  const fingerprint = await scanProject("fixtures/next-react-ts");
  assert.equal(fingerprint.packageManager?.name, "pnpm");
  assert.ok(fingerprint.tags.includes("nextjs"));
  assert.ok(fingerprint.tags.includes("react"));
  assert.ok(fingerprint.tags.includes("typescript"));
  assert.ok(fingerprint.tags.includes("tailwind"));
  assert.ok(fingerprint.testing.some((item) => item.name === "playwright"));
});

test("scanner detects Vite React TypeScript fixture", async () => {
  const fingerprint = await scanProject("fixtures/vite-react-ts");
  assert.equal(fingerprint.packageManager?.name, "npm");
  assert.ok(fingerprint.tags.includes("vite"));
  assert.ok(fingerprint.tags.includes("react"));
  assert.ok(fingerprint.tags.includes("typescript"));
  assert.ok(fingerprint.tags.includes("frontend"));
  assert.ok(!fingerprint.tags.includes("nextjs"));
  assert.equal(fingerprint.agentContext.agentsMd.present, true);
  assert.ok(fingerprint.testing.some((item) => item.name === "vitest"));
});

test("scanner keeps backend Node fixture out of frontend project types", async () => {
  const fingerprint = await scanProject("fixtures/backend-node");
  assert.equal(fingerprint.packageManager?.name, "npm");
  assert.ok(fingerprint.tags.includes("javascript"));
  assert.ok(fingerprint.tags.includes("typescript"));
  assert.ok(fingerprint.tags.includes("testing"));
  assert.ok(fingerprint.tags.includes("devops-platform"));
  assert.ok(!fingerprint.tags.includes("frontend"));
  assert.ok(!fingerprint.projectTypes.some((item) => item.type === "frontend"));
});

test("scanner tags Playwright projects as both Playwright and testing", async () => {
  const fingerprint = await scanProject("fixtures/next-react-ts");
  assert.ok(fingerprint.tags.includes("playwright"));
  assert.ok(fingerprint.tags.includes("testing"));
});

test("scanner warns when React or Tailwind exceeds maintained frontend skill ranges", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-version-drift-"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      dependencies: { react: "20.0.0" },
      devDependencies: { tailwindcss: "5.0.0" },
    }),
    "utf8",
  );

  const fingerprint = await scanProject(root);

  assert.ok(fingerprint.warnings.includes("React 20 is outside the maintained frontend-skill range (18-19); use conservative fallbacks and do not promote without verification."));
  assert.ok(fingerprint.warnings.includes("Tailwind CSS 5 is outside the maintained frontend-skill range (3-4); use conservative fallbacks and do not promote without verification."));
});

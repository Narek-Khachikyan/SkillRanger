import test from "node:test";
import assert from "node:assert/strict";
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

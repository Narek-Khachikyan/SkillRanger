import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

test("scanner sorts bounded traversal and excludes router-generated state", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillranger-scan-order-"));
  await mkdir(path.join(root, "zeta"));
  await mkdir(path.join(root, "alpha"));
  await mkdir(path.join(root, ".skillranger", "runs", "router"), { recursive: true });
  await writeFile(path.join(root, "zeta", "z.ts"), "export {};\n");
  await writeFile(path.join(root, "alpha", "a.ts"), "export {};\n");
  await writeFile(path.join(root, ".skillranger", "runs", "router", "route_secret.json"), "secret");
  const first = await scanProject(root);
  const second = await scanProject(root);
  assert.deepEqual(first.signals, second.signals);
  assert.deepEqual(first.signals.filter((value) => value.endsWith(".ts")), ["alpha/a.ts", "zeta/z.ts"]);
  assert.equal(first.signals.some((value) => value.includes(".skillranger")), false);
});

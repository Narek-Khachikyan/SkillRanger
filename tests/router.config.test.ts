import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  defaultRouterConfig,
  loadRouterConfig,
  validateRouterConfig,
} from "../src/config/index.ts";

const temporaryProject = () => mkdtemp(path.join(os.tmpdir(), "skillranger-router-config-"));

test("router config uses deterministic defaults when the project file is absent", async () => {
  const first = await loadRouterConfig(await temporaryProject());
  const second = await loadRouterConfig(await temporaryProject());

  assert.deepEqual(first.config, defaultRouterConfig);
  assert.deepEqual(second.config, defaultRouterConfig);
  assert.equal(first.source, "defaults");
  assert.equal(first.digest, second.digest);
  assert.match(first.digest, /^sha256:[a-f0-9]{64}$/);
});

test("router config digest is independent of JSON formatting and property order", async () => {
  const firstRoot = await temporaryProject();
  const secondRoot = await temporaryProject();
  const config = structuredClone(defaultRouterConfig);
  config.defaultTargetAgent = "opencode";

  await writeFile(path.join(firstRoot, "skillranger.config.json"), `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(path.join(secondRoot, "skillranger.config.json"), JSON.stringify({
    privacy: config.privacy,
    router: config.router,
    defaultTargetAgent: config.defaultTargetAgent,
    schemaVersion: config.schemaVersion,
  }));

  const first = await loadRouterConfig(firstRoot);
  const second = await loadRouterConfig(secondRoot);
  assert.equal(first.source, "project");
  assert.deepEqual(first.config, config);
  assert.equal(first.digest, second.digest);
});

test("router config rejects unknown properties and unsafe values", () => {
  assert.throws(
    () => validateRouterConfig({ ...defaultRouterConfig, installAutomatically: true }),
    /unknown property installAutomatically/,
  );
  assert.throws(
    () => validateRouterConfig({
      ...defaultRouterConfig,
      router: { ...defaultRouterConfig.router, disableAudit: true },
    }),
    /unknown property disableAudit/,
  );
  assert.throws(
    () => validateRouterConfig({
      ...defaultRouterConfig,
      router: { ...defaultRouterConfig.router, maxSelectedRisk: "high" },
    }),
    /maxSelectedRisk/,
  );
  assert.throws(
    () => validateRouterConfig({
      ...defaultRouterConfig,
      router: { ...defaultRouterConfig.router, maxTotalSelectedSkills: 0 },
    }),
    /maxTotalSelectedSkills/,
  );
});

test("router config loader rejects a symlinked project config", async (context) => {
  if (process.platform === "win32") {
    context.skip("symlink creation requires platform-specific privileges on Windows");
    return;
  }
  const root = await temporaryProject();
  const external = path.join(await temporaryProject(), "external.json");
  await writeFile(external, JSON.stringify(defaultRouterConfig));
  await symlink(external, path.join(root, "skillranger.config.json"));

  await assert.rejects(() => loadRouterConfig(root), /symbolic link/);
});

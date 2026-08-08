import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

test("strict Core does not import the domain registry or domain packs; only the service composition root wires them", async () => {
  const files = (await readdir("src/runtime/strict")).filter((file) => file.endsWith(".ts"));
  assert.ok(files.length > 0);
  for (const file of files) {
    if (file === "service.ts") continue;
    const source = await readFile(`src/runtime/strict/${file}`, "utf8");
    assert.doesNotMatch(
      source,
      /import[^;]*domains\//,
      `${file} must receive the trusted validator registry through the store construction seam, not the domain registry`,
    );
    for (const validatorId of ["frontend/browser-hard-gates", "frontend/tailwind-source", "frontend/performance-claims"]) {
      assert.doesNotMatch(source, new RegExp(validatorId), `${file} must not contain a frontend validator allowlist or dispatch`);
    }
  }
});

test("strict Core constructs no validator registry from domain data outside the store seam", async () => {
  for (const file of ["src/runtime/strict/verification.ts", "src/runtime/strict/validator-registry.ts"]) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /domains\//, `${file} must not reference the domain layer at all`);
  }
});

test("frontend validator evaluators are registered by the frontend domain pack, not by strict Core", async () => {
  const routingSource = await readFile("src/domains/frontend/routing.ts", "utf8");
  const validatorsSource = await readFile("src/domains/frontend/validators.ts", "utf8");
  assert.match(routingSource, /frontend\/browser-hard-gates/);
  assert.match(routingSource, /frontend\/tailwind-source/);
  assert.match(routingSource, /frontend\/performance-claims/);
  assert.match(validatorsSource, /frontend\/browser-hard-gates/);
  assert.match(validatorsSource, /frontend\/tailwind-source/);
  assert.match(validatorsSource, /frontend\/performance-claims/);
});

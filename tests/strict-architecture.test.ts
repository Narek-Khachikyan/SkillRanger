import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

test("strict Core does not import frontend-specific validator implementations", async () => {
  const files = (await readdir("src/runtime/strict")).filter((file) => file.endsWith(".ts"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(`src/runtime/strict/${file}`, "utf8");
    assert.doesNotMatch(
      source,
      /import[^;]*domains\/frontend/,
      `${file} must resolve validators through the domain registry seam, not frontend implementation modules`,
    );
    for (const validatorId of ["frontend/browser-hard-gates", "frontend/tailwind-source", "frontend/performance-claims"]) {
      assert.doesNotMatch(source, new RegExp(validatorId), `${file} must not contain a frontend validator allowlist or dispatch`);
    }
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

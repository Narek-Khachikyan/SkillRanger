import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareTask } from "../src/router/prepare.ts";
import { defaultRegistryRoot } from "../src/paths.ts";
import { loadRouterGoldenCases, routerEvalRoutingDate } from "../src/router/fixtures.ts";

const root = process.cwd();
const cases = await loadRouterGoldenCases(path.join(root, "tests", "fixtures", "router-paraphrase-cases.json"));
const fixtureRoot = path.join(root, "tests", "fixtures", "router-packs");
const tmp = await mkdtemp(path.join(os.tmpdir(), "skillranger-parity-"));
const nextFixture = path.join(tmp, "next-react-ts");
await cp(path.join(root, "fixtures", "next-react-ts"), nextFixture, { recursive: true });
let mismatches = 0;
try {
  for (const input of cases.filter(({ expected }) => expected.primarySkillId !== undefined)) {
    const result = await prepareTask({
      projectRoot: input.fixture === "frontend" ? nextFixture : tmp,
      registry: input.registry === "test-fixture"
        ? { kind: "replace", root: fixtureRoot }
        : { kind: "bundled", root: defaultRegistryRoot },
      prompt: input.prompt,
      activation: { mode: "explicit" },
      targetAgent: "codex",
      strict: input.strict,
      capabilities: input.capabilities.map((id) => ({ id, source: "server-observed" as const })),
      // The frozen corpus routing date shared with the router evaluation report.
      routingDate: routerEvalRoutingDate,
    });
    const primary = result.status === "prepared" ? result.selections.primary.skillId : result.status;
    const evalExpected = input.expected.primarySkillId;
    const mark = primary === evalExpected ? "MATCH" : "DIFF";
    if (mark === "DIFF") mismatches += 1;
    console.log(`${mark} ${input.id}: production=${primary} expected=${evalExpected}`);
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}
if (mismatches > 0) {
  console.error(`parity-check: ${mismatches} golden primary expectations diverge from production.`);
  process.exitCode = 1;
}

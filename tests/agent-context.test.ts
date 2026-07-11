import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  planSkillRangerAgentContext,
  renderSkillRangerAgentBlock,
  upsertSkillRangerAgentContext,
} from "../src/installers/agent-context.ts";

const exists = async (filePath: string) => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

test("renders the exact SkillRanger lifecycle block", () => {
  assert.equal(
    renderSkillRangerAgentBlock(),
    "<!-- SKILLRANGER_START -->\n" +
      "## SkillRanger lifecycle\n" +
      "Before skill-driven work, run `skillranger run:start`, announce the selected primary and companion skills, and record every required SKILL.md read. Resolve required clarifications, then run `skillranger run:begin` immediately before implementation. Do not claim `verified` unless `skillranger run:verify` returns the verified outcome with recorded evidence.\n" +
      "<!-- SKILLRANGER_END -->",
  );
});

test("plans creation without writing and reports unchanged managed context", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-agent-context-"));
  const agentPath = path.join(projectRoot, "AGENTS.md");

  assert.deepEqual(await planSkillRangerAgentContext(projectRoot), { path: agentPath, changed: true });
  assert.equal(await exists(agentPath), false);

  await upsertSkillRangerAgentContext(projectRoot);
  assert.deepEqual(await planSkillRangerAgentContext(projectRoot), { path: agentPath, changed: false });
});

test("creates and idempotently updates the SkillRanger AGENTS block", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-agent-context-"));
  await upsertSkillRangerAgentContext(projectRoot);
  await upsertSkillRangerAgentContext(projectRoot);
  const text = await readFile(path.join(projectRoot, "AGENTS.md"), "utf8");
  assert.equal(text.match(/<!-- SKILLRANGER_START -->/g)?.length, 1);
  assert.equal(text.match(/<!-- SKILLRANGER_END -->/g)?.length, 1);
  assert.match(text, /run:start/);
  assert.match(text, /run:begin/);
  assert.match(text, /Do not claim `verified`/);
  assert.ok(text.endsWith("\n"));
});

test("preserves user text byte-for-byte outside the managed block", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-agent-context-"));
  const agentPath = path.join(projectRoot, "AGENTS.md");
  const prefix = "# User rules\r\n\r\nKeep this.\r\n";
  const suffix = "\r\nTrailing user rule without newline";
  await writeFile(
    agentPath,
    `${prefix}<!-- SKILLRANGER_START -->\nold managed text\n<!-- SKILLRANGER_END -->${suffix}`,
  );

  await upsertSkillRangerAgentContext(projectRoot);
  assert.equal(await readFile(agentPath, "utf8"), `${prefix}${renderSkillRangerAgentBlock()}${suffix}`);
});

test("preserves non-UTF-8 prefix and suffix bytes across repeated upserts", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-agent-context-"));
  const agentPath = path.join(projectRoot, "AGENTS.md");
  const prefix = Buffer.concat([
    Buffer.from("# User bytes\n"),
    Buffer.from([0xff, 0xfe, 0x80]),
    Buffer.from("\n"),
  ]);
  const suffix = Buffer.concat([
    Buffer.from("\nTrailing bytes: "),
    Buffer.from([0xc3, 0x28, 0xf5]),
  ]);
  await writeFile(agentPath, Buffer.concat([
    prefix,
    Buffer.from("<!-- SKILLRANGER_START -->\nold managed text\n<!-- SKILLRANGER_END -->"),
    suffix,
  ]));
  const expected = Buffer.concat([
    prefix,
    Buffer.from(renderSkillRangerAgentBlock()),
    suffix,
  ]);

  await upsertSkillRangerAgentContext(projectRoot);
  assert.deepEqual(await readFile(agentPath), expected);

  await upsertSkillRangerAgentContext(projectRoot);
  assert.deepEqual(await readFile(agentPath), expected);
});

test("rejects malformed marker pairs without changing the file", async (t) => {
  const malformed = [
    "prefix\n<!-- SKILLRANGER_START -->\nbroken\n",
    "prefix\n<!-- SKILLRANGER_END -->\n",
    "<!-- SKILLRANGER_END -->\n<!-- SKILLRANGER_START -->\n",
    "<!-- SKILLRANGER_START -->\na\n<!-- SKILLRANGER_START -->\nb\n<!-- SKILLRANGER_END -->\n",
    "<!-- SKILLRANGER_START -->\na\n<!-- SKILLRANGER_END -->\n<!-- SKILLRANGER_END -->\n",
    "<!-- SKILLRANGER_START -->\n<!-- SKILLRANGER_START -->\n<!-- SKILLRANGER_END -->\n<!-- SKILLRANGER_END -->\n",
  ];

  for (const source of malformed) {
    await t.test(JSON.stringify(source), async () => {
      const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-agent-context-"));
      const agentPath = path.join(projectRoot, "AGENTS.md");
      await writeFile(agentPath, source);
      await assert.rejects(upsertSkillRangerAgentContext(projectRoot), /malformed SkillRanger markers/);
      assert.equal(await readFile(agentPath, "utf8"), source);
    });
  }
});

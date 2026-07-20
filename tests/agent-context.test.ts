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

test("renders the exact SkillRanger universal router block", () => {
  assert.equal(
    renderSkillRangerAgentBlock(),
    "<!-- SKILLRANGER_START -->\n" +
      "## SkillRanger Universal Prompt Router\n" +
      "When the user's request ends with `@skillranger`, `skillranger`, or `/sr`, use the SkillRanger MCP workflow before implementation.\n" +
      "1. Call `prepare_task` with the complete user request.\n" +
      "2. If clarification is required, ask the user and call `prepare_task` again with the original request, continuation token, and answers.\n" +
      "3. If decomposition or no-match is returned, report that outcome instead of inventing a workflow.\n" +
      "4. For a prepared task, read every required instruction through `read_run_skill_file` in the returned order.\n" +
      "5. If runtime clarification is returned, resolve it through `resolve_skill_run_clarifications` after required reads and before execution.\n" +
      "6. Use the returned runtime run ID with the existing lifecycle or strict tools.\n" +
      "7. Do not install skills automatically or execute skill package scripts.\n" +
      "8. Do not claim `verified` unless SkillRanger runtime verification succeeds.\n" +
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
  assert.match(text, /prepare_task/);
  assert.match(text, /read_run_skill_file/);
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
    assert.equal(await readFile(agentPath, "utf8"), `${prefix}${renderSkillRangerAgentBlock().replaceAll("\n", "\r\n")}${suffix}`);
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

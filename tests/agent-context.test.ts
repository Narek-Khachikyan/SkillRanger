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
      "Use the SkillRanger workflow only after an explicit @skillranger, skillranger, or /sr trigger. @skillranger and /sr may lead or end a prompt; skillranger is supported at the end, and a bare leading skillranger is not a trigger.\n" +
      "This managed guidance is advisory and is not a security boundary; trust MCP validation, catalog integrity, routing hard vetoes, and runtime state.\n" +
      "1. For model-assisted routing after that trigger, call inspect_skill_catalog with an empty request. Follow each nextCursor using expectedCatalogDigest until a complete page; only the complete final page supplies catalogReceipt. If a one-page response is complete without a catalogReceipt, restart with a smaller explicit maxItems or maxBytes to force a cursor chain. Never submit a proposal without the final catalogDigest and catalogReceipt.\n" +
      "1a. After receiving the complete catalog, nominate the complete ordered role-aware set: one primary workflow plus every useful companion and verification skill, ordered by priority. A plausible primary alone is not a complete proposal. Each nomination's `evidenceText` must be a verbatim quote from the user's prompt, matched after routing normalization (case folding, punctuation-to-space, whitespace collapse) — paraphrases are rejected with `evidence-not-in-normalized-prompt`. Nominations remain untrusted input: explicit-user-choice precedence and SkillRanger routing hard vetoes still decide the final set.\n" +
      "1b. Absence of a routing proposal uses limited deterministic fallback and always reports the stable warning `semantic-recall-limited`; it does not promise semantic recall equivalent to model-assisted routing.\n" +
      "1c. Stale or invalid submitted proposals require catalog refresh or correction and are never converted to fallback.\n" +
      "2. If `inspect_skill_catalog` is unavailable because this is a legacy SkillRanger server, use the legacy path: call `prepare_task` with the complete prompt and without `routingProposal`; do not treat an unavailable catalog tool as a routing failure.\n" +
      "3. If prepare_task returns catalog_refresh_required, discard the old proposal and receipt, restart inspect_skill_catalog with an empty request, and submit a new proposal.\n" +
      "4. Call `prepare_task` with the complete user request verbatim. Do not remove, move, or rewrite the trigger, and do not submit `semanticHints` with a `routingProposal`.\n" +
      "5. If routing clarification is required, ask only the returned routing question, then call `prepare_task` again with the original complete request, continuation token, and typed answers.\n" +
      "6. If decomposition or no-match is returned, report that outcome instead of inventing a workflow.\n" +
      "7. After prepare_task returns prepared, call read_run_skill_file in mandatory-next mode in the returned order until readStatus.runMandatoryReadsComplete is true; only then branch on run.runtime, resolve runtime clarification, or begin the returned runtime run. Each new read uses a freshly generated RFC 4122 UUID and the latest returned readRevision; retry a transport failure with the identical request.\n" +
      "8. Do not call lifecycle clarification or execution tools before mandatory reads complete. `runtimeClarification` applies to the returned runtime run ID, never the router run ID.\n" +
      "9. Resolve runtime clarification from facts in the request. For an allowed decline, continue with one neutral explicit assumption per declined field instead of asking the user; ask only when a non-declinable question cannot be answered from the request.\n" +
      "10. Begin the returned runtime run only after the reads and any runtime clarification complete, then implement the original request without stopping for a plan or confirmation unless the user asked for one.\n" +
      "10a. Branch on `run.runtime`. For `lifecycle-v1` use `begin_skill_run_execution`, `complete_skill_run`, and `verify_skill_run`. For `strict-v2` use `read_next_skill_chunk`, `begin_skill_step`, `add_skill_evidence`, `complete_skill_step`, `verify_skill`, and `finalize_skill_run`. The lifecycle-v1 transition tools reject a strict-v2 run; never mix the two families on one run. `inspect_skill_run` reads either runtime.\n" +
      "11. Once the MCP server is configured, non-strict catalog-assisted routing does not require skillranger setup. setup remains the path for strict workflow installation and for writing managed agent guidance.\n" +
      "12. Do not install skills automatically or execute skill package scripts.\n" +
      "13. Do not claim `verified` unless SkillRanger runtime verification succeeds.\n" +
      "13a. A `run-blocked` error from `finalize_skill_run` means no verified result exists. Report its `userMessage` and `blockedSkills` verbatim; never describe such a run as passed, processed, or complete.\n" +
      "14. Always-on core (universal) skills carry enforced output contracts: verify_skill_run blocks until the report's universalContracts section satisfies every declared required field, and the server itself writes the canonical report file (or a verification-blocked status record) at reportPath, which must stay inside the project root. Never author report outcome files yourself and report verification status only from the persisted run via inspect_skill_run.\n" +
      "14a. For a lifecycle-v1 run whose policy has `verificationRequired`, `verify_skill_run` is mandatory: record it with any allowed outcome, including `implemented-unverified`. A `verification-required-unrecorded` notice on `complete_skill_run` or `inspect_skill_run` means no verification is recorded, and a run closed without recorded verification is incomplete and must be reported as such.\n" +
      "14b. Name an outcome only if it exists in the persisted run: the only source of outcome claims is `inspect_skill_run`. Narrating `implemented-unverified` (or any other state) without that confirmation is a violation.\n" +
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
  assert.match(text, /RFC 4122 UUID/);
  assert.match(text, /runtime run ID, never the router run ID/);
  assert.match(text, /neutral explicit assumption/);
  assert.match(text, /Do not claim `verified`/);
  assert.ok(text.endsWith("\n"));
});

test("managed guidance covers complete catalog receipt handling and setup boundaries", () => {
  const guidance = renderSkillRangerAgentBlock();
  for (const requiredPhrase of [
    "complete page",
    "catalogReceipt",
    "smaller explicit maxItems or maxBytes",
    "Never submit a proposal without",
    "complete ordered role-aware set",
    "primary workflow plus every useful companion and verification skill",
    "A plausible primary alone is not a complete proposal",
    "verbatim quote from the user's prompt",
    "routing normalization",
    "case folding",
    "punctuation-to-space",
    "whitespace collapse",
    "paraphrases are rejected",
    "evidence-not-in-normalized-prompt",
    "explicit-user-choice precedence and SkillRanger routing hard vetoes still decide the final set",
    "limited deterministic fallback",
    "`semantic-recall-limited`",
    "does not promise semantic recall equivalent to model-assisted routing",
    "never converted to fallback",
    "If `inspect_skill_catalog` is unavailable",
    "legacy SkillRanger server",
    "without `routingProposal`",
    "non-strict catalog-assisted routing does not require skillranger setup",
    "strict workflow installation",
    "advisory and is not a security boundary",
  ]) {
    assert.ok(guidance.includes(requiredPhrase), requiredPhrase);
  }
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

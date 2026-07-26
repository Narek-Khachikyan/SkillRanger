import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleJsonRpcLine, handleJsonRpcRequest } from "../src/mcp/protocol.ts";
import { skillLanes } from "../src/types.ts";

test("MCP protocol initializes with tool capability", async () => {
  const response = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "test",
        version: "0.0.0"
      }
    }
  });

  assert.equal(response?.id, 1);
  assert.equal((response?.result as { protocolVersion?: string })?.protocolVersion, "2025-06-18");
  assert.equal(Boolean((response?.result as { capabilities?: { tools?: unknown } })?.capabilities?.tools), true);
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  assert.equal(
    (response?.result as { serverInfo?: { version?: string } })?.serverInfo?.version,
    packageJson.version,
  );
  const instructions = (response?.result as { instructions?: string })?.instructions ?? "";
  for (const requiredInstruction of [
    "do not call the low-level start_skill_run after prepare_task",
    "capture_ui_evidence",
    "compare_design_variants",
    "verify_visual_result",
    "inspect_skill_run",
    "Never report that SkillRanger or strict visual verification passed unless the persisted run is verified",
  ]) {
    assert.match(instructions, new RegExp(requiredInstruction));
  }
  // prepare_task creates a strict-v2 runtime for strict tasks, so the lifecycle-v1 transition
  // tools must never be named as the unconditional continuation of a prepared run.
  assert.match(instructions, /branch on run\.runtime/);
  const lifecycleSentence = instructions.match(/For lifecycle-v1[^.]*\./)?.[0] ?? "";
  const strictSentence = instructions.match(/For strict-v2[^.;]*/)?.[0] ?? "";
  for (const tool of ["begin_skill_run_execution", "complete_skill_run", "verify_skill_run"]) {
    assert.match(lifecycleSentence, new RegExp(tool));
    assert.doesNotMatch(strictSentence, new RegExp(tool));
  }
  for (const tool of ["begin_skill_step", "add_skill_evidence", "complete_skill_step", "verify_skill", "finalize_skill_run"]) {
    assert.match(strictSentence, new RegExp(tool));
  }
});

test("lifecycle-v1 transition tools are labelled as incompatible with a strict-v2 run", async () => {
  const listed = await handleJsonRpcRequest({ jsonrpc: "2.0", id: "runtime-family", method: "tools/list", params: {} });
  const tools = (listed?.result as { tools: Array<{ name: string; description: string }> }).tools;
  const byName = new Map(tools.map((tool) => [tool.name, tool.description]));
  for (const tool of ["begin_skill_run_execution", "complete_skill_run", "verify_skill_run"]) {
    assert.match(byName.get(tool) ?? "", /Lifecycle-v1 only/, tool);
    assert.match(byName.get(tool) ?? "", /strict-v2 run is rejected/, tool);
  }
  assert.match(byName.get("inspect_skill_run") ?? "", /both lifecycle-v1 and strict-v2/);
});

test("MCP protocol ignores notifications", async () => {
  const response = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    method: "notifications/initialized"
  });

  assert.equal(response, undefined);
});

test("MCP protocol lists tools", async () => {
  const response = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: "tools",
    method: "tools/list",
    params: {}
  });
  const result = response?.result as {
    tools?: Array<{
      name: string;
      inputSchema: {
        additionalProperties?: boolean;
        properties?: {
          lane?: { enum?: unknown[] };
          limitPerLane?: { type?: string; minimum?: number };
          hostCapabilities?: { type?: string; items?: { type?: string } };
        };
      };
    }>;
  };
  const recommendSkillsTool = result.tools?.find(
    (tool) => tool.name === "recommend_skills",
  );

  assert.equal(response?.id, "tools");
  assert.ok(result.tools?.some((tool) => tool.name === "install_skill"));
  assert.equal(recommendSkillsTool?.inputSchema.additionalProperties, false);
  assert.deepEqual(
    recommendSkillsTool?.inputSchema.properties?.lane?.enum,
    skillLanes,
  );
  assert.equal(
    recommendSkillsTool?.inputSchema.properties?.limitPerLane?.type,
    "integer",
  );
  assert.equal(
    recommendSkillsTool?.inputSchema.properties?.limitPerLane?.minimum,
    1,
  );
  assert.equal(
    recommendSkillsTool?.inputSchema.properties?.hostCapabilities?.type,
    "array",
  );
  assert.equal(
    recommendSkillsTool?.inputSchema.properties?.hostCapabilities?.items?.type,
    "string",
  );
});

test("MCP publishes the strict skillInputs argument on prepare_task", async () => {
  const listed = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: "skill-inputs-schema",
    method: "tools/list",
    params: {},
  });
  const tools = (listed?.result as { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> }).tools;
  const schema = tools.find(({ name }) => name === "prepare_task")?.inputSchema;
  // additionalProperties is false, so an argument the handler accepts but the schema omits
  // would be stripped by a strictly validating host before it reaches the server.
  assert.equal(schema?.additionalProperties, false);
  const skillInputs = (schema?.properties as Record<string, Record<string, unknown>>)?.skillInputs;
  assert.equal(skillInputs?.type, "object");
  assert.deepEqual(skillInputs?.additionalProperties, { type: "object" });
});

test("MCP descriptions and stateless frontend verification prevent strict completion claims", async () => {
  const listed = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: "strict-guidance",
    method: "tools/list",
    params: {},
  });
  const tools = (listed?.result as {
    tools: Array<{ name: string; title: string; description: string }>;
  }).tools;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  assert.match(byName.get("recommend_skills")?.title ?? "", /Advisory Only/);
  assert.match(byName.get("recommend_skills")?.description ?? "", /use prepare_task instead/);
  assert.match(byName.get("verify_frontend_result")?.title ?? "", /Stateless, Not Strict/);
  assert.match(byName.get("verify_frontend_result")?.description ?? "", /Never report this result as strict SkillRanger completion/);

  const verified = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: "stateless-result",
    method: "tools/call",
    params: {
      name: "verify_frontend_result",
      arguments: { brief: {}, direction: {} },
    },
  });
  const result = verified?.result as {
    content?: Array<{ text?: string }>;
    structuredContent?: unknown;
  };
  assert.match(result.content?.[0]?.text ?? "", /NON-CERTIFYING STATELESS RESULT/);
  assert.match(result.content?.[0]?.text ?? "", /Do not report strict verification as passed/);
  assert.equal(typeof result.structuredContent, "object");
});

test("MCP tools publish complete effect and confirmation metadata", async () => {
  const response = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: "effects",
    method: "tools/list",
    params: {},
  });
  const tools = (response?.result as { tools: Array<{
    name: string;
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
    _meta?: Record<string, unknown>;
    inputSchema: { required?: string[]; properties?: Record<string, unknown> };
  }> }).tools;

  const expectedGroups = {
    "read-only": [
      "analyze_project", "recommend_skills", "audit_skill", "list_installed_skills",
      "plan_skill_install", "list_domains", "inspect_domain", "create_frontend_design_brief",
      "recommend_frontend_recipe", "validate_frontend_result", "compile_frontend_design_spec",
      "verify_frontend_result", "repair_frontend_result", "run_domain_eval", "inspect_skill_run",
       "compare_design_variants", "verify_visual_result",
    ],
    "exact-install-plan": ["install_skill"],
    "run-state-write": [
      "start_skill_run", "record_skill_read", "resolve_skill_run_clarifications",
      "begin_skill_run_execution", "complete_skill_run", "verify_skill_run",
      "read_next_skill_chunk", "begin_skill_step", "add_skill_evidence", "complete_skill_step",
       "verify_skill", "finalize_skill_run", "prepare_task", "read_run_skill_file",
    ],
    "command-and-artifact-write": ["capture_ui_evidence"],
  } as const;
  const expectedPresets = {
    "read-only": {
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      confirmation: "none",
    },
    "exact-install-plan": {
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      confirmation: "required",
    },
    "run-state-write": {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      confirmation: "host-managed",
    },
    "command-and-artifact-write": {
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      confirmation: "required",
    },
  } as const;

  assert.equal(tools.length, 33);
  for (const [effect, expectedNames] of Object.entries(expectedGroups)) {
    const matchingTools = tools.filter((tool) => tool._meta?.["skillranger/effect"] === effect);
    assert.deepEqual(matchingTools.map(({ name }) => name).sort(), [...expectedNames].sort(), effect);
    for (const tool of matchingTools) {
      const preset = expectedPresets[effect as keyof typeof expectedPresets];
      const annotations = tool.name === "read_run_skill_file"
        ? { ...preset.annotations, idempotentHint: true }
        : preset.annotations;
      assert.deepEqual(tool.annotations, annotations, tool.name);
      assert.equal(tool._meta?.["skillranger/confirmation"], preset.confirmation, tool.name);
    }
  }

  const exactPlanFields = ["expectedWrites", "expectedLockfileUpdates"];
  for (const field of exactPlanFields) {
    assert.deepEqual(
      tools.filter((tool) => tool.inputSchema.properties?.[field] !== undefined).map(({ name }) => name),
      ["install_skill"],
      field,
    );
  }
  const install = tools.find(({ name }) => name === "install_skill");
  assert.ok(install?.inputSchema.required?.includes("confirm"));
  for (const field of exactPlanFields) assert.ok(install?.inputSchema.required?.includes(field), field);
});

test("MCP protocol returns tool-level error results without JSON-RPC failure", async () => {
  const response = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "install_skill",
      arguments: {
        // confirm: false keeps the call schema-valid (confirm is a required field), so the
        // handler's confirmation gate — not centralized inputSchema validation — is exercised.
        skillId: "frontend.next-app-router-review",
        projectRoot: "fixtures/next-react-ts",
        confirm: false,
        expectedWrites: [],
        expectedLockfileUpdates: []
      }
    }
  });
  const result = response?.result as { isError?: boolean; structuredContent?: { code?: string } };

  assert.equal(response?.error, undefined);
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent?.code, "confirmation-required");
});

test("MCP tools/call rejects inputs that violate the published inputSchema before dispatch", async () => {
  const cases = [
    { name: "analyze_project", args: { projectRoot: 123 } },                    // wrong type
    { name: "analyze_project", args: { unexpectedOption: true } },              // unknown property
    { name: "compare_design_variants", args: { policyId: "p", generatorActorId: "g", criticActorId: "c", candidates: [{}, {}, {}, {}] } }, // exceeds published maxItems: 3
    {
      name: "record_skill_read",
      args: {
        projectRoot: process.cwd(),
        runId: "run_12345678",
        skillId: "frontend.accessibility-review",
        checksum: `sha256:${"a".repeat(64)}`,
        source: "content-delivered",
      },
    }, // provenance is internal-only and cannot be spoofed through the public MCP schema
  ];
  for (const [index, { name, args }] of cases.entries()) {
    const response = await handleJsonRpcRequest({
      jsonrpc: "2.0",
      id: `invalid-${index}`,
      method: "tools/call",
      params: { name, arguments: args },
    });
    const result = response?.result as { isError?: boolean; structuredContent?: { code?: string } };
    assert.equal(response?.error, undefined, name);
    assert.equal(result.isError, true, name);
    assert.equal(result.structuredContent?.code, "invalid-arguments", name);
  }
});

test("MCP protocol rejects malformed tools/call params", async () => {
  const response = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      arguments: {}
    }
  });

  assert.equal(response?.error?.code, -32602);
});

test("MCP protocol returns parse error for malformed JSON lines", async () => {
  const response = await handleJsonRpcLine("{ not json");

  assert.equal(response?.id, null);
  assert.equal(response?.error?.code, -32700);
});

test("router tool output schemas avoid MCP SDK AJV $id cache collision", async () => {
  const response = await handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: "router-output-schemas",
    method: "tools/list",
    params: {},
  });
  const tools = (response?.result as {
    tools: Array<{ name: string; outputSchema?: Record<string, unknown> }>;
  }).tools;
  const prepare = tools.find(({ name }) => name === "prepare_task");
  const read = tools.find(({ name }) => name === "read_run_skill_file");
  assert.ok(prepare?.outputSchema);
  assert.ok(read?.outputSchema);

  const prepareId = prepare.outputSchema.$id;
  const readId = read.outputSchema.$id;
  assert.ok(
    (prepareId === undefined && readId === undefined) || prepareId !== readId,
    "prepare_task and read_run_skill_file outputSchema $id must be absent or distinct",
  );

  // MCP SDK AjvJsonSchemaValidator reuses compiled schemas by $id:
  // getSchema($id) ?? compile(schema). Shared $id would bind read to prepare.
  const cache = new Map<string, Record<string, unknown>>();
  const resolveLikeMcpSdk = (schema: Record<string, unknown>) => {
    const id = schema.$id;
    if (typeof id === "string") {
      const cached = cache.get(id);
      if (cached) return cached;
      cache.set(id, schema);
      return schema;
    }
    return schema;
  };
  const prepareResolved = resolveLikeMcpSdk(prepare.outputSchema);
  const readResolved = resolveLikeMcpSdk(read.outputSchema);
  assert.notEqual(prepareResolved, readResolved);

  const { validateJsonSchema } = await import("../src/runtime/strict/json-schema.ts");
  const sampleRead = {
    ok: true,
    schemaVersion: "router-read-result/1.0",
    routerRunId: "route_abc1234",
    runtimeRunId: "run_xyz",
    runtime: "lifecycle-v1",
    readRequestId: "550e8400-e29b-41d4-a716-446655440000",
    readRevision: 1,
    skillId: "frontend.design-to-code",
    path: "SKILL.md",
    mimeType: "text/markdown",
    content: "# skill\n",
    fileChecksum: `sha256:${"a".repeat(64)}`,
    chunkChecksum: `sha256:${"b".repeat(64)}`,
    deliveredOffset: 0,
    deliveredBytes: 8,
    totalBytes: 8,
    complete: true,
    readStatus: {
      fileComplete: true,
      skillMandatoryReadsComplete: true,
      runMandatoryReadsComplete: false,
    },
  };
  assert.deepEqual(validateJsonSchema(readResolved, sampleRead), []);
  assert.notEqual(validateJsonSchema(prepareResolved, sampleRead).length, 0);
});

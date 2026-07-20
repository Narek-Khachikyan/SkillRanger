# Public Beta Behavior Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SkillRanger's public-beta behavior match its advertised frontend workflow by fixing dotted `Next.js` intent routing, making all five setup targets genuinely recommendable without cross-target installs, and exposing truthful MCP write/command boundaries.

**Architecture:** Keep manifests as the source of truth for per-skill agent compatibility, but centralize the five setup target identifiers and preserve recommendation results per target through setup planning. Fix frontend routing at its domain-token boundary instead of special-casing one CLI example. Add mandatory MCP effect metadata to every tool definition, enforce explicit confirmation and project-root confinement for command-driven UI capture, and document all 31 MCP tools by effect class. Do not change `README.md` in this plan.

**Tech Stack:** Node.js 20+, TypeScript ESM, `node:test`, JSON skill manifests, local stdio MCP protocol `2025-06-18`, existing CLI/install adapters, existing npm build and release checks.

## Global Constraints

- Work on the current `main` branch as requested; do not create a worktree or feature branch.
- Do not edit `README.md`. README synchronization is a separate follow-up after this plan is fully implemented and verified.
- Preserve the existing untracked `.pnpm-store/v11/projects/` directory; do not stage, delete, or rewrite it.
- Keep `supportedAgents` as the native-compatibility list. Do not label a host as native merely because SkillRanger knows its install directory.
- Treat `codex` and `generic-agent-skills` as native for the bundled frontend pack. Treat `claude-code`, `opencode`, `cursor`, and `gemini-cli` as `convertible` through their named adapters until host-specific native execution has separate evidence.
- Recommendation compatibility and installer layout support are separate facts. A valid install path must never silently override a manifest's missing or unsupported compatibility entry.
- Setup may present a union of recommendations across selected targets, but it may plan or apply a selected skill only to targets that actually recommended that skill.
- Keep backend-only intent rejection intact while adding dotted and undotted Next.js aliases.
- `install_skill` remains the only MCP tool with the exact prior-plan confirmation contract (`confirm`, `expectedWrites`, and `expectedLockfileUpdates`).
- Lifecycle MCP tools may persist `.skillranger/runs` state and must advertise that effect; they do not adopt install-plan fields.
- `capture_ui_evidence` must advertise command execution and file writes, require explicit confirmation, and reject output directories outside `projectRoot`.
- `outputDir` confinement limits the declared capture destination only; it does not sandbox an arbitrary `commandTemplate`. Hosts must continue treating that command as open-world and potentially destructive.
- No new runtime dependency and no MCP protocol-version bump.
- Follow TDD for every behavior change: add the focused failing test, observe the expected failure, make the smallest implementation change, then rerun the focused test.
- Make one intentional commit per task. Never stage the unrelated `.pnpm-store/v11/projects/` path.

---

### Task 1: Make the advertised target compatibility matrix truthful

**Files:**
- Modify: `src/installers/agents.ts`
- Modify: `src/cli/index.ts`
- Modify: `tests/registry.validation.test.ts`
- Modify: `tests/recommender.test.ts`
- Modify: `tests/cli.setup.test.ts`
- Modify: `registry/skills/frontend.accessibility-review/skill.manifest.json`
- Modify: `registry/skills/frontend.agents-md-bootstrap/skill.manifest.json`
- Modify: `registry/skills/frontend.audit/skill.manifest.json`
- Modify: `registry/skills/frontend.design-system/skill.manifest.json`
- Modify: `registry/skills/frontend.design-to-code/skill.manifest.json`
- Modify: `registry/skills/frontend.interaction-polish/skill.manifest.json`
- Modify: `registry/skills/frontend.motion-audit/skill.manifest.json`
- Modify: `registry/skills/frontend.motion-design/skill.manifest.json`
- Modify: `registry/skills/frontend.next-app-router-review/skill.manifest.json`
- Modify: `registry/skills/frontend.performance-review/skill.manifest.json`
- Modify: `registry/skills/frontend.playwright-debug/skill.manifest.json`
- Modify: `registry/skills/frontend.react-app-review/skill.manifest.json`
- Modify: `registry/skills/frontend.react-component-design/skill.manifest.json`
- Modify: `registry/skills/frontend.tailwind-ui-polish/skill.manifest.json`
- Modify: `registry/skills/frontend.testing-strategy/skill.manifest.json`
- Modify: `registry/skills/frontend.ux-critique/skill.manifest.json`
- Modify: `registry/skills/frontend.visual-critic/skill.manifest.json`
- Modify: `registry/skills/frontend.visual-design-polish/skill.manifest.json`

**Interfaces:**
- Produces: `setupAgentTypes` and `SetupAgentType` as the single CLI/setup target inventory.
- Preserves: `AgentType` for generic and universal adapters.
- Produces: an explicit manifest compatibility entry for every setup target on every bundled frontend skill.
- Preserves: current compatibility scoring (`native = 1`, `convertible = 0.45`) and native-only `supportedAgents` semantics.

- [ ] **Step 1: Export the canonical setup target list**

In `src/installers/agents.ts`, immediately after `AgentType`, add:

```typescript
export const setupAgentTypes = [
  "claude-code",
  "codex",
  "opencode",
  "cursor",
  "gemini-cli",
] as const satisfies readonly AgentType[];

export type SetupAgentType = (typeof setupAgentTypes)[number];
```

In `src/cli/index.ts`, import those two exports, delete the local `supportedSetupTargets` and `SupportedSetupTarget`, and replace their uses with `setupAgentTypes` and `SetupAgentType`. This is a naming/source-of-truth refactor only; target parsing and prompt ordering must remain unchanged.

- [ ] **Step 2: Add a failing registry completeness test**

In `tests/registry.validation.test.ts`, add an assertion over all bundled skills with this exact policy:

```typescript
const convertibleSetupTargets = [
  "claude-code",
  "opencode",
  "cursor",
  "gemini-cli",
] as const;

test("bundled skills declare recommendation compatibility for every setup target", async () => {
  const skills = await loadLocalRegistry("registry");
  for (const skill of skills) {
    assert.equal(skill.manifest.compatibility?.codex?.level, "native", skill.manifest.id);
    assert.ok(skill.manifest.compatibility?.codex?.scopes?.includes("repo"), skill.manifest.id);

    for (const target of convertibleSetupTargets) {
      const compatibility = skill.manifest.compatibility?.[target];
      assert.equal(compatibility?.level, "convertible", `${skill.manifest.id}:${target}`);
      assert.deepEqual(compatibility?.scopes, ["repo"], `${skill.manifest.id}:${target}`);
      assert.equal(compatibility?.adapter, target, `${skill.manifest.id}:${target}`);
      assert.equal(compatibility?.requiresAdapter, true, `${skill.manifest.id}:${target}`);
      assert.equal(skill.manifest.supportedAgents.includes(target), false, `${skill.manifest.id}:${target}`);
    }
  }
});
```

Import `loadLocalRegistry` if it is not already imported in that test file.

- [ ] **Step 3: Add a failing recommender target matrix test**

In `tests/recommender.test.ts`, add:

```typescript
test("recommender returns the Next.js skill for every advertised setup target", async () => {
  const targets = ["codex", "claude-code", "opencode", "cursor", "gemini-cli"] as const;
  for (const targetAgent of targets) {
    const recommendations = await nextFixtureRecommendations({
      targetAgent,
      userIntent:
        "Review this Next.js App Router's route handlers, Server Actions, and RSC boundaries.",
    });
    assert.equal(recommendations[0]?.skillId, "frontend.next-app-router-review", targetAgent);
    assert.equal(
      recommendations[0]?.scoreBreakdown.compatibilityScore,
      targetAgent === "codex" ? 1 : 0.45,
      targetAgent,
    );
  }
});
```

- [ ] **Step 4: Add a failing single-target setup integration matrix**

In `tests/cli.setup.test.ts`, add one loop that gives every target a fresh temporary project:

```typescript
test("setup installs recommendations for every advertised target in isolation", async () => {
  const cases = [
    ["codex", ".agents/skills/next-app-router-review/SKILL.md"],
    ["claude-code", ".claude/skills/next-app-router-review/SKILL.md"],
    ["opencode", ".agents/skills/next-app-router-review/SKILL.md"],
    ["cursor", ".agents/skills/next-app-router-review/SKILL.md"],
    ["gemini-cli", ".agents/skills/next-app-router-review/SKILL.md"],
  ] as const;

  for (const [target, installedSkillPath] of cases) {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), `skillranger-setup-${target}-`));
    const projectRoot = path.join(tmpRoot, "project");
    await cp("fixtures/next-react-ts", projectRoot, { recursive: true });
    try {
      const { stdout } = await execFileAsync(process.execPath, [
        "src/cli/index.ts", "setup", projectRoot,
        "--target", target,
        "--intent", "Review this Next.js App Router's route handlers, Server Actions, and RSC boundaries.",
        "--scope", "repo", "--copy", "--no-agent-context", "--yes",
      ]);
      assert.match(stdout, new RegExp(`Installed frontend\\.next-app-router-review for ${target}`));
      assert.equal(await exists(path.join(projectRoot, installedSkillPath)), true, target);
      const lockfile = JSON.parse(await readFile(path.join(projectRoot, "skillranger.lock.json"), "utf8")) as {
        installed: Array<{ skillId: string; targetAgent: string }>;
      };
      assert.ok(
        lockfile.installed.some(
          (entry) => entry.skillId === "frontend.next-app-router-review" && entry.targetAgent === target,
        ),
        target,
      );
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  }
});
```

- [ ] **Step 5: Run the new tests and verify RED**

Run:

```bash
node --test tests/registry.validation.test.ts tests/recommender.test.ts tests/cli.setup.test.ts
```

Expected: FAIL for the four non-Codex targets because bundled manifests do not currently contain their compatibility entries; isolated setup prints `No recommendations found` and does not create the skill or lockfile.

- [ ] **Step 6: Add the conservative convertible entries to every bundled manifest**

In the `compatibility` object of each of the 18 manifest files listed above, retain the existing `codex` and `generic-agent-skills` entries and add this exact block:

```json
"claude-code": {
  "level": "convertible",
  "scopes": ["repo"],
  "adapter": "claude-code",
  "requiresAdapter": true
},
"opencode": {
  "level": "convertible",
  "scopes": ["repo"],
  "adapter": "opencode",
  "requiresAdapter": true
},
"cursor": {
  "level": "convertible",
  "scopes": ["repo"],
  "adapter": "cursor",
  "requiresAdapter": true
},
"gemini-cli": {
  "level": "convertible",
  "scopes": ["repo"],
  "adapter": "gemini-cli",
  "requiresAdapter": true
}
```

Do not add these four ids to `supportedAgents`; that array remains `['codex', 'generic-agent-skills']` because it denotes native compatibility.

- [ ] **Step 7: Run target and registry checks and verify GREEN**

Run:

```bash
node --test tests/registry.validation.test.ts tests/recommender.test.ts tests/cli.setup.test.ts
npm run validate:registry
npm run audit:registry
```

Expected: all tests and both registry commands pass. The target matrix reports compatibility score `1` for Codex and `0.45` for the four adapter-backed targets.

- [ ] **Step 8: Commit the compatibility matrix**

```bash
git add src/installers/agents.ts src/cli/index.ts tests/registry.validation.test.ts tests/recommender.test.ts tests/cli.setup.test.ts registry/skills
git commit -m "fix: support advertised recommendation targets"
```

---

### Task 2: Keep multi-agent setup planning target-aware

**Files:**
- Create: `src/cli/setup-recommendations.ts`
- Create: `tests/setup-recommendations.test.ts`
- Modify: `src/cli/index.ts`
- Modify: `tests/cli.setup.test.ts`

**Interfaces:**
- Consumes: one recommendation list per selected setup target.
- Produces: one score-sorted union for user selection plus a `targetsBySkillId` map.
- Invariant: a skill-target pair reaches `planInstall` and `applyInstall` only if that target's own recommendation list contains the skill.

- [ ] **Step 1: Add failing unit tests for recommendation union and target ownership**

Create `tests/setup-recommendations.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { summarizeSetupRecommendations } from "../src/cli/setup-recommendations.ts";
import type { Recommendation } from "../src/types.ts";

const recommendation = (skillId: string, score: number) => ({ skillId, score }) as Recommendation;

test("setup recommendation summary keeps the best score and compatible targets", () => {
  const summary = summarizeSetupRecommendations([
    { targetAgent: "codex", recommendations: [recommendation("frontend.shared", 0.8), recommendation("frontend.codex", 0.7)] },
    { targetAgent: "claude-code", recommendations: [recommendation("frontend.shared", 0.6), recommendation("frontend.claude", 0.9)] },
  ]);

  assert.deepEqual(summary.recommendations.map(({ skillId }) => skillId), [
    "frontend.claude",
    "frontend.shared",
    "frontend.codex",
  ]);
  assert.deepEqual(summary.targetsBySkillId.get("frontend.shared"), ["codex", "claude-code"]);
  assert.deepEqual(summary.targetsBySkillId.get("frontend.codex"), ["codex"]);
  assert.deepEqual(summary.targetsBySkillId.get("frontend.claude"), ["claude-code"]);
});

test("setup recommendation summary records targets with no recommendations", () => {
  const summary = summarizeSetupRecommendations([
    { targetAgent: "codex", recommendations: [recommendation("frontend.shared", 0.8)] },
    { targetAgent: "cursor", recommendations: [] },
  ]);
  assert.deepEqual(summary.targetsWithoutRecommendations, ["cursor"]);
  assert.deepEqual(summary.targetsBySkillId.get("frontend.shared"), ["codex"]);
});
```

- [ ] **Step 2: Run the unit test and verify RED**

```bash
node --test tests/setup-recommendations.test.ts
```

Expected: FAIL with module-not-found because the target-aware summary module does not exist.

- [ ] **Step 3: Implement the target-aware summary**

Create `src/cli/setup-recommendations.ts`:

```typescript
import type { SetupAgentType } from "../installers/agents.ts";
import type { Recommendation } from "../types.ts";

export type SetupTargetRecommendations = Readonly<{
  targetAgent: SetupAgentType;
  recommendations: Recommendation[];
}>;

export const summarizeSetupRecommendations = (
  sets: SetupTargetRecommendations[],
) => {
  const bestBySkillId = new Map<string, Recommendation>();
  const targetsBySkillId = new Map<string, SetupAgentType[]>();

  for (const { targetAgent, recommendations } of sets) {
    for (const recommendation of recommendations) {
      const current = bestBySkillId.get(recommendation.skillId);
      if (!current || recommendation.score > current.score) {
        bestBySkillId.set(recommendation.skillId, recommendation);
      }
      const targets = targetsBySkillId.get(recommendation.skillId) ?? [];
      if (!targets.includes(targetAgent)) targets.push(targetAgent);
      targetsBySkillId.set(recommendation.skillId, targets);
    }
  }

  return {
    recommendations: [...bestBySkillId.values()].sort(
      (left, right) => right.score - left.score || left.skillId.localeCompare(right.skillId),
    ),
    targetsBySkillId,
    targetsWithoutRecommendations: sets
      .filter(({ recommendations }) => recommendations.length === 0)
      .map(({ targetAgent }) => targetAgent),
  };
};
```

- [ ] **Step 4: Wire the summary into setup without changing interactive selection**

In `src/cli/index.ts`:

1. Import `summarizeSetupRecommendations`.
2. Delete the local `mergeRecommendationsBySkillId` helper.
3. Replace the current recommendation merge with:

```typescript
const recommendationSummary = summarizeSetupRecommendations(
  targetAgents.map((targetAgent) => ({
    targetAgent,
    recommendations: recommendSkills(fingerprint, skills, {
      targetAgent,
      userIntent,
      lane,
      limitPerLane,
    }),
  })),
);
const recommendations = recommendationSummary.recommendations;
```

4. After the setup header, print one non-fatal warning when `targetsWithoutRecommendations` is non-empty:

```typescript
if (recommendationSummary.targetsWithoutRecommendations.length > 0) {
  console.log(
    `No matching compatible recommendations for: ${formatTargetAgents(recommendationSummary.targetsWithoutRecommendations)}`,
  );
}
```

5. In both the planning and apply loops, replace `for (const targetAgent of targetAgents)` with:

```typescript
const compatibleTargets = recommendationSummary.targetsBySkillId.get(skillId) ?? [];
for (const targetAgent of compatibleTargets) {
  // existing plan/apply body
}
```

For the apply loop, retain a `Map<string, RegistrySkill>` or a `{ skill, targetAgents }` array so the selected skill id remains available without recomputing recommendations. Do not infer compatibility from the merged recommendation's winning target.

- [ ] **Step 5: Add a mixed-target regression assertion**

Extend `tests/cli.setup.test.ts` so the existing `codex,claude-code` case parses `skillranger.lock.json` and asserts that `frontend.next-app-router-review` has entries for both targets. Keep the filesystem assertions for both `.agents/skills` and `.claude/skills`.

The unit test above is the negative proof: when a skill appears only for Codex, Cursor is absent from `targetsBySkillId` and therefore cannot reach either installer loop.

- [ ] **Step 6: Run focused setup tests and verify GREEN**

```bash
node --test tests/setup-recommendations.test.ts tests/cli.setup.test.ts tests/recommender.test.ts
```

Expected: all tests pass; selected skills are installed only for targets present in their per-target recommendation sets.

- [ ] **Step 7: Commit target-aware setup**

```bash
git add src/cli/setup-recommendations.ts src/cli/index.ts tests/setup-recommendations.test.ts tests/cli.setup.test.ts
git commit -m "fix: keep setup installs target compatible"
```

---

### Task 3: Recognize dotted Next.js intents without weakening domain rejection

**Files:**
- Modify: `tests/recommender.test.ts`
- Modify: `src/domains/frontend/routing.ts`

**Interfaces:**
- Consumes: natural-language intents tokenized by the frontend routing policy.
- Produces: the same `frontend.next-app-router-review` route for `Next.js`, `NextJS`, and `Next` tokens.
- Preserves: empty recommendations for backend/database/release-only requests without frontend evidence.

- [ ] **Step 1: Add the exact public example as a failing regression**

In `tests/recommender.test.ts`, add:

```typescript
test("recommender keeps dotted Next.js release wording in the frontend domain", async () => {
  const recommendations = await nextFixtureRecommendations({
    userIntent: "Review this Next.js app before release",
  });
  assert.equal(recommendations[0]?.skillId, "frontend.next-app-router-review");
});
```

Also extend the existing backend-only rejection test with this negative control:

```typescript
"Review the backend release process and database migrations before release.",
```

- [ ] **Step 2: Run the exact regression and verify RED**

```bash
node --test --test-name-pattern="dotted Next.js|backend-only intent" tests/recommender.test.ts
```

Expected: the dotted Next.js test fails with no recommendation. The tokenizer preserves `next.js` as one token, while `domainTokens` currently contains only `next`; `release` therefore triggers non-domain rejection.

- [ ] **Step 3: Add canonical Next.js aliases at the domain gate**

In `src/domains/frontend/routing.ts`, change the relevant portion of `domainTokens` from:

```typescript
"mobile", "next", "page",
```

to:

```typescript
"mobile", "next", "next.js", "nextjs", "page",
```

Do not remove `release` from `nonDomainTokens`, do not globally strip dots from tokenization, and do not add a phrase-level exception. The domain aliases are the narrow fix and match the existing `next.js` specialized intent hint plus the `nextjs` stack tag.

- [ ] **Step 4: Run focused and full routing tests and verify GREEN**

```bash
node --test tests/recommender.test.ts tests/frontend-intents.test.ts tests/domain-pack.test.ts
node src/cli/index.ts recommend fixtures/next-react-ts --target codex --intent "Review this Next.js app before release" --json
```

Expected: tests pass and the CLI JSON contains `frontend.next-app-router-review` as the first recommendation. Backend-only controls still return an empty array.

- [ ] **Step 5: Commit the routing fix**

```bash
git add src/domains/frontend/routing.ts tests/recommender.test.ts
git commit -m "fix: recognize dotted Next.js intents"
```

---

### Task 4: Publish and enforce MCP effect boundaries

**Files:**
- Modify: `src/mcp/tools/types.ts`
- Modify: `src/mcp/tools/project.ts`
- Modify: `src/mcp/tools/registry.ts`
- Modify: `src/mcp/tools/install.ts`
- Modify: `src/mcp/tools/domains.ts`
- Modify: `src/mcp/tools/runs.ts`
- Modify: `src/mcp/tools/visual.ts`
- Modify: `src/mcp/protocol.ts`
- Modify: `tests/mcp.protocol.test.ts`
- Modify: `tests/mcp.test.ts`
- Modify: `tests/mcp.visual-tools.test.ts`

**Interfaces:**
- Produces: standard MCP annotations on all 31 tools.
- Produces: namespaced `_meta` fields that identify SkillRanger's effect and confirmation boundary.
- Enforces: `capture_ui_evidence.confirm === true` and an `outputDir` contained by `projectRoot`.
- Preserves: exact stale-plan validation only for `install_skill`.

- [ ] **Step 1: Add failing protocol metadata tests**

In `tests/mcp.protocol.test.ts`, extend the `tools/list` result type with `annotations` and `_meta`, then add:

```typescript
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
  }> }).tools;

  assert.equal(tools.length, 31);
  for (const tool of tools) {
    assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", tool.name);
    assert.equal(typeof tool.annotations?.destructiveHint, "boolean", tool.name);
    assert.equal(typeof tool.annotations?.idempotentHint, "boolean", tool.name);
    assert.equal(typeof tool.annotations?.openWorldHint, "boolean", tool.name);
    assert.equal(typeof tool._meta?.["skillranger/effect"], "string", tool.name);
    assert.equal(typeof tool._meta?.["skillranger/confirmation"], "string", tool.name);
  }

  const install = tools.find(({ name }) => name === "install_skill");
  assert.equal(install?._meta?.["skillranger/effect"], "exact-install-plan");
  assert.equal(install?._meta?.["skillranger/confirmation"], "required");
  assert.equal(install?.annotations?.readOnlyHint, false);
  assert.equal(install?.annotations?.destructiveHint, true);

  const lifecycle = tools.find(({ name }) => name === "read_next_skill_chunk");
  assert.equal(lifecycle?._meta?.["skillranger/effect"], "run-state-write");
  assert.equal(lifecycle?.annotations?.readOnlyHint, false);

  const capture = tools.find(({ name }) => name === "capture_ui_evidence");
  assert.equal(capture?._meta?.["skillranger/effect"], "command-and-artifact-write");
  assert.equal(capture?._meta?.["skillranger/confirmation"], "required");
  assert.equal(capture?.annotations?.destructiveHint, true);
  assert.equal(capture?.annotations?.openWorldHint, true);
});
```

- [ ] **Step 2: Add failing capture confirmation and path-confinement tests**

In `tests/mcp.visual-tools.test.ts`, add tests that call `capture_ui_evidence` with otherwise valid fixture arguments:

1. Without `confirm`: expect `isError: true` and `structuredContent.code === 'confirmation-required'`.
2. With `confirm: true` and an absolute `outputDir` outside `projectRoot`: expect `isError: true`, `structuredContent.code === 'invalid-arguments'`, and no output directory or artifact creation.

Update the existing successful capture call to include `confirm: true` so its behavior remains explicit after the guard is implemented.

- [ ] **Step 3: Run the new MCP tests and verify RED**

```bash
node --test tests/mcp.protocol.test.ts tests/mcp.visual-tools.test.ts
```

Expected: metadata assertions fail because definitions expose neither `annotations` nor `_meta`; capture currently accepts no confirmation and resolves absolute output paths outside the project.

- [ ] **Step 4: Define required MCP effect metadata presets**

In `src/mcp/tools/types.ts`, replace the current definition type with these required metadata fields and presets:

```typescript
export type McpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type McpToolEffect =
  | "read-only"
  | "exact-install-plan"
  | "run-state-write"
  | "command-and-artifact-write";

export type McpToolEffectMetadata = {
  annotations: McpToolAnnotations;
  _meta: {
    "skillranger/effect": McpToolEffect;
    "skillranger/confirmation": "none" | "host-managed" | "required";
  };
};

export type McpToolDefinition = McpToolEffectMetadata & {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonObject;
};

export const mcpToolEffects = {
  readOnly: {
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { "skillranger/effect": "read-only", "skillranger/confirmation": "none" },
  },
  exactInstallPlan: {
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    _meta: { "skillranger/effect": "exact-install-plan", "skillranger/confirmation": "required" },
  },
  runStateWrite: {
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { "skillranger/effect": "run-state-write", "skillranger/confirmation": "host-managed" },
  },
  commandAndArtifactWrite: {
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    _meta: { "skillranger/effect": "command-and-artifact-write", "skillranger/confirmation": "required" },
  },
} as const satisfies Record<string, McpToolEffectMetadata>;
```

Re-export the new types from `src/mcp/tools.ts` with the existing MCP types.

- [ ] **Step 5: Annotate every tool with one effect class**

Import `mcpToolEffects` into each definition file and spread exactly one preset into every definition.

Use `...mcpToolEffects.readOnly` for these 17 tools:

```text
analyze_project
recommend_skills
audit_skill
list_installed_skills
plan_skill_install
list_domains
inspect_domain
create_frontend_design_brief
recommend_frontend_recipe
validate_frontend_result
compile_frontend_design_spec
verify_frontend_result
repair_frontend_result
run_domain_eval
inspect_skill_run
compare_design_variants
verify_visual_result
```

Use `...mcpToolEffects.exactInstallPlan` only for `install_skill`.

Use `...mcpToolEffects.runStateWrite` for these 12 tools:

```text
start_skill_run
record_skill_read
resolve_skill_run_clarifications
begin_skill_run_execution
complete_skill_run
verify_skill_run
read_next_skill_chunk
begin_skill_step
add_skill_evidence
complete_skill_step
verify_skill
finalize_skill_run
```

Use `...mcpToolEffects.commandAndArtifactWrite` only for `capture_ui_evidence`.

Because `McpToolDefinition` makes metadata required, TypeScript must fail if a future tool is added without an effect classification.

- [ ] **Step 6: Enforce capture confirmation and project-root confinement**

In `src/mcp/tools/visual.ts`:

1. Add `confirm` to the schema and to `required`:

```typescript
confirm: {
  type: "boolean",
  description: "Must be true after the host reviews commandTemplate, baseUrl, and outputDir.",
},
```

2. Import `McpToolError`.
3. Add this helper:

```typescript
const resolveProjectOutputDir = (projectRoot: string, value: unknown) => {
  const outputDir = path.resolve(projectRoot, requireString(value, "outputDir"));
  const relative = path.relative(projectRoot, outputDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new McpToolError(
      "invalid-arguments",
      "capture_ui_evidence outputDir must stay within projectRoot.",
      { projectRoot, outputDir },
    );
  }
  return outputDir;
};
```

4. At the beginning of the handler, before creating a plan or executing a command, add:

```typescript
if (args.confirm !== true) {
  throw new McpToolError(
    "confirmation-required",
    "capture_ui_evidence requires confirm: true after reviewing commandTemplate, baseUrl, and outputDir.",
  );
}
```

5. Replace the current `path.resolve(projectRoot, requireString(args.outputDir, 'outputDir'))` expression with `resolveProjectOutputDir(projectRoot, args.outputDir)`.

Do not add `expectedWrites` or `expectedLockfileUpdates`; UI capture has a command-specific approval boundary, not an install-plan boundary.

- [ ] **Step 7: Correct the MCP server initialization summary**

In `src/mcp/protocol.ts`, replace the initialization `instructions` string with a concise statement covering all effects:

```typescript
instructions:
  "SkillRanger provides read-only analysis and recommendation tools, exact-plan-confirmed skill installation, persisted skill-run lifecycle tools, and explicitly confirmed UI evidence capture. Capture constrains its declared output directory to the project, while the host-reviewed command remains open-world.",
```

- [ ] **Step 8: Run MCP tests and verify GREEN**

```bash
node --test tests/mcp.protocol.test.ts tests/mcp.test.ts tests/mcp.visual-tools.test.ts
npm run build
```

Expected: all 31 tools carry complete metadata; install, lifecycle, and capture tools have distinct effects; unconfirmed or out-of-project capture is rejected before command execution; existing confirmed capture tests pass.

- [ ] **Step 9: Commit MCP effect enforcement**

```bash
git add src/mcp tests/mcp.protocol.test.ts tests/mcp.test.ts tests/mcp.visual-tools.test.ts
git commit -m "feat: enforce MCP tool effect boundaries"
```

---

### Task 5: Document the complete MCP surface without touching README

**Files:**
- Modify: `docs/mcp-host-config.md`
- Test: `tests/mcp.protocol.test.ts`

**Interfaces:**
- Documents: all 31 tool names returned by `tools/list`.
- Documents: four effect classes and their distinct approval expectations.
- Preserves: the existing install confirmation example and CLI/MCP lifecycle parity section.

- [ ] **Step 1: Replace the inaccurate write-boundary introduction**

Change the opening claim from “Most tools are read-only” plus install-only detail to a four-class summary:

```markdown
SkillRanger publishes effect metadata for every MCP tool. Read-only tools do not mutate project state. `install_skill` writes only after exact-plan confirmation. Skill-run lifecycle tools persist state under `.skillranger/runs` using host-managed mutation approval. `capture_ui_evidence` executes a host-reviewed command and writes artifacts inside `projectRoot`; it requires `confirm: true` but does not use install-plan fields.
```

Immediately follow this paragraph with a warning that `outputDir` confinement does not sandbox `commandTemplate`; the host must review the full command because its side effects can extend beyond the declared capture destination.

- [ ] **Step 2: Replace the partial Tool Surface list with four complete groups**

List all 31 names under these headings:

1. **Read-only (17):** the exact 17 names assigned `mcpToolEffects.readOnly` in Task 4.
2. **Exact-plan install (1):** `install_skill`.
3. **Persisted run-state transitions (12):** the exact 12 names assigned `mcpToolEffects.runStateWrite`.
4. **Confirmed command and artifact write (1):** `capture_ui_evidence`.

Give every tool a one-sentence description. Explicitly state that `read_next_skill_chunk` is state-writing because it advances persisted read progress, despite its name.

- [ ] **Step 3: Add capture approval guidance**

Add a `UI Capture Confirmation Flow` section with these exact host responsibilities:

1. Show `commandTemplate`, `baseUrl`, resolved `projectRoot`, and requested `outputDir`.
2. Require user/host approval before sending `confirm: true`.
3. Expect rejection when `outputDir` escapes `projectRoot`.
4. Treat the invoked command as open-world and potentially destructive according to MCP annotations.
5. Do not send install-only `expectedWrites` or `expectedLockfileUpdates` fields.

- [ ] **Step 4: Keep install and lifecycle wording scoped**

Retain the current `Install Confirmation Flow`, but say explicitly that it applies only to `install_skill`. In the lifecycle section, state that all transition/read-progress tools update the persisted run JSON and that `inspect_skill_run` is the only read-only lifecycle tool.

- [ ] **Step 5: Verify documentation inventory mechanically**

Run:

```bash
node -e 'import("./src/mcp/tools.ts").then(({mcpTools})=>{const fs=require("node:fs");const doc=fs.readFileSync("docs/mcp-host-config.md","utf8");const missing=mcpTools.map(({name})=>name).filter((name)=>!doc.includes("`"+name+"`"));if(missing.length)throw new Error("Missing MCP docs: "+missing.join(", "));console.log("documented",mcpTools.length,"tools")})'
git diff -- README.md
```

Expected: `documented 31 tools`; the README diff is empty.

- [ ] **Step 6: Commit MCP documentation**

```bash
git add docs/mcp-host-config.md
git commit -m "docs: describe complete MCP effect surface"
```

---

### Task 6: Run public-beta release verification and audit the final diff

**Files:**
- Verify only: all files changed in Tasks 1-5
- Must remain unchanged: `README.md`
- Must remain untracked and unstaged: `.pnpm-store/v11/projects/`

- [ ] **Step 1: Run all focused regression suites**

```bash
node --test tests/recommender.test.ts tests/registry.validation.test.ts tests/setup-recommendations.test.ts tests/cli.setup.test.ts tests/mcp.protocol.test.ts tests/mcp.test.ts tests/mcp.visual-tools.test.ts
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 2: Run static, registry, and package checks**

```bash
npm run build
npm run check
npm run validate:registry
npm run lint:skills
npm run audit:registry
npm run smoke:package
```

Expected: every command exits `0`; package smoke verifies the packed CLI/MCP entrypoints and registry payload.

- [ ] **Step 3: Run the complete release gate**

```bash
npm run release:check
```

Expected: build, syntax checks, full test suite, registry checks, frontend routing evals, and Russian evals all pass.

- [ ] **Step 4: Smoke the exact public-facing intent and five targets**

Run these five commands:

```bash
node src/cli/index.ts recommend fixtures/next-react-ts --target codex --intent "Review this Next.js app before release" --json
node src/cli/index.ts recommend fixtures/next-react-ts --target claude-code --intent "Review this Next.js app before release" --json
node src/cli/index.ts recommend fixtures/next-react-ts --target opencode --intent "Review this Next.js app before release" --json
node src/cli/index.ts recommend fixtures/next-react-ts --target cursor --intent "Review this Next.js app before release" --json
node src/cli/index.ts recommend fixtures/next-react-ts --target gemini-cli --intent "Review this Next.js app before release" --json
```

Expected for each: non-empty `recommendations`; first `skillId` is `frontend.next-app-router-review`. Codex reports compatibility `1`; the other four report `0.45`.

- [ ] **Step 5: Audit scope, placeholders, and unrelated changes**

```bash
rg -n "TODO|TBD|FIXME|placeholder" src/installers/agents.ts src/cli/setup-recommendations.ts src/domains/frontend/routing.ts src/mcp docs/mcp-host-config.md tests/setup-recommendations.test.ts
git diff --check
git diff -- README.md
git status --short
```

Expected:

- no new placeholder markers;
- no whitespace errors;
- no README diff;
- only intentional implementation/documentation files differ from the task commits;
- `.pnpm-store/v11/projects/` remains untracked and unstaged.

- [ ] **Step 6: Review the final commit sequence**

```bash
git log --oneline -6
```

Expected task commits, newest first:

```text
docs: describe complete MCP effect surface
feat: enforce MCP tool effect boundaries
fix: recognize dotted Next.js intents
fix: keep setup installs target compatible
fix: support advertised recommendation targets
```

Do not create an extra empty commit. Stop after reporting verification evidence; README work remains intentionally deferred.

# Shared Skill Contracts, Phase Routing, And MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove repeated frontend verification prose, route specialist skills through explicit ownership phases, and expose evidence capture, variant comparison, and final visual verification as three MCP tools over canonical services.

**Architecture:** Registry manifests may declare versioned shared contract ids. Registry loading includes those contract files in skill integrity, and installers materialize them under `references/shared/` so installed skills retain local readable references. A pure frontend phase planner maps intent and findings to ordered single-owner phases. MCP visual tools live in a dedicated module and delegate to the evidence, critic, and verification services from prior plans.

**Tech Stack:** TypeScript 6, Node.js 24 built-ins, Node test runner, existing registry/installers/recommender/MCP modules, frontend design services from Plans 1–4.

## Global Constraints

- Shared contracts have one canonical source under `registry/contracts/frontend/`.
- Installed skills receive immutable materialized copies under `references/shared/`; agents never need an unresolved repository-relative path.
- Shared contract content participates in skill checksum and install-plan writes.
- A shared contract change invalidates the previous skill checksum and requires reinstall/read evidence.
- Each execution phase has exactly one owning skill; support skills cannot expand the owner's scope.
- Phase order is visual direction, UX, design system, implementation, motion, accessibility, final audit.
- Inapplicable phases require a recorded skip reason.
- Repair enters at the phase owning the finding and returns to evidence capture.
- `capture_ui_evidence`, `compare_design_variants`, and `verify_visual_result` call domain services; handlers do not duplicate validation.
- The critic remains host-executed and non-coding; MCP prepares/validates critic exchange but does not impersonate an independent model.
- Use TDD for every task and commit only the files listed for that task.

---

### Task 1: Versioned shared-contract packaging and integrity

**Files:**
- Create: `registry/contracts/frontend/browser-evidence.md`
- Create: `registry/contracts/frontend/bounded-repair.md`
- Create: `registry/contracts/frontend/visual-verification.md`
- Modify: `src/types.ts`
- Modify: `schemas/registry.schema.json`
- Modify: `src/registry/validation.ts`
- Modify: `src/registry/index.ts`
- Modify: `src/installers/codex.ts`
- Test: `tests/registry.validation.test.ts`
- Test: `tests/installer.codex.test.ts`
- Test: `tests/lockfile.test.ts`

**Interfaces:**
- Produces: manifest field `execution.sharedContracts?: string[]`, registry type `ResolvedSharedContract`, `RegistrySkill.sharedContracts`, and materialized paths `references/shared/<contract-id>.md`.
- Consumes: registry root, existing checksum/install plan, and current atomic installer.

- [ ] **Step 1: Write failing manifest, checksum, plan, and install tests**

```ts
test("validates safe shared contract ids", async () => {
  const manifest = JSON.parse(await readFile(
    "registry/skills/frontend.visual-design-polish/skill.manifest.json",
    "utf8",
  ));
  manifest.execution.sharedContracts = ["frontend/browser-evidence", "../escape"];
  assert.ok(validateSkillManifest(manifest).some(({ path }) => path === "execution.sharedContracts.1"));
});

test("includes shared contracts in checksum and install writes", async () => {
  const fixture = await createRegistrySkillFixture({
    sharedContracts: ["frontend/browser-evidence"],
    contractText: "# Browser Evidence\n\nVersion one.\n",
  });
  const first = await findSkill(fixture.skillId, fixture.registryRoot);
  assert.ok(first);
  const plan = await getAdapter("codex").planInstall(first!, fixture.installInput);
  assert.ok(plan.writes.some((file) => file.endsWith("references/shared/frontend--browser-evidence.md")));
  await writeFile(fixture.contractPath, "# Browser Evidence\n\nVersion two.\n");
  const second = await findSkill(fixture.skillId, fixture.registryRoot);
  assert.notEqual(second!.checksum, first!.checksum);
});

test("materializes shared contracts atomically with the skill", async () => {
  const fixture = await createRegistrySkillFixture({ sharedContracts: ["frontend/browser-evidence"] });
  const skill = await findSkill(fixture.skillId, fixture.registryRoot);
  await getAdapter("codex").applyInstall(skill!, fixture.installInput);
  assert.match(await readFile(path.join(fixture.installedDir, "references/shared/frontend--browser-evidence.md"), "utf8"), /Browser Evidence/);
});
```

Add fixture helpers locally in the test files; registry layout is `<temp>/skills/<skill-id>` and `<temp>/contracts/frontend/browser-evidence.md`.

- [ ] **Step 2: Run focused tests and verify manifest ignores/resolution fails**

Run: `node --test tests/registry.validation.test.ts tests/installer.codex.test.ts tests/lockfile.test.ts`

Expected: FAIL because `sharedContracts` is not typed, validated, checksummed, planned, or copied.

- [ ] **Step 3: Add the exact shared-contract registry contract**

```ts
export type ResolvedSharedContract = {
  id: string;
  path: string;
  checksum: string;
  installPath: string;
};

// In SkillManifest.execution:
sharedContracts?: string[];

// In RegistrySkill:
sharedContracts?: ResolvedSharedContract[];
```

Accept ids matching `/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/`. Resolve them from `path.resolve(registryRoot, "..", "contracts", `${id}.md`)`, reject paths outside that contracts root, require a regular file, and set install path to `references/shared/${id.replaceAll("/", "--")}.md`.

Extend `computeSkillChecksum(skillPath, sharedContracts = [])` so its hash input appends each contract's normalized install path, NUL byte, file bytes, and NUL byte in sorted id order. `findSkill` supplies resolved contracts. `assertSkillIntegrity`, `planWrites`, and `copySkillFiles` use `skill.sharedContracts ?? []`; write contracts into the staging directory before atomic replacement.

- [ ] **Step 4: Write the three canonical contract documents and run safety tests**

`browser-evidence.md` defines the fixed viewport/state matrix, screenshots, browser/runtime/a11y checks, and host-adapter evidence fields. `bounded-repair.md` defines allowed changes, protected invariants, pass criteria, iteration budget, and regression rules. `visual-verification.md` defines initial evidence, independent critique, repair/no-repair policy, fresh recheck, and outcome boundaries. Each starts with `Contract-Version: 1.0.0` and contains no skill-specific trigger text.

Run: `node --test tests/registry.validation.test.ts tests/installer.codex.test.ts tests/lockfile.test.ts tests/audit.test.ts && npm run build`

Expected: PASS; path traversal and missing contracts fail before installation, and contract content affects checksum.

- [ ] **Step 5: Commit shared-contract packaging**

```bash
git add registry/contracts/frontend src/types.ts schemas/registry.schema.json src/registry/validation.ts src/registry/index.ts src/installers/codex.ts tests/registry.validation.test.ts tests/installer.codex.test.ts tests/lockfile.test.ts
git commit -m "feat(registry): package versioned shared skill contracts"
```

---

### Task 2: Deduplicate frontend skills onto shared contracts

**Files:**
- Modify: `registry/skills/frontend.visual-design-polish/skill.manifest.json`
- Modify: `registry/skills/frontend.visual-design-polish/SKILL.md`
- Modify: `registry/skills/frontend.design-to-code/skill.manifest.json`
- Modify: `registry/skills/frontend.design-to-code/SKILL.md`
- Modify: `registry/skills/frontend.tailwind-ui-polish/skill.manifest.json`
- Modify: `registry/skills/frontend.tailwind-ui-polish/SKILL.md`
- Modify: `registry/skills/frontend.motion-design/skill.manifest.json`
- Modify: `registry/skills/frontend.motion-design/SKILL.md`
- Modify: `registry/skills/frontend.motion-audit/skill.manifest.json`
- Modify: `registry/skills/frontend.motion-audit/SKILL.md`
- Modify: `registry/skills/frontend.accessibility-review/skill.manifest.json`
- Modify: `registry/skills/frontend.accessibility-review/SKILL.md`
- Modify: `registry/skills/frontend.ux-critique/skill.manifest.json`
- Modify: `registry/skills/frontend.ux-critique/SKILL.md`
- Modify: `registry/skills/frontend.design-system/skill.manifest.json`
- Modify: `registry/skills/frontend.design-system/SKILL.md`
- Modify: `registry/skills/frontend.audit/skill.manifest.json`
- Modify: `registry/skills/frontend.audit/SKILL.md`
- Test: `tests/skill-content-contracts.test.ts`
- Test: `tests/design-skill-contracts.test.ts`

**Interfaces:**
- Consumes: three shared contract ids from Task 1.
- Produces: skill manifests that materialize shared references and shorter SKILL.md files that retain only ownership-specific rules.

- [ ] **Step 1: Add failing shared-reference and duplication-budget tests**

```ts
test("material frontend skills declare canonical shared contracts", async () => {
  const expected: Record<string, string[]> = {
    "frontend.visual-design-polish": ["frontend/browser-evidence", "frontend/bounded-repair", "frontend/visual-verification"],
    "frontend.design-to-code": ["frontend/browser-evidence", "frontend/bounded-repair", "frontend/visual-verification"],
    "frontend.tailwind-ui-polish": ["frontend/browser-evidence", "frontend/bounded-repair", "frontend/visual-verification"],
    "frontend.motion-design": ["frontend/browser-evidence", "frontend/bounded-repair", "frontend/visual-verification"],
    "frontend.motion-audit": ["frontend/browser-evidence", "frontend/visual-verification"],
    "frontend.accessibility-review": ["frontend/browser-evidence", "frontend/visual-verification"],
    "frontend.ux-critique": ["frontend/browser-evidence", "frontend/visual-verification"],
    "frontend.design-system": ["frontend/bounded-repair", "frontend/visual-verification"],
    "frontend.audit": ["frontend/browser-evidence", "frontend/visual-verification"],
  };
  for (const [id, contracts] of Object.entries(expected)) {
    const manifest = JSON.parse(await readFile(`registry/skills/${id}/skill.manifest.json`, "utf8"));
    assert.deepEqual(manifest.execution.sharedContracts, contracts);
    const skill = await readFile(`registry/skills/${id}/SKILL.md`, "utf8");
    for (const contract of contracts) assert.match(skill, new RegExp(contract.replace("/", "--")));
  }
});

test("shared lifecycle prose exists only in canonical contracts", async () => {
  const ids = [
    "frontend.visual-design-polish", "frontend.design-to-code", "frontend.tailwind-ui-polish",
    "frontend.motion-design", "frontend.motion-audit", "frontend.accessibility-review",
    "frontend.ux-critique", "frontend.design-system", "frontend.audit",
  ];
  const skillTexts = await Promise.all(ids.map((id) =>
    readFile(`registry/skills/${id}/SKILL.md`, "utf8")
  ));
  for (const text of skillTexts) {
    assert.doesNotMatch(text, /render every declared viewport and state, capture screenshots, then repair all hard findings/i);
  }
});
```

- [ ] **Step 2: Run skill tests and confirm shared declarations are missing**

Run: `node --test tests/skill-content-contracts.test.ts tests/design-skill-contracts.test.ts`

Expected: FAIL on missing `execution.sharedContracts`.

- [ ] **Step 3: Replace duplicated lifecycle prose with materialized references**

Each SKILL.md must contain a `## Shared Contracts` section with relative links such as `references/shared/frontend--browser-evidence.md`. Retain trigger/non-trigger rules, evidence specific to the skill, specialized decisions, output shape, and ownership boundary. Remove repeated viewport matrices, generic evidence lifecycle, generic repair wording, and generic verified-outcome wording now owned by contracts.

Keep these ownership statements exact:

- visual-design-polish owns art direction;
- ux-critique owns task-flow critique and cannot select visual styling;
- design-system owns reusable tokens/primitives;
- tailwind-ui-polish owns Tailwind implementation and bounded repair;
- motion-design owns cause-and-effect motion direction;
- motion-audit owns motion verification only;
- accessibility-review owns semantic, keyboard, focus, target, contrast, and reduced-motion findings;
- audit owns final cross-lane release decision.

- [ ] **Step 4: Run registry, lint, audit, and install smoke tests**

Run: `node --test tests/skill-content-contracts.test.ts tests/design-skill-contracts.test.ts tests/installer.codex.test.ts && npm run validate:registry && npm run lint:skills && npm run audit:registry`

Expected: PASS; installed fixture skills contain every declared shared contract.

- [ ] **Step 5: Commit skill deduplication**

```bash
git add registry/skills/frontend.visual-design-polish registry/skills/frontend.design-to-code registry/skills/frontend.tailwind-ui-polish registry/skills/frontend.motion-design registry/skills/frontend.motion-audit registry/skills/frontend.accessibility-review registry/skills/frontend.ux-critique registry/skills/frontend.design-system registry/skills/frontend.audit tests/skill-content-contracts.test.ts tests/design-skill-contracts.test.ts
git commit -m "refactor(frontend): centralize visual verification contracts"
```

---

### Task 3: Ordered frontend phase planner and repair routing

**Files:**
- Create: `src/domains/frontend/phases.ts`
- Create: `domains/frontend/intents/phases.json`
- Modify: `src/runtime/skill-run/types.ts`
- Modify: `src/domains/frontend/routing.ts`
- Modify: `src/domains/frontend/run-policy.ts`
- Modify: `domains/frontend/domain.manifest.json`
- Modify: `domains/frontend/README.md`
- Test: `tests/frontend-phase-routing.test.ts`
- Test: `tests/frontend-run-policy.test.ts`

**Interfaces:**
- Produces: `FrontendExecutionPhase`, `FrontendPhasePlanEntry`, `FrontendPhasePlan`, `planFrontendPhases(input)`, and `phaseForFinding(code)`.
- Consumes: recommendations, analyzed canonical intent, optional normalized finding codes, and applicability signals.

- [ ] **Step 1: Write failing phase order, single-owner, skip, and repair-entry tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { phaseForFinding, planFrontendPhases } from "../src/domains/frontend/phases.ts";

test("plans the full material frontend ownership chain", () => {
  const plan = planFrontendPhases({
    intent: "Reimagine this Tailwind SaaS workspace with motion and verify accessibility",
    recommendedSkillIds: [
      "frontend.visual-design-polish", "frontend.ux-critique", "frontend.design-system",
      "frontend.tailwind-ui-polish", "frontend.motion-design", "frontend.accessibility-review", "frontend.audit",
    ],
  });
  assert.deepEqual(plan.entries.map(({ phase, ownerSkillId }) => [phase, ownerSkillId]), [
    ["visual-direction", "frontend.visual-design-polish"],
    ["ux", "frontend.ux-critique"],
    ["design-system", "frontend.design-system"],
    ["implementation", "frontend.tailwind-ui-polish"],
    ["motion", "frontend.motion-design"],
    ["accessibility", "frontend.accessibility-review"],
    ["final-audit", "frontend.audit"],
  ]);
});

test("records explicit skips and routes repairs to one owner", () => {
  const plan = planFrontendPhases({
    intent: "Repair the invisible keyboard focus",
    recommendedSkillIds: ["frontend.accessibility-review", "frontend.audit"],
    repairFindingCodes: ["invisible-focus"],
  });
  assert.equal(phaseForFinding("invisible-focus"), "accessibility");
  assert.equal(plan.repairEntryPhase, "accessibility");
  assert.ok(plan.entries.filter(({ status }) => status === "skipped").every(({ skipReason }) => Boolean(skipReason)));
});
```

- [ ] **Step 2: Run the focused tests and verify phase planner is absent**

Run: `node --test tests/frontend-phase-routing.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/domains/frontend/phases.ts`.

- [ ] **Step 3: Define phase data and pure planning rules**

```ts
export type FrontendExecutionPhase =
  | "visual-direction" | "ux" | "design-system" | "implementation"
  | "motion" | "accessibility" | "final-audit";

export type FrontendPhasePlanEntry = {
  phase: FrontendExecutionPhase;
  ownerSkillId: string;
  status: "required" | "skipped";
  reason: string;
  skipReason?: string;
};

export type FrontendPhasePlan = {
  schemaVersion: "1.0";
  entries: FrontendPhasePlanEntry[];
  repairEntryPhase?: FrontendExecutionPhase;
  rejoinsAt: "evidence-capture";
};
```

`phases.json` fixes the phase order and owners. Implementation owner selection is `frontend.design-to-code` when canonical intent is design-to-code, otherwise `frontend.tailwind-ui-polish` for Tailwind evidence, otherwise `frontend.react-component-design`. Motion is required only for motion intent or a direction with non-none motion. UX and design-system are required for material `explore/reimagine`, optional for bounded repair. Accessibility and final audit are always required for material work.

Map finding prefixes exactly: spacing/color/radii/shadow/card/typography/measure/touch layout implementation; flow/navigation/recovery to UX; token/theme/primitive to design-system; motion/reduced-motion to motion; aria/keyboard/focus/contrast/target to accessibility; unknown codes to final audit.

- [ ] **Step 4: Integrate phase ordering without changing recommendation scores**

Have `routing.compose` preserve scores but order selected companions by phase. Have `evaluateFrontendRunPolicy` attach the generated phase plan under `artifacts.phasePlan` only if the existing domain-neutral decision type gains an optional `artifacts?: Record<string, unknown>` field; this is additive and must not change current lifecycle transitions.

Run: `node --test tests/frontend-phase-routing.test.ts tests/frontend-run-policy.test.ts tests/frontend-intents.test.ts tests/recommender.test.ts && npm run build`

Expected: PASS; recommendation membership and scores remain unchanged while execution ordering is deterministic.

- [ ] **Step 5: Commit phase routing**

```bash
git add src/domains/frontend/phases.ts src/domains/frontend/routing.ts src/domains/frontend/run-policy.ts src/runtime/skill-run/types.ts domains/frontend/intents/phases.json domains/frontend/domain.manifest.json domains/frontend/README.md tests/frontend-phase-routing.test.ts tests/frontend-run-policy.test.ts
git commit -m "feat(frontend): route skills through owned execution phases"
```

---

### Task 4: Three visual MCP tools over canonical services

**Files:**
- Create: `src/mcp/tools/visual.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/tools/types.ts`
- Modify: `package.json`
- Test: `tests/mcp.visual-tools.test.ts`
- Test: `tests/mcp.test.ts`

**Interfaces:**
- Produces MCP tools `capture_ui_evidence`, `compare_design_variants`, and `verify_visual_result`.
- Consumes: `createUiEvidenceCapturePlan`, `executeUiEvidenceCapture`, `createVisualCriticInput`, `compareDesignVariants`, and `verifyVisualResult` from Plans 3–4.

- [ ] **Step 1: Write failing definition, delegation, and two-phase critic tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { callMcpTool, mcpTools } from "../src/mcp/tools.ts";
import { makeBundle, makeVerificationInput } from "./helpers/frontend-visual-fixtures.ts";

test("registers exactly the three visual tool names", () => {
  const names = mcpTools.map(({ name }) => name);
  for (const name of ["capture_ui_evidence", "compare_design_variants", "verify_visual_result"]) {
    assert.equal(names.filter((candidate) => candidate === name).length, 1);
  }
});

test("compare tool returns a critic exchange before validation", async () => {
  const result = await callMcpTool("compare_design_variants", {
    policyId: "p1", generatorActorId: "g1", criticActorId: "c1",
    candidates: [
      { variantId: "v1", directionPath: "v1.json", evidenceId: "e1", screenshotPaths: ["v1.png"] },
      { variantId: "v2", directionPath: "v2.json", evidenceId: "e2", screenshotPaths: ["v2.png"] },
    ],
  });
  assert.equal(result.isError, false);
  assert.equal((result.structuredContent as { status: string }).status, "critic-required");
});

test("visual verification delegates to the strict verifier", async () => {
  const args = makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:abc" }),
    recheckEvidence: makeBundle({ id: "e1", variantId: "v2", sourceIdentity: "git:abc", captures: [] }),
  });
  const { artifactExists: _artifactExists, ...serializableArgs } = args;
  const result = await callMcpTool("verify_visual_result", serializableArgs);
  assert.equal(result.isError, false);
  assert.equal((result.structuredContent as { outcome: string }).outcome, "failed");
});
```

- [ ] **Step 2: Run MCP tests and verify tools are unknown**

Run: `node --test tests/mcp.visual-tools.test.ts tests/mcp.test.ts`

Expected: FAIL because the three names are not registered.

- [ ] **Step 3: Implement thin definitions and handlers**

`capture_ui_evidence` input requires `brief`, `policy`, `evidenceId`, `variantId`, `sourceIdentity`, `baseUrl`, `commandTemplate`, and `outputDir`; optional `projectRoot`, `route`, and timeout. It resolves project/output paths, creates a capture plan, executes it, and returns the bundle.

`compare_design_variants` requires policy/generator/critic ids and two or three candidates. Without `criticReport`, return:

```ts
jsonToolResult({ status: "critic-required", criticInput: createVisualCriticInput(args) });
```

With `criticReport`, call `compareDesignVariants` and return `{ status: "compared", ...result }`.

`verify_visual_result` requires every canonical artifact consumed by `verifyVisualResult` and returns its `report`. Do not alias legacy `verify_frontend_result`; retain that tool for compatibility.

Add `critic-required` and `repair-scope-violation` to `McpToolErrorCode` only for thrown contract errors; an ordinary two-phase critic response is not an error.

- [ ] **Step 4: Register tools and run parity/syntax checks**

Import `visualToolDefinitions` and `visualToolHandlers` in `src/mcp/tools.ts`, append them once, and add `node --check src/mcp/tools/visual.ts` to `package.json`'s `check` script.

Run: `node --test tests/mcp.visual-tools.test.ts tests/mcp.test.ts tests/mcp.protocol.test.ts && npm run check && npm run build`

Expected: PASS; unknown-tool behavior remains unchanged for other names.

- [ ] **Step 5: Commit MCP integration**

```bash
git add src/mcp/tools/visual.ts src/mcp/tools.ts src/mcp/tools/types.ts package.json tests/mcp.visual-tools.test.ts tests/mcp.test.ts
git commit -m "feat(mcp): expose visual evidence comparison and verification"
```

## Plan Verification

Run:

```bash
npm run build
npm run check
node --test tests/registry.validation.test.ts tests/installer.codex.test.ts tests/lockfile.test.ts tests/skill-content-contracts.test.ts tests/design-skill-contracts.test.ts tests/frontend-phase-routing.test.ts tests/frontend-run-policy.test.ts tests/mcp.visual-tools.test.ts tests/mcp.test.ts tests/mcp.protocol.test.ts
npm run validate:registry
npm run lint:skills
npm run audit:registry
```

Expected: every command exits `0`; shared contracts install locally and affect integrity, each phase has one owner, and all three MCP tools delegate to canonical services.

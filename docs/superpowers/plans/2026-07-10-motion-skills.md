# Motion Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two evidence-led frontend motion skills that create and audit purposeful, product-specific animation without generic AI-style effects.

**Architecture:** Keep `frontend.interaction-polish` as the narrow component-state specialist. Add `frontend.motion-design` in the design lane for motion direction and implementation, and `frontend.motion-audit` in the QA lane for independent evidence-led review. Route broad motion-system and animation-audit intents to these skills, then cover the behavior with registry, routing, and eval seeds.

**Tech Stack:** TypeScript recommender, JSON skill manifests/eval suite, Markdown skills and references, Node test runner.

## Global Constraints

- Keep both packages instruction-only: no scripts, dependencies, network, shell, or writes.
- Preserve the user's existing changes to the four neighboring frontend manifests and `tests/recommender.test.ts`.
- Do not treat browser/screenshot-free motion work as verified; require reduced-motion, accessibility, and performance evidence.
- Reject generic animation defaults such as blanket scroll reveals, decorative loops, arbitrary bounce, and unmeasured effects.

---

### Task 1: Lock registry and routing behavior with failing tests

**Files:**
- Modify: `tests/registry.validation.test.ts`
- Modify: `tests/recommender.test.ts`
- Modify: `tests/cli.recommend.test.ts`
- Modify: `tests/mcp.test.ts`

**Interfaces:**
- Consumes: `loadLocalRegistry("registry")`, `recommendSkills(...)`, CLI/MCP recommend commands.
- Produces: tests that expect 17 curated skills and route broad motion design/audit requests to their dedicated packages while retaining component interaction routing.

- [ ] **Step 1: Write failing registry and routing tests**

Add assertions for the two exact registry IDs, generic motion-system intent selecting `frontend.motion-design`, motion review intent selecting `frontend.motion-audit`, and the existing drawer/toast intent retaining `frontend.interaction-polish`.

- [ ] **Step 2: Run the focused test file and verify RED**

Run: `node --test tests/recommender.test.ts tests/registry.validation.test.ts`

Expected: FAIL because neither motion skill is present and the curated registry still contains 15 skills.

### Task 2: Create the two curated motion packages

**Files:**
- Create: `registry/skills/frontend.motion-design/SKILL.md`
- Create: `registry/skills/frontend.motion-design/skill.manifest.json`
- Create: `registry/skills/frontend.motion-design/references/motion-quality.md`
- Create: `registry/skills/frontend.motion-audit/SKILL.md`
- Create: `registry/skills/frontend.motion-audit/skill.manifest.json`
- Create: `registry/skills/frontend.motion-audit/references/motion-quality.md`
- Modify: `registry/skills/frontend.interaction-polish/SKILL.md`

**Interfaces:**
- Produces `frontend.motion-design` in the `design` lane and `frontend.motion-audit` in the `qa` lane, both native for Codex and generic-agent-skills.
- Preserves `frontend.interaction-polish` as the specialist for a specific modal, drawer, menu, toast, or drag/drop state machine.

- [ ] **Step 1: Write Motion Design**

Specify a motion brief before implementation: user goal, audience, semantic job, source/target spatial relationship, movement grammar, frequency, interruption rule, reduced-motion equivalent, and measurable evidence. Include a CSS → Web Animations/View Transitions → library decision ladder and explicit anti-slop rejection gate.

- [ ] **Step 2: Write Motion Audit**

Require visual and runtime evidence, score purpose/context/consistency/accessibility/performance/annoyance, identify blocking violations, and output concrete fixes plus residual checks. Require repeated-use, reduced-motion, keyboard/pointer, narrow viewport, and performance-trace checks where relevant.

- [ ] **Step 3: Add concise shared research reference**

Record purpose-first motion, accessibility, performance, View Transition fallback, DevTools evidence, and a source list from W3C, MDN, web.dev, Apple HIG, and Fluent. Do not include code libraries as requirements.

- [ ] **Step 4: Narrow the older interaction skill boundary**

Add one explicit handoff rule from broad motion-system work to Motion Design and from independent motion review to Motion Audit, without changing the user's manifest edit.

### Task 3: Integrate intent routing and recommendation composition

**Files:**
- Modify: `src/recommender/index.ts`

**Interfaces:**
- `specializedIntentHints["frontend.motion-design"]` recognizes broad animation, motion direction/system, choreography, easing, page/view transitions, including Russian animation language.
- `specializedIntentHints["frontend.motion-audit"]` recognizes auditing/reviewing motion, reduced-motion checks, animation performance, and jank.
- `companionSkillIds` composes Motion Design and Motion Audit with accessibility/performance specialists; it does not displace `interaction-polish` on specific drawer/toast/drag requests.

- [ ] **Step 1: Implement the smallest routing addition**

Add the new hint entries and two companion maps. Keep concrete interaction hints on `frontend.interaction-polish`, but remove generic animation/motion/transition hints there so broad requests are unambiguous.

- [ ] **Step 2: Run focused tests and verify GREEN**

Run: `node --test tests/recommender.test.ts tests/registry.validation.test.ts tests/cli.recommend.test.ts tests/mcp.test.ts`

Expected: PASS after any exact full-list expectations are updated to include both new skills in their deterministic sorted order.

### Task 4: Add durable evaluation coverage and catalog documentation

**Files:**
- Modify: `evals/frontend/suite.json`
- Modify: `README.md`
- Modify: `docs/FRONTEND_SKILL_QUALITY.md`

**Interfaces:**
- Adds four trigger seeds: broad motion direction, product-specific motion language, motion audit, and a component-level interaction regression guard.
- Adds two `motion-quality` task seeds: one system-building task and one audit task, with screenshot, trace, and manual accessibility artifact expectations.
- Keeps `targetCounts.triggerPrompts` and `targetCounts.taskEvals` equal to their seeded totals.

- [ ] **Step 1: Add the failing eval-count and routing expectations**

Increase the suite target counts only with the actual new seeds, then run the eval validator to confirm it fails before the additions are complete.

- [ ] **Step 2: Add the six motion evaluation seeds**

Use assertions that reject decorative animation-only output, require product-specific motion briefs, reduced-motion equivalents, and browser/performance evidence.

- [ ] **Step 3: Update catalog docs**

Change the bundled skill count from 15 to 17 and document the boundary: visual design controls static direction, interaction polish controls local state transitions, Motion Design controls multi-surface motion language, and Motion Audit owns independent QA.

### Task 5: Validate and inspect the complete package

**Files:**
- Verify all created and modified files.

- [ ] **Step 1: Run registry and security gates**

Run: `npm run validate:registry && npm run audit:registry && npm run lint:skills`

Expected: each command exits 0 and both new skills are low-risk instruction-only packages.

- [ ] **Step 2: Run the routing eval and full test suite**

Run: `npm run eval:frontend -- --run-routing --project fixtures/next-react-ts --json && npm test && npm run check`

Expected: routing metrics pass all evaluated seeds, tests pass, and static syntax checks pass.

- [ ] **Step 3: Review working-tree ownership**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; user-owned changes remain intact and new work is limited to the motion skills and their integration.

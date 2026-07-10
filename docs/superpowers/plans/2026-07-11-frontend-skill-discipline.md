# Frontend Skill Discipline and Russian Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic Russian frontend routing, auditable skill-run execution, risk-based clarification, managed agent context, and verification enforcement without replacing supported agent runtimes.

**Architecture:** Locale packs normalize English and Russian prompts into canonical frontend intent tags. A domain-neutral runtime owns the skill-run state machine and atomic artifacts, while an optional frontend domain policy supplies clarification and QA requirements. Thin CLI and MCP adapters call the same services, and `setup` installs an idempotent managed `AGENTS.md` block that tells agents to use the lifecycle.

**Tech Stack:** TypeScript 6, Node.js 24 built-ins, Node test runner, existing SkillRanger domain/recommender/runtime/CLI/MCP modules, JSON workflow and eval artifacts.

## Global Constraints

- Do not add NLP, embeddings, morphology, or runtime dependencies.
- Preserve existing manifest, lockfile, `DesignBrief`, `DesignDirection`, and `VerificationReport` schema version `1.0` compatibility.
- Store raw prompts only when the caller explicitly opts in; default artifacts store SHA-256 intent digests and normalized goals.
- Never emit `verified` without mandatory skill reads, resolved clarification, and passed hard verification gates.
- Preserve user-authored `AGENTS.md` content outside SkillRanger managed markers; malformed markers are a hard error.
- Keep the lifecycle core domain-neutral; frontend-specific clarification logic must live in the frontend adapter.
- Use TDD for every task and commit only the files listed for that task.

---

### Task 1: Deterministic locale analyzer

**Files:**
- Create: `src/domains/frontend/intents/types.ts`
- Create: `src/domains/frontend/intents/en.ts`
- Create: `src/domains/frontend/intents/ru.ts`
- Create: `src/domains/frontend/intents/index.ts`
- Create: `tests/frontend-intents.test.ts`

**Interfaces:**
- Produces: `FrontendLocale`, `CanonicalFrontendIntent`, `FrontendIntentAnalysis`, `normalizeFrontendText(input)`, and `analyzeFrontendIntent(input)`.
- Consumes: no existing routing internals; this task is a standalone synchronous analyzer.

- [ ] **Step 1: Write failing normalization and classification tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeFrontendIntent, normalizeFrontendText } from "../src/domains/frontend/intents/index.ts";

test("normalizes Russian case, punctuation, and ё", () => {
  assert.equal(normalizeFrontendText("  ПРОВЕРЬ, всё Ёмкое!  "), "проверь все емкое");
});

test("maps Russian specialist requests to canonical intents", () => {
  assert.deepEqual(
    [...analyzeFrontendIntent("Проверь доступность: клавиатуру, фокус и контраст").intents],
    ["accessibility-review"],
  );
  assert.deepEqual(
    [...analyzeFrontendIntent("Страница тормозит, проверь LCP и размер бандла").intents],
    ["performance-review"],
  );
});

test("detects explicit skill-use control intent without inventing a task intent", () => {
  const analysis = analyzeFrontendIntent("Почему ты не используешь скиллы?");
  assert.deepEqual([...analysis.controlIntents], ["require-skill-lifecycle"]);
  assert.deepEqual([...analysis.intents], []);
});

test("reports mixed locale for Russian prompts containing frontend terms", () => {
  assert.equal(analyzeFrontendIntent("Используй frontend skill и проверь responsive layout").locale, "mixed");
});
```

- [ ] **Step 2: Run the focused test and confirm the missing module failure**

Run: `node --test tests/frontend-intents.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/domains/frontend/intents/index.ts`.

- [ ] **Step 3: Define the canonical types and locale-pack contract**

```ts
export type FrontendLocale = "en" | "ru" | "mixed" | "unknown";

export type CanonicalFrontendIntent =
  | "accessibility-review"
  | "audit"
  | "design-system"
  | "design-to-code"
  | "interaction-polish"
  | "motion-audit"
  | "motion-design"
  | "performance-review"
  | "tailwind-ui-polish"
  | "ux-critique"
  | "visual-design-polish";

export type FrontendControlIntent = "require-skill-lifecycle";

export type FrontendIntentAliasPack = {
  locale: "en" | "ru";
  intents: Record<CanonicalFrontendIntent, { tokens: string[]; phrases: string[] }>;
  controls: Record<FrontendControlIntent, string[]>;
};

export type FrontendIntentAnalysis = {
  locale: FrontendLocale;
  normalized: string;
  tokens: Set<string>;
  intents: Set<CanonicalFrontendIntent>;
  controlIntents: Set<FrontendControlIntent>;
};
```

- [ ] **Step 4: Add complete English and Russian alias packs**

Use these canonical Russian aliases; retain the current English tokens and phrases under the equivalent keys in `en.ts`:

```ts
export const ruFrontendIntentAliases: FrontendIntentAliasPack = {
  locale: "ru",
  intents: {
    "accessibility-review": {
      tokens: ["доступность", "клавиатура", "фокус", "контраст", "wcag", "aria"],
      phrases: ["доступный интерфейс", "проверить доступность", "скрин ридер", "ловушка фокуса"],
    },
    audit: {
      tokens: ["аудит", "релиз", "готовность"],
      phrases: ["финальный аудит фронтенда", "готовность к релизу", "можно ли выпускать", "проверка перед релизом"],
    },
    "design-system": {
      tokens: ["токены", "тема", "варианты"],
      phrases: ["дизайн система", "семантические токены", "темная тема", "жестко заданные цвета"],
    },
    "design-to-code": {
      tokens: ["figma", "макет", "мокап"],
      phrases: ["перенести дизайн в код", "реализовать по макету", "сверстать по скриншоту"],
    },
    "interaction-polish": {
      tokens: ["модалка", "тост", "дровер", "взаимодействие"],
      phrases: ["улучшить взаимодействие", "анимация модалки", "возврат фокуса", "состояния кнопки"],
    },
    "motion-audit": {
      tokens: ["джанк"],
      phrases: ["аудит анимаций", "проверить анимации", "производительность анимаций", "поддержка reduced motion"],
    },
    "motion-design": {
      tokens: ["анимация", "анимации", "переходы", "хореография", "моушн"],
      phrases: ["система анимаций", "дизайн движения", "переходы между страницами"],
    },
    "performance-review": {
      tokens: ["производительность", "медленно", "тормозит", "бандл", "lcp", "inp", "lighthouse"],
      phrases: ["проверить производительность", "размер бандла", "медленная страница", "долгая загрузка"],
    },
    "tailwind-ui-polish": {
      tokens: ["tailwind", "адаптив", "адаптивность", "отступы", "переполнение"],
      phrases: ["исправить мобильную версию", "починить адаптив", "классы tailwind", "ломается на мобильном"],
    },
    "ux-critique": {
      tokens: ["ux", "юзабилити", "сценарий", "онбординг"],
      phrases: ["критика пользовательского сценария", "непонятная навигация", "когнитивная нагрузка", "путь пользователя"],
    },
    "visual-design-polish": {
      tokens: ["дизайн", "редизайн", "ребрендинг", "современный", "визуал"],
      phrases: ["визуальное направление", "улучшить иерархию", "убрать типовой ai интерфейс", "освежить дизайн"],
    },
  },
  controls: {
    "require-skill-lifecycle": [
      "используй скиллы",
      "используй frontend скиллы",
      "используй фронтенд скиллы",
      "почему не используешь скиллы",
      "у тебя нет скиллов",
    ],
  },
};
```

- [ ] **Step 5: Implement normalization, locale detection, and deterministic alias matching**

```ts
export const normalizeFrontendText = (input: string) =>
  input
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}+.#-]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

export const analyzeFrontendIntent = (input: string): FrontendIntentAnalysis => {
  const normalized = normalizeFrontendText(input);
  const tokens = new Set(normalized.split(" ").filter(Boolean));
  const hasCyrillic = /[а-я]/u.test(normalized);
  const hasLatin = /[a-z]/u.test(normalized);
  const locale = hasCyrillic && hasLatin ? "mixed" : hasCyrillic ? "ru" : hasLatin ? "en" : "unknown";
  const intents = new Set<CanonicalFrontendIntent>();
  const controlIntents = new Set<FrontendControlIntent>();
  for (const pack of [enFrontendIntentAliases, ruFrontendIntentAliases]) {
    for (const [intent, aliases] of Object.entries(pack.intents) as Array<[CanonicalFrontendIntent, { tokens: string[]; phrases: string[] }]>) {
      if (aliases.tokens.some((token) => tokens.has(normalizeFrontendText(token))) || aliases.phrases.some((phrase) => normalized.includes(normalizeFrontendText(phrase)))) intents.add(intent);
    }
    for (const [control, phrases] of Object.entries(pack.controls) as Array<[FrontendControlIntent, string[]]>) {
      if (phrases.some((phrase) => normalized.includes(normalizeFrontendText(phrase)))) controlIntents.add(control);
    }
  }
  return { locale, normalized, tokens, intents, controlIntents };
};
```

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/frontend-intents.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 7: Commit the locale analyzer**

```bash
git add src/domains/frontend/intents tests/frontend-intents.test.ts
git commit -m "feat(frontend): add deterministic locale intent analysis"
```

### Task 2: Route canonical intents and freeze Russian eval coverage

**Files:**
- Modify: `src/domains/frontend/routing.ts`
- Modify: `evals/frontend/suite.json`
- Modify: `tests/domain-pack.test.ts`
- Modify: `tests/frontend-eval.test.ts`

**Interfaces:**
- Consumes: `analyzeFrontendIntent(intent)` from Task 1.
- Produces: unchanged `DomainRoutingPolicy`; English behavior remains compatible, while canonical tags drive specialist scoring and control-intent metadata is testable through the analyzer.

- [ ] **Step 1: Add failing routing tests for Russian specialist intents**

```ts
test("frontend routing selects Russian accessibility, performance, and audit intents", async () => {
  const cases = [
    ["Проверь доступность формы, клавиатуру, фокус и контраст", "frontend.accessibility-review"],
    ["Страница тормозит: проверь LCP, INP и размер бандла", "frontend.performance-review"],
    ["Сделай финальный аудит фронтенда перед релизом", "frontend.audit"],
  ] as const;
  for (const [intent, expected] of cases) {
    const recommendations = recommendSkills(fingerprint, skills, { domainId: "frontend", userIntent: intent, targetAgent: "opencode" });
    assert.equal(recommendations[0]?.skillId, expected);
  }
});
```

- [ ] **Step 2: Run the focused routing test and observe wrong or missing top skills**

Run: `node --test --test-name-pattern="Russian accessibility" tests/domain-pack.test.ts`

Expected: FAIL because the current specialized hints are predominantly English.

- [ ] **Step 3: Refactor `routing.ts` to score canonical intents**

Replace language-specific token collections in the specialist scorer with a skill-to-canonical-intent map:

```ts
const canonicalIntentBySkillId: Partial<Record<string, CanonicalFrontendIntent>> = {
  "frontend.accessibility-review": "accessibility-review",
  "frontend.audit": "audit",
  "frontend.design-system": "design-system",
  "frontend.design-to-code": "design-to-code",
  "frontend.interaction-polish": "interaction-polish",
  "frontend.motion-audit": "motion-audit",
  "frontend.motion-design": "motion-design",
  "frontend.performance-review": "performance-review",
  "frontend.tailwind-ui-polish": "tailwind-ui-polish",
  "frontend.ux-critique": "ux-critique",
  "frontend.visual-design-polish": "visual-design-polish",
};

const specializedIntentScore = (skill: RegistrySkill, intent?: string) => {
  if (!intent) return 0;
  const expected = canonicalIntentBySkillId[skill.manifest.id];
  return expected && analyzeFrontendIntent(intent).intents.has(expected) ? 1 : 0;
};
```

Retain English non-domain rejection and stack checks, but source all bilingual frontend design, audit, motion, accessibility, performance, interaction, Tailwind, UX, and design-system intent decisions from the analyzer.

- [ ] **Step 4: Expand the frozen suite with a deterministic Russian matrix**

For each of the 11 skills in `domains/frontend/domain.manifest.json` ownership, add exactly five trigger entries: three direct should-trigger prompts, one ambiguous prompt, and one non-trigger prompt. Use the aliases from Task 1 and these negative domains: database schema, backend API, CLI, SQL, and native Swift. Add Russian task-evals for visual direction, Tailwind execution, and release audit with assertions requiring skill announcement, clarification evidence when material, mobile/desktop screenshots, and verification outcome.

Update `targetCounts.triggerPrompts` from `102` to `157` and `targetCounts.taskEvals` from `51` to `54`.

- [ ] **Step 5: Add suite-shape assertions so Russian coverage cannot regress**

```ts
test("frontend suite freezes Russian routing coverage for every owned skill", async () => {
  const suite = await loadFrontendEvalSuite();
  const owned = new Set(frontendDomainManifest.ownership.flatMap((rule) => [rule.primarySkill, ...rule.supportingSkills]));
  for (const skillId of owned) {
    const prompts = suite.triggerPrompts.filter((prompt) => /[А-Яа-яЁё]/u.test(prompt.text) && (prompt.expectedSkill === skillId || prompt.routingExpected?.expectedSkill === skillId));
    assert.equal(prompts.filter((prompt) => prompt.kind === "should-trigger").length >= 3, true, skillId);
    assert.equal(prompts.filter((prompt) => prompt.kind === "ambiguous").length >= 1, true, skillId);
  }
  assert.equal(suite.taskBands.flatMap((band) => band.seedTasks).filter((task) => /[А-Яа-яЁё]/u.test(task.prompt)).length >= 3, true);
  const promoted = skills.filter((skill) => ["task-eval", "curated"].includes(skill.manifest.evaluation?.status ?? "none"));
  for (const skill of promoted) {
    const slice = suite.skillSlices?.find((item) => item.skillId === skill.manifest.id);
    const russianTaskIds = new Set(suite.taskBands.flatMap((band) => band.seedTasks).filter((task) => /[А-Яа-яЁё]/u.test(task.prompt)).map((task) => task.id));
    assert.equal(slice?.taskIds.some((taskId) => russianTaskIds.has(taskId)), true, `${skill.manifest.id} needs Russian task evidence`);
  }
});
```

- [ ] **Step 6: Run routing and suite tests**

Run: `node --test tests/frontend-intents.test.ts tests/domain-pack.test.ts tests/frontend-eval.test.ts`

Expected: PASS with no English routing regressions and 157/54 target counts accepted.

- [ ] **Step 7: Commit routing and eval coverage**

```bash
git add src/domains/frontend/routing.ts evals/frontend/suite.json tests/domain-pack.test.ts tests/frontend-eval.test.ts
git commit -m "feat(frontend): add Russian routing and eval coverage"
```

### Task 3: Core skill-run types and transition reducer

**Files:**
- Create: `schemas/skill-run.schema.json`
- Create: `src/runtime/skill-run/types.ts`
- Create: `src/runtime/skill-run/reducer.ts`
- Create: `src/runtime/skill-run/index.ts`
- Modify: `src/runtime/index.ts`
- Create: `tests/skill-run.test.ts`

**Interfaces:**
- Produces: `SkillRun`, `SkillRunState`, `SkillRunEvent`, `SkillRunPolicyDecision`, `SkillRunError`, `createSkillRun`, and `reduceSkillRun`.
- Consumes: `VerificationOutcome` and `VerificationFinding` from `src/runtime/types.ts`.

- [ ] **Step 1: Write failing state-machine tests**

```ts
const visualChecksum = `sha256:${"a".repeat(64)}`;
const a11yChecksum = `sha256:${"b".repeat(64)}`;
const fixtureSkills: SkillRunSkill[] = [
  { skillId: "frontend.visual-design-polish", role: "primary", version: "0.3.0", checksum: visualChecksum, mandatory: true },
  { skillId: "frontend.accessibility-review", role: "companion", version: "0.2.0", checksum: a11yChecksum, mandatory: true },
];
const fixtureInput: CreateSkillRunInput = {
  runId: "run_12345678",
  domain: "frontend",
  targetAgent: "opencode",
  locale: "ru",
  intent: { sha256: `sha256:${"c".repeat(64)}`, normalizedGoal: "редизайн лендинга" },
  policy: {
    lifecycleRequired: true,
    mandatorySkillIds: fixtureSkills.map((skill) => skill.skillId),
    clarification: { required: true, questions: [{ id: "primary-user", fields: ["primaryUserOrActor"], text: "Кто основной пользователь?" }] },
    verificationRequired: true,
  },
  now: "2026-07-11T00:00:00.000Z",
};
const fixtureAnswers = [{ questionId: "primary-user", answer: "Разработчик frontend-продукта" }];

test("skill run reaches verified only through the complete lifecycle", () => {
  let run = createSkillRun(fixtureInput);
  run = reduceSkillRun(run, { type: "select-skills", skills: fixtureSkills });
  run = reduceSkillRun(run, { type: "record-skill-read", skillId: "frontend.visual-design-polish", checksum: visualChecksum });
  run = reduceSkillRun(run, { type: "record-skill-read", skillId: "frontend.accessibility-review", checksum: a11yChecksum });
  run = reduceSkillRun(run, { type: "resolve-clarification", answers: fixtureAnswers, declinedFields: [], assumptions: [] });
  run = reduceSkillRun(run, { type: "start-execution" });
  run = reduceSkillRun(run, { type: "complete-execution", status: "implemented", artifacts: [{ kind: "implementation-diff", path: "diff.patch", description: "UI diff" }] });
  run = reduceSkillRun(run, { type: "record-verification", reportPath: ".design/verification.json", outcome: "verified", hardPassed: true, findings: [] });
  assert.equal(run.state, "verified");
});

test("rejects verification with unread mandatory skills", () => {
  const corruptedImplemented = { ...createSkillRun(fixtureInput), state: "implemented", selectedSkills: fixtureSkills, skillReads: [] } as SkillRun;
  assert.throws(
    () => reduceSkillRun(corruptedImplemented, { type: "record-verification", reportPath: ".design/verification.json", outcome: "verified", hardPassed: true, findings: [] }),
    (error: unknown) => error instanceof SkillRunError && error.code === "mandatory-skill-unread",
  );
});
```

- [ ] **Step 2: Run the focused tests and confirm missing exports**

Run: `node --test tests/skill-run.test.ts`

Expected: FAIL with missing `src/runtime/skill-run/index.ts`.

- [ ] **Step 3: Define the exact run contract and discriminated event union**

```ts
export type SkillRunState = "created" | "skills-selected" | "skills-read" | "clarified" | "running" | "implemented" | "verified" | "implemented-unverified" | "failed" | "blocked";
export type SkillRunLocale = "en" | "ru" | "mixed" | "unknown";
export type SkillRunErrorCode = "invalid-transition" | "mandatory-skill-unread" | "stale-skill-checksum" | "clarification-required" | "verification-blocked" | "run-integrity";

export type SkillRunPolicyDecision = {
  lifecycleRequired: boolean;
  mandatorySkillIds: string[];
  clarification: { required: boolean; questions: Array<{ id: string; fields: string[]; text: string }> };
  verificationRequired: boolean;
};

export type SkillRunSkill = { skillId: string; role: "primary" | "companion"; version: string; checksum: string; mandatory: boolean };

export type CreateSkillRunInput = {
  runId: string;
  domain: string;
  targetAgent: string;
  locale: SkillRunLocale;
  intent: SkillRun["intent"];
  policy: SkillRunPolicyDecision;
  now?: string;
};

export type SkillRun = {
  schemaVersion: "1.0";
  runId: string;
  domain: string;
  targetAgent: string;
  locale: SkillRunLocale;
  state: SkillRunState;
  createdAt: string;
  updatedAt: string;
  intent: { sha256: string; normalizedGoal: string; raw?: string };
  policy: SkillRunPolicyDecision;
  recommendations: SkillRunSkill[];
  selectedSkills: SkillRunSkill[];
  skillReads: Array<{ skillId: string; version: string; checksum: string; recordedAt: string }>;
  clarification: { status: "not-required" | "pending" | "resolved" | "declined"; questions: SkillRunPolicyDecision["clarification"]["questions"]; answers: Array<{ questionId: string; answer: string }>; declinedFields: string[]; assumptions: string[] };
  artifacts: Array<{ kind: string; path?: string; description: string }>;
  verification?: { reportPath: string; outcome: VerificationOutcome; hardPassed: boolean; findings: VerificationFinding[] };
};
```

Add `schemas/skill-run.schema.json` as JSON Schema 2020-12 with `$id` `https://skillranger.local/schemas/skill-run.schema.json`, `schemaVersion` fixed to `1.0`, the exact required top-level fields from `SkillRun`, enum values copied from the TypeScript unions, SHA-256 values constrained by `^sha256:[a-f0-9]{64}$`, and `additionalProperties: false` at the top level and for every nested object. Add a schema-contract test that loads the file and asserts every required TypeScript field is present and terminal states are represented.

- [ ] **Step 4: Implement a pure reducer with explicit transition guards**

Each event handler must first assert its allowed source state, then return a new object with a fresh `updatedAt`. `record-skill-read` is idempotent only when version and checksum match the existing record. Transition to `skills-read` occurs only after every mandatory selected skill has a valid read record. `record-verification` accepts `verified` only when `hardPassed` is true; otherwise it returns `implemented-unverified` or throws `verification-blocked` for a falsely claimed verified outcome.

- [ ] **Step 5: Add negative tests for every skipped stage and conflicting repeat**

```ts
const toSkillsRead = () => {
  let run = reduceSkillRun(createSkillRun(fixtureInput), { type: "select-skills", skills: fixtureSkills });
  run = reduceSkillRun(run, { type: "record-skill-read", skillId: fixtureSkills[0].skillId, checksum: fixtureSkills[0].checksum });
  return reduceSkillRun(run, { type: "record-skill-read", skillId: fixtureSkills[1].skillId, checksum: fixtureSkills[1].checksum });
};
const skillsReadRun = toSkillsRead();
const clarifiedRun = reduceSkillRun(skillsReadRun, { type: "resolve-clarification", answers: fixtureAnswers, declinedFields: [], assumptions: [] });
const runningRun = reduceSkillRun(clarifiedRun, { type: "start-execution" });
const invalidTransitions: Array<[string, SkillRun, SkillRunEvent, SkillRunErrorCode]> = [
  ["cannot execute before clarification", skillsReadRun, { type: "start-execution" }, "clarification-required"],
  ["cannot complete before running", clarifiedRun, { type: "complete-execution", status: "implemented", artifacts: [] }, "invalid-transition"],
  ["cannot verify before implementation", runningRun, { type: "record-verification", reportPath: "report.json", outcome: "verified", hardPassed: true, findings: [] }, "invalid-transition"],
];
for (const [name, run, event, code] of invalidTransitions) test(name, () => assert.throws(() => reduceSkillRun(run, event), (error: unknown) => error instanceof SkillRunError && error.code === code));
```

Cover start-before-clarification, complete-before-running, checksum mismatch, omitted mandatory companion, duplicate conflicting answer, and verified report with failed hard gates.

- [ ] **Step 6: Run runtime tests and type-check**

Run: `node --test tests/skill-run.test.ts && npm run build`

Expected: PASS and TypeScript build exit 0.

- [ ] **Step 7: Commit the lifecycle reducer**

```bash
git add schemas/skill-run.schema.json src/runtime/skill-run src/runtime/index.ts tests/skill-run.test.ts
git commit -m "feat(runtime): add auditable skill run state machine"
```

### Task 4: Atomic run storage and lifecycle service

**Files:**
- Create: `src/runtime/skill-run/store.ts`
- Create: `src/runtime/skill-run/service.ts`
- Modify: `src/runtime/skill-run/index.ts`
- Modify: `tests/skill-run.test.ts`

**Interfaces:**
- Produces: `SkillRunStore`, `startSkillRun`, `recordSkillRead`, `resolveSkillRunClarifications`, `startSkillRunExecution`, `completeSkillRun`, and `verifySkillRun`.
- Consumes: pure reducer and types from Task 3.

- [ ] **Step 1: Write failing persistence and idempotency tests**

```ts
test("store writes atomically under .skillranger/runs and reloads the same run", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-run-"));
  const fixtureRun = createSkillRun(fixtureInput);
  const store = new SkillRunStore(projectRoot);
  await store.create(fixtureRun);
  assert.deepEqual(await store.read(fixtureRun.runId), fixtureRun);
  assert.equal((await readdir(path.join(projectRoot, ".skillranger/runs"))).some((name) => name.endsWith(".tmp")), false);
});

test("failed update preserves the previous valid run", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-run-"));
  const fixtureRun = createSkillRun(fixtureInput);
  const store = new SkillRunStore(projectRoot);
  await store.create(fixtureRun);
  const runId = fixtureRun.runId;
  const before = await store.read(runId);
  await assert.rejects(store.update(runId, () => { throw new SkillRunError("invalid-transition", "bad transition"); }));
  assert.deepEqual(await store.read(runId), before);
});
```

- [ ] **Step 2: Run the focused persistence tests**

Run: `node --test --test-name-pattern="store writes atomically|failed update" tests/skill-run.test.ts`

Expected: FAIL because `SkillRunStore` does not exist.

- [ ] **Step 3: Implement safe paths and atomic replacement**

```ts
const runIdPattern = /^[a-z0-9][a-z0-9_-]{7,127}$/;

export class SkillRunStore {
  constructor(private readonly projectRoot: string) {}
  private runPath(runId: string) {
    if (!runIdPattern.test(runId)) throw new SkillRunError("run-integrity", `Invalid run id: ${runId}`);
    return path.join(this.projectRoot, ".skillranger", "runs", `${runId}.json`);
  }
  async write(run: SkillRun) {
    const target = this.runPath(run.runId);
    const temporary = `${target}.${process.pid}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, target);
    return target;
  }
}
```

Implement `create`, `read`, and `update`; parse and validate `schemaVersion`, `runId`, and state before returning a stored artifact.

- [ ] **Step 4: Implement service functions as store-backed reducer calls**

```ts
export const recordSkillRead = (store: SkillRunStore, runId: string, input: { skillId: string; checksum: string }) =>
  store.update(runId, (run) => reduceSkillRun(run, { type: "record-skill-read", ...input }));
```

Apply the same pattern for clarification, execution, completion, and verification. `startSkillRun` hashes raw intent with `createHash("sha256")`, stores raw text only when `storeRawIntent` is true, creates the run, then applies `select-skills` before the first persisted artifact is returned.

- [ ] **Step 5: Run runtime tests**

Run: `node --test tests/skill-run.test.ts`

Expected: PASS for reducer, persistence, corruption, path escape, idempotency, and preservation cases.

- [ ] **Step 6: Commit storage and services**

```bash
git add src/runtime/skill-run tests/skill-run.test.ts
git commit -m "feat(runtime): persist skill runs atomically"
```

### Task 5: Frontend clarification and verification policy adapter

**Files:**
- Create: `src/domains/frontend/run-policy.ts`
- Modify: `src/domains/types.ts`
- Modify: `src/domains/frontend/routing.ts`
- Modify: `src/domains/frontend/design/index.ts`
- Create: `tests/frontend-run-policy.test.ts`

**Interfaces:**
- Produces: optional `runPolicy` on `DomainPack`, `DomainRunPolicy.evaluate(input)`, and `evaluateFrontendRunPolicy(input)`.
- Consumes: Task 1 intent analysis, `DesignBrief`, recommendations, and Task 3 `SkillRunPolicyDecision`.

- [ ] **Step 1: Write failing risk-classification tests**

```ts
const recommendation = (skillId: string, role: "primary" | "companion") => ({ skillId, role }) as Recommendation;
const visualRecommendations = [
  recommendation("frontend.visual-design-polish", "primary"),
  recommendation("frontend.accessibility-review", "companion"),
];
const tailwindRecommendations = [recommendation("frontend.tailwind-ui-polish", "primary")];

test("sparse Russian material redesign requires field-linked clarification", () => {
  const decision = evaluateFrontendRunPolicy({
    intent: "Сделай необычный редизайн лендинга и используй скиллы",
    recommendations: visualRecommendations,
  });
  assert.equal(decision.lifecycleRequired, true);
  assert.equal(decision.clarification.required, true);
  assert.deepEqual(decision.clarification.questions.flatMap((item) => item.fields), ["primaryUserOrActor", "primaryTask", "primaryAction"]);
  assert.equal(decision.clarification.questions.length <= 3, true);
});

test("bounded responsive repair records assumptions without blocking", () => {
  const decision = evaluateFrontendRunPolicy({ intent: "Почини overlap кнопки на 390px", recommendations: tailwindRecommendations });
  assert.equal(decision.clarification.required, false);
});
```

- [ ] **Step 2: Run the new policy tests**

Run: `node --test tests/frontend-run-policy.test.ts`

Expected: FAIL with missing `run-policy.ts`.

- [ ] **Step 3: Add the domain policy interface without changing existing packs**

```ts
export type DomainRunPolicyInput = {
  intent: string;
  recommendations: Recommendation[];
  artifacts?: Record<string, unknown>;
};

export type DomainRunPolicy = {
  evaluate(input: DomainRunPolicyInput): SkillRunPolicyDecision;
};

export type DomainPack = {
  manifest: DomainPackManifest;
  root: string;
  routing: DomainRoutingPolicy;
  runPolicy?: DomainRunPolicy;
};
```

Update registration to preserve an optional `runPolicy`, leaving existing domain registrations valid.

- [ ] **Step 4: Implement deterministic material-work and provenance rules**

Material skill ids are `frontend.visual-design-polish`, `frontend.design-to-code`, and `frontend.motion-design`. A new-build or redesign canonical intent also marks the task material. Treat missing briefs and the literal value `unknown` as unknown fields.

Use this question priority, capped at three:

1. `primaryUserOrActor`;
2. combined `primaryTask` and `primaryAction`;
3. `contentProvenance` only when the prompt mentions metrics, benchmarks, testimonials, quotes, brands, or their Russian aliases and no observed evidence entry has a source.

All composed recommendations are mandatory. `verificationRequired` is true when any selected skill declares verification capabilities or when the task is material. Explicit skill-control intent always sets `lifecycleRequired`.

- [ ] **Step 5: Test complete brief, declined clarification, and unsupported claims**

Add cases proving that a complete brief asks no redundant questions, declined material clarification records constrained assumptions, and unsupported metrics/testimonials remain a hard clarification requirement.

- [ ] **Step 6: Run policy and existing design runtime tests**

Run: `node --test tests/frontend-run-policy.test.ts tests/frontend-design-runtime.test.ts tests/domain-pack.test.ts`

Expected: PASS without changing design artifact schema `1.0` behavior.

- [ ] **Step 7: Commit the frontend adapter**

```bash
git add src/domains/types.ts src/domains/frontend/run-policy.ts src/domains/frontend/routing.ts src/domains/frontend/design/index.ts tests/frontend-run-policy.test.ts
git commit -m "feat(frontend): enforce risk-based clarification policy"
```

### Task 6: Add lifecycle CLI commands

**Files:**
- Create: `src/cli/runs.ts`
- Modify: `src/cli/index.ts`
- Create: `tests/cli.runs.test.ts`

**Interfaces:**
- Produces: `handleRunCliCommand(input): Promise<boolean>` and six public `run:*` commands.
- Consumes: registry loading, scanning, recommender, domain policy, and lifecycle services from Tasks 3-5.

- [ ] **Step 1: Write a failing end-to-end CLI lifecycle test**

```ts
test("CLI records a Russian OpenCode skill lifecycle and blocks premature verification", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-cli-run-"));
  const projectRoot = path.join(tmpRoot, "project");
  const verificationPath = path.join(tmpRoot, "verification.json");
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });
  await writeFile(verificationPath, JSON.stringify({
    schemaVersion: "1.0", domain: "frontend", workflowId: "frontend.design-generation", iteration: 0,
    capabilityStatus: "ready", executionStatus: "implemented", verificationStatus: "passed", outcome: "verified",
    findings: [], gates: { hardPassed: true, criticalFindings: 0, highFindings: 0 }, evidence: [], residualRisks: [],
  }));
  const started = JSON.parse((await execFileAsync(process.execPath, [
    "src/cli/index.ts", "run:start", projectRoot,
    "--target", "opencode", "--domain", "frontend",
    "--intent", "Сделай редизайн лендинга и используй скиллы", "--json",
  ])).stdout);
  assert.equal(started.run.targetAgent, "opencode");
  assert.equal(started.run.locale, "ru");
  assert.equal(started.run.state, "skills-selected");
  await assert.rejects(execFileAsync(process.execPath, [
    "src/cli/index.ts", "run:verify", projectRoot, "--run", started.run.runId,
    "--report", verificationPath, "--json",
  ]), /mandatory-skill-unread|invalid-transition/);
});
```

- [ ] **Step 2: Run the CLI test and confirm unknown command behavior**

Run: `node --test tests/cli.runs.test.ts`

Expected: FAIL because `run:start` is not registered.

- [ ] **Step 3: Implement a thin command handler with exact flags**

Support:

```text
run:start [project] --target <agent> --domain <id> --intent <text> [--brief <path>] [--store-intent] [--json]
run:record-read [project] --run <id> --skill <id> [--json]
run:resolve-clarifications [project] --run <id> --answers <json-path> [--json]
run:complete [project] --run <id> --status implemented|failed|blocked [--artifacts name=path,...] [--json]
run:verify [project] --run <id> --report <path> [--json]
run:inspect [project] --run <id> [--json]
```

`run:start` scans the project, loads the registry, calls `recommendSkills`, maps recommendations back to registry versions/checksums, evaluates the domain run policy, and creates the run. `run:record-read` takes the expected version/checksum from the selected snapshot; the command itself is the self-report that the file was read.

- [ ] **Step 4: Add machine-readable CLI error output**

When `--json` is present, lifecycle errors print `{ "ok": false, "error": { "code", "message", "remediation" } }` to stderr and exit 1. Human output prints the same code and remediation without a stack trace.

- [ ] **Step 5: Test the full successful sequence and raw-prompt opt-in**

The successful fixture must record all reads, resolve answers from a JSON file, complete implementation, verify against a passed report, and end in `verified`. Assert that raw intent is absent by default and present only with `--store-intent`.

- [ ] **Step 6: Run CLI tests and syntax checks**

Run: `node --test tests/cli.runs.test.ts tests/cli.recommend.test.ts && npm run check`

Expected: PASS and no regressions in existing CLI commands.

- [ ] **Step 7: Commit CLI lifecycle support**

```bash
git add src/cli/runs.ts src/cli/index.ts tests/cli.runs.test.ts
git commit -m "feat(cli): expose skill run lifecycle commands"
```

### Task 7: Add equivalent MCP lifecycle tools

**Files:**
- Create: `src/mcp/tools/runs.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/tools/types.ts`
- Modify: `tests/mcp.test.ts`

**Interfaces:**
- Produces MCP tools: `start_skill_run`, `record_skill_read`, `resolve_skill_run_clarifications`, `complete_skill_run`, `verify_skill_run`, and `inspect_skill_run`.
- Consumes the same services used by Task 6; MCP handlers must not duplicate transition logic.

- [ ] **Step 1: Write failing MCP definition and parity tests**

```ts
test("MCP exposes the complete skill run lifecycle", () => {
  const names = new Set(mcpTools.map((tool) => tool.name));
  for (const name of ["start_skill_run", "record_skill_read", "resolve_skill_run_clarifications", "complete_skill_run", "verify_skill_run", "inspect_skill_run"]) assert.equal(names.has(name), true, name);
});

test("MCP and CLI produce equivalent run states", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-mcp-run-"));
  await cp("fixtures/next-react-ts", projectRoot, { recursive: true });
  const startArgs = { projectRoot, targetAgent: "opencode", domain: "frontend", intent: "Проверь доступность формы и используй скиллы" };
  const cliRun = JSON.parse((await execFileAsync(process.execPath, [
    "src/cli/index.ts", "run:start", projectRoot, "--target", "opencode", "--domain", "frontend", "--intent", startArgs.intent, "--json",
  ])).stdout).run;
  const pickRunContract = (value: SkillRun) => ({
    domain: value.domain,
    targetAgent: value.targetAgent,
    locale: value.locale,
    state: value.state,
    policy: value.policy,
    selectedSkills: value.selectedSkills.map(({ skillId, role, version, checksum, mandatory }) => ({ skillId, role, version, checksum, mandatory })),
  });
  const result = await callMcpTool("start_skill_run", startArgs);
  assert.equal(result.isError, false);
  assert.deepEqual(pickRunContract(result.structuredContent), pickRunContract(cliRun));
});
```

- [ ] **Step 2: Run MCP tests and confirm missing definitions**

Run: `node --test --test-name-pattern="complete skill run lifecycle|equivalent run states" tests/mcp.test.ts`

Expected: FAIL because the new tools do not exist.

- [ ] **Step 3: Implement definitions and handlers around shared services**

Every tool uses JSON-native arrays and objects rather than CLI string encodings. Return the updated `SkillRun` in `structuredContent` and a concise state summary in text content.

- [ ] **Step 4: Extend typed MCP errors**

Add `run-not-found`, `invalid-transition`, `run-integrity`, `clarification-required`, and `verification-blocked` to `McpToolErrorCode`. Map `SkillRunError.code` deterministically in the run handlers.

- [ ] **Step 5: Run MCP and protocol tests**

Run: `node --test tests/mcp.test.ts tests/mcp.protocol.test.ts tests/cli.mcp.test.ts && npm run check`

Expected: PASS and the server advertises all six lifecycle tools.

- [ ] **Step 6: Commit MCP parity**

```bash
git add src/mcp/tools/runs.ts src/mcp/tools.ts src/mcp/tools/types.ts tests/mcp.test.ts
git commit -m "feat(mcp): expose skill run lifecycle tools"
```

### Task 8: Install an idempotent managed `AGENTS.md` block

**Files:**
- Create: `src/installers/agent-context.ts`
- Modify: `src/cli/index.ts`
- Modify: `tests/cli.setup.test.ts`
- Create: `tests/agent-context.test.ts`

**Interfaces:**
- Produces: `renderSkillRangerAgentBlock()`, `planSkillRangerAgentContext(projectRoot)`, and `upsertSkillRangerAgentContext(projectRoot)`.
- Consumes: successful `setup` flow; does not alter individual agent adapters.

- [ ] **Step 1: Write failing managed-block tests**

```ts
test("creates and idempotently updates the SkillRanger AGENTS block", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-agent-context-"));
  await upsertSkillRangerAgentContext(projectRoot);
  await upsertSkillRangerAgentContext(projectRoot);
  const text = await readFile(path.join(projectRoot, "AGENTS.md"), "utf8");
  assert.equal(text.match(/<!-- SKILLRANGER_START -->/g)?.length, 1);
  assert.equal(text.match(/<!-- SKILLRANGER_END -->/g)?.length, 1);
  assert.match(text, /run:start/);
  assert.match(text, /Do not claim `verified`/);
});

test("preserves user text and rejects malformed marker pairs", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "skillranger-agent-context-"));
  const agentPath = path.join(projectRoot, "AGENTS.md");
  await writeFile(agentPath, "# User rules\n\nKeep this.\n<!-- SKILLRANGER_START -->\nbroken\n");
  await assert.rejects(upsertSkillRangerAgentContext(projectRoot), /malformed SkillRanger markers/);
  assert.equal(await readFile(agentPath, "utf8"), "# User rules\n\nKeep this.\n<!-- SKILLRANGER_START -->\nbroken\n");
});
```

- [ ] **Step 2: Run the managed-context tests**

Run: `node --test tests/agent-context.test.ts`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement stable markers and atomic update**

Use exactly:

```text
<!-- SKILLRANGER_START -->
## SkillRanger lifecycle
Before skill-driven work, run `skillranger run:start`, announce the selected primary and companion skills, and record every required SKILL.md read. Resolve required clarifications before implementation. Do not claim `verified` unless `skillranger run:verify` returns the verified outcome.
<!-- SKILLRANGER_END -->
```

Create a new file with a trailing newline when absent. Replace only the inclusive managed range when both markers occur once in the correct order. Reject missing pairs, duplicates, or reversed markers. Use the same temporary-file-and-rename pattern as the run store.

- [ ] **Step 4: Integrate setup default and opt-out**

After all selected skill installs succeed, call the updater once for repo scope unless `--no-agent-context` is set. Include `AGENTS.md` in setup plan/output. Do not write project `AGENTS.md` for user-scope installs.

- [ ] **Step 5: Extend setup tests**

Assert default creation for OpenCode/Codex repo setup, preservation of an existing user preamble, no duplicate block after rerun, no file with `--no-agent-context`, and no project file for user scope.

- [ ] **Step 6: Run installer and setup tests**

Run: `node --test tests/agent-context.test.ts tests/cli.setup.test.ts tests/installer.codex.test.ts`

Expected: PASS with unchanged skill installation behavior.

- [ ] **Step 7: Commit managed agent context**

```bash
git add src/installers/agent-context.ts src/cli/index.ts tests/agent-context.test.ts tests/cli.setup.test.ts
git commit -m "feat(setup): install SkillRanger agent lifecycle context"
```

### Task 9: Release gates, Russian comparison profile, and documentation

**Files:**
- Modify: `package.json`
- Modify: `docs/FRONTEND_SKILL_QUALITY.md`
- Modify: `docs/workflow-runtime.md`
- Modify: `docs/mcp-host-config.md`
- Modify: `docs/TESTING.md`
- Modify: `domains/frontend/README.md`
- Modify: `tests/frontend-eval.test.ts`

**Interfaces:**
- Produces documented lifecycle commands, guarantee boundary, Russian eval policy, and release commands.
- Consumes all implementation tasks and existing repeated frontend eval runner.

- [ ] **Step 1: Add a failing release-contract test**

```ts
test("release check includes bilingual frontend routing evidence", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(packageJson.scripts["release:check"], /eval:frontend/);
  assert.match(packageJson.scripts["release:check"], /locale ru/);
});
```

- [ ] **Step 2: Run the release-contract test**

Run: `node --test --test-name-pattern="bilingual frontend routing evidence" tests/frontend-eval.test.ts`

Expected: FAIL because release checks have no Russian slice flag.

- [ ] **Step 3: Add locale filtering to frontend eval commands**

Support `eval:frontend --locale en|ru|all` in suite summary and routing execution. `ru` selects prompts containing Cyrillic, `en` selects prompts without Cyrillic, and `all` remains the default. Add `npm run eval:frontend:ru` and invoke it from `release:check` after the existing complete routing run.

- [ ] **Step 4: Document the repeated OpenCode comparison profile**

Specify one fixture, the frozen Russian task slice, the same installed skill versions/checksums, `opencode` target, at least three repetitions per model, and separate GLM/DeepSeek labels. Document that external model evidence is analytical and does not block local build/test.

- [ ] **Step 5: Document lifecycle guarantees and recovery**

Include CLI and MCP examples, run artifact location, raw-prompt privacy default, clarification fallback, `AGENTS.md` opt-out, corrupt-run recovery, and the explicit statement that external agents may bypass SkillRanger but cannot receive a SkillRanger `verified` outcome without evidence.

- [ ] **Step 6: Run the full release gate**

Run: `npm run release:check`

Expected: exit 0; TypeScript build, syntax checks, all tests, registry validation, skill lint, registry audit, full frontend routing, and Russian routing slice all pass.

- [ ] **Step 7: Inspect the final diff for accidental artifacts**

Run: `git status --short && git diff --check`

Expected: only Task 9 documentation, package script, and intended test changes are unstaged; `.playwright-cli/` and `output/` remain unrelated and must not be staged.

- [ ] **Step 8: Commit release integration and docs**

```bash
git add package.json docs/FRONTEND_SKILL_QUALITY.md docs/workflow-runtime.md docs/mcp-host-config.md docs/TESTING.md domains/frontend/README.md tests/frontend-eval.test.ts
git commit -m "docs: publish frontend skill lifecycle and Russian eval gates"
```

## Final Acceptance

- [ ] Run `npm run release:check` from a clean process and confirm exit 0.
- [ ] Run one CLI lifecycle smoke in a temporary OpenCode-targeted fixture and confirm the final artifact is `verified` only after reads, clarification, implementation, and verification.
- [ ] Run the equivalent MCP event sequence and compare normalized run artifacts.
- [ ] Run `skillranger setup` twice in a temporary repo and confirm exactly one managed `AGENTS.md` block with preserved user text.
- [ ] Run the Russian routing slice and confirm every frontend-owned skill meets the frozen prompt minimum.
- [ ] Confirm `git status --short` contains no implementation artifacts outside the intended files.

# Architecture

This document describes the core system design, scanner, ranking, CLI/MCP surfaces, installer targets, recommended stack, and project layout.

## 3. Архитектура

Компоненты:

```text
User / AI Agent
   |
   | CLI or MCP tool call
   v
SkillRanger Core
   |
   |-- Project Scanner
   |-- Skill Registry
   |-- Recommender / Ranker
   |-- Skill Auditor
   |-- Installer Adapters
   |-- Lockfile Manager
   |-- Skill Generator Pipeline
   |-- Config / Policy Engine
```

### Universal Prompt Router

The opt-in router is an orchestration layer over existing core services, not a second recommender or runtime:

```text
explicit MCP trigger or direct CLI task
-> trigger parser and privacy-safe task analyzer
-> project fingerprint and bundled domain metadata
-> shared scorer, domain resolver, and bounded composer
-> clarification / decomposition / no-match, or atomic prepared run
-> integrity-pinned progressive skill reads
-> lifecycle v1 or strict v2 runtime
```

Production CLI and MCP flows use the bundled trusted registry. Synthetic packs are dependency-injected data fixtures for tests and evals only. Routing performs no network calls, package installation, scripts, child processes, or application edits.

MCP fixes one canonical project root at server startup from `SKILLRANGER_PROJECT_ROOT` or `cwd`; router tool inputs cannot override it. CLI `task` uses direct activation and a positional root. MCP `prepare_task` requires an explicit terminal trigger. Both surfaces call the same `prepareTask()` core service.

A successful preparation atomically writes a router sidecar at `.skillranger/runs/router/<router-run-id>.json` and one existing runtime record. A write-ahead journal recovers interrupted cross-store creates and read-ledger bridges. Clarification, decomposition, no-match, strict failure, and budget failure create no partial run.

The source inventory pins package, root, file, and chunk checksums. `mandatory-next` controls order and bridges completed reads into the authoritative runtime ledger; optional files are selected only from the persisted inventory after mandatory reads and within a separate byte budget. Strict routing is installed-only and retains strict v2 evidence and finalization guarantees.

### CLI

Human-facing interface:

- first run;
- scan;
- recommendations;
- install dry-run;
- audit;
- doctor;
- update registry.

### MCP server

Agent-facing interface. Its 33 tools cover project analysis and recommendation, audited install planning and confirmed application, domain/design workflows, lifecycle v1, strict v2, visual evidence, and the Universal Router tools `prepare_task` and `read_run_skill_file`.

MCP tools should call the same core modules as CLI. Do not duplicate logic.

### Local skill registry

For MVP:

- local JSON files;
- curated skill manifests;
- skill source folders;
- checksums;
- registry schema validation.

Later:

- SQLite;
- remote sync;
- signed registry snapshots;
- private team registry.

### Remote / curated registry

Not in MVP as a dependency. Add later as optional:

- pinned registry version;
- HTTPS;
- signed metadata;
- content-addressed skill archives;
- provenance and publisher identity.

### Project scanner

Reads project files, computes fingerprint and evidence.

### Recommender / ranker

Scores skills against:

- project stack;
- user intent;
- task tags;
- compatibility;
- quality;
- security;
- freshness;
- conflicts;
- duplicates.

### Skill installer

Adapter-based:

- Codex;
- Claude Code;
- Cursor;
- OpenCode;
- generic `.agents/skills`;
- project-local vs user-global.

### Skill auditor

Static analysis and policy evaluation:

- hidden files;
- binary files;
- script commands;
- network calls;
- secret-looking strings;
- dangerous shell patterns;
- unexpected install paths;
- permissions declared vs actual content.

### Skill generator

Later phase. Creates drafts only:

- no trusted status;
- no auto-install as trusted;
- must pass audit/eval/human review.

### Config system

`skillranger.config.json`:

- registry sources;
- default target agent;
- install scope;
- allowed risk levels;
- allowlist/denylist;
- policy gates.

### Lockfile / manifest

`skillranger.lock.json` records:

- installed skill id;
- version;
- checksum;
- source;
- install target;
- installed path;
- audit result;
- timestamp;
- installer adapter.

### Optional UI/dashboard

Not MVP. Later:

- browse installed skills;
- compare recommendations;
- visualize project fingerprint;
- inspect risk findings;
- manage registry policies.

## 4. Project scanner

The scanner should be deterministic and evidence-based. It should not merely ask an LLM to guess.

Inputs to inspect:

- `package.json`
- package manager lockfiles: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`
- `tsconfig.json`
- `next.config.js/ts/mjs`
- `vite.config.js/ts`
- `tailwind.config.js/ts`
- `postcss.config.*`
- ESLint config
- Prettier config
- test config: Vitest, Jest, Playwright, Cypress
- folder structure: `app/`, `pages/`, `src/`, `components/`, `server/`, `api/`, `packages/`
- `AGENTS.md`
- `CLAUDE.md`
- `.agents/skills`
- `.claude/skills`
- `.cursor/rules` or equivalent Cursor config if present
- `README.md`
- CI workflows
- dependencies and devDependencies

Detection categories:

- project type: frontend, backend, fullstack, mobile, desktop, data, ML/AI, DevOps, security, QA, docs, game, embedded, library, CLI, monorepo
- frameworks: Next.js, Vite, Remix, Astro, Expo, React Native, Express, Fastify, NestJS
- language: TypeScript, JavaScript, Python, Go, Rust, Swift, Kotlin, Java, C#, C/C++, Ruby, PHP, SQL, shell
- styling: Tailwind, CSS modules, styled-components, shadcn/ui, MUI
- testing: Vitest, Jest, Playwright, Cypress, Testing Library
- infrastructure: Docker, Kubernetes, Terraform, Pulumi, CI/CD, cloud provider configs
- data systems: Postgres, MySQL, SQLite, MongoDB, Redis, dbt, Airflow
- AI/ML systems: OpenAI/Anthropic SDKs, LangChain/LlamaIndex, evals, RAG, vector DBs
- security posture: auth, secrets, dependency audit, SAST config, threat-model docs
- design system: known component library or custom
- agent context: AGENTS.md, skills, rules, MCP configs
- maturity: tests present, CI present, docs present

Example JSON fingerprint for Next.js + React + TypeScript:

```json
{
  "schemaVersion": "1.0",
  "root": "/path/to/project",
  "packageManager": {
    "name": "pnpm",
    "confidence": 0.92,
    "evidence": ["pnpm-lock.yaml"]
  },
  "projectTypes": [
    { "type": "frontend", "confidence": 0.96 },
    { "type": "web-app", "confidence": 0.94 },
    { "type": "fullstack", "confidence": 0.55 }
  ],
  "languages": [
    { "name": "typescript", "confidence": 0.98, "evidence": ["tsconfig.json", "*.tsx"] }
  ],
  "frameworks": [
    {
      "name": "nextjs",
      "versionRange": "15.x",
      "confidence": 0.96,
      "evidence": ["next.config.ts", "dependencies.next"]
    },
    {
      "name": "react",
      "versionRange": "19.x",
      "confidence": 0.98,
      "evidence": ["dependencies.react"]
    }
  ],
  "styling": [
    {
      "name": "tailwindcss",
      "confidence": 0.88,
      "evidence": ["tailwind.config.ts", "dependencies.tailwindcss"]
    }
  ],
  "testing": [
    {
      "name": "vitest",
      "type": "unit",
      "confidence": 0.76,
      "evidence": ["devDependencies.vitest"]
    },
    {
      "name": "playwright",
      "type": "e2e",
      "confidence": 0.7,
      "evidence": ["playwright.config.ts"]
    }
  ],
  "agentContext": {
    "agentsMd": {
      "present": true,
      "paths": ["AGENTS.md"]
    },
    "codexSkills": {
      "present": false,
      "paths": []
    },
    "claudeSkills": {
      "present": false,
      "paths": []
    }
  },
  "signals": [
    "package.json",
    "next.config.ts",
    "tsconfig.json",
    "app/",
    "components/",
    "tailwind.config.ts"
  ],
  "warnings": [
    "No repo-local frontend review skill found",
    "No explicit accessibility workflow found"
  ]
}
```

## 6. Skill recommendation algorithm

Initial ranking formula:

```text
score =
  0.30 * stackMatch
+ 0.20 * userIntentMatch
+ 0.15 * qualityScore
+ 0.15 * securityScore
+ 0.08 * freshnessScore
+ 0.07 * compatibilityScore
- 0.02 * duplicatePenalty
+ laneAdjustment
+ skillAdjustment
```

Score details:

- `stackMatch`: overlap between project fingerprint and skill `stackTags`.
- `userIntentMatch`: match against query like "mobile development", "frontend polish", "security review".
- `qualityScore`: manual/eval score.
- `securityScore`: output of audit pipeline.
- `freshnessScore`: last reviewed date and framework version support.
- `compatibilityScore`: whether skill supports selected target agent.
- `duplicatePenalty`: near-duplicate skill already installed or recommended.
- `laneAdjustment`: small boost or penalty when user intent explicitly points to a lane such as design.
- `skillAdjustment`: specialized intent boost or penalty for narrow skills such as Playwright debugging or visual design polish.

Use different approaches at different maturity stages:

- Rule-based matching for MVP. It is predictable and testable.
- Embeddings later for fuzzy intent search.
- LLM reranking only for explanation, ambiguity resolution, or generated packs.
- Manual curated packs for high-confidence recommendations.

MVP should prefer:

- deterministic results;
- golden tests;
- clear explanation strings;
- no opaque "AI magic" in install decisions.

Recommendations carry routing metadata for lane-aware rendering. Current lanes are `framework`, `design`, `implementation`, `qa`, and `agent-context`. Callers can filter to one lane, such as design-only workflows, or cap each lane with `limitPerLane` to avoid one lane crowding out the rest. Each recommendation also carries `scoreBreakdown` so CLI, MCP hosts, and tests can explain stack match, intent match, quality, security, freshness, compatibility, duplicate penalty, and intent adjustments explicitly.

## 7. MCP tools

### `analyze_project(path)`

Input:

```json
{ "path": "/path/to/project" }
```

Output:

```json
{
  "fingerprint": {},
  "warnings": [],
  "evidence": []
}
```

Side effects: none.

Security concerns:

- path traversal;
- reading secrets accidentally;
- scanning outside allowed root.

User should see:

- detected stack;
- confidence;
- evidence files;
- warnings.

### `recommend_skills(projectRoot, userIntent?)`

Input:

```json
{
  "projectRoot": "/path/to/project",
  "registryRoot": "registry",
  "userIntent": "visual design polish",
  "targetAgent": "codex",
  "lane": "design",
  "limitPerLane": 2
}
```

`lane` is optional and must be one of `framework`, `design`, `implementation`, `qa`, or `agent-context`. `limitPerLane` is optional and must be a positive integer.

Output:

```json
{
  "projectRoot": "/path/to/project",
  "targetAgent": "codex",
  "recommendations": [
    {
      "skillId": "frontend.visual-design-polish",
      "displayName": "Visual Design Polish",
      "lane": "design",
      "category": "visual-design-polish",
      "score": 0.825,
      "riskLevel": "low",
      "reasons": ["frontend detected", "react detected", "supports codex"]
    }
  ],
  "recommendationGroups": [
    {
      "lane": "design",
      "recommendations": [
        { "skillId": "frontend.visual-design-polish", "lane": "design", "score": 0.825 }
      ]
    }
  ]
}
```


Side effects: none.

Security concerns:

- should not fetch/install silently;
- should not trust remote registry by default.

User should see:

- ranked list;
- short explanation;
- risk;
- install command.

### `install_skills(skillIds, targetAgent, scope)`

Input:

```json
{
  "skillIds": ["frontend.next-app-router-review"],
  "targetAgent": "codex",
  "scope": "repo",
  "dryRun": true
}
```

Output:

```json
{
  "plan": {
    "writes": [".agents/skills/next-app-router-review/SKILL.md"],
    "lockfileUpdates": ["skillranger.lock.json"],
    "warnings": []
  }
}
```

Side effects:

- dry-run: none;
- apply: writes skill files and lockfile.

Security concerns:

- must require confirmation for third-party skills;
- must verify checksum;
- must not execute scripts;
- must not write outside target scope.

User should see:

- exact files to be written;
- source;
- checksum;
- risk;
- confirmation prompt.

### `audit_skill(skillId)`

Input:

```json
{ "skillId": "frontend.next-app-router-review" }
```

Output:

```json
{
  "riskLevel": "low",
  "securityScore": 0.93,
  "findings": [],
  "checksum": "sha256:..."
}
```

Side effects: none.

Security concerns:

- audit should inspect content, not only metadata;
- false negatives must be treated seriously.

User should see:

- risk summary;
- findings;
- blocked conditions if any.

### `generate_skill_from_goal(goal, targetAgent)`

Input:

```json
{
  "goal": "mobile development skills for React Native Expo",
  "targetAgent": "codex"
}
```

Output:

```json
{
  "draftSkillPath": "./drafts/expo-mobile-workflow",
  "status": "draft-untrusted",
  "nextSteps": ["audit", "eval", "human-review"]
}
```

Side effects:

- writes draft files only if user requested generation.

Security concerns:

- generated content is untrusted;
- no auto-publish;
- no auto-install as trusted.

User should see:

- draft status;
- audit warnings;
- review checklist.

### Other tools

`list_installed_skills(targetAgent)`:

- reads known agent locations;
- returns installed skills and lockfile state.

`update_registry()`:

- for MVP local only;
- later remote fetch with signature/checksum verification.

`explain_recommendation(skillId)`:

- returns matched tags, project signals, conflicts, risk notes.

## 8. CLI commands

Commands:

```bash
skillranger init
skillranger scan
skillranger recommend
skillranger install
skillranger audit
skillranger generate
skillranger list
skillranger update
skillranger doctor
```

Example UX flow for first run in Next.js project:

```bash
$ skillranger init
Created skillranger.config.json
Created registry cache at .skillranger/registry

$ skillranger scan
Detected:
- Next.js: high confidence
- React: high confidence
- TypeScript: high confidence
- Tailwind: medium confidence
- Playwright: medium confidence

$ skillranger recommend --target codex --lane design --limit-per-lane 2
Recommended:

design:
1. frontend.tailwind-ui-polish      score 0.825  risk low
2. frontend.visual-design-polish    score 0.825  risk low

$ skillranger install frontend.next-app-router-review --target codex --scope repo --dry-run
Would write:
- .agents/skills/next-app-router-review/SKILL.md
- skillranger.lock.json

$ skillranger install frontend.next-app-router-review --target codex --scope repo
Install? yes
Installed and locked frontend.next-app-router-review@0.1.0
```

## 9. Installer targets

Use adapter-based architecture.

```ts
interface AgentAdapter {
  id: string;
  detect(projectRoot: string): Promise<DetectionResult>;
  planInstall(input: InstallInput): Promise<InstallPlan>;
  applyInstall(plan: InstallPlan): Promise<InstallResult>;
  listInstalled(scope: InstallScope): Promise<InstalledSkill[]>;
  uninstall(skillId: string, scope: InstallScope): Promise<UninstallResult>;
  validate(): Promise<AdapterHealth>;
}
```

### Codex

Targets:

- repo scope: `.agents/skills/<skill-name>/SKILL.md`
- user scope: `~/.agents/skills/<skill-name>/SKILL.md`
- plugin distribution later via `.codex-plugin/plugin.json` and marketplace entries.

Notes:

- Codex supports Agent Skills with progressive disclosure.
- Codex skills need `name` and `description`.
- For reusable distribution, Codex plugins are the better package format.

### Claude Code

Targets:

- project scope: `.claude/skills/<skill-name>/SKILL.md`
- personal scope: `~/.claude/skills/<skill-name>/SKILL.md`
- plugin scope: `<plugin>/skills/<skill-name>/SKILL.md`

Notes:

- Claude Code follows Agent Skills open standard but adds fields like invocation control, subagent execution, dynamic context injection, and tool controls.
- Adapter must not blindly emit Claude-specific fields for Codex.

### Cursor

Targets depend on current Cursor support:

- `.cursor/rules`
- MCP config
- project docs/rules
- possible future Agent Skills-compatible target.

MVP should not claim full Cursor skill installation unless verified. Treat Cursor as later adapter.

### OpenCode

Use official docs when implementing adapter. For MVP, only define adapter interface and leave implementation pending.

### Generic `.agents/skills`

Target:

- `.agents/skills/<skill-name>/SKILL.md`
- `~/.agents/skills/<skill-name>/SKILL.md`

This is the best cross-agent baseline if the target agent supports the Agent Skills format.

## 15. Recommended tech stack

Recommended:

- TypeScript / Node.js
- pnpm
- Zod
- Commander or Clipanion
- MCP TypeScript SDK
- JSON registry for MVP
- SQLite later
- Vitest
- tsup
- npm package distribution

Why:

- TypeScript fits frontend-heavy target users.
- Node makes project scanning of JS/TS repos easy.
- Zod gives runtime schema validation.
- JSON is enough for MVP and reviewable in git.
- SQLite is useful later for search, indexing, cache, registry sync.
- Vitest is fast and natural for TS.
- MCP SDK makes server implementation straightforward.

## 16. Folder structure

```text
skillranger/
  package.json
  tsconfig.json
  README.md
  PLAN.md
  src/
    cli/
      index.ts
      commands/
        init.ts
        scan.ts
        recommend.ts
        install.ts
        audit.ts
        list.ts
        update.ts
        doctor.ts
    mcp/
      server.ts
      tools/
        analyze-project.ts
        recommend-skills.ts
        install-skills.ts
        audit-skill.ts
    scanner/
      index.ts
      package-json.ts
      config-files.ts
      folders.ts
      agents-context.ts
    registry/
      index.ts
      schemas.ts
      load-local-registry.ts
      checksum.ts
    recommender/
      index.ts
      score.ts
      explain.ts
    audit/
      index.ts
      scan-frontmatter.ts
      scan-files.ts
      scan-scripts.ts
      risk.ts
    installers/
      types.ts
      codex.ts
      claude-code.ts
      generic-agent-skills.ts
      cursor.ts
      opencode.ts
    lockfile/
      index.ts
    config/
      index.ts
    generator/
      draft.ts
  registry/
    skills/
      frontend.next-app-router-review/
        SKILL.md
        skill.manifest.json
      frontend.accessibility-review/
        SKILL.md
        skill.manifest.json
  schemas/
    registry.schema.json
    fingerprint.schema.json
    lockfile.schema.json
  fixtures/
    next-react-ts/
    vite-react-ts/
    expo-react-native/
    malicious-skill/
  tests/
    scanner.test.ts
    recommender.test.ts
    audit.test.ts
    installer.codex.test.ts
  docs/
    threat-model.md
    adapter-design.md
    registry-design.md
```

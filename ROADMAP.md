# Roadmap

This file keeps MVP scope and phase planning separate from the short root PLAN.md.

## 13. MVP scope

Smallest realistic MVP for solo developer:

- TypeScript CLI.
- Local JSON registry.
- Next.js/React/TypeScript scanner.
- 5-10 curated frontend skills.
- Codex-compatible installer.
- Basic MCP server.
- Basic audit.
- Lockfile.
- Golden tests with fixture projects.

This MVP is intentionally narrow as an implementation wedge. It does not define the product boundary. The architecture, registry schema, scanner taxonomy, adapter model, audit model, and recommendation algorithm must all be designed for every known software/engineering direction from the start.

MVP curated skills:

- `frontend.next-app-router-review`
- `frontend.react-app-review`
- `frontend.accessibility-review`
- `frontend.tailwind-ui-polish`
- `frontend.playwright-debug`
- `frontend.react-component-design`
- `frontend.performance-review`
- `frontend.testing-strategy`
- `frontend.agents-md-bootstrap`

Do not build in MVP:

- public marketplace;
- full remote registry;
- signatures;
- automatic third-party install;
- AI skill generation;
- UI/dashboard;
- all agent adapters;
- script sandbox execution;
- enterprise policy server.
- full coverage of every domain category.

Post-MVP domain packs should expand in this rough order:

1. `backend-api` pack.
2. `mobile` pack.
3. `devops-platform` and `iac-cloud` pack.
4. `security-appsec` pack.
5. `qa-testing` and `observability-sre` pack.
6. `data-analytics` and `database` pack.
7. `ml-ai` and agent-development pack.
8. `docs-techwriting`, `design-product`, `accessibility-i18n` pack.
9. `desktop`, `cli-tui`, `game-dev`, `embedded-iot`, `browser-extensions`, `legacy-modernization`, `package-library`, `compliance-privacy`.

## 14. Roadmap

### Phase 0: Research / spec

Goal:

- freeze schemas, threat model, MVP boundaries.

Deliverables:

- `docs/threat-model.md`
- `schemas/registry.schema.json`
- `schemas/fingerprint.schema.json`
- fixture project list

Acceptance criteria:

- 3 fixture projects produce expected fingerprints on paper.
- security policy identifies block/high/medium/low cases.

Risks:

- scope creep;
- trying to support every agent immediately.

### Phase 1: Local CLI MVP

Goal:

- build useful local CLI.

Deliverables:

- `scan`
- `recommend`
- `audit`
- `install --dry-run`
- Codex repo-scope install
- lockfile

Acceptance criteria:

- Next.js fixture gets deterministic recommendations.
- install writes `.agents/skills/...` and `skillranger.lock.json`.
- audit catches malicious fixture.

Risks:

- scanner overfits;
- metadata schema too complex.

### Phase 1.5: Registry quality gates

Goal:

- turn the local registry from a folder of examples into a reliable authoring pipeline.

Deliverables:

- `validate:registry`;
- `lint:skills`;
- `audit:registry`;
- `publish:check`;
- runtime manifest validation wired into `loadLocalRegistry`;
- frontmatter/manifest consistency checks;
- registry-level hygiene scan.

Acceptance criteria:

- every `registry/skills/*` package validates before tests pass;
- `SKILL.md` frontmatter `name` and `description` match manifest intent;
- `id`, folder name and `source.path` are consistent;
- dead references/scripts are detected;
- `.DS_Store`, hidden files and unexpected top-level files are flagged;
- all curated skills audit as low risk with no findings.

Risks:

- lint rules become too subjective;
- quality gates block useful drafts too early;
- manual scores create false confidence.

### Phase 2: MCP server

Goal:

- allow AI agents to call SkillRanger tools.

Deliverables:

- `analyze_project`
- `recommend_skills`
- `audit_skill`
- `list_installed_skills`
- guarded `install_skills`

Acceptance criteria:

- Codex can call analyze/recommend through MCP.
- install requires explicit user-facing confirmation/dry-run.

Risks:

- side effects through MCP become unsafe;
- tool descriptions overpromise.

### Phase 2.5: Universal Prompt Router v1

Status: implemented and release-gated.

Deliverables:

- direct CLI `task` and `task:read` commands;
- explicit MCP `prepare_task` and `read_run_skill_file` tools with one fixed server root;
- privacy-safe task analysis, multi-domain resolution, bounded composition, and continuation tokens;
- atomic router sidecars bridged to lifecycle v1 and installed-only strict v2;
- integrity-pinned progressive reads and journal recovery;
- shipped and synthetic golden eval suites plus end-to-end smoke coverage;
- universal managed `AGENTS.md` guidance.

Acceptance criteria:

- absent production packs return no-match instead of synthetic or frontend fallback;
- clarification, decomposition, strict failure, and budget failure create no partial runs;
- strict preparation requires matching repo installation, lockfile, file set, contract, input, and reads;
- routing performs no network, install, script, model, or application-write side effects;
- raw prompts are not persisted by default;
- router eval thresholds and all release gates pass.

Next expansion is declarative audited production domain packs. Synthetic eval coverage alone never promotes a pack into production.

### Phase 3: Registry + packs

Goal:

- create useful curated packs.

Deliverables:

- frontend pack;
- mobile Expo pack;
- testing pack;
- security review pack;
- registry validation.
- `SKILL.md` playbook template with decision rules, workflow, references map and output contract;
- quality rubric metadata;
- compatibility matrix replacing plain `supportedAgents` over time.

Acceptance criteria:

- fixture projects get expected pack suggestions.
- duplicate/conflict handling works.
- every curated skill has explicit `use when`, `do not use when`, validation and reporting guidance.

Risks:

- low-quality skills reduce trust.
- overlapping skills trigger incorrectly.
- registry metadata drifts away from actual `SKILL.md` content.

### Phase 4: Security audit system

Goal:

- make third-party skill ingestion safer.

Deliverables:

- static scanner;
- risk scoring;
- policy file;
- audit report;
- suspicious command rules.
- path containment checks for installer writes;
- symlink policy;
- package-zone policy for `SKILL.md`, `references/`, `scripts/`, `assets/`, `agents/`;
- prompt-injection scanner for references;
- expanded malicious fixture matrix.

Acceptance criteria:

- malicious fixtures are blocked.
- medium/high risk findings are explainable.
- path traversal via manifest `name` is impossible.
- block-risk install has no write side effects.

Risks:

- false positives;
- false confidence from static checks.

### Phase 5: AI skill generation

Goal:

- generate draft skills with gates.

Deliverables:

- `generate` command;
- draft registry;
- eval prompts;
- review checklist.

Acceptance criteria:

- generated skills are marked untrusted.
- generated skills cannot become curated without gates.

Risks:

- unsafe generated commands;
- hallucinated docs.

### Phase 6: Marketplace / remote registry

Goal:

- remote curated/private registries.

Deliverables:

- remote sync;
- signed registry snapshot;
- pinned packages;
- private registry auth;
- team policy.

Acceptance criteria:

- remote install verifies checksum/signature.
- team can pin approved skill set.

Risks:

- supply-chain attacks;
- registry compromise;
- trust UX complexity.

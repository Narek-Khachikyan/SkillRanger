# Product Spec

This document keeps the product vision and research context that used to live in the root PLAN.md. The short day-to-day plan is now in ../PLAN.md.

## 0. Источники и базовые выводы

План опирается на актуальные публичные источники:

- [Model Context Protocol: intro](https://modelcontextprotocol.io/docs/getting-started/intro)
- [Model Context Protocol: specification 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
- [MCP security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [Agent Skills specification](https://agentskills.io/specification)
- [AGENTS.md](https://agents.md/)
- [OpenAI Codex plugin build docs](https://developers.openai.com/codex/plugins/build)
- [Claude Code skills](https://code.claude.com/docs/en/skills)
- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
- [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- [OWASP LLM03:2025 Supply Chain](https://genai.owasp.org/llmrisk/llm032025-supply-chain/)
- [Official MCP Registry](https://registry.modelcontextprotocol.io/)
- [Cursor Directory](https://cursor.directory/)

Главный вывод: MCP и skills нельзя смешивать в одну абстракцию.

- MCP - транспорт и интерфейс tools/resources/prompts между agent host и внешними возможностями.
- Skills - reusable workflow-пакеты: `SKILL.md`, metadata, resources, scripts, examples, tests.
- SkillRanger - слой подбора, доверия, аудита, установки и объяснения, какие skills подходят конкретному проекту.

### 0.1 Research update: как реализовывать skills

Проведенный анализ текущего `registry/skills`, системных Codex skills, Codex manual и локальной реализации через 10 независимых subagent reviews уточнил архитектурную позицию проекта.

Главный вывод: не строить продукт как простой "skill package manager". Правильная модель - surface-aware planner/installer, где skill является одним типом артефакта рядом с plugin, MCP, hooks, config и `AGENTS.md`.

Разделение слоев:

1. **Authoring layer**: `SKILL.md` остается portable workflow-форматом. Он должен содержать frontmatter `name`/`description`, trigger-specific описание, workflow, границы применения, optional `references/`, optional `scripts/`, validation steps и output contract.
2. **Registry layer**: `skill.manifest.json` является metadata/index слоем для router, recommender, audit, provenance и policy. Он не должен становиться параллельной спецификацией Codex skills.
3. **Distribution/install layer**: adapters генерируют target-specific layout: Codex `.agents/skills`, Claude `.claude/skills`, generic Agent Skills, Codex plugin package, marketplace entry, MCP dependencies или hooks.

Текущие локальные skills хороши как MVP-карточки рекомендаций: они clean, low-risk, instruction-only и единообразные. Но они пока слабые как production-grade skills, потому что большинство `SKILL.md` - это короткий чеклист без explicit workflow, "do not use when", references map, validation criteria и output contract.

Качество skill должно оцениваться не одним ручным числом, а rubric:

- `usefulness`: решает повторяемую реальную задачу.
- `triggerSpecificity`: `name`/`description` точно говорят, когда skill включать и когда не включать.
- `progressiveDisclosure`: metadata короткая, детали вынесены в references/scripts и читаются only when needed.
- `safety`: least privilege, нет скрытых destructive/network/secret действий.
- `verifiability`: есть проверяемый done-state, команды, тесты, screenshots, artifacts или acceptance criteria.
- `maintainability`: ясная структура, версия, owner, freshness, совместимость.
- `portability`: portable core не завязан на один agent/OS/path без декларации.

`qualityScore` должен быть derived summary из usefulness, trigger specificity, progressive disclosure, verifiability, maintainability и portability. `securityScore` должен оставаться отдельным safety/audit слоем. Хороший, но опасный skill не должен выглядеть "качественным" только из-за полезности.

Recommended `SKILL.md` shape:

```md
---
name: playwright-debug
description: Debug Playwright E2E failures in web apps. Use when tests fail, flake, need trace analysis, selector stabilization, route-aware waits, or fixture cleanup. Not for unit tests or non-browser debugging.
---

# Playwright Debug

## Decision Rules
- Reproduce narrowly before broad diagnosis.
- Prefer trace/screenshot/console/network evidence.
- Distinguish app bug from brittle test assumption.

## Workflow
1. Identify failing spec and command.
2. Inspect trace/screenshots when present.
3. Check selectors, waits, fixtures, route transitions.
4. Propose minimal fix.
5. Run targeted verification when available.

## References
- Read `references/selectors.md` when selectors are unstable.
- Read `references/fixtures.md` when failures involve setup/cleanup.

## Output Contract
- Findings first, with file/line when available.
- State suspected root cause.
- Include exact commands run or recommended.
- Note remaining flake risk or missing evidence.
```

Research-backed implementation priorities:

1. Add mandatory runtime manifest validation before recommend/audit/install.
2. Add `lint:skills` for `SKILL.md` frontmatter, trigger quality, manifest consistency and dead references.
3. Add registry-wide audit gates, not just per-skill audit.
4. Harden install path containment: reject empty slugs, `.`, `..`, path traversal and writes outside allowed scope.
5. Treat `references/scripts/assets/agents` as package zones with different policy rules.
6. Add symlink policy before supporting richer packages.
7. Make `supportedAgents` a real compatibility matrix, not only a ranking hint.
8. Keep plugins distinct: skill is authoring format; plugin is distribution unit for reusable skills plus MCP/apps/hooks.

## 1. Краткое резюме идеи

Мы строим local-first devtool: `SkillRanger`.

Когда AI coding agent запускается в репозитории, инструмент должен:

1. Просканировать структуру проекта и конфиги.
2. Определить стек и направление: frontend, backend, mobile, desktop, data, ML/AI, DevOps, security, QA, docs, design systems, embedded, game dev, monorepo, legacy modernization и т.д.
3. Подобрать лучшие skills или skill packs под этот проект.
4. Установить или предложить установить их в нужный agent environment: Codex, Claude Code, Cursor, OpenCode или generic `.agents/skills`.
5. По пользовательскому intent вроде "дай мне скиллы для мобильной разработки" найти релевантные skills, объяснить пользу и риск, затем установить только после подтверждения.
6. Позже генерировать новые skills через AI/subagents, но только как untrusted drafts до аудита, eval и human review.

Почему полезно:

- AI coding agents становятся сильнее, когда у них есть правильный workflow-context.
- Сейчас skills, rules, prompts, MCP servers и plugins живут разрозненно.
- Пользователю сложно понять, что ставить, куда ставить, чем это опасно и почему оно подходит именно этому repo.

Чем отличается:

- От обычного MCP-сервера: MCP только exposes tools. Здесь ядро - registry, ranking, audit и installation.
- От marketplace: marketplace хранит список. Router анализирует конкретный project fingerprint и считает compatibility/risk.
- От набора промптов: skills versioned, installable, auditable, имеют metadata, provenance, permissions и lockfile.

## 2. Core product concept

Основная ценность: "Подключи правильные агентные workflows к конкретному repo без ручного поиска и без blind trust".

Пользователи:

- Solo developer, который активно использует Codex/Claude/Cursor.
- Frontend, backend, mobile, desktop, data, ML/AI, infra, security, QA, embedded, game, platform engineers.
- Agency, которая работает с разными стеками и хочет повторяемые AI workflows.
- Small team, которой нужны shared skills и policy.

Важно: стратегический scope продукта универсальный. Frontend/mobile/backend - это только примеры первых вертикалей. Долгосрочно система должна покрывать все известные направления, где AI coding agents могут получать пользу от reusable workflows.

Главный MVP use-case:

```bash
skillranger scan
skillranger recommend --target codex
skillranger install frontend.next-app-router-review --scope repo
```

В Next.js проекте пользователь получает 5-8 релевантных skills с объяснением:

- почему skill подходит;
- какие project signals совпали;
- какие permissions нужны;
- какой risk level;
- какие файлы будут записаны;
- что попадет в lockfile.

Главный moat:

- Project fingerprint, а не generic categories.
- Compatibility matrix across agents.
- Security/risk scoring.
- Adapter-based installer.
- Pinned versions и checksum.
- Quality/eval pipeline для generated skills.

Это не просто список skills. Это dependency manager для agent workflows.

### Universal capability taxonomy

Registry и scanner должны проектироваться domain-agnostic. SkillRanger должен уметь классифицировать и рекомендовать skills не только для web/mobile/backend, а для всех практических направлений разработки и инженерной работы.

Базовая taxonomy направлений:

- `frontend-web`: React, Next.js, Vue, Nuxt, Svelte, Astro, Remix, Angular, CSS, Tailwind, design systems.
- `backend-api`: Node.js, Python, Go, Java, .NET, Rust, GraphQL, REST, queues, auth, service architecture.
- `mobile`: React Native, Expo, iOS, Android, Flutter, Kotlin Multiplatform.
- `desktop`: Electron, Tauri, SwiftUI/AppKit, WPF, Qt, native desktop apps.
- `cli-tui`: command-line tools, terminal UIs, shell workflows, developer automation.
- `data-analytics`: SQL, notebooks, dbt, BI, data cleaning, visualization, reporting.
- `ml-ai`: model integration, evals, RAG, embeddings, fine-tuning workflows, agent development.
- `devops-platform`: Docker, Kubernetes, CI/CD, cloud deploys, release engineering, environment setup.
- `iac-cloud`: Terraform, Pulumi, AWS, GCP, Azure, Cloudflare, Vercel, Netlify.
- `database`: Postgres, MySQL, SQLite, MongoDB, Redis, migrations, query tuning.
- `security-appsec`: secure code review, secrets, SAST, dependency audit, threat modeling.
- `qa-testing`: unit, integration, e2e, visual regression, load testing, test strategy.
- `observability-sre`: logs, metrics, tracing, incident response, SLOs, debugging production issues.
- `design-product`: UX review, design system adherence, Figma handoff, product specs.
- `docs-techwriting`: README, API docs, changelogs, ADRs, migration guides, tutorials.
- `accessibility-i18n`: a11y, localization, RTL, regional formatting, inclusive UX.
- `performance`: frontend perf, backend perf, database perf, profiling, bundle analysis.
- `game-dev`: Unity, Unreal, Godot, web games, gameplay loops, asset pipelines.
- `embedded-iot`: firmware, C/C++, Rust embedded, hardware interfaces, RTOS workflows.
- `browser-extensions`: Chrome/Firefox extensions, manifests, permissions, store packaging.
- `blockchain-web3`: smart contracts, wallets, dApps, audits, testnets.
- `legacy-modernization`: COBOL, old Java/.NET/PHP/Rails, migrations, refactors, compatibility.
- `monorepo-build`: Nx, Turborepo, Bazel, pnpm workspaces, package boundaries.
- `package-library`: SDKs, public APIs, semantic versioning, release notes, package publishing.
- `compliance-privacy`: GDPR/PII handling, audit trails, regulated workflow checklists.

This taxonomy should remain open-ended. New categories should be registry data, not hardcoded product assumptions.

## 19. Product angle

Best product path:

1. Free local CLI.
2. First curated pack as a proof point, likely frontend because it is easy to validate quickly.
3. Codex-first installer.
4. Expand into backend, mobile, infra, security, data, ML/AI, QA, docs, design, desktop, embedded, games, legacy modernization.
5. Private/local registry.
6. Team policy and security scanner.
7. Pro registry and signed packs.

Possible paid / pro features:

- private team registry;
- policy as code;
- CI skill audit;
- signed curated packs;
- shared team recommendations;
- registry drift alerts;
- generated skill eval pipeline;
- dashboard for installed skills and risks.

Do not lead with a marketplace. Lead with: "Your AI coding agent gets the right workflow for this repo."

# SkillRanger Plan

This is the short working plan. The original long plan has been split into focused documents so the root plan can answer one question: what are we building next?

## Document Map

- [docs/PRODUCT.md](docs/PRODUCT.md): product vision, research notes, users, moat, taxonomy, and product angle.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system architecture, scanner, recommender, CLI/MCP tools, installers, stack, and folder structure.
- [docs/REGISTRY.md](docs/REGISTRY.md): registry schema, skill package model, generated skills, lockfile/config data files.
- [docs/SECURITY.md](docs/SECURITY.md): expanded security model, risk levels, installer controls, and third-party package assumptions.
- [docs/TESTING.md](docs/TESTING.md): fixture strategy, golden tests, security cases, install tests, registry quality checks, and eval notes.
- [ROADMAP.md](ROADMAP.md): MVP scope and phase roadmap.
- [TASKS.md](TASKS.md): concrete task list, implementation updates, and open decisions.

## Current Product Direction

Build a local-first SkillRanger that scans a repository, detects project signals, recommends compatible agent skills, audits skill packages, and safely installs selected workflows into a target AI coding agent environment.

The MVP stays intentionally narrow: TypeScript CLI, local JSON registry, Next.js/React/TypeScript scanner, curated frontend skills, Codex/generic repo-scope install, audit, lockfile, and MCP tools. The architecture should stay broad enough for backend, mobile, infra, security, data, ML/AI, docs, design, desktop, embedded, game, and legacy packs later.

## Current Status

Implemented MVP pieces already include:

- deterministic scanner/recommender flow;
- registry validation and skill linting;
- registry-wide audit gates;
- safer installer path containment and lockfile validation;
- 8 curated frontend playbook-style skills;
- quality rubric metadata and compatibility matrix support;
- read-only and gated write-capable MCP tools;
- MCP tool handlers split into project, registry, and install modules;
- JSON-RPC protocol tests and host documentation.

The last recorded next task is: choose between starting the first `backend-api` pack or adding additional fixture projects such as `vite-react-ts`/`backend-node` to exercise scanner and recommender behavior across non-Next stacks.

## Near-Term Priorities

1. Improve frontend skill quality before expanding domains; see [docs/FRONTEND_SKILL_QUALITY.md](docs/FRONTEND_SKILL_QUALITY.md).
2. Keep the current MVP stable with `npm run check`, `npm test`, `npm run validate:registry`, and `npm run publish:check`.
3. Source high-quality frontend candidates from `skills.sh`, but stage third-party skills through audit, provenance review, compatibility mapping, and eval before curation.
4. Upgrade the local frontend skills from short playbooks into evidence-first workflows with references, examples, verification, and output contracts.
5. Improve install/update lockfile behavior before adding remote registries.
6. Add the next vertical pack only after the frontend pack remains low-risk and demonstrably useful on real frontend projects.
7. Keep generated skills as untrusted drafts until audit, eval, and human review gates exist.

## MVP Readiness Before Broader Testing

The core MVP is ready for local testing. The last confidence gaps were closed by:

1. Adding `fixtures/vite-react-ts` with scanner/recommender golden tests against the existing frontend pack.
2. Adding `fixtures/backend-node` to prove unsupported or weakly matching projects do not receive misleading frontend-heavy recommendations.
3. Running CLI smoke checks for `scan`, `recommend`, `install --dry-run`, and `installed` against the new fixtures.
4. Running MCP smoke checks for `tools/list`, `recommend_skills`, and `plan_skill_install`.
5. Removing the `.npmrc` option that produced the `verify-deps-before-run` warning.

Keep the first `backend-api` skill pack post-MVP unless testing shows backend users are part of the immediate demo path.

## Out Of Scope For Now

- Public marketplace.
- Remote registry installs by default.
- Signature infrastructure.
- Automatic third-party install.
- Script sandbox execution.
- Enterprise policy server.
- Supporting every agent adapter at once.

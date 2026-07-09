# Frontend Skill Quality And Sourcing

This document tracks the next product focus: make the frontend pack genuinely useful, then reuse the same quality pipeline for backend, mobile, infra, security, and other domains.

## Current Problem

The router, scanner, installer, lockfile, audit, and MCP surfaces are useful enough for MVP testing. The bottleneck is now skill quality.

The current local frontend skills are safe, consistent, and installable, but they are still too checklist-like. A strong frontend skill should change the agent's behavior in a visible way: better diagnosis, better code choices, stronger verification, fewer generic suggestions, and clearer output.

## Quality Bar

A production-grade frontend skill should have:

- precise trigger and non-trigger rules;
- a workflow that starts from evidence in the repo, not generic advice;
- framework-specific decision rules where needed;
- examples of good and bad agent behavior;
- references that are read only when needed;
- verification commands or acceptance criteria;
- an output contract with findings, changes, validation, and residual risk;
- provenance, freshness, compatibility, and audit status.

The local quality rubric should stay strict:

- `usefulness`: solves a recurring frontend task.
- `triggerSpecificity`: activates for the right intent and stack, and stays quiet otherwise.
- `progressiveDisclosure`: keeps trigger metadata short while putting deep rules in references.
- `verifiability`: produces testable outcomes, not vibes.
- `maintainability`: has owner, freshness, version, and clear update path.
- `portability`: is not unnecessarily tied to one host, OS, or private convention.
- `safety`: remains separate from `qualityScore` and must block risky packages.

Quality scores are editorial until backed by frozen eval artifacts. Each curated frontend manifest now carries `evaluation.status`; keep status at `none` until trigger and task eval evidence exists, even when the skill text is strong.

## External Sourcing Shortlist

Use `skills.sh` as the discovery source, but do not blindly import popularity. Every third-party skill must pass local audit, provenance review, compatibility mapping, and eval before becoming curated.

High-priority frontend candidates:

- `vercel-react-best-practices` from `vercel-labs/agent-skills`: React performance rules around waterfalls, bundle size, re-renders, and advanced patterns.
- `vercel-composition-patterns` from `vercel-labs/agent-skills`: compound components, render props, context, and scalable component APIs.
- `next-best-practices` from `vercel-labs/next-skills`: App Router conventions, server/client boundaries, async APIs, metadata, and route handlers.
- `next-cache-components` from `vercel-labs/next-skills`: PPR, `use cache`, `cacheLife`, `cacheTag`, and revalidation.
- `shadcn` from `shadcn/ui`: shadcn/ui usage, theming, customization, and Tailwind integration.
- `webapp-testing` from `anthropics/skills`: React app unit, integration, and end-to-end testing patterns.
- `frontend-design` from `anthropics/skills`: broad frontend design and visual polish guidance.
- `web-design-guidelines` from `vercel-labs/agent-skills`: interface standards for spacing, typography, interaction, and accessibility.
- `extract-design-system` from `arvindrk/extract-design-system`: design token and component-pattern extraction from an existing codebase.
- `critique` and `polish` from `pbakaus/impeccable`: structured critique and final-pass visual refinement.

Secondary candidates:

- `typescript-advanced-types` from `wshobson/agents`.
- `tailwind-design-system` from `wshobson/agents`.
- `design-taste-frontend`, `high-end-visual-design`, `minimalist-ui`, and `imagegen-frontend-web` from `leonxlnx/taste-skill`.
- `emil-design-eng` from `emilkowalski/skills`.
- `webapp-testing` should also inform our own `frontend.testing-strategy` skill.

## Import Policy

Third-party skills should move through these stages:

1. `discovered`: listed from `skills.sh` or GitHub with source URL and category.
2. `candidate`: manually inspected for scope, quality, maintenance, license, and agent compatibility.
3. `audited`: static local audit passes; external audit signal is recorded when available.
4. `adapted`: converted to the local manifest shape without changing portable skill semantics.
5. `evaluated`: run on at least one frontend fixture and one real frontend project.
6. `curated`: accepted into local registry with checksum, source provenance, and freshness date.

Do not install third-party skills directly into user projects by default. For now, imported skills should be staged in a quarantine/candidates area until the audit and eval story is explicit.

## Local Frontend Pack Upgrade Order

1. `frontend.playwright-debug`
   - Add trace-first diagnosis, flake taxonomy, route/network/console evidence handling, selector guidance, and targeted verification.
   - Use AnimeBounty-Info as the real smoke project.

2. `frontend.tailwind-ui-polish`
   - Split Tailwind correctness from design taste.
   - Add layout, spacing, responsive, contrast, motion, and design-system checks.
   - Cross-check with `web-design-guidelines`, `frontend-design`, and `polish`.

3. `frontend.testing-strategy`
   - Add test pyramid decision rules for React apps.
   - Distinguish unit, component, integration, e2e, accessibility, and PWA smoke tests.
   - Cross-check with `webapp-testing`.

4. `frontend.react-component-design`
   - Add component API smell taxonomy: prop sprawl, impossible states, composition boundaries, context misuse, and slot/render-prop tradeoffs.
   - Cross-check with `vercel-composition-patterns`.

5. `frontend.performance-review`
   - Add evidence-first performance workflow: bundle, render, network, images, hydration/client code, memoization, data waterfalls.
   - Cross-check with `vercel-react-best-practices`.

6. `frontend.next-app-router-review`
   - Keep this skill Next-specific: App Router, RSC boundaries, caching, route handlers, and Server Actions.
   - Cross-check with `next-best-practices` and `next-cache-components`.

7. `frontend.react-app-review`
   - Cover general React app architecture: state ownership, effects, data flow, routing integration, rendering boundaries, and maintainability.

8. `frontend.accessibility-review`
   - Add WCAG-oriented acceptance criteria, keyboard/focus checks, form labeling, semantic landmarks, color contrast, reduced motion, and Playwright/a11y smoke hooks.

9. `frontend.agents-md-bootstrap`
   - Keep as a project-setup helper, not a frontend quality skill.
   - Suppress recommendation when `AGENTS.md` already exists.


## Reference Mapping

Use external skills as source material, not automatic imports. Local skills keep the contract and routing boundaries; references deepen workflow details only after license/provenance review.

| Local skill | Primary reference lanes | Use for |
| --- | --- | --- |
| `frontend.playwright-debug` | Playwright docs, `webapp-testing` | trace workflow, actionability, fixtures, CI artifacts |
| `frontend.tailwind-ui-polish` | shadcn/ui, web design guidelines, Tailwind docs, `polish` | utility correctness, responsive polish, token-aware class cleanup |
| `frontend.testing-strategy` | `webapp-testing` | unit/component/e2e/a11y portfolio boundaries |
| `frontend.react-component-design` | `vercel-composition-patterns` | component API smells, composition, controlled/uncontrolled state |
| `frontend.performance-review` | `vercel-react-best-practices` | bundle/render/network/image/hydration diagnosis |
| `frontend.next-app-router-review` | `next-best-practices`, `next-cache-components` | App Router, RSC boundaries, caching, route handlers, Server Actions |
| `frontend.react-app-review` | React docs, `vercel-react-best-practices` | state ownership, effects, data flow, rendering boundaries |
| `frontend.accessibility-review` | WCAG 2.2, WAI-ARIA APG, MDN | criteria mapping, widget patterns, manual vs automated checks |

Design-lane boundaries are part of routing quality: `frontend.visual-design-polish` owns broad visual direction, `frontend.tailwind-ui-polish` owns implementation-level Tailwind polish, `frontend.design-system` owns reusable tokens/components, `frontend.ux-critique` owns task-flow critique, and `frontend.interaction-polish` owns motion/state interaction quality.

## Eval Set

Use `evals/frontend/suite.json` as the frozen coverage target before increasing `qualityScore`: 87 trigger prompts and 49 task eval seeds across greenfield UI, existing-project modification, repair, and polish. Run it against repeatable fixtures before claiming benchmark-backed quality:

- `fixtures/next-react-ts`: Next.js, React, TypeScript, Tailwind, Playwright.
- `fixtures/vite-react-ts`: Vite, React, TypeScript, existing `AGENTS.md`.
- A user-provided real frontend project, run from an isolated copy so the smoke cannot modify the original.

Each eval should record:

- recommended skills and scores;
- which skill was installed or planned;
- whether the agent produced more specific findings;
- whether validation commands were concrete;
- whether unsafe or irrelevant advice appeared;
- whether output matched the skill contract.

The first automated gate is the routing eval:

```bash
node src/cli/index.ts eval:frontend --run-routing --project fixtures/next-react-ts --json
```

This scans the target project once, routes each `triggerPrompts` entry through `recommendSkills(..., { userIntent: prompt.text })`, and compares the top frontend recommendation against `routingExpected`. Prompts without `routingExpected` and without legacy `expectedSkill` are skipped. `shouldNotTrigger` passes only when no frontend recommendation is returned; `expectedSkill` requires an exact top-skill match unless `acceptableAlternates` are present; `triageOnly` accepts any listed alternate.

Routing eval is necessary but not sufficient. It catches scoring and trigger regressions, but it does not run an agent or browser, calculate no-skill/old-skill deltas, or create human judgments. Those remain required before `curated` promotion.

The repo validates two promotion artifacts after an external run:

```bash
node src/cli/index.ts eval:frontend --suite evals/frontend/suite.json --verify-task-evidence results/task-evidence.json --json
node src/cli/index.ts eval:frontend --suite evals/frontend/suite.json --verify-pairwise-review results/pairwise-review.json --json
```

Task evidence requires one run for every seed task, its skill id/version/checksum, model, fixture, command, duration, asserted outcome, and every required artifact named by that task. A failed or unassessed assertion blocks the evidence promotion gate. Pairwise review requires a human reviewer, complete task coverage, opaque `A`/`B` labels instead of skill names, and a candidate preference share meeting `minimumBlindPreferenceShare`; it intentionally rejects `llm_judge`.

When scan detects React outside 18–19 or Tailwind outside 3–4, it emits a conservative version-drift warning. Keep the skill unpromoted until an evidence run verifies that project version.

Promotion evidence is tracked in manifest `evaluation` metadata:

- `status`: `none`, `trigger-eval`, `task-eval`, `real-project-smoke`, or `curated`.
- `benchmarkVersion`: the eval suite/version that produced the evidence.
- `evidenceUri`: local artifact or report path for the frozen run.
- `score`: normalized gated benchmark score when available.

Do not increase `qualityScore` from prose review alone; derive it from the frozen eval suite once trigger precision/recall, task deltas, blind preference, and critical-failure gates pass.

## Next Concrete Step

The `frontend.playwright-debug` promotion pilot is recorded at `evals/frontend/results/frontend.playwright-debug-promotion-pilot-2026-07-05.json`.

`frontend.playwright-debug` remains at `evaluation.status: real-project-smoke`. Its historical pilot used the former 80-prompt/40-task suite and is not promotion evidence for the current frozen 87-prompt/49-task suite.

Do not promote to `curated` yet. The repo validates the 49 task seeds plus traceable evidence and blinded human-review manifests, but does not execute agents or calculate no-skill/old-skill deltas. Those gates must not be inferred from routing or smoke artifacts.

Next step: wire a task runner for a user-provided real project that executes the 49 task seeds against no-skill, old-skill, and current-skill baselines, then feeds its artifacts into these validators before any curated decision.

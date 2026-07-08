# Frontend Skill Research Report - 2026-07-05

This report synthesizes an 18-track sub-agent research pass on high-quality frontend AI agent skills, with extra emphasis on design quality. The goal is to decide how to upgrade the local frontend pack and how to source strong third-party skills without blindly trusting external packages.

## Executive Summary

The router mechanics are no longer the main bottleneck. The product will win or lose on skill quality: whether recommended skills reliably improve frontend work, design judgment, verification discipline, and project fit.

The strongest conclusion is structural: do not keep the current frontend pack as eight peer checklist skills. Reshape it into a layered pack with narrow specialist lanes, a small optional triage layer, and a separate eval system. Design deserves first-class treatment, not a paragraph inside "UI polish"; it needs distinct skills for visual design, UX critique, design systems, design-to-code, responsive layout, accessibility, and interaction polish.

The second conclusion is operational: upgrade skills only behind eval gates. A longer `SKILL.md` is not automatically better. Promotion should require trigger precision/recall, paired runs against old/no-skill baselines, screenshots, accessibility checks, performance checks, real-project smoke tests, and blind human preference.

The third conclusion is security-related: third-party skills from `skills.sh` are supply-chain artifacts, not prompt snippets. They can carry hidden instructions, scripts, permissions, remote fetches, license risk, and persistent behavior changes. Use `skills.sh` as discovery and audit triage, then quarantine, pin, audit, evaluate, and only then curate.

## Research Method

Eighteen sub-agent tracks were used:

1. Skill authoring patterns.
2. React best practices.
3. Next.js/App Router.
4. Frontend testing.
5. Playwright debugging.
6. Frontend performance.
7. Visual design taste and critique.
8. Design systems, Tailwind, shadcn.
9. UX critique.
10. Accessibility and inclusive design.
11. Responsive layout and density.
12. Motion and interaction polish.
13. Third-party sourcing from `skills.sh`.
14. Design-to-code.
15. Frontend skill eval methodology.
16. Third-party security and provenance.
17. Frontend pack architecture.
18. Critical review of the research direction.

## Core Principles For Strong Frontend Skills

### 1. Skills Must Be Narrow And Testable

A strong skill is a compact workflow, not a broad doctrine. Its `description` must make activation precise; the root `SKILL.md` should hold durable decision rules and route deeper material to `references/`. Long framework law, examples, and templates should be loaded only when needed.

Quality dimensions:

- activation precision;
- explicit non-trigger rules;
- progressive disclosure;
- concrete examples;
- verification steps;
- output contract;
- safe permissions;
- measurable eval improvement.

### 2. Frontend Quality Is More Than Code

Frontend success includes:

- task completion;
- visual hierarchy;
- typography;
- density;
- responsive fit;
- accessibility;
- interaction states;
- motion restraint;
- performance;
- consistency with the host product.

Compile/test pass is necessary, but not sufficient.

### 3. Design Must Be First-Class

Design quality cannot be reduced to "make it polished." The design research converged on these evaluation dimensions:

- **Intent**: the UI reflects the product, audience, and job.
- **Hierarchy**: primary action/content is obvious quickly.
- **Spacing**: proximity and rhythm encode relationships.
- **Typography**: type roles, scale, weight, and line-height are deliberate.
- **Contrast**: text, icons, controls, and focus states remain readable.
- **Density**: dashboard/tool UIs are compact and scannable; marketing/editorial pages can breathe.
- **Restraint**: one memorable visual move is better than many decorative moves.
- **Reference fit**: output uses real domain/platform conventions without copying blindly.
- **Implementation robustness**: survives long text, empty states, mobile, keyboard nav, reduced motion, and real data.

Design skill anti-patterns:

- generic gradient/blobs/card layouts;
- vague SaaS copy;
- random icon grids;
- one-note palettes;
- desktop-only layouts;
- nested cards and ornamental shadows;
- animation without purpose;
- stock-looking imagery or visual direction unrelated to the subject.

## Proposed Frontend Pack Architecture

The current pack should become layered:

1. **Framework lane**: Next/Vite/React app conventions.
2. **Implementation lanes**: component APIs, styling, performance, accessibility.
3. **Design lanes**: visual design, design systems, design-to-code, interaction polish, UX critique.
4. **Testing/QA lanes**: testing strategy, Playwright debugging, visual QA.
5. **Agent-context lane**: AGENTS.md/bootstrap, outside frontend quality ranking.
6. **Meta lane**: optional frontend review triage that routes to specialists.

Suggested target taxonomy:

```text
frontend.framework.next-app-router
frontend.framework.react-app
frontend.architecture.react-component-api
frontend.quality.accessibility
frontend.quality.performance
frontend.quality.visual-design
frontend.styling.tailwind-layout
frontend.design-system
frontend.design-to-code
frontend.ux-critique
frontend.interaction-polish
frontend.testing.strategy
frontend.testing.playwright-debug
agent-context.frontend-agents-md
meta.frontend-review-triage
```

## Recommended Changes To Existing Skills

| Current skill | Action | Reason |
|---|---|---|
| `frontend.next-react-review` | Split/rename to `frontend.next-app-router-review`; optionally add `frontend.react-app-review` | Too broad; overlaps accessibility, testing, styling, performance. Next rules need version-aware references. |
| `frontend.accessibility-review` | Keep and deepen | Should become WCAG/APG/keyboard/focus/forms/axe specialist. |
| `frontend.tailwind-ui-polish` | Split | Keep as final QA/polish; move tokens/theming/extraction to new `frontend.design-system`. |
| `frontend.playwright-debug` | Keep and deepen; optionally rename `frontend.playwright-e2e-debug` | Best first upgrade target; real project already triggers it. |
| `frontend.react-component-design` | Rename to `frontend.react-component-api-design` or `frontend.react-component-architecture` | Avoid confusion with visual design; focus on component APIs, state, composition. |
| `frontend.performance-review` | Keep and deepen | Must become evidence-led: build output, CWV, traces, bundle, profiler. |
| `frontend.testing-strategy` | Keep and deepen | Should plan a repo-native test portfolio, not just browser automation. |
| `frontend.agents-md-bootstrap` | Reclassify | Useful setup skill, but not part of frontend quality ranking. |

## New Skills To Add

### `frontend.design-system`

Purpose: apply, extract, and audit frontend design systems for Tailwind/shadcn projects using tokens, variants, and anti-drift checks.

Reference structure:

```text
references/
  01-discovery.md
  02-token-model.md
  03-tailwind-theming.md
  04-shadcn-customization.md
  05-component-variants.md
  06-extraction-workflow.md
  07-anti-drift-audit.md
  08-output-contracts.md
```

Core ideas:

- primitive → semantic → component token hierarchy;
- inspect `components.json`, Tailwind version, global CSS, local `cn`/CVA utilities;
- prefer repo tokens over raw hex/magic pixel values;
- flag design drift: arbitrary values, duplicated class bundles, inconsistent radii, weak focus states, non-semantic shadcn colors.

### `frontend.design-to-code`

Purpose: translate design intent, screenshots, Figma links, mocks, or visual references into React/CSS/Tailwind while preserving codebase conventions, tokens, responsiveness, and visual fidelity.

Core principle: translate design intent into the existing product system, not raw pixels into isolated code.

Required workflow:

1. Intake design context.
2. Inspect existing codebase.
3. Map design to components.
4. Translate tokens/styles.
5. Define responsive constraints.
6. Implement static structure first.
7. Add states/interactions.
8. Render, screenshot, compare, refine.

### `frontend.visual-design-polish`

Purpose: improve hierarchy, spacing, typography, contrast, density, domain fit, and anti-generic visual quality.

This should adapt ideas from `frontend-design`, `web-design-guidelines`, `critique`, `polish`, `design-taste-frontend`, and `emil-design-eng`, but keep local rules tight and project-aware.

### `frontend.ux-critique`

Purpose: review flows, information architecture, forms, states, affordances, feedback, cognitive load, and task completion.

Severity scale:

- S4 Critical: blocks primary task or risks data loss/security/compliance.
- S3 Major: likely abandonment or serious confusion.
- S2 Minor: slows users down or causes recoverable mistakes.
- S1 Polish: low-impact clarity/cosmetic issue.

### `frontend.interaction-polish`

Purpose: motion, microinteractions, loading/skeleton states, hover/focus/active states, and perceived responsiveness.

Core rule: every animation needs a job. Motion should confirm input, preserve spatial context, reveal cause/effect, soften state changes, or make a wait understandable. Otherwise remove it.

### `frontend-a11y`

Purpose: WCAG 2.2, semantic HTML, ARIA APG, keyboard/focus, forms/errors, accessible names, contrast, reduced motion, and Playwright/axe checks.

Automation is a first pass, not proof of accessibility. The skill must always report residual manual checks.

## Technical Skill Findings

### React

Strong React skill content should include:

- Think in React: component hierarchy, static UI, one-way data flow.
- Pure render and hooks rules.
- Minimal state; derive values during render where possible.
- Effects as escape hatches, not a derived-data mechanism.
- Forms: controlled/uncontrolled choice, native forms, React 19 Actions where version-supported.
- Error/loading/empty states as first-class UI.
- Memoization only with profiler/evidence.
- Version guard for React 18/19 APIs.

### Next.js

The Next skill should be version-aware:

- inspect installed Next version;
- prefer local `node_modules/next/dist/docs/` docs where available;
- App Router defaults to Server Components;
- push `'use client'` down to small interactive leaves;
- cover async request APIs in Next 15+;
- cover Cache Components / `use cache` for newer Next versions;
- keep deployment guidance agnostic unless Vercel is explicit.

Old `vercel-labs/next-skills` entries should be treated cautiously; current Next skills have moved toward the `vercel/next.js` source tree.

### Playwright Debug

`frontend.playwright-debug` should become:

- trace-first;
- artifact-aware;
- locator/actionability focused;
- route/navigation/hydration aware;
- network/console aware;
- fixture-isolation aware;
- CI aware.

Evidence priority:

1. failing command and browser/project;
2. HTML report;
3. trace;
4. screenshot/video;
5. Playwright call/actionability log;
6. console/page errors;
7. request/response/requestfailed logs;
8. CI runner metadata;
9. code inspection.

Avoid broad timeouts and `waitForTimeout` as fixes. Prefer locators, web-first assertions, app-side readiness, deterministic data, and fixture cleanup.

### Testing Strategy

`frontend.testing-strategy` should become a repo-native testing portfolio skill:

- unit tests for pure functions/hooks/reducers;
- component tests with React Testing Library semantics;
- integration tests with realistic data/mocks;
- Playwright e2e for critical flows;
- accessibility smoke;
- PWA smoke where relevant;
- CI split between fast checks and browser tests;
- flake prevention via selectors, waits, data isolation, and artifacts.

Do not copy `networkidle` readiness guidance from older browser-helper skills; Playwright discourages it for test readiness.

### Performance

`frontend.performance-review` must start with measurement:

- production build output;
- Lighthouse/LHCI where available;
- bundle analyzer;
- Chrome trace;
- React Profiler;
- network waterfall;
- Core Web Vitals.

High-impact areas:

- data waterfalls;
- bundle size;
- LCP resource discovery;
- INP/main-thread work;
- CLS/layout stability;
- hydration/client boundaries;
- image/script optimization.

## Third-Party Sourcing From `skills.sh`

Use `skills.sh` for discovery and triage, not blind import.

Ranked candidates:

| Rank | Skill | Source | Recommendation |
|---:|---|---|---|
| 1 | `vercel-react-best-practices` | Vercel Labs | Import/adapt first for React/performance/code-quality. |
| 2 | `web-design-guidelines` | Vercel Labs | Adapt as UI correctness/audit layer; beware live remote fetch behavior. |
| 3 | `critique` + `polish` | Impeccable / Paul Bakaus | Adapt into UX/visual QA gates. |
| 4 | `playwright-best-practices` | Currents.dev | Import/adapt for Playwright testing/debugging. |
| 5 | `vercel-composition-patterns` | Vercel Labs | Import/adapt for component architecture. |
| 6 | `shadcn` | shadcn/ui | Conditional import for shadcn projects only; review command/tool directives. |
| 7 | `tailwind-design-system` | wshobson/agents | Adapt for Tailwind v4/token guidance. |
| 8 | Current Next.js skills | `vercel/next.js` | Reference current source, not stale old entries. |
| 9 | `extract-design-system` | arvindrk | Reference/explicit-use only; extraction quality and permissions need review. |
| 10 | `emil-design-eng` | Emil Kowalski | Reference/adapt for motion and microinteraction taste. |
| 11 | `design-taste-frontend` | leonxlnx | Reference/adapt selectively for anti-generic landing/design work. |
| 12 | `webapp-testing` | Anthropic | Reference/import only after license and per-folder terms are verified. |

## Third-Party Import Policy

Treat external skills as supply-chain artifacts.

Import stages:

1. `discovered`: source URL, maintainer, category, audit signals recorded.
2. `candidate`: manually inspected for scope, maintenance, license, permissions.
3. `quarantined`: staged in sandbox; no secrets; no production repos.
4. `audited`: full package audit, not just `SKILL.md`.
5. `adapted`: converted to local manifest shape and compatibility matrix.
6. `evaluated`: trigger + task + real-project evals.
7. `curated`: pinned commit, checksum, provenance, freshness, license captured.

Block:

- obfuscated content;
- hidden instructions;
- broad shell/network/filesystem permissions;
- package install hooks without explicit need;
- unclear license;
- unpinned remote downloads;
- secret access;
- maintainer mismatch;
- prompt injection patterns;
- bundled MCP/plugin capabilities without separate review.

## Evaluation Plan

### Trigger Evals

Create 80 trigger prompts:

- 35 should trigger;
- 35 should not trigger;
- 10 ambiguous/near-miss.

Run each 3 times. Gates:

- at least 85% recall;
- at least 90% precision;
- no repeated false triggers on clearly non-frontend tasks.

### Task Evals

Build 40 tasks:

- 10 greenfield UI tasks;
- 10 existing-project modifications;
- 10 repair tasks;
- 10 polish tasks.

Run paired comparisons:

```text
without_skill
old_skill
new_skill
```

Record deltas, not just absolute scores.

### Visual QA

Require screenshots at:

- 390x844;
- 768x1024;
- 1440x900;
- one wide desktop viewport.

Score:

- layout integrity;
- responsive behavior;
- visual hierarchy;
- domain fit;
- state completeness;
- consistency with existing app patterns.

### Accessibility

Run axe where possible, but do not overclaim. Manual keyboard/focus checks remain mandatory. Fail critical/serious issues by default.

### Performance

Track:

- build output;
- bundle delta;
- Lighthouse/LHCI where available;
- LCP/INP/CLS;
- no unnecessary animation/layout thrash.

### Skill Utility Score

```text
25% functional correctness
20% visual QA
15% accessibility
10% performance
10% project fit / maintainability
10% review quality
10% cost efficiency
```

Promotion gate:

- new skill beats no skill by at least 10 points;
- new skill beats old skill by at least 5 points or materially reduces cost;
- no category regresses by more than 3 points;
- no increase in critical build/runtime/a11y failures;
- blind human preference favors new skill in at least 60% of comparable tasks.

## Recommended Implementation Order

1. Build the eval harness and acceptance rubric first.
2. Upgrade `frontend.playwright-debug`, because AnimeBounty-Info naturally exercises it.
3. Add `frontend.design-system`.
4. Split `frontend.tailwind-ui-polish` into final polish/QA and design-system references.
5. Add or adapt `frontend.visual-design-polish`.
6. Add `frontend.design-to-code`.
7. Deepen `frontend.accessibility-review` into WCAG/APG/axe/manual-check specialist.
8. Deepen `frontend.testing-strategy`.
9. Deepen `frontend.performance-review`.
10. Split/rename `frontend.next-react-review`.
11. Rename `frontend.react-component-design`.
12. Add lane/mode metadata to manifests and update recommender scoring.
13. Start quarantined third-party imports only after eval and provenance gates exist.

## Immediate Next Task

Do not start by importing many skills. Start by creating the eval harness and rewriting one skill:

- create eval prompts and scoring templates;
- upgrade `frontend.playwright-debug`;
- run it on `fixtures/next-react-ts`, `fixtures/vite-react-ts`, and AnimeBounty-Info;
- compare old vs new behavior.

## Source Index

- [Agent Skills specification](https://agentskills.io/specification)
- [Agent Skills eval guidance](https://agentskills.io/skill-creation/evaluating-skills)
- [Agent Skills trigger optimization](https://agentskills.io/skill-creation/optimizing-descriptions)
- [OpenAI Codex skills docs](https://developers.openai.com/codex/skills)
- [Claude Code skills docs](https://code.claude.com/docs/en/skills)
- [skills.sh Design topic](https://www.skills.sh/topic/design)
- [skills.sh React topic](https://www.skills.sh/topic/react)
- [skills.sh audits](https://www.skills.sh/audits)
- [React Thinking in React](https://react.dev/learn/thinking-in-react)
- [React purity rules](https://react.dev/reference/rules/components-and-hooks-must-be-pure)
- [React 19 release notes](https://react.dev/blog/2024/12/05/react-19)
- [Next.js AI agents guide](https://nextjs.org/docs/app/guides/ai-agents)
- [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Playwright trace viewer](https://playwright.dev/docs/trace-viewer)
- [Playwright best practices](https://playwright.dev/docs/best-practices)
- [Playwright locators](https://playwright.dev/docs/locators)
- [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)
- [web.dev Core Web Vitals](https://web.dev/articles/vitals)
- [web.dev animation performance](https://web.dev/articles/animations-guide)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WCAG Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
- [WAI-ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [NN/g 10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [NN/g visual hierarchy](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/)
- [Carbon spacing](https://carbondesignsystem.com/elements/spacing/overview/)
- [Carbon typography](https://carbondesignsystem.com/elements/typography/overview/)
- [Tailwind theme variables](https://tailwindcss.com/docs/theme)
- [shadcn theming](https://ui.shadcn.com/docs/theming)
- [OWASP LLM supply-chain risk](https://genai.owasp.org/llmrisk/llm032025-supply-chain/)
- [OWASP prompt injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
- [SLSA provenance](https://slsa.dev/spec/v1.2/provenance)

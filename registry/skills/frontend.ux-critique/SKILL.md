---
name: ux-critique
description: Critique frontend user flows for task completion, information architecture, forms, affordances, feedback, empty/error states, cognitive load, and usability risk.
---

# UX Critique

Use this skill when reviewing a frontend flow, screen, form, onboarding path, checkout path, navigation model, or task workflow for usability. Do not use it for visual styling-only polish, framework review, or pure accessibility audits unless the request is about user flow and comprehension.

## Decision Rules

- Evaluate whether the user can complete the job, not whether the UI merely looks clean.
- Ground critique in a concrete persona, task, and success condition.
- Separate blockers from polish. Not every issue deserves the same urgency.
- Treat empty, loading, error, destructive, permission, and recovery states as part of the flow.
- Avoid vague advice such as "make it clearer"; name the decision, affordance, label, or feedback that fails.
- Use established UX heuristics as gates: system status, real-world language, user control, consistency, error prevention, recognition over recall, efficient paths for repeat users, minimalist focus, and constructive error recovery.
- Treat generic AI copy as a usability risk when it hides the user's actual decision, next step, or consequence.
- Treat visual slop as UX risk when it weakens task hierarchy, trust, information scent, state comprehension, or mobile usability.
- Critique from the product's object model and workflow, not from generic SaaS page expectations.

## Flow First Gate

Before critiquing or proposing a screen, name the primary flow:

- Entry: how the user arrives and what they already know.
- Main action: the one task the screen must make easy.
- Feedback: how the UI confirms progress, saves, waits, validates, or fails.
- Success: what completion looks like and what the user can do next.
- Recovery: how the user retries, edits, reconnects, requests access, undoes, or exits safely.

If the screen cannot be mapped to this flow, treat that as a UX finding rather than polishing the surface.

## Severity Scale

- S4 Critical: blocks the primary task, risks data loss, or creates serious trust/safety issues.
- S3 Major: likely causes abandonment, wrong choices, or repeated support burden.
- S2 Minor: slows users down or causes recoverable confusion.
- S1 Polish: improves confidence or clarity but does not block task completion.

## Workflow

1. Define the user, task, entry point, completion state, and business/user goal.
2. Identify the user's vocabulary and mental model. Replace implementation terms with terms the user recognizes.
3. Walk the flow step by step:
   - information scent;
   - affordances;
   - decision points;
   - feedback;
   - form labels and errors;
   - navigation and escape routes;
   - recovery from failure.
4. Inspect state coverage: first-run, empty, loading, partial data, validation error, server error, disabled, saving, success, permission denied, and destructive confirmation.
5. Identify cognitive load: unnecessary choices, unclear labels, duplicated controls, hidden dependencies, memory burdens, and weak hierarchy.
6. Check whether the visual hierarchy supports the task or merely looks polished.
7. Check information architecture and navigation fit: object model, role-specific entry points, saved views, breadcrumbs, search/command palette, settings scope, and permission boundaries.
8. Check microcopy specificity: labels, CTAs, headings, empty states, errors, AI outputs, trust markers, and data realism.
9. Produce prioritized findings with severity and concrete fixes.
10. Verify that proposed changes preserve accessibility and implementation constraints.

## Anti-Slop UX Checks

- Generic dashboard: Does it show decorative KPI cards instead of exception queues, decision strips, tables, saved views, or workflows?
- Generic landing page: Does each section advance an argument, or is it hero, logo row, feature cards, testimonials, pricing by habit?
- Generic form: Are labels, grouping, validation, hints, and buttons tied to the user's task, or is it a wall of same-width inputs?
- Generic onboarding: Does first run produce a meaningful outcome, or only welcome users and ask cosmetic preferences?
- Generic AI: Are AI outputs labeled with source, uncertainty, review controls, and consequences, or presented as magic?
- Generic mobile: Does mobile preserve task priority and action reachability, or blindly stack desktop sections?
- Generic copy: Could labels and CTAs fit any app? Replace with domain nouns and verbs.

## IA And Flow Patterns

- Build navigation around durable objects and core loops, not generic areas like Dashboard, Resources, Tools, and Activity.
- Use role-aware landing surfaces rather than separate role-based products when objects are shared.
- Command centers should answer what changed, what is blocked, what needs attention, and what to do next.
- Saved views are navigation for repeated work: `My open tasks`, `Failed runs`, `At-risk renewals`, `Needs approval`, `Unassigned`.
- Split panes fit triage, review, comparison, and high-throughput workflows; avoid them for simple one-off tasks.
- Settings need clear scope: personal, workspace, project, team, billing, security, integrations, AI agents.
- For agent-heavy products, expose runs, traces, instructions, approvals, failures, memory, evaluations, and cost as navigable objects.

## UX Copy Rules

- CTAs should name the action and object: `Review 12 high-risk renewals`, `Import claims CSV`, `Retry failed sync`.
- Empty states explain what belongs there, why it is empty, and the best next action.
- Errors explain problem, affected object, cause if known, and recovery path without blame.
- Disabled actions should explain why they are unavailable when users reasonably expect to use them.
- Trust-sensitive claims need evidence, source, recency, or caveat near the claim.

## AI-Specific UX Rules

- Agent-heavy products should expose runs, traces, tool calls, approvals, failures, memory, evaluations, cost, and recovery as user-understandable objects when those affect trust or task completion.
- Generated output needs provenance: sources, citations, confidence or uncertainty where useful, and clear controls to inspect, edit, accept, reject, regenerate, or export.
- Long-running AI tasks need progress, partial results, pause/stop, retry/resume, and failure recovery rather than a vague spinner or magical completion state.
- Permission-sensitive AI actions need explicit confirmation, scope, consequences, and a path to revoke or delete access where appropriate.
- AI memory and personalization should be visible and manageable; hidden memory is a UX and trust risk.
- Editable AI artifacts need version or undo paths when regeneration, tool calls, or accepting suggestions can overwrite user work.

## Validation

- Each finding should name the affected step, user intent, and likely failure mode.
- Fixes should be testable with a user action or visible state.
- Recommended copy should be plain, action-oriented, and consistent across control, confirmation, toast, and error states.
- If screenshots or a running app are unavailable, state which flow states still need observation.

## Output Contract

- Flow and user task first.
- Prioritized findings with S4-S1 severity.
- Evidence inspected or missing.
- Recommended copy/layout/interaction changes.
- Residual risks and validation steps.

# ADR 0006: Core-Owned Always-On Guidance Skills

- Status: Accepted
- Date: 2026-08-12
- Scope: Router composition, strict-v2 runtime, registry and domain packs, config surface

## Context

SkillRanger ships an author-curated skill library today scoped to the frontend domain: every bundled skill is domain-specific, routed per task, and the catalog requires each skill to declare complete routing metadata referencing a known Domain Pack. There is no mechanism for always-on, domain-agnostic guidance — behavioral rules the agent must follow on every piece of work regardless of which domain skill is selected. Agents working without such rules drift toward speculative scope, over-engineering, and unsafe actions (secret exposure, destructive operations, history erasure).

The maintainer wants two such rules — "Proportional Engineering" and "Universal Safety" — shipped as first-class, audited SkillRanger skills, with more to follow.

## Decision

A new class of **core (universal) skills** ships as always-on behavioral guidance owned by a new minimal `core` Domain Pack:

- **Included in every prepared run** (strict and non-strict, both routing modes), delivered **first** in router-level mandatory read order, bounded by a new configurable `maxCoreSkills` limit (default 3, 0..4).
- **Audited and catalogued like curated skills** — full routing metadata, static audit, visible under the `core` domain in the skill catalog.
- **Guidance-only**: core skills carry no execution contract and are **excluded from the strict runtime's contract/verification machinery**, which cannot represent contract-less skills. They are delivered exclusively through router-level mandatory reads; `strictMissing` skips them, `createPreparedStrictSkillRun` skips them when flattening selections, and `verify_skill`/`finalize_skill_run` never see them — so guidance-only status can never make a run unverifiable.
- **Context-budget honest**: core skills count toward `maxInstructionBytes` but not toward `maxTotalSelectedSkills` or the `maxAgentContextSkills` slot; they are protected from `removeWeakest` eviction, and a budget overflow fails deterministically naming the core skill ids among `blockingSkillIds`.
- **Conflict-safe**: a symmetric conflict with a selected task skill rejects that task skill; a conflicting required primary fails explicitly with the `skill-conflict` reason.
- **Veto-compatible**: a host nominating a core skill in a proposal role receives the existing `nominated-role-ineligible`/`role-not-published-by-skill` rejection — core skills are auto-included regardless of nomination.
- **Installed at user scope by default** in the reference flows (one lockfile covers all projects); repo scope remains an option for team pinning.

### The `domain:core` vs `core:core` owner distinction

The `core` domain pack deliberately reuses the "core" owner concept from routing vocabulary. The pack's vocabulary owner key is `domain:core`, which is distinct from the code-embedded `core:core` vocabulary — no collision. The pack vocabulary stays minimal (a single `agent-behavior` intent entry) and the pack contributes **no deterministic recall baseline**, because the owner id `core` is filtered from host owner sets by the resolver and from direct-signal domain resolution by the segmenter — the always-on domain must never interfere with routing. A regression test guards this (a frontend task whose prompt contains the word "core" still routes to the frontend domain).

## Considered options

- **Always-on install only** (users install core skills like task skills and the agent loads them through its own mechanics): rejected — no guarantee the rules are present in a SkillRanger-prepared run, no read-order guarantee, no context-budget honesty, and no protection from strict-mode incompatibility. Native agent-side loading remains best-effort only.
- **Managed guidance extension** (extend `host-guidance.ts` / the setup-written AGENTS.md block): rejected — that surface is a fixed setup artifact, not a versioned, audited, catalogued skill; adding rules there bypasses the audit and catalog contracts and the trigger model is out of scope.
- **Minimal fake contracts for strict runs** (give guidance skills a trivial contract v2 so the strict machinery can carry them): rejected — it would fabricate steps and gates for content that produces no evidence, corrupting the strict run's contract semantics and its verification meaning.
- **Core-owned always-on skills with strict-runtime exclusion (chosen)**: the run's prepared display keeps the core selections under the `agent-context` role, the strict runtime remains contract-faithful, and future universal rules ship by adding a registry package under the `core` domain — no router code changes.

## Consequences

- The `core` domain pack and both skills are new shipped artifacts; the catalog contract fixtures and registry tests reflect 2 domains / 20 skills.
- Router config gains `maxCoreSkills` (default 3) in defaults, types, validation, and `router-config.schema.json`.
- Strict runs include core skill reads (first in `requiredReads`) but no core ledgers; lifecycle-v1 runs include them in selections with `unverified` display status.
- The Core skill checklist in `docs/REGISTRY.md` sets the promotion bar for future universal rules.
- Golden router cases for both routing modes prove a frontend task run includes both core skills; `pnpm eval:router` gates them.

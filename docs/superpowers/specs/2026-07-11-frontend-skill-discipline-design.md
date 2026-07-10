# Frontend Skill Discipline and Russian Routing Design

## Summary

SkillRanger will make frontend skill use more reliable for Russian-speaking users and less dependent on a model's voluntary instruction following. The change combines deterministic multilingual routing, a domain-neutral skill-run lifecycle, risk-based clarification gates, managed agent context, and existing frontend verification contracts.

The system will not claim that it can force an external model to use a skill. It will instead make skill selection and execution auditable and refuse the `verified` outcome when the required lifecycle or evidence is incomplete.

## Goals

- Route Russian frontend requests with the same specificity and determinism as equivalent English requests.
- Treat an explicit request to use skills as a control intent that requires a recorded skill lifecycle.
- Require clarification before material frontend work when critical product facts are unknown.
- Record which skills were recommended, selected, read, executed, and verified.
- Reuse the existing `DesignBrief`, browser observation, and `VerificationReport` contracts instead of creating a second frontend QA system.
- Deliver the same lifecycle through CLI and MCP so Codex, OpenCode, and other supported agents can use it.

## Non-goals

- Building a model orchestration wrapper or replacing OpenCode, Codex, or other agent runtimes.
- Proving cryptographically that a third-party model understood a SKILL.md file.
- Adding probabilistic embeddings, an external morphology service, or an NLP dependency.
- Translating every SKILL.md document into Russian.
- Changing existing frontend design artifact schema versions as part of this work.

## Architecture

### Multilingual intent layer

Frontend routing aliases move out of the inline collections in `src/domains/frontend/routing.ts` into locale-specific data packs for English and Russian. A shared normalizer performs Unicode-aware tokenization, lowercasing, `ё` to `е` normalization, punctuation removal, and a deterministic alias lookup for common Russian inflections. It does not perform stemming or fuzzy semantic matching.

Each locale pack maps phrases and tokens to canonical intent tags. Routing policies consume canonical tags rather than duplicating language-specific conditions. English behavior remains the compatibility baseline.

The Russian pack covers every frontend skill owned by the frontend domain manifest. It also defines control intents for phrases such as `используй скиллы`, `используй frontend-скиллы`, and equivalent requests to explain why skills were not used. A control intent requires lifecycle creation but does not by itself select an unrelated frontend skill; the task portion of the prompt still determines the primary skill and companions.

### Domain-neutral skill-run lifecycle

A new core runtime contract is stored at `.skillranger/runs/<runId>.json`. It is independent of frontend-specific types so future domain packs can attach their own policies.

The run artifact records:

- schema version and run identifier;
- target agent, domain, detected locale, creation and update timestamps;
- an intent digest and normalized goal; raw prompt storage is opt-in;
- the recommendation snapshot and selected primary and companion skills;
- skill-read records containing skill id, version, checksum, and timestamp;
- clarification status, questions, answers, declined questions, and explicit assumptions;
- execution status and produced artifact references;
- verification report references, final outcome, and normalized findings.

The lifecycle state machine is:

`created -> skills-selected -> skills-read -> clarified -> running -> implemented -> verified`

Valid terminal alternatives are `implemented-unverified`, `failed`, and `blocked`. Transition validation is centralized in the core runtime. Invalid transitions do not modify the run file and return a machine-readable error with a remediation action.

`verified` requires all selected mandatory skills to have matching read records, a resolved clarification gate, and a verification report whose hard gates passed. Missing browser capability can produce `implemented-unverified`, never `verified`.

### CLI and MCP parity

The public CLI adds:

- `skillranger run:start`
- `skillranger run:record-read`
- `skillranger run:resolve-clarifications`
- `skillranger run:complete`
- `skillranger run:verify`
- `skillranger run:inspect`

MCP exposes equivalent tools with the same input and output contracts. Both surfaces call the same runtime service and persistence layer. Commands are idempotent where repeating the same event is safe; conflicting repeats fail without overwriting prior evidence.

### Managed agent context

`skillranger setup` creates or updates a bounded SkillRanger block in the repository `AGENTS.md`. The block instructs supported agents to:

1. start a run before skill-driven work;
2. announce the selected primary and companion skills;
3. record each required SKILL.md read;
4. resolve required clarifications before implementation;
5. complete verification before claiming `verified`.

The block is enclosed by stable start and end markers. Repeated setup updates the existing block without duplication and preserves all user-authored content outside the markers. `setup --no-agent-context` is the explicit opt-out.

## Frontend Policy Adapter

### Risk-based clarification

The frontend adapter classifies work as bounded or material using the selected skill, canonical intents, and available design brief.

Material redesign, new frontend generation, and design-to-code work require clarification when any of these facts are unknown:

- primary user or actor;
- primary task;
- primary action;
- provenance of content, metrics, testimonials, brand claims, or references.

The adapter produces no more than three questions per clarification round. Every question identifies the field it resolves.

Bounded local fixes do not block. They record explicit assumptions and continue with existing project conventions.

If a user declines clarification for material work, the run enters a constrained fallback rather than silently inventing answers. The fallback preserves existing conventions, permits one signature move, uses neutral placeholders, and forbids invented metrics, testimonials, people, brands, and unsupported product claims.

The existing `DesignBrief` evidence ledger remains the source of observed, inferred, assumed, and unknown product facts. Clarification state lives in the run artifact, so the strict design brief schema stays at version `1.0`.

### Frontend verification

The adapter reuses existing browser observation and `VerificationReport` validation. A frontend run cannot become `verified` until its applicable hard gates pass, including declared viewport and state evidence, runtime integrity, keyboard and focus findings, reduced motion, and critical accessibility findings.

The lifecycle stores references to these artifacts rather than copying their full contents. Referenced report identity and outcome are validated when the run is verified.

## Error Handling and Integrity

- Missing or corrupt run artifacts return a typed error and are never partially rewritten.
- Persistence uses atomic replacement so an interrupted update leaves the previous valid run intact.
- A skill checksum mismatch requires the agent to read the currently installed version again.
- A selected companion marked mandatory by domain policy cannot be omitted from read evidence.
- A verification report for a different domain or workflow cannot close the run.
- Raw prompts are not stored by default. The run stores a SHA-256 digest and normalized goal; an explicit flag enables local raw prompt storage.
- Managed `AGENTS.md` updates fail safely when markers are malformed instead of replacing ambiguous user content.

## Evaluation and Acceptance Criteria

### Multilingual routing

- Every frontend skill owned by the domain manifest has at least three Russian should-trigger prompts, one ambiguous prompt, and one non-trigger prompt.
- Every promoted frontend skill has at least one Russian task-eval.
- English routing metrics do not regress from the frozen baseline.
- Tests cover case, punctuation, `ё/е`, common inflections, and mixed Russian-English prompts.
- Explicit Russian skill-control prompts create lifecycle-required routing results without causing unrelated frontend recommendations.

### Clarification policy

- A sparse material redesign is blocked before implementation and returns field-linked questions.
- A complete brief proceeds without redundant questions.
- A declined clarification produces the constrained fallback and records assumptions.
- A bounded repair proceeds with assumptions and no blocking interview.
- Unknown content provenance prevents generated metrics and testimonials from satisfying the execution gate.

### Lifecycle and agent context

- Tests cover every valid transition and rejection of every skipped required state.
- Missing skill reads, stale checksums, omitted mandatory companions, and failed hard gates prevent `verified`.
- Repeating an identical safe command is idempotent; conflicting repeats fail without mutation.
- CLI and MCP produce equivalent run artifacts for the same event sequence.
- Managed `AGENTS.md` creation, update, opt-out, malformed markers, and preservation of user text are covered.

### Release checks

The release gate runs the TypeScript build and syntax checks, the complete test suite, registry validation, skill lint, audit checks, and frontend routing evaluation for English and Russian slices.

The existing repeated task runner gains a documented Russian comparison profile for running GLM and DeepSeek under the same OpenCode fixture, prompt set, skill versions, and repetition count. External model execution evidence is stored for analysis but is not required for an ordinary local build.

## Compatibility and Rollout

- Existing skill manifests, design briefs, directions, verification reports, lockfiles, and installed skill paths remain valid.
- The new run artifact starts at schema version `1.0` and is additive.
- Existing `recommend` and `setup` command behavior remains available; setup adds managed context by default and supports explicit opt-out.
- Frontend is the first domain policy adapter. The core lifecycle accepts other domains later without frontend dependencies.
- Documentation states the guarantee boundary: SkillRanger can validate evidence and withhold `verified`, but an external agent can still bypass SkillRanger entirely.

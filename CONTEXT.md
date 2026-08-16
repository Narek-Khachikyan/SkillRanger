# SkillRanger Domain Context

This glossary defines the project-specific language used for skill execution and frontend visual verification.

## Model-assisted routing

**Skill catalog**:
The complete bounded metadata view of the audited bundled registry that a host agent receives before it proposes skills. It contains selection metadata, not skill instructions or arbitrary locally discovered files.
_Avoid_: Search results, installed-skill list, instruction bundle

**Routing proposal**:
A catalog-bound, prompt-grounded interpretation and ordered set of skill nominations produced by the host agent. It proposes semantic relevance but does not authorize or select a skill.
_Avoid_: Model selection, routing decision, final skill set

**Skill nomination**:
A host agent's evidence-grounded claim that one catalog skill should fill one routing role. A nomination remains subject to routing hard vetoes and composition limits.
_Avoid_: Selected skill, forced skill, recommendation result

**Nomination resolution**:
The deterministic routing decision that applies explicit user choice, nomination order, and declared ambiguity to produce a primary workflow or fallback before a run is created.
_Avoid_: Skill selection, final skill set, composition

**Retrieval boundary**:
The projection of one retrieval result into bounded eligibility facts for the primary nomination decision; facts can never disagree with the retrieval they were derived from.
_Avoid_: Precomputed candidate result, eligibility snapshot, candidate feed

**Vocabulary recall gap**:
A class of routing failures where a task expresses a relevant intent, but the deterministic vocabulary does not recognize its phrasing, so the intent never reaches composition.
_Avoid_: Missing skill, composition failure, host failure

**Composition recall gap**:
A class of routing failures where a relevant supporting skill reaches composition but is omitted because it adds no formally uncovered task requirement, despite providing complementary expertise.
_Avoid_: Vocabulary miss, ineligible skill, host failure

**Routing hard veto**:
A deterministic eligibility or integrity rule that prevents a skill nomination from entering the prepared skill set. It protects audit, risk, compatibility, capability, installation, conflict, and context guarantees; it does not judge semantic relevance.
_Avoid_: Low relevance score, model disagreement, soft penalty

**Catalog receipt**:
Proof that the host received every part of one skill catalog snapshot. It proves delivery, not comprehension or correct skill nomination.
_Avoid_: Model-read proof, catalog approval, verified selection

**Model-first semantic routing**:
A routing contract in which the host agent interprets task meaning against the bounded skill catalog and submits ordered, role-specific skill nominations. SkillRanger does not delegate authority: it validates the routing proposal, applies hard vetoes and composition limits, and produces the final skill set. Local vocabulary is a limited fallback and does not promise equivalent semantic recall.
_Avoid_: Model-selected workflow, delegated trust, deterministic semantic interpretation

**Routing mode**:
The canonical provenance class of a routing result: `model-assisted` when a valid routing proposal participates, or `limited-deterministic-fallback` when no routing proposal is submitted. It describes how semantic relevance was supplied, not whether execution is verified.
_Avoid_: Strict mode, verification mode, routing quality score

**Limited deterministic fallback**:
The local vocabulary routing path used only when the host submits no routing proposal. It remains deterministic but does not promise semantic recall equivalent to model-first semantic routing.
_Avoid_: Invalid-proposal recovery, degraded strict mode, model-assisted routing

**Routing world**:
The one module that loads the routing-relevant world — router packs, router skill metadata, canonical routing documents, domain metadata, and the routing context — from a registry. Task preparation and router evaluations build their routing input through it, delivered to the Routing entry; router config, triggers, fingerprints, routing dates, and limits stay with the adapters.
_Avoid_: input loader, metadata cache, pipeline preparation, registry snapshot

**Routing entry**:
The one deep, in-memory entry that every adapter calls with a preloaded Routing world and adapter-owned handles. It assembles the Routing pipeline input and owns the shared decision-shaping rules (capability normalization, fallback warning placement), so task preparation and both router evaluation suites route through the same surface. The Routing pipeline stays the exported pure core; the entry wraps it, never changes it.
_Avoid_: routing service, router orchestration, input factory, task preparation

**Routing pipeline**:
The one deep, deterministic, in-memory module that turns a preloaded input object (router skill metadata, a skill catalog snapshot, config limits, a routing proposal or semantic hints, trigger info, activation) into a routing decision. Task preparation and router evaluations are adapters over it; continuation tokens, persistence, and strict feasibility live outside it.
_Avoid_: Task preparation, router orchestration, routing service

## Positioning

**Author-curated skill library**:
The hand-crafted, pre-audited set of agent skills authored and maintained by the SkillRanger author, shipped in the bundled registry. It is the product's primary identity; routing, audit, and installation are delivery mechanics on top of it.
_Avoid_: generic skill registry, third-party collection, package-manager content.

**Multi-domain coverage**:
The library is designed to span several directions rather than one stack; frontend ships today, and each additional direction is announced only when it actually ships.
_Avoid_: frontend-only product, fixed domain scope, announced-but-unshipped domains.

**Content-first positioning**:
The public framing of SkillRanger as an author-curated skill library with routing and integrity tooling, rather than as a generic skill installer or package manager. The term "package manager" is not used in public copy.
_Avoid_: tool-first framing, installer framing, package-manager framing.

## Verification

**Verified outcome**:
A result whose hard gates passed against accepted evidence; a structurally valid input or parsed payload is not itself verified.
_Avoid_: accepted payload, parsed result, implemented result.

**State-transition evidence**:
Evidence that connects a concrete user action to an observed before/after change in one or more dependent UI representations.
_Avoid_: state assertion, pass flag, interaction claim.

**Host-attested actor separation**:
Different generator and critic identities supplied by the host to record role separation; it does not prove that the two roles ran independently.
_Avoid_: proven independent execution, independent critic proof.

**Domain validator**:
A domain-owned check that evaluates the meaning of evidence for one domain and reports whether a declared verification gate passes. It does not own run state, repair, or finalization.
_Avoid_: generic evaluator, evidence-presence check, finalization policy.

**Generic evaluator**:
A core-owned check of evidence structure or integrity that does not depend on one domain's meaning.
_Avoid_: domain validator, domain policy.

**Validator registry**:
The trusted set of generic evaluators and selected domain validators available to one strict run. It determines whether a declared validator can be evaluated; it does not select skills.
_Avoid_: global skill registry, executable skill package.

**Gate evidence projection**:
A bounded view of accepted evidence and the minimal context needed to evaluate one declared verification gate. It does not expose the whole strict run.
_Avoid_: full run state, arbitrary file access, raw project context.

**Gate result**:
A deterministic pass or fail outcome for one declared verification gate, with an optional diagnostic. It does not decide run lifecycle, repair, or finalization.
_Avoid_: verified outcome, repair request, run state.

## Frontend design research

**Reference corpus**:
A bounded, provenance-recorded set of public design sources used to propose and compare reusable design patterns. It supplies hypotheses, not templates, brand assets, or proof that a pattern should be promoted.
_Avoid_: source of truth, copyable design library.

**Extractor output**:
A tool-generated `DESIGN.md`, token set, or configuration derived from a public page. It must retain its source and schema, then be normalized into SkillRanger's own versioned rule contract; it is not that product's canonical design system.
_Avoid_: official product tokens, drop-in skill content.

## Frontend design promotion

**Bundled design rule**:
A brand-neutral, reusable design constraint that recurs across independent sources and can be checked through observable visual and accessibility evidence.
_Avoid_: source-specific styling, a copied product treatment.

**Provenance-labelled worked example**:
An explanatory good/bad design artifact that may preserve source-specific detail, while retaining provenance and remaining non-copyable production guidance.
_Avoid_: production template, unlabelled reference screenshot.

**Tiered promotion bar**:
Both bundled rules and worked examples require complete human-reviewed evidence and passing hard gates; bundled rules additionally require generalizability and recurrence, while worked examples may remain source-specific when provenance is explicit.

**Full promotion evidence bundle**:
The complete frozen visual benchmark evidence used to certify a frontend promotion, rather than a reduced pattern-specific slice.

**Independent human review**:
Two people separately judge the blinded alternatives and record their own criterion scores, preference, catastrophic-failure flags, and notes; neither review substitutes for the other.

**Promotion-certifying run**:
A run whose evidence is complete, whose outcome is verified, and whose hard gates and critical findings are clean; a failed or falsely verified run cannot support promotion.

**Aggregate blind preference**:
The equal-weight preference share across the independent human reviews, calculated from decisive blinded comparisons; ties and abstentions are not wins.

**Baseline comparison**:
A controlled comparison of the current frontend workflow with both a no-skill baseline and the prior prose-skill baseline, using the same model, fixture, repetitions, and assertions.

## Frontend design craft

**Craft layer**:
A provenance-labelled reference corpus of parametric design knowledge — type pairings, palette recipes, macrostructures, component cookbooks — that the design skill loads advisory-style during a build. It is not a bundled design rule until it passes the tiered promotion bar.
_Avoid_: theme catalog, design library, template pack

**Macrostructure**:
A named page-level composition shape (hero placement, body, divider, button voice, image treatment) that the direction step picks explicitly and states out loud, preventing default-attractor sameness.
_Avoid_: layout template, page pattern

**Theme axes**:
The declared cross-build identity dimensions — paper band, display style, accent hue — that the direction records alongside the named macrostructure. They supplement, not replace, the direction's existing treatment axes.
_Avoid_: theme rotation, color swap, third axis system

**Diversification gate**:
A deterministic hard gate that compares a design direction's identity fingerprint (theme axes + macrostructure + the existing composition/material treatment axes) against a snapshot of the last N verified run directions, requiring deviation on at least one dimension. The snapshot is recorded in the verification report so replay re-checks the same set.
_Avoid_: variety check, repetition log, live re-derivation

**Diversification log**:
A project-scoped, tooling-derived cache (`.design/diversification-log.json`) written from verified run facts for the model's in-session awareness during a build. It is not written by the model and is not the enforcement mechanism; the gate decides.
_Avoid_: model-written ledger, enforcement cache, identity history gate

**Design DNA extraction**:
A structured mode that reads a reference design's macrostructure, type pairing, and colour anchor into a provenance-labelled artifact without copying pixels or trade dress.
_Avoid_: design scraping, pixel clone, study analysis

**Slop-tell**:
A closed, named anti-pattern code in the visual critic report that marks a design default as AI-generated; each tell carries a severity and a fix direction.
_Avoid_: heuristic, style guideline, checklist item

## Runtimes and migration

**Lifecycle-v1 runtime**:
The legacy persisted-run runtime whose verification report is authored by the host agent and validated by the server. It receives stopgap ergonomics only; structural verification work routes to strict-v2 instead.
_Avoid_: default runtime, maintained runtime, verification path going forward

**Strict-v2 runtime**:
The runtime whose declared verification gates are evaluated server-side from attached evidence; the host never authors a verification report. It is the only path that can certify a strict run.
_Avoid_: new lifecycle, report-in runtime, verified mode

**Strict migration**:
The act of a host opting into the strict-v2 runtime (`strict: true` on `prepare_task`, or the router config default). It is orthogonal to routing mode (model-assisted vs limited-deterministic fallback).
_Avoid_: routing migration, verification upgrade, mode switch

## Core (universal) skills

**Core skill / universal skill**:
A domain-agnostic behavioral guidance skill owned by the `core` domain pack and included in every SkillRanger-prepared run regardless of routing mode or strictness. It is audited and catalogued like any curated skill.
_Avoid_: domain skill, task procedure, always-on rule from host config

**Always-on inclusion**:
The deterministic composer behavior of adding core skills to every prepared run up to `maxCoreSkills`, independent of retrieval, nomination, and task-selection limits; they never consume the agent-context slot or the total-skill cap.
_Avoid_: default selection, automatic recommendation, side-effect of routing

**Guidance-only skill**:
A core skill class that carries no execution contract, input schema, gates, or verification evidence. It is delivered through router-level mandatory reads only and is excluded from the strict runtime's contract and verification machinery, so its presence can never make a run unverifiable.
_Avoid_: contract-less failure, unverified skill, fake-contract skill

**Enforced output contract**:
A manifest-declared set of report fields (`outputContract.requiredReportFields`) that lifecycle-v1 verification requires in the report's `universalContracts` section whenever the run selected the declaring skill (ADR 0008). Missing or empty fields block verification; the server writes the canonical report file.
_Avoid_: advisory output contract, prose-only contract, unenforced checklist

**Core domain pack**:
The minimal `core` domain pack (`domains/core/`) that owns core skills and publishes a minimal `domain:core` routing vocabulary; it contributes no deterministic recall baseline, so it never interferes with task routing.
_Avoid_: routing domain, task domain, core:core vocabulary

# Model-Assisted Routing Specification

- Status: Implemented in 0.4.0
- Date: 2026-08-05
- Related: [ADR 0001](adr/0001-universal-prompt-router-boundaries.md), [ADR 0003](adr/0003-model-assisted-skill-nomination.md), [Routing Vocabulary](ROUTING_VOCABULARY.md), [Router Evaluations](router-evals.md)

## Purpose

Vocabulary-only routing is fast and deterministic, but it can miss a relevant skill when a prompt expresses an intent with an unregistered phrase. This specification adds host-model semantic nomination without moving model calls, trust decisions, or runtime integrity into SkillRanger.

The desired flow is:

```text
explicit trigger
  -> deliver the complete skill catalog
  -> host agent creates a routing proposal
  -> SkillRanger validates and composes the proposal
  -> host agent reads every mandatory selected instruction
  -> runtime work begins
```

## Scope

This change adds:

- a read-only MCP tool that delivers the complete audited bundled skill catalog;
- a versioned routing proposal accepted by `prepare_task`;
- deterministic arbitration between explicit user choice, host nominations, and the existing fallback;
- a side-effect-free catalog refresh outcome;
- contract and model-assisted evaluation coverage.

This change does not:

- make SkillRanger call a model;
- remove explicit activation;
- load arbitrary local skill directories or network registries;
- read unselected `SKILL.md` files during discovery;
- weaken audit, risk, strict installation, read-ledger, evidence, or finalization guarantees;
- replace the shared recommender scorer.

## Authority model

Routing responsibilities are split by decision type.

| Decision | Authority |
| :--- | :--- |
| Meaning of the prompt | Host agent |
| Semantic relevance and nomination order | Host agent |
| Explicit exact skill request | User, subject to routing hard vetoes |
| Registry trust and catalog membership | SkillRanger |
| Audit, risk, compatibility, capabilities, installation, conflicts, and budgets | SkillRanger |
| Dependencies and uncovered environment or verification roles | SkillRanger |
| Runtime creation, mandatory reads, evidence, and finalization | SkillRanger |

A vocabulary score may supplement or break a tie among fallback candidates. It must not displace an eligible host-nominated primary skill merely because its lexical score is lower.

## MCP discovery interface

### `inspect_skill_catalog`

`inspect_skill_catalog` is a read-only, closed-world MCP tool. Its tool description must tell a host that an explicit `@skillranger`, `/sr`, or supported terminal `skillranger` trigger starts this discovery flow. The tool works without repository setup.

The first request has no cursor:

```json
{}
```

A continuation request uses only the opaque values returned by the previous page:

```json
{
  "cursor": "opaque-cursor",
  "expectedCatalogDigest": "sha256:..."
}
```

The output has this logical shape:

```json
{
  "ok": true,
  "schemaVersion": "skill-catalog/1.0",
  "catalogDigest": "sha256:...",
  "domains": [
    {
      "domainId": "frontend",
      "displayName": "Frontend",
      "description": "..."
    }
  ],
  "skills": [
    {
      "skillId": "frontend.example",
      "displayName": "Example",
      "description": "...",
      "version": "1.0.0",
      "domains": ["frontend"],
      "roles": ["primary", "companion"],
      "actions": ["repair"],
      "artifactTypes": ["web-page"],
      "intentTags": ["responsive-layout"],
      "technologyTags": ["react"],
      "qualityGoals": ["responsive"],
      "requiredCapabilities": [],
      "riskLevel": "low",
      "supportedAgents": ["codex"]
    }
  ],
  "nextCursor": null,
  "complete": true,
  "catalogReceipt": "opaque-receipt"
}
```

Requirements:

- The snapshot contains every validated skill from the audited bundled registry and every shipped Domain Pack.
- Project fingerprint, installation state, target agent, and host capabilities do not filter the snapshot.
- Arbitrary local skills, test-fixture packs, untrusted registries, full skill instructions, scripts, and execution-contract content are excluded.
- Cards are projections of validated manifests and Domain Pack metadata. The tool does not generate summaries with a model.
- Ordering is canonical and stable: domains by canonical ID, then skills by canonical ID.
- Page boundaries are deterministic for one catalog digest.
- The first page exposes the complete domain overview. Every skill appears exactly once across the page sequence.
- `catalogReceipt` appears only on the complete page after a valid cursor chain. It proves delivery of the snapshot, not model comprehension.
- A digest change invalidates the cursor chain. The caller restarts from the first page.
- The tool performs no project scan, installation check, run creation, lockfile write, or managed-context write.
- The implementation sets explicit byte and item limits and never silently truncates a page or the catalog.

The catalog digest covers all fields that can affect host nomination, including Domain Pack routing metadata and the canonical card projection. It excludes project-local state.

## Routing proposal

`prepare_task` accepts an optional `routingProposal`. `semanticHints` remains available for existing callers. A caller must not submit both fields in one request.

```json
{
  "schemaVersion": "routing-proposal/1.0",
  "catalogDigest": "sha256:...",
  "catalogReceipt": "opaque-receipt",
  "interpretation": {
    "domains": ["frontend"],
    "actions": ["repair"],
    "artifactTypes": ["web-page"],
    "intentTags": ["responsive-layout"],
    "technologyTags": ["react"],
    "qualityGoals": ["responsive"]
  },
  "nominations": [
    {
      "skillId": "frontend.responsive-layout",
      "role": "primary",
      "confidence": 0.91,
      "evidenceText": "На телефоне всё съехало"
    }
  ]
}
```

The proposal is a closed structural value:

- unknown properties are rejected;
- canonical IDs must be owner-scoped metadata from the referenced catalog;
- nomination priority is the array order;
- one primary is accepted normally; an explicit ambiguity may name two or three primary nominations;
- at most two companions and at most two verification nominations are accepted;
- host nominations do not assign `environment` or `agent-context`; SkillRanger owns those roles;
- each nomination must have one non-empty exact quote from the normalized user intent;
- the quote grounds the inference but does not need to be a routing-vocabulary phrase;
- confidence is bounded diagnostic metadata, not ordering authority and not a hard-gate override;
- no free-form rationale or chain-of-thought field is accepted;
- duplicate skill and incompatible role claims are item-level nomination rejections.

Top-level structural failure rejects the proposal before preparation and creates no state. Nomination-level failures reject only the affected nominations, return stable warning reason codes, and allow remaining nominations to proceed. If no valid nomination remains, preparation uses the deterministic fallback.

The validated proposal persists only canonical IDs, bounded numeric values, reason codes, and evidence digests. Raw evidence text and model explanations are not persisted.

## Explicit user choice

An affirmative request to use an exact canonical skill ID in the normalized user intent is an explicit user choice. A negated ID, an ID inside code or a URL, a domain name, category, display name, or general word such as `frontend` is not an exact choice. Detection must be evidence-backed and must not treat bare occurrence as authorization.

Precedence is:

```text
routing hard vetoes
  -> explicit exact user skill choice
  -> valid host nominations in proposal order
  -> deterministic fallback
```

If an explicit user choice fails a routing hard veto, preparation returns the exact reason and does not silently substitute another skill.

## Proposal validation and composition

`prepare_task` validates the proposal against the current trusted registry before it performs composition:

1. Validate the closed proposal shape and size limits.
2. Recompute the catalog digest.
3. Validate the catalog receipt against that digest.
4. Validate interpretation IDs against owner allowlists.
5. Validate each nomination's skill ID, role, order, confidence, and exact prompt evidence.
6. Detect an exact user skill choice.
7. Run the existing project scan and compute current eligibility metadata.
8. Apply routing hard vetoes and compose the bounded skill set.
9. Create router and runtime state only after all pre-persistence outcomes are resolved.

Routing hard vetoes include at least:

- registry and audit integrity;
- configured maximum risk;
- target-agent compatibility;
- required capabilities;
- conflicts and supersession;
- strict installation, lockfile, file-set, contract, and input requirements;
- role and total-skill limits;
- instruction and context byte budgets.

A low lexical score, missing vocabulary phrase, or disagreement with the deterministic primary candidate is not a routing hard veto.

The existing composer remains responsible for dependencies, complementary skills, conflicts, missing environment and verification roles, and all budgets. Nomination priority is an input to that module, not a second scorer.

### Strict behavior

The first semantically preferred candidate that passes non-installation hard vetoes defines the strict workflow. If it fails installed-only strict requirements, preparation returns `strict_requirements_unmet` and installation suggestions. It does not substitute a less relevant installed workflow.

### Non-strict behavior

When a nomination fails a routing hard veto, composition tries the next valid nomination and records a stable warning. After valid nominations are exhausted, it may use the deterministic fallback. Audited bundled sources remain eligible without `skillranger setup`; matching valid installations retain source precedence.

## Model-declared ambiguity

The host may declare that two or more nominated primary skills represent a real semantic ambiguity:

```json
{
  "ambiguity": {
    "primarySkillIds": ["frontend.skill-a", "frontend.skill-b"]
  }
}
```

The list contains two or three IDs, and every ID must identify a valid primary nomination with prompt evidence. SkillRanger does not infer ambiguity from small confidence differences. If the choice changes the primary workflow, `prepare_task` returns the existing typed, closed-option clarification shape before any run is created. Without an explicit ambiguity declaration, the first eligible primary nomination wins.

## Catalog refresh outcome

A stale digest, invalid receipt, expired receipt, or interrupted cursor chain returns a normal side-effect-free preparation outcome:

```json
{
  "ok": true,
  "schemaVersion": "router-result/1.1",
  "status": "catalog_refresh_required",
  "reasonCode": "catalog-digest-mismatch",
  "currentCatalogDigest": "sha256:...",
  "nextTool": "inspect_skill_catalog"
}
```

No router run, runtime run, continuation, or partial selection is persisted. The host reads the catalog again and submits a new proposal.

## Activation and setup

Public MCP routing remains explicitly activated. Automatic activation is still outside the accepted router contract.

The MCP tool descriptions are self-contained and instruct the host to use catalog discovery before preparation when an explicit trigger is present. Therefore:

- a configured MCP server can perform non-strict model-assisted routing without `skillranger setup`;
- `setup` remains useful for installing strict workflows and writing managed agent guidance;
- the managed `AGENTS.md` block documents the catalog -> proposal -> preparation -> mandatory-read order;
- managed guidance remains advisory and is not a security boundary;
- an unconfigured MCP server cannot handle the trigger.

## Failure behavior

| Condition | Result |
| :--- | :--- |
| Old server has no catalog tool | Host may use legacy `prepare_task` without a proposal |
| Transient page transport failure | Retry the identical page request |
| Catalog integrity, manifest, or checksum failure | Fail closed; do not use fallback |
| Host cannot form nominations | Call `prepare_task` without a proposal |
| Individual nomination is invalid | Reject item, warn, and continue |
| Proposal catalog snapshot is stale | `catalog_refresh_required` |
| Explicit user choice is ineligible | Return the hard-veto reason; do not substitute |

## Core module seams

The MCP layer is an adapter. It must not load registries, issue receipts, validate proposals, or duplicate composition rules itself.

The implementation should expose two core module interfaces behind the existing `prepareTask` orchestration:

1. A catalog-delivery module accepts an optional opaque continuation and returns one deterministic page. It owns trusted registry loading, canonical projections, paging, digests, cursor validation, and final receipts.
2. A routing-proposal module accepts the untrusted proposal, normalized intent, and catalog snapshot. It returns validated canonical interpretation, ordered nominations, item rejection reason codes, or a catalog-refresh requirement.

The existing analyzer and composer consume the validated output. Existing eligibility and scoring implementations remain the only implementations of their respective rules. This keeps the external interface small and concentrates catalog and proposal invariants behind testable core seams.

## Compatibility and migration

- `routingProposal` is optional.
- Existing `semanticHints` requests retain their current behavior.
- Requests without either field retain deterministic routing.
- No feature flag is required.
- Existing persisted router and runtime schemas need no migration; only newly prepared runs may contain proposal-derived canonical digests and reason codes where their schemas permit them.
- The router result schema adds `catalog_refresh_required` and its closed fields.
- The MCP `prepare_task` input schema must publish the complete proposal shape rather than `{ "type": "object" }`.
- Routing mode participates directly in deterministic replay identity, so the deterministic routing algorithm advances to `router/2.1`. Continuation tokens bind the router algorithm version: an in-flight token minted under `router/2.0` fails verification with `continuation-invalid` after the upgrade and the host must re-issue the clarification. Tokens live at most 15 minutes, so no persisted state is affected.

## Verification strategy

### Deterministic contract evaluation

Checked-in fixtures provide frozen routing proposals. Tests and `eval:router` must prove:

- catalog completeness, stable order, deterministic paging, digest changes, and receipt validation;
- prompt grounding and owner-scoped proposal validation;
- item-level nomination rejection and fallback;
- explicit user choice and nomination precedence;
- affirmative, negated, code-span, and URL cases for exact user choice;
- hard-veto enforcement;
- strict non-substitution and non-strict next-nomination behavior;
- ambiguity clarification without partial runs;
- catalog refresh without partial runs;
- privacy canaries and deterministic replay;
- unchanged legacy results when no proposal is present.

All existing forbidden-selection, privacy, strict-eligibility, read-order, evidence, and finalization gates remain at least as strict as the current baseline.

### Model-assisted benchmark

A separate benchmark asks host models to read the catalog and nominate skills for prompts that include implicit intent, hard paraphrases, and indirect Russian paraphrases. It measures:

- primary-skill accuracy;
- recovery rate on vocabulary-only routing misses;
- role-aware full-set recall over the expected primary, companion, and verification skill IDs;
- irrelevant and forbidden selection rates;
- average selected skill count and instruction-byte cost;
- failure and fallback behavior for weak or malformed proposals.

Cases may declare `expected.roleAssignments` naming the expected skill IDs per routing role. The evaluator then compares the entire selected set by role instead of treating one acceptable primary as success: each role's recall is matched against its expected IDs, full-set recall aggregates all roles, and failure output names the missed role and shows the expected versus observed role assignments. The representative motion scenario expects motion design as primary, interaction polish as companion, and motion audit as verification for both direct English intent and an indirect Russian request to make the interface feel more alive; a generic site request must not pull in the motion workflow (motion design as primary or interaction polish as a companion), while the motion-audit skill remains eligible as a verification audit for requests whose quality goals warrant one.

Every evaluated run also asserts honest routing provenance: proposal-less runs must report `limited-deterministic-fallback` with `semantic-recall-limited`, proposal-backed runs must report `model-assisted` without it, and rejected or refresh outcomes must not fabricate a mode.

The initial promotion bar is:

- no regression on the existing deterministic corpus when proposals are absent;
- zero forbidden selections and zero privacy leaks;
- all routing hard vetoes remain effective;
- at least 80% of curated vocabulary-only misses are corrected by the model-assisted path;
- invalid or absent nominations do not produce a worse result than deterministic fallback, except where fail-closed catalog integrity requires stopping;
- role-aware full-set recall of at least 90% across all role-declaring cases.

Role-aware full-set recall below 90% is the agreed signal that a future retrieval design decision should be reconsidered as the catalog grows; it does not by itself authorize retrieval.

Model-assisted benchmark results are evidence about host nomination quality. They are not themselves a verified outcome unless the applicable hard gates pass against accepted evidence.

## Acceptance criteria

The design is complete when:

1. An explicitly activated host can receive every trusted catalog card without project setup or project filtering.
2. A host can submit a catalog-bound, prompt-grounded routing proposal with exact skill IDs.
3. An eligible nominated primary outranks the vocabulary scorer.
4. No proposal can bypass a routing hard veto or mandatory-read requirement.
5. Strict and non-strict substitution behavior matches this specification.
6. Stale catalog state creates no partial run and yields a recoverable refresh outcome.
7. Legacy callers and deterministic replay remain compatible.
8. Contract evaluations and the model-assisted promotion bar pass.

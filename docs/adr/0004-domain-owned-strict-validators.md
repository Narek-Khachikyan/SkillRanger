# Domain-owned strict validators

- Status: Accepted
- Date: 2026-08-07
- Scope: strict runtime verification

Strict runtime must keep generic evidence and integrity evaluation in Core, while a domain validator owns the meaning of evidence for its domain. The trusted `validator registry` is resolved from persisted selected skill ledgers for every verification and finalization operation; strict runtime receives a resolver through its construction seam instead of importing frontend-specific implementations.

## Decision

- `core/<name>` belongs to strict Core; `<domain>/<name>` belongs to that domain pack. Duplicate IDs are rejected.
- Contract validation is two-phase: phase 1 accepts only syntactically valid Core or domain IDs, then selected domain packs validate domain ownership before the run starts. Bundled registry validation still checks ownership against the static bundled validator catalog, preserving fail-fast validation.
- `artifacts.validators` remains a declarative manifest list of rule artifacts. It is not executable code and is not dynamically loaded as code. Existing frontend validators move as trusted static code; a data-driven rewrite is out of scope.
- A domain validator receives a gate evidence projection: accepted artifacts and minimal context for one gate. It cannot inspect the full run, read arbitrary files, use the network, or spawn processes.
- A validator returns a gate result keyed by `gateId`. It cannot create gates, rule IDs, repair requests, or run states. Strict Core owns gate aggregation, repair budget, lifecycle, and finalization.
- A missing domain pack or trusted implementation prevents preparation with `strict_requirements_unmet` on the router path and `strict-contract-missing` on the legacy path. A missing result for a known validator is a failed gate and follows the existing `blocked` and `run-blocked` path.
- Legacy and router strict preparation paths use the same registry and verification semantics. Existing validator IDs, gate IDs, persisted schemas, and ADR 0002 causal-evidence semantics remain unchanged.

## Consequences

- Frontend-specific derivation moves behind the domain-pack seam; strict Core no longer contains a frontend validator allowlist or implementation dispatch.
- `StrictSkillRunStore` resolves a fresh immutable registry from persisted selected ledgers during both skill verification and finalization; it does not retain a prepare-time registry.
- Multi-domain runs expose only validators owned by their selected skill ledgers; `core/*` is available to all ledgers.
- Existing persisted runs remain loadable without a new registry-digest field. Existing validator semantics are protected by persisted-run fixtures and regression tests.
- Tests split by ownership: Core tests cover registry, contract ownership, missing results, repair, and finalization; domain tests cover evidence meaning and validator derivation.

## Rejected options

- A global validator registry containing every domain was rejected because it grants unnecessary authority and hides ownership.
- Executable validators from skill packages or manifest paths were rejected because SkillRanger does not execute untrusted package code.
- Requiring a data-driven rewrite around the current frontend rules artifact was rejected because current validators are static code and the rewrite would risk changing established semantics.
- Validators that create gates or repair requests were rejected because they would move strict lifecycle policy across the seam.
- A persisted registry digest was rejected for this change because it would alter the public persisted contract; compatibility is enforced through stable IDs, semantics, and fixtures instead.

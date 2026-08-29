# ADR 0012: Backend validators, contract alignment, and frontend manifest stabilization

- Status: Accepted
- Date: 2026-08-29
- Scope: Published contracts (`schemas/execution-contract-v2.schema.json`, `domains/frontend/domain.manifest.json`, `domains/frontend/routing.vocabulary.json`), backend domain pack

## Context

- `schemas/execution-contract-v2.schema.json` validator enum shipped with `frontend/identity-diversification` runtime code (commit b0c54be) but the enum was not extended, so the bundled validator `frontend/identity-diversification` was registered without a schema allowlist entry. `pnpm validate:registry` and `assertBundledContractValidatorOwnership` therefore diverged from runtime registration.
- `domains/frontend/domain.manifest.json` routing metadata (`intentTags`, `technologyTags`) and `domains/frontend/routing.vocabulary.json` entries for `next-app-router-review` / `rsc` / `nextjs` were present in `src/domains/frontend/routing.ts` specialized hints (`frontend.next-app-router-review`) without declarative manifest alignment. `ADR 0011 §6` already owns the domain boundary (frontend presentation owns `next-app-router-review`, backend owns Route Handlers/Server Actions contracts), so the declarative data needed to match the code.
- Backend pack skeleton (#144) introduced `backend/contract-test`, `backend/migration-safety`, `backend/secret-audit` evaluators and registered them via `src/domains/backend/routing.ts` / `src/domains/bundled.ts`. The published contract enum must list exactly those three ids, otherwise `assertBundledContractValidatorOwnership` rejects backend `execution.contract.json` gates.

All three changes touch frozen published contracts (`schemas/**`, `domains/**`). `CONTRIBUTING.md` requires an explicit issue/ADR before frozen-contract edits.

## Decision

- Extend `schemas/execution-contract-v2.schema.json` `validatorId` enum to include `frontend/identity-diversification` (frontend diversification gate, shipped in b0c54be, ADR 0011 §4) and the three backend validators `backend/contract-test`, `backend/migration-safety`, `backend/secret-audit` (ADR 0011 §7, backend MVP scope). The enum now enumerates every validator returned by `bundledValidatorCatalog()` in `src/domains/trusted-validators.ts`.
- Align `domains/frontend/domain.manifest.json` routing metadata and `domains/frontend/routing.vocabulary.json` with the already-shipped `frontend.next-app-router-review` skill (no new skill introduced in this change; only declarative data catches up to `src/domains/frontend/routing.ts` and ADR 0011 §6).
- Backend pack remains the only new executable domain in this sequence (`ADR 0011 §1` – sequential expansion). Announcement stays gated on `release:certify` + green eval per ADR 0011 §8; README stays frontend-today until backend is certified.

## Consequences

- `assertBundledContractValidatorOwnership` and `TrustedValidatorRegistry` now agree with runtime registration for every bundled domain.
- Routing stays deterministic despite Next.js overlap; manifest entries are the source of truth for router packs, code is the evaluator.
- Future frozen-contract edits still require a dedicated issue/ADR; this ADR is the covering artifact for the three enum/manifest changes bundled in this PR.

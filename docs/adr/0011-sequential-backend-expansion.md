# ADR 0011: Sequential Domain Expansion — Backend as Next Domain

- Status: Accepted
- Date: 2026-08-19
- Scope: Positioning, domain packs, frontend/backend boundaries, verification
- Related: ADR 0005 (content-first positioning), ADR 0007 (craft layer), CONTEXT.md (Domain pack, Domain readiness gate, Sequential domain expansion)

## Context

SkillRanger ships frontend only (`domains/frontend` v1.2, 18× `frontend.*` + 2× `core.*`). Architecture supports multi-domain packs (`src/domains/types.ts`, `src/domains/bundled.ts`), and positioning already states "frontend ships today, more directions on the way" (ADR 0005). The product is author-curated — the author remains the owner of every decision; tooling is an instrument, not an author.

The question was whether to expand beyond frontend and whether frontend still needs improvement. Fast expansion risks announced-but-unshipped domains and thinning the only shipped domain before it is proven. Staying frontend-only risks missing the adjacent user (Next.js fullstack) who needs backend guidance in the same repo.

We needed deterministic answers for: what "ready to expand" means, what "improve frontend" means, where frontend ends and backend begins (Next.js blurs it), what minimal backend ships, and how to announce it honestly.

## Decision

### 1. Sequential expansion, one domain at a time

At most one new domain pack is in active authoring at a time. A new direction is announced only when its artifacts are shipped and verified (`release:certify` green, eval suite green, `skillranger verify` clean). This restates ADR 0005 and is now codified in `CONTEXT.md: Sequential domain expansion`.

### 2. Terminology

`Domain pack` is the delivery boundary (`domains/<id>/domain.manifest.json`). "Industry" / "отрасль" is not used for it (`CONTEXT.md: Domain pack`). Frontend readiness is judged by a `Domain readiness gate`, not by feeling.

### 3. Frontend readiness gate (when backend work may start)

Backend active work may start only when frontend passes:

- verified `strict-v2` runs (artifact integrity, gates clean),
- passing `eval:visual` / `eval:frontend` (no hard findings),
- no critical `audit` findings,
- internal orchestration signal: N=10 runs where sub-agents exercise `frontend.*` skills and a different-model evaluator (frontend-expert model) judges against `visual-critic` / `diversification` gates, with <10% slop rate,
- external certification still human: 2 independent blind human reviews + `release:certify` (tiered promotion bar, `CONTEXT.md: Promotion-certifying run`). The internal orchestration is a fast pre-gate; it does not replace human certification.

### 4. Frontend debt that remains

Not a freeze, not a parallel sprint. Two backlog items run interleaved with backend iterations:

1. Expand `domains/frontend/craft/` from 5–7 to 10 themes and enrich `macrostructures.md` / `type-pairings.md`.
2. Prove `diversification gate (N=3)` on 10 verified runs with no repetition in `.design/diversification-log.json` and green `eval:visual`.

Scheduled in weeks 1 and 4 of the backend cycle. Done = green eval on 10 runs, no diversification violation.

### 5. Backend MVP scope

First shipped backend pack = 3 skills:

- `backend.api-design` — contracts (OpenAPI/JSON Schema), validation,
- `backend.persistence` — data model, migrations,
- `backend.auth` — session/secret handling.

`performance`, `observability`, `testing` are v0.2. Goal is to ship a certifiable pack in 3–4 calendar weeks (author + tooling), not 6–8 solo weeks. If scope slips, cut `backend.auth` to v0.2; do not cut review quality.

### 6. Domain boundary

- Frontend owns presentation, including server-rendered presentation (`frontend.next-app-router-review`, `react-app-review`, `visual-*`, `tailwind-*`).
- Backend owns data and contracts: API design, persistence, auth, `Route Handlers` / `Server Actions`.
- Combined task "page + API" is `decomposition_required` → two runs, not one cross-domain skill. Ownership is explicit in both `domain.manifest.json` files to keep routing deterministic.

### 7. Backend verification (reuses strict-v2 machinery)

No new runtime. New trusted domain validators in `domains/backend/validators/`:

- `contract-test` — generated OpenAPI/JSON Schema validates,
- `migration-safety` — `migrate --dry-run` with no destructive drop,
- `secret-audit` — existing `src/audit/index.ts` secret patterns (reused).

Evidence is ingested via `src/runtime/strict/contained-file.ts` and evaluated via `src/runtime/strict/validator-registry.ts` — same as frontend.

### 8. Announcement policy

`README.md` changes from "frontend today, more directions on the way" to "frontend + backend" only after backend `release:certify` + green eval. No premature posts/commits.

## Consequences

- Honest coverage preserved: no announced-but-unshipped domain.
- Frontend does not rot: its two debt items have owners and done criteria.
- Backend ships quickly with a reviewable MVP, not a 18-skill big bang.
- Routing stays deterministic despite Next.js overlap, because ownership is explicit.
- Internal orchestration gives a fast signal without pretending to be certification; heterogeneous models reduce single-model bias, but human blind review remains the certification bar.
- The author remains the curator; tooling accelerates drafting and runs but does not author the library.

## Considered options

- **Expand in parallel (2 domains at once)**: rejected — thins review, violates sequential constraint, risks quality drop in the only shipped domain.
- **Freeze frontend completely**: rejected — craft/diversification debt would be ignored and compound.
- **Backend big-bang (8–15 skills)**: rejected — months to ship, no early feedback, blocks honest announcement.
- **Single-model self-evaluation as certification**: rejected — reward hacking; heterogeneous-model orchestration is only a pre-gate, human review stays required for promotion.
- **Frontend "done = perfect"**: rejected — subjective, never reached; replaced by deterministic readiness gate.

## Rejected alternatives

- Announcing backend before `release:certify` — violates ADR 0005.
- Assigning `Route Handlers` to frontend — would make frontend own data contracts, breaking separation.
- New runtime for backend — unnecessary; strict-v2 already supports domain-owned validators.

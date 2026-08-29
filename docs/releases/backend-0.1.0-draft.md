# Backend 0.1.0 — Draft Release Notes

- **Scope:** `backend.api-design`, `backend.persistence`, `backend.auth` — 3 skills, 9 rules
- **Verification:** `backend/contract-test` (OpenAPI $ref + endpoint schemas), `backend/migration-safety` (dryRun + safeguard, no destructive DROP), `backend/secret-audit` (aligned with audit, EC/OPENSSH)
- **Routing:** bilingual `routing.vocabulary.json`, backend pack `domain.manifest.json` with `evalSuite` and `releaseManifest`
- **Eval:** `evals/backend/suite.json` (12 trigger, 3 task) + slices `api-design`, `persistence`, `auth`; `eval:backend` / `eval:backend:ru` scripts; `release:check` includes backend
- **Tests:** `tests/backend-validators.test.ts` (17), `tests/backend-router.test.ts` (en/ru primary), `tests/backend-strict.test.ts` (evidence-blob → verified), `tests/backend-eval.test.ts`
- **Release artifacts:** `domains/backend/release.json` (0.1.0), `domains/backend/schemas/*`
- **Known gaps:** A/B/C three-arm variance and visual benchmark not yet for backend (frontend-only visual); thresholds for `eval:router` natural language still tight — tracked for next iteration

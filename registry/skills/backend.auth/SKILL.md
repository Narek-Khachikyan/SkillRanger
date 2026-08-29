---
name: auth
description: Scaffold auth and session logic with secret handling checked by audit so credentials are not leaked.
---

# Backend Auth

Use this skill when scaffolding authentication, authorization, session handling, or secret management for backend services (NextAuth, JWT, session). Do not use it for pure UI styling or for backend API work without auth.

## Workflow

1. Choose the auth provider and session strategy (JWT, database session, NextAuth).
2. Scaffold sign-in, session, and callback handlers — keep secrets behind `process.env` indirection.
3. Verify no hardcoded credentials, no `.env` committed, and no private keys in staged diffs.
4. Document env requirements (`.env.example`) and rotation notes.

## Validation

- Secrets must be read via `process.env.*` or `import.meta.env.*`; hardcoded `password`/`apiKey`/`secret` literals are rejected.
- No `.env` file content may be staged; use `.env.example` with placeholders.
- Private keys, AWS keys, GitHub PATs, and bearer tokens must not appear in diffs.

## Output Contract

- `auth`: provider and session config.
- `secretHandling`: `{ usesEnv, audited }`.
- `changes`: auth files created or modified.
- `residualRisks`: rotation, expiry, or provider gaps.

## References

- No packaged references.

## Evidence

- `implementation-diff`: staged diff of auth files.
- `verification-input`: same diff or file content used by `backend/secret-audit`.

---
name: persistence
description: Generate data models and safe migrations with dry-run checks and no destructive drops.
---

# Backend Persistence

Use this skill when creating or changing data models, Prisma/Drizzle schemas, and database migrations. Do not use it for pure API contract work without persistence or for UI-only changes.

## Workflow

1. Inspect the existing data model (Prisma schema, Drizzle schema, or SQL) and the requested change.
2. Propose the minimal additive model change and write the migration plan as SQL statements.
3. Run a dry-run safety check — reject destructive `DROP TABLE / DROP COLUMN / TRUNCATE` and unbounded `DELETE`.
4. Generate the migration file and update the ORM schema.
5. Note rollback and backfill requirements.

## Validation

- Migration must be additive and safe for production — no destructive drops.
- Dry-run evidence must be present (`verification-input` with `sql` or `statements`).
- Keep model and migration in sync; the generated SQL must reflect the model diff.

## Output Contract

- `migration`: `{ sql, statements }` planned migration.
- `safety`: `{ dryRun, destructive }` safety result.
- `changes`: files changed (schema, migration file).
- `residualRisks`: gaps like backfill needed, index considerations.

## References

- No packaged references.

## Evidence

- `migration-plan`: the migration artifact.
- `verification-input`: `{ sql, statements }` used by `backend/migration-safety`.

---
name: api-design
description: Design validated OpenAPI/JSON Schema contracts for backend API endpoints and keep frontend and backend in sync via contract testing.
---

# Backend API Design

Use this skill when designing or changing backend API contracts in natural language — OpenAPI/JSON Schema, REST endpoints, Route Handlers, or Server Actions. Do not use it for pure UI styling, Tailwind fixes, or visual design without a contract.

## Workflow

1. Capture the endpoint intent in natural language and map to resource, method, path, and status codes.
2. Draft the OpenAPI 3.x contract with paths, operations, request/response schemas, and error shapes.
3. Validate the contract locally (schema syntax, required fields, response examples) and generate contract tests.
4. Scaffold Route Handler / Server Action stubs that satisfy the contract.
5. Record migration or data considerations when the contract changes the shape of persisted data.

## Validation

- Every path must start with `/` and declare at least one operation with `responses`.
- `openapi` must be `3.x`, `info.title` and `info.version` are required.
- Contract tests must pass against the generated schema before the stub is considered done.
- Keep frontend and backend types in sync — regenerate shared types from the single contract source.

## Output Contract

- `contract`: the validated OpenAPI object.
- `validation`: `{ passed, errors }` result of local contract validation.
- `changes`: list of files or route handlers scaffolded.
- `residualRisks`: open contract questions or breaking-change notes.

## References

- No packaged references.

## Evidence

- `api-contract`: the JSON contract artifact.
- `verification-input`: `{ contract: <OpenAPI> }` used by `backend/contract-test`.

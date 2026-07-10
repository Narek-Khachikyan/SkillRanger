# Domain Verification Hardening Design

## Goal

Prevent malformed design artifacts, missing screenshots, unsafe observation paths, incomplete variance evidence, and unresolved domain eval artifacts from being reported as valid or promotion-ready.

## Constraints

- Add no runtime dependency.
- Preserve the current Core, CLI, MCP, registry, installer, and lockfile public contracts where possible.
- Keep deterministic validation synchronous.
- Add regression tests before production changes.
- Do not refactor unrelated frontend routing or evaluation behavior.

## Design Artifact Validation

The frontend runtime will validate the complete structural contract represented by the existing design brief and design direction JSON schemas before applying semantic constraints. Runtime checks will cover required nested objects, allowed enum values, arrays and their item types, viewport bounds, evidence entries, direction axes, typography and color role maps, rejected defaults, and supported recipe identifiers.

Malformed input will produce normalized hard-gate findings instead of throwing from nested property access. CLI and MCP callers will continue to receive verification reports or validation results through their existing commands and tools.

## Screenshot Evidence And Observation Paths

Browser observation filenames will use deterministic encoded path segments derived from viewport and state. The planner will assert that every resolved screenshot path remains within the configured output directory.

Screenshot-capable verification will require each observation to identify an existing screenshot artifact. The filesystem existence check will be injectable for deterministic unit tests and host adapters, with the local filesystem check as the production default. Missing artifacts will produce a hard-gate finding and prevent a verified outcome.

The browser adapter runner will also reject a completed observation when its expected screenshot was not created, so invalid evidence is stopped at the earliest boundary.

## Variance Promotion

Variance promotion represents an A/B/C comparison. For every current-skill model group, matching without-skill and old-skill groups must exist before deltas are evaluated. Missing current-skill or control groups will produce issues, leaving `promotionReady` false. Existing repetition, standard-deviation, false-completion, and delta gates remain unchanged.

Run-plan generation will reject an empty baseline selection and duplicate baseline values so it cannot create an empty or self-overwriting evaluation plan.

## Domain Eval Artifact Resolution

Domain-local artifacts such as schemas, recipes, workflows, and validators remain relative to the domain pack root. The eval suite is a package-level evaluation asset and will be resolved through a dedicated generic resolver relative to the SkillRanger package root. The resolver will enforce containment and file existence. Domain inspection tests will prove that the bundled frontend eval suite resolves successfully.

## Error Handling

- Invalid design artifacts return findings rather than uncaught `TypeError` exceptions.
- Missing screenshots fail the hard verification gate.
- Unsafe generated paths throw before any directory or adapter action.
- Incomplete A/B/C evidence returns variance issues rather than promotion readiness.
- Missing domain eval artifacts fail resolution with a path-specific error.

## Testing

Regression coverage will include:

1. A malformed direction cannot receive `verified`.
2. A malformed brief does not crash validation.
3. Missing screenshot files block verification.
4. Browser adapters that do not create screenshots are rejected.
5. Traversal-like state names remain contained under the observation output directory.
6. Variance evidence with only `current-skill` cannot be promotion-ready.
7. Empty and duplicate baseline plans are rejected.
8. The bundled frontend eval suite resolves to an existing file.

After the focused red-green cycles, the full TypeScript build, syntax check, test suite, registry validation, skill lint, registry audit, publish check, routing eval, JSON parse check, and diff check will run.

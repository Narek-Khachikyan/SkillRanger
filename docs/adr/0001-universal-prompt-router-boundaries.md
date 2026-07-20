# ADR 0001: Universal Prompt Router Boundaries

- Status: Accepted
- Date: 2026-07-18
- Scope: Universal Prompt Router v1
- Related specification: `SkillRanger-Universal-Prompt-Router-TZ-Plan.md`, section 2

## Context

SkillRanger is adding an opt-in orchestration layer that turns one complete user prompt into a selected skill set and a gated runtime run. The router reuses the existing scanner, bundled registry, recommender, lifecycle runtime, strict runtime, and skill-read ledgers. It must not weaken their trust, persistence, or verification guarantees.

The first version needs stable boundaries before its public types, schemas, and adapters are implemented. In particular, model-controlled MCP input must not choose roots, registries, activation policy, or persistence policy, and the router must not silently treat unavailable production domain packs as available.

## Decision

### Explicit activation

The public MCP tool `prepare_task` always uses explicit activation. It accepts the complete prompt and validates a supported terminal trigger itself. Its public schema does not expose `activationMode`, and a model cannot switch an MCP request to direct mode.

Direct activation remains an internal core API option and is exposed only by the CLI. Automatic activation is outside v1.

### Fixed project root

Public router MCP tools operate against one project root fixed for the lifetime of the server process. The server obtains it from `SKILLRANGER_PROJECT_ROOT`, or from startup `cwd` when the variable is absent, and canonicalizes it with `realpath` before serving requests. Startup fails if the root does not exist, is not a directory, or cannot be canonicalized.

Public router tool inputs do not contain `projectRoot`. Existing low-level MCP tools retain their current path arguments and are not covered by this router-specific guarantee. The CLI accepts a positional project root and canonicalizes it before routing.

All router scanning and direct file reads are confined to the canonical root. Traversal does not follow symlinks outside that root, direct reads use a contained no-follow primitive, directory entries are sorted before bounded traversal, and runtime-generated directories such as `.skillranger` are excluded from the fingerprint.

MCP client roots and multi-root sessions are outside v1.

### Fixed trusted registry

Production MCP and CLI router flows use only the bundled local registry selected by server or package configuration. Public router tools do not accept `registryRoot`, and routing never loads registry data from the network.

Synthetic registries are available only through dependency-injected test and evaluation entry points. They are data-only fixtures, are identified separately from bundled sources, and cannot be mixed into shipped production packs or production results. Custom registries require a separate trust model and are outside v1.

### Strict mode is installed-only

In v1, `strict: true` selects only a repo-installed skill for the chosen target agent. Every selected skill must have:

- a matching lockfile entry;
- an installed file set matching the audited registry package;
- a valid execution contract v2;
- contract input validation that accepts `skillInputs[skillId]`;
- all contract `mustRead` entries delivered through the existing strict ledger.

Registry-only strict activation and symlink-mode installed sources are not eligible. Strict feasibility is checked for the semantically best composed set; the router does not substitute a less relevant installed workflow merely to produce a prepared result.

If any strict prerequisite is missing, routing returns the normal outcome `strict_requirements_unmet` and creates neither a router run nor a runtime run.

### Non-strict source policy

In `strict: false`, the router may use either a matching repo-installed skill or an audited skill from the bundled registry. Reading a bundled source is not installation and does not execute package scripts.

An integrity-valid repo installation for the target agent takes precedence. A stale, mismatched, or symlinked installation is not read; non-strict routing may fall back to the bundled source and must report the corresponding warning.

### Sidecar orchestration record

Router-specific roles, multi-domain routing data, source inventory, and read receipts are stored in a versioned sidecar record:

```text
.skillranger/runs/router/{routerRunId}.json
```

The record references, but does not alter the schema of, one existing runtime run:

```typescript
type RuntimeRunReference =
  | { kind: "lifecycle-v1"; runId: string }
  | { kind: "strict-v2"; runId: string };
```

Router roles project onto existing runtime roles as follows:

| Router role | Runtime role |
| --- | --- |
| `primary` | `primary` |
| `environment` | `companion` |
| `companion` | `companion` |
| `verification` | `companion` |
| `agent-context` | `companion` |

Existing lifecycle schema 1.0, strict schema 2.0, lockfile schema 1.0, and strict evidence/finalization semantics remain unchanged. Existing persisted runs require no migration. Cross-store creation and read transitions use a write-ahead recovery journal so an interrupted operation cannot create duplicate runtime runs.

### Routing clarification creates no partial run

Routing clarification happens before persistence. A clarification response contains typed closed-option questions, an opaque continuation token, and an expiration time, but creates no router or runtime run.

The continuation token is valid for 15 minutes and is protected with HMAC-SHA-256 using a process-local secret. It contains no raw prompt and binds the canonical validated routing projection, question set, project, registry and config digests, routing date, and expiration. A follow-up must provide the token and typed answers together and must reproduce the same canonical routing inputs. Verbatim prompt equality is not required when canonical projections are equal.

Clarification is used only when an answer can change the selected domain or primary workflow. Free-form routing answers are not accepted. A restart may invalidate the process-local token and require clarification again.

Runtime clarification remains a separate existing lifecycle concern. A prepared lifecycle run may report runtime questions after mandatory reads; strict v2 instead reports missing contract input as `strict_requirements_unmet`.

### Privacy-safe persistence

Public MCP routing does not persist the raw prompt, prompt fragments, unknown free text, URLs, file contents, or model-provided explanations. Persisted task profiles, evidence, reasons, and normalized goals contain only canonical validated vocabulary identifiers and digests.

The project identity is an HMAC-SHA-256 value derived from the canonical root with the repository-local `.skillranger/identity.key`; neither the raw root nor the identity key is exposed to the tool caller. MCP displays the project root as `.`.

Raw intent persistence is unavailable through MCP. A future or CLI-only explicit opt-in does not change the default and is not part of the public MCP contract.

### One shared scorer

The Universal Prompt Router does not implement an independent recommendation formula. Pure feature extraction, candidate scoring, and stable ordering primitives are extracted from the existing recommender and used by both:

```text
shared scoring primitives
        |-- existing recommendSkills() compatibility wrapper
        `-- Universal Router retrieval and composition
```

The legacy recommendation result shape and behavior remain compatible. Router-specific composition may add domain, role, dependency, conflict, capability, and budget constraints after shared candidate scoring, but it may not duplicate or replace the scorer.

### Shipped and synthetic domain behavior

The only shipped domain pack at this decision date is `frontend`, and existing public skill IDs remain unchanged. `frontend-web` may be a validated alias, but persisted and public results use canonical ID `frontend`.

Production prompts requiring backend, mobile, database, or another absent shipped pack return `no_matching_skills`; the router does not fall back to frontend or present synthetic skills. Universal multi-domain behavior is exercised with separately loaded synthetic fixture packs in tests and evaluations. Synthetic packs are not published as production skills and do not execute custom pack code.

## Consequences

- MCP hosts can authorize one root and one trusted registry when starting the server instead of trusting model-provided paths.
- Strict preparation can fail more often, but every prepared strict run retains the existing installation, integrity, read-ledger, and evidence guarantees.
- Clarification and other normal non-prepared outcomes are side-effect free.
- Router evolution does not require migrating lifecycle-v1 or strict-v2 records because orchestration data is isolated in a versioned sidecar.
- Supporting more production domains requires shipping and auditing declarative domain and skill metadata; synthetic evaluation coverage alone never enables production selection.
- Shared scorer refactoring must preserve legacy recommendation outputs while exposing deterministic primitives to the router.
- The managed `AGENTS.md` block is guidance, not a security boundary. Enforcement applies to SkillRanger-owned transitions only.

## Rejected Alternatives

### Model-selected roots or registries

Rejected because model-controlled paths would broaden the MCP authority boundary and permit routing against untrusted or unrelated content.

### Registry-only strict runs

Rejected because local registry availability does not prove that an installed, lockfile-pinned package and its strict execution contract match the project runtime.

### Extending existing runtime schemas in place

Rejected because adding router roles and multi-domain state to schema 1.0 or 2.0 would change established semantics and require migration of persisted runs.

### Persisting partial clarification runs

Rejected because abandoned or expired clarification sessions would create authoritative-looking runtime state before a workflow had been selected.

### A separate router scorer

Rejected because two scoring formulas would drift, make legacy recommendations disagree with router selection, and double calibration and regression work.

### Shipping synthetic packs

Rejected because evaluation fixtures do not have the production audit, support, and trust guarantees required of bundled domain packs.

# Creating A Domain Pack

Use the generic registration API from `src/domains/registry.ts`. A pack has a declarative manifest and a routing policy implementation. Domain-specific IDs and intent rules belong in the domain module, not in Core.

## Required Contract

1. Create `domains/<id>/domain.manifest.json` with `schemaVersion`, `id`, `version`, `coreApi`, `skillIdPrefix`, capabilities, artifact paths, and ownership rules.
2. Implement `DomainRoutingPolicy` with intent rejection, lane/skill adjustments, inclusion rules, and task composition.
3. Register it through `registerDomainPack`.
4. Keep each installable skill self-contained. Include its schemas, workflow, gates, and eval pointer in the skill directory.
5. Add a fixture proving the new domain can route and validate without modifying generic Core modules.

## Artifact Paths

Domain schemas, recipes, workflows, validators, and intent files are relative to the domain pack root. Bundled eval suites are package-level assets: declare them relative to the SkillRanger package root and resolve them through `resolveDomainEvalSuitePath`. The resolver rejects paths outside the package and missing files.

## Boundary Test

A new backend pack is accepted only when it can contribute a backend intent, primary skill, schema, validator, and eval slice without adding backend IDs or rules to `src/recommender`, `src/runtime`, registry, installer, or lockfile modules.

Executable third-party domain packs are not supported in v1. Bundled executable policy is trusted package code; third-party skills remain audited, self-contained content packages.

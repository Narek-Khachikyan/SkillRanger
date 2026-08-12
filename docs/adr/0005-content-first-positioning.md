# ADR 0005: Content-First Public Positioning

- Status: Accepted
- Date: 2026-08-12
- Scope: Public surface (npm description, GitHub README and description, bundled-skills docs)

## Context

The public surface historically framed SkillRanger as a "local-first AI skill router and package manager" — a tool-first framing built around installation mechanics. In practice the product's core value is the author-curated skill library itself: hand-crafted, pre-audited, instruction-only skills authored and maintained by the project author, with routing, audit, and installation acting as delivery mechanics. The tool-first copy made SkillRanger look like a generic installer and hid the authored content that differentiates it.

## Decision

Public positioning is content-first: "author-curated agent skills" is the primary identity, and routing/audit/install are described as mechanics on top. The term "package manager" is removed from the npm description and README. The library is multi-domain by design, but coverage claims stay honest — "frontend today, more directions on the way" — and a new direction is announced only when it actually ships.

## Considered options

- **Tool-first framing (status quo)**: hid the authored content and invited comparison with generic installers.
- **Content-first with unverified breadth** ("the best skills for every stack"): rejected — dishonest while only frontend ships.
- **Content-first with honest coverage (chosen)**: claims the library as the product, keeps the roadmap open-ended, and preserves the existing honesty about current frontend coverage.

## Consequences

- npm description, GitHub description, README intro, "Why SkillRanger?", the comparison table, and bundled-skills docs all open with the library and differentiate on auto-selection and integrity rather than on "not being a collection".
- The comparison table keeps static curated collections (e.g. anthropics/skills) as an alternative, adding "Who curates the skills" as the distinguishing row.
- Future domain packs must be announced through the same honest pattern: shipped coverage stated, planned directions described as "on the way".

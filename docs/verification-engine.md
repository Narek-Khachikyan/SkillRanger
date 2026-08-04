# Verification Engine

The generic verification engine separates four concepts:

- capability status: `ready`, `degraded`, `unavailable`;
- execution status: `not-started`, `running`, `implemented`, `failed`, `blocked`;
- verification status: `not-run`, `passed`, `failed`, `partial`;
- aggregate outcome: `verified`, `implemented-unverified`, `failed`, `blocked`.

Frontend hard gates include horizontal overflow, clipped or unreachable controls, sticky overlap, console errors, keyboard traps, invisible focus, critical axe violations, missing viewport/state evidence, and missing reduced-motion verification.

`design:validate-source` adds deterministic source findings for dynamic Tailwind utility construction, conflicting utility groups, raw colors when semantic tokens are available, and advisory genericity patterns. Genericity and raw-color findings remain soft because valid product-specific exceptions require context.

Validators return normalized findings with code, source, severity, hard/soft gate, evidence, remediation, and autofix eligibility. Scores cannot compensate for hard findings.


## Final visual correction verification

Material frontend workflows can use `verifyVisualResult` after the legacy design checks. The strict verifier requires a `final-audited` visual run, the selected variant, a critic selection with host-attested actor separation, distinct immutable initial and recheck evidence ids, a changed source identity, and the complete `390px`/`768px`/`1440px` × required-state matrix. Recheck screenshots must exist as non-empty artifacts.

Distinct `generatorActorId` and `criticActorId` values prove only that the host supplied different identifiers. SkillRanger calls this host-attested actor separation; it does not claim technically proven independent execution.

Bounded-repair completion findings are evaluated before fresh recheck browser and mechanical findings. Regressions, console errors, keyboard traps, invisible focus, critical contrast or accessibility failures, overlap, unreachable actions, missing states, and reduced-motion failures remain hard gates. The final verifier recomputes interactive-state findings from persisted `stateRendered` and `stateSynchronization` fields instead of trusting the caller-supplied `checks` array. A verified synchronization needs a concrete `action` and at least one locator-level change with `before !== after`; booleans and textual assertions alone do not prove a transition. `not-applicable` records why interaction evidence cannot be supplied but remains non-certifying. `ui-state-not-rendered`, `ui-state-action-missing`, `ui-state-change-missing`, and `ui-state-desynchronized` are hard findings. Recheck `UiCheckResult` records are converted into normalized verification findings with viewport, state, locator, measured value, expected rule, evidence, and remediation.

Strict browser gates and visual verification share the canonical frontend UI evidence interpreter in `src/domains/frontend/design/ui-evidence.ts`. It parses the compatibility browser observation together with extended overlap, focus, contrast, causal state-transition, and mechanical facts, then evaluates the same browser and mechanical checks. Verifiable UI evidence persists those raw facts with `evidenceLevel: "verifiable"`; strict browser observations must carry the mechanical facts required for that level, and optional `requiredStates` metadata makes missing state×viewport cells fail the hard coverage gate. The legacy observation projection remains readable but is not a substitute for the canonical facts. The strict workflow still owns its lifecycle and fresh-recheck requirements, while the visual workflow still owns its state-progression machine and critic/repair decisions. Distinct generator and critic identifiers remain host-attested actor separation, not proof of independent execution.

A report is capability-ready only when the evidence adapter reports both `browser` and `screenshots`. Final evidence records include every valid recheck screenshot, the critic id, optional bounded-repair id, and both immutable evidence bundle paths. Existing `validateDesignResult` remains available for legacy observation workflows.

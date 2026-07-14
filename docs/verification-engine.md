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

Material frontend workflows can use `verifyVisualResult` after the legacy design checks. The strict verifier requires a `final-audited` visual run, the selected variant, an independent critic selection, distinct immutable initial and recheck evidence ids, a changed source identity, and the complete `390px`/`768px`/`1440px` × required-state matrix. Recheck screenshots must exist as non-empty artifacts.

Bounded-repair completion findings are evaluated before fresh recheck browser and mechanical findings. Regressions, console errors, keyboard traps, invisible focus, critical contrast or accessibility failures, overlap, unreachable actions, missing states, and reduced-motion failures remain hard gates. Recheck `UiCheckResult` records are converted into normalized verification findings with viewport, state, locator, measured value, expected rule, evidence, and remediation.

A report is capability-ready only when the evidence adapter reports both `browser` and `screenshots`. Final evidence records include every valid recheck screenshot, the critic id, optional bounded-repair id, and both immutable evidence bundle paths. Existing `validateDesignResult` remains available for legacy observation workflows.

# Verification Engine

The generic verification engine separates four concepts:

- capability status: `ready`, `degraded`, `unavailable`;
- execution status: `not-started`, `running`, `implemented`, `failed`, `blocked`;
- verification status: `not-run`, `passed`, `failed`, `partial`;
- aggregate outcome: `verified`, `implemented-unverified`, `failed`, `blocked`.

Frontend hard gates include horizontal overflow, clipped or unreachable controls, sticky overlap, console errors, keyboard traps, invisible focus, critical axe violations, missing viewport/state evidence, and missing reduced-motion verification.

`design:validate-source` adds deterministic source findings for dynamic Tailwind utility construction, conflicting utility groups, raw colors when semantic tokens are available, and advisory genericity patterns. Genericity and raw-color findings remain soft because valid product-specific exceptions require context.

Validators return normalized findings with code, source, severity, hard/soft gate, evidence, remediation, and autofix eligibility. Scores cannot compensate for hard findings.

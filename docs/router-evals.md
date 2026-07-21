# Universal Router Evaluations

`npm run eval:router` executes both checked-in legacy and natural-language golden cases through the
trigger parser, analyzer, domain resolver, candidate composer, and deterministic
replay check.

The report exposes `suites.shipped`, `suites.synthetic`, and the gated
`suites.naturalLanguage` summary. The legacy `--include-quarantine` option is
still accepted, but the natural-language corpus is always loaded exactly once.
Synthetic packs are data-only fixtures loaded by evaluation and test entry
points; they are never registered as production skills.

The report contains:

- status and primary-domain accuracy;
- domain precision and recall against canonical expected IDs;
- companion usefulness and irrelevant-selection rate;
- no-match, clarification, decomposition, and strict-eligibility correctness;
- average selected skill count and total instruction-byte cost;
- privacy leakage count for checked-in canaries;
- per-case expected and actual statuses;
- deterministic replay status for the same routing date and inputs.

Routing uses the fixed date `2026-07-19` in the checked-in eval harness. Golden
fixtures cover shipped frontend behavior, absent production packs, synthetic
multi-domain routing, clarification, decomposition, strict eligibility,
budget/conflict handling, prompt injection, and privacy canaries.
The synthetic suite contains the 12 domain categories listed in the v1 plan;
every fixture pack is declarative JSON and has at least one routed golden case.

`tests/fixtures/router-cases.json` and
`tests/fixtures/router-paraphrase-cases.json` are the checked-in full corpus. The command exits
non-zero when any case fails or these regression thresholds are crossed:

| Metric | Gate |
| --- | ---: |
| status accuracy | `1.000` |
| primary accuracy | `1.000` |
| domain precision | `>= 0.839` |
| domain recall | `1.000` |
| companion usefulness | `1.000` |
| irrelevant selection rate | `0.000` |
| no-match correctness | `1.000` |
| clarification correctness | `1.000` |
| decomposition correctness | `1.000` |
| strict eligibility correctness | `1.000` |
| natural-language signal recall | `>= 0.900` |
| natural-language primary-skill accuracy | `>= 0.900` |
| required companion recall | `1.000` |
| forbidden selection rate | `0.000` |
| false-positive companion rate | `<= 0.100` |
| same-domain decomposition errors | `0` |
| cross-domain decomposition correctness | `1.000` |
| privacy leakage count | `0` |
| deterministic replay | `true` |

Required-signal, primary-skill, required-companion, forbidden-selection,
same-domain, and cross-domain denominators must all be non-zero; a malformed
activated corpus is an eval error. Determinism replays the same frozen routing
date, and privacy canaries are checked across the full corpus.

The precision floor preserves the legacy contract rather than claiming perfect
domain precision. `npm run release:check` runs this full gate after registry
and frontend evaluation checks.

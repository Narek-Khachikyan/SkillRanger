# Model Capability Profiles

Profiles change autonomy, not quality gates.

`constrained` selects the top recipe, uses existing components and tokens, permits one signature move, and requires verification plus repair. Use it when model capability is unknown or unstable.

`standard` compares a small recipe set and may add bounded local variants while preserving ownership and hard gates.

`advanced` may propose a new composition grammar only with observed product evidence and destructive critique. It passes the same browser, accessibility, runtime, responsive, state, and reduced-motion gates.

Select profiles through user configuration, known benchmark history, or host capability probes. Do not infer capability only from provider branding.

## Effective-mode precedence

The resolver applies the following downgrade matrix before choosing variants:

| Requested mode | `constrained` | `standard` | `advanced` |
| --- | --- | --- | --- |
| `repair` | `repair` | `repair` | `repair` |
| `refine` | `refine` | `refine` | `refine` |
| `explore` | `refine` | `explore` | `explore` |
| `reimagine` | `refine` | `explore` | `reimagine` |

`repair` and `refine` always select one variant. `standard` can select two ranked variants for exploration, while `advanced` can select up to three and supports evidence-backed open composition.

Empirical capability evidence can only reduce freedom: its variant cap, recipe allowlist, composition limit, primitive limit, and implementation strategy bound the configured profile. An explicit recipe allowlist must intersect ranked recipes; otherwise policy resolution fails rather than expanding selection beyond the evidence.

## Empirical visual calibration

Profiles are derived from frozen visual benchmark candidate metrics, not provider or model names. Insufficient or unknown evidence resolves to `constrained`. Constrained permits one variant, preserved composition, existing primitives, and verified patterns; standard permits two variants, recipe layouts, local variants, and preferred patterns; advanced permits three variants, free composition, new primitives, and free implementation after structured direction. Capability records retain benchmark version, sample count, metrics, model ids as provenance only, successful recipes, and evidence paths.

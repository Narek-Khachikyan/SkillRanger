# Frontend Visual Quality Expansion Design

## Summary

SkillRanger will turn its current frontend design guidance into a constrained,
evidence-driven execution system. The expansion strengthens capability profiles,
adds four product recipes, requires an end-to-end visual correction loop, introduces
an independent non-coding critic, formalizes bounded repair, broadens deterministic
browser and mechanical checks, consolidates shared skill contracts, adds three MCP
tools, and calibrates model freedom from benchmark evidence rather than model names.

The work is split into six independently testable implementation plans. Existing
`DesignBrief`, `DesignDirection`, `BrowserObservation`, and `VerificationReport`
version `1.0` artifacts remain readable while new contracts are introduced as
separate versioned artifacts.

## Goals

- Make `constrained`, `standard`, and `advanced` profiles enforce materially
  different amounts of design freedom.
- Add `repair`, `refine`, `explore`, and `reimagine` change modes with explicit
  permissions and invariants.
- Increase bundled frontend recipes from four to eight with marketing landing,
  SaaS workspace, e-commerce, and mobile consumer app recipes.
- Require generation, responsive rendering, screenshots, critique, repair, and
  repeated verification for material visual work.
- Introduce an independent visual critic that compares variants, detects AI slop,
  selects the strongest result, and cannot write implementation code.
- Make every repair request describe allowed changes, protected behavior, and
  measurable completion criteria.
- Verify `390px`, `768px`, and `1440px` across required states and broaden browser,
  accessibility, runtime, and mechanical design checks.
- Provide a versioned library of verified design rules and worked recipe examples.
- Prevent low-capability execution from producing arbitrary JSX or CSS before a
  structured direction and approved pattern selection exist.
- Remove duplicated browser, evidence, and verification rules from frontend skills
  and route work through explicit design phases.
- Add `capture_ui_evidence`, `compare_design_variants`, and
  `verify_visual_result` MCP tools over the canonical frontend services.
- Measure both visual quality and repeat-run stability, then derive model freedom
  from observed benchmark results.

## Non-goals

- Building a full model host or executing third-party models inside SkillRanger.
- Allowing an automated critic to edit source files or replace human blind review.
- Shipping a hidden browser dependency; host or project adapters remain responsible
  for browser execution.
- Replacing project-specific design systems with bundled rules.
- Making model names, providers, or marketing tiers authoritative capability inputs.
- Treating screenshot similarity alone as proof of design quality.
- Breaking existing version `1.0` frontend design artifacts or current CLI commands.

## Architecture

The canonical material-design flow is:

```text
DesignBrief
  -> DesignExecutionPolicy
  -> DesignVariant[]
  -> implementation
  -> UiEvidenceBundle (initial)
  -> VisualCriticReport
  -> BoundedRepairRequest or no-repair-needed decision
  -> implementation repair
  -> UiEvidenceBundle (recheck)
  -> VerificationReport
```

Each artifact is persisted under `.design/` and referenced from the existing
skill-run lifecycle rather than copied into the run artifact. CLI commands, MCP
tools, and skills call the same domain services and validators.

### Compatibility strategy

- `DesignBrief`, `DesignDirection`, `BrowserObservation`, and
  `VerificationReport` stay at schema version `1.0` during this program.
- New concerns use new version `1.0` schemas instead of adding optional fields to
  strict existing schemas.
- Multiple directions are stored as
  `.design/variants/<variant-id>/direction.json`; each file remains a valid current
  `DesignDirection`.
- Recipe metadata remains compatible with the current `DesignRecipe` contract.
  Extended rule and example content lives in separate indexed assets referenced by
  recipe id.
- Existing two-viewport briefs remain readable, but new material runs normalize the
  required verification matrix to include `390`, `768`, and `1440`.

## Canonical Artifacts

### DesignExecutionPolicy

`.design/execution-policy.json` records:

- `schemaVersion: "1.0"`;
- `mode: "repair" | "refine" | "explore" | "reimagine"`;
- `profile: "constrained" | "standard" | "advanced"`;
- `capabilityClassId` and the evidence source that selected it;
- `variantLimit`;
- allowed recipe ids and whether a recipe-derived direction is mandatory;
- allowed composition, visual-language, primitive, token, and motion changes;
- required pattern ids from the verified design-rule library;
- whether structured direction, independent critique, and repair are mandatory;
- maximum repair iterations and required viewports/states.

The resolver combines the requested mode, configured or benchmark-derived capability
class, project evidence, and workflow risk. It always chooses the stricter value when
two constraints disagree.

### DesignVariant

A variant is represented by metadata plus an unchanged `DesignDirection`:

```text
.design/variants/<variant-id>/variant.json
.design/variants/<variant-id>/direction.json
```

Variant metadata records its id, recipe id, rule ids, creation order, relationship to
other variants, implementation artifact reference, and evidence-bundle references.
For `standard`, variants must differ on at least two declared design axes. Cosmetic
color swaps do not count as distinct variants.

### UiEvidenceBundle

`.design/evidence/<evidence-id>/bundle.json` records the route, commit or working-tree
identity, variant id, iteration, capture timestamp, required state/viewport matrix,
individual `BrowserObservation` references, screenshot references, check results, and
adapter capabilities. The bundle is immutable after validation; a recheck creates a
new evidence id.

### VisualCriticReport

`.design/critiques/<critique-id>.json` contains:

- candidate variant and evidence ids;
- a criterion-by-criterion scorecard;
- AI-slop findings with evidence locations;
- comparative advantages and failure modes;
- selected variant id or a `no-acceptable-variant` outcome;
- prioritized repair findings;
- confidence and residual uncertainty;
- an assertion that no code or implementation patch is included.

The critic may emit structured prose and findings only. Its schema rejects JSX, CSS,
diffs, shell commands, source-file edits, and implementation artifact output. The
critic runs after evidence capture and is logically independent from the generating
model. When a host cannot provide an independent model invocation, the result is
`implemented-unverified` rather than silently self-approving.

### BoundedRepairRequest

`.design/repairs/<repair-id>.json` records:

- source critique and evidence ids;
- target variant and iteration;
- normalized findings ordered by severity;
- `allowedChanges` expressed as file scopes and semantic change categories;
- `protectedInvariants` for behavior, content, art direction, public APIs, states,
  accessibility semantics, and unrelated routes;
- required evidence to prove each finding fixed;
- per-finding pass criteria;
- iteration budget and stop conditions.

A repair is complete only when the new evidence bundle has no unresolved hard finding,
every targeted criterion passes, protected-invariant checks pass, and no new equal-or-
higher-severity regression appears. Exhausting the iteration budget produces `failed`
or `blocked`; it never produces `verified`.

## Change Modes

### repair

`repair` addresses named defects only. It preserves composition, visual language,
tokens, component ownership, copy, behavior, and unrelated files unless a listed
finding proves that one of them is the defect source. It produces one direction and
one implementation path.

### refine

`refine` improves an existing direction without changing its product thesis. It may
adjust hierarchy, spacing, typography application, state presentation, responsive
transformation, and local primitives within the current design system. It does not
introduce a new art direction.

### explore

`explore` creates policy-limited competing directions. Each direction must differ on
at least two meaningful axes and be independently renderable and comparable. No
candidate becomes final until the critic selects it.

### reimagine

`reimagine` may replace art direction, composition grammar, typography system, color
roles, primitives, and signature move. It still preserves product facts, required
states, accessibility, content provenance, public behavior, and verification gates.
Only an `advanced` capability policy may use the full reimagine allowance; other
profiles are downgraded to the nearest safe scope.

## Capability Profiles

### constrained

- Exactly one top-ranked recipe and one direction.
- Typography and color roles must come from verified recipe-compatible rules.
- Existing components, tokens, and patterns are mandatory unless unavailable.
- At most one recipe-approved signature move.
- No new composition grammar or arbitrary primitive family.
- Structured direction validation must pass before implementation.
- At least one repair/recheck cycle is mandatory, even when initial hard findings are
  empty; the critic may issue a bounded refinement finding.

### standard

- Two or three variants according to the resolved capability record.
- Bounded composition changes from the selected recipes' supported layout models.
- Bounded visual-language changes through verified rules and project tokens.
- New local variants are allowed; new cross-project primitive families are not.
- Independent comparison chooses one candidate before repair.
- Verification and bounded repair requirements remain identical to constrained.

### advanced

- Free art direction within product evidence, provenance, safety, and accessibility
  constraints.
- May introduce new primitives and composition grammar.
- Must state destructive critique and migration impact for new primitives.
- May use bold signature moves when they remain meaningful across mobile, desktop,
  and real states.
- Uses the same critic, evidence, repair, and verification gates as every profile.

Profiles affect freedom, not acceptance quality. A profile can never waive browser,
accessibility, state, evidence, or final audit gates.

## Design Knowledge Library

The library contains six versioned rule families:

- typography combinations;
- layout patterns;
- responsive transformations;
- color-role systems;
- state patterns;
- signature-move patterns.

Each rule records an id, version, compatible recipe ids, preconditions, intent,
constraints, tokens or roles consumed, responsive behavior, accessibility notes,
anti-patterns, verification criteria, and provenance. Rules are data and reference
material; they do not contain executable arbitrary JSX/CSS templates.

Four new recipes join the existing operational command center, consumer discovery,
developer tool, and editorial content recipes:

- marketing landing;
- SaaS workspace;
- e-commerce;
- mobile consumer app.

Each of the eight recipes has a worked example pack containing a good result, a bad
result, a difference explanation tied to rule ids, desktop and mobile screenshots,
and loading, empty, error, and recipe-specific states. Example manifests distinguish
reference evidence from generated artifacts and cannot imply real users, metrics, or
transactions.

## Mandatory Visual Cycle

Material design workflows use an explicit state machine:

```text
policy-resolved
  -> directions-valid
  -> implemented
  -> initial-evidence-captured
  -> critiqued
  -> repair-requested | no-repair-needed
  -> repaired
  -> recheck-evidence-captured
  -> final-audited
  -> verified
```

For `constrained`, `standard`, and `advanced`, the final state is unreachable without
both initial and recheck evidence. A `no-repair-needed` critic decision still requires
a bounded recheck and is allowed only for `standard` or `advanced`; `constrained`
always performs one corrective pass. Evidence identities prevent an old screenshot
set from closing a newer implementation.

The visual critic scores product specificity, hierarchy, composition, typography,
color roles, state quality, responsive transformation, accessibility, implementation
coherence, and AI-slop risk. AI-slop checks include generic hero copy, interchangeable
SaaS layouts, excessive cards, meaningless gradients/glow/glass, invented metrics or
testimonials, repeated icon grids, arbitrary radii/shadows, weak hierarchy, and
decorative elements without product meaning.

## Browser And Mechanical Verification

New material runs require evidence at `390px`, `768px`, and `1440px` for every
declared required state. The canonical required baseline states are loading, empty,
error, and success; recipes may add states but cannot remove applicable baseline
states.

Browser observations cover:

- horizontal and container overflow;
- clipped controls and text;
- element overlap, including sticky/fixed overlap;
- console and uncaught page errors;
- reachable primary actions;
- sequential keyboard navigation, keyboard traps, and visible focus;
- automated contrast and critical accessibility violations;
- reduced-motion behavior;
- loading, empty, error, and success-state rendering.

Mechanical checks produce locator-backed findings for:

- inconsistent spacing within a declared spacing context;
- arbitrary or non-role colors;
- excessive or inconsistent radii and shadows;
- repeated generic cards without grouping meaning;
- weak typography hierarchy;
- text measures exceeding the selected rule's maximum;
- undersized touch targets.

Deterministic checks may identify candidates but must include the measured value,
expected rule, viewport/state, and DOM or screenshot location. Subjective findings
remain critic findings and are not mislabeled as mechanical certainty.

## Shared Skill Contracts And Routing

Common browser, evidence, repair, and verification requirements move into shared
frontend contracts referenced by skills. Individual `SKILL.md` files keep ownership,
trigger rules, specialized workflow decisions, and domain-specific references. They
do not copy the shared lifecycle text.

Material frontend work routes through ordered phases:

1. visual direction;
2. UX critique;
3. design-system mapping;
4. Tailwind or framework implementation;
5. motion design or audit when applicable;
6. accessibility review;
7. final frontend audit.

The router can skip an inapplicable phase only with a recorded reason. It prevents
two skills from owning the same phase and prevents implementation skills from
expanding art direction. Repair mode enters at the owning phase of the normalized
finding and rejoins the flow at evidence capture.

## MCP Tools

### capture_ui_evidence

Consumes a validated brief, variant id, route, adapter command, output directory, and
state/viewport policy. It creates a browser observation plan, executes the existing
safe adapter mechanism, runs deterministic mechanical checks, validates screenshots,
and returns an immutable `UiEvidenceBundle` reference.

### compare_design_variants

Consumes two or three validated variant ids and their evidence bundle ids. It validates
comparability, prepares the non-coding critic input, validates the returned
`VisualCriticReport`, and returns the selected variant or `no-acceptable-variant`.
The host supplies the critic execution; SkillRanger owns contracts and validation.

### verify_visual_result

Consumes policy, selected variant, initial evidence, critique, repair request or
allowed no-repair decision, and recheck evidence. It validates lifecycle ordering,
artifact identity, hard gates, regressions, and repair completion before producing the
canonical `VerificationReport`.

All three tools are thin MCP handlers over domain services. CLI surfaces can be added
for the same services without implementing a second validation path.

## Benchmark And Empirical Calibration

The benchmark contains eight frozen briefs representing all eight recipes. Each brief
declares product facts, real state shapes, required viewports, scoring criteria, and
forbidden invention. The execution matrix is:

```text
8 briefs
  x 3 capability candidates (weak, medium, strong)
  x 2 arms (without SkillRanger, with SkillRanger)
  x 2 repetitions
= 96 runs
```

Runs use isolated fixture copies, fixed prompts, recorded model ids, fixed tool
capabilities, frozen SkillRanger versions/checksums, and randomized opaque review
labels. Blind human reviewers score the rendered outputs without seeing model,
profile, arm, or repetition identity.

The aggregate reports:

- mean and median blind quality score;
- pairwise SkillRanger preference share;
- within-condition score variance and screenshot/design-axis divergence;
- catastrophic visual failure rate;
- hard-gate failure rate;
- repair iterations to verified or terminal failure;
- verification success rate and false-completion rate.

Capability calibration uses threshold rules over these measured results. A capability
record controls variant limit, recipe allowlist, composition freedom, primitive
creation, and required repair strictness. Model name and provider remain descriptive
metadata only. Insufficient samples select `constrained` by default.

## Error Handling And Integrity

- Invalid or stale artifact references fail without mutating the current run.
- Evidence bundles are bound to variant, iteration, route, state matrix, and source
  identity; mismatches cannot close verification.
- Missing independent critic capability blocks a `verified` material-design outcome.
- Critic output containing code-shaped or patch-shaped fields is rejected.
- A repair outside its file scope or semantic allowance is a hard
  `repair-scope-violation` finding.
- New regressions of equal or higher severity fail the repair even if the original
  finding disappears.
- Browser adapters continue to run with `spawn`, `shell: false`, contained output
  paths, timeouts, and one JSON result per observation.
- Screenshot files must exist, be non-empty, and match their declared evidence entry.
- Benchmark resumes preserve completed immutable runs and never merge repetitions.

## Testing Strategy

Each implementation plan uses TDD and adds focused unit, schema, integration, and
contract tests. The complete program covers:

- policy resolution for every mode/profile combination and conflict;
- compatibility with existing version `1.0` design artifacts;
- all eight recipes, library references, and example-pack completeness;
- visual-loop state transitions and skipped-stage rejection;
- critic code-output rejection and variant-comparison integrity;
- bounded repair scope, invariants, regression detection, and iteration exhaustion;
- the full viewport/state browser matrix and every new mechanical finding;
- CLI/MCP parity over shared domain services;
- phase routing, ownership conflicts, and shared-contract references;
- benchmark matrix completeness, isolation, repetition preservation, blind-label
  integrity, stability calculations, and capability classification.

The final release check runs TypeScript build, the complete Node test suite, schema
validation, registry lint/audit, frontend routing evals, and frozen local benchmark
fixture validation. External model runs and human review remain explicit evidence
collection activities rather than ordinary local release blockers.

## Implementation Plan Boundaries

### Plan 1: Design Execution Policy And Bounded Repair

Owns change modes, strengthened profiles, capability-derived freedom, structured
direction gating for weak models, and repair permissions/invariants/completion rules.
It produces the contracts consumed by every later plan.

### Plan 2: Recipes, Rules, And Worked Examples

Owns the four new recipes, design-rule library, indexes, provenance, validation, and
good/bad desktop/mobile state examples for all eight recipes.

### Plan 3: Mandatory Visual Loop And Independent Critic

Owns the visual-cycle state machine, variant metadata, evidence/critique artifact
relationships, critic contract, AI-slop taxonomy, comparison, selection, and repair
handoff.

### Plan 4: Browser And Mechanical Verification

Owns the `390/768/1440` observation matrix, extended browser contract, mechanical
checks, evidence bundle construction, regression-aware final verification, and
browser-adapter documentation.

### Plan 5: Shared Skill Contracts, Phase Routing, And MCP

Owns shared contract references, skill deduplication, ordered specialist routing,
ownership enforcement, and the three MCP handlers over domain services.

### Plan 6: Visual Benchmark And Capability Calibration

Owns eight frozen briefs, the 96-run matrix, isolated execution planning, blind review,
quality and stability aggregation, failure/repair metrics, capability records, and
runtime selection from empirical results.

## Acceptance Criteria

- A constrained run cannot use more than one recipe or skip a corrective pass.
- A standard run cannot produce fewer than two or more than three comparable variants.
- An advanced run may create primitives but cannot bypass evidence, critic, repair, or
  verification gates.
- Every requested change mode resolves to an explicit allowed/protected scope.
- Eight recipes load and validate deterministically.
- Every recipe has complete good/bad, desktop/mobile, and real-state examples.
- Material visual work cannot reach `verified` without initial screenshots, critic
  output, bounded repair handling, and fresh recheck screenshots.
- Visual critic artifacts cannot contain code or write-capable instructions.
- Verification requires `390px`, `768px`, and `1440px` evidence for every required
  state and reports all requested runtime, accessibility, responsive, and mechanical
  checks.
- Shared contracts replace repeated browser/evidence/verification prose without
  weakening any skill-specific requirement.
- Phase routing selects the correct owner for visual direction, UX, design system,
  Tailwind, motion, accessibility, and final audit.
- MCP and internal service results are contract-equivalent.
- The benchmark produces 96 uniquely identified run slots, supports blind review, and
  reports both quality and stability.
- Runtime profile constraints are selected from benchmark-derived capability records,
  never directly from model names.

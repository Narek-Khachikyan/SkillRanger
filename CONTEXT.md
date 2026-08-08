# SkillRanger Domain Context

This glossary defines the project-specific language used for skill execution and frontend visual verification.

## Model-assisted routing

**Skill catalog**:
The complete bounded metadata view of the audited bundled registry that a host agent receives before it proposes skills. It contains selection metadata, not skill instructions or arbitrary locally discovered files.
_Avoid_: Search results, installed-skill list, instruction bundle

**Routing proposal**:
A catalog-bound, prompt-grounded interpretation and ordered set of skill nominations produced by the host agent. It proposes semantic relevance but does not authorize or select a skill.
_Avoid_: Model selection, routing decision, final skill set

**Skill nomination**:
A host agent's evidence-grounded claim that one catalog skill should fill one routing role. A nomination remains subject to routing hard vetoes and composition limits.
_Avoid_: Selected skill, forced skill, recommendation result

**Nomination resolution**:
The deterministic routing decision that applies explicit user choice, nomination order, and declared ambiguity to produce a primary workflow or fallback before a run is created.
_Avoid_: Skill selection, final skill set, composition

**Routing hard veto**:
A deterministic eligibility or integrity rule that prevents a skill nomination from entering the prepared skill set. It protects audit, risk, compatibility, capability, installation, conflict, and context guarantees; it does not judge semantic relevance.
_Avoid_: Low relevance score, model disagreement, soft penalty

**Catalog receipt**:
Proof that the host received every part of one skill catalog snapshot. It proves delivery, not comprehension or correct skill nomination.
_Avoid_: Model-read proof, catalog approval, verified selection

## Verification

**Verified outcome**:
A result whose hard gates passed against accepted evidence; a structurally valid input or parsed payload is not itself verified.
_Avoid_: accepted payload, parsed result, implemented result.

**State-transition evidence**:
Evidence that connects a concrete user action to an observed before/after change in one or more dependent UI representations.
_Avoid_: state assertion, pass flag, interaction claim.

**Host-attested actor separation**:
Different generator and critic identities supplied by the host to record role separation; it does not prove that the two roles ran independently.
_Avoid_: proven independent execution, independent critic proof.

**Domain validator**:
A domain-owned check that evaluates the meaning of evidence for one domain and reports whether a declared verification gate passes. It does not own run state, repair, or finalization.
_Avoid_: generic evaluator, evidence-presence check, finalization policy.

**Generic evaluator**:
A core-owned check of evidence structure or integrity that does not depend on one domain's meaning.
_Avoid_: domain validator, domain policy.

**Validator registry**:
The trusted set of generic evaluators and selected domain validators available to one strict run. It determines whether a declared validator can be evaluated; it does not select skills.
_Avoid_: global skill registry, executable skill package.

**Gate evidence projection**:
A bounded view of accepted evidence and the minimal context needed to evaluate one declared verification gate. It does not expose the whole strict run.
_Avoid_: full run state, arbitrary file access, raw project context.

**Gate result**:
A deterministic pass or fail outcome for one declared verification gate, with an optional diagnostic. It does not decide run lifecycle, repair, or finalization.
_Avoid_: verified outcome, repair request, run state.

## Frontend design research

**Reference corpus**:
A bounded, provenance-recorded set of public design sources used to propose and compare reusable design patterns. It supplies hypotheses, not templates, brand assets, or proof that a pattern should be promoted.
_Avoid_: source of truth, copyable design library.

**Extractor output**:
A tool-generated `DESIGN.md`, token set, or configuration derived from a public page. It must retain its source and schema, then be normalized into SkillRanger's own versioned rule contract; it is not that product's canonical design system.
_Avoid_: official product tokens, drop-in skill content.

## Frontend design promotion

**Bundled design rule**:
A brand-neutral, reusable design constraint that recurs across independent sources and can be checked through observable visual and accessibility evidence.
_Avoid_: source-specific styling, a copied product treatment.

**Provenance-labelled worked example**:
An explanatory good/bad design artifact that may preserve source-specific detail, while retaining provenance and remaining non-copyable production guidance.
_Avoid_: production template, unlabelled reference screenshot.

**Tiered promotion bar**:
Both bundled rules and worked examples require complete human-reviewed evidence and passing hard gates; bundled rules additionally require generalizability and recurrence, while worked examples may remain source-specific when provenance is explicit.

**Full promotion evidence bundle**:
The complete frozen visual benchmark evidence used to certify a frontend promotion, rather than a reduced pattern-specific slice.

**Independent human review**:
Two people separately judge the blinded alternatives and record their own criterion scores, preference, catastrophic-failure flags, and notes; neither review substitutes for the other.

**Promotion-certifying run**:
A run whose evidence is complete, whose outcome is verified, and whose hard gates and critical findings are clean; a failed or falsely verified run cannot support promotion.

**Aggregate blind preference**:
The equal-weight preference share across the independent human reviews, calculated from decisive blinded comparisons; ties and abstentions are not wins.

**Baseline comparison**:
A controlled comparison of the current frontend workflow with both a no-skill baseline and the prior prose-skill baseline, using the same model, fixture, repetitions, and assertions.

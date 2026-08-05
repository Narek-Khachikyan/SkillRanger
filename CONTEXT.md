# SkillRanger Domain Context

This glossary defines the project-specific language used for skill execution and frontend visual verification.

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

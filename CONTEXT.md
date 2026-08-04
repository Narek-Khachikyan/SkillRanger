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

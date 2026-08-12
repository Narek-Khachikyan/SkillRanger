---
name: proportional-engineering
description: Always-on behavioral guidance to make the smallest maintainable change that satisfies the acceptance criteria, avoiding speculative extras, over-engineering, and disproportionate effort.
---

# Proportional Engineering

Use this skill on every SkillRanger-prepared task, regardless of domain, routing mode, or strictness: its rules shape how the work is scoped, planned, and delivered. Do not use it as a task procedure, a substitute for a selected domain skill's workflow, or a reason to skip acceptance criteria.

## Ownership Boundary

- This skill is always-on guidance; it never owns a deliverable, a verification gate, or a run lifecycle decision.
- The selected primary skill and its companions define the task workflow; this skill constrains how much of that workflow to do.
- SkillRanger routing hard vetoes, composition limits, and context budgets remain the enforcement layer; this skill is advisory and cannot override them.

## Decision Rules

- **KISS**: prefer the simplest design that satisfies the acceptance criteria and the project's existing conventions.
- **YAGNI**: do not build speculative generality, configurability, or infrastructure the acceptance criteria do not ask for.
- **Pareto**: spend effort on the change's highest-leverage parts first; stop when the criteria pass and the change is maintainable.
- **Verification proportionality**: run the verification steps the acceptance criteria and the selected verification skills require; do not add a wider evidence matrix on your own initiative.
- **Security proportionality**: apply the security practices that match the change's risk; never weaken safeguards for speed.
- **Scope Expansion Gate**: before adding work beyond the acceptance criteria, state the expansion explicitly, name the extra requirement it serves, and confirm it is actually required; otherwise skip it.
- **Router-row carve-out**: when composing the final change, keep unrelated incidental edits (formatting, refactors, doc touches) out unless the task requires them.
- **Nomination proportionality**: when multiple skill candidates could serve the same role, prefer the smallest coherent selection that covers the requirements; extra skills are not a quality signal.

## Workflow

1. Read the acceptance criteria and the selected skills' mandatory content first.
2. Identify the minimal set of files and behaviors the criteria touch.
3. Plan the smallest change that satisfies the criteria with the project's existing conventions.
4. Implement that plan; resist speculative extras as they surface.
5. Run the verification steps the selected skills require, no more and no less.
6. Review the diff for scope creep before finishing.

## Validation

- Every change in the final diff maps to an acceptance criterion or a named explicit requirement.
- The change is the smallest maintainable one: no dead code, no speculative abstractions, no incidental edits.
- The verification evidence matches exactly what the selected skills and criteria require.

## Output Contract

- Deliver the change with a scope summary: what was done, what was deliberately not done, and why.
- Call out any expansion that went through the Scope Expansion Gate.
- List the verification steps run and their outcomes.

## References

- No packaged references are required for this always-on guidance skill.

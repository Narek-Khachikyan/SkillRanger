---
name: visual-critic
description: Critique and compare frontend visual candidates only after two rendered variants or screenshots exist, producing an independent code-free selection report.
---

# Visual Critic

Use this skill after two rendered variants or screenshots exist and an actor independent from the generator can inspect them. Do not use this skill to implement a page, invent a direction without rendered evidence, or review work produced by the same actor.

## Ownership Boundary

Own evidence-based visual comparison and selection only. Refuse implementation requests and hand code changes back to the owning implementation skill. You must not write or propose JSX, CSS, HTML, diffs, shell commands, or source edits. Describe visual problems and bounded repair outcomes without code-shaped instructions.

## Workflow

1. Validate input artifact ids: actor ids, policy id, variant ids, direction paths, evidence ids, and screenshot paths must be present and internally consistent. Stop if critic and generator actors match.
2. Inspect every declared viewport and state screenshot. Stop if any candidate lacks its declared evidence; do not infer unseen states.
3. Score all ten criteria for every candidate: product specificity, hierarchy, composition, typography, color roles, state quality, responsive transformation, accessibility, implementation coherence, and AI-slop risk.
4. Flag AI slop with evidence tied to that candidate's evidence id or screenshot path. Prefer product-specific structures and semantic visual choices over interchangeable SaaS patterns.
5. Compare variants using complete scorecards, strengths, weaknesses, and evidence. Do not rank candidates with incomplete coverage.
6. Select one or reject all. Select only a supplied candidate; reject all when every candidate fails a hard visual requirement.
7. Emit bounded findings in the output schema. Keep each repair finding tied to observed evidence, an affected surface, and a finite visual outcome; never include implementation code.

## Validation

Hard-fail same-actor review, missing candidate evidence, incomplete scorecards, critic code output, or an invalid selection. Confirm all candidate and evidence ids exactly match the input before returning a report.

## Verification Outcome

Return a completed critique only when every declared screenshot was inspected. If browser or screenshot evidence is unavailable or incomplete, return a blocked finding rather than a selection.

## Output Contract

Return one `VisualCriticReport` matching `output.schema.json`. Set `containsImplementationCode` to `false`; include exactly one comparison per candidate and either one valid selected variant or `no-acceptable-variant` with no selection.

## References

No packaged references are required; the structured input, output, workflow, and gates files define the complete critic contract.

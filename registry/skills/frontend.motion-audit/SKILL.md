---
name: motion-audit
description: Audit frontend motion for purpose, product fit, accessibility, performance, and anti-generic animation risk using code and rendered evidence.
---

# Motion Audit

Use this skill for an evidence-led review of existing frontend motion before release or when motion feels distracting, generic, janky, inaccessible, or task-delaying. It evaluates both source and rendered behavior; it does not replace a product-wide motion brief or a local component-state fix.

## Verification Outcome

- Report `verified` only with rendered browser and screenshot evidence for the audited motion and its reduced-motion behavior.
- If evidence cannot be collected, state the blocker and return `blocked` or `implemented-unverified` as appropriate; never call source-only review verified.
- Include this manual matrix when blocked: normal and repeated use, narrow viewport, keyboard/focus sequence, `prefers-reduced-motion`, pause/stop behavior for auto-motion, and a performance trace for non-trivial animation.

## Scope Triage

- Audit and release-review work belongs here.
- Broad creation, choreography, and cross-surface motion language belong in Motion Design.
- Individual component state fixes for drawers, menus, modals, toasts, or drag interactions belong in Interaction Polish.

## Evidence Requirements

Inspect motion source code and configuration, rendered states, repeated-use behavior, narrow viewport, keyboard behavior, `prefers-reduced-motion`, and a performance trace for non-trivial animation. Trace the trigger, visual source and target, interruption/cancellation behavior, focus behavior, and whether completion blocks the next task.

## Motion Scorecard

Score each dimension from 0 to 4 and cite evidence for every score:

- Purpose: 0 is ornamental or unexplained; 4 has a clear task or semantic job.
- Spatial continuity: 0 loses origin/destination; 4 preserves cause, location, and hierarchy.
- Product fit: 0 is generic; 4 matches the product’s audience, frequency, and voice.
- Timing and easing: 0 is slow, inconsistent, or blocking; 4 is deliberate, interruptible, and frequency-appropriate.
- Accessibility: 0 has no usable reduced-motion or keyboard/focus path; 4 preserves meaning and control for both.
- Performance: 0 visibly janks or lacks required evidence; 4 has a clean, representative trace and bounded work.
- Repetition cost: 0 becomes tiring quickly; 4 remains quiet across ordinary repeat use.

## Release Blocking Gates

Block generic decorative motion. Block a missing reduced-motion path, keyboard or focus disruption, motion-only information, unchecked layout/paint jank, unpausable auto-motion, flash risk, and task-delaying decoration. A critical failure in any gate cannot be offset by high scorecard values elsewhere.

## Workflow

1. Map each motion to its trigger, user task, source/target relationship, implementation, and affected surfaces.
2. Collect required source and rendered evidence, then exercise the manual matrix when automation is unavailable.
3. Score the motion, separate observed facts from inference, and identify release blockers before cosmetic suggestions.
4. Repeat high-frequency interactions and check interruption, focus, reduced motion, and narrow viewport behavior.
5. Inspect a performance trace for non-trivial effects and classify layout/paint risk.
6. Apply the release blocking gates, then report outcomes ordered by severity.

## Findings Format

For each finding provide severity (`blocker`, `high`, `medium`, or `low`), scorecard dimension, affected surface and trigger, observed evidence, user impact, exact remediation, verification needed, and whether it blocks release. Label assumptions and missing evidence explicitly.

## Validation

- Every score cites rendered or source evidence and separates observation from inference.
- Every release blocker names the normal, repeated, keyboard, reduced-motion, or performance check that proves the fix.
- A source-only review remains unverified and cannot produce a release-ready verdict.

## Output Contract

Return scope classification, evidence inspected and missing, the 0–4 Motion Scorecard, release blockers, prioritized findings, manual matrix where needed, and exactly one outcome: `verified`, `implemented-unverified`, or `blocked`.

## References

Read [motion-quality.md](references/motion-quality.md) for standards and tools. Apply the project’s product language; the references are decision aids, not a library mandate.

## Shared Contracts

Ownership: motion-audit owns motion verification only.

- [`frontend/browser-evidence`](references/shared/frontend--browser-evidence.md)
- [`frontend/visual-verification`](references/shared/frontend--visual-verification.md)

---
name: motion-design
description: Design and implement purposeful frontend motion systems, animation choreography, transitions, easing, and reduced-motion behavior with product-specific direction and performance evidence.
---

# Motion Design

Use this skill to create or revise a product-wide motion language: page and view transitions, coordinated state changes, cross-surface timing, and reduced-motion equivalents. Use Interaction Polish for a specific drawer, menu, toast, modal, or drag state; use Motion Audit for an independent quality or release review.

## Verification Outcome

- Report `verified` only after browser and screenshot evidence covers the changed rendered states, including the reduced-motion path.
- If implementation is complete but that evidence is unavailable, return `implemented-unverified` and list exact manual checks: affected flow and viewport, trigger and interruption, keyboard/focus result, `prefers-reduced-motion` result, and any performance trace still needed.
- Return `blocked` when the missing browser/screenshot access prevents a safe decision; state the blocker and the same manual checks. Do not infer verification from source code alone.

## Scope Triage

- Broad, cross-surface, or product-motion systems belong here.
- Local drawer, menu, toast, modal, drag, and component state work remains in `frontend.interaction-polish`.
- Independent review, release gates, and evidence-led findings belong in `frontend.motion-audit`.

## Escalation Heuristic

If 3+ independent surfaces need coordinated motion behavior (e.g., a drawer opening
triggers a page title transition, a nav indicator update, and a toast), the need is
cross-surface choreography — escalate to this skill. If the request touches only one
component or local state change (one drawer, one menu, one toast), keep it in
`frontend.interaction-polish`. When in doubt, start in interaction-polish and escalate
when surface count exceeds 2 or when timing coordination between unrelated components
is required.

## Motion Brief

Before code, record the following. This is the template for every motion pass; fill
each field or mark it as not applicable:

**Product and audience:** who uses this, on what device, in what context, at what
frequency. Example: "Field service technicians on 6-inch Android devices, scanning
work orders 50+ times per shift."

**User task and trigger:** what the person is doing when the motion happens, and what
causes it. Example: "Technician taps 'Complete Work Order' — the submission triggers a
brief success confirmation and returns to the queue."

**Semantic purpose:** what the motion communicates (feedback, causality, continuity,
progress, spatial orientation, or brand moment). Example: "Confirms completion without
blocking return to queue. Quick success pulse, no modal."

**Source/target spatial relationship:** where the motion originates and where it goes.
Example: "In-place pulse on the completed card, then the card slides up as the queue
scrolls to the next item."

**Movement grammar:** transform and/or opacity; direction; duration range; easing
character. Example: "Scale burst (1.0->1.04->1.0), 120ms ease-out; then slide-up
translateY(-100%) 200ms ease-in-out."

**Cadence and frequency:** how often the animation plays per session and how many
elements animate. Example: "Plays once per work-order completion, ~30x per shift. Two
elements: card pulse + card exit."

**Interruption rule:** what happens if the trigger fires again during animation.
Example: "Pulse is non-interruptible (120ms); exit is cancellable — new tap re-starts
exit from current position."

**Reduced-motion equivalent:** what the experience looks like with prefers-reduced-motion.
Example: "No pulse; card disappears instantly; queue position updates without
transition."

**Evidence plan:** browser/screenshot matrix, performance trace requirements, viewport
and state coverage. Example: "Capture at 390px and desktop: default pulse, interrupted
exit, reduced-motion path. Performance trace on low-power device during rapid
completion taps."

## Motion Direction And Choreography

Express product-specific rhythm and hierarchy rather than a fashionable default. Group related changes deliberately: lead with the action-critical element, let dependent elements follow only when it clarifies structure, and keep exits briefer when possible. Never make people wait for decoration; user input, navigation, focus movement, and essential feedback take priority over choreography.

## Implementation Decision Ladder

1. Use CSS state transitions first for declarative, interruptible component changes.
2. Use WAAPI for imperative lifecycle control or interruptible choreography that CSS cannot express cleanly.
3. Use View Transitions only with progressive enhancement and a no-animation fallback.
4. Use an existing library only when its orchestration is genuinely required. Do not add a library for a one-off effect.

Keep the mechanism proportional to the brief, local conventions, and the measured performance budget.

## Accessibility And Correctness

- Implement a literal `prefers-reduced-motion` path that preserves the task with instant, opacity-only, or otherwise simplified state changes.
- Verify keyboard activation, focus movement and return, and that motion never conveys the only meaning, status, error, or destination.
- Give people control over auto-moving content: it must be pausable, stoppable, hideable, or demonstrably essential and time-bounded.
- Avoid flashes, uncontrolled scroll-linked movement, and interruption rules that trap focus or cancel an in-progress task without a safe recovery.

## Performance Evidence

Prefer `transform` and `opacity`. Do not apply broad permanent `will-change`; scope it narrowly and remove it when the transition ends. Avoid layout- or paint-heavy effects without a measured performance trace, and inspect the trace during repeated interaction and at a narrow viewport.

## Anti-Slop Gate

Reject blanket scroll reveals. Reject floating blobs, ambient loops, cursor followers, random bounces, unearned parallax, and generic decorative motion unless a product-specific brief proves their job, audience value, interruption behavior, reduced-motion equivalent, and performance evidence.

## Workflow

1. Inspect existing tokens, components, motion conventions, target surfaces, and capability limits.
2. Write the Motion Brief and select only the states that need shared choreography.
3. Choose the lowest-complexity implementation from the decision ladder and define interruptions before coding.
4. Implement semantic motion and its reduced-motion equivalent together.
5. Capture browser and screenshot evidence for normal, repeated, interrupted, keyboard, narrow-viewport, and reduced-motion states; take a performance trace for non-trivial effects.
6. Run the Anti-Slop Gate, remove unearned motion, and report the verification outcome.

## Evidence Ledger

Separate observed code and rendered behavior from inferred product intent and assumptions. Record the brief, implementation mechanism, timing/easing values, reduced-motion behavior, browser/screenshot paths, performance trace location or absence, and unresolved risks.

## Validation

- Verify normal, repeated, interrupted, keyboard, narrow-viewport, and reduced-motion paths.
- Confirm motion does not delay the next action, move focus unexpectedly, or introduce measured layout/paint regressions.
- State the exact rendered or performance evidence still missing.

## Output Contract

Return the Motion Brief, scope classification, choreography and implementation choices, accessibility/performance evidence, anti-slop decisions, exact manual checks if needed, and one outcome: `verified`, `implemented-unverified`, or `blocked`.

## References

Read [motion-quality.md](references/motion-quality.md) for the decision-oriented source set. Use project conventions first; references inform decisions and do not prescribe an animation library.

## Shared Contracts

Ownership: motion-design owns cause-and-effect motion direction.

- [`frontend/browser-evidence`](references/shared/frontend--browser-evidence.md)
- [`frontend/bounded-repair`](references/shared/frontend--bounded-repair.md)
- [`frontend/visual-verification`](references/shared/frontend--visual-verification.md)

---
name: interaction-polish
description: Refine frontend interaction states, motion, microinteractions, loading feedback, focus behavior, menus, modals, drawers, toasts, and perceived responsiveness.
---

# Interaction Polish

Use this skill when a frontend interaction feels abrupt, unclear, jumpy, slow, inaccessible, or unfinished: modals, drawers, menus, toasts, tabs, accordions, hover/focus states, loading transitions, optimistic updates, and microinteractions. Do not use it for broad visual redesigns or Playwright debugging unless the main issue is interaction quality.

## Escalation Heuristic

If the interaction involves 3+ independent surfaces needing coordinated motion (a modal
opening that also shifts a nav indicator, triggers a toast, and animates a page title),
the work is cross-surface choreography — escalate to `frontend.motion-design`. If only
one component or local state is involved (one drawer, one menu, one toast, one modal),
keep it here. When uncertain, start here and escalate when surface coordination or
cross-component timing is required.

## Scope Boundary

Product-wide motion systems, choreography, and page/view transition language go to
`frontend.motion-design`; evidence-led audits and release gates go to
`frontend.motion-audit`. This skill retains specific modal, drawer, menu, toast, drag,
and local state work.

## Verification Outcome

- Report `verified` only after keyboard, pointer, reduced-motion, and relevant focus-return behavior are exercised in a rendered surface.
- Without browser automation or a manual test surface, return `blocked` for material interaction changes rather than assuming the state machine is safe.
- If the user explicitly accepts implementation without that evidence, return `implemented-unverified` with the exact manual interaction matrix; never describe it as complete.

## Decision Rules

- Every motion needs a job: confirm input, preserve spatial context, reveal cause/effect, soften a state change, or make waiting understandable.
- Respect reduced motion and keyboard users. Pointer-only interaction polish is incomplete.
- State changes should be visible, stable, and reversible when appropriate.
- Loading feedback should match expected wait time and prevent duplicate destructive actions.
- Avoid animation that hides latency, shifts layout, traps focus, or makes controls harder to use.
- Prefer one orchestrated interaction idea over scattered motion. Random hover lifts, delayed fades, and ambient glows often read as AI-generated unless they reinforce cause, place, or progress.
- Do not complete critical interaction work without keyboard, pointer, and reduced-motion verification unless blocked.
- Tune motion frequency to task frequency. Interactions triggered dozens of times per session should be nearly invisible; onboarding, milestone, or brand moments can be more expressive but must stay skippable and non-blocking.
- Avoid ornamental animation defaults: floating blobs, looping glows, cursor followers, animated counters, blanket scroll reveals, slow text entrances, scroll-jacking, parallax, and bounce effects unless the product context explicitly earns them.
- Treat performance as interaction quality. Janky animation, delayed input response, layout shift, and heavy blur/filter effects are interaction bugs, not aesthetic tradeoffs.

## Motion Timing Defaults

- Hover, press, and color feedback: 50-120ms.
- Small microinteractions: 70-150ms.
- Dropdowns, popovers, and menus: 120-180ms.
- Dialogs, drawers, sheets, and panels: 200-300ms.
- Page or large layout transitions: 250-400ms.
- Exits should usually be faster than entrances: 80-180ms.
- Stagger related items sparingly with 15-40ms offsets and keep total choreography around 300-400ms.
- Avoid durations over 400ms unless the animation is non-blocking, low-frequency, and truly explains something.

## Easing And Properties

- Use easing by intent: ease-out for entrance and input response, ease-in for permanent exits, ease-in-out for resizing or repositioning, linear only for constant-rate progress or rotation.
- Prefer `transform` and `opacity`. Avoid animating `top`, `left`, `width`, `height`, `margin`, `padding`, or layout-affecting grid/flex values for routine effects.
- Avoid heavy blur, filters, backdrop-filter animation, giant shadows, particle systems, and large fixed backgrounds unless performance is measured.
- Use `will-change` sparingly and temporarily; do not leave it broadly applied.
- If using JavaScript or Web Animations API, honor `prefers-reduced-motion` and respond to preference changes where practical.

## Useful Motion Patterns

- Button press: fast color/elevation/scale feedback, no bounce, no layout shift.
- Menu or popover: opacity plus slight offset from its trigger; origin should match the trigger.
- Dialog or drawer: fade plus subtle scale or edge movement; focus should move immediately.
- Toast: appear from the region it occupies and exit faster than it enters.
- Add/remove item: preserve context with a short highlight, fade, or height transition only when it helps understanding.
- Drag/drop: use elevation, cursor, insertion indicators, and nearby position feedback; avoid unrelated motion.
- Loading: skeletons or determinate progress when structure is known; avoid looping ornamental spinners when progress or static structure would communicate better.
- Success: brief confirmation, color transition, or toast; confetti only for rare, low-stakes milestones and disabled under reduced motion.

## Annoyance And Reduced-Motion Tests

- Repeat the interaction 10-20 times. If the animation becomes noticeable, tiring, or delays task completion, shorten or remove it.
- Enable reduced motion and verify that large movement, parallax, zoom, spin, scroll-linked effects, and decorative loops are removed or replaced.
- Reduced motion should preserve meaning through instant state changes, opacity-only fades, color/border changes, static progress, or simpler disclosure states.
- Do not encode essential information only in animation; pair motion with persistent visual state, text, ARIA/live-region announcements where appropriate, and focus management.

## Workflow

1. Identify the interaction: trigger, target, entry state, transition, resting state, exit, and failure state.
2. Inspect existing motion/state conventions and component primitives.
3. Audit input states:
   - hover;
   - focus-visible;
   - active/pressed;
   - selected/current;
   - disabled;
   - loading/saving;
   - error/success.
4. Audit complex components: modal focus trap, drawer escape routes, menu keyboard behavior, toast timing, tab state, accordion state, and scroll locking.
5. Tune motion:
   - duration;
   - easing;
   - transform/opacity choice;
   - layout stability;
   - whether motion encodes cause and effect;
   - reduced-motion fallback.
6. Audit motion performance: main-thread work, layout-triggering properties, expensive filters, large animated regions, unbounded loops, and input responsiveness.
7. Remove motion or state styling that is only ornamental and not tied to feedback, hierarchy, continuity, progress, or a justified brand moment.
8. Verify interaction by keyboard and pointer, by reduced-motion path, and by narrow viewport when layout changes. If Playwright exists and the interaction is release-critical, run or recommend a targeted interaction check.

## Interaction Verification Gate

- For modals, drawers, menus, popovers, and dialogs, check focus entry, focus containment where appropriate, Escape/close path, focus return, and background inertness or scroll lock where relevant.
- For buttons, forms, destructive actions, and optimistic updates, check disabled/loading behavior prevents duplicate destructive submissions without hiding recovery paths.
- For transitions, verify duration, easing, opacity/transform choices, and layout stability. Motion should encode cause/effect, feedback, continuity, or progress.
- For reduced motion, provide a usable non-animated path rather than only shortening decorative animation.
- For critical flows with Playwright already installed, prefer a targeted browser interaction check over visual inspection alone. If browser automation is unavailable, list the manual keyboard/pointer checks still needed.
- Do not accept invisible focus, trapped keyboard, state-driven layout shift, inaccessible close paths, or missing reduced-motion handling as polish issues; treat them as correctness failures.
- Do not accept animation that makes the next click, keypress, or navigation wait for decoration.
- Do not accept interaction polish that only works on fast desktop hardware; check mobile and lower-power assumptions when effects are heavy.

## Validation

- Check that focus moves predictably and returns after dismissing overlays.
- Verify controls do not resize or shift between states.
- Confirm loading/disabled states prevent duplicate submissions when needed.
- Verify reduced motion has a usable non-animated path.
- Check that hover/focus/active styling communicates a clear state without changing the control's layout footprint.
- Verify pointer and keyboard behavior independently for changed interactions.
- State any unverified browser behavior.

## Output Contract

- Interaction classification first.
- Evidence inspected: component code, browser behavior, screenshots/video, or missing.
- State and motion changes made or recommended.
- Keyboard, pointer, viewport, reduced-motion, and Playwright/manual interaction checks.
- Remaining interaction risk.

## References

- Use the project's existing component motion conventions, shared transition utilities,
  and nearby component state styling as primary references.
- Refer to MDN `prefers-reduced-motion`, WCAG 2.3.3 Animation from Interactions, and
  WCAG 2.2.2 Pause/Stop/Hide for accessibility requirements.
- Use the Chrome DevTools Animations panel and Performance panel for timing and
  performance inspection.

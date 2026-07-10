# Motion Quality Reference

Use this source set to decide whether motion earns its cost. Audit the rendered experience and source together; these links guide evidence and risk assessment, and they do not prescribe a particular animation library.

- [WCAG 2.3.3: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html): significant interaction-triggered motion needs a non-motion path unless essential. Confirm the `prefers-reduced-motion` alternative still completes the task.
- [WCAG 2.2.2: Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide) and [WCAG 2.3.1: Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold): test user control of auto-motion and treat flash risk as release-blocking.
- [MDN: `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion): inspect the actual media-query path instead of accepting shortened animation as sufficient by default.
- [web.dev: Animations and Performance](https://web.dev/articles/animations-guide): use it to identify transform/opacity-friendly choices, then validate behavior with a real trace.
- [Chrome DevTools Animations](https://developer.chrome.com/docs/devtools/animations/) and [Performance](https://developer.chrome.com/docs/devtools/performance/): gather timing and main-thread/layout/paint evidence under representative repetition.
- [MDN: View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API): verify progressive enhancement and a working no-animation fallback before accepting view transitions.
- [Apple HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion): evaluate whether motion conveys status, feedback, instruction, or spatial continuity without sustained peripheral distraction.
- [Fluent 2 Motion](https://fluent2.microsoft.design/motion): use its principles as a product-fit comparison, not a generic visual recipe.

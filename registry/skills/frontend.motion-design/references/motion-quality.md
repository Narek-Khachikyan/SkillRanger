# Motion Quality Reference

Use this source set to make a decision, not to justify decoration. Motion should preserve task continuity, remain controllable, and use rendered evidence before release; no source below mandates a particular animation library.

- [WCAG 2.3.3: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html): significant interaction-triggered motion needs a non-motion path unless essential. Design the `prefers-reduced-motion` equivalent with the feature, not afterward.
- [WCAG 2.2.2: Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide) and [WCAG 2.3.1: Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold): auto-moving content needs user control when applicable; flashing risk is a release blocker, not an aesthetic tradeoff.
- [MDN: `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion): use the media feature to replace, simplify, or remove nonessential movement while keeping the task understandable.
- [web.dev: Animations and Performance](https://web.dev/articles/animations-guide): prefer composited properties when appropriate, then measure the actual interaction rather than assuming a CSS animation is cheap.
- [Chrome DevTools Animations](https://developer.chrome.com/docs/devtools/animations/) and [Performance](https://developer.chrome.com/docs/devtools/performance/): inspect timing, repeated behavior, and main-thread/layout/paint cost with a representative trace.
- [MDN: View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API): treat view transitions as progressive enhancement with a functional no-animation fallback.
- [Apple HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion): use motion for status, feedback, instruction, and spatial understanding; avoid sustained peripheral movement.
- [Fluent 2 Motion](https://fluent2.microsoft.design/motion): make transitions purposeful and consistent with hierarchy and input, while adapting the ideas to the product rather than copying a visual system.

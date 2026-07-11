import type { FrontendIntentAliasPack } from "./types.ts";

export const enFrontendIntentAliases: FrontendIntentAliasPack = {
  locale: "en",
  intents: {
    "accessibility-review": {
      tokens: ["accessibility", "aria", "combobox", "contrast", "dialog", "disabled", "focus", "focus-visible", "keyboard", "labels", "wcag"],
      phrases: ["accessible name", "escape close", "focus trap", "inert background", "modal dialog", "return focus", "target size"],
    },
    audit: {
      tokens: [],
      phrases: ["cross-cutting frontend", "final frontend review", "final ship review", "frontend audit", "frontend scorecard", "go no-go", "go or no go", "go/no-go", "preflight audit", "preflight check", "preflight frontend", "preflight review", "quality gate", "release readiness", "release-readiness", "ship readiness", "whole frontend"],
    },
    "design-system": {
      tokens: ["shadcn", "theme", "token", "tokens", "variant", "variants"],
      phrases: ["dark mode", "design system", "hard-coded", "semantic token", "semantic tokens", "token migration"],
    },
    "design-to-code": {
      tokens: ["figma", "implement", "mock", "mockup", "supplied"],
      phrases: ["design to code", "matching responsive behavior", "product screenshot", "provided screenshot", "supplied product screenshot"],
    },
    "interaction-polish": {
      tokens: ["drag", "drawer", "drop", "modal", "toast"],
      phrases: ["focus correctly", "interaction polish"],
    },
    "motion-audit": {
      tokens: ["jank"],
      phrases: ["animation audit", "animation performance", "generic decorative motion", "motion audit", "motion review", "reduced-motion accessibility", "reduced-motion support", "review motion"],
    },
    "motion-design": {
      tokens: ["animation", "animations", "choreography", "easing", "motion", "reduced-motion", "transitions"],
      phrases: ["motion design", "motion system", "page transition", "page transitions", "transition system", "view transition", "view transitions"],
    },
    "performance-review": {
      tokens: ["bundle", "inp", "lcp", "lighthouse", "performance", "slow"],
      phrases: ["feels slow", "render bottleneck"],
    },
    "tailwind-ui-polish": {
      tokens: ["390px", "empty", "loading", "nav", "navigation", "overlaps", "radii", "responsive", "spacing", "tailwind", "wrapping"],
      phrases: ["active state", "arbitrary colors", "breakpoint fix", "classname cleanup", "css repair", "error states", "icons shift", "labels wrap", "responsive fix", "state styling", "tailwind class", "tailwind fix"],
    },
    "ux-critique": {
      tokens: ["affordance", "checkout", "confusing", "findability", "flow", "navigation", "onboarding", "recovery", "usability", "ux", "wayfinding"],
      phrases: ["cognitive load", "completion blocker", "empty state", "error recovery", "error state", "form usability", "information architecture", "search results", "search usability", "settings page", "settings usability", "task completion", "task flow", "user flow"],
    },
    "visual-design-polish": {
      tokens: ["crowded", "editorial", "generic", "hierarchy", "looks", "manga", "modernize", "rebrand", "redesign", "refresh", "revamp", "visual"],
      phrases: ["art direction", "before-after", "brand direction", "design language", "design.md", "layout bug", "look and feel", "looks off", "product fit", "screenshot looks off", "style guide", "subject-specific", "tell me what to change", "visual direction", "visual identity", "visual language", "visual regression", "visual thesis"],
    },
  },
  controls: {
    "require-skill-lifecycle": [
      "use skills",
      "use frontend skills",
      "why are you not using skills",
      "why aren't you using skills",
      "you do not have skills",
      "you don't have skills",
    ],
  },
};

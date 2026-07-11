export type FrontendLocale = "en" | "ru" | "mixed" | "unknown";

export type CanonicalFrontendIntent =
  | "accessibility-review"
  | "audit"
  | "design-system"
  | "design-to-code"
  | "interaction-polish"
  | "motion-audit"
  | "motion-design"
  | "performance-review"
  | "tailwind-ui-polish"
  | "ux-critique"
  | "visual-design-polish";

export type FrontendControlIntent = "require-skill-lifecycle";

export type FrontendIntentAliasPack = {
  locale: "en" | "ru";
  intents: Record<CanonicalFrontendIntent, { tokens: string[]; phrases: string[] }>;
  controls: Record<FrontendControlIntent, string[]>;
};

export type FrontendIntentAnalysis = {
  locale: FrontendLocale;
  normalized: string;
  tokens: Set<string>;
  intents: Set<CanonicalFrontendIntent>;
  controlIntents: Set<FrontendControlIntent>;
};

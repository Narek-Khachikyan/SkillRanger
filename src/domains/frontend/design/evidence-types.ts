import type { BrowserObservation } from "./types.ts";

export type UiCheckCode =
  | "horizontal-overflow" | "clipped-content" | "element-overlap" | "sticky-overlap"
  | "console-error" | "unreachable-action" | "keyboard-trap" | "focus-order"
  | "invisible-focus" | "contrast" | "critical-axe" | "reduced-motion"
  | "state-not-rendered" | "inconsistent-spacing" | "random-color"
  | "excessive-radii" | "excessive-shadows" | "generic-card-repetition"
  | "weak-typography-hierarchy" | "text-measure" | "touch-target";

export type UiCheckResult = {
  code: UiCheckCode;
  severity: "critical" | "high" | "medium" | "low";
  gate: "hard" | "soft";
  viewport: number;
  state: string;
  locator: string;
  measured?: string;
  expected: string;
  evidence: string[];
  remediation: string;
};

export type MechanicalSnapshot = {
  spacingContexts: Array<{ id: string; locators: string[]; valuesPx: number[] }>;
  colors: Array<{ locator: string; value: string; role?: string; occurrences: number }>;
  radii: Array<{ locator: string; valuePx: number; isPillOrCircle: boolean }>;
  shadows: Array<{ locator: string; value: string; isNone: boolean }>;
  cards: Array<{ locator: string; depth: number; repeatedCount: number; semanticRole: "generic" | "group" | "tool" | "item" }>;
  typography: Array<{ locator: string; role: "h1" | "h2" | "h3" | "body" | "meta"; fontSizePx: number; fontWeight: number }>;
  textBlocks: Array<{ locator: string; measureCh: number }>;
  touchTargets: Array<{ locator: string; widthPx: number; heightPx: number; interactive: boolean }>;
};

export type UiCaptureEntry = {
  viewport: { width: number; height: number };
  state: string;
  screenshotPath: string;
  observation: BrowserObservation;
  checks: UiCheckResult[];
};

export type UiEvidenceBundle = {
  schemaVersion: "1.0";
  id: string;
  variantId: string;
  iteration: number;
  sourceIdentity: string;
  route: string;
  capturedAt: string;
  requiredViewports: [390, 768, 1440];
  requiredStates: string[];
  captures: UiCaptureEntry[];
  adapterCapabilities: string[];
};

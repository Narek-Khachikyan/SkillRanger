import type { BrowserObservation } from "./types.ts";

export type UiCheckCode =
  | "horizontal-overflow" | "clipped-content" | "element-overlap" | "sticky-overlap"
  | "console-error" | "unreachable-action" | "keyboard-trap" | "focus-order"
  | "invisible-focus" | "contrast" | "critical-axe" | "reduced-motion"
  | "state-not-rendered" | "state-mismatch" | "inconsistent-spacing" | "random-color"
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

export type StateSynchronization = {
  status: "verified" | "mismatch" | "not-applicable";
  path: string;
  observations: string[];
};

const stateSynchronizationStatuses = ["verified", "mismatch", "not-applicable"];

/**
 * Shape rule for a capture's causal state record. Capture-time ingestion and the final verifier
 * both apply it: the verifier receives bundles as untrusted snapshots, so a field required only at
 * capture can be edited back out before verification.
 */
export const isValidStateSynchronization = (value: unknown): value is StateSynchronization => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { status, path, observations } = value as Record<string, unknown>;
  if (!stateSynchronizationStatuses.includes(status as string)) return false;
  if (typeof path !== "string" || path.trim().length === 0) return false;
  if (!Array.isArray(observations)
    || !observations.every((entry) => typeof entry === "string" && entry.trim().length > 0)) return false;
  return observations.length >= (status === "not-applicable" ? 1 : 2);
};

export type UiCaptureEntry = {
  viewport: { width: number; height: number };
  state: string;
  screenshotPath: string;
  observation: BrowserObservation;
  stateSynchronization: StateSynchronization;
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

import type { BrowserObservation } from "./types.ts";

export type UiEvidenceLevel = "observation" | "verifiable";

export type UiCheckCode =
  | "horizontal-overflow" | "clipped-content" | "element-overlap" | "sticky-overlap"
  | "console-error" | "unreachable-action" | "keyboard-trap" | "focus-order"
  | "invisible-focus" | "contrast" | "critical-axe" | "reduced-motion"
  | "ui-state-not-rendered" | "ui-state-action-missing" | "ui-state-change-missing"
  | "ui-state-desynchronized" | "state-not-rendered" | "state-mismatch"
  | "inconsistent-spacing" | "random-color"
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
  action?: string;
  changes?: Array<{
    locator: string;
    before: string;
    after: string;
  }>;
  reason?: string;
};

const stateSynchronizationStatuses = ["verified", "mismatch", "not-applicable"];

/**
 * Shape rule for a capture's causal state record. Capture-time ingestion and the final verifier
 * both apply it: the verifier receives bundles as untrusted snapshots, so a field required only at
 * capture can be edited back out before verification.
 *
 * The published bundle schema states the two-observation minimum as an if/then branch, which the
 * local JSON Schema subset does not implement; this predicate is where that rule is enforced.
 */
export const isValidStateSynchronization = (value: unknown): value is StateSynchronization => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { status, path, observations, action, changes, reason } = value as Record<string, unknown>;
  if (!stateSynchronizationStatuses.includes(status as string)) return false;
  if (typeof path !== "string" || path.trim().length === 0) return false;
  if (!Array.isArray(observations)
    || !observations.every((entry) => typeof entry === "string" && entry.trim().length > 0)) return false;
  if (observations.length < (status === "not-applicable" ? 1 : 2)) return false;
  if (action !== undefined && typeof action !== "string") return false;
  if (reason !== undefined && typeof reason !== "string") return false;
  if (changes !== undefined && (!Array.isArray(changes) || !changes.every((change) =>
    typeof change === "object" && change !== null && !Array.isArray(change)
    && typeof (change as Record<string, unknown>).locator === "string"
    && ((change as Record<string, unknown>).locator as string).trim().length > 0
    && typeof (change as Record<string, unknown>).before === "string"
    && typeof (change as Record<string, unknown>).after === "string"))) return false;
  return status !== "not-applicable" || (typeof reason === "string" && reason.trim().length > 0);
};

export type UiCaptureEntry = {
  viewport: { width: number; height: number };
  state: string;
  screenshotPath: string;
  observation: BrowserObservation;
  stateRendered?: boolean;
  stateSynchronization: StateSynchronization;
  overlaps?: string[];
  focusOrderViolations?: string[];
  contrastViolations?: Array<{ locator: string; ratio: number; largeText: boolean }>;
  mechanicalSnapshot?: MechanicalSnapshot;
  checks: UiCheckResult[];
};

export type UiEvidenceBundle = {
  schemaVersion: "1.0";
  evidenceLevel?: UiEvidenceLevel;
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

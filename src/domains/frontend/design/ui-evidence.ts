import { evaluateBrowserPayload, type BrowserCheckPayload } from "./browser-checks.ts";
import {
  isValidStateSynchronization,
  type MechanicalSnapshot,
  type StateSynchronization,
  type UiEvidenceLevel,
  type UiCaptureEntry,
  type UiCheckResult,
  type UiEvidenceBundle,
} from "./evidence-types.ts";
import { defaultMechanicalCheckPolicy, evaluateMechanicalSnapshot, sortUiCheckResults, type MechanicalCheckPolicy } from "./mechanical.ts";
import type { BrowserObservation } from "./types.ts";

export type LegacyBrowserObservation = Pick<BrowserCheckPayload,
  | "horizontalOverflow"
  | "clippedControls"
  | "unreachableActions"
  | "stickyOverlaps"
  | "consoleErrors"
  | "keyboardTraps"
  | "invisibleFocus"
  | "criticalAxeViolations"
  | "reducedMotionVerified"
>;

export type FrontendUiEvidenceFacts = {
  viewport: { width: number; height: number };
  route?: string;
  state: string;
  screenshotPath: string;
  browser: BrowserCheckPayload;
  mechanicalSnapshot?: MechanicalSnapshot;
};

export type FrontendUiEvidenceInterpretation = {
  browserChecks: UiCheckResult[];
  mechanicalChecks: UiCheckResult[];
  checks: UiCheckResult[];
  stateTransition: "certifying" | "non-certifying";
};

export type PersistedUiEvidenceInterpretation = {
  facts: FrontendUiEvidenceFacts;
  interpretation: FrontendUiEvidenceInterpretation;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringArray = (payload: Record<string, unknown>, field: string): string[] => {
  const value = payload[field];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`Browser observation ${field} must be an array of strings.`);
  }
  return value;
};

const booleanField = (payload: Record<string, unknown>, field: string) => {
  if (typeof payload[field] !== "boolean") throw new Error(`Browser observation ${field} must be boolean.`);
  return payload[field] as boolean;
};

export const parseLegacyBrowserObservation = (value: Record<string, unknown>): LegacyBrowserObservation => ({
  horizontalOverflow: booleanField(value, "horizontalOverflow"),
  clippedControls: stringArray(value, "clippedControls"),
  unreachableActions: stringArray(value, "unreachableActions"),
  stickyOverlaps: stringArray(value, "stickyOverlaps"),
  consoleErrors: stringArray(value, "consoleErrors"),
  keyboardTraps: stringArray(value, "keyboardTraps"),
  invisibleFocus: stringArray(value, "invisibleFocus"),
  criticalAxeViolations: stringArray(value, "criticalAxeViolations"),
  reducedMotionVerified: booleanField(value, "reducedMotionVerified"),
});

const browserObservationArrayKeys = [
  "clippedControls",
  "unreachableActions",
  "stickyOverlaps",
  "consoleErrors",
  "keyboardTraps",
  "invisibleFocus",
  "criticalAxeViolations",
] as const;

export const isValidBrowserObservation = (value: unknown): value is BrowserObservation => {
  if (!isRecord(value)
    || value.schemaVersion !== "1.0"
    || !isRecord(value.viewport)
    || typeof value.viewport.width !== "number"
    || typeof value.viewport.height !== "number"
    || !Number.isInteger(value.viewport.width)
    || value.viewport.width <= 0
    || !Number.isInteger(value.viewport.height)
    || value.viewport.height <= 0
    || typeof value.route !== "string"
    || value.route.trim() === ""
    || typeof value.state !== "string"
    || value.state.trim() === ""
    || typeof value.horizontalOverflow !== "boolean"
    || typeof value.reducedMotionVerified !== "boolean"
    || (value.screenshotPath !== undefined
      && (typeof value.screenshotPath !== "string" || value.screenshotPath.trim() === ""))) {
    return false;
  }
  return browserObservationArrayKeys.every((key) => {
    const entries = value[key];
    return Array.isArray(entries) && entries.every((entry) => typeof entry === "string");
  });
};

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

const parseMechanicalSnapshot = (value: unknown): MechanicalSnapshot => {
  if (!isRecord(value)) throw new Error("Browser observation mechanicalSnapshot must be an object.");
  const snapshotKeys = [
    "spacingContexts", "colors", "radii", "shadows", "cards", "typography", "textBlocks", "touchTargets", "motion",
  ] as const;
  if (!hasOnlyKeys(value, snapshotKeys)) {
    throw new Error("Browser observation mechanicalSnapshot contains unknown fields.");
  }
  const nonEmptyString = (entry: unknown): entry is string => typeof entry === "string" && entry.trim() !== "";
  const finiteNumber = (entry: unknown): entry is number => typeof entry === "number" && Number.isFinite(entry);
  const nonNegativeNumber = (entry: unknown): entry is number => finiteNumber(entry) && entry >= 0;
  const nonNegativeInteger = (entry: unknown): entry is number => nonNegativeNumber(entry) && Number.isInteger(entry);
  const stringList = (entry: unknown): entry is string[] => Array.isArray(entry) && entry.every(nonEmptyString);
  const entries = <T>(field: string, keys: readonly string[], valid: (entry: unknown) => boolean): T[] => {
    const valueForField = value[field];
    if (!Array.isArray(valueForField)) {
      throw new Error(`Browser observation mechanicalSnapshot.${field} must be an array.`);
    }
    const invalidIndex = valueForField.findIndex((entry) => !isRecord(entry) || !hasOnlyKeys(entry, keys) || !valid(entry));
    if (invalidIndex !== -1) {
      throw new Error(`Browser observation mechanicalSnapshot.${field}[${invalidIndex}] has an invalid shape.`);
    }
    return valueForField as T[];
  };
  entries("spacingContexts", ["id", "locators", "valuesPx"], (entry) => isRecord(entry)
    && nonEmptyString(entry.id)
    && stringList(entry.locators)
    && Array.isArray(entry.valuesPx)
    && entry.valuesPx.every(nonNegativeNumber));
  entries("colors", ["locator", "value", "role", "occurrences"], (entry) => isRecord(entry)
    && nonEmptyString(entry.locator)
    && nonEmptyString(entry.value)
    && (entry.role === undefined || nonEmptyString(entry.role))
    && nonNegativeInteger(entry.occurrences));
  entries("radii", ["locator", "valuePx", "isPillOrCircle"], (entry) => isRecord(entry)
    && nonEmptyString(entry.locator)
    && nonNegativeNumber(entry.valuePx)
    && typeof entry.isPillOrCircle === "boolean");
  entries("shadows", ["locator", "value", "isNone"], (entry) => isRecord(entry)
    && nonEmptyString(entry.locator)
    && nonEmptyString(entry.value)
    && typeof entry.isNone === "boolean");
  entries("cards", ["locator", "depth", "repeatedCount", "semanticRole"], (entry) => isRecord(entry)
    && nonEmptyString(entry.locator)
    && nonNegativeInteger(entry.depth)
    && nonNegativeInteger(entry.repeatedCount)
    && ["generic", "group", "tool", "item"].includes(entry.semanticRole as string));
  entries("typography", ["locator", "role", "fontSizePx", "fontWeight"], (entry) => isRecord(entry)
    && nonEmptyString(entry.locator)
    && ["h1", "h2", "h3", "body", "meta"].includes(entry.role as string)
    && nonNegativeNumber(entry.fontSizePx)
    && nonNegativeNumber(entry.fontWeight));
  entries("textBlocks", ["locator", "measureCh"], (entry) => isRecord(entry)
    && nonEmptyString(entry.locator)
    && nonNegativeNumber(entry.measureCh));
  entries("touchTargets", ["locator", "widthPx", "heightPx", "interactive"], (entry) => isRecord(entry)
    && nonEmptyString(entry.locator)
    && nonNegativeNumber(entry.widthPx)
    && nonNegativeNumber(entry.heightPx)
    && typeof entry.interactive === "boolean");
  if (value.motion !== undefined) {
    entries("motion", ["locator", "transitionProperty", "transitionTimingFunction"], (entry) => isRecord(entry)
      && nonEmptyString(entry.locator)
      && nonEmptyString(entry.transitionProperty)
      && nonEmptyString(entry.transitionTimingFunction));
  }
  return {
    ...(value as Record<string, unknown>),
    motion: value.motion ?? [],
  } as MechanicalSnapshot;
};

export const normalizeStateSynchronization = (value: unknown): StateSynchronization => {
  if (!isValidStateSynchronization(value)) {
    throw new Error(
      "Browser observation stateSynchronization must be { status: verified | mismatch | not-applicable, "
      + "path: non-empty string, observations: array of non-empty strings, optional action and changes, "
      + "and a concrete reason when status is not-applicable }.",
    );
  }
  return {
    status: value.status,
    path: value.path,
    observations: [...value.observations],
    ...(value.action !== undefined ? { action: value.action } : {}),
    ...(value.changes !== undefined
      ? { changes: value.changes.map(({ locator, before, after }) => ({ locator, before, after })) }
      : {}),
    ...(value.reason !== undefined ? { reason: value.reason } : {}),
  };
};

export const parseUiEvidencePayload = (
  value: unknown,
  options: { requireMechanical?: boolean } = {},
): { browser: BrowserCheckPayload; mechanical?: MechanicalSnapshot } => {
  if (!isRecord(value)) throw new Error("Browser adapter must return one JSON object per invocation.");
  const contrast = value.contrastViolations;
  if (!Array.isArray(contrast) || !contrast.every((entry) => isRecord(entry)
    && hasOnlyKeys(entry, ["locator", "ratio", "largeText"])
    && typeof entry.locator === "string" && entry.locator.trim() !== ""
    && typeof entry.ratio === "number" && Number.isFinite(entry.ratio) && entry.ratio >= 0
    && typeof entry.largeText === "boolean")) {
    throw new Error("Browser observation contrastViolations must contain locator, ratio, and largeText values.");
  }
  const browser: BrowserCheckPayload = {
    ...parseLegacyBrowserObservation(value),
    stateRendered: booleanField(value, "stateRendered"),
    overlaps: stringArray(value, "overlaps"),
    focusOrderViolations: stringArray(value, "focusOrderViolations"),
    contrastViolations: contrast.map((entry) => ({
      locator: (entry as Record<string, unknown>).locator as string,
      ratio: (entry as Record<string, unknown>).ratio as number,
      largeText: (entry as Record<string, unknown>).largeText as boolean,
    })),
    stateSynchronization: normalizeStateSynchronization(value.stateSynchronization),
  };
  const mechanical = value.mechanicalSnapshot === undefined
    ? undefined
    : parseMechanicalSnapshot(value.mechanicalSnapshot);
  if (options.requireMechanical && mechanical === undefined) {
    throw new Error("Browser observation mechanicalSnapshot must be an object.");
  }
  return { browser, mechanical };
};

const strictObservationRequiredKeys = [
  "viewport", "state", "screenshotPath", "horizontalOverflow", "clippedControls", "unreachableActions",
  "stickyOverlaps", "consoleErrors", "keyboardTraps", "invisibleFocus", "criticalAxeViolations",
  "reducedMotionVerified", "stateRendered", "action", "changes",
] as const;
const strictObservationOptionalKeys = [
  "route", "overlaps", "focusOrderViolations", "contrastViolations", "stateSynchronization", "mechanicalSnapshot",
] as const;

const hasOnlyStrictObservationKeys = (value: Record<string, unknown>) => {
  const allowed = new Set<string>([...strictObservationRequiredKeys, ...strictObservationOptionalKeys]);
  return Object.keys(value).every((key) => allowed.has(key))
    && strictObservationRequiredKeys.every((key) => Object.hasOwn(value, key));
};

const parseStrictViewport = (value: unknown, index: number) => {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["width", "height"])
    || typeof value.width !== "number" || !Number.isFinite(value.width) || value.width <= 0
    || typeof value.height !== "number" || !Number.isFinite(value.height) || value.height <= 0) {
    throw new Error(`Browser observation ${index} viewport dimensions must be finite positive numbers.`);
  }
  return { width: value.width, height: value.height };
};

const parseStrictChanges = (value: unknown, index: number) => {
  if (!Array.isArray(value) || !value.every((change) => isRecord(change)
    && Object.keys(change).length === 3
    && Object.hasOwn(change, "locator") && Object.hasOwn(change, "before") && Object.hasOwn(change, "after")
    && typeof change.locator === "string" && change.locator.trim() !== ""
    && typeof change.before === "string" && typeof change.after === "string")) {
    throw new Error(`Browser observation ${index} changes must contain closed locator, before, and after records.`);
  }
  if (!value.some((change) => (change as Record<string, unknown>).before !== (change as Record<string, unknown>).after)) {
    throw new Error(`Browser observation ${index} must record at least one observed change where before differs from after.`);
  }
  return value as Array<{ locator: string; before: string; after: string }>;
};

export const parseStrictUiEvidenceObservation = (
  value: unknown,
  index: number,
  options: { requireMechanical?: boolean } = {},
): FrontendUiEvidenceFacts => {
  if (!isRecord(value) || !hasOnlyStrictObservationKeys(value)) {
    throw new Error(`Browser observation ${index} must have the required closed shape.`);
  }
  const viewport = parseStrictViewport(value.viewport, index);
  if (typeof value.state !== "string" || value.state.trim() === "") {
    throw new Error(`Browser observation ${index} state must be a non-empty string.`);
  }
  if (typeof value.screenshotPath !== "string" || value.screenshotPath.trim() === "") {
    throw new Error(`Browser observation ${index} screenshotPath must be a non-empty string.`);
  }
  if (value.route !== undefined && (typeof value.route !== "string" || value.route.trim() === "")) {
    throw new Error(`Browser observation ${index} route must be a non-empty string when provided.`);
  }
  if (value.stateRendered !== true) {
    throw new Error(`Browser observation ${index} must record stateRendered: true for the requested state.`);
  }
  if (typeof value.action !== "string" || value.action.trim() === "") {
    throw new Error(`Browser observation ${index} must record a concrete performed action.`);
  }
  const changes = parseStrictChanges(value.changes, index);
  const rawPayload: Record<string, unknown> = {
    ...value,
    overlaps: value.overlaps ?? [],
    focusOrderViolations: value.focusOrderViolations ?? [],
    contrastViolations: value.contrastViolations ?? [],
    stateSynchronization: value.stateSynchronization ?? {
      status: "verified",
      path: `${value.state} primary action`,
      observations: [`action=${value.action}`, ...changes.map(({ locator, before, after }) => `${locator}:${before}->${after}`)],
      action: value.action,
      changes,
    },
  };
  const parsed = parseUiEvidencePayload(rawPayload, { requireMechanical: options.requireMechanical });
  return {
    viewport,
    route: typeof value.route === "string" ? value.route : undefined,
    state: value.state,
    screenshotPath: value.screenshotPath,
    browser: parsed.browser,
    mechanicalSnapshot: parsed.mechanical,
  };
};

export const projectBrowserObservation = (
  payload: BrowserCheckPayload,
  input: { viewport: { width: number; height: number }; state: string; screenshotPath: string },
  route: string,
): BrowserObservation => ({
  schemaVersion: "1.0",
  viewport: input.viewport,
  route,
  state: input.state,
  horizontalOverflow: payload.horizontalOverflow,
  clippedControls: payload.clippedControls,
  unreachableActions: payload.unreachableActions,
  stickyOverlaps: payload.stickyOverlaps,
  consoleErrors: payload.consoleErrors,
  keyboardTraps: payload.keyboardTraps,
  invisibleFocus: payload.invisibleFocus,
  criticalAxeViolations: payload.criticalAxeViolations,
  reducedMotionVerified: payload.reducedMotionVerified,
  screenshotPath: input.screenshotPath,
});

const transitionIsCertifying = (payload: BrowserCheckPayload) =>
  payload.stateRendered
  && payload.stateSynchronization.status === "verified"
  && Boolean(payload.stateSynchronization.action?.trim())
  && Boolean(payload.stateSynchronization.changes?.some(({ before, after }) => before !== after));

export const interpretFrontendUiEvidence = (input: {
  facts: FrontendUiEvidenceFacts;
  evidenceLevel?: UiEvidenceLevel;
  mechanicalCheckPolicy?: MechanicalCheckPolicy;
}): FrontendUiEvidenceInterpretation => {
  const { facts } = input;
  const browserChecks = evaluateBrowserPayload({
    payload: facts.browser,
    viewport: facts.viewport.width,
    state: facts.state,
    screenshotPath: facts.screenshotPath,
    includeStateTransition: input.evidenceLevel !== "observation",
  });
  const mechanicalChecks = facts.mechanicalSnapshot
    ? evaluateMechanicalSnapshot({
      snapshot: facts.mechanicalSnapshot,
      policy: input.mechanicalCheckPolicy ?? defaultMechanicalCheckPolicy,
      viewport: facts.viewport.width,
      state: facts.state,
      screenshotPath: facts.screenshotPath,
    })
    : [];
  return {
    browserChecks,
    mechanicalChecks,
    checks: sortUiCheckResults([...browserChecks, ...mechanicalChecks]),
    stateTransition: transitionIsCertifying(facts.browser) ? "certifying" : "non-certifying",
  };
};

export const interpretBrowserObservation = (
  observation: BrowserObservation,
): FrontendUiEvidenceInterpretation => interpretFrontendUiEvidence({
  evidenceLevel: "observation",
  facts: {
    viewport: observation.viewport,
    route: observation.route,
    state: observation.state,
    screenshotPath: observation.screenshotPath ?? "",
    browser: {
      ...parseLegacyBrowserObservation(observation as unknown as Record<string, unknown>),
      stateRendered: true,
      overlaps: [],
      focusOrderViolations: [],
      contrastViolations: [],
      stateSynchronization: {
        status: "not-applicable",
        path: "compatibility observation",
        observations: ["Observation-level capture does not include State-transition evidence."],
        reason: "State-transition evidence is available only at the verifiable UI-evidence level.",
      },
    },
  },
});

const persistedCapturePayload = (capture: UiCaptureEntry): Record<string, unknown> => ({
  ...capture.observation,
  stateRendered: capture.stateRendered,
  overlaps: capture.overlaps ?? [],
  focusOrderViolations: capture.focusOrderViolations ?? [],
  contrastViolations: capture.contrastViolations ?? [],
  stateSynchronization: capture.stateSynchronization,
  mechanicalSnapshot: capture.mechanicalSnapshot,
});

export const interpretUiEvidenceCapture = (input: {
  capture: UiCaptureEntry;
  route: string;
  requireMechanical?: boolean;
  mechanicalCheckPolicy?: MechanicalCheckPolicy;
}): PersistedUiEvidenceInterpretation => {
  const { capture } = input;
  if (capture.observation.viewport.width !== capture.viewport.width
    || capture.observation.viewport.height !== capture.viewport.height
    || capture.observation.route !== input.route
    || capture.observation.state !== capture.state
    || capture.observation.screenshotPath !== capture.screenshotPath) {
    throw new Error("capture observation identity does not match its requested route, viewport, state, or screenshot");
  }
  if (typeof capture.stateRendered !== "boolean") {
    throw new Error("capture rendered-state evidence is missing or malformed");
  }
  const parsed = parseUiEvidencePayload(persistedCapturePayload(capture), {
    requireMechanical: input.requireMechanical,
  });
  const facts: FrontendUiEvidenceFacts = {
    viewport: capture.viewport,
    route: input.route,
    state: capture.state,
    screenshotPath: capture.screenshotPath,
    browser: parsed.browser,
    mechanicalSnapshot: parsed.mechanical,
  };
  return { facts, interpretation: interpretFrontendUiEvidence({ facts, mechanicalCheckPolicy: input.mechanicalCheckPolicy }) };
};

export const interpretUiEvidenceBundle = (input: {
  bundle: UiEvidenceBundle;
  requireMechanical?: boolean;
  mechanicalCheckPolicy?: MechanicalCheckPolicy;
}) => {
  const captures: Array<PersistedUiEvidenceInterpretation & { capture: UiCaptureEntry }> = [];
  const issues: string[] = [];
  for (const [index, capture] of input.bundle.captures.entries()) {
    try {
      const interpretation = interpretUiEvidenceCapture({
        capture,
        route: input.bundle.route,
        requireMechanical: input.requireMechanical,
        mechanicalCheckPolicy: input.mechanicalCheckPolicy,
      });
      captures.push({ capture, ...interpretation });
    } catch (error) {
      issues.push(`capture ${index}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { captures, issues };
};

export const createUiEvidenceCapture = (input: {
  entry: { viewport: { width: number; height: number }; state: string; screenshotPath: string };
  route: string;
  browser: BrowserCheckPayload;
  mechanicalSnapshot: MechanicalSnapshot;
  mechanicalCheckPolicy?: MechanicalCheckPolicy;
}): UiCaptureEntry => {
  const facts: FrontendUiEvidenceFacts = {
    viewport: input.entry.viewport,
    route: input.route,
    state: input.entry.state,
    screenshotPath: input.entry.screenshotPath,
    browser: input.browser,
    mechanicalSnapshot: input.mechanicalSnapshot,
  };
  const interpretation = interpretFrontendUiEvidence({ facts, mechanicalCheckPolicy: input.mechanicalCheckPolicy });
  return {
    ...input.entry,
    observation: projectBrowserObservation(input.browser, input.entry, input.route),
    stateRendered: input.browser.stateRendered,
    stateSynchronization: normalizeStateSynchronization(input.browser.stateSynchronization),
    overlaps: [...input.browser.overlaps],
    focusOrderViolations: [...input.browser.focusOrderViolations],
    contrastViolations: input.browser.contrastViolations.map(({ locator, ratio, largeText }) => ({ locator, ratio, largeText })),
    mechanicalSnapshot: input.mechanicalSnapshot,
    checks: interpretation.checks,
  };
};

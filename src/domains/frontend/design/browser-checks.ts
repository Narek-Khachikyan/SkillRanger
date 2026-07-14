import type { UiCheckCode, UiCheckResult } from "./evidence-types.ts";
import { defaultMechanicalCheckPolicy, sortUiCheckResults } from "./mechanical.ts";

export type BrowserCheckPayload = {
  horizontalOverflow: boolean;
  clippedControls: string[];
  unreachableActions: string[];
  stickyOverlaps: string[];
  consoleErrors: string[];
  keyboardTraps: string[];
  invisibleFocus: string[];
  criticalAxeViolations: string[];
  reducedMotionVerified: boolean;
  stateRendered: boolean;
  overlaps: string[];
  focusOrderViolations: string[];
  contrastViolations: Array<{ locator: string; ratio: number; largeText: boolean }>;
};

const check = (input: {
  code: UiCheckCode;
  severity: UiCheckResult["severity"];
  viewport: number;
  state: string;
  locator: string;
  measured?: string;
  expected: string;
  screenshotPath: string;
  remediation: string;
}): UiCheckResult => ({
  ...input,
  gate: "hard",
  evidence: [input.screenshotPath, input.locator],
});

export const evaluateBrowserPayload = (input: {
  payload: BrowserCheckPayload;
  viewport: number;
  state: string;
  screenshotPath: string;
}): UiCheckResult[] => {
  const { payload, viewport, state, screenshotPath } = input;
  const checks: UiCheckResult[] = [];
  const addStrings = (
    values: string[], code: UiCheckCode, severity: UiCheckResult["severity"], expected: string, remediation: string,
  ) => values.forEach((locator) => checks.push(check({ code, severity, viewport, state, locator, expected, screenshotPath, remediation })));

  if (payload.horizontalOverflow) checks.push(check({ code: "horizontal-overflow", severity: "high", viewport, state, locator: "document", measured: "scrollWidth exceeds clientWidth", expected: "no horizontal overflow", screenshotPath, remediation: "Find and resize or reflow the overflowing element; do not mask it with overflow-x-hidden." }));
  addStrings(payload.clippedControls, "clipped-content", "high", "controls remain fully visible", "Resize or reflow the clipped control at this viewport.");
  addStrings(payload.overlaps, "element-overlap", "high", "interactive and content regions do not overlap", "Adjust layout constraints so the elements no longer overlap.");
  addStrings(payload.stickyOverlaps, "sticky-overlap", "high", "sticky regions do not obscure content or controls", "Reserve sticky offset space and verify scroll positions.");
  addStrings(payload.consoleErrors, "console-error", "critical", "no runtime console errors", "Resolve the runtime error and recapture fresh evidence.");
  addStrings(payload.unreachableActions, "unreachable-action", "high", "every required action is reachable", "Restore a visible and keyboard-reachable path to this action.");
  addStrings(payload.keyboardTraps, "keyboard-trap", "critical", "Tab, Shift+Tab, and Escape navigation can leave the component", "Correct focus management and provide the expected escape path.");
  addStrings(payload.focusOrderViolations, "focus-order", "high", "focus order follows the visual and semantic workflow", "Reorder DOM or focus management to match the expected task sequence.");
  addStrings(payload.invisibleFocus, "invisible-focus", "high", "every focused control has a visible indicator", "Add a visible focus treatment with sufficient contrast.");
  for (const violation of payload.contrastViolations) {
    const threshold = violation.largeText ? defaultMechanicalCheckPolicy.largeTextContrast : defaultMechanicalCheckPolicy.normalTextContrast;
    if (violation.ratio < threshold) checks.push(check({ code: "contrast", severity: "high", viewport, state, locator: violation.locator, measured: `${violation.ratio}:1`, expected: `contrast ratio at least ${threshold}:1`, screenshotPath, remediation: "Adjust foreground or background roles until the required contrast ratio is met." }));
  }
  addStrings(payload.criticalAxeViolations, "critical-axe", "critical", "no critical accessibility violations", "Resolve the critical accessibility violation and rerun the adapter checks.");
  if (!payload.reducedMotionVerified) checks.push(check({ code: "reduced-motion", severity: "high", viewport, state, locator: "document", measured: "prefers-reduced-motion not verified", expected: "motion is removed or reduced under reduced-motion emulation", screenshotPath, remediation: "Implement and verify the reduced-motion behavior." }));
  if (!payload.stateRendered) checks.push(check({ code: "state-not-rendered", severity: "high", viewport, state, locator: "document", measured: `${state} state absent`, expected: `the ${state} state is rendered`, screenshotPath, remediation: "Exercise and render the requested state before capture." }));
  return sortUiCheckResults(checks);
};

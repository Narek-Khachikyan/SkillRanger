import type { MechanicalSnapshot, UiCheckResult } from "./evidence-types.ts";

export type MechanicalCheckPolicy = {
  spacingScalePx: readonly number[];
  maxSpacingValuesPerContext: number;
  maxUnroledOneOffColors: number;
  maxRadiusValues: number;
  maxShadowValues: number;
  maxTextMeasureCh: number;
  minTouchTargetPx: number;
  minHeadingScaleRatio: number;
  normalTextContrast: number;
  largeTextContrast: number;
};

export const defaultMechanicalCheckPolicy = {
  spacingScalePx: [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96],
  maxSpacingValuesPerContext: 2,
  maxUnroledOneOffColors: 0,
  maxRadiusValues: 3,
  maxShadowValues: 3,
  maxTextMeasureCh: 75,
  minTouchTargetPx: 44,
  minHeadingScaleRatio: 1.2,
  normalTextContrast: 4.5,
  largeTextContrast: 3,
} as const satisfies MechanicalCheckPolicy;

const severityRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
export const sortUiCheckResults = (checks: UiCheckResult[]) => checks.sort((left, right) =>
  severityRank[left.severity] - severityRank[right.severity]
  || left.code.localeCompare(right.code)
  || left.locator.localeCompare(right.locator));

const mechanicalCheck = (input: {
  code: UiCheckResult["code"];
  viewport: number;
  state: string;
  locator: string;
  measured: string;
  expected: string;
  screenshotPath: string;
  remediation: string;
  severity?: UiCheckResult["severity"];
  gate?: UiCheckResult["gate"];
}): UiCheckResult => ({
  code: input.code,
  severity: input.severity ?? "medium",
  gate: input.gate ?? "soft",
  viewport: input.viewport,
  state: input.state,
  locator: input.locator,
  measured: input.measured,
  expected: input.expected,
  evidence: [input.screenshotPath, input.locator],
  remediation: input.remediation,
});

export const evaluateMechanicalSnapshot = (input: {
  snapshot: MechanicalSnapshot;
  policy: MechanicalCheckPolicy;
  viewport: number;
  state: string;
  screenshotPath: string;
}): UiCheckResult[] => {
  const { snapshot, policy, viewport, state, screenshotPath } = input;
  const checks: UiCheckResult[] = [];
  for (const context of snapshot.spacingContexts) {
    const values = [...new Set(context.valuesPx)];
    if (values.length > policy.maxSpacingValuesPerContext || values.some((value) => !policy.spacingScalePx.includes(value))) {
      checks.push(mechanicalCheck({ code: "inconsistent-spacing", viewport, state, locator: context.locators.join(", ") || context.id, measured: values.join(", "), expected: `at most ${policy.maxSpacingValuesPerContext} values from the spacing scale`, screenshotPath, remediation: "Use a consistent spacing role from the approved scale within this context." }));
    }
  }
  for (const color of snapshot.colors) {
    if (!color.role && color.occurrences <= policy.maxUnroledOneOffColors + 1) {
      checks.push(mechanicalCheck({ code: "random-color", viewport, state, locator: color.locator, measured: `${color.value} (${color.occurrences} occurrence)`, expected: "a named color role or repeated intentional use", screenshotPath, remediation: "Map this color to a semantic role or remove the one-off value." }));
    }
  }
  const radii = snapshot.radii.filter(({ isPillOrCircle }) => !isPillOrCircle);
  const radiusValues = [...new Set(radii.map(({ valuePx }) => valuePx))];
  if (radiusValues.length > policy.maxRadiusValues) {
    checks.push(mechanicalCheck({ code: "excessive-radii", viewport, state, locator: radii.map(({ locator }) => locator).join(", "), measured: radiusValues.join(", "), expected: `at most ${policy.maxRadiusValues} non-pill radius values`, screenshotPath, remediation: "Consolidate non-pill corners onto a small radius scale." }));
  }
  const shadows = snapshot.shadows.filter(({ isNone }) => !isNone);
  const shadowValues = [...new Set(shadows.map(({ value }) => value))];
  if (shadowValues.length > policy.maxShadowValues) {
    checks.push(mechanicalCheck({ code: "excessive-shadows", viewport, state, locator: shadows.map(({ locator }) => locator).join(", "), measured: `${shadowValues.length} distinct shadows`, expected: `at most ${policy.maxShadowValues} non-none shadow values`, screenshotPath, remediation: "Consolidate shadows onto intentional elevation roles." }));
  }
  for (const card of snapshot.cards) {
    if (card.semanticRole === "generic" && (card.depth > 1 || card.repeatedCount >= 4)) {
      checks.push(mechanicalCheck({ code: "generic-card-repetition", viewport, state, locator: card.locator, measured: `depth ${card.depth}, repeated ${card.repeatedCount}`, expected: "generic cards are not nested and repeat fewer than four times", screenshotPath, remediation: "Replace repetitive generic cards with a product-specific grouping or list pattern." }));
    }
  }
  const headings = (["h1", "h2", "h3"] as const)
    .map((role) => snapshot.typography.find((entry) => entry.role === role))
    .filter((entry): entry is MechanicalSnapshot["typography"][number] => Boolean(entry));
  for (let index = 0; index < headings.length - 1; index += 1) {
    const larger = headings[index];
    const smaller = headings[index + 1];
    const ratio = smaller.fontSizePx === 0 ? Number.POSITIVE_INFINITY : larger.fontSizePx / smaller.fontSizePx;
    if (ratio < policy.minHeadingScaleRatio) {
      checks.push(mechanicalCheck({ code: "weak-typography-hierarchy", viewport, state, locator: `${larger.locator}, ${smaller.locator}`, measured: `ratio ${ratio.toFixed(2)}`, expected: `adjacent heading size ratio at least ${policy.minHeadingScaleRatio}`, screenshotPath, remediation: "Increase the visual distinction between adjacent heading roles." }));
    }
  }
  for (const block of snapshot.textBlocks) {
    if (block.measureCh > policy.maxTextMeasureCh) {
      checks.push(mechanicalCheck({ code: "text-measure", viewport, state, locator: block.locator, measured: `${block.measureCh}ch`, expected: `at most ${policy.maxTextMeasureCh}ch`, screenshotPath, remediation: "Constrain the text block measure for readable scanning." }));
    }
  }
  for (const target of snapshot.touchTargets) {
    if (target.interactive && (target.widthPx < policy.minTouchTargetPx || target.heightPx < policy.minTouchTargetPx)) {
      checks.push(mechanicalCheck({ code: "touch-target", viewport, state, locator: target.locator, measured: `${target.widthPx}x${target.heightPx}px`, expected: `at least ${policy.minTouchTargetPx}x${policy.minTouchTargetPx}px`, screenshotPath, remediation: "Increase the interactive hit area without obscuring adjacent controls.", severity: "high", gate: "hard" }));
    }
  }
  return sortUiCheckResults(checks);
};

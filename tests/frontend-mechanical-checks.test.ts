import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultMechanicalCheckPolicy,
  evaluateBrowserPayload,
  evaluateMechanicalSnapshot,
  parseUiEvidencePayload,
} from "../src/domains/frontend/design/index.ts";
import { emptyMechanicalSnapshot } from "./helpers/browser-gate-fixtures.ts";

const motionSnapshot = (motion: Array<{ locator: string; transitionProperty: string; transitionTimingFunction: string }>) =>
  ({ ...emptyMechanicalSnapshot, motion });

const evaluateMotion = (motion: Parameters<typeof motionSnapshot>[0]) =>
  evaluateMechanicalSnapshot({
    snapshot: motionSnapshot(motion),
    policy: defaultMechanicalCheckPolicy,
    viewport: 1440,
    state: "success",
    screenshotPath: "1440-success.png",
  });

test("reports spacing, colors, radii, shadows, cards, typography, measure, and targets", () => {
  const checks = evaluateMechanicalSnapshot({
    snapshot: {
      spacingContexts: [{ id: "toolbar", locators: ["#a", "#b", "#c"], valuesPx: [8, 13, 24] }],
      colors: [{ locator: "#badge", value: "#12ab34", occurrences: 1 }],
      radii: [0, 4, 8, 12, 16].map((valuePx, i) => ({ locator: `#r${i}`, valuePx, isPillOrCircle: false })),
      shadows: ["a", "b", "c", "d"].map((value, i) => ({ locator: `#s${i}`, value, isNone: false })),
      cards: [{ locator: ".card", depth: 2, repeatedCount: 6, semanticRole: "generic" }],
      typography: [
        { locator: "h1", role: "h1", fontSizePx: 24, fontWeight: 600 },
        { locator: "h2", role: "h2", fontSizePx: 24, fontWeight: 600 },
        { locator: "p", role: "body", fontSizePx: 16, fontWeight: 400 },
      ],
      textBlocks: [{ locator: "article p", measureCh: 92 }],
      touchTargets: [{ locator: "button.icon", widthPx: 28, heightPx: 28, interactive: true }],
      motion: [{ locator: "#save", transitionProperty: "opacity", transitionTimingFunction: "cubic-bezier(0.25, 0.1, 0.25, 1)" }],
    },
    policy: defaultMechanicalCheckPolicy,
    viewport: 390,
    state: "success",
    screenshotPath: "390-success.png",
  });
  assert.deepEqual([...new Set(checks.map(({ code }) => code))].sort(), [
    "excessive-radii", "excessive-shadows", "generic-card-repetition", "inconsistent-spacing",
    "random-color", "text-measure", "touch-target", "weak-typography-hierarchy",
  ]);
  assert.ok(checks.every(({ evidence }) => evidence.includes("390-success.png")));
  assert.deepEqual(checks, [...checks].sort((a, b) => {
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    return rank[a.severity] - rank[b.severity] || a.code.localeCompare(b.code) || a.locator.localeCompare(b.locator);
  }));
});

test("reports every extended browser failure deterministically", () => {
  const checks = evaluateBrowserPayload({
    payload: {
      horizontalOverflow: true,
      clippedControls: ["#clipped"],
      unreachableActions: ["#save"],
      stickyOverlaps: ["header"],
      consoleErrors: ["TypeError: boom"],
      keyboardTraps: ["#dialog"],
      invisibleFocus: ["#link"],
      criticalAxeViolations: ["#name"],
      reducedMotionVerified: false,
      stateRendered: false,
      overlaps: ["#panel"],
      focusOrderViolations: ["#later"],
      contrastViolations: [{ locator: "#muted", ratio: 2.5, largeText: false }],
      stateSynchronization: {
        status: "mismatch",
        path: "filter[failed] -> run-list -> result-count",
        observations: ["run-list=failed-only", "result-count=all-runs"],
        action: "Select the failed filter",
        changes: [{ locator: "#run-list", before: "all-runs", after: "failed-only" }],
      },
    },
    viewport: 390,
    state: "error",
    screenshotPath: "390-error.png",
  });
  assert.deepEqual([...new Set(checks.map(({ code }) => code))].sort(), [
    "clipped-content", "console-error", "contrast", "critical-axe", "element-overlap",
    "focus-order", "horizontal-overflow", "invisible-focus", "keyboard-trap", "reduced-motion",
    "sticky-overlap", "ui-state-desynchronized", "ui-state-not-rendered", "unreachable-action",
  ]);
  assert.ok(checks.every(({ gate }) => gate === "hard"));
  const mismatch = checks.find(({ code }) => code === "ui-state-desynchronized");
  assert.equal(mismatch?.severity, "high");
  assert.equal(mismatch?.locator, "filter[failed] -> run-list -> result-count");
});

test("verified state synchronization requires an action and an observed change", () => {
  const base = {
    horizontalOverflow: false, clippedControls: [], unreachableActions: [], stickyOverlaps: [],
    consoleErrors: [], keyboardTraps: [], invisibleFocus: [], criticalAxeViolations: [],
    reducedMotionVerified: true, stateRendered: true, overlaps: [], focusOrderViolations: [],
    contrastViolations: [],
  };
  const withoutAction = evaluateBrowserPayload({
    payload: {
      ...base,
      stateSynchronization: {
        status: "verified",
        path: "variant[Ink] -> preview -> summary",
        observations: ["preview=Ink", "summary=Ink"],
        changes: [{ locator: "#preview", before: "Paper", after: "Ink" }],
      },
    },
    viewport: 1440, state: "success", screenshotPath: "1440-success.png",
  });
  assert.deepEqual(withoutAction.map(({ code }) => code), ["ui-state-action-missing"]);

  const withoutChange = evaluateBrowserPayload({
    payload: {
      ...base,
      stateSynchronization: {
        status: "verified",
        path: "variant[Ink] -> preview -> summary",
        observations: ["preview=Ink", "summary=Ink"],
        action: "Choose Ink",
        changes: [{ locator: "#preview", before: "Ink", after: "Ink" }],
      },
    },
    viewport: 1440, state: "success", screenshotPath: "1440-success.png",
  });
  assert.deepEqual(withoutChange.map(({ code }) => code), ["ui-state-change-missing"]);

  const verified = evaluateBrowserPayload({
    payload: {
      ...base,
      stateSynchronization: {
        status: "verified",
        path: "variant[Ink] -> preview -> summary",
        observations: ["preview=Ink", "summary=Ink"],
        action: "Choose Ink",
        changes: [{ locator: "#preview", before: "Paper", after: "Ink" }],
      },
    },
    viewport: 1440, state: "success", screenshotPath: "1440-success.png",
  });
  assert.deepEqual(verified, []);
});

test("detects transition-all from computed transition-property", () => {
  const viaKeyword = evaluateMotion([{
    locator: "#save", transitionProperty: "all", transitionTimingFunction: "cubic-bezier(0.25, 0.1, 0.25, 1)",
  }]);
  assert.deepEqual(viaKeyword.map(({ code }) => code), ["transition-all"]);
  assert.deepEqual(viaKeyword[0].measured, "all");

  const viaSerializedList = evaluateMotion([{
    locator: "#save", transitionProperty: "all, opacity", transitionTimingFunction: "ease",
  }]);
  assert.deepEqual(viaSerializedList.map(({ code }) => code), ["transition-all"]);

  const expanded = Array.from({ length: 24 }, (_, i) => `property-${i}`).join(" ");
  const viaExpansion = evaluateMotion([{
    locator: "#save", transitionProperty: expanded, transitionTimingFunction: "ease",
  }]);
  assert.deepEqual(viaExpansion.map(({ code }) => code), ["transition-all"]);
  assert.equal(viaExpansion[0].measured, "24 transitioned properties");

  const bounded = evaluateMotion([{
    locator: "#save", transitionProperty: "opacity, transform", transitionTimingFunction: "ease",
  }]);
  assert.deepEqual(bounded, []);
});

test("detects bouncy and overshoot easings from computed timing functions", () => {
  const overshootBack = evaluateMotion([{
    locator: "#chip", transitionProperty: "transform", transitionTimingFunction: "cubic-bezier(0.68, -0.55, 0.27, 1.55)",
  }]);
  assert.deepEqual(overshootBack.map(({ code }) => code), ["bouncy-easing"]);

  const overshootForward = evaluateMotion([{
    locator: "#chip", transitionProperty: "transform", transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  }]);
  assert.deepEqual(overshootForward.map(({ code }) => code), ["bouncy-easing"]);

  const clean = evaluateMotion([
    { locator: "#a", transitionProperty: "opacity", transitionTimingFunction: "ease" },
    { locator: "#b", transitionProperty: "transform", transitionTimingFunction: "linear" },
    { locator: "#c", transitionProperty: "opacity", transitionTimingFunction: "steps(4, end)" },
    { locator: "#d", transitionProperty: "opacity, transform", transitionTimingFunction: "cubic-bezier(0.42, 0, 0.58, 1)" },
  ]);
  assert.deepEqual(clean, []);
});

test("reports motion tells as soft mechanical checks with screenshot evidence", () => {
  const checks = evaluateMotion([{
    locator: "#save", transitionProperty: "all", transitionTimingFunction: "cubic-bezier(0.68, -0.55, 0.27, 1.55)",
  }]);
  assert.deepEqual([...new Set(checks.map(({ code }) => code))].sort(), ["bouncy-easing", "transition-all"]);
  assert.ok(checks.every(({ gate, severity, viewport, state, evidence }) =>
    gate === "soft"
    && severity === "medium"
    && viewport === 1440
    && state === "success"
    && evidence.includes("1440-success.png")
    && evidence.includes("#save")));
  assert.ok(checks.every(({ expected, remediation }) =>
    expected.length > 0 && remediation.length > 0));
});

test("parses legacy snapshots without the motion record", () => {
  const parsed = parseUiEvidencePayload({
    horizontalOverflow: false, clippedControls: [], unreachableActions: [], stickyOverlaps: [],
    consoleErrors: [], keyboardTraps: [], invisibleFocus: [], criticalAxeViolations: [],
    reducedMotionVerified: true, stateRendered: true, overlaps: [], focusOrderViolations: [],
    contrastViolations: [],
    stateSynchronization: {
      status: "verified", path: "p -> q", observations: ["p=a", "q=b"],
      action: "Pick", changes: [{ locator: "#q", before: "a", after: "b" }],
    },
    mechanicalSnapshot: {
      spacingContexts: [], colors: [], radii: [], shadows: [], cards: [], typography: [], textBlocks: [],
      touchTargets: [],
    },
  }, { requireMechanical: true });
  assert.deepEqual(parsed.mechanical?.motion, []);
});

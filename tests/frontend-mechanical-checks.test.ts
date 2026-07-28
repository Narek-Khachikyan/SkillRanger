import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultMechanicalCheckPolicy,
  evaluateBrowserPayload,
  evaluateMechanicalSnapshot,
} from "../src/domains/frontend/design/index.ts";

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

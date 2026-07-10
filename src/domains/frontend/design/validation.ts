import { statSync } from "node:fs";
import { createVerificationReport } from "../../../runtime/verification.ts";
import type { VerificationFinding } from "../../../runtime/types.ts";
import type {
  BrowserObservation,
  DesignBrief,
  DesignDirection,
  DesignValidationResult,
} from "./types.ts";

const requiredStates = new Set(["loading", "empty", "error"]);
const usageFrequencies = new Set(["rare", "occasional", "frequent", "continuous", "unknown"]);
const supportedRecipeIds = new Set([
  "operational-command-center",
  "consumer-discovery",
  "developer-tool",
  "editorial-content",
]);
const axisValues = {
  density: new Set(["compact", "balanced", "spacious", "editorial"]),
  hierarchy: new Set(["action-first", "data-first", "narrative-first", "exception-first"]),
  composition: new Set(["structured-list", "grid", "split-pane", "timeline", "table", "editorial-grid"]),
  material: new Set(["flat", "bordered", "layered", "tactile", "document-like"]),
  motionIntensity: new Set(["none", "low", "medium", "high"]),
  expressionLevel: new Set(["restrained", "balanced", "expressive"]),
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isStringRecord = (value: unknown) =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
};

const defaultArtifactExists = (filePath: string) => {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
};

const finding = (
  code: string,
  severity: VerificationFinding["severity"],
  gate: VerificationFinding["gate"],
  message: string,
  remediation: string,
  evidence: string[] = [],
): VerificationFinding => ({
  id: code,
  code,
  source: "frontend.design-validator",
  severity,
  gate,
  message,
  evidence,
  remediation,
  autofixable: false,
});

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

export const validateDesignBrief = (brief: unknown): VerificationFinding[] => {
  const findings: VerificationFinding[] = [];
  if (!isRecord(brief) || brief.schemaVersion !== "1.0") {
    findings.push(finding("brief-schema-version", "critical", "hard", "Design brief schemaVersion must be 1.0.", "Regenerate the brief with schemaVersion 1.0."));
    return findings;
  }

  const product = isRecord(brief.product) ? brief.product : undefined;
  const surface = isRecord(brief.surface) ? brief.surface : undefined;
  const briefDirection = isRecord(brief.direction) ? brief.direction : undefined;
  const evidenceGroups = isRecord(brief.evidence) ? brief.evidence : undefined;

  if (
    !hasOnlyKeys(brief, ["schemaVersion", "product", "surface", "direction", "evidence"]) ||
    !product ||
    !surface ||
    !briefDirection ||
    !evidenceGroups
  ) {
    findings.push(finding(
      "brief-structure-contract",
      "critical",
      "hard",
      "Design brief must contain only the canonical product, surface, direction, and evidence objects.",
      "Regenerate the brief from the canonical design-brief schema.",
    ));
  }

  for (const [field, value] of [
    ["product.domain", product?.domain],
    ["product.primaryUserOrActor", product?.primaryUserOrActor],
    ["product.primaryTask", product?.primaryTask],
    ["surface.type", surface?.type],
    ["surface.primaryAction", surface?.primaryAction],
    ["direction.existingDirection", briefDirection?.existingDirection],
  ] as const) {
    if (!nonEmpty(value)) {
      findings.push(finding("brief-required-field", "critical", "hard", `${field} is required.`, `Provide ${field} or explicitly use \"unknown\".`));
    }
  }

  if (
    !product ||
    !hasOnlyKeys(product, ["domain", "primaryUserOrActor", "primaryTask", "contentTypes", "usageFrequency", "stakes"]) ||
    !isStringArray(product.contentTypes) ||
    !isStringArray(product.stakes) ||
    typeof product.usageFrequency !== "string" ||
    !usageFrequencies.has(product.usageFrequency)
  ) {
    findings.push(finding(
      "brief-product-contract",
      "critical",
      "hard",
      "Design brief product metadata must match the canonical contentTypes, usageFrequency, and stakes contract.",
      "Regenerate product metadata from the canonical design-brief schema.",
    ));
  }

  if (
    !surface ||
    !hasOnlyKeys(surface, ["type", "primaryAction", "supportedViewports", "requiredStates"]) ||
    !Array.isArray(surface.supportedViewports) ||
    surface.supportedViewports.length < 2 ||
    !surface.supportedViewports.every((width) => Number.isInteger(width) && Number(width) >= 320)
  ) {
    findings.push(finding("brief-viewports", "high", "hard", "Material design work requires mobile and desktop viewports.", "Add at least one mobile width and one desktop width."));
  }
  if (!surface || !isStringArray(surface.requiredStates)) {
    findings.push(finding("brief-state-matrix", "high", "hard", "requiredStates must be declared.", "Declare required UI states for the primary flow."));
  } else {
    const declared = new Set(surface.requiredStates);
    for (const state of requiredStates) {
      if (!declared.has(state)) {
        findings.push(finding("brief-required-state", "medium", "soft", `The ${state} state is not declared.`, `Add ${state} or document why the surface cannot enter it.`));
      }
    }
  }

  if (
    !briefDirection ||
    !hasOnlyKeys(briefDirection, ["requestedTone", "antiGoals", "existingDirection"]) ||
    !isStringArray(briefDirection.requestedTone) ||
    !isStringArray(briefDirection.antiGoals)
  ) {
    findings.push(finding(
      "brief-direction-contract",
      "critical",
      "hard",
      "Design brief direction metadata must declare requestedTone, antiGoals, and existingDirection.",
      "Regenerate direction metadata from the canonical design-brief schema.",
    ));
  }

  const evidenceKeys = ["observed", "inferred", "assumed", "unknown"] as const;
  if (
    !evidenceGroups ||
    !hasOnlyKeys(evidenceGroups, evidenceKeys) ||
    !evidenceKeys.every((key) => Array.isArray(evidenceGroups[key]))
  ) {
    findings.push(finding("brief-evidence-ledger", "critical", "hard", "Evidence must be separated into observed, inferred, assumed, and unknown.", "Create all four evidence arrays and move each statement into exactly one category."));
  } else {
    const seen = new Map<string, string>();
    for (const category of evidenceKeys) {
      const entries = evidenceGroups[category];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (
          !isRecord(entry) ||
          !hasOnlyKeys(entry, ["statement", "source"]) ||
          !nonEmpty(entry.statement) ||
          (entry.source !== undefined && typeof entry.source !== "string")
        ) {
          findings.push(finding(
            "brief-evidence-entry-contract",
            "critical",
            "hard",
            `Evidence in ${category} must contain a non-empty statement and an optional string source.`,
            "Regenerate the evidence entry from the canonical design-brief schema.",
          ));
          continue;
        }
        const normalized = entry.statement.trim().toLowerCase();
        const existing = seen.get(normalized);
        if (existing && existing !== category) {
          findings.push(finding("brief-mixed-evidence", "high", "hard", `The same statement appears as both ${existing} and ${category}.`, "Keep each evidence statement in one category only.", [entry.statement]));
        } else {
          seen.set(normalized, category);
        }
      }
    }
  }
  return findings;
};

export const validateDesignDirection = (
  brief: unknown,
  direction: unknown,
): VerificationFinding[] => {
  const findings: VerificationFinding[] = [];
  if (!isRecord(direction) || direction.schemaVersion !== "1.0") {
    return [finding("direction-schema-version", "critical", "hard", "Design direction schemaVersion must be 1.0.", "Regenerate the direction with schemaVersion 1.0.")];
  }
  for (const [field, value] of [
    ["recipeId", direction.recipeId],
    ["thesis", direction.thesis],
    ["productReason", direction.productReason],
    ["signatureMove", direction.signatureMove],
    ["destructiveCritique", direction.destructiveCritique],
  ] as const) {
    if (!nonEmpty(value)) findings.push(finding("direction-required-field", "critical", "hard", `${field} is required.`, `Provide a product-specific ${field}.`));
  }

  if (!nonEmpty(direction.recipeId) || !supportedRecipeIds.has(direction.recipeId)) {
    findings.push(finding(
      "direction-recipe-contract",
      "critical",
      "hard",
      "Design direction recipeId must reference a bundled frontend recipe.",
      "Select one of the recipes returned by recommendFrontendRecipe.",
    ));
  }

  const axes = isRecord(direction.axes) ? direction.axes : undefined;
  const axesValid = Boolean(
    axes &&
    hasOnlyKeys(axes, Object.keys(axisValues)) &&
    Object.entries(axisValues).every(([key, allowed]) =>
      typeof axes[key] === "string" && allowed.has(axes[key] as never),
    ),
  );
  if (!axesValid) {
    findings.push(finding(
      "direction-axes-contract",
      "critical",
      "hard",
      "Design direction axes must contain supported density, hierarchy, composition, material, motionIntensity, and expressionLevel values.",
      "Regenerate the direction from the canonical design-direction schema.",
    ));
  }

  if (!isStringRecord(direction.typographyRoles) || !isStringRecord(direction.colorRoles)) {
    findings.push(finding(
      "direction-role-contract",
      "critical",
      "hard",
      "Design direction typographyRoles and colorRoles must be string maps.",
      "Declare canonical typography and color role maps.",
    ));
  }
  if (
    !isStringArray(direction.rejectedDefaults) ||
    direction.rejectedDefaults.length === 0 ||
    direction.rejectedDefaults.some((entry) => !entry.trim())
  ) {
    findings.push(finding(
      "direction-rejected-default",
      "critical",
      "hard",
      "At least one non-empty rejected default is required.",
      "Name a plausible but product-inappropriate default.",
    ));
  }
  if (!hasOnlyKeys(direction, [
    "schemaVersion",
    "recipeId",
    "thesis",
    "productReason",
    "axes",
    "typographyRoles",
    "colorRoles",
    "signatureMove",
    "rejectedDefaults",
    "destructiveCritique",
  ])) {
    findings.push(finding(
      "direction-structure-contract",
      "critical",
      "hard",
      "Design direction contains fields outside the canonical contract.",
      "Remove unsupported fields and regenerate the direction.",
    ));
  }

  const briefRecord = isRecord(brief) ? brief : undefined;
  const product = briefRecord && isRecord(briefRecord.product) ? briefRecord.product : undefined;
  const surface = briefRecord && isRecord(briefRecord.surface) ? briefRecord.surface : undefined;
  const domain = typeof product?.domain === "string" ? product.domain : "";
  const stakes = isStringArray(product?.stakes) ? product.stakes : [];
  const supportedViewports = Array.isArray(surface?.supportedViewports)
    ? surface.supportedViewports.filter((width): width is number => typeof width === "number")
    : [];
  const regulated = /health|medical|finance|bank|legal|regulated|patient/i.test(
    `${domain} ${stakes.join(" ")}`,
  );
  if (axesValid && regulated && axes?.motionIntensity === "high") {
    findings.push(finding("constraint-regulated-motion", "critical", "hard", "High ambient motion is incompatible with a regulated or high-stakes interface.", "Reduce motion intensity and retain only state or cause-and-effect motion."));
  }
  if (
    axesValid &&
    axes?.density === "compact" &&
    axes.composition === "table" &&
    axes.expressionLevel === "expressive"
  ) {
    findings.push(finding("constraint-dense-expression", "medium", "soft", "Expressive treatment may reduce scan efficiency in a compact table.", "Restrict expression to one signature move outside repeated data cells."));
  }
  if (
    axesValid &&
    supportedViewports.length > 0 &&
    supportedViewports.every((width) => width <= 480) &&
    axes?.composition === "split-pane"
  ) {
    findings.push(finding("constraint-mobile-split-pane", "high", "hard", "A split-pane composition has no declared wide viewport.", "Use a staged drill-in flow or add a supported wide viewport."));
  }
  return findings;
};

export const validateBrowserObservations = (
  brief: unknown,
  observations: unknown[],
  options: { artifactExists?: (filePath: string) => boolean } = {},
): VerificationFinding[] => {
  const findings: VerificationFinding[] = [];
  if (observations.length === 0) {
    return [finding("browser-evidence-missing", "high", "hard", "No browser observations were supplied.", "Render the primary route at the required viewports and states, then record observations.")];
  }
  const artifactExists = options.artifactExists ?? defaultArtifactExists;
  const briefRecord = isRecord(brief) ? brief : undefined;
  const surfaceContract = briefRecord && isRecord(briefRecord.surface) ? briefRecord.surface : undefined;
  const supportedViewports = Array.isArray(surfaceContract?.supportedViewports)
    ? surfaceContract.supportedViewports.filter((width): width is number => typeof width === "number")
    : [];
  const requiredSurfaceStates = isStringArray(surfaceContract?.requiredStates)
    ? surfaceContract.requiredStates
    : [];
  const validObservations: Array<Record<string, unknown> & { viewport: Record<string, unknown> }> = [];
  for (const observation of observations) {
    const viewport = isRecord(observation) && isRecord(observation.viewport)
      ? observation.viewport
      : undefined;
    const arraysValid = isRecord(observation) && [
      "clippedControls",
      "unreachableActions",
      "stickyOverlaps",
      "consoleErrors",
      "keyboardTraps",
      "invisibleFocus",
      "criticalAxeViolations",
    ].every((key) => isStringArray(observation[key]));
    if (
      !isRecord(observation) ||
      !viewport ||
      !Number.isInteger(viewport.width) ||
      !Number.isInteger(viewport.height) ||
      !nonEmpty(observation.route) ||
      !nonEmpty(observation.state) ||
      typeof observation.horizontalOverflow !== "boolean" ||
      typeof observation.reducedMotionVerified !== "boolean" ||
      !arraysValid
    ) {
      findings.push(finding(
        "browser-observation-contract",
        "critical",
        "hard",
        "Browser observations must match the canonical viewport, state, runtime, accessibility, and motion contract.",
        "Regenerate browser observations through the supported adapter contract.",
      ));
      continue;
    }
    validObservations.push({ ...observation, viewport });
  }
  const matrix = new Set(
    validObservations.map((observation) => `${observation.viewport.width}::${observation.state}`),
  );
  for (const viewport of supportedViewports) {
    for (const state of requiredSurfaceStates) {
      if (!matrix.has(`${viewport}::${state}`)) {
        findings.push(finding(
          "responsive-state-evidence-missing",
          "high",
          "hard",
          `No browser evidence exists for ${viewport}px in the ${state} state.`,
          `Render and inspect the ${state} state at ${viewport}px.`,
        ));
      }
    }
  }
  const checks: Array<{
    key: keyof BrowserObservation;
    code: string;
    message: string;
    remediation: string;
  }> = [
    { key: "clippedControls", code: "clipped-controls", message: "Controls are clipped.", remediation: "Recompose or resize the affected controls without hiding required actions." },
    { key: "unreachableActions", code: "unreachable-actions", message: "Required actions are unreachable.", remediation: "Move the action into the reachable flow for the affected viewport." },
    { key: "stickyOverlaps", code: "sticky-overlap", message: "Sticky UI overlaps content or controls.", remediation: "Reserve layout space or adjust sticky bounds and offsets." },
    { key: "consoleErrors", code: "runtime-console-error", message: "Runtime console errors remain.", remediation: "Resolve the underlying runtime errors and rerun verification." },
    { key: "keyboardTraps", code: "keyboard-trap", message: "A keyboard trap was observed.", remediation: "Restore complete keyboard navigation and an escape path." },
    { key: "invisibleFocus", code: "invisible-focus", message: "Focus is invisible in the primary flow.", remediation: "Add a visible non-clipped focus indicator." },
    { key: "criticalAxeViolations", code: "critical-axe", message: "Critical axe violations remain.", remediation: "Resolve the reported accessibility violations before verification." },
  ];
  for (const observation of validObservations) {
    const surface = `${observation.route} ${observation.viewport.width}x${observation.viewport.height} ${observation.state}`;
    if (observation.horizontalOverflow) {
      findings.push(finding("horizontal-overflow", "critical", "hard", `Page-level horizontal overflow at ${surface}.`, "Remove the overflowing layout condition without hiding reachable content.", [surface]));
    }
    for (const check of checks) {
      const value = observation[check.key];
      if (Array.isArray(value) && value.length > 0) {
        findings.push(finding(check.code, "critical", "hard", `${check.message} ${surface}`, check.remediation, value));
      }
    }
    if (!observation.reducedMotionVerified) {
      findings.push(finding("reduced-motion-unverified", "high", "hard", `Reduced-motion behavior was not verified at ${surface}.`, "Enable reduced motion and verify that essential state changes remain understandable."));
    }
    if (!nonEmpty(observation.screenshotPath) || !artifactExists(observation.screenshotPath)) {
      findings.push(finding(
        "screenshot-evidence-missing",
        "high",
        "hard",
        `Screenshot evidence is missing for ${surface}.`,
        "Capture the expected screenshot artifact and rerun browser verification.",
        [surface],
      ));
    }
  }
  return findings;
};

export const validateDesignResult = (input: {
  workflowId: string;
  brief: DesignBrief;
  direction: DesignDirection;
  observations?: BrowserObservation[];
  capabilities?: string[];
  iteration?: number;
  artifactExists?: (filePath: string) => boolean;
}): DesignValidationResult => {
  const capabilities = new Set(input.capabilities ?? []);
  const browserReady = capabilities.has("browser") && capabilities.has("screenshots");
  const artifactExists = input.artifactExists ?? defaultArtifactExists;
  const findings = [
    ...validateDesignBrief(input.brief),
    ...validateDesignDirection(input.brief, input.direction),
    ...(browserReady
      ? validateBrowserObservations(input.brief, input.observations ?? [], { artifactExists })
      : []),
  ];
  const hardFailures = findings.some(
    (finding) => finding.gate === "hard" && ["critical", "high"].includes(finding.severity),
  );
  const report = createVerificationReport({
    domain: "frontend",
    workflowId: input.workflowId,
    iteration: input.iteration,
    capabilityStatus: browserReady ? "ready" : "degraded",
    executionStatus: "implemented",
    verificationStatus: browserReady ? (hardFailures ? "failed" : "passed") : "not-run",
    findings,
    evidence: (input.observations ?? []).flatMap((observation) =>
      observation.screenshotPath && artifactExists(observation.screenshotPath)
        ? [{ kind: "screenshot", path: observation.screenshotPath, description: `${observation.route} at ${observation.viewport.width}px in ${observation.state}` }]
        : [],
    ),
    residualRisks: browserReady ? [] : ["Browser and screenshot evidence were not available."],
  });
  return { findings: report.findings, report };
};

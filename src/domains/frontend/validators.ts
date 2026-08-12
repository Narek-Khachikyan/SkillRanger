import {
  interpretFrontendUiEvidence,
  isRecord,
  parseStrictUiEvidenceObservation,
  type FrontendUiEvidenceFacts,
} from "./design/ui-evidence.ts";
import {
  defaultDiversificationCount,
  evaluateDiversificationGate,
  parseDiversificationMessage,
  type DiversificationSnapshot,
} from "./design/identity-fingerprint.ts";
import type { DomainValidatorEvaluator, DomainValidatorProjection } from "../types.ts";
import type { EvidenceArtifact } from "../../runtime/strict/types.ts";
import type { Result } from "../../runtime/strict/core-validators.ts";
import { canonicalizeJson } from "../../runtime/skill-run/validation.ts";
import { evaluateTailwindSource, gateSlug } from "./source-validator.ts";

export const evaluatePerformanceClaims = (projection: DomainValidatorProjection) => {
  const output = isRecord(projection.output) ? projection.output : undefined;
  const findings = Array.isArray(output?.findings) ? output.findings.filter(isRecord) : [];
  const measurements = Array.isArray(output?.measurementsInspected)
    ? output.measurementsInspected.filter((item): item is string => typeof item === "string")
    : [];
  const gaps = Array.isArray(output?.measurementGaps)
    ? output.measurementGaps.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const beforeAfter = measurements.some((item) => /before/i.test(item)) && measurements.some((item) => /after/i.test(item));
  const checks: Record<string, boolean> = {
    "finding-dimension-present": findings.every((finding) => typeof finding.affectedFlow === "string" && typeof finding.dimension === "string"),
    "measured-claim-has-artifact": findings.filter((finding) => finding.basis === "measured").every((finding) => Array.isArray(finding.evidence) && finding.evidence.length > 0),
    "before-after-required-for-win": output?.mode !== "validate-change" || beforeAfter,
    "unmeasured-claims-labeled-risk": findings.every((finding) => finding.basis === "measured" || finding.basis === "risk"),
    "exact-missing-measurement": !findings.some((finding) => finding.basis === "risk") || gaps.length > 0,
    "priority-confidence-present": findings.every((finding) => typeof finding.impact === "string" && typeof finding.confidence === "string" && typeof finding.tradeoff === "string"),
    "no-false-performance-win": output?.mode !== "validate-change" || beforeAfter,
  };
  const slug = gateSlug(projection.gateId);
  const passed = output !== undefined && checks[slug] === true;
  return { passed, ...(passed ? {} : { message: `Performance report failed ${slug}.` }) };
};

const browserGateSlugs = [
  "required-states-covered",
  "no-horizontal-overflow",
  "no-clipped-controls",
  "no-sticky-overlap",
  "focus-visible",
  "no-runtime-console-errors",
  "reduced-motion-verified",
  "bounded-motion",
];
const observationKeys = [
  "viewport",
  "state",
  "screenshotPath",
  "horizontalOverflow",
  "clippedControls",
  "unreachableActions",
  "stickyOverlaps",
  "consoleErrors",
  "keyboardTraps",
  "invisibleFocus",
  "criticalAxeViolations",
  "reducedMotionVerified",
  "stateRendered",
  "action",
  "changes",
] as const;
const verificationInputKeys = ["observations", "requiredStates"] as const;
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const parseRequiredStates = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0
    || !value.every((state) => typeof state === "string" && state.trim() !== "")) {
    throw new Error("verification-input requiredStates must be a non-empty array of strings.");
  }
  return [...new Set(value as string[])];
};

const deriveBrowserGateResults = (
  value: unknown,
  artifacts: readonly EvidenceArtifact[],
  options: { requiredStates?: readonly string[] } = {},
): Record<string, Result> => {
  const failed = (message: string) => Object.fromEntries(
    browserGateSlugs.map((slug) => [slug, { passed: false, message }]),
  );
  if (!isRecord(value) || !hasOnlyKeys(value, verificationInputKeys) || !Array.isArray(value.observations)) {
    // The rejection carries the contract: without it an agent cannot tell this apart from the
    // other verification-input shapes (performance review passes {measurements}) and retries blind.
    return failed(
      "verification-input for frontend/browser-hard-gates must be exactly { observations: [...] }, "
      + "with optional requiredStates metadata, "
      + `where every observation has the closed shape: ${observationKeys.join(", ")}. `
      + "Self-declared pass flags are not accepted; observations must include a rendered state, "
      + "a concrete action, and an observed before/after change bound to real browser capture evidence.",
    );
  }
  let observations: FrontendUiEvidenceFacts[];
  let requiredStates: string[] | undefined;
  try {
    const declaredRequiredStates = Object.hasOwn(value, "requiredStates")
      ? parseRequiredStates(value.requiredStates)
      : undefined;
    const optionRequiredStates = options.requiredStates === undefined
      ? undefined
      : parseRequiredStates(options.requiredStates);
    observations = value.observations.map((observation, index) =>
      parseStrictUiEvidenceObservation(observation, index, { requireMechanical: true }));
    requiredStates = optionRequiredStates === undefined
      ? declaredRequiredStates
      : optionRequiredStates;
  } catch (error) {
    return failed(error instanceof Error ? error.message : "verification-input must contain valid browser observations.");
  }
  const screenshotBindings = new Set(
    artifacts
      .filter((artifact): artifact is EvidenceArtifact & { sourcePath: string } =>
        /^browser-screenshot-\d+$/.test(artifact.kind) && typeof artifact.sourcePath === "string")
      .map(({ kind, sourcePath }) => `${kind.slice("browser-screenshot-".length)}::${sourcePath}`),
  );
  const observationScreenshotPaths = observations.map(({ screenshotPath }) => screenshotPath);
  if (new Set(observationScreenshotPaths).size !== observationScreenshotPaths.length) {
    return failed("Browser observations must use distinct screenshot paths.");
  }
  if (observations.some(({ viewport, screenshotPath }) => !screenshotBindings.has(`${viewport.width}::${screenshotPath}`))) {
    return failed("Observation screenshot is not bound to ingested evidence.");
  }
  const interpretations = observations.map((facts) => interpretFrontendUiEvidence({ facts }));
  const checks = interpretations.flatMap(({ checks: factsChecks }) => factsChecks);
  const unsupportedHardChecks = checks.filter(({ code, gate }) => gate === "hard" && ![
    "horizontal-overflow", "clipped-content", "element-overlap", "unreachable-action", "sticky-overlap",
    "focus-order", "keyboard-trap", "invisible-focus", "critical-axe", "contrast", "console-error",
    "reduced-motion", "ui-state-not-rendered", "ui-state-action-missing", "ui-state-change-missing",
    "ui-state-desynchronized", "transition-all", "bouncy-easing",
  ].includes(code));
  if (unsupportedHardChecks.length > 0) {
    return failed(`Canonical frontend UI evidence contains non-certifying hard findings: ${unsupportedHardChecks.map(({ code }) => code).join(", ")}.`);
  }
  const hasCheck = (codes: string[]) => !checks.some(({ code }) => codes.includes(code));
  const widths = new Set(observations.map(({ viewport }) => viewport.width));
  const matrixStates = requiredStates ?? [...new Set(observations.map(({ state }) => state))];
  const missingMatrixEntries = [390, 768, 1440].flatMap((width) =>
    matrixStates
      .filter((state) => !observations.some((observation) => observation.viewport.width === width && observation.state === state))
      .map((state) => `${width}px:${state}`));
  return {
    "required-states-covered": {
      passed: [390, 768, 1440].every((width) => widths.has(width))
        && missingMatrixEntries.length === 0
        && hasCheck(["ui-state-not-rendered", "ui-state-action-missing", "ui-state-change-missing", "ui-state-desynchronized"]),
    },
    "no-horizontal-overflow": { passed: hasCheck(["horizontal-overflow"]) },
    "no-clipped-controls": { passed: hasCheck(["clipped-content", "element-overlap", "unreachable-action"]) },
    "no-sticky-overlap": { passed: hasCheck(["sticky-overlap"]) },
    "focus-visible": { passed: hasCheck(["focus-order", "keyboard-trap", "invisible-focus", "critical-axe", "contrast"]) },
    "no-runtime-console-errors": { passed: hasCheck(["console-error"]) },
    "reduced-motion-verified": { passed: hasCheck(["reduced-motion"]) },
    "bounded-motion": { passed: hasCheck(["transition-all", "bouncy-easing"]) },
  };
};

export const evaluateBrowserHardGates = (projection: DomainValidatorProjection) => {
  const slug = gateSlug(projection.gateId);
  const input = isRecord(projection.input) ? projection.input : undefined;
  const brief = isRecord(input?.brief) ? input.brief : undefined;
  const surface = isRecord(brief?.surface) ? brief.surface : undefined;
  const briefRequiredStates = surface?.requiredStates;
  const requiredStates = Array.isArray(briefRequiredStates)
    && briefRequiredStates.length > 0
    && briefRequiredStates.every((state) => typeof state === "string" && state.trim() !== "")
    ? briefRequiredStates as string[]
    : undefined;
  const result = deriveBrowserGateResults(projection.verificationInput, projection.artifacts, { requiredStates })[slug];
  return result ?? { passed: false, message: `Browser hard gate ${slug} is not a certifying gate.` };
};

/**
 * Deterministic identity diversification hard gate. The current run's certified direction is
 * compared against a snapshot of the last N verified run directions (execution-policy default 3),
 * requiring deviation on at least one identity dimension (macrostructure, theme axes, composition,
 * material). Once a verification report records the comparison snapshot, every later evaluation —
 * including finalization's re-check — replays that recorded snapshot instead of re-deriving a live
 * set, so a run completing between verify and finalize cannot flip the outcome.
 */
export const evaluateIdentityDiversification = (projection: DomainValidatorProjection): Result => {
  const slug = gateSlug(projection.gateId);
  if (slug !== "identity-diversification") {
    return { passed: false, message: `Gate ${slug} is not the identity-diversification gate.` };
  }
  // New directions must emit schemaVersion 1.1: legacy 1.0 directions remain loadable by the
  // direction validator, but a run can only be certified on a 1.1 direction carrying the declared
  // identity fields the fingerprint needs.
  if (isRecord(projection.direction) && typeof projection.direction.schemaVersion === "string"
    && projection.direction.schemaVersion !== "1.1") {
    return {
      passed: false,
      message: canonicalizeJson({
        gate: "identity-diversification",
        passed: false,
        reason: "direction-schema-version",
        schemaVersion: projection.direction.schemaVersion,
      }),
    };
  }
  let recordedSnapshot: DiversificationSnapshot | undefined;
  const latestReport = (projection.verificationReports ?? []).at(-1);
  const recorded = latestReport?.gateResults.find(({ gateId }) => gateId === projection.gateId);
  if (recorded?.message !== undefined) {
    const parsed = parseDiversificationMessage(recorded.message);
    if (!parsed) {
      return { passed: false, message: "The recorded identity-diversification gate result is malformed." };
    }
    recordedSnapshot = parsed.snapshot;
  }
  const count = Number.isInteger(projection.diversificationCount) && projection.diversificationCount! >= 1
    ? projection.diversificationCount!
    : defaultDiversificationCount;
  const result = evaluateDiversificationGate({
    direction: projection.direction,
    verifiedRuns: projection.verifiedRuns ?? [],
    count,
    ...(recordedSnapshot === undefined ? {} : { recordedSnapshot }),
  });
  return { passed: result.passed, message: result.message };
};

export const frontendValidatorEvaluators: Readonly<Record<string, DomainValidatorEvaluator>> = {
  "frontend/performance-claims": evaluatePerformanceClaims,
  "frontend/browser-hard-gates": evaluateBrowserHardGates,
  "frontend/tailwind-source": evaluateTailwindSource,
  "frontend/identity-diversification": evaluateIdentityDiversification,
};

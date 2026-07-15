import { validateFrontendSources } from "../../domains/frontend/design/source-validation.ts";
import type { EvidenceArtifact } from "./types.ts";

type Result = { passed: boolean; message?: string };
type Observation = {
  viewport: { width: number; height: number };
  state: string;
  screenshotPath: string;
  horizontalOverflow: boolean;
  clippedControls: string[];
  unreachableActions: string[];
  stickyOverlaps: string[];
  consoleErrors: string[];
  keyboardTraps: string[];
  invisibleFocus: string[];
  criticalAxeViolations: string[];
  reducedMotionVerified: boolean;
};

const browserGateSlugs = [
  "required-states-covered",
  "no-horizontal-overflow",
  "no-clipped-controls",
  "no-sticky-overlap",
  "focus-visible",
  "no-runtime-console-errors",
  "reduced-motion-verified",
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
] as const;
const stringArrayKeys = [
  "clippedControls",
  "unreachableActions",
  "stickyOverlaps",
  "consoleErrors",
  "keyboardTraps",
  "invisibleFocus",
  "criticalAxeViolations",
] as const;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
};
const parseObservation = (value: unknown, index: number): Observation => {
  if (!record(value) || !exactKeys(value, observationKeys)) {
    throw new Error(`Browser observation ${index} must have the required closed shape.`);
  }
  if (!record(value.viewport) || !exactKeys(value.viewport, ["width", "height"])) {
    throw new Error(`Browser observation ${index} viewport must contain width and height.`);
  }
  const { width, height } = value.viewport;
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0 || typeof height !== "number" || !Number.isFinite(height) || height <= 0) {
    throw new Error(`Browser observation ${index} viewport dimensions must be finite positive numbers.`);
  }
  if (typeof value.state !== "string" || value.state.trim() === "") {
    throw new Error(`Browser observation ${index} state must be a non-empty string.`);
  }
  if (typeof value.screenshotPath !== "string" || value.screenshotPath.trim() === "") {
    throw new Error(`Browser observation ${index} screenshotPath must be a non-empty string.`);
  }
  if (typeof value.horizontalOverflow !== "boolean") {
    throw new Error(`Browser observation ${index} horizontalOverflow must be boolean.`);
  }
  if (typeof value.reducedMotionVerified !== "boolean") {
    throw new Error(`Browser observation ${index} reducedMotionVerified must be boolean.`);
  }
  for (const key of stringArrayKeys) {
    if (!Array.isArray(value[key]) || !value[key].every((item) => typeof item === "string")) {
      throw new Error(`Browser observation ${index} ${key} must be an array of strings.`);
    }
  }
  return value as Observation;
};

export const deriveBrowserGateResults = (
  value: unknown,
  artifacts: EvidenceArtifact[],
): Record<string, Result> => {
  const failed = (message: string) => Object.fromEntries(
    browserGateSlugs.map((slug) => [slug, { passed: false, message }]),
  );
  if (!record(value) || !Array.isArray(value.observations)) {
    return failed("verification-input must contain valid browser observations.");
  }
  let observations: Observation[];
  try {
    observations = value.observations.map(parseObservation);
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
  const widths = new Set(observations.map(({ viewport }) => viewport.width));
  return {
    "required-states-covered": { passed: [390, 768, 1440].every((width) => widths.has(width)) },
    "no-horizontal-overflow": { passed: observations.every(({ horizontalOverflow }) => !horizontalOverflow) },
    "no-clipped-controls": { passed: observations.every(({ clippedControls, unreachableActions }) => clippedControls.length === 0 && unreachableActions.length === 0) },
    "no-sticky-overlap": { passed: observations.every(({ stickyOverlaps }) => stickyOverlaps.length === 0) },
    "focus-visible": { passed: observations.every(({ invisibleFocus, keyboardTraps }) => invisibleFocus.length === 0 && keyboardTraps.length === 0) },
    "no-runtime-console-errors": { passed: observations.every(({ consoleErrors }) => consoleErrors.length === 0) },
    "reduced-motion-verified": { passed: observations.every(({ reducedMotionVerified }) => reducedMotionVerified) },
  };
};

const oldFileHeader = /^--- (?:a\/\S+|\/dev\/null)(?:\t.*)?$/;
const newFileHeader = /^\+\+\+ (?:b\/\S+|\/dev\/null)(?:\t.*)?$/;
const diffHeader = /^diff --git a\/\S+ b\/\S+$/;
const hunkHeader = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?: .*)?$/;
const parseUnifiedDiffAddedContent = (content: string) => {
  const lines = content.split(/\r?\n/);
  const added: string[] = [];
  let index = 0;
  let files = 0;
  while (index < lines.length) {
    if (lines.slice(index).every((line) => line === "")) break;
    if (diffHeader.test(lines[index])) {
      index += 1;
      while (index < lines.length && !oldFileHeader.test(lines[index])) {
        if (diffHeader.test(lines[index]) || hunkHeader.test(lines[index])) return undefined;
        index += 1;
      }
    }
    if (!oldFileHeader.test(lines[index] ?? "") || !newFileHeader.test(lines[index + 1] ?? "")) return undefined;
    files += 1;
    index += 2;
    let hunks = 0;
    while (index < lines.length) {
      const header = hunkHeader.exec(lines[index]);
      if (!header) break;
      hunks += 1;
      let oldRemaining = header[1] === undefined ? 1 : Number(header[1]);
      let newRemaining = header[2] === undefined ? 1 : Number(header[2]);
      index += 1;
      while (oldRemaining > 0 || newRemaining > 0) {
        const line = lines[index];
        if (line === undefined) return undefined;
        const prefix = line[0];
        if (prefix === " ") { oldRemaining -= 1; newRemaining -= 1; }
        else if (prefix === "-") oldRemaining -= 1;
        else if (prefix === "+") { newRemaining -= 1; added.push(line.slice(1)); }
        else if (prefix === "\\") { index += 1; continue; }
        else return undefined;
        if (oldRemaining < 0 || newRemaining < 0) return undefined;
        index += 1;
      }
      if (lines[index]?.startsWith("\\ No newline at end of file")) index += 1;
    }
    if (hunks === 0) return undefined;
    if (index < lines.length && lines[index] !== "" && !diffHeader.test(lines[index]) && !oldFileHeader.test(lines[index])) return undefined;
  }
  return files > 0 ? added.join("\n") : undefined;
};

const addedUnifiedDiffContent = (content: string) => parseUnifiedDiffAddedContent(content) ?? content;

export const deriveTailwindSourceResults = (content: string): Record<string, Result> => {
  const findings = validateFrontendSources(
    [{ path: "implementation.diff", content: addedUnifiedDiffContent(content) }],
    { semanticTokensPresent: true },
  );
  return {
    "no-dynamic-tailwind-classes": { passed: !findings.some(({ code, gate }) => code === "tailwind-dynamic-class" && gate === "hard") },
    "raw-colors-reviewed": { passed: !findings.some(({ code }) => code === "design-system-raw-color") },
    "repeated-class-bundles-reviewed": { passed: !findings.some(({ code }) => code === "tailwind-conflicting-utilities") },
  };
};

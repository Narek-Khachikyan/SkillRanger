import { validateFrontendSources } from "../../domains/frontend/design/source-validation.ts";
import {
  interpretFrontendUiEvidence,
  isRecord,
  parseStrictUiEvidenceObservation,
  type FrontendUiEvidenceFacts,
} from "../../domains/frontend/design/ui-evidence.ts";
import type { EvidenceArtifact } from "./types.ts";

type Result = { passed: boolean; message?: string };
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

export const deriveBrowserGateResults = (
  value: unknown,
  artifacts: EvidenceArtifact[],
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
    "ui-state-desynchronized",
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
  };
};

const quotedPathEnd = (value: string, start: number) => {
  if (value[start] !== "\"") return undefined;
  for (let index = start + 1; index < value.length; index += 1) {
    if (value[index] === "\\") index += 1;
    else if (value[index] === "\"") return index + 1;
  }
  return undefined;
};
const validFileHeader = (line: string, prefix: "--- " | "+++ ") => {
  if (!line.startsWith(prefix)) return false;
  const value = line.slice(prefix.length);
  if (value.startsWith("\"")) {
    const end = quotedPathEnd(value, 0);
    if (end === undefined || end === 2) return false;
    return end === value.length || value[end] === "\t";
  }
  const tab = value.indexOf("\t");
  const filePath = tab === -1 ? value : value.slice(0, tab);
  return filePath !== "" && !/[\r\n]/.test(filePath);
};
const oldFileHeader = (line: string) => validFileHeader(line, "--- ");
const newFileHeader = (line: string) => validFileHeader(line, "+++ ");
const diffPathEnd = (value: string, start: number) => {
  if (value[start] === "\"") return quotedPathEnd(value, start);
  let index = start;
  while (index < value.length && !/\s/.test(value[index])) index += 1;
  return index === start ? undefined : index;
};
const diffHeader = (line: string) => {
  const prefix = "diff --git ";
  if (!line.startsWith(prefix)) return false;
  let cursor = prefix.length;
  const oldEnd = diffPathEnd(line, cursor);
  if (oldEnd === undefined || line[oldEnd] !== " ") return false;
  cursor = oldEnd;
  while (line[cursor] === " ") cursor += 1;
  const newEnd = diffPathEnd(line, cursor);
  return newEnd !== undefined && newEnd === line.length;
};
const hunkHeader = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?: .*)?$/;
const noNewlineMarker = "\\ No newline at end of file";
const parseUnifiedDiffAddedContent = (content: string) => {
  const lines = content.split(/\r?\n/);
  const added: string[] = [];
  let index = 0;
  let files = 0;
  while (index < lines.length) {
    if (lines.slice(index).every((line) => line === "")) break;
    if (diffHeader(lines[index])) {
      index += 1;
      while (index < lines.length && !oldFileHeader(lines[index])) {
        if (diffHeader(lines[index]) || hunkHeader.test(lines[index])) return undefined;
        index += 1;
      }
    }
    if (!oldFileHeader(lines[index] ?? "") || !newFileHeader(lines[index + 1] ?? "")) return undefined;
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
        let markerApplies = false;
        if (prefix === " ") { oldRemaining -= 1; newRemaining -= 1; }
        else if (prefix === "-") oldRemaining -= 1;
        else if (prefix === "+") { newRemaining -= 1; added.push(line.slice(1)); }
        else return undefined;
        if (oldRemaining < 0 || newRemaining < 0) return undefined;
        if (prefix === "-") markerApplies = oldRemaining === 0;
        else if (prefix === "+") markerApplies = newRemaining === 0;
        else markerApplies = oldRemaining === 0 && newRemaining === 0;
        index += 1;
        if (lines[index] === noNewlineMarker) {
          if (!markerApplies) return undefined;
          index += 1;
          if (lines[index] === noNewlineMarker) return undefined;
        }
      }
    }
    if (hunks === 0) return undefined;
    if (index < lines.length && lines[index] !== "" && !diffHeader(lines[index]) && !oldFileHeader(lines[index])) return undefined;
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

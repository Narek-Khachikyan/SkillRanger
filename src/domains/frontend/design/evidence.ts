import { lstat, mkdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { executeAdapterJson } from "./adapter.ts";
import { evaluateBrowserPayload, type BrowserCheckPayload } from "./browser-checks.ts";
import {
  isUiCapturePathWithin,
  type BrowserObservationCapturePlan,
  type UiCaptureMatrixEntry,
  type UiEvidenceCapturePlan,
} from "./evidence-plan.ts";
import { isValidStateSynchronization, type MechanicalSnapshot, type UiEvidenceBundle } from "./evidence-types.ts";
import { defaultMechanicalCheckPolicy, evaluateMechanicalSnapshot, sortUiCheckResults } from "./mechanical.ts";
import type { BrowserObservation } from "./types.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
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

type LegacyBrowserObservation = Pick<BrowserCheckPayload,
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

const parseLegacyBrowserObservation = (value: Record<string, unknown>): LegacyBrowserObservation => ({
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

const mechanicalSnapshot = (value: unknown): MechanicalSnapshot => {
  if (!isRecord(value)) throw new Error("Browser observation mechanicalSnapshot must be an object.");
  const nonEmptyString = (entry: unknown): entry is string => typeof entry === "string" && entry.trim() !== "";
  const finiteNumber = (entry: unknown): entry is number => typeof entry === "number" && Number.isFinite(entry);
  const nonNegativeNumber = (entry: unknown): entry is number => finiteNumber(entry) && entry >= 0;
  const nonNegativeInteger = (entry: unknown): entry is number => nonNegativeNumber(entry) && Number.isInteger(entry);
  const stringList = (entry: unknown): entry is string[] => Array.isArray(entry) && entry.every(nonEmptyString);
  const entries = <T>(field: string, valid: (entry: unknown) => boolean): T[] => {
    const valueForField = value[field];
    if (!Array.isArray(valueForField)) {
      throw new Error(`Browser observation mechanicalSnapshot.${field} must be an array.`);
    }
    const invalidIndex = valueForField.findIndex((entry) => !valid(entry));
    if (invalidIndex !== -1) {
      throw new Error(`Browser observation mechanicalSnapshot.${field}[${invalidIndex}] has an invalid shape.`);
    }
    return valueForField as T[];
  };
  entries("spacingContexts", (entry) => isRecord(entry)
    && nonEmptyString(entry.id)
    && stringList(entry.locators)
    && Array.isArray(entry.valuesPx)
    && entry.valuesPx.every(nonNegativeNumber));
  entries("colors", (entry) => isRecord(entry)
    && nonEmptyString(entry.locator)
    && nonEmptyString(entry.value)
    && (entry.role === undefined || nonEmptyString(entry.role))
    && nonNegativeInteger(entry.occurrences));
  entries("radii", (entry) => isRecord(entry)
    && nonEmptyString(entry.locator)
    && nonNegativeNumber(entry.valuePx)
    && typeof entry.isPillOrCircle === "boolean");
  entries("shadows", (entry) => isRecord(entry)
    && nonEmptyString(entry.locator)
    && nonEmptyString(entry.value)
    && typeof entry.isNone === "boolean");
  entries("cards", (entry) => isRecord(entry)
    && nonEmptyString(entry.locator)
    && nonNegativeInteger(entry.depth)
    && nonNegativeInteger(entry.repeatedCount)
    && ["generic", "group", "tool", "item"].includes(entry.semanticRole as string));
  entries("typography", (entry) => isRecord(entry)
    && nonEmptyString(entry.locator)
    && ["h1", "h2", "h3", "body", "meta"].includes(entry.role as string)
    && nonNegativeNumber(entry.fontSizePx)
    && nonNegativeNumber(entry.fontWeight));
  entries("textBlocks", (entry) => isRecord(entry)
    && nonEmptyString(entry.locator)
    && nonNegativeNumber(entry.measureCh));
  entries("touchTargets", (entry) => isRecord(entry)
    && nonEmptyString(entry.locator)
    && nonNegativeNumber(entry.widthPx)
    && nonNegativeNumber(entry.heightPx)
    && typeof entry.interactive === "boolean");
  return value as MechanicalSnapshot;
};

const stateSynchronization = (value: unknown): BrowserCheckPayload["stateSynchronization"] => {
  if (!isValidStateSynchronization(value)) {
    throw new Error(
      "Browser observation stateSynchronization must be { status: verified | mismatch | not-applicable, "
      + "path: non-empty string, observations: array of non-empty strings, optional action and changes, "
      + "and a concrete reason when status is not-applicable }.",
    );
  }
  // Rebuilt rather than passed through: this object lands verbatim in captures[].stateSynchronization,
  // and the published bundle schema forbids additional properties.
  return {
    status: value.status,
    path: value.path,
    observations: [...value.observations],
    ...(value.action !== undefined ? { action: value.action } : {}),
    ...(value.changes !== undefined
      ? {
          changes: value.changes.map(({ locator, before, after }) => ({ locator, before, after })),
        }
      : {}),
    ...(value.reason !== undefined ? { reason: value.reason } : {}),
  };
};

const parsePayload = (value: unknown) => {
  if (!isRecord(value)) throw new Error("Browser adapter must return one JSON object per invocation.");
  const contrast = value.contrastViolations;
  if (!Array.isArray(contrast) || !contrast.every((entry) => isRecord(entry)
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
    contrastViolations: contrast as BrowserCheckPayload["contrastViolations"],
    stateSynchronization: stateSynchronization(value.stateSynchronization),
  };
  return { browser, mechanical: mechanicalSnapshot(value.mechanicalSnapshot) };
};

const observationFor = (
  payload: BrowserCheckPayload,
  entry: UiEvidenceCapturePlan["entries"][number],
  route: string,
): BrowserObservation => ({
  schemaVersion: "1.0",
  viewport: entry.viewport,
  route,
  state: entry.state,
  horizontalOverflow: payload.horizontalOverflow,
  clippedControls: payload.clippedControls,
  unreachableActions: payload.unreachableActions,
  stickyOverlaps: payload.stickyOverlaps,
  consoleErrors: payload.consoleErrors,
  keyboardTraps: payload.keyboardTraps,
  invisibleFocus: payload.invisibleFocus,
  criticalAxeViolations: payload.criticalAxeViolations,
  reducedMotionVerified: payload.reducedMotionVerified,
  screenshotPath: entry.screenshotPath,
});

type CaptureMatrixPlan = {
  baseUrl: string;
  route: string;
  outputDir: string;
  entries: UiCaptureMatrixEntry[];
};

type CaptureOutput = {
  path: string;
  kind: "screenshot" | "output";
};

const realpathFromExistingAncestor = async (value: string) => {
  let ancestor = value;
  const missingTail: string[] = [];
  while (true) {
    try {
      await lstat(ancestor);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missingTail.unshift(path.basename(ancestor));
      ancestor = parent;
      continue;
    }
    if (missingTail.length > 0 && !(await stat(ancestor)).isDirectory()) {
      throw new Error("an existing output-path ancestor is not a directory");
    }
    return path.resolve(await realpath(ancestor), ...missingTail);
  }
};

const assertCanonicalCapturePath = async (input: {
  outputRoot: string;
  canonicalOutputRoot: string;
  target: CaptureOutput;
  captureLabel: string;
}) => {
  const resolvedPath = path.resolve(input.target.path);
  const canonicalPath = await realpathFromExistingAncestor(resolvedPath).catch(() => undefined);
  if (!isUiCapturePathWithin(input.outputRoot, resolvedPath)
    || !canonicalPath
    || !isUiCapturePathWithin(input.canonicalOutputRoot, canonicalPath)) {
    throw new Error(`${input.captureLabel} ${input.target.kind} escapes output directory: ${resolvedPath}`);
  }
};

const executeCaptureMatrix = async <T>(input: {
  plan: CaptureMatrixPlan;
  commandTemplate: string;
  projectRoot?: string;
  timeoutPerCaptureMs?: number;
  assertArtifactPath?: (artifactPath: string) => Promise<void>;
  outputTargets?: CaptureOutput[];
  captureLabel: string;
  screenshotError: (screenshotPath: string) => string;
  parseCapture: (value: unknown, entry: UiCaptureMatrixEntry) => T;
}): Promise<T[]> => {
  const outputRoot = path.resolve(input.plan.outputDir);
  const existingOutputRoot = await stat(outputRoot).catch(() => undefined);
  if (existingOutputRoot && !existingOutputRoot.isDirectory()) {
    throw new Error(`${input.captureLabel} output directory is not a directory: ${outputRoot}`);
  }
  const canonicalOutputRoot = await realpathFromExistingAncestor(outputRoot).catch(() => undefined);
  if (!canonicalOutputRoot) {
    throw new Error(`${input.captureLabel} output directory cannot be resolved safely: ${outputRoot}`);
  }
  const targets: CaptureOutput[] = [
    ...input.plan.entries.map(({ screenshotPath }) => ({ path: screenshotPath, kind: "screenshot" as const })),
    ...(input.outputTargets ?? []),
  ];
  const seenPaths = new Set<string>();
  for (const target of targets) {
    const resolvedPath = path.resolve(target.path);
    if (!isUiCapturePathWithin(outputRoot, resolvedPath)) {
      throw new Error(`${input.captureLabel} ${target.kind} escapes output directory: ${resolvedPath}`);
    }
    if (seenPaths.has(resolvedPath)) {
      throw new Error(`${input.captureLabel} duplicate capture output path: ${resolvedPath}`);
    }
    seenPaths.add(resolvedPath);
  }
  for (const target of targets) {
    const resolvedPath = path.resolve(target.path);
    await input.assertArtifactPath?.(resolvedPath);
    await assertCanonicalCapturePath({ outputRoot, canonicalOutputRoot, target, captureLabel: input.captureLabel });
    if (await stat(resolvedPath).catch(() => undefined)) {
      const noun = target.kind === "screenshot" ? "screenshot" : "output";
      throw new Error(`${input.captureLabel} ${noun} already exists: ${resolvedPath}`);
    }
  }

  const captures: T[] = [];
  try {
    for (const entry of input.plan.entries) {
      const screenshotTarget = { path: entry.screenshotPath, kind: "screenshot" as const };
      await input.assertArtifactPath?.(entry.screenshotPath);
      await assertCanonicalCapturePath({ outputRoot, canonicalOutputRoot, target: screenshotTarget, captureLabel: input.captureLabel });
      await mkdir(path.dirname(entry.screenshotPath), { recursive: true });
      await input.assertArtifactPath?.(entry.screenshotPath);
      let raw: unknown;
      try {
        raw = await executeAdapterJson({
          commandTemplate: input.commandTemplate,
          cwd: input.projectRoot,
          timeoutMs: input.timeoutPerCaptureMs,
          replacements: {
            "{{url}}": `${input.plan.baseUrl}${input.plan.route}`,
            "{{route}}": input.plan.route,
            "{{width}}": String(entry.viewport.width),
            "{{height}}": String(entry.viewport.height),
            "{{state}}": entry.state,
            "{{screenshotPath}}": entry.screenshotPath,
          },
        });
      } catch (error) {
        if (error instanceof Error && error.message === "Browser adapter returned invalid JSON.") {
          throw new Error(`Browser adapter returned invalid JSON for ${entry.viewport.width}px ${entry.state}.`);
        }
        throw error;
      }
      await input.assertArtifactPath?.(entry.screenshotPath);
      await assertCanonicalCapturePath({ outputRoot, canonicalOutputRoot, target: screenshotTarget, captureLabel: input.captureLabel });
      const parsed = input.parseCapture(raw, entry);
      const screenshot = await stat(entry.screenshotPath).catch(() => undefined);
      if (!screenshot?.isFile() || screenshot.size === 0) {
        throw new Error(input.screenshotError(entry.screenshotPath));
      }
      captures.push(parsed);
    }
    for (const target of input.outputTargets ?? []) {
      const resolvedPath = path.resolve(target.path);
      await input.assertArtifactPath?.(resolvedPath);
      await assertCanonicalCapturePath({ outputRoot, canonicalOutputRoot, target, captureLabel: input.captureLabel });
      if (await stat(resolvedPath).catch(() => undefined)) {
        throw new Error(`${input.captureLabel} output already exists: ${resolvedPath}`);
      }
    }
  } catch (error) {
    const currentFiles = await Promise.all(input.plan.entries.map(async ({ screenshotPath }) =>
      (await stat(screenshotPath).catch(() => undefined))?.isFile() ? screenshotPath : undefined));
    const paths = [...new Set(currentFiles.filter((entry): entry is string => Boolean(entry)))];
    throw new Error(`${error instanceof Error ? error.message : String(error)} Captured screenshots retained: ${paths.join(", ") || "none"}`);
  }
  return captures;
};

const parseBrowserObservation = (
  value: unknown,
  expected: UiCaptureMatrixEntry,
  route: string,
): BrowserObservation => {
  if (!isRecord(value)) {
    throw new Error("Browser adapter must return one JSON object per invocation.");
  }
  return {
    schemaVersion: "1.0",
    viewport: expected.viewport,
    route,
    state: expected.state,
    ...parseLegacyBrowserObservation(value),
    screenshotPath: expected.screenshotPath,
  };
};

export const executeBrowserObservationCapture = async (input: {
  plan: BrowserObservationCapturePlan;
  commandTemplate: string;
  outputPath?: string;
  projectRoot?: string;
  timeoutPerObservationMs?: number;
}) => {
  const observations = await executeCaptureMatrix({
    plan: input.plan,
    commandTemplate: input.commandTemplate,
    projectRoot: input.projectRoot,
    timeoutPerCaptureMs: input.timeoutPerObservationMs,
    outputTargets: input.outputPath ? [{ path: input.outputPath, kind: "output" }] : [],
    captureLabel: "Browser observation",
    screenshotError: (screenshotPath) =>
      `Browser adapter did not create screenshot: ${screenshotPath} (non-empty screenshot required)`,
    parseCapture: (value, entry) => parseBrowserObservation(value, entry, input.plan.route),
  });
  if (input.outputPath) {
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    await writeFile(input.outputPath, `${JSON.stringify(observations, null, 2)}\n`, "utf8");
  }
  return observations;
};

export const executeUiEvidenceCapture = async (input: {
  plan: UiEvidenceCapturePlan;
  commandTemplate: string;
  projectRoot?: string;
  timeoutPerCaptureMs?: number;
  assertArtifactPath?: (artifactPath: string) => Promise<void>;
}): Promise<UiEvidenceBundle> => {
  const bundlePath = path.join(input.plan.outputDir, "bundle.json");
  const captures = await executeCaptureMatrix({
    plan: input.plan,
    commandTemplate: input.commandTemplate,
    projectRoot: input.projectRoot,
    timeoutPerCaptureMs: input.timeoutPerCaptureMs,
    assertArtifactPath: input.assertArtifactPath,
    outputTargets: [{ path: bundlePath, kind: "output" }],
    captureLabel: "UI evidence",
    screenshotError: (screenshotPath) =>
      `Browser adapter did not create a non-empty screenshot: ${screenshotPath}`,
    parseCapture: (raw, entry) => {
      const parsed = parsePayload(raw);
      const checks = sortUiCheckResults([
        ...evaluateBrowserPayload({ payload: parsed.browser, viewport: entry.viewport.width, state: entry.state, screenshotPath: entry.screenshotPath }),
        ...evaluateMechanicalSnapshot({ snapshot: parsed.mechanical, policy: defaultMechanicalCheckPolicy, viewport: entry.viewport.width, state: entry.state, screenshotPath: entry.screenshotPath }),
      ]);
      return {
        ...entry,
        observation: observationFor(parsed.browser, entry, input.plan.route),
        stateRendered: parsed.browser.stateRendered,
        stateSynchronization: parsed.browser.stateSynchronization,
        checks,
      };
    },
  });

  const bundle: UiEvidenceBundle = {
    schemaVersion: "1.0",
    id: input.plan.id,
    variantId: input.plan.variantId,
    iteration: input.plan.iteration,
    sourceIdentity: input.plan.sourceIdentity,
    route: input.plan.route,
    capturedAt: new Date().toISOString(),
    requiredViewports: input.plan.requiredViewports,
    requiredStates: input.plan.requiredStates,
    captures,
    adapterCapabilities: ["browser", "screenshots"],
  };
  await input.assertArtifactPath?.(bundlePath);
  await mkdir(input.plan.outputDir, { recursive: true });
  const temporaryPath = `${bundlePath}.${process.pid}.${Date.now()}.tmp`;
  await input.assertArtifactPath?.(bundlePath);
  await input.assertArtifactPath?.(temporaryPath);
  await writeFile(temporaryPath, `${JSON.stringify(bundle, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await input.assertArtifactPath?.(temporaryPath);
  await input.assertArtifactPath?.(bundlePath);
  await rename(temporaryPath, bundlePath);
  await input.assertArtifactPath?.(bundlePath);
  return bundle;
};

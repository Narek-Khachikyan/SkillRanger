import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { executeAdapterJson } from "./adapter.ts";
import { evaluateBrowserPayload, type BrowserCheckPayload } from "./browser-checks.ts";
import type { UiEvidenceCapturePlan } from "./evidence-plan.ts";
import type { MechanicalSnapshot, UiEvidenceBundle } from "./evidence-types.ts";
import { defaultMechanicalCheckPolicy, evaluateMechanicalSnapshot, sortUiCheckResults } from "./mechanical.ts";
import type { BrowserObservation } from "./types.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPathWithin = (root: string, target: string) => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

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

const mechanicalSnapshot = (value: unknown): MechanicalSnapshot => {
  if (!isRecord(value)) throw new Error("Browser observation mechanicalSnapshot must be an object.");
  const fields = ["spacingContexts", "colors", "radii", "shadows", "cards", "typography", "textBlocks", "touchTargets"] as const;
  for (const field of fields) {
    if (!Array.isArray(value[field])) throw new Error(`Browser observation mechanicalSnapshot.${field} must be an array.`);
  }
  return value as MechanicalSnapshot;
};

const parsePayload = (value: unknown) => {
  if (!isRecord(value)) throw new Error("Browser adapter must return one JSON object per invocation.");
  const contrast = value.contrastViolations;
  if (!Array.isArray(contrast) || !contrast.every((entry) => isRecord(entry)
    && typeof entry.locator === "string" && typeof entry.ratio === "number" && typeof entry.largeText === "boolean")) {
    throw new Error("Browser observation contrastViolations must contain locator, ratio, and largeText values.");
  }
  const browser: BrowserCheckPayload = {
    horizontalOverflow: booleanField(value, "horizontalOverflow"),
    clippedControls: stringArray(value, "clippedControls"),
    unreachableActions: stringArray(value, "unreachableActions"),
    stickyOverlaps: stringArray(value, "stickyOverlaps"),
    consoleErrors: stringArray(value, "consoleErrors"),
    keyboardTraps: stringArray(value, "keyboardTraps"),
    invisibleFocus: stringArray(value, "invisibleFocus"),
    criticalAxeViolations: stringArray(value, "criticalAxeViolations"),
    reducedMotionVerified: booleanField(value, "reducedMotionVerified"),
    stateRendered: booleanField(value, "stateRendered"),
    overlaps: stringArray(value, "overlaps"),
    focusOrderViolations: stringArray(value, "focusOrderViolations"),
    contrastViolations: contrast as BrowserCheckPayload["contrastViolations"],
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

export const executeUiEvidenceCapture = async (input: {
  plan: UiEvidenceCapturePlan;
  commandTemplate: string;
  projectRoot?: string;
  timeoutPerCaptureMs?: number;
  assertArtifactPath?: (artifactPath: string) => Promise<void>;
}): Promise<UiEvidenceBundle> => {
  const bundlePath = path.join(input.plan.outputDir, "bundle.json");
  for (const entry of input.plan.entries) {
    if (!isPathWithin(input.plan.outputDir, entry.screenshotPath)) {
      throw new Error(`UI evidence screenshot escapes output directory: ${entry.screenshotPath}`);
    }
    await input.assertArtifactPath?.(entry.screenshotPath);
    if (await stat(entry.screenshotPath).catch(() => undefined)) {
      throw new Error(`UI evidence screenshot already exists: ${entry.screenshotPath}`);
    }
  }
  await input.assertArtifactPath?.(bundlePath);
  if (await stat(bundlePath).catch(() => undefined)) throw new Error(`UI evidence bundle already exists: ${bundlePath}`);

  const captures: UiEvidenceBundle["captures"] = [];
  try {
    for (const entry of input.plan.entries) {
      await input.assertArtifactPath?.(entry.screenshotPath);
      await mkdir(path.dirname(entry.screenshotPath), { recursive: true });
      await input.assertArtifactPath?.(entry.screenshotPath);
      const raw = await executeAdapterJson({
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
      const parsed = parsePayload(raw);
      await input.assertArtifactPath?.(entry.screenshotPath);
      const screenshot = await stat(entry.screenshotPath).catch(() => undefined);
      if (!screenshot?.isFile() || screenshot.size === 0) {
        throw new Error(`Browser adapter did not create a non-empty screenshot: ${entry.screenshotPath}`);
      }
      const checks = sortUiCheckResults([
        ...evaluateBrowserPayload({ payload: parsed.browser, viewport: entry.viewport.width, state: entry.state, screenshotPath: entry.screenshotPath }),
        ...evaluateMechanicalSnapshot({ snapshot: parsed.mechanical, policy: defaultMechanicalCheckPolicy, viewport: entry.viewport.width, state: entry.state, screenshotPath: entry.screenshotPath }),
      ]);
      captures.push({ ...entry, observation: observationFor(parsed.browser, entry, input.plan.route), checks });
    }
  } catch (error) {
    const retained = captures.map(({ screenshotPath }) => screenshotPath);
    const currentFiles = await Promise.all(input.plan.entries.map(async ({ screenshotPath }) =>
      (await stat(screenshotPath).catch(() => undefined))?.isFile() ? screenshotPath : undefined));
    const paths = [...new Set([...retained, ...currentFiles.filter((entry): entry is string => Boolean(entry))])];
    throw new Error(`${error instanceof Error ? error.message : String(error)} Captured screenshots retained: ${paths.join(", ") || "none"}`);
  }

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

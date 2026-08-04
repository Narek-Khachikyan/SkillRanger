import { lstat, mkdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { executeAdapterJson } from "./adapter.ts";
import {
  isUiCapturePathWithin,
  type BrowserObservationCapturePlan,
  type UiCaptureMatrixEntry,
  type UiEvidenceCapturePlan,
} from "./evidence-plan.ts";
import type { UiEvidenceBundle } from "./evidence-types.ts";
import type { BrowserObservation } from "./types.ts";
import {
  createUiEvidenceCapture,
  isRecord,
  parseLegacyBrowserObservation as parseCanonicalLegacyBrowserObservation,
  parseUiEvidencePayload,
} from "./ui-evidence.ts";

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
    ...parseCanonicalLegacyBrowserObservation(value),
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
      const parsed = parseUiEvidencePayload(raw, { requireMechanical: true });
      return createUiEvidenceCapture({
        entry,
        route: input.plan.route,
        browser: parsed.browser,
        mechanicalSnapshot: parsed.mechanical!,
      });
    },
  });

  const bundle: UiEvidenceBundle = {
    schemaVersion: "1.0",
    evidenceLevel: "verifiable",
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

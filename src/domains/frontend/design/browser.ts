import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { executeAdapterJson } from "./adapter.ts";
import type { BrowserObservation, DesignBrief } from "./types.ts";

export type BrowserObservationPlan = {
  schemaVersion: "1.0";
  baseUrl: string;
  route: string;
  outputDir: string;
  entries: Array<{
    viewport: { width: number; height: number };
    state: string;
    screenshotPath: string;
  }>;
};

const viewportHeight = (width: number) => {
  if (width <= 480) return 844;
  if (width <= 768) return 1024;
  return 900;
};

const isPathWithin = (root: string, target: string) => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const screenshotPathFor = (outputDir: string, width: number, state: string) => {
  if (!Number.isInteger(width) || width < 1) {
    throw new Error(`Browser observation viewport width must be a positive integer: ${width}`);
  }
  if (typeof state !== "string" || state.trim() === "") {
    throw new Error("Browser observation state must be a non-empty string.");
  }
  const outputRoot = path.resolve(outputDir);
  const screenshotPath = path.resolve(
    outputRoot,
    "screenshots",
    `${width}-${encodeURIComponent(state)}.png`,
  );
  if (!isPathWithin(outputRoot, screenshotPath)) {
    throw new Error(`Browser observation screenshot escapes output directory: ${screenshotPath}`);
  }
  return screenshotPath;
};

export const createBrowserObservationPlan = (input: {
  brief: DesignBrief;
  baseUrl: string;
  route?: string;
  outputDir: string;
}): BrowserObservationPlan => ({
  schemaVersion: "1.0",
  baseUrl: input.baseUrl.replace(/\/$/, ""),
  route: input.route ?? "/",
  outputDir: path.resolve(input.outputDir),
  entries: input.brief.surface.supportedViewports.flatMap((width) =>
    input.brief.surface.requiredStates.map((state) => ({
      viewport: { width, height: viewportHeight(width) },
      state,
      screenshotPath: screenshotPathFor(input.outputDir, width, state),
    })),
  ),
});

const asStringArray = (value: unknown, field: string) => {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`Browser observation ${field} must be an array of strings.`);
  }
  return value;
};

const parseObservation = (
  value: unknown,
  expected: BrowserObservationPlan["entries"][number],
  route: string,
): BrowserObservation => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Browser adapter must return one JSON object per invocation.");
  }
  const observation = value as Record<string, unknown>;
  for (const field of [
    "clippedControls",
    "unreachableActions",
    "stickyOverlaps",
    "consoleErrors",
    "keyboardTraps",
    "invisibleFocus",
    "criticalAxeViolations",
  ]) {
    asStringArray(observation[field], field);
  }
  if (typeof observation.horizontalOverflow !== "boolean") {
    throw new Error("Browser observation horizontalOverflow must be boolean.");
  }
  if (typeof observation.reducedMotionVerified !== "boolean") {
    throw new Error("Browser observation reducedMotionVerified must be boolean.");
  }
  return {
    schemaVersion: "1.0",
    viewport: expected.viewport,
    route,
    state: expected.state,
    horizontalOverflow: observation.horizontalOverflow,
    clippedControls: observation.clippedControls as string[],
    unreachableActions: observation.unreachableActions as string[],
    stickyOverlaps: observation.stickyOverlaps as string[],
    consoleErrors: observation.consoleErrors as string[],
    keyboardTraps: observation.keyboardTraps as string[],
    invisibleFocus: observation.invisibleFocus as string[],
    criticalAxeViolations: observation.criticalAxeViolations as string[],
    reducedMotionVerified: observation.reducedMotionVerified,
    screenshotPath: expected.screenshotPath,
  };
};

export const executeBrowserObservationPlan = async (input: {
  plan: BrowserObservationPlan;
  commandTemplate: string;
  outputPath?: string;
  projectRoot?: string;
  timeoutPerObservationMs?: number;
}) => {
  const observations: BrowserObservation[] = [];
  for (const entry of input.plan.entries) {
    if (!isPathWithin(input.plan.outputDir, entry.screenshotPath)) {
      throw new Error(`Browser observation screenshot escapes output directory: ${entry.screenshotPath}`);
    }
    const existing = await stat(entry.screenshotPath).catch(() => undefined);
    if (existing) {
      throw new Error(`Browser observation screenshot already exists: ${entry.screenshotPath}`);
    }
  }
  for (const entry of input.plan.entries) {
    await mkdir(path.dirname(entry.screenshotPath), { recursive: true });
    const replacements: Record<string, string> = {
      "{{url}}": `${input.plan.baseUrl}${input.plan.route}`,
      "{{route}}": input.plan.route,
      "{{width}}": String(entry.viewport.width),
      "{{height}}": String(entry.viewport.height),
      "{{state}}": entry.state,
      "{{screenshotPath}}": entry.screenshotPath,
    };
    let parsed: unknown;
    try {
      parsed = await executeAdapterJson({
        commandTemplate: input.commandTemplate,
        replacements,
        cwd: input.projectRoot,
        timeoutMs: input.timeoutPerObservationMs,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Browser adapter returned invalid JSON.") {
        throw new Error(`Browser adapter returned invalid JSON for ${entry.viewport.width}px ${entry.state}.`);
      }
      throw error;
    }
    const screenshot = await stat(entry.screenshotPath).catch(() => undefined);
    if (!screenshot?.isFile()) {
      throw new Error(`Browser adapter did not create screenshot: ${entry.screenshotPath}`);
    }
    observations.push(parseObservation(parsed, entry, input.plan.route));
  }
  if (input.outputPath) {
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    await writeFile(input.outputPath, `${JSON.stringify(observations, null, 2)}\n`, "utf8");
  }
  return observations;
};

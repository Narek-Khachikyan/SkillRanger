import path from "node:path";
import type { DesignExecutionPolicy } from "./policy-types.ts";
import type { DesignBrief } from "./types.ts";

const requiredViewports = [390, 768, 1440] as const;
const safePathSegment = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export type UiEvidenceCapturePlan = {
  schemaVersion: "1.0";
  id: string;
  variantId: string;
  iteration: number;
  sourceIdentity: string;
  baseUrl: string;
  route: string;
  outputDir: string;
  requiredViewports: [390, 768, 1440];
  requiredStates: string[];
  entries: UiCaptureMatrixEntry[];
};

export type UiCaptureMatrixEntry = {
  viewport: { width: number; height: number };
  state: string;
  screenshotPath: string;
};

export type BrowserObservationCapturePlan = {
  schemaVersion: "1.0";
  baseUrl: string;
  route: string;
  outputDir: string;
  entries: UiCaptureMatrixEntry[];
};

export const isUiCapturePathWithin = (root: string, target: string) => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

export const viewportHeight = (width: number) => {
  if (width <= 480) return 844;
  if (width <= 768) return 1024;
  return 900;
};

const assertSafePathSegment = (label: string, value: string) => {
  if (!safePathSegment.test(value)) {
    throw new Error(`${label} must be a safe path segment.`);
  }
};

export const createUiCaptureMatrixEntries = (input: {
  outputDir: string;
  viewports: readonly number[];
  states: readonly string[];
}): UiCaptureMatrixEntry[] => {
  const outputRoot = path.resolve(input.outputDir);
  return input.viewports.flatMap((width) => input.states.map((state) => {
    if (!Number.isInteger(width) || width < 1) {
      throw new Error(`Browser observation viewport width must be a positive integer: ${width}`);
    }
    if (typeof state !== "string" || state.trim() === "") {
      throw new Error("Browser observation state must be a non-empty string.");
    }
    const screenshotPath = path.resolve(
      outputRoot,
      "screenshots",
      `${width}-${encodeURIComponent(state)}.png`,
    );
    if (!isUiCapturePathWithin(outputRoot, screenshotPath)) {
      throw new Error(`UI evidence screenshot escapes output directory: ${screenshotPath}`);
    }
    return {
      viewport: { width, height: viewportHeight(width) },
      state,
      screenshotPath,
    };
  }));
};

export const createUiEvidenceCapturePlan = (input: {
  evidenceId: string;
  brief: DesignBrief;
  policy: DesignExecutionPolicy;
  variantId: string;
  iteration?: number;
  sourceIdentity: string;
  baseUrl: string;
  route?: string;
  outputDir: string;
}): UiEvidenceCapturePlan => {
  assertSafePathSegment("Evidence id", input.evidenceId);
  assertSafePathSegment("Variant id", input.variantId);
  const outputDir = path.resolve(input.outputDir);
  const requiredStates = [...new Set([
    ...input.policy.requiredStates,
    ...input.brief.surface.requiredStates,
  ])];
  const entries = createUiCaptureMatrixEntries({
    outputDir,
    viewports: requiredViewports,
    states: requiredStates,
  });
  return {
    schemaVersion: "1.0",
    id: input.evidenceId,
    variantId: input.variantId,
    iteration: input.iteration ?? 0,
    sourceIdentity: input.sourceIdentity,
    baseUrl: input.baseUrl.replace(/\/$/, ""),
    route: input.route ?? "/",
    outputDir,
    requiredViewports: [...requiredViewports],
    requiredStates,
    entries,
  };
};

export const createBrowserObservationCapturePlan = (input: {
  brief: DesignBrief;
  baseUrl: string;
  route?: string;
  outputDir: string;
}): BrowserObservationCapturePlan => {
  const outputDir = path.resolve(input.outputDir);
  return {
    schemaVersion: "1.0",
    baseUrl: input.baseUrl.replace(/\/$/, ""),
    route: input.route ?? "/",
    outputDir,
    entries: createUiCaptureMatrixEntries({
      outputDir,
      viewports: input.brief.surface.supportedViewports,
      states: input.brief.surface.requiredStates,
    }),
  };
};

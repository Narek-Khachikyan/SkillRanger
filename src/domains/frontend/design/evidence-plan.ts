import path from "node:path";
import type { DesignExecutionPolicy } from "./policy-types.ts";
import type { DesignBrief } from "./types.ts";

const requiredViewports = [390, 768, 1440] as const;
const baselineStates = ["loading", "empty", "error", "success"] as const;
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
  entries: Array<{
    viewport: { width: number; height: number };
    state: string;
    screenshotPath: string;
  }>;
};

const viewportHeight = (width: number) => width === 390 ? 844 : width === 768 ? 1024 : 900;

const assertSafePathSegment = (label: string, value: string) => {
  if (!safePathSegment.test(value)) {
    throw new Error(`${label} must be a safe path segment.`);
  }
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
    ...baselineStates,
    ...input.policy.requiredStates,
    ...input.brief.surface.requiredStates,
  ])];
  const entries = requiredViewports.flatMap((width) => requiredStates.map((state) => {
    const screenshotPath = path.resolve(outputDir, "screenshots", `${width}-${encodeURIComponent(state)}.png`);
    const relative = path.relative(outputDir, screenshotPath);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`UI evidence screenshot escapes output directory: ${screenshotPath}`);
    }
    return { viewport: { width, height: viewportHeight(width) }, state, screenshotPath };
  }));
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

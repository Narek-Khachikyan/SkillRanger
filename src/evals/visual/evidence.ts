import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import type { VisualBenchmarkRunResult } from "./types.ts";

const renderedExtension = /\.(png|jpe?g|webp)$/i;
const rootEvidenceExclusions = new Set([
  "workspace", "run-result.json", "run-metadata.json", "stdout.txt", "stderr.txt", "artifact-manifest.json",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const contained = (root: string, candidate: string) =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

const safeRelativeArtifact = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && !path.isAbsolute(value)
  && !value.replaceAll("\\", "/").split("/").includes("..")
  && !value.includes("\0");

const nonEmptyRegularFile = (filePath: string, label: string) => {
  const info = lstatSync(filePath, { throwIfNoEntry: false });
  if (!info?.isFile() || info.isSymbolicLink() || info.size === 0) {
    throw new Error(`${label} must be a non-empty regular file: ${filePath}`);
  }
  return info;
};

const manifestArtifacts = (runRoot: string): string[] | undefined => {
  const manifestPath = path.join(runRoot, "artifact-manifest.json");
  const manifestInfo = lstatSync(manifestPath, { throwIfNoEntry: false });
  if (!manifestInfo) return undefined;
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size === 0) {
    throw new Error(`invalid benchmark artifact manifest: ${manifestPath}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error(`invalid benchmark artifact manifest: ${manifestPath}`);
  }
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "artifacts"])
    || value.schemaVersion !== "1.0" || !Array.isArray(value.artifacts)
    || !value.artifacts.every(safeRelativeArtifact)
    || new Set(value.artifacts).size !== value.artifacts.length) {
    throw new Error(`invalid benchmark artifact manifest: ${manifestPath}`);
  }
  return value.artifacts.map((artifact) => path.resolve(runRoot, artifact)).sort();
};

const canonicalContained = (canonicalRoot: string, candidate: string, label: string) => {
  const canonicalCandidate = realpathSync(candidate);
  if (!contained(canonicalRoot, canonicalCandidate)) {
    throw new Error(`${label} escaped isolated run directory: ${candidate}`);
  }
};

const discoveredRenderedArtifacts = (runRoot: string): string[] => {
  const artifacts: string[] = [];
  const visit = (directory: string, isRoot: boolean) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (isRoot && rootEvidenceExclusions.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`benchmark artifact must not be a symlink: ${fullPath}`);
      if (entry.isDirectory()) visit(fullPath, false);
      else if (entry.isFile() && renderedExtension.test(entry.name)) artifacts.push(path.resolve(fullPath));
    }
  };
  visit(runRoot, true);
  return artifacts.sort();
};

/**
 * Validate the evidence boundary used by both blind-review preparation and promotion.
 * The runner writes artifacts beside the immutable run result, while the copied fixture
 * lives below `workspace`; therefore the isolated evidence root is the result's run
 * directory, not the fixture workspace itself.
 */
export const assertVisualBenchmarkEvidence = (result: VisualBenchmarkRunResult): void => {
  if (typeof result.resultPath !== "string" || !result.resultPath
    || typeof result.workspacePath !== "string" || !result.workspacePath
    || !Array.isArray(result.artifactPaths)) {
    throw new Error(`invalid benchmark evidence contract for ${result.runId}`);
  }

  const resultPath = path.resolve(result.resultPath);
  const runRoot = path.dirname(resultPath);
  if (path.basename(resultPath) !== "run-result.json" || path.basename(runRoot) !== result.runId) {
    throw new Error(`benchmark result must use its isolated run directory: ${result.resultPath}`);
  }
  const runRootInfo = lstatSync(runRoot, { throwIfNoEntry: false });
  if (!runRootInfo?.isDirectory() || runRootInfo.isSymbolicLink()) {
    throw new Error(`benchmark run directory must be a real directory: ${runRoot}`);
  }
  const canonicalRunRoot = realpathSync(runRoot);
  const manifest = manifestArtifacts(runRoot);
  nonEmptyRegularFile(resultPath, "benchmark result");
  canonicalContained(canonicalRunRoot, resultPath, "benchmark result");
  const workspacePath = path.resolve(result.workspacePath);
  if (workspacePath !== path.join(runRoot, "workspace") || !contained(runRoot, workspacePath)) {
    throw new Error(`benchmark workspace escaped isolated run directory: ${workspacePath}`);
  }
  const workspaceInfo = lstatSync(workspacePath, { throwIfNoEntry: false });
  if (!workspaceInfo?.isDirectory() || workspaceInfo.isSymbolicLink()) {
    throw new Error(`benchmark workspace must be an isolated real directory: ${workspacePath}`);
  }
  canonicalContained(canonicalRunRoot, workspacePath, "benchmark workspace");

  const stdoutPath = typeof result.stdoutPath === "string" ? path.resolve(result.stdoutPath) : undefined;
  const stderrPath = typeof result.stderrPath === "string" ? path.resolve(result.stderrPath) : undefined;
  const expectedStdoutPath = path.join(runRoot, "stdout.txt");
  const expectedStderrPath = path.join(runRoot, "stderr.txt");
  if (typeof stdoutPath !== "string" || typeof stderrPath !== "string"
    || stdoutPath !== expectedStdoutPath || stderrPath !== expectedStderrPath
    || !result.artifactPaths.some((artifact) => typeof artifact === "string" && path.resolve(artifact) === stdoutPath)
    || !result.artifactPaths.some((artifact) => typeof artifact === "string" && path.resolve(artifact) === stderrPath)) {
    throw new Error(`benchmark run logs must be retained inside its isolated run directory: ${result.runId}`);
  }
  nonEmptyRegularFile(stdoutPath, "benchmark stdout");
  nonEmptyRegularFile(stderrPath, "benchmark stderr");
  canonicalContained(canonicalRunRoot, stdoutPath, "benchmark stdout");
  canonicalContained(canonicalRunRoot, stderrPath, "benchmark stderr");

  if (new Set(result.artifactPaths).size !== result.artifactPaths.length) {
    throw new Error(`benchmark artifact manifest contains duplicate paths for ${result.runId}`);
  }
  for (const artifact of result.artifactPaths) {
    if (typeof artifact !== "string" || !artifact) {
      throw new Error(`invalid benchmark artifact path for ${result.runId}`);
    }
    const resolved = path.resolve(artifact);
    if (!contained(runRoot, resolved)) {
      throw new Error(`benchmark artifact escaped isolated run directory: ${artifact}`);
    }
    nonEmptyRegularFile(resolved, "benchmark artifact");
    canonicalContained(canonicalRunRoot, resolved, "benchmark artifact");
    const isLog = resolved === stdoutPath || resolved === stderrPath;
    if (!isLog && !renderedExtension.test(resolved) && (!manifest || !/\.json$/i.test(resolved))) {
      throw new Error(`unsupported benchmark artifact type: ${artifact}`);
    }
  }

  const recordedEvidence = result.artifactPaths
    .map((artifact) => path.resolve(artifact))
    .filter((artifact) => artifact !== stdoutPath && artifact !== stderrPath)
    .sort();
  const discoveredEvidence = discoveredRenderedArtifacts(runRoot);
  if (manifest) {
    const manifestRendered = manifest.filter((artifact) => renderedExtension.test(artifact));
    if (manifestRendered.length !== discoveredEvidence.length
      || manifestRendered.some((artifact, index) => artifact !== discoveredEvidence[index])) {
      throw new Error(`benchmark artifact manifest mismatch for ${result.runId}`);
    }
  }
  const expectedEvidence = manifest ?? discoveredEvidence;
  if (recordedEvidence.length !== expectedEvidence.length
    || recordedEvidence.some((artifact, index) => artifact !== expectedEvidence[index])) {
    throw new Error(`benchmark artifact manifest mismatch for ${result.runId}`);
  }
  for (const artifact of expectedEvidence) {
    if (!renderedExtension.test(artifact) && !/\.json$/i.test(artifact)) {
      throw new Error(`unsupported benchmark artifact type: ${artifact}`);
    }
  }
};

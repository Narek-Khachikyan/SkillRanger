import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { validateVisualBenchmarkPlan } from "./runner.ts";
import { visualCriteria } from "./suite.ts";
import type { VisualBenchmarkPlan, VisualBenchmarkPlanEntry, VisualBenchmarkRunResult, VisualHumanReview } from "./types.ts";
import { assertVisualBenchmarkEvidence } from "./evidence.ts";

export type VisualBlindReviewPackage = {
  schemaVersion: "1.0";
  benchmarkVersion: string;
  reviewPackageDigest: string;
  criteria: string[];
  pairs: Array<{
    pairId: string;
    labelA: string;
    labelB: string;
    screenshotsA: string[];
    screenshotsB: string[];
    screenshotDigestsA: string[];
    screenshotDigestsB: string[];
  }>;
};
export type VisualBlindReviewMapping = { schemaVersion: "1.0"; benchmarkVersion: string; pairs: Array<{ pairId: string; A: { label: string; runId: string; arm: string; modelId: string; resultDigest: string; sourceArtifactPaths: string[] }; B: { label: string; runId: string; arm: string; modelId: string; resultDigest: string; sourceArtifactPaths: string[] } }> };

const exactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
};
export const canonicalJson = (value: unknown) => JSON.stringify(canonicalize(value));
const digestPattern = /^[a-f0-9]{64}$/;
const renderedExtension = /\.(png|jpe?g|webp)$/i;
const packageWithoutDigest = (reviewPackage: VisualBlindReviewPackage | Omit<VisualBlindReviewPackage, "reviewPackageDigest">) => {
  const { reviewPackageDigest: _digest, ...value } = reviewPackage as VisualBlindReviewPackage;
  return value;
};
export const computeVisualBlindReviewPackageDigest = (reviewPackage: VisualBlindReviewPackage | Omit<VisualBlindReviewPackage, "reviewPackageDigest">) =>
  createHash("sha256").update(canonicalJson(packageWithoutDigest(reviewPackage))).digest("hex");
export const computeVisualBenchmarkResultDigest = (result: VisualBenchmarkRunResult) => createHash("sha256").update(canonicalJson(result)).digest("hex");
export const isOpaqueReviewLabel = (label: string, secrets: string[]) => {
  const normalized = label.toLowerCase();
  return !secrets.filter((secret) => secret.length > 0).some((secret) => normalized.includes(secret.toLowerCase()));
};
const keyFor = (run: Pick<VisualBenchmarkRunResult, "briefId" | "capabilityCandidateId" | "repetition">) => `${run.briefId}::${run.capabilityCandidateId}::${run.repetition}`;
const screenshotPaths = (run: VisualBenchmarkRunResult) => run.artifactPaths.filter((item) => renderedExtension.test(item));
const fileSha256 = (filePath: string) => createHash("sha256").update(readFileSync(filePath)).digest("hex");
const identityFields: Array<keyof VisualBenchmarkPlanEntry> = ["runId", "briefId", "recipeId", "capabilityCandidateId", "modelId", "commandProfile", "arm", "repetition", "prompt", "fixture", "route"];

const assertCompleteResults = (plan: VisualBenchmarkPlan, results: VisualBenchmarkRunResult[]) => {
  validateVisualBenchmarkPlan(plan);
  if (plan.schemaVersion !== "1.0" || plan.entries.length !== 96) throw new Error("blind review requires the frozen 96-slot plan");
  if (results.length !== plan.entries.length) throw new Error("blind review results must cover all 96 plan slots exactly once");
  const planIds = new Set(plan.entries.map(({ runId }) => runId));
  const resultIds = new Set(results.map(({ runId }) => runId));
  if (planIds.size !== plan.entries.length || resultIds.size !== results.length) throw new Error("blind review contains duplicate run ids");
  const byId = new Map(results.map((result) => [result.runId, result]));
  for (const entry of plan.entries) {
    const result = byId.get(entry.runId);
    if (!result || identityFields.some((field) => result[field] !== entry[field])
      || result.benchmarkVersion !== plan.benchmarkVersion || result.skillRangerVersion !== plan.skillRangerVersion
      || result.skillRangerChecksum !== plan.skillRangerChecksum) throw new Error(`stale or foreign benchmark result ${entry.runId}`);
    assertVisualBenchmarkEvidence(result);
    if (result.operationalEvidence !== "complete" || typeof result.hardGateFailed !== "boolean"
      || !Number.isInteger(result.criticalFindings) || Number(result.criticalFindings) < 0
      || !Number.isInteger(result.repairIterations) || Number(result.repairIterations) < 0
      || !["verified", "failed", "implemented-unverified", "blocked"].includes(String(result.verificationOutcome))
      || typeof result.completionClaimed !== "boolean") throw new Error(`operational evidence missing for ${entry.runId}`);
    const images = screenshotPaths(result);
    if (images.length === 0) throw new Error(`rendered evidence missing for ${entry.runId}`);
    for (const image of images) {
      const info = (() => { try { return lstatSync(image); } catch { return undefined; } })();
      if (!info?.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error(`rendered evidence invalid for ${entry.runId}: ${image}`);
    }
  }
};

export const createBlindReviewPackage = (input: { plan: VisualBenchmarkPlan; results: VisualBenchmarkRunResult[]; labelFactory?: () => string; publicReviewDir?: string }) => {
  assertCompleteResults(input.plan, input.results);
  const factory = input.labelFactory ?? (() => randomBytes(16).toString("hex"));
  const grouped = new Map<string, VisualBenchmarkRunResult[]>();
  for (const result of input.results) grouped.set(keyFor(result), [...(grouped.get(keyFor(result)) ?? []), result]);
  if (grouped.size !== 48) throw new Error("blind review requires exactly 48 A/B pairs");
  const publicPairs: VisualBlindReviewPackage["pairs"] = [];
  const privatePairs: VisualBlindReviewMapping["pairs"] = [];
  for (const [key, runs] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    if (runs.length !== 2 || new Set(runs.map(({ arm }) => arm)).size !== 2) throw new Error(`blind review pair ${key} must contain exactly one run per arm`);
    const ordered = factory().charCodeAt(0) % 2 ? runs : [...runs].reverse();
    const pairId = `pair-${factory()}`;
    const labels = [`option-${factory()}`, `option-${factory()}`];
    const labelSecrets = ordered.flatMap((run) => [run.arm, run.modelId, run.runId, run.capabilityCandidateId]);
    if (!labels.every((label) => isOpaqueReviewLabel(label, labelSecrets))) throw new Error(`blind review pair ${key} has a non-opaque public label`);
    const sourceScreenshots = ordered.map((run) => screenshotPaths(run));
    const screenshotDigests = sourceScreenshots.map((sources) => sources.map(fileSha256));
    const publicPaths = sourceScreenshots.map((sources, optionIndex) => sources.map((source, artifactIndex) => {
      const relative = `${pairId}/${optionIndex === 0 ? "A" : "B"}-${artifactIndex + 1}${path.extname(source).toLowerCase()}`;
      if (input.publicReviewDir) {
        const target = path.join(input.publicReviewDir, relative);
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(source, target);
        if (fileSha256(target) !== screenshotDigests[optionIndex][artifactIndex]) {
          throw new Error(`public review screenshot copy failed for ${pairId}/${optionIndex === 0 ? "A" : "B"}-${artifactIndex + 1}`);
        }
      }
      return relative;
    }));
    publicPairs.push({ pairId, labelA: labels[0], labelB: labels[1], screenshotsA: publicPaths[0], screenshotsB: publicPaths[1], screenshotDigestsA: screenshotDigests[0], screenshotDigestsB: screenshotDigests[1] });
    privatePairs.push({ pairId, A: { label: labels[0], runId: ordered[0].runId, arm: ordered[0].arm, modelId: ordered[0].modelId, resultDigest: computeVisualBenchmarkResultDigest(ordered[0]), sourceArtifactPaths: [...ordered[0].artifactPaths] }, B: { label: labels[1], runId: ordered[1].runId, arm: ordered[1].arm, modelId: ordered[1].modelId, resultDigest: computeVisualBenchmarkResultDigest(ordered[1]), sourceArtifactPaths: [...ordered[1].artifactPaths] } });
  }
  const reviewPackageBase = { schemaVersion: "1.0" as const, benchmarkVersion: input.plan.benchmarkVersion, criteria: [...visualCriteria], pairs: publicPairs };
  const reviewPackage = { ...reviewPackageBase, reviewPackageDigest: computeVisualBlindReviewPackageDigest(reviewPackageBase) } as VisualBlindReviewPackage;
  return { reviewPackage, privateMapping: { schemaVersion: "1.0", benchmarkVersion: input.plan.benchmarkVersion, pairs: privatePairs } as VisualBlindReviewMapping };
};

const contained = (root: string, candidate: string) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
const unsafePublicPath = (value: string) => path.isAbsolute(value) || value.includes("\0") || value.replaceAll("\\", "/").split("/").includes("..");

export const assertPublicReviewScreenshotBindings = (input: {
  reviewPackage: VisualBlindReviewPackage;
  privateMapping: VisualBlindReviewMapping;
  results: VisualBenchmarkRunResult[];
  publicReviewDir: string;
}): void => {
  const publicReviewDir = path.resolve(input.publicReviewDir);
  const directoryInfo = lstatSync(publicReviewDir, { throwIfNoEntry: false });
  if (!directoryInfo?.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error(`public review directory must be a real directory: ${publicReviewDir}`);
  }
  const canonicalReviewDir = realpathSync(publicReviewDir);
  const resultsByRunId = new Map(input.results.map((result) => [result.runId, result]));
  const mappingsByPairId = new Map(input.privateMapping.pairs.map((pair) => [pair.pairId, pair]));

  for (const publicPair of input.reviewPackage.pairs) {
    const mapping = mappingsByPairId.get(publicPair.pairId);
    if (!mapping) throw new Error(`public review screenshot mapping is missing for ${publicPair.pairId}`);
    for (const side of ["A", "B"] as const) {
      const screenshots = publicPair[`screenshots${side}`];
      const screenshotDigests = publicPair[`screenshotDigests${side}`];
      const mapped = mapping[side];
      if (!resultsByRunId.has(mapped.runId)) throw new Error(`public review screenshot source run is missing for ${publicPair.pairId}/${side}`);
      const sourceScreenshots = mapped.sourceArtifactPaths.filter((artifact) => renderedExtension.test(artifact));
      if (screenshots.length !== sourceScreenshots.length || screenshotDigests.length !== screenshots.length) {
        throw new Error(`public review screenshot count does not match its source artifact for ${publicPair.pairId}/${side}`);
      }
      for (const [index, screenshot] of screenshots.entries()) {
        if (unsafePublicPath(screenshot) || !renderedExtension.test(screenshot)) {
          throw new Error(`public review screenshot path is unsafe for ${publicPair.pairId}/${side}`);
        }
        const publicPath = path.resolve(publicReviewDir, screenshot);
        if (!contained(publicReviewDir, publicPath)) throw new Error(`public review screenshot escapes its package for ${publicPair.pairId}/${side}`);
        const publicInfo = lstatSync(publicPath, { throwIfNoEntry: false });
        if (!publicInfo?.isFile() || publicInfo.isSymbolicLink() || publicInfo.size === 0) {
          throw new Error(`public review screenshot is missing or invalid for ${publicPair.pairId}/${side}: ${screenshot}`);
        }
        const canonicalPublicPath = realpathSync(publicPath);
        if (!contained(canonicalReviewDir, canonicalPublicPath)) throw new Error(`public review screenshot escapes its package for ${publicPair.pairId}/${side}`);
        const expectedDigest = screenshotDigests[index];
        if (!digestPattern.test(expectedDigest)) throw new Error(`public review screenshot digest is invalid for ${publicPair.pairId}/${side}`);
        const sourcePath = sourceScreenshots[index];
        const sourceDigest = fileSha256(sourcePath);
        if (sourceDigest !== expectedDigest) throw new Error(`public review screenshot source binding mismatch for ${publicPair.pairId}/${side}`);
        if (fileSha256(publicPath) !== expectedDigest) throw new Error(`public review screenshot integrity mismatch for ${publicPair.pairId}/${side}`);
      }
    }
  }
};

export const validateHumanReview = (review: VisualHumanReview, reviewPackage?: VisualBlindReviewPackage): string[] => {
  const issues: string[] = [];
  if (!review || typeof review !== "object" || Array.isArray(review)) return ["review must be an object"];
  if (!exactKeys(review as unknown as Record<string, unknown>, ["schemaVersion", "benchmarkVersion", "reviewPackageDigest", "reviewerId", "reviewerType", "judgments"])) issues.push("review has invalid keys");
  if (review.schemaVersion !== "1.0") issues.push("schemaVersion must be 1.0");
  if (typeof review.benchmarkVersion !== "string" || !review.benchmarkVersion) issues.push("benchmarkVersion is required");
  if (reviewPackage && review.benchmarkVersion !== reviewPackage.benchmarkVersion) issues.push("benchmarkVersion must match public package");
  if (typeof review.reviewPackageDigest !== "string" || !digestPattern.test(review.reviewPackageDigest)) issues.push("reviewPackageDigest must be a SHA-256 digest");
  if (reviewPackage && review.reviewPackageDigest !== reviewPackage.reviewPackageDigest) issues.push("reviewPackageDigest must match public package");
  if (reviewPackage && reviewPackage.reviewPackageDigest !== computeVisualBlindReviewPackageDigest(reviewPackage)) issues.push("public review package digest is invalid");
  if (typeof review.reviewerId !== "string" || !review.reviewerId.trim()) issues.push("reviewerId is required");
  if (review.reviewerType !== "human") issues.push("reviewerType must be human");
  if (!Array.isArray(review.judgments)) return [...issues, "judgments must be an array"];
  const validScores = (scores: unknown) => typeof scores === "object" && scores !== null && !Array.isArray(scores)
    && visualCriteria.every((criterion) => Number.isInteger((scores as Record<string, unknown>)[criterion]) && Number((scores as Record<string, unknown>)[criterion]) >= 1 && Number((scores as Record<string, unknown>)[criterion]) <= 5)
    && Object.keys(scores).length === visualCriteria.length;
  for (const judgment of review.judgments) {
    if (!isRecord(judgment)
      || !exactKeys(judgment, ["pairId", "scoresA", "scoresB", "preference", "catastrophicA", "catastrophicB", "notes"])) {
      issues.push("judgment has invalid keys");
      continue;
    }
    if (typeof judgment.pairId !== "string" || !judgment.pairId) issues.push("pairId is required");
    if (!validScores(judgment.scoresA) || !validScores(judgment.scoresB)) issues.push("all ten criterion scores are required");
    if (!["A", "B", "tie", "abstain"].includes(judgment.preference as string)) issues.push("preference must be A, B, tie, or abstain");
    if (typeof judgment.catastrophicA !== "boolean" || typeof judgment.catastrophicB !== "boolean") issues.push("catastrophic fields must be boolean");
    if (!Array.isArray(judgment.notes) || !judgment.notes.every((note) => typeof note === "string")) issues.push("notes must be an array of strings");
  }
  if (reviewPackage) {
    const expected = reviewPackage.pairs.map(({ pairId }) => pairId).sort();
    const actual = review.judgments.map((judgment) => isRecord(judgment) && typeof judgment.pairId === "string" ? judgment.pairId : "").sort();
    if (new Set(actual).size !== actual.length || expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) issues.push("review must cover every public pair exactly once");
  }
  return [...new Set(issues)];
};

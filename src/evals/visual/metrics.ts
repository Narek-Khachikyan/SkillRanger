import { lstatSync, readFileSync } from "node:fs";
import { isCompleteVisualOperationalEvidence } from "./operational.ts";
import { visualCriteria } from "./suite.ts";
import { assertVisualBenchmarkEvidence } from "./evidence.ts";
import { canonicalJson, computeVisualBenchmarkResultDigest, computeVisualBlindReviewPackageDigest, isOpaqueReviewLabel, validateHumanReview, type VisualBlindReviewMapping, type VisualBlindReviewPackage } from "./review.ts";
import type { VisualBenchmarkMetricSet, VisualBenchmarkReport, VisualBenchmarkRunResult, VisualCandidateMetricSet, VisualHumanReview, VisualPromotionVerdict } from "./types.ts";

export const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
export const median = (values: number[]) => { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
export const populationVariance = (values: number[]) => { const average = mean(values); return mean(values.map((value) => (value - average) ** 2)); };
const exactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const pathIsUnsafe = (value: string) => value.startsWith("/") || value.split(/[\\/]/).includes("..");
const digestPattern = /^[a-f0-9]{64}$/;
const assertImmutableResults = (results: VisualBenchmarkRunResult[]) => {
  for (const result of results) {
    assertVisualBenchmarkEvidence(result);
    if (typeof result.resultPath !== "string" || !result.resultPath) throw new Error(`immutable benchmark result path missing for ${result.runId}`);
    const info = lstatSync(result.resultPath, { throwIfNoEntry: false });
    if (!info?.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error(`immutable benchmark result missing for ${result.runId}`);
    let persisted: unknown;
    try {
      persisted = JSON.parse(readFileSync(result.resultPath, "utf8"));
    } catch {
      throw new Error(`immutable benchmark result unreadable for ${result.runId}`);
    }
    if (canonicalJson(persisted) !== canonicalJson(result)) throw new Error(`immutable benchmark result mismatch for ${result.runId}`);
  }
};

type ScoredRun = { result: VisualBenchmarkRunResult; vector: number[]; quality: number; catastrophic: boolean };
type PreferenceCounts = { candidateWins: number; comparatorWins: number; ties: number; abstentions: number };
const emptyPreferenceCounts = (): PreferenceCounts => ({ candidateWins: 0, comparatorWins: 0, ties: 0, abstentions: 0 });
const decisiveComparisons = (counts: PreferenceCounts) => counts.candidateWins + counts.comparatorWins;
const preferenceShare = (counts: PreferenceCounts) => {
  const decisive = decisiveComparisons(counts);
  return decisive === 0 ? 0 : counts.candidateWins / decisive;
};
const metricSet = (records: ScoredRun[], preferenceShare = 0): VisualBenchmarkMetricSet => {
  const qualities = records.map(({ quality }) => quality);
  const groups = new Map<string, number[]>();
  const vectors = new Map<string, number[][]>();
  for (const record of records) {
    const key = `${record.result.briefId}::${record.result.capabilityCandidateId}::${record.result.arm}`;
    groups.set(key, [...(groups.get(key) ?? []), record.quality]);
    vectors.set(key, [...(vectors.get(key) ?? []), record.vector]);
  }
  const divergences = [...vectors.values()].filter((value) => value.length === 2).map((value) =>
    Math.sqrt(value[0].reduce((sum, score, index) => sum + (score - value[1][index]) ** 2, 0)) / Math.sqrt(10 * 16));
  return {
    runSlots: new Set(records.map(({ result }) => result.runId)).size,
    sampleCount: records.length,
    meanQuality: mean(qualities),
    medianQuality: median(qualities),
    pairwiseSkillRangerPreferenceShare: preferenceShare,
    withinConditionVariance: mean([...groups.values()].filter((value) => value.length === 2).map(populationVariance)),
    repeatDesignAxisDivergence: mean(divergences),
    catastrophicFailureRate: mean(records.map(({ catastrophic }) => catastrophic ? 1 : 0)),
    hardGateFailureRate: mean(records.map(({ result }) => result.hardGateFailed === true ? 1 : 0)),
    meanRepairIterations: mean(records.map(({ result }) => result.repairIterations as number)),
    verificationSuccessRate: mean(records.map(({ result }) => result.verificationOutcome === "verified" ? 1 : 0)),
    falseCompletionRate: mean(records.filter(({ result }) => result.completionClaimed === true).map(({ result }) => result.verificationOutcome !== "verified" ? 1 : 0)),
  };
};

const assertPublishedContracts = (input: { results: VisualBenchmarkRunResult[]; reviewPackage: VisualBlindReviewPackage; privateMapping: VisualBlindReviewMapping }) => {
  if (!input.reviewPackage || typeof input.reviewPackage !== "object" || Array.isArray(input.reviewPackage)
    || !exactKeys(input.reviewPackage as unknown as Record<string, unknown>, ["schemaVersion", "benchmarkVersion", "reviewPackageDigest", "criteria", "pairs"])
    || !input.privateMapping || typeof input.privateMapping !== "object" || Array.isArray(input.privateMapping)
    || !exactKeys(input.privateMapping as unknown as Record<string, unknown>, ["schemaVersion", "benchmarkVersion", "pairs"])) throw new Error("invalid blind review top-level contract");
  if (!Array.isArray(input.reviewPackage.criteria) || !Array.isArray(input.reviewPackage.pairs) || !Array.isArray(input.privateMapping.pairs)) throw new Error("invalid blind review arrays");
  if (input.reviewPackage.schemaVersion !== "1.0" || input.privateMapping.schemaVersion !== "1.0") throw new Error("invalid blind review schemaVersion");
  if (typeof input.reviewPackage.reviewPackageDigest !== "string" || !digestPattern.test(input.reviewPackage.reviewPackageDigest)
    || input.reviewPackage.reviewPackageDigest !== computeVisualBlindReviewPackageDigest(input.reviewPackage)) throw new Error("invalid public review package digest");
  if (input.reviewPackage.benchmarkVersion !== input.privateMapping.benchmarkVersion) throw new Error("blind review benchmarkVersion mismatch");
  if (input.results.length !== 96 || input.reviewPackage.pairs.length !== 48 || input.privateMapping.pairs.length !== 48) throw new Error("aggregate requires 96 results and 48 complete pairs");
  for (const result of input.results) {
    if (result.operationalEvidence !== "complete" || !isCompleteVisualOperationalEvidence(result)) throw new Error(`incomplete operational evidence for ${result.runId}`);
  }
  assertImmutableResults(input.results);
  const labels = new Set<string>();
  for (const pair of input.reviewPackage.pairs) {
    if (!pair || typeof pair !== "object" || !exactKeys(pair as unknown as Record<string, unknown>, ["pairId", "labelA", "labelB", "screenshotsA", "screenshotsB"])
      || typeof pair.pairId !== "string" || !pair.pairId || typeof pair.labelA !== "string" || !pair.labelA
      || typeof pair.labelB !== "string" || !pair.labelB || !Array.isArray(pair.screenshotsA) || !pair.screenshotsA.length
      || !pair.screenshotsA.every((item) => typeof item === "string" && item.length > 0 && !pathIsUnsafe(item))
      || !Array.isArray(pair.screenshotsB) || !pair.screenshotsB.length
      || !pair.screenshotsB.every((item) => typeof item === "string" && item.length > 0 && !pathIsUnsafe(item))) throw new Error("invalid public review pair contract");
    if (labels.has(pair.labelA) || labels.has(pair.labelB) || pair.labelA === pair.labelB) throw new Error("duplicate public review label");
    labels.add(pair.labelA); labels.add(pair.labelB);
  }
  for (const pair of input.privateMapping.pairs) {
    if (!pair || typeof pair !== "object" || !exactKeys(pair as unknown as Record<string, unknown>, ["pairId", "A", "B"])
      || typeof pair.pairId !== "string" || !pair.pairId) throw new Error("invalid private mapping pair contract");
    for (const side of ["A", "B"] as const) {
      const entry = pair[side];
      if (!entry || typeof entry !== "object" || !exactKeys(entry as unknown as Record<string, unknown>, ["label", "runId", "arm", "modelId", "resultDigest", "sourceArtifactPaths"])
        || typeof entry.label !== "string" || !entry.label || typeof entry.runId !== "string" || !entry.runId
        || !["with-skillranger", "without-skillranger"].includes(entry.arm) || typeof entry.modelId !== "string" || !entry.modelId
        || typeof entry.resultDigest !== "string" || !digestPattern.test(entry.resultDigest)
        || !Array.isArray(entry.sourceArtifactPaths) || !entry.sourceArtifactPaths.every((item) => typeof item === "string")) throw new Error("invalid private mapping entry contract");
    }
  }
  if (input.reviewPackage.criteria.length !== visualCriteria.length || input.reviewPackage.criteria.some((criterion, index) => criterion !== visualCriteria[index])) throw new Error("public review criteria mismatch");
  const resultMap = new Map(input.results.map((result) => [result.runId, result]));
  if (resultMap.size !== input.results.length) throw new Error("duplicate result run id");
  if (input.results.some((result) => result.benchmarkVersion !== input.reviewPackage.benchmarkVersion)) throw new Error("result benchmarkVersion mismatch");
  const publicMap = new Map(input.reviewPackage.pairs.map((pair) => [pair.pairId, pair]));
  const privateMap = new Map(input.privateMapping.pairs.map((pair) => [pair.pairId, pair]));
  if (publicMap.size !== 48 || privateMap.size !== 48 || [...publicMap.keys()].some((id) => !privateMap.has(id))) throw new Error("public/private pair sets mismatch");
  const mappedRuns = new Set<string>();
  for (const [pairId, mapping] of privateMap) {
    const publicPair = publicMap.get(pairId)!;
    if (mapping.A.label !== publicPair.labelA || mapping.B.label !== publicPair.labelB || mapping.A.label === mapping.B.label) throw new Error(`label mismatch for ${pairId}`);
    if (mapping.A.runId === mapping.B.runId || mapping.A.arm === mapping.B.arm) throw new Error(`invalid arm mapping for ${pairId}`);
    const resultA = resultMap.get(mapping.A.runId); const resultB = resultMap.get(mapping.B.runId);
    if (!resultA || !resultB || resultA.briefId !== resultB.briefId || resultA.capabilityCandidateId !== resultB.capabilityCandidateId || resultA.repetition !== resultB.repetition) throw new Error(`pair identity mismatch for ${pairId}`);
    const labelSecrets = [mapping.A.arm, mapping.B.arm, mapping.A.modelId, mapping.B.modelId, mapping.A.runId, mapping.B.runId, resultA.briefId, resultA.capabilityCandidateId];
    if (!isOpaqueReviewLabel(publicPair.labelA, labelSecrets) || !isOpaqueReviewLabel(publicPair.labelB, labelSecrets)) throw new Error(`public review labels are not opaque for ${pairId}`);
    for (const side of ["A", "B"] as const) {
      const mapped = mapping[side];
      const result = resultMap.get(mapped.runId);
      if (!result || mapped.arm !== result.arm || mapped.modelId !== result.modelId
        || mapped.resultDigest !== computeVisualBenchmarkResultDigest(result)
        || mapped.sourceArtifactPaths.length !== result.artifactPaths.length
        || mapped.sourceArtifactPaths.some((item, index) => item !== result.artifactPaths[index])) throw new Error(`run mapping mismatch for ${pairId}/${side}`);
      if (mappedRuns.has(mapped.runId)) throw new Error(`duplicate mapped run ${mapped.runId}`);
      mappedRuns.add(mapped.runId);
    }
  }
  if (mappedRuns.size !== input.results.length) throw new Error("private mapping does not cover every result exactly once");
};

export const aggregateVisualBenchmark = (input: { results: VisualBenchmarkRunResult[]; reviewPackage: VisualBlindReviewPackage; privateMapping: VisualBlindReviewMapping; reviews: VisualHumanReview[] }): VisualBenchmarkReport => {
  assertPublishedContracts(input);
  if (!Array.isArray(input.reviews) || input.reviews.length !== 2) throw new Error("exactly two human reviews are required");
  const reviewerIds = new Set<string>();
  for (const review of input.reviews) {
    const issues = validateHumanReview(review, input.reviewPackage);
    if (issues.length) throw new Error(`Invalid human review: ${issues.join("; ")}`);
    const reviewerId = review.reviewerId.trim();
    if (reviewerIds.has(reviewerId)) throw new Error("human reviews require distinct reviewer identities");
    reviewerIds.add(reviewerId);
  }
  const results = new Map(input.results.map((result) => [result.runId, result]));
  const mapping = new Map(input.privateMapping.pairs.map((pair) => [pair.pairId, pair]));
  const scoreRows = new Map<string, { vectors: number[][]; catastrophic: boolean[] }>();
  const preferenceByReviewer = new Map<string, PreferenceCounts>();
  const preferenceByReviewerAndCandidate = new Map<string, Map<string, PreferenceCounts>>();
  const overallPreference = emptyPreferenceCounts();
  const orderedReviewerIds: string[] = [];
  for (const review of input.reviews) {
    const reviewerId = review.reviewerId.trim();
    const reviewerPreference = emptyPreferenceCounts();
    const reviewerCandidatePreferences = new Map<string, PreferenceCounts>();
    for (const judgment of review.judgments) {
      const pair = mapping.get(judgment.pairId)!;
      for (const side of ["A", "B"] as const) {
        const run = pair[side];
        const scores = judgment[`scores${side}`];
        const row = scoreRows.get(run.runId) ?? { vectors: [], catastrophic: [] };
        row.vectors.push(visualCriteria.map((criterion) => scores[criterion]));
        row.catastrophic.push(judgment[`catastrophic${side}`]);
        scoreRows.set(run.runId, row);
      }
      const sourceResult = results.get(pair.A.runId)!;
      const reviewerBucket = reviewerCandidatePreferences.get(sourceResult.capabilityCandidateId) ?? emptyPreferenceCounts();
      const updatePreference = (counts: PreferenceCounts) => {
        if (judgment.preference === "tie") counts.ties++;
        else if (judgment.preference === "abstain") counts.abstentions++;
        else if (pair[judgment.preference].arm === "with-skillranger") counts.candidateWins++;
        else counts.comparatorWins++;
      };
      updatePreference(overallPreference);
      updatePreference(reviewerPreference);
      updatePreference(reviewerBucket);
      reviewerCandidatePreferences.set(sourceResult.capabilityCandidateId, reviewerBucket);
    }
    orderedReviewerIds.push(reviewerId);
    preferenceByReviewer.set(reviewerId, reviewerPreference);
    preferenceByReviewerAndCandidate.set(reviewerId, reviewerCandidatePreferences);
  }
  const records: ScoredRun[] = [...scoreRows].map(([runId, row]) => {
    const result = results.get(runId)!;
    const vector = visualCriteria.map((_, index) => mean(row.vectors.map((values) => values[index])));
    return { result, vector, quality: mean(vector) / 5, catastrophic: row.catastrophic.some(Boolean) };
  });
  if (records.length !== 96) throw new Error("reviews did not score every run");
  const equalWeightedPreference = (counts: PreferenceCounts[]) => mean(counts.map(preferenceShare));
  const preference = equalWeightedPreference(orderedReviewerIds.map((reviewerId) => preferenceByReviewer.get(reviewerId)!));
  const byArm = {
    "without-skillranger": metricSet(records.filter((record) => record.result.arm === "without-skillranger"), preference),
    "with-skillranger": metricSet(records.filter((record) => record.result.arm === "with-skillranger"), preference),
  };
  const successfulRecipes = (candidateRecords: ScoredRun[]) => {
    const byRecipe = new Map<string, ScoredRun[]>();
    for (const record of candidateRecords) byRecipe.set(record.result.recipeId, [...(byRecipe.get(record.result.recipeId) ?? []), record]);
    return [...byRecipe].filter(([, recipeRecords]) => recipeRecords.length === 2
      && new Set(recipeRecords.map(({ result }) => result.repetition)).size === 2
      && recipeRecords.every(({ result, catastrophic }) => !catastrophic && result.hardGateFailed === false && result.verificationOutcome === "verified"))
      .map(([recipeId]) => recipeId).sort();
  };
  const candidateMetric = (candidateId: "weak" | "medium" | "strong"): VisualCandidateMetricSet => {
    // Runtime calibration is based on the SkillRanger arm only: eight briefs x two repetitions = 16 samples.
    const candidateRecords = records.filter((record) => record.result.capabilityCandidateId === candidateId && record.result.arm === "with-skillranger");
    const pref = equalWeightedPreference(orderedReviewerIds.map((reviewerId) =>
      preferenceByReviewerAndCandidate.get(reviewerId)?.get(candidateId) ?? emptyPreferenceCounts()));
    return {
      ...metricSet(candidateRecords, pref),
      modelIds: [...new Set(candidateRecords.map(({ result }) => result.modelId))],
      successfulRecipeIds: successfulRecipes(candidateRecords),
      evidencePaths: [...new Set(candidateRecords.flatMap(({ result }) => result.artifactPaths))],
    };
  };
  const byCapability = { weak: candidateMetric("weak"), medium: candidateMetric("medium"), strong: candidateMetric("strong") };
  const delta: Record<string, number> = {};
  for (const key of Object.keys(byArm["with-skillranger"]) as Array<keyof VisualBenchmarkMetricSet>) delta[key] = byArm["with-skillranger"][key] - byArm["without-skillranger"][key];

  const blockingReasons: string[] = [];
  const decisive = decisiveComparisons(overallPreference);
  if (decisive === 0) blockingReasons.push("no decisive blinded preference judgments");
  else if (preference < 0.6) blockingReasons.push(`decisive blinded preference share ${preference.toFixed(4)} is below the 0.6 minimum`);
  const catastrophicFindings = records.filter(({ catastrophic }) => catastrophic).length;
  const hardGateFailures = input.results.filter(({ hardGateFailed }) => hardGateFailed === true).length;
  const unverifiedOutcomes = input.results.filter(({ verificationOutcome }) => verificationOutcome !== "verified").length;
  const criticalFindings = input.results.reduce((total, result) => total + (result.criticalFindings ?? 0), 0);
  const falseCompletionClaims = input.results.filter(({ completionClaimed, verificationOutcome }) => completionClaimed === true && verificationOutcome !== "verified").length;
  if (catastrophicFindings > 0) blockingReasons.push(`${catastrophicFindings} catastrophic finding(s) detected`);
  if (unverifiedOutcomes > 0) blockingReasons.push(`${unverifiedOutcomes} unverified outcome(s) detected`);
  if (hardGateFailures > 0) blockingReasons.push(`${hardGateFailures} hard-gate failure(s) detected`);
  if (criticalFindings > 0) blockingReasons.push(`${criticalFindings} critical finding(s) detected`);
  if (falseCompletionClaims > 0) blockingReasons.push(`${falseCompletionClaims} false completion claim(s) detected`);
  const promotion: VisualPromotionVerdict = {
    verdict: blockingReasons.length === 0 ? "promotable" : "blocked",
    blockingReasons,
    reviewerCount: input.reviews.length,
    decisiveComparisons: decisive,
    candidateWins: overallPreference.candidateWins,
    comparatorWins: overallPreference.comparatorWins,
    ties: overallPreference.ties,
    abstentions: overallPreference.abstentions,
    candidatePreferenceShare: preference,
  };
  return {
    schemaVersion: "1.0", benchmarkVersion: input.reviewPackage.benchmarkVersion,
    metrics: { ...metricSet(records, preference), runSlots: input.results.length }, byCapability, byArm, skillRangerDeltas: delta,
    modelIds: [...new Set(input.results.map(({ modelId }) => modelId))],
    successfulRecipeIds: [...new Set(records.filter(({ result, catastrophic }) => !catastrophic && !result.hardGateFailed && result.verificationOutcome === "verified").map(({ result }) => result.recipeId))],
    evidencePaths: [...new Set(input.results.flatMap(({ artifactPaths }) => artifactPaths))],
    promotion,
  };
};

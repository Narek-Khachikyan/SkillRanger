import path from "node:path";
import { canonicalPath, isContained, readJson } from "./io.ts";
import { loadFrontendEvalSuite } from "../evals/frontend.ts";
import type { ModelCapabilityRecord } from "../evals/visual/calibration.ts";
import { loadVisualBenchmarkSuite } from "../evals/visual/suite.ts";
import { atomicJson, bindVisualCandidateProfileDigests, validateVisualCandidates } from "../evals/visual/runner.ts";
import type {
  VisualBenchmarkPlan,
  VisualBenchmarkReport,
  VisualBenchmarkRunResult,
  VisualCapabilityCandidate,
  VisualHumanReview,
} from "../evals/visual/types.ts";
import type { VisualBlindReviewMapping, VisualBlindReviewPackage } from "../evals/visual/review.ts";
import {
  collectReleaseEvidenceFiles,
  evaluateReleaseHandoff,
  validateFrontendReleaseArtifacts,
} from "../release/certification.ts";
import type { FrontendTaskEvidence } from "../evals/frontend.ts";
import { defaultFrontendEvalSuitePath, packageRoot } from "../paths.ts";

type FlagValue = string | boolean | undefined;
type Flags = Record<string, FlagValue>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asPath = (flags: Flags, name: string) => {
  const value = flags[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`--${name} requires a path.`);
  return path.resolve(value);
};

const requiredPath = (flags: Flags, name: string, issues: string[]) => {
  try {
    return asPath(flags, name);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
    return undefined;
  }
};

const readSource = async <T>(
  file: string | undefined,
  label: string,
  issues: string[],
): Promise<T | undefined> => {
  if (!file) {
    issues.push(`${label} is required`);
    return undefined;
  }
  try {
    return await readJson<T>(file);
  } catch (error) {
    issues.push(`${label} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
};

const readVisualSuite = async (file: string | undefined, issues: string[]) => {
  if (!file) {
    issues.push("visual benchmark suite is required");
    return undefined;
  }
  try {
    return await loadVisualBenchmarkSuite(file);
  } catch (error) {
    issues.push(`visual benchmark suite cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
};

const readVisualCandidates = async (file: string | undefined, issues: string[]): Promise<VisualCapabilityCandidate[] | undefined> => {
  const value = await readSource<unknown>(file, "visual candidates", issues);
  if (value === undefined || !file) return undefined;
  try {
    return bindVisualCandidateProfileDigests(validateVisualCandidates(value), path.dirname(file));
  } catch (error) {
    issues.push(`visual candidates are invalid: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
};

const readRuns = async (file: string | undefined, issues: string[]) => {
  const value = await readSource<unknown>(file, "visual results", issues);
  if (!isRecord(value) || !Array.isArray(value.runs)) {
    if (value !== undefined) issues.push("visual results must contain a runs array");
    return undefined;
  }
  return value.runs as VisualBenchmarkRunResult[];
};

const printArtifactValidation = (report: Awaited<ReturnType<typeof validateFrontendReleaseArtifacts>>, json: boolean) => {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Frontend release artifacts: ${report.ok ? "valid" : "blocked"}`);
  console.log(`Release: ${report.releaseVersion} · package ${report.packageVersion || "missing"}`);
  console.log(`Rule contract: ${report.ruleContract.ruleCount} rules across ${report.ruleContract.families.length} families; ${report.ruleContract.examplePackCount} example packs; ${report.ruleContract.assetCount} assets`);
  for (const issue of report.issues) console.log(`- ${issue}`);
};

const collectHandoffEvidence = async (input: {
  artifactReport: Awaited<ReturnType<typeof validateFrontendReleaseArtifacts>>;
  paths: {
    visualSuite?: string;
    visualCandidates?: string;
    commandProfiles: Array<{ path: string; role: string }>;
    visualPlan?: string;
    visualResults?: string;
    visualReport?: string;
    reviewPackage?: string;
    privateMapping?: string;
    capabilityRecord?: string;
    reviews: string[];
    baselineSuite?: string;
    baselineEvidence?: string;
  };
  visual?: {
    results: VisualBenchmarkRunResult[];
    reviewPackage: VisualBlindReviewPackage;
  };
  baseline?: FrontendTaskEvidence;
}) => {
  const entries = input.artifactReport.files.map((file) => ({
    path: path.join(packageRoot, file.path),
    role: "release-artifact",
  }));
  const add = (file: string | undefined, role: string) => {
    if (file) entries.push({ path: file, role });
  };
  add(input.paths.visualSuite, "visual-suite");
  add(input.paths.visualCandidates, "visual-candidates");
  input.paths.commandProfiles.forEach(({ path: file, role }) => add(file, role));
  add(input.paths.visualPlan, "visual-plan");
  add(input.paths.visualResults, "visual-results");
  add(input.paths.visualReport, "visual-aggregate");
  add(input.paths.reviewPackage, "public-review-package");
  add(input.paths.privateMapping, "private-mapping");
  add(input.paths.capabilityRecord, "capability-record");
  input.paths.reviews.forEach((file, index) => add(file, `human-review-${index + 1}`));
  add(input.paths.baselineSuite, "baseline-suite");
  add(input.paths.baselineEvidence, "baseline-evidence");

  const sourceIssues: string[] = [];
  const publicReviewRoot = input.paths.reviewPackage
    ? await canonicalPath(path.dirname(input.paths.reviewPackage))
    : undefined;
  if (input.paths.reviewPackage && input.paths.privateMapping) {
    const privatePath = await canonicalPath(input.paths.privateMapping);
    if (publicReviewRoot && isContained(publicReviewRoot, privatePath)) sourceIssues.push("private mapping must remain outside the public review tree");
  }
  if (input.visual) {
    for (const result of Array.isArray(input.visual.results) ? input.visual.results : []) {
      add(result.resultPath, "visual-run-result");
      for (const artifact of Array.isArray(result.artifactPaths) ? result.artifactPaths : []) {
        add(artifact, "visual-run-artifact");
        if (/\.(png|jpe?g|webp)$/i.test(artifact)) add(artifact, "visual-screenshot");
      }
    }
    if (input.paths.reviewPackage) {
      for (const pair of Array.isArray(input.visual.reviewPackage.pairs) ? input.visual.reviewPackage.pairs : []) {
        for (const screenshot of [...pair.screenshotsA, ...pair.screenshotsB]) {
          if (path.isAbsolute(screenshot) || screenshot.replaceAll("\\", "/").split("/").includes("..")) {
            sourceIssues.push(`public review screenshot escapes the review package: ${screenshot}`);
            continue;
          }
          const screenshotPath = path.resolve(path.dirname(input.paths.reviewPackage), screenshot);
          const canonicalScreenshot = await canonicalPath(screenshotPath);
          if (publicReviewRoot && !isContained(publicReviewRoot, canonicalScreenshot)) {
            sourceIssues.push(`public review screenshot escapes the review package: ${screenshot}`);
            continue;
          }
          add(screenshotPath, "public-review-screenshot");
        }
      }
    }
  }
  if (input.baseline) {
    for (const run of Array.isArray(input.baseline.runs) ? input.baseline.runs : []) {
      for (const artifact of Array.isArray(run.artifacts) ? run.artifacts : []) add(artifact.path, "baseline-artifact");
    }
  }
  if (input.baseline && !Array.isArray(input.baseline.runs)) sourceIssues.push("baseline evidence must contain a runs array");
  if (input.visual && !Array.isArray(input.visual.reviewPackage?.pairs)) sourceIssues.push("public review package must contain a pairs array");
  const collected = await collectReleaseEvidenceFiles(entries);
  return { ...collected, issues: [...new Set([...sourceIssues, ...collected.issues])] };
};

export const handleReleaseCommand = async (input: { command: string; flags: Flags }): Promise<boolean> => {
  if (input.command === "release:validate") {
    const report = await validateFrontendReleaseArtifacts();
    printArtifactValidation(report, Boolean(input.flags.json));
    if (!report.ok) process.exitCode = 1;
    return true;
  }
  if (input.command !== "release:certify") return false;

  const outputPath = asPath(input.flags, "output");
  const sourceIssues: string[] = [];
  const visualSuitePath = path.join(packageRoot, "evals/frontend/visual-benchmark/suite.json");
  const baselineSuitePath = defaultFrontendEvalSuitePath;
  const visualCandidatesPath = requiredPath(input.flags, "visual-candidates", sourceIssues);
  const visualPlanPath = requiredPath(input.flags, "visual-plan", sourceIssues);
  const visualResultsPath = requiredPath(input.flags, "visual-results", sourceIssues);
  const visualReportPath = requiredPath(input.flags, "visual-report", sourceIssues);
  const reviewPackagePath = requiredPath(input.flags, "review-package", sourceIssues);
  const privateMappingPath = requiredPath(input.flags, "private-mapping", sourceIssues);
  const capabilityRecordPath = requiredPath(input.flags, "capability-record", sourceIssues);
  const baselineEvidencePath = requiredPath(input.flags, "baseline-evidence", sourceIssues);
  const reviewPaths = typeof input.flags["human-review"] === "string"
    ? input.flags["human-review"].split(",").map((file) => file.trim()).filter(Boolean).map((file) => path.resolve(file))
    : [];
  if (reviewPaths.length !== 2) sourceIssues.push("exactly two --human-review files are required");

  const [artifactReport, visualSuite, candidates, plan, results, reviewPackage, privateMapping, capabilityRecord, aggregateReport, baselineSuite, baselineEvidence, ...reviews] = await Promise.all([
    validateFrontendReleaseArtifacts(),
    readVisualSuite(visualSuitePath, sourceIssues),
    readVisualCandidates(visualCandidatesPath, sourceIssues),
    readSource<VisualBenchmarkPlan>(visualPlanPath, "visual plan", sourceIssues),
    readRuns(visualResultsPath, sourceIssues),
    readSource<VisualBlindReviewPackage>(reviewPackagePath, "public review package", sourceIssues),
    readSource<VisualBlindReviewMapping>(privateMappingPath, "private mapping", sourceIssues),
    readSource<ModelCapabilityRecord>(capabilityRecordPath, "capability record", sourceIssues),
    readSource<VisualBenchmarkReport>(visualReportPath, "visual aggregate report", sourceIssues),
    readSource<Awaited<ReturnType<typeof loadFrontendEvalSuite>>>(baselineSuitePath, "baseline suite", sourceIssues),
    readSource<FrontendTaskEvidence>(baselineEvidencePath, "baseline evidence", sourceIssues),
    ...reviewPaths.map((file, index) => readSource<VisualHumanReview>(file, `human review ${index + 1}`, sourceIssues)),
  ]);

  const visual = visualSuite && candidates && plan && results && reviewPackage && privateMapping && capabilityRecord && aggregateReport && reviews.length === 2 && reviews.every(Boolean)
    ? { suite: visualSuite, candidates, plan, results, reviewPackage, privateMapping, capabilityRecord, aggregateReportPath: visualReportPath!, reviews: reviews as VisualHumanReview[], aggregateReport }
    : undefined;
  const commandProfiles = candidates && visualCandidatesPath
    ? candidates.map((candidate) => ({
      path: path.resolve(path.dirname(visualCandidatesPath), candidate.commandProfile),
      role: `visual-command-profile-${candidate.id}`,
    }))
    : [];
  const baseline = baselineSuite && baselineEvidence ? { suite: baselineSuite, evidence: baselineEvidence } : undefined;
  const evidence = await collectHandoffEvidence({
    artifactReport,
    paths: { visualSuite: visualSuitePath, visualCandidates: visualCandidatesPath, commandProfiles, visualPlan: visualPlanPath, visualResults: visualResultsPath, visualReport: visualReportPath, reviewPackage: reviewPackagePath, privateMapping: privateMappingPath, capabilityRecord: capabilityRecordPath, reviews: reviewPaths, baselineSuite: baselineSuitePath, baselineEvidence: baselineEvidencePath },
    visual: visual ? { results: visual.results, reviewPackage: visual.reviewPackage } : undefined,
    baseline: baselineEvidence,
  });
  const handoff = evaluateReleaseHandoff({
    releaseArtifacts: artifactReport,
    visual,
    baseline,
    sourceIssues: [...sourceIssues, ...evidence.issues],
    evidenceFiles: evidence.files,
  });
  await atomicJson(outputPath, handoff);
  if (input.flags.json) console.log(JSON.stringify(handoff, null, 2));
  else {
    console.log(`Release ${handoff.releaseVersion}: ${handoff.verdict}`);
    console.log(`Evidence files: ${handoff.evidenceBundle.files.length}`);
    for (const reason of handoff.blockingReasons) console.log(`- ${reason}`);
    console.log(`Handoff written to ${outputPath}`);
  }
  if (handoff.verdict !== "promotable") process.exitCode = 1;
  return true;
};

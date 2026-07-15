import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { assertValidCriticReportV2 } from "./critic.ts";
import { deriveBrowserGateResults, deriveTailwindSourceResults } from "./frontend-evidence.ts";
import type { EvidenceArtifact, SkillLedger, SkillRunV2 } from "./types.ts";

type Result = { passed: boolean; message?: string };
export type StrictValidatorDerivation = {
  artifactIntegrity: Result;
  validatorResults: Record<string, Result>;
};
export type StrictValidatorCallback = (context: {
  gateId: string;
  validatorId: string;
  skillId: string;
  artifacts: readonly EvidenceArtifact[];
  evidence: {
    output?: unknown;
    verificationInput?: unknown;
    sourceReview?: unknown;
    criticReport?: unknown;
  };
}) => Result | Promise<Result>;
export type StrictValidatorCallbacks = Partial<Record<string, StrictValidatorCallback>>;
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const parse = (artifact: EvidenceArtifact | undefined, artifactBytes: Map<string, Buffer>) => {
  if (!artifact) return undefined;
  try { return JSON.parse(artifactBytes.get(artifact.artifactId)?.toString("utf8") ?? "") as unknown; }
  catch { return undefined; }
};
const gateSlug = (gateId: string) => gateId.slice(gateId.lastIndexOf("/") + 1);
const containedBy = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const readVerifiedArtifact = async (projectRoot: string, canonicalRoot: string, artifact: EvidenceArtifact) => {
  const target = path.resolve(projectRoot, artifact.path);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const leaf = await lstat(target);
    if (!leaf.isFile() || leaf.isSymbolicLink()) return undefined;
    const canonicalBeforeOpen = await realpath(target);
    if (!containedBy(canonicalRoot, canonicalBeforeOpen)) return undefined;
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    const bytes = await handle.readFile();
    const canonicalAfterRead = await realpath(target);
    if (canonicalAfterRead !== canonicalBeforeOpen || !containedBy(canonicalRoot, canonicalAfterRead)) return undefined;
    if (!info.isFile() || bytes.byteLength !== artifact.size || digest(bytes) !== artifact.sha256) return undefined;
    return bytes;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

export const deriveStrictValidatorResults = async (
  projectRoot: string,
  run: SkillRunV2,
  ledger: SkillLedger,
  validatorCallbacks: StrictValidatorCallbacks = {},
): Promise<StrictValidatorDerivation> => {
  const results: Record<string, Result> = {};
  const ids = new Set(ledger.steps.flatMap((step) => step.attempts.at(-1)?.evidenceIds ?? []));
  const artifacts = run.artifacts.filter(({ artifactId }) => ids.has(artifactId));
  const artifactBytes = new Map<string, Buffer>();
  const canonicalRoot = await realpath(projectRoot).catch(() => undefined);
  let integrity = canonicalRoot !== undefined;
  if (canonicalRoot) {
    for (const artifact of artifacts) {
      const bytes = await readVerifiedArtifact(projectRoot, canonicalRoot, artifact);
      if (!bytes) { integrity = false; break; }
      artifactBytes.set(artifact.artifactId, bytes);
    }
  }
  const artifactIntegrity: Result = integrity
    ? { passed: true }
    : { passed: false, message: "Staged artifact digest, size, path, or file type changed." };
  if (!artifactIntegrity.passed) return { artifactIntegrity, validatorResults: results };

  const output = parse(artifacts.findLast(({ validatedAs }) => validatedAs === "output"), artifactBytes);
  const verificationInput = parse(artifacts.findLast(({ kind }) => kind === "verification-input"), artifactBytes);
  const latestImplementationDiff = artifacts.findLast(({ kind }) => kind === "implementation-diff");
  const latestSourceProducer = latestImplementationDiff?.attributions.find(({ relation }) => relation === "produced");
  const implementationDiffs = latestSourceProducer
    ? artifacts.filter((artifact) => artifact.kind === "implementation-diff" && artifact.attributions.some((attribution) =>
      attribution.relation === "produced"
      && attribution.skillId === latestSourceProducer.skillId
      && attribution.stepId === latestSourceProducer.stepId
      && attribution.attempt === latestSourceProducer.attempt))
    : [];
  const sourceReview = parse(implementationDiffs.at(-1), artifactBytes);
  const criticReport = parse(artifacts.findLast(({ validatedAs }) => validatedAs === "critic-report"), artifactBytes);
  const browser = deriveBrowserGateResults(verificationInput, artifacts);
  const sourceResults = implementationDiffs.map((artifact) =>
    deriveTailwindSourceResults(artifactBytes.get(artifact.artifactId)?.toString("utf8") ?? ""));
  const source = Object.fromEntries([
    "no-dynamic-tailwind-classes",
    "raw-colors-reviewed",
    "repeated-class-bundles-reviewed",
  ].map((slug) => {
    const failed = sourceResults.find((candidate) => candidate[slug]?.passed !== true)?.[slug];
    return [slug, failed ?? (sourceResults.length > 0
      ? { passed: true }
      : { passed: false, message: "No implementation diff evidence was staged." })];
  }));

  for (const gate of ledger.contract.gates) {
    if (gate.evaluator.type !== "validator") continue;
    let result: Result = { passed: false, message: `Runtime validator ${gate.evaluator.validatorId} found no valid evidence.` };
    const callback = validatorCallbacks[gate.evaluator.validatorId];
    if (callback) result = await callback({
      gateId: gate.id,
      validatorId: gate.evaluator.validatorId,
      skillId: ledger.skillId,
      artifacts,
      evidence: { output, verificationInput, sourceReview, criticReport },
    });
    else if (gate.evaluator.validatorId === "core/artifact-integrity") result = { passed: true };
    else if (gate.evaluator.validatorId === "core/critic-independence") {
      try { assertValidCriticReportV2(criticReport, ledger.contract); result = { passed: true }; }
      catch (error) { result = { passed: false, message: (error as Error).message }; }
    } else if (gate.evaluator.validatorId === "frontend/performance-claims") {
      const report = record(output) ? output : undefined;
      const findings = Array.isArray(report?.findings) ? report.findings.filter(record) : [];
      const measurements = Array.isArray(report?.measurementsInspected) ? report.measurementsInspected.filter((item): item is string => typeof item === "string") : [];
      const gaps = Array.isArray(report?.measurementGaps) ? report.measurementGaps.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
      const beforeAfter = measurements.some((item) => /before/i.test(item)) && measurements.some((item) => /after/i.test(item));
      const checks: Record<string, boolean> = {
        "finding-dimension-present": findings.every((finding) => typeof finding.affectedFlow === "string" && typeof finding.dimension === "string"),
        "measured-claim-has-artifact": findings.filter((finding) => finding.basis === "measured").every((finding) => Array.isArray(finding.evidence) && finding.evidence.length > 0),
        "before-after-required-for-win": report?.mode !== "validate-change" || beforeAfter,
        "unmeasured-claims-labeled-risk": findings.every((finding) => finding.basis === "measured" || finding.basis === "risk"),
        "exact-missing-measurement": !findings.some((finding) => finding.basis === "risk") || gaps.length > 0,
        "priority-confidence-present": findings.every((finding) => typeof finding.impact === "string" && typeof finding.confidence === "string" && typeof finding.tradeoff === "string"),
        "no-false-performance-win": report?.mode !== "validate-change" || beforeAfter,
      };
      const passed = report !== undefined && checks[gateSlug(gate.id)] === true;
      result = { passed, ...(passed ? {} : { message: `Performance report failed ${gateSlug(gate.id)}.` }) };
    } else if (gate.evaluator.validatorId === "frontend/browser-hard-gates" || gate.evaluator.validatorId === "frontend/tailwind-source") {
      result = gate.evaluator.validatorId === "frontend/browser-hard-gates"
        ? browser[gateSlug(gate.id)]
        : source[gateSlug(gate.id)];
    }
    results[gate.id] = result;
  }
  return { artifactIntegrity, validatorResults: results };
};

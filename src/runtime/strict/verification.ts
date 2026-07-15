import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { assertValidCriticReportV2 } from "./critic.ts";
import type { EvidenceArtifact, SkillLedger, SkillRunV2 } from "./types.ts";

type Result = { passed: boolean; message?: string };
export type StrictValidatorDerivation = {
  artifactIntegrity: Result;
  validatorResults: Record<string, Result>;
};
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const parse = async (root: string, artifact: EvidenceArtifact | undefined) => {
  if (!artifact) return undefined;
  try { return JSON.parse(await readFile(path.join(root, artifact.path), "utf8")) as unknown; }
  catch { return undefined; }
};
const gateSlug = (gateId: string) => gateId.slice(gateId.lastIndexOf("/") + 1);

export const deriveStrictValidatorResults = async (
  projectRoot: string,
  run: SkillRunV2,
  ledger: SkillLedger,
): Promise<StrictValidatorDerivation> => {
  const results: Record<string, Result> = {};
  const ids = new Set(ledger.steps.flatMap((step) => step.attempts.at(-1)?.evidenceIds ?? []));
  const artifacts = run.artifacts.filter(({ artifactId }) => ids.has(artifactId));
  let integrity = true;
  for (const artifact of artifacts) {
    const target = path.resolve(projectRoot, artifact.path);
    const root = path.resolve(projectRoot);
    if (!target.startsWith(`${root}${path.sep}`)) { integrity = false; break; }
    const [bytes, info] = await Promise.all([readFile(target).catch(() => undefined), lstat(target).catch(() => undefined)]);
    if (!bytes || !info?.isFile() || bytes.byteLength !== artifact.size || digest(bytes) !== artifact.sha256) { integrity = false; break; }
  }
  const artifactIntegrity: Result = integrity
    ? { passed: true }
    : { passed: false, message: "Staged artifact digest, size, path, or file type changed." };
  if (!artifactIntegrity.passed) return { artifactIntegrity, validatorResults: results };

  const output = await parse(projectRoot, artifacts.findLast(({ validatedAs }) => validatedAs === "output"));
  const verificationInput = await parse(projectRoot, artifacts.findLast(({ kind }) => kind === "verification-input"));
  const sourceReview = await parse(projectRoot, artifacts.findLast(({ kind }) => kind === "implementation-diff"));

  for (const gate of ledger.contract.gates) {
    if (gate.evaluator.type !== "validator") continue;
    let result: Result = { passed: false, message: `Runtime validator ${gate.evaluator.validatorId} found no valid evidence.` };
    if (gate.evaluator.validatorId === "core/artifact-integrity") result = { passed: integrity, ...(integrity ? {} : { message: "Staged artifact digest or size changed." }) };
    else if (gate.evaluator.validatorId === "core/critic-independence") {
      const critic = await parse(projectRoot, artifacts.findLast(({ validatedAs }) => validatedAs === "critic-report"));
      try { assertValidCriticReportV2(critic, ledger.contract); result = { passed: true }; }
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
      const evidence = gate.evaluator.validatorId === "frontend/browser-hard-gates" ? verificationInput : sourceReview;
      const checks = record(evidence) && record(evidence.checks) ? evidence.checks : undefined;
      const passed = checks?.[gateSlug(gate.id)] === true;
      result = { passed, ...(passed ? {} : { message: `Evidence check ${gateSlug(gate.id)} is not true.` }) };
    }
    results[gate.id] = result;
  }
  return { artifactIntegrity, validatorResults: results };
};

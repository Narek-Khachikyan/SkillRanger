import type { VerificationReport } from "../types.ts";
import { SkillRunError, type SkillRun } from "./types.ts";
import { assertValidVerificationReport, canonicalizeJson, missingUniversalContractFields } from "./validation.ts";

export const validateVerificationReportForRun = (
  run: Pick<SkillRun, "domain" | "policy">,
  input: unknown,
): VerificationReport => {
  assertValidVerificationReport(input);
  const report = input;
  if (report.domain !== run.domain) {
    throw new SkillRunError("run-integrity", "Verification report domain does not match the skill run domain.");
  }
  if (report.executionStatus !== "implemented") {
    throw new SkillRunError("run-integrity", "Verification report execution status must be implemented.");
  }
  const criticalFindings = report.findings.filter((finding) => finding.severity === "critical").length;
  const highFindings = report.findings.filter((finding) => finding.severity === "high").length;
  if (report.gates.criticalFindings !== criticalFindings || report.gates.highFindings !== highFindings) {
    throw new SkillRunError("run-integrity", "Verification report gate counts do not match its findings.");
  }
  if (
    report.outcome === "verified"
    && (report.verificationStatus !== "passed"
      || report.gates.hardPassed !== true
      || report.findings.some((finding) => finding.gate === "hard")
      || report.evidence.length === 0)
  ) {
    throw new SkillRunError(
      "verification-blocked",
      "A verified outcome requires passed verification, passed hard gates, no hard findings, and evidence.",
    );
  }
  // Always-on guidance skills (ADR 0008): their declared output contracts are hard
  // requirements on the report regardless of the claimed outcome.
  const missingContracts = missingUniversalContractFields(run, report);
  if (missingContracts.length > 0) {
    throw new SkillRunError(
      "verification-blocked",
      `Always-on guidance skill output contracts are unsatisfied: ${missingContracts
        .map(({ skillId, fields }) => `${skillId} requires non-empty report fields in universalContracts: ${fields.join(", ")}`)
        .join(" ")}`,
      { requiredContractFields: missingContracts },
    );
  }
  return report;
};

export const canonicalizeVerificationReport = (report: VerificationReport): string => canonicalizeJson(report);

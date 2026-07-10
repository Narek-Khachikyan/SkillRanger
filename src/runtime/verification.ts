import type {
  CapabilityStatus,
  ExecutionStatus,
  RepairRequest,
  ResultVerificationStatus,
  VerificationFinding,
  VerificationOutcome,
  VerificationReport,
} from "./types.ts";

const severityRank: Record<VerificationFinding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const normalizeFindings = (findings: VerificationFinding[]) => {
  const byFingerprint = new Map<string, VerificationFinding>();
  for (const finding of findings) {
    const fingerprint = `${finding.code}::${finding.affectedSurface ?? "global"}::${finding.message}`;
    const current = byFingerprint.get(fingerprint);
    if (!current || severityRank[finding.severity] < severityRank[current.severity]) {
      byFingerprint.set(fingerprint, finding);
    }
  }
  return [...byFingerprint.values()].sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.code.localeCompare(b.code),
  );
};

export const resolveVerificationOutcome = (input: {
  capabilityStatus: CapabilityStatus;
  executionStatus: ExecutionStatus;
  verificationStatus: ResultVerificationStatus;
  findings: VerificationFinding[];
}): VerificationOutcome => {
  if (input.executionStatus === "blocked") return "blocked";
  if (input.executionStatus === "failed") return "failed";
  const hardFailures = input.findings.some(
    (finding) => finding.gate === "hard" && ["critical", "high"].includes(finding.severity),
  );
  if (hardFailures || input.verificationStatus === "failed") return "failed";
  if (
    input.capabilityStatus !== "ready" ||
    input.verificationStatus === "not-run" ||
    input.verificationStatus === "partial"
  ) {
    return "implemented-unverified";
  }
  return "verified";
};

export const createVerificationReport = (input: {
  domain: string;
  workflowId: string;
  iteration?: number;
  capabilityStatus: CapabilityStatus;
  executionStatus: ExecutionStatus;
  verificationStatus: ResultVerificationStatus;
  findings?: VerificationFinding[];
  evidence?: VerificationReport["evidence"];
  residualRisks?: string[];
}): VerificationReport => {
  const findings = normalizeFindings(input.findings ?? []);
  const criticalFindings = findings.filter((finding) => finding.severity === "critical").length;
  const highFindings = findings.filter((finding) => finding.severity === "high").length;
  const hardPassed = !findings.some(
    (finding) => finding.gate === "hard" && ["critical", "high"].includes(finding.severity),
  );
  return {
    schemaVersion: "1.0",
    domain: input.domain,
    workflowId: input.workflowId,
    iteration: input.iteration ?? 0,
    capabilityStatus: input.capabilityStatus,
    executionStatus: input.executionStatus,
    verificationStatus: input.verificationStatus,
    outcome: resolveVerificationOutcome({
      capabilityStatus: input.capabilityStatus,
      executionStatus: input.executionStatus,
      verificationStatus: input.verificationStatus,
      findings,
    }),
    findings,
    gates: { hardPassed, criticalFindings, highFindings },
    evidence: input.evidence ?? [],
    residualRisks: input.residualRisks ?? [],
  };
};

export const createRepairRequest = (
  report: VerificationReport,
  maxIterations: number,
): RepairRequest => {
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 5) {
    throw new Error("maxIterations must be an integer from 1 to 5");
  }
  const prioritized = report.findings.filter((finding) => finding.gate === "hard")
    .concat(report.findings.filter((finding) => finding.gate === "soft"));
  const stopReason = report.outcome === "blocked"
    ? "blocked" as const
    : report.gates.hardPassed
      ? "hard-gates-passed" as const
      : report.iteration >= maxIterations
        ? "iteration-limit" as const
        : undefined;
  return {
    schemaVersion: "1.0",
    workflowId: report.workflowId,
    iteration: report.iteration + (stopReason ? 0 : 1),
    maxIterations,
    ...(stopReason ? { stopReason } : {}),
    findings: prioritized,
    instructions: stopReason
      ? []
      : prioritized.map(
          (finding) => `${finding.code}: ${finding.remediation} Preserve approved direction and unrelated behavior.`,
        ),
  };
};

export const executeRepairLoop = async <T>(options: {
  initial: T;
  maxIterations: number;
  validate(value: T, iteration: number): Promise<VerificationReport>;
  repair(value: T, request: RepairRequest): Promise<T>;
}) => {
  if (!Number.isInteger(options.maxIterations) || options.maxIterations < 1 || options.maxIterations > 5) {
    throw new Error("maxIterations must be an integer from 1 to 5");
  }
  let value = options.initial;
  const reports: VerificationReport[] = [];
  for (let iteration = 0; iteration <= options.maxIterations; iteration += 1) {
    const report = await options.validate(value, iteration);
    reports.push(report);
    const request = createRepairRequest(report, options.maxIterations);
    if (request.stopReason) return { value, reports, stopReason: request.stopReason };
    value = await options.repair(value, request);
  }
  return { value, reports, stopReason: "iteration-limit" as const };
};

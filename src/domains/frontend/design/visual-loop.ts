import type { DesignExecutionPolicy } from "./policy-types.ts";
import type { VisualRun, VisualRunEvent, VisualRunState } from "./visual-loop-types.ts";

const transitionByState: Record<VisualRunState, VisualRunEvent["type"][]> = {
  "policy-resolved": ["directions-validated", "blocked", "failed"],
  "directions-valid": ["implementation-recorded", "blocked", "failed"],
  implemented: ["initial-evidence-recorded", "blocked", "failed"],
  "initial-evidence-captured": ["critique-recorded", "blocked", "failed"],
  critiqued: ["repair-requested", "no-repair-needed", "blocked", "failed"],
  "repair-requested": ["repair-recorded", "blocked", "failed"],
  "no-repair-needed": ["recheck-evidence-recorded", "blocked", "failed"],
  repaired: ["recheck-evidence-recorded", "blocked", "failed"],
  "recheck-evidence-captured": ["final-audit-recorded", "blocked", "failed"],
  "final-audited": ["verification-recorded", "blocked", "failed"],
  verified: [],
  failed: [],
  blocked: [],
};

const targetStateByEvent: Record<VisualRunEvent["type"], VisualRunState> = {
  "directions-validated": "directions-valid",
  "implementation-recorded": "implemented",
  "initial-evidence-recorded": "initial-evidence-captured",
  "critique-recorded": "critiqued",
  "repair-requested": "repair-requested",
  "no-repair-needed": "no-repair-needed",
  "repair-recorded": "repaired",
  "recheck-evidence-recorded": "recheck-evidence-captured",
  "final-audit-recorded": "final-audited",
  "verification-recorded": "verified",
  blocked: "blocked",
  failed: "failed",
};

const nonEmpty: (value: unknown, label: string) => asserts value is string = (value, label) => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be non-empty`);
};

const hasOnlyKeys = (value: object, allowed: readonly string[], label: string) => {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new Error(`${label} contains unknown field ${unexpected}`);
};

const rfc3339 = (value: unknown, label: string) => {
  nonEmpty(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) throw new Error(`${label} must be an RFC 3339 timestamp`);
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const validDay = Number(month) >= 1 && Number(month) <= 12
    && Number(day) >= 1 && Number(day) <= new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  const validTime = Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 60;
  const validOffset = offsetHour === undefined || (Number(offsetHour) <= 23 && Number(offsetMinute) <= 59);
  if (!validDay || !validTime || !validOffset) throw new Error(`${label} must be an RFC 3339 timestamp`);
};

const validateStringIds = (value: unknown, label: string, unique = false) => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  value.forEach((entry) => nonEmpty(entry, `${label} entry`));
  if (unique && new Set(value).size !== value.length) throw new Error(`${label} must contain unique variant ids`);
};

const snapshotInvariant: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(`Visual run snapshot invariant failed: ${message}`);
};

const validateStoredRun = (run: VisualRun, policy: DesignExecutionPolicy) => {
  if (run?.schemaVersion !== "1.0") throw new Error("visual run schemaVersion must be 1.0");
  hasOnlyKeys(run, [
    "schemaVersion", "id", "policyPath", "state", "variantIds", "selectedVariantId",
    "critiqueRepairFindingCount", "artifacts", "history",
  ], "visual run");
  nonEmpty(run.id, "visual run id");
  nonEmpty(run.policyPath, "visual run policy path");
  if (!Object.hasOwn(transitionByState, run.state)) throw new Error("visual run state is invalid");
  validateStringIds(run.variantIds, "visual run variant ids", true);
  if (run.selectedVariantId !== undefined) {
    nonEmpty(run.selectedVariantId, "visual run selected variant id");
    if (!run.variantIds.includes(run.selectedVariantId)) throw new Error("visual run selected variant is stale");
  }
  if (run.critiqueRepairFindingCount !== undefined
    && (!Number.isInteger(run.critiqueRepairFindingCount) || run.critiqueRepairFindingCount < 0)) {
    throw new Error("visual run critique repair finding count must be a non-negative integer");
  }
  if (typeof run.artifacts !== "object" || run.artifacts === null || Array.isArray(run.artifacts)) {
    throw new Error("visual run artifacts must be an object");
  }
  hasOnlyKeys(run.artifacts, [
    "implementations", "initialEvidenceId", "critiqueId", "repairId",
    "repairImplementationArtifact", "recheckEvidenceId", "finalAuditReportPath",
    "verificationReportPath",
  ], "visual run artifacts");
  for (const field of [
    "initialEvidenceId", "critiqueId", "repairId", "repairImplementationArtifact",
    "recheckEvidenceId", "finalAuditReportPath", "verificationReportPath",
  ] as const) if (run.artifacts[field] !== undefined) nonEmpty(run.artifacts[field], `visual run artifact ${field}`);
  if (run.artifacts.implementations !== undefined) {
    if (!Array.isArray(run.artifacts.implementations)) throw new Error("visual run implementations must be an array");
    const ids: string[] = [];
    for (const implementation of run.artifacts.implementations) {
      if (typeof implementation !== "object" || implementation === null || Array.isArray(implementation)) {
        throw new Error("visual run implementation reference must be an object");
      }
      hasOnlyKeys(implementation, ["variantId", "artifactId"], "visual run implementation reference");
      nonEmpty(implementation?.variantId, "visual run implementation variant id");
      nonEmpty(implementation?.artifactId, "visual run implementation artifact id");
      ids.push(implementation.variantId);
    }
    if (new Set(ids).size !== ids.length) throw new Error("visual run implementation variant ids must be unique");
    if (ids.some((id) => !run.variantIds.includes(id))) throw new Error("visual run implementation variant reference is stale");
  }
  if (!Array.isArray(run.history)) throw new Error("visual run history must be an array");
  for (const entry of run.history) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("visual run history entry must be an object");
    }
    hasOnlyKeys(entry, ["state", "at", "eventId"], "visual run history entry");
    if (!Object.hasOwn(transitionByState, entry?.state)) throw new Error("visual run history state is invalid");
    rfc3339(entry.at, "visual run history timestamp");
    if (entry.eventId !== undefined) nonEmpty(entry.eventId, "visual run history event id");
  }

  snapshotInvariant(run.history.length > 0, "history must be non-empty");
  snapshotInvariant(run.history[0].state === "policy-resolved", "history must start at policy-resolved");
  snapshotInvariant(run.history.at(-1)?.state === run.state, "history tail must equal the current state");
  for (let index = 1; index < run.history.length; index += 1) {
    const previous = run.history[index - 1].state;
    const current = run.history[index].state;
    const legalTargets = transitionByState[previous].map((type) => targetStateByEvent[type]);
    snapshotInvariant(legalTargets.includes(current), `illegal history transition ${previous} -> ${current}`);
    snapshotInvariant(run.history[index].eventId !== undefined, "transition history entries require event ids");
  }

  const states = new Set(run.history.map(({ state }) => state));
  const reached = (...expected: VisualRunState[]) => expected.some((state) => states.has(state));
  const directionsReached = reached(
    "directions-valid", "implemented", "initial-evidence-captured", "critiqued",
    "repair-requested", "no-repair-needed", "repaired", "recheck-evidence-captured",
    "final-audited", "verified",
  );
  snapshotInvariant(
    directionsReached ? run.variantIds.length === policy.variantLimit : run.variantIds.length === 0,
    "variant ids must match the resolved policy after directions validation",
  );

  const implementedReached = reached(
    "implemented", "initial-evidence-captured", "critiqued", "repair-requested",
    "no-repair-needed", "repaired", "recheck-evidence-captured", "final-audited", "verified",
  );
  const implementationIds = run.artifacts.implementations?.map(({ variantId }) => variantId) ?? [];
  snapshotInvariant(
    implementedReached
      ? implementationIds.length === run.variantIds.length
        && implementationIds.every((id) => run.variantIds.includes(id))
      : run.artifacts.implementations === undefined,
    "implementations must exactly cover variants from implemented onward",
  );

  const initialEvidenceReached = reached(
    "initial-evidence-captured", "critiqued", "repair-requested", "no-repair-needed",
    "repaired", "recheck-evidence-captured", "final-audited", "verified",
  );
  snapshotInvariant(
    initialEvidenceReached ? run.artifacts.initialEvidenceId !== undefined : run.artifacts.initialEvidenceId === undefined,
    "initial evidence presence must match history",
  );

  const critiqueReached = reached(
    "critiqued", "repair-requested", "no-repair-needed", "repaired",
    "recheck-evidence-captured", "final-audited", "verified",
  );
  snapshotInvariant(
    critiqueReached
      ? run.artifacts.critiqueId !== undefined && run.critiqueRepairFindingCount !== undefined
      : run.artifacts.critiqueId === undefined
        && run.critiqueRepairFindingCount === undefined
        && run.selectedVariantId === undefined,
    "critique artifacts and finding count must match history",
  );

  const decisionReached = reached(
    "repair-requested", "no-repair-needed", "repaired", "recheck-evidence-captured",
    "final-audited", "verified",
  );
  snapshotInvariant(
    !decisionReached || (run.selectedVariantId !== undefined && run.variantIds.includes(run.selectedVariantId)),
    "selected decision states require a current selected variant",
  );

  const repairRequested = reached("repair-requested", "repaired");
  snapshotInvariant(
    repairRequested ? run.artifacts.repairId !== undefined : run.artifacts.repairId === undefined,
    "repair request artifact must match the repair path",
  );
  const repaired = states.has("repaired");
  snapshotInvariant(
    repaired ? run.artifacts.repairImplementationArtifact !== undefined : run.artifacts.repairImplementationArtifact === undefined,
    "repair implementation artifact must match the repaired path",
  );
  if (states.has("no-repair-needed")) {
    snapshotInvariant(policy.profile !== "constrained", "constrained policy cannot use no-repair-needed");
    snapshotInvariant(run.critiqueRepairFindingCount === 0, "no-repair-needed requires zero critic repair findings");
  }

  const recheckReached = reached("recheck-evidence-captured", "final-audited", "verified");
  snapshotInvariant(
    recheckReached
      ? run.artifacts.recheckEvidenceId !== undefined
        && run.artifacts.recheckEvidenceId !== run.artifacts.initialEvidenceId
      : run.artifacts.recheckEvidenceId === undefined,
    "recheck evidence must be present and fresh only after recheck",
  );
  const finalAuditReached = reached("final-audited", "verified");
  snapshotInvariant(
    finalAuditReached ? run.artifacts.finalAuditReportPath !== undefined : run.artifacts.finalAuditReportPath === undefined,
    "final audit report path must match history",
  );
  snapshotInvariant(
    states.has("verified") ? run.artifacts.verificationReportPath !== undefined : run.artifacts.verificationReportPath === undefined,
    "verification report path must match verified history",
  );
};

const validateEventPayload = (event: VisualRunEvent) => {
  if (!event || typeof event !== "object" || !Object.hasOwn(targetStateByEvent, event.type)) {
    throw new Error("visual run event type is invalid");
  }
  const fieldsByType: Record<VisualRunEvent["type"], string[]> = {
    "directions-validated": ["type", "id", "at", "variantIds"],
    "implementation-recorded": ["type", "id", "at", "implementations"],
    "initial-evidence-recorded": ["type", "id", "at", "evidenceId"],
    "critique-recorded": ["type", "id", "at", "critiqueId", "selectedVariantId", "repairFindingCount"],
    "repair-requested": ["type", "id", "at", "repairId"],
    "no-repair-needed": ["type", "id", "at"],
    "repair-recorded": ["type", "id", "at", "repairId", "implementationArtifact"],
    "recheck-evidence-recorded": ["type", "id", "at", "evidenceId"],
    "final-audit-recorded": ["type", "id", "at", "reportPath"],
    "verification-recorded": ["type", "id", "at", "outcome", "reportPath"],
    blocked: ["type", "id", "at"],
    failed: ["type", "id", "at"],
  };
  hasOnlyKeys(event, fieldsByType[event.type], "visual run event");
  nonEmpty(event.id, "visual run event id");
  rfc3339(event.at, "visual run event timestamp");
  switch (event.type) {
    case "directions-validated":
      validateStringIds(event.variantIds, "directions variant ids", true);
      break;
    case "implementation-recorded": {
      if (!Array.isArray(event.implementations)) throw new Error("implementation references must be an array");
      for (const implementation of event.implementations) {
        nonEmpty(implementation?.variantId, "implementation variant id");
        nonEmpty(implementation?.artifactId, "implementation artifact id");
      }
      break;
    }
    case "initial-evidence-recorded": case "recheck-evidence-recorded":
      nonEmpty(event.evidenceId, "evidence id");
      break;
    case "critique-recorded":
      nonEmpty(event.critiqueId, "critique id");
      if (event.selectedVariantId !== undefined) nonEmpty(event.selectedVariantId, "selected variant id");
      break;
    case "repair-requested":
      nonEmpty(event.repairId, "repair id");
      break;
    case "repair-recorded":
      nonEmpty(event.repairId, "repair id");
      nonEmpty(event.implementationArtifact, "repair implementation artifact");
      break;
    case "final-audit-recorded": case "verification-recorded":
      nonEmpty(event.reportPath, "report path");
      break;
  }
};

export const allowedVisualRunEvents = (state: VisualRunState): string[] =>
  [...transitionByState[state]];

export const createVisualRun = (input: {
  id: string;
  policyPath: string;
}): VisualRun => {
  hasOnlyKeys(input, ["id", "policyPath"], "visual run input");
  nonEmpty(input.id, "visual run id");
  nonEmpty(input.policyPath, "visual run policy path");
  return {
    schemaVersion: "1.0",
    id: input.id,
    policyPath: input.policyPath,
    state: "policy-resolved",
    variantIds: [],
    artifacts: {},
    history: [{ state: "policy-resolved", at: "1970-01-01T00:00:00.000Z" }],
  };
};

const validateEvent = (
  run: VisualRun,
  event: VisualRunEvent,
  policy: DesignExecutionPolicy,
) => {
  validateStoredRun(run, policy);
  validateEventPayload(event);
  if (!transitionByState[run.state].includes(event.type)) {
    throw new Error(`${event.type} is not allowed from ${run.state}`);
  }

  if (event.type === "directions-validated") {
    if (event.variantIds.length !== policy.variantLimit) {
      throw new Error(`${policy.profile} policy requires ${policy.variantLimit} variants`);
    }
    if (new Set(event.variantIds).size !== event.variantIds.length) {
      throw new Error("directions must contain unique variant ids");
    }
  }

  if (event.type === "implementation-recorded") {
    const implementationVariantIds = event.implementations.map(({ variantId }) => variantId);
    if (new Set(implementationVariantIds).size !== implementationVariantIds.length) {
      throw new Error("implementations must contain unique variant ids");
    }
    if (implementationVariantIds.length !== run.variantIds.length
      || !implementationVariantIds.every((variantId) => run.variantIds.includes(variantId))) {
      throw new Error("implementations must exactly cover all validated variants");
    }
  }

  if (event.type === "critique-recorded"
    && event.selectedVariantId !== undefined
    && !run.variantIds.includes(event.selectedVariantId)) {
    throw new Error("selected variant must belong to the validated variants");
  }
  if (event.type === "critique-recorded"
    && (!Number.isInteger(event.repairFindingCount) || event.repairFindingCount < 0)) {
    throw new Error("repair finding count must be a non-negative integer");
  }

  if (event.type === "no-repair-needed") {
    if (policy.profile === "constrained") {
      throw new Error("constrained requires a corrective pass");
    }
    if (run.critiqueRepairFindingCount !== 0) {
      throw new Error("no-repair-needed requires a critique with zero repair findings");
    }
  }

  if ((event.type === "repair-requested" || event.type === "no-repair-needed")
    && (run.selectedVariantId === undefined || !run.variantIds.includes(run.selectedVariantId))) {
    throw new Error("a selected variant is required before a repair decision");
  }

  if (event.type === "repair-recorded" && event.repairId !== run.artifacts.repairId) {
    throw new Error("repair-recorded must match the requested repair id");
  }

  if (event.type === "recheck-evidence-recorded"
    && event.evidenceId === run.artifacts.initialEvidenceId) {
    throw new Error("recheck requires fresh evidence");
  }

  if (event.type === "verification-recorded" && event.outcome !== "verified") {
    throw new Error("verification-recorded requires a verified outcome");
  }
};

export const applyVisualRunEvent = (
  run: VisualRun,
  event: VisualRunEvent,
  policy: DesignExecutionPolicy,
): VisualRun => {
  validateEvent(run, event, policy);

  const targetState = targetStateByEvent[event.type];
  const next: VisualRun = {
    ...run,
    state: targetState,
    variantIds: [...run.variantIds],
    artifacts: {
      ...run.artifacts,
      implementations: run.artifacts.implementations?.map((implementation) => ({ ...implementation })),
    },
    history: [...run.history.map((entry) => ({ ...entry })), { state: targetState, at: event.at, eventId: event.id }],
  };

  switch (event.type) {
    case "directions-validated":
      next.variantIds = [...event.variantIds];
      break;
    case "implementation-recorded":
      next.artifacts.implementations = event.implementations.map((implementation) => ({ ...implementation }));
      break;
    case "initial-evidence-recorded":
      next.artifacts.initialEvidenceId = event.evidenceId;
      break;
    case "critique-recorded":
      next.artifacts.critiqueId = event.critiqueId;
      next.selectedVariantId = event.selectedVariantId;
      next.critiqueRepairFindingCount = event.repairFindingCount;
      break;
    case "repair-requested":
      next.artifacts.repairId = event.repairId;
      break;
    case "repair-recorded":
      next.artifacts.repairImplementationArtifact = event.implementationArtifact;
      break;
    case "recheck-evidence-recorded":
      next.artifacts.recheckEvidenceId = event.evidenceId;
      break;
    case "final-audit-recorded":
      next.artifacts.finalAuditReportPath = event.reportPath;
      break;
    case "verification-recorded":
      next.artifacts.verificationReportPath = event.reportPath;
      break;
  }

  return next;
};

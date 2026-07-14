import test from "node:test";
import assert from "node:assert/strict";
import {
  createBoundedRepairRequest,
  validateBoundedRepairCompletion,
  resolveDesignExecutionPolicy,
} from "../src/domains/frontend/design/index.ts";
import { createVerificationReport } from "../src/runtime/verification.ts";

const policy = resolveDesignExecutionPolicy({ mode: "repair", profile: "constrained", rankedRecipeIds: ["developer-tool"] });
const original = createVerificationReport({
  domain: "frontend",
  workflowId: "frontend.design-generation",
  capabilityStatus: "ready",
  executionStatus: "implemented",
  verificationStatus: "failed",
  findings: [{
    id: "overflow-1", code: "horizontal-overflow", source: "frontend.browser",
    severity: "critical", gate: "hard", message: "Table overflows at 390px.", evidence: ["#runs"],
    affectedSurface: "/runs@390:success", remediation: "Recompose the table for mobile.", autofixable: false,
  }],
});

const request = () => createBoundedRepairRequest({
  id: "repair-1", policy, report: original, targetVariantId: "v1", sourceEvidenceId: "e1",
  allowedFiles: ["src/Runs.tsx"], allowedChanges: ["responsive-layout"],
  protectedInvariants: [{ kind: "behavior", description: "Run selection remains deep-linkable." }],
});

test("creates criteria directly from normalized findings", () => {
  assert.deepEqual(request().passCriteria, [{
    findingId: "overflow-1",
    code: "horizontal-overflow",
    expected: "No critical or high horizontal-overflow finding remains on /runs@390:success.",
    evidenceKinds: ["screenshot", "browser-check"],
  }]);
});

test("rejects file scope, invariant, stale evidence, and equal-severity regressions", () => {
  const recheck = createVerificationReport({
    domain: "frontend", workflowId: "frontend.design-generation", iteration: 1,
    capabilityStatus: "ready", executionStatus: "implemented", verificationStatus: "failed",
    findings: [{
      id: "focus-1", code: "invisible-focus", source: "frontend.browser", severity: "critical", gate: "hard",
      message: "Focus disappeared.", evidence: ["button"], remediation: "Restore focus.", autofixable: false,
    }],
  });
  assert.deepEqual(validateBoundedRepairCompletion({
    request: request(), recheckReport: recheck, recheckEvidenceId: "e1",
    changedFiles: ["src/Runs.tsx", "src/api.ts"],
    appliedChanges: ["responsive-layout", "behavior"],
    violatedInvariants: ["Run selection remains deep-linkable."],
  }).map(({ code }) => code), [
    "repair-evidence-stale", "repair-file-scope-violation", "repair-change-scope-violation",
    "repair-protected-invariant-violation", "repair-regression",
  ]);
});

test("rejects a remaining critical or high targeted finding", () => {
  const recheck = createVerificationReport({
    domain: "frontend", workflowId: "frontend.design-generation", iteration: 1,
    capabilityStatus: "ready", executionStatus: "implemented", verificationStatus: "failed",
    findings: [{
      id: "overflow-1", code: "horizontal-overflow", source: "frontend.browser", severity: "high", gate: "hard",
      message: "Table still overflows at 390px.", evidence: ["#runs"],
      affectedSurface: "/runs@390:success", remediation: "Recompose the table for mobile.", autofixable: false,
    }],
  });
  assert.deepEqual(validateBoundedRepairCompletion({
    request: request(), recheckReport: recheck, recheckEvidenceId: "e2",
    changedFiles: ["src/Runs.tsx"], appliedChanges: ["responsive-layout"], violatedInvariants: [],
  }).map(({ code }) => code), ["repair-targeted-finding-unresolved"]);
});

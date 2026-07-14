import test from "node:test";
import assert from "node:assert/strict";
import { verifyVisualResult } from "../src/domains/frontend/design/index.ts";
import { makeBundle, makeVerificationInput } from "./helpers/frontend-visual-fixtures.ts";

test("fails stale, incomplete, or mismatched evidence", () => {
  const result = verifyVisualResult(makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:abc" }),
    recheckEvidence: makeBundle({ id: "e1", variantId: "v2", sourceIdentity: "git:abc", captures: [] }),
  }));
  assert.deepEqual(result.findings.map(({ code }) => code), [
    "visual-evidence-stale",
    "visual-variant-evidence-mismatch",
    "visual-evidence-source-stale",
    "visual-evidence-matrix-incomplete",
  ]);
  assert.equal(result.report.outcome, "failed");
});

test("verifies only a complete fresh correction cycle", () => {
  const result = verifyVisualResult(makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:abc" }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:def" }),
  }));
  assert.equal(result.findings.length, 0);
  assert.equal(result.report.outcome, "verified");
  assert.equal(result.report.evidence.filter(({ kind }) => kind === "screenshot").length, 12);
});


test("rejects a forged or out-of-order terminal lifecycle", () => {
  const input = makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:abc" }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:def" }),
  });
  input.visualRun.history = [{ state: "final-audited", at: "2026-07-14T00:02:00Z" }];
  const result = verifyVisualResult(input);
  assert.ok(result.findings.some(({ code }) => code === "visual-run-lifecycle-invalid"));
  assert.equal(result.report.outcome, "failed");
});

test("requires a completed repair path when the critic requests repair", () => {
  const input = makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:abc" }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:def" }),
  });
  input.criticReport.repairFindings = [{
    id: "repair-1", code: "touch-target", source: "frontend.visual-critic",
    severity: "high", gate: "hard", message: "A target is too small.", evidence: ["e1"],
    remediation: "Increase the target size.", autofixable: false,
  }];
  input.visualRun.critiqueRepairFindingCount = 1;
  const result = verifyVisualResult(input);
  assert.ok(result.findings.some(({ code }) => code === "visual-run-lifecycle-invalid"));
  assert.equal(result.report.outcome, "failed");
});

test("requires complete initial evidence before critique", () => {
  const result = verifyVisualResult(makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:abc", captures: [] }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:def" }),
  }));
  assert.ok(result.findings.some(({ code }) => code === "visual-evidence-matrix-incomplete"));
  assert.equal(result.report.outcome, "failed");
});

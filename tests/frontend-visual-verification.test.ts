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

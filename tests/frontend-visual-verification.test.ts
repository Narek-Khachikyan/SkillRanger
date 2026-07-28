import test from "node:test";
import assert from "node:assert/strict";
import { digestDesignExecutionPolicy, verifyVisualResult } from "../src/domains/frontend/design/index.ts";
import type { UiCaptureEntry, VisualCriterion, VisualCriticReport } from "../src/domains/frontend/design/index.ts";
import { makeBundle, makeVerificationInput } from "./helpers/frontend-visual-fixtures.ts";

const freshCycle = () => makeVerificationInput({
  initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:abc" }),
  recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:def" }),
});

test("rejects a selected variant below the critic quality floor", () => {
  // The critic report is an untrusted caller-supplied snapshot here, so the floor compare_design_variants
  // applies has to be re-applied independently at the final boundary.
  const input = freshCycle();
  const { scores } = input.criticReport.comparisons[0];
  for (const criterion of Object.keys(scores) as VisualCriterion[]) scores[criterion] = 0.05;

  const result = verifyVisualResult(input);
  assert.equal(result.report.outcome, "failed");
  assert.deepEqual(
    result.findings.map(({ code }) => code).filter((code) => code.endsWith("below-floor")),
    ["critic-art-direction-below-floor", "critic-production-integrity-below-floor", "critic-integrity-criterion-below-floor"],
  );
});

test("requires exactly one scorecard for the selected variant", () => {
  // The published critic schema allows both inconsistencies. Zero would disable the floor; a
  // duplicate would make it depend on array order, since a passing 0.8 card can shadow a 0.05 one.
  for (const [label, mutate] of [
    ["never scored", (report: VisualCriticReport) => { report.comparisons[0].variantId = "v2"; }],
    ["scored twice", (report: VisualCriticReport) => {
      const scores = Object.fromEntries(
        Object.keys(report.comparisons[0].scores).map((criterion) => [criterion, 0.05]),
      ) as VisualCriticReport["comparisons"][number]["scores"];
      report.comparisons.push({ ...report.comparisons[0], scores });
    }],
  ] as const) {
    const input = freshCycle();
    mutate(input.criticReport);

    const result = verifyVisualResult(input);
    assert.equal(result.report.outcome, "failed", label);
    assert.ok(result.findings.some(({ code }) => code === "critic-selected-comparison-invalid"), label);
  }
});

test("recomputes rendered and synchronized state findings at the final boundary", () => {
  // checks is caller-supplied, so the capture-generated findings are deleted here.
  const input = freshCycle();
  for (const capture of input.recheckEvidence.captures) {
    capture.stateRendered = false;
    capture.stateSynchronization = {
      status: "mismatch",
      path: "run selection -> log -> recovery",
      observations: ["log=run-7", "recovery=run-3"],
      action: "Select run-7",
      changes: [{ locator: "#log-run", before: "run-3", after: "run-7" }],
    };
    capture.checks = [];
  }

  const result = verifyVisualResult(input);
  assert.equal(result.report.outcome, "failed");
  assert.ok(result.findings.some(({ code }) => code === "ui-state-not-rendered"));
  assert.ok(result.findings.some(({ code }) => code === "ui-state-desynchronized"));
});

test("treats not-applicable interaction evidence as non-certifying", () => {
  const input = freshCycle();
  for (const capture of input.recheckEvidence.captures) {
    capture.stateSynchronization = {
      status: "not-applicable",
      path: "game controls",
      observations: ["The host reported the controls as not applicable."],
      reason: "The host did not exercise the interactive controls.",
    };
    capture.checks = [];
  }

  const result = verifyVisualResult(input);
  assert.equal(result.report.outcome, "failed");
  assert.ok(result.findings.some(({ code }) => code === "ui-state-action-missing"));
});

test("rejects evidence whose captures lost the required state synchronization", () => {
  const input = freshCycle();
  for (const capture of input.recheckEvidence.captures) {
    delete (capture as Partial<UiCaptureEntry>).stateSynchronization;
  }

  const result = verifyVisualResult(input);
  assert.equal(result.report.outcome, "failed");
  assert.ok(result.findings.some(({ code, evidence }) =>
    code === "visual-evidence-matrix-incomplete"
    && evidence.includes("recheck:capture state synchronization missing or malformed")));
});

test("fails stale, incomplete, or mismatched evidence", () => {
  const input = makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:abc" }),
    recheckEvidence: makeBundle({ id: "e1", variantId: "v2", sourceIdentity: "git:abc", captures: [] }),
  });
  input.policy.requiredStates = ["success"];
  input.visualRun.policyDigest = digestDesignExecutionPolicy(input.policy);
  const result = verifyVisualResult(input);
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
  assert.ok(result.report.evidence.some(({ kind, description }) =>
    kind === "visual-critique" && description.includes("host-attested actor separation")));
  assert.ok(!JSON.stringify(result).includes("independent critic"));
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
  const input = makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:abc", captures: [] }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:def" }),
  });
  input.policy.requiredStates = ["success"];
  input.visualRun.policyDigest = digestDesignExecutionPolicy(input.policy);
  const result = verifyVisualResult(input);
  assert.ok(result.findings.some(({ code }) => code === "visual-evidence-matrix-incomplete"));
  assert.equal(result.report.outcome, "failed");
});

test("rejects empty required states and empty evidence bundles", () => {
  const input = makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:abc", captures: [] }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:def", captures: [] }),
  });
  input.policy.requiredStates = [];
  input.visualRun.policyDigest = digestDesignExecutionPolicy(input.policy);
  input.initialEvidence.requiredStates = [];
  input.recheckEvidence.requiredStates = [];

  const result = verifyVisualResult(input);
  assert.equal(result.report.outcome, "failed");
  assert.equal(result.report.verificationStatus, "failed");
  assert.ok(result.findings.some(({ code }) => code === "visual-evidence-matrix-incomplete"));
  assert.equal(result.report.evidence.filter(({ kind }) => kind === "screenshot").length, 0);
});


test("rejects malformed timestamps and duplicate lifecycle event ids", () => {
  const malformedTimestamp = makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:abc" }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:def" }),
  });
  malformedTimestamp.visualRun.history[1].at = "not-a-timestamp";
  assert.ok(verifyVisualResult(malformedTimestamp).findings
    .some(({ code }) => code === "visual-run-lifecycle-invalid"));

  const duplicateEvents = makeVerificationInput({
    initialEvidence: makeBundle({ id: "e1", variantId: "v1", sourceIdentity: "git:abc" }),
    recheckEvidence: makeBundle({ id: "e2", variantId: "v1", sourceIdentity: "git:def" }),
  });
  duplicateEvents.visualRun.history[2].eventId = duplicateEvents.visualRun.history[1].eventId;
  const result = verifyVisualResult(duplicateEvents);
  assert.ok(result.findings.some(({ code }) => code === "visual-run-lifecycle-invalid"));
  assert.equal(result.report.outcome, "failed");
});

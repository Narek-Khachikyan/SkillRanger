import test from "node:test";
import assert from "node:assert/strict";
import {
  compareDesignVariants,
  createVisualCriticInput,
  validateVisualCriticReport,
  type VisualCriticReport,
} from "../src/domains/frontend/design/index.ts";

const input = createVisualCriticInput({
  policyId: "policy-1",
  generatorActorId: "generator-a",
  criticActorId: "critic-b",
  candidates: [
    { variantId: "v1", directionPath: "v1/direction.json", evidenceId: "e1", screenshotPaths: ["v1-390.png", "v1-1440.png"] },
    { variantId: "v2", directionPath: "v2/direction.json", evidenceId: "e2", screenshotPaths: ["v2-390.png", "v2-1440.png"] },
  ],
});

const scores = {
  "product-specificity": 0.8,
  hierarchy: 0.8,
  composition: 0.8,
  typography: 0.8,
  "color-roles": 0.8,
  "state-quality": 0.8,
  "responsive-transformation": 0.8,
  accessibility: 0.8,
  "implementation-coherence": 0.8,
  "ai-slop-risk": 0.8,
} as const;

const makeCriticReport = ({ selectedVariantId }: { selectedVariantId?: string }): VisualCriticReport => ({
  schemaVersion: "1.0",
  id: "critique-1",
  generatorActorId: "generator-a",
  criticActorId: "critic-b",
  candidateVariantIds: ["v1", "v2"],
  evidenceIds: ["e1", "e2"],
  comparisons: ["v1", "v2"].map((variantId) => ({
    variantId,
    scores: { ...scores },
    strengths: [`${variantId} preserves the primary action hierarchy.`],
    weaknesses: [`${variantId} needs tighter state differentiation.`],
    aiSlopFindings: [],
  })),
  outcome: selectedVariantId === undefined ? "no-acceptable-variant" : "selected",
  ...(selectedVariantId === undefined ? {} : { selectedVariantId }),
  repairFindings: [],
  confidence: 0.8,
  residualUncertainty: [],
  containsImplementationCode: false,
});

const findingCodes = (report: VisualCriticReport) =>
  validateVisualCriticReport(input, report).map(({ code }) => code);

test("requires an actor independent from the generator", () => {
  assert.throws(() => createVisualCriticInput({ ...input, criticActorId: "generator-a" }), /independent critic/);

  const report = makeCriticReport({ selectedVariantId: "v1" });
  report.criticActorId = report.generatorActorId;
  assert.ok(findingCodes(report).includes("critic-not-independent"));
});

test("rejects candidate and evidence mismatches deterministically", () => {
  const report = makeCriticReport({ selectedVariantId: "v1" });
  report.candidateVariantIds = ["v3", "v1", "v3"];
  report.evidenceIds = ["e3", "e1", "e3"];

  const findings = validateVisualCriticReport(input, report);
  assert.deepEqual(findings.filter(({ code }) => code === "critic-candidate-mismatch")[0]?.evidence, ["v2", "v3"]);
  assert.deepEqual(findings.filter(({ code }) => code === "critic-evidence-mismatch")[0]?.evidence, ["e2", "e3"]);
});

test("rejects missing criteria, out-of-range scores, and missing comparisons", () => {
  const report = makeCriticReport({ selectedVariantId: "v1" });
  delete (report.comparisons[0].scores as Partial<typeof scores>).typography;
  report.comparisons[0].scores.hierarchy = 1.1;
  report.comparisons = [report.comparisons[0]];

  const codes = findingCodes(report);
  assert.ok(codes.includes("critic-criterion-missing"));
  assert.ok(codes.includes("critic-score-invalid"));
  assert.ok(codes.includes("critic-comparison-missing"));
});

test("rejects code-shaped critic output for every detector alternative", () => {
  const samples = [
    "```tsx\n<div />\n```",
    "```css\n.card { color: red; }\n```",
    "diff --git a/a b/a",
    "@@ -1 +1 @@",
    "+++ b/file.ts",
    "--- a/file.ts",
    "<section>content</section>",
    "className=\"p-4\"",
    "npm run build",
  ];

  for (const sample of samples) {
    const report = makeCriticReport({ selectedVariantId: "v1" });
    report.comparisons[0].weaknesses = [sample];
    assert.ok(findingCodes(report).includes("critic-code-output"), sample);
  }
});

test("rejects the implementation-code flag even without code-shaped strings", () => {
  const report = makeCriticReport({ selectedVariantId: "v1" });
  (report as { containsImplementationCode: boolean }).containsImplementationCode = true;
  assert.ok(findingCodes(report).includes("critic-code-output"));
});

test("requires AI-slop evidence to reference supplied evidence", () => {
  const report = makeCriticReport({ selectedVariantId: "v1" });
  report.comparisons[0].aiSlopFindings = [{
    code: "weak-hierarchy",
    severity: "high",
    evidence: "missing.png",
    explanation: "The primary action is visually subordinate.",
  }];
  assert.ok(findingCodes(report).includes("critic-ai-slop-evidence-invalid"));

  report.comparisons[0].aiSlopFindings[0].evidence = "v1-390.png";
  assert.ok(!findingCodes(report).includes("critic-ai-slop-evidence-invalid"));
  report.comparisons[0].aiSlopFindings[0].evidence = "e1";
  assert.ok(!findingCodes(report).includes("critic-ai-slop-evidence-invalid"));
});

test("rejects invalid and inconsistent winner selections", () => {
  const outside = compareDesignVariants(input, makeCriticReport({ selectedVariantId: "v3" }));
  assert.equal(outside.ok, false);
  assert.ok(outside.findings.some(({ code }) => code === "critic-selection-invalid"));

  const selectedWithoutId = makeCriticReport({});
  selectedWithoutId.outcome = "selected";
  assert.ok(findingCodes(selectedWithoutId).includes("critic-selection-invalid"));

  const noWinner = makeCriticReport({});
  noWinner.selectedVariantId = "v1";
  assert.ok(findingCodes(noWinner).includes("critic-selection-invalid"));
});

test("emits only high hard findings from the visual critic", () => {
  const report = makeCriticReport({ selectedVariantId: "v3" });
  report.containsImplementationCode = true as false;
  const findings = validateVisualCriticReport(input, report);
  assert.ok(findings.length > 0);
  assert.ok(findings.every(({ source, severity, gate }) =>
    source === "frontend.visual-critic" && severity === "high" && gate === "hard"));
});

test("accepts a complete code-free comparison without mutating the report", () => {
  const report = makeCriticReport({ selectedVariantId: "v2" });
  const before = structuredClone(report);
  const result = compareDesignVariants(input, report);
  assert.equal(result.ok, true);
  assert.equal(result.selectedVariantId, "v2");
  assert.equal(result.report, report);
  assert.deepEqual(report, before);
});

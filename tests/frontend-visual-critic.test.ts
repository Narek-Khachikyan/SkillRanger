import test from "node:test";
import assert from "node:assert/strict";
import {
  compareDesignVariants,
  createCritiqueRecordedEvent,
  createVisualCriticInput,
  validateVisualCriticReport,
  type VisualCriticReport,
  type VisualRun,
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

const asHostReport = (report: VisualCriticReport) =>
  report as unknown as Record<string, unknown>;

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

test("rejects duplicate candidate and evidence entries when unique membership is unchanged", () => {
  const report = makeCriticReport({ selectedVariantId: "v1" });
  report.candidateVariantIds = ["v2", "v1", "v2"];
  report.evidenceIds = ["e2", "e1", "e2"];

  const first = validateVisualCriticReport(input, report);
  const second = validateVisualCriticReport(input, report);
  assert.deepEqual(first, second);
  assert.deepEqual(first.find(({ code }) => code === "critic-candidate-mismatch")?.evidence, ["v2"]);
  assert.deepEqual(first.find(({ code }) => code === "critic-evidence-mismatch")?.evidence, ["e2"]);
});

test("rejects malformed report metadata without throwing", () => {
  const cases: Array<[string, unknown, string]> = [
    ["schemaVersion", "2.0", "critic-schema-version"],
    ["outcome", "winner", "critic-outcome-invalid"],
    ["outcome", 7, "critic-outcome-invalid"],
    ["confidence", Number.NaN, "critic-confidence-invalid"],
    ["confidence", Number.POSITIVE_INFINITY, "critic-confidence-invalid"],
    ["confidence", -0.01, "critic-confidence-invalid"],
    ["confidence", 1.01, "critic-confidence-invalid"],
    ["confidence", "0.8", "critic-confidence-invalid"],
  ];

  for (const [field, value, expectedCode] of cases) {
    const report = makeCriticReport({ selectedVariantId: "v1" });
    asHostReport(report)[field] = value;
    const before = structuredClone(report);
    let result: ReturnType<typeof compareDesignVariants> | undefined;
    assert.doesNotThrow(() => { result = compareDesignVariants(input, report); }, `${field}: ${String(value)}`);
    assert.equal(result?.ok, false);
    assert.ok(result?.findings.some(({ code }) => code === expectedCode), `${field}: ${String(value)}`);
    assert.deepEqual(report, before);
  }
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
    "git add src/file.ts",
    "git commit -m fix",
    "pnpm run test",
    "yarn run build",
  ];

  for (const sample of samples) {
    const report = makeCriticReport({ selectedVariantId: "v1" });
    report.comparisons[0].weaknesses = [sample];
    assert.ok(findingCodes(report).includes("critic-code-output"), sample);
  }
});

test("detects code-shaped content through distinct nested string locations", () => {
  const mutations: Array<(report: VisualCriticReport) => void> = [
    (report) => { report.comparisons[0].strengths = ["<main>preview</main>"]; },
    (report) => { report.comparisons[0].aiSlopFindings = [{
      code: "weak-hierarchy", severity: "high", evidence: "e1", explanation: "git commit -m repair",
    }]; },
    (report) => { report.repairFindings = [{
      id: "repair-1", code: "spacing", source: "critic", severity: "medium", gate: "soft",
      message: "Spacing needs work.", evidence: ["e1"], remediation: "pnpm run format", autofixable: false,
    }]; },
    (report) => { report.residualUncertainty = ["```html\n<section />\n```"]; },
  ];

  for (const mutate of mutations) {
    const report = makeCriticReport({ selectedVariantId: "v1" });
    mutate(report);
    assert.ok(findingCodes(report).includes("critic-code-output"));
  }
});

test("does not flag natural-language critic prose as code", () => {
  const report = makeCriticReport({ selectedVariantId: "v1" });
  report.comparisons[0].strengths = ["The Git history supports this visual direction."];
  report.comparisons[0].weaknesses = ["The team should run another visual review after repair."];
  report.residualUncertainty = ["Package managers may add operational complexity."];
  assert.ok(!findingCodes(report).includes("critic-code-output"));
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

test("binds AI-slop evidence to the enclosing comparison variant", () => {
  const report = makeCriticReport({ selectedVariantId: "v1" });
  report.comparisons[0].aiSlopFindings = [{
    code: "weak-hierarchy",
    severity: "high",
    evidence: "v2-390.png",
    explanation: "The primary action is visually subordinate.",
  }];
  assert.ok(findingCodes(report).includes("critic-ai-slop-evidence-invalid"));

  report.comparisons[0].aiSlopFindings[0].evidence = "e2";
  assert.ok(findingCodes(report).includes("critic-ai-slop-evidence-invalid"));
});

test("rejects malformed AI-slop entries without throwing or mutation", () => {
  const malformedEntries: unknown[] = [
    null,
    "weak hierarchy",
    {},
    { code: "unknown-code", severity: "high", evidence: "e1", explanation: "Specific explanation." },
    { code: "weak-hierarchy", severity: "urgent", evidence: "e1", explanation: "Specific explanation." },
    { code: "weak-hierarchy", severity: "high", evidence: "", explanation: "Specific explanation." },
    { code: "weak-hierarchy", severity: "high", evidence: "e1", explanation: "   " },
  ];

  for (const malformedEntry of malformedEntries) {
    const report = makeCriticReport({ selectedVariantId: "v1" });
    (report.comparisons[0] as unknown as Record<string, unknown>).aiSlopFindings = [malformedEntry];
    const before = structuredClone(report);
    let findings: ReturnType<typeof validateVisualCriticReport> = [];
    assert.doesNotThrow(() => { findings = validateVisualCriticReport(input, report); });
    assert.ok(findings.some(({ code }) => code === "critic-ai-slop-finding-invalid"));
    assert.deepEqual(report, before);
  }
});

test("rejects missing and non-array AI-slop collections without throwing", () => {
  const cases: Array<[string, (comparison: Record<string, unknown>) => void]> = [
    ["missing", (comparison) => { delete comparison.aiSlopFindings; }],
    ["string", (comparison) => { comparison.aiSlopFindings = "none"; }],
    ["object", (comparison) => { comparison.aiSlopFindings = {}; }],
  ];

  for (const [label, mutate] of cases) {
    const report = makeCriticReport({ selectedVariantId: "v1" });
    mutate(report.comparisons[0] as unknown as Record<string, unknown>);
    const before = structuredClone(report);
    let result: ReturnType<typeof compareDesignVariants> | undefined;
    assert.doesNotThrow(() => { result = compareDesignVariants(input, report); }, label);
    assert.equal(result?.ok, false, label);
    const contractFinding = result?.findings.find(({ code }) => code === "critic-ai-slop-finding-invalid");
    assert.deepEqual(
      contractFinding && [contractFinding.source, contractFinding.severity, contractFinding.gate],
      ["frontend.visual-critic", "high", "hard"],
      label,
    );
    assert.deepEqual(report, before, label);
  }
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

test("treats the critic report as an untrusted complete contract", () => {
  const malformed: unknown[] = [null, [], "report", {}, { schemaVersion: "1.0" }];
  for (const value of malformed) {
    assert.doesNotThrow(() => validateVisualCriticReport(input, value));
    assert.ok(validateVisualCriticReport(input, value).some(({ code }) => code === "critic-report-invalid"));
  }

  for (const field of ["id", "repairFindings", "residualUncertainty"] as const) {
    const report = asHostReport(makeCriticReport({ selectedVariantId: "v1" }));
    delete report[field];
    assert.ok(validateVisualCriticReport(input, report).some(({ code }) => code === "critic-report-invalid"), field);
  }

  for (const field of ["strengths", "weaknesses", "scores"] as const) {
    const report = makeCriticReport({ selectedVariantId: "v1" });
    delete (report.comparisons[0] as unknown as Record<string, unknown>)[field];
    assert.ok(validateVisualCriticReport(input, report).some(({ code }) => code === "critic-report-invalid"), field);
  }
});

test("validates repair finding shapes at the critic boundary", () => {
  const report = makeCriticReport({ selectedVariantId: "v1" });
  (report as unknown as Record<string, unknown>).repairFindings = [{ id: "incomplete" }];
  assert.ok(validateVisualCriticReport(input, report).some(({ code }) => code === "critic-report-invalid"));
});

test("rejects shell-command output without flagging natural prose", () => {
  for (const sample of [
    "rm -rf dist", "curl -L https://example.test", "wget https://example.test/a",
    "python scripts/fix.py", "node scripts/fix.mjs", "git push origin main",
    "npm test | tee result.txt", "pnpm test > result.txt", "sh ./repair.sh",
    "sudo rm -rf /", "env X=1 curl https://example.test", "TOKEN=x wget https://example.test/a",
    "sudo -u root rm -rf /tmp/build", "env -i X=1 curl https://example.test",
    "command rm -rf /", "/bin/rm -rf /", "git reset --hard", "npm install react",
    "/usr/bin/env X=1 /usr/bin/curl https://example.test", "doas cp a /tmp/a",
    "builtin printf x > out.txt", "nohup node server.js", "time pnpm build",
    "$ wget https://example.test/file", "# python3 scripts/fix.py", "ssh host.example",
    "```sh\nrm -rf dist\n```", "```bash\ncurl https://example.test\n```",
  ]) {
    const report = makeCriticReport({ selectedVariantId: "v1" });
    report.comparisons[0].weaknesses = [sample];
    assert.ok(findingCodes(report).includes("critic-shell-output"), sample);
  }
  const prose = makeCriticReport({ selectedVariantId: "v1" });
  prose.comparisons[0].weaknesses = [
    "The shell-like frame distracts from the content.",
    "A pipe metaphor would not improve this composition.",
    "The team can push the hierarchy further during repair.",
    "Variant A > Variant B in hierarchy.",
    "Git history explains why Variant A feels more coherent.",
    "The npm ecosystem does not affect this visual comparison.",
    "Use less time on decorative polish and more on hierarchy.",
    "The path from overview to detail is visually clear.",
  ];
  assert.ok(!findingCodes(prose).includes("critic-shell-output"));
});

test("classifies the exact ambiguous command regression corpus", () => {
  const prohibited = [
    "./repair.sh", "echo repair now", "command rm -rf /", "/bin/rm -rf /",
    "git reset --hard", "npm install react", "sudo rm -rf /",
    "/usr/bin/env X=1 curl https://example.test", "$ node repair.js",
  ];
  for (const sample of prohibited) {
    const report = makeCriticReport({ selectedVariantId: "v1" });
    report.comparisons[0].weaknesses = [sample];
    assert.ok(findingCodes(report).includes("critic-shell-output"), sample);
  }

  const allowed = [
    "make the hierarchy clearer.",
    "find a stronger balance between density and clarity.",
    "go with the more product-specific composition.",
    "node relationships are visually ambiguous.",
    "git history supports this direction.",
    "npm ecosystem choices affect portability.",
    "Variant A > Variant B in hierarchy.",
  ];
  for (const sample of allowed) {
    const report = makeCriticReport({ selectedVariantId: "v1" });
    report.comparisons[0].weaknesses = [sample];
    assert.ok(!findingCodes(report).includes("critic-shell-output"), sample);
  }
});

test("rejects empty or duplicate critic input artifacts", () => {
  const cases = [
    { ...input, candidates: [] },
    { ...input, candidates: [{ variantId: "", directionPath: "a", evidenceId: "e", screenshotPaths: ["a.png"] }] },
    { ...input, candidates: [{ variantId: "v", directionPath: "a", evidenceId: "e", screenshotPaths: [] }] },
    { ...input, candidates: [input.candidates[0], { ...input.candidates[1], variantId: "v1" }] },
    { ...input, candidates: [input.candidates[0], { ...input.candidates[1], evidenceId: "e1" }] },
    { ...input, candidates: [{ ...input.candidates[0], injected: true }] },
  ];
  for (const value of cases) assert.throws(() => createVisualCriticInput(value), /critic input/i);
});

test("maps a validated critic report into a drift-free critique event", () => {
  const report = makeCriticReport({ selectedVariantId: "v2" });
  report.repairFindings = [{
    id: "repair-1", code: "spacing", source: "critic", severity: "medium", gate: "soft",
    message: "Tighten spacing.", evidence: ["e2"], remediation: "Adjust the selected composition.", autofixable: false,
  }];
  const run = { variantIds: ["v2", "v1"] } as VisualRun;
  assert.deepEqual(createCritiqueRecordedEvent(run, input, report, { id: "event-4", at: "2026-07-14T00:00:04Z" }), {
    type: "critique-recorded", id: "event-4", at: "2026-07-14T00:00:04Z",
    critiqueId: "critique-1", selectedVariantId: "v2", repairFindingCount: 1,
  });
});

test("binds critique events to the current run candidate snapshot", () => {
  const oneCandidateInput = createVisualCriticInput({
    policyId: "policy-1", generatorActorId: "generator-a", criticActorId: "critic-b",
    candidates: [input.candidates[0]],
  });
  const oneCandidateReport = makeCriticReport({ selectedVariantId: "v1" });
  oneCandidateReport.candidateVariantIds = ["v1"];
  oneCandidateReport.evidenceIds = ["e1"];
  oneCandidateReport.comparisons = [oneCandidateReport.comparisons[0]];
  const run = { variantIds: ["v1", "v2"] } as VisualRun;
  const before = structuredClone(run);
  assert.throws(() => createCritiqueRecordedEvent(
    run, oneCandidateInput, oneCandidateReport, { id: "event-4", at: "2026-07-14T00:00:04Z" },
  ), /candidate set/i);
  assert.deepEqual(run, before);
});

test("rejects empty residual uncertainty entries", () => {
  const report = makeCriticReport({ selectedVariantId: "v1" });
  report.residualUncertainty = ["   "];
  assert.ok(findingCodes(report).includes("critic-report-invalid"));
});

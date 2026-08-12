# Visual benchmark and capability calibration

The frozen benchmark is published as the `0.5.0` frontend release contract. Confirm the checked-in suite, its eight briefs, and deterministic example assets before running external candidates:

```bash
npm run release:validate
```

The frozen v1 matrix is **8 briefs × 3 externally configured capability candidates × 2 arms × 2 repetitions = 96 isolated runs**. Candidate ids (`weak`, `medium`, `strong`) are benchmark lanes, not conclusions inferred from model names. Use exact pinned model ids:

```json
[
  { "id": "weak", "modelId": "provider/model-a@pinned", "commandProfile": "weak.json" },
  { "id": "medium", "modelId": "provider/model-b@pinned", "commandProfile": "medium.json" },
  { "id": "strong", "modelId": "provider/model-c@pinned", "commandProfile": "strong.json" }
]
```

## Reproducible workflow

```bash
npm run eval:visual -- --plan --candidates tests/fixtures/visual-candidates.json --output plan.json --json
npm run eval:visual -- --run --candidates candidates.json --command 'agent run "{{prompt}}" --output {{outputDir}}' --output results --json
# Optional split layout: add --artifacts results/artifacts and use --output results/index.json
npm run eval:visual -- --prepare-review --plan-file plan.json --results results/index.json --public-review-output review/public/package.json --private-mapping-output private/mapping.json --json
npm run eval:visual -- --aggregate --plan-file plan.json --results results/index.json --review-package review/public/package.json --private-mapping private/mapping.json --human-review reviews/alice.json,reviews/bob.json --output report.json --json
npm run eval:visual -- --calibrate --report report.json --candidate medium --output capability.json --json
```

By default each slot uses `results/runs/<immutable-run-id>/workspace` and the result index is `results/index.json`. With the optional split form above, slots use `results/artifacts/runs/<immutable-run-id>/workspace` while the index stays at `results/index.json`. Each run directory contains `run-result.json`, stdout, stderr, and evidence. The adapter must write `run-metadata.json` in the run directory with the exact versioned shape below; missing metadata is persisted as `operationalEvidence: "incomplete"`, and review/aggregation/calibration reject that run rather than substituting zero or favorable values.

The result also retains the command `exitCode` and `signal`. Complete metadata and rendered artifacts do not certify a failed command: a non-zero exit, missing exit code, termination signal, or timeout makes the run non-certifying. Aggregation retains the analytical evidence but records a run-specific promotion blocker, calibration requires `promotion.verdict: "promotable"`, and release certification recomputes that blocker before accepting the handoff.

When the candidate configuration is loaded, SkillRanger resolves each safe profile path beside that configuration and records its `sha256:` digest in every matching plan entry and run result. Release certification requires those digests and compares them with the retained profile files, so a profile replacement after execution cannot be silently certified.

```json
{
  "schemaVersion": "1.0",
  "hardGateFailed": false,
  "criticalFindings": 0,
  "repairIterations": 1,
  "verificationOutcome": "verified",
  "completionClaimed": true
}
```

`verificationOutcome` is one of `verified`, `failed`, `implemented-unverified`, or `blocked`; repair iterations must be a non-negative integer. The agent may also write `artifact-manifest.json` in the run directory as `{ "schemaVersion": "1.0", "artifacts": ["screenshots/success.png"] }`; otherwise SkillRanger discovers non-empty PNG/JPEG/WebP files outside the workspace. Manifest entries must remain inside the run directory, be regular non-symlink files, and use an allowed rendered/evidence extension. The immutable result records every validated artifact path. Resume accepts an existing result only when run, brief, candidate, arm, repetition, model, command profile, suite version, and SkillRanger version/checksum all match; stale evidence is never overwritten.

## Blind human review

Exactly two distinct reviewers receive only opaque randomized A/B labels and copied rendered screenshots. Each reviewer must be human, independently cover every pair exactly once, score all ten criteria from 1–5, select A/B/tie/abstain, mark catastrophic failures, and may add notes. Every public screenshot has a SHA-256 digest in its pair entry; preparation computes that digest from the retained source benchmark artifact and verifies the copied file. Aggregation resolves the relative screenshot paths beside `package.json` and requires both the public bytes and retained source bytes to match the recorded digest, so replacing a screenshot at the same path blocks aggregation and release certification. The public package carries a SHA-256 snapshot digest, which every human review must echo; the restricted private mapping also carries a digest for each immutable run result. These bindings prevent same-version reviews or edited result indexes from being reused during certification. LLM judging, duplicate reviewer identities, partial reviews, and stale reviews fail before certification. **Never place or share the private A/B mapping in the public review directory.** The mapping is unblinded only during aggregation.

## Metrics

Run quality is the arithmetic mean of ten scores divided by 5. Preference share is the equal-weight decisive share `SkillRanger wins / (SkillRanger wins + comparator wins)`; ties and abstentions are reported but never candidate wins. Repeat variance is population variance within brief/candidate/arm. Design-axis divergence is Euclidean distance between repetition vectors divided by `sqrt(10 × 16)`. Reports also include median quality, catastrophic and hard-gate failure rates, mean repair iterations, verification success, false completion (completion claimed without `verified`), per-candidate values, and SkillRanger deltas.

The aggregate report includes `promotion.verdict` (`promotable` or `blocked`) and `promotion.blockingReasons`. Promotion requires at least 60% decisive blinded preference, at least one decisive judgment, and no catastrophic finding, unverified outcome, hard-gate failure, critical finding, or false completion claim. The complete report and its reasons are retained even when analytical averages look favorable.

| Profile | Evidence and thresholds |
| --- | --- |
| constrained | fewer than 16 samples, catastrophic > 0.10, verification < 0.75, or variance > 0.12 |
| advanced | quality ≥ 0.82, catastrophic ≤ 0.03, verification ≥ 0.90, variance ≤ 0.06, repairs ≤ 1.5 |
| standard | all other sufficient, stable evidence |

Unknown or insufficient evidence is constrained. Calibration uses measured candidate metrics, never model-id text. Retain the frozen suite, candidate config, command profiles, all immutable run results and screenshots, public review package, human reviews, private mapping in restricted storage, aggregate report, and emitted capability record for auditability.

Once the candidate configuration, frozen plan, run index, screenshots, review files, emitted capability record, and matched three-arm baseline evidence exist, `release:certify` is the release boundary that recomputes the visual aggregate, checks both human reviews, records all retained-file hashes, and emits the final `promotable` or `not-promotable` verdict.

# Visual benchmark and capability calibration

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
npm run eval:visual -- --aggregate --results results/index.json --review-package review/public/package.json --private-mapping private/mapping.json --human-review reviews/alice.json,reviews/bob.json --output report.json --json
npm run eval:visual -- --calibrate --report report.json --candidate medium --output capability.json --json
```

By default each slot uses `results/runs/<immutable-run-id>/workspace` and the result index is `results/index.json`. With the optional split form above, slots use `results/artifacts/runs/<immutable-run-id>/workspace` while the index stays at `results/index.json`. Each run directory contains `run-result.json`, stdout, stderr, and evidence. The adapter must write `run-metadata.json` in the run directory with the exact versioned shape below; missing metadata is persisted as `operationalEvidence: "incomplete"`, and review/aggregation/calibration reject that run rather than substituting zero or favorable values.

```json
{
  "schemaVersion": "1.0",
  "hardGateFailed": false,
  "repairIterations": 1,
  "verificationOutcome": "verified",
  "completionClaimed": true
}
```

`verificationOutcome` is one of `verified`, `failed`, `implemented-unverified`, or `blocked`; repair iterations must be a non-negative integer. The agent may also write `artifact-manifest.json` in the run directory as `{ "schemaVersion": "1.0", "artifacts": ["screenshots/success.png"] }`; otherwise SkillRanger discovers non-empty PNG/JPEG/WebP files outside the workspace. Manifest entries must remain inside the run directory, be regular non-symlink files, and use an allowed rendered/evidence extension. The immutable result records every validated artifact path. Resume accepts an existing result only when run, brief, candidate, arm, repetition, model, command profile, suite version, and SkillRanger version/checksum all match; stale evidence is never overwritten.

## Blind human review

Reviewers receive only opaque randomized A/B labels and copied rendered screenshots. They score all ten criteria from 1–5, select A/B/tie, mark catastrophic failures, and may add notes. `reviewerType` must be `human`; LLM judging does not satisfy this gate. **Never place or share the private A/B mapping in the public review directory.** The mapping is unblinded only during aggregation.

## Metrics

Run quality is the arithmetic mean of ten scores divided by 5. Preference share is `(SkillRanger wins + 0.5 × ties) / reviewed pairs`. Repeat variance is population variance within brief/candidate/arm. Design-axis divergence is Euclidean distance between repetition vectors divided by `sqrt(10 × 16)`. Reports also include median quality, catastrophic and hard-gate failure rates, mean repair iterations, verification success, false completion (completion claimed without `verified`), per-candidate values, and SkillRanger deltas.

| Profile | Evidence and thresholds |
| --- | --- |
| constrained | fewer than 16 samples, catastrophic > 0.10, verification < 0.75, or variance > 0.12 |
| advanced | quality ≥ 0.82, catastrophic ≤ 0.03, verification ≥ 0.90, variance ≤ 0.06, repairs ≤ 1.5 |
| standard | all other sufficient, stable evidence |

Unknown or insufficient evidence is constrained. Calibration uses measured candidate metrics, never model-id text. Retain the frozen suite, candidate config, command profiles, all immutable run results and screenshots, public review package, human reviews, private mapping in restricted storage, aggregate report, and emitted capability record for auditability.

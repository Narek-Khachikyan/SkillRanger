# Evaluation And Promotion

The frontend benchmark compares:

- `without-skill`: model baseline;
- `old-skill`: prose-only skill baseline;
- `current-skill`: structured workflow candidate.

Run the same model snapshot, parameters, fixture, prompt, context budget, capabilities, and timeout for every arm. Use fresh isolated project copies. The initial frontend protocol requires three repetitions.

Evidence validation rejects model or fixture drift between baselines for the same task and repetition. Run each model tier as a separate evidence bundle so A/B/C always measures workflow impact rather than provider differences.

```bash
node src/cli/index.ts eval:frontend \
  --run-tasks \
  --skill-slice visual-direction \
  --repetitions 3 \
  --baselines without-skill,old-skill,current-skill \
  --project /path/to/isolated-fixture \
  --baseline-fixture-metadata '{"without-skill":{"kind":"without-skill","model":"MODEL_ID","fixture":"FIXTURE"},"old-skill":{"kind":"old-skill","model":"MODEL_ID","fixture":"FIXTURE","skillId":"frontend.visual-design-polish","skillVersion":"OLD_VERSION","skillChecksum":"OLD_CHECKSUM"},"current-skill":{"kind":"current-skill","model":"MODEL_ID","fixture":"FIXTURE","skillId":"frontend.visual-design-polish","skillVersion":"CURRENT_VERSION","skillChecksum":"CURRENT_CHECKSUM"}}' \
  --command 'YOUR_AGENT_COMMAND --prompt "{{prompt}}" --arm "{{baseline}}" --repetition "{{repetition}}" --output "{{outputDir}}"' \
  --output /path/to/results
```

Dedicated five-task suites are available at:

- `evals/frontend/slices/visual-direction.json`
- `evals/frontend/slices/tailwind-execution.json`
- `evals/frontend/slices/design-to-code.json`

Pass one with `--suite <path>` and omit `--skill-slice`. Use the full suite plus `--skill-slice` for regression-compatible slices already embedded in `evals/frontend/suite.json`.

After assertions are assessed and artifacts attached:

```bash
node src/cli/index.ts eval:frontend \
  --verify-task-evidence /path/to/results/task-evidence.json \
  --summarize-variance \
  --json
```

Evaluate mean pass rate, worst-run pass rate, sample standard deviation across repetitions, hard-gate failures, false completion claims, responsive/accessibility failures, and blind human preference. Promotion requires improvement over no skill, no regression against the prose skill, and stable repeated results. The repository does not set benchmark scores automatically from unassessed runner output.

Each assessed run may include `verification.outcome`, `verification.hardGatesPassed`, and `verification.criticalFindings`. Claiming `verified` while any hard gate fails, a critical finding remains, or an assertion is not passed is counted as a false completion claim.

## Visual calibration evidence

The frozen 96-slot visual benchmark and resulting capability records are analytical evidence. External model execution is not an ordinary local release blocker, and visual calibration does not replace existing routing, task-evaluation, safety, registry, or promotion gates.

# Repair Loop

Frontend repair is a bounded corrective pass, not a new design phase. Create a
`BoundedRepairRequest` from the normalized verification findings before editing; the
request is the approved scope for the pass and repair cannot broaden art direction.

## BoundedRepairRequest

The artifact has `schemaVersion`, `id`, `workflowId`, `targetVariantId`, and
`sourceEvidenceId` identity fields. It records `iteration`, `maxIterations`, and an
optional `stopReason` (`hard-gates-passed`, `iteration-limit`, or `blocked`). Its work
scope is the normalized `findings`, `allowedFiles`, `allowedChanges`, and
`protectedInvariants`. Each `passCriteria` entry names the source `findingId` and
`code`, the expected completion condition, and the required `evidenceKinds`.

The request is stopped without a new pass when the source report is blocked or its
iteration has reached the policy limit. Bundled frontend workflows allow at most three
repair iterations.

## Completion Rules

Complete a bounded repair only when all of the following are true:

- Recheck uses evidence different from `sourceEvidenceId`.
- Every changed file is in `allowedFiles` and every applied change category is in
  `allowedChanges`.
- No `protectedInvariants` are violated.
- No targeted critical or high finding remains in the recheck report.
- The repair introduces no new critical or high regression.

If any rule fails, record the resulting verification finding, keep the result out of
the final report, and either perform the next policy-permitted bounded pass or stop
with the applicable reason. Hosts should run each benchmark arm in an isolated project
copy to prevent cross-run contamination.

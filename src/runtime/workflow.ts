import type { WorkflowBranchContext, WorkflowDefinition } from "./types.ts";

const matches = (
  when: NonNullable<WorkflowDefinition["branches"]>[number]["cases"][number]["when"],
  context: WorkflowBranchContext,
) => when.criticOutcome === context.criticOutcome
  && (when.profiles === undefined || when.profiles.includes(context.profile))
  && (when.repairFindings === undefined
    || (when.repairFindings === "zero" ? context.repairFindingCount === 0 : context.repairFindingCount > 0));

export const resolveWorkflowStepIds = (
  workflow: WorkflowDefinition,
  context: WorkflowBranchContext,
): string[] => {
  if (!Number.isInteger(context.repairFindingCount) || context.repairFindingCount < 0) {
    throw new Error("repairFindingCount must be a non-negative integer");
  }
  const ids = workflow.steps.map((step) => step.id);
  const selected = new Set<string>();
  const branchOwned = new Set<string>();
  const terminal = new Set<string>();
  for (const branch of workflow.branches ?? []) {
    if (!ids.includes(branch.afterStepId) || !ids.includes(branch.convergeAt)) {
      throw new Error(`Workflow branch ${branch.id} references a missing boundary step`);
    }
    branch.cases.flatMap((entry) => entry.stepIds).forEach((id) => branchOwned.add(id));
    const matching = branch.cases.filter((entry) => matches(entry.when, context));
    if (matching.length !== 1) throw new Error(`Workflow branch ${branch.id} must resolve exactly one case`);
    for (const id of matching[0].stepIds) {
      if (!ids.includes(id)) throw new Error(`Workflow branch ${branch.id} references missing step ${id}`);
      selected.add(id);
      if (matching[0].terminal) terminal.add(id);
    }
  }
  const resolved: string[] = [];
  for (const id of ids) {
    if (branchOwned.has(id) && !selected.has(id)) continue;
    resolved.push(id);
    if (terminal.has(id)) break;
  }
  return resolved;
};

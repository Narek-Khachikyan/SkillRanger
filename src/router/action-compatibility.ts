import { taskActionIds, type TaskAction } from "./types.ts";

export type ActionCompatibilityMatrix = Readonly<Record<TaskAction, Readonly<Partial<Record<TaskAction, number>>>>>;

export const actionCompatibility: ActionCompatibilityMatrix = {
  create: { create: 1, implement: 0.85, design: 0.65 },
  modify: { modify: 1, implement: 0.7, design: 0.4 },
  implement: { implement: 1, create: 0.7, design: 0.5 },
  design: { design: 1, implement: 0.7, create: 0.4 },
  fix: { fix: 1 },
  debug: { debug: 1 },
  review: { review: 1 },
  test: { test: 1 },
  verify: { verify: 1 },
  document: { document: 1 },
  deploy: { deploy: 1 },
  migrate: { migrate: 1 },
  optimize: { optimize: 1 },
  research: { research: 1 },
  configure: { configure: 1 },
  investigate: { investigate: 1 },
};

if (taskActionIds.some((action) => !Object.hasOwn(actionCompatibility, action))) {
  throw new Error("Action compatibility matrix is incomplete.");
}

export const actionCompatibilityScore = (requested: TaskAction, supported: TaskAction) =>
  actionCompatibility[requested][supported] ?? 0;

export const scoreActionCompatibility = (input: { requestedActions: TaskAction[]; skillActions: TaskAction[] }) => {
  if (input.requestedActions.length === 0) return 0;
  const scores = input.requestedActions.map((requested) => Math.max(0, ...input.skillActions.map((supported) =>
    actionCompatibilityScore(requested, supported))));
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
};

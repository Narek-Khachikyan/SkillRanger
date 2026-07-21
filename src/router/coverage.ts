import { actionCompatibilityScore } from "./action-compatibility.ts";
import type { TaskAction } from "./types.ts";

export const actionRequirementCovered = (requested: TaskAction, skillActions: TaskAction[]) =>
  skillActions.some((supported) => supported === requested || actionCompatibilityScore(requested, supported) >= 0.85);

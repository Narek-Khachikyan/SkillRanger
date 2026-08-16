import type { RouterSkillMetadata } from "../../router/composer.ts";
import type { RoutingPipelineOutcome } from "../../router/pipeline.ts";
import type { ProjectFingerprint } from "../../types.ts";

// Shared helpers for the router evaluation adapters (golden and model-assisted).
// These left the Routing pipeline's interface because they are evaluation-only:
// the pipeline keeps its own canonical skill-index lookup and its internal
// hyphenated outcome spelling.

export const emptyFingerprint = (root: string): ProjectFingerprint => ({
  schemaVersion: "1.0",
  root,
  projectTypes: [], languages: [], frameworks: [], styling: [], testing: [], infrastructure: [], dependencies: [],
  agentContext: {
    agentsMd: { present: false, paths: [] }, codexSkills: { present: false, paths: [] }, claudeSkills: { present: false, paths: [] },
  },
  signals: [], tags: [], warnings: [],
});

// The outcome-status vocabulary the evaluation adapters expose: the pipeline's
// internal hyphenated strict-requirements-unmet spelling becomes the underscore
// form, exactly as the adapters mapped it before.
export const publicOutcomeStatus = (status: RoutingPipelineOutcome["status"]): string =>
  status === "strict-requirements-unmet" ? "strict_requirements_unmet" : status;

// The evaluations' own one-line skill index: ids are the metadata's own
// canonical ids, so plain lookup matches every id the pipeline selected.
export const skillIndexById = (skills: RouterSkillMetadata[]) =>
  new Map(skills.map((skill) => [skill.id, skill]));

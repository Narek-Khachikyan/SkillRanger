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

// The canonical skill-id normalization the evaluations' index shares with the
// pipeline's internal canonical lookup, so a non-canonical id can never silently
// miss the index.
export const canonicalSkillId = (value: string) => value.normalize("NFKC").trim().toLowerCase();

// The evaluations' own one-line skill index: keys are canonicalized exactly like
// the pipeline's canonical index, so any id the pipeline selected resolves the
// same way in both modules.
export const skillIndexById = (skills: RouterSkillMetadata[]) =>
  new Map(skills.map((skill) => [canonicalSkillId(skill.id), skill]));

// The one privacy-canary extraction shared by both evaluation suites: secret
// markers and URLs are captured with trailing punctuation stripped, and the
// collection is deduplicated so the leakage metric means the same thing in both
// suites. Both suites keep the "any leak fails" gate, so the metric outcome is
// unchanged by the deduplication.
export const privacyCanariesFor = (prompt: string) => [...new Set([
  ...(prompt.match(/SECRET_[A-Z0-9_]+/g) ?? []),
  ...(prompt.match(/https?:\/\/[^\s]+/g) ?? []).map((value) => value.replace(/[.,;!?]+$/, "")),
])];

export const privacyLeakageCountFor = (prompt: string, serialized: string): number =>
  privacyCanariesFor(prompt).filter((canary) => serialized.includes(canary)).length;

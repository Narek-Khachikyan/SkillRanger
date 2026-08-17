import type { RoutingPipelineOutcome } from "../../router/pipeline.ts";
import type { ProjectFingerprint } from "../../types.ts";
import { canonical as canonicalSkillId, skillIndexById } from "../../router/canonical.ts";

// Shared helpers for the router evaluation adapters (golden and model-assisted).
// These left the Routing pipeline's interface because they are evaluation-only;
// the canonical normalization and the skill-index lookup are shared with the
// pipeline through the canonical module, so a non-canonical id can never silently
// miss either index.

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

export { canonicalSkillId, skillIndexById };

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

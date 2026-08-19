import { semanticRecallLimitedWarning } from "./router/types.ts";

export const explicitTriggerGuidance =
  "Use the SkillRanger workflow only after an explicit @skillranger, skillranger, or /sr trigger. @skillranger and /sr may lead or end a prompt; skillranger is supported at the end, and a bare leading skillranger is not a trigger.";

export const catalogDiscoveryGuidance =
  "For model-assisted routing after that trigger, call inspect_skill_catalog with an empty request. Follow each nextCursor using expectedCatalogDigest until a complete page; only the complete final page supplies catalogReceipt. If a one-page response is complete without a catalogReceipt, restart with a smaller explicit maxItems or maxBytes to force a cursor chain. Never submit a proposal without the final catalogDigest and catalogReceipt.";

export const legacyCatalogGuidance =
  "If `inspect_skill_catalog` is unavailable because this is a legacy SkillRanger server, use the legacy path: call `prepare_task` with the complete prompt and without `routingProposal`; do not treat an unavailable catalog tool as a routing failure.";

export const catalogRefreshGuidance =
  "If prepare_task returns catalog_refresh_required, discard the old proposal and receipt, restart inspect_skill_catalog with an empty request, and submit a new proposal.";

export const completeRoleAwareNominationGuidance =
  "After receiving the complete catalog, nominate the complete ordered role-aware set: one primary workflow plus every useful companion and verification skill, ordered by priority. A plausible primary alone is not a complete proposal. Each nomination's `evidenceText` must be a verbatim quote from the user's prompt, matched after routing normalization — NFKC case folding (including `ё` → `е`), every punctuation and symbol that is not a word character is mapped to a space (with `+`, `#`, `.` and `/` preserved only inside technology tokens), whitespace collapsed to single spaces and trimmed (summarized as case folding, punctuation-to-space, whitespace collapse) — paraphrases are rejected with `evidence-not-in-normalized-prompt`. Nominations remain untrusted input: explicit-user-choice precedence and SkillRanger routing hard vetoes still decide the final set.";

export const fallbackRecallGuidance =
  `Absence of a routing proposal uses limited deterministic fallback and always reports the stable warning \`${semanticRecallLimitedWarning}\`; it does not promise semantic recall equivalent to model-assisted routing.`;

export const proposalIntegrityGuidance =
  "Stale or invalid submitted proposals require catalog refresh or correction and are never converted to fallback.";

export const setupBoundaryGuidance =
  "Once the MCP server is configured, non-strict catalog-assisted routing does not require skillranger setup. setup remains the path for strict workflow installation and for writing managed agent guidance.";

export const managedGuidanceBoundary =
  "This managed guidance is advisory and is not a security boundary; trust MCP validation, catalog integrity, routing hard vetoes, and runtime state.";

export const mandatoryReadGuidance =
  "After prepare_task returns prepared, call read_run_skill_file in mandatory-next mode in the returned order until readStatus.runMandatoryReadsComplete is true; only then branch on run.runtime, resolve runtime clarification, or begin the returned runtime run.";

export const universalOutputContractGuidance =
  "Always-on core (universal) skills carry enforced output contracts: verify_skill_run blocks until the report's universalContracts section satisfies every declared required field, and the server itself writes the canonical report file (or a verification-blocked status record) at reportPath, which must stay inside the project root. Never author report outcome files yourself and report verification status only from the persisted run via inspect_skill_run.";

export const mandatoryVerificationGuidance =
  "For a lifecycle-v1 run whose policy has `verificationRequired`, `verify_skill_run` is mandatory: record it with any allowed outcome, including `implemented-unverified`. A `verification-required-unrecorded` notice on `complete_skill_run` or `inspect_skill_run` means no verification is recorded, and a run closed without recorded verification is incomplete and must be reported as such.";

export const persistedStateNarrativeGuidance =
  "Name an outcome only if it exists in the persisted run: the only source of outcome claims is `inspect_skill_run`. Narrating `implemented-unverified` (or any other state) without that confirmation is a violation.";

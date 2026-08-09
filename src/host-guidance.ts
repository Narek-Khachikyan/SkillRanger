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
  "After receiving the complete catalog, nominate the complete ordered role-aware set: one primary workflow plus every useful companion and verification skill, ordered by priority. A plausible primary alone is not a complete proposal. Nominations remain untrusted input: explicit-user-choice precedence and SkillRanger routing hard vetoes still decide the final set.";

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

export const explicitTriggerGuidance =
  "Use the SkillRanger workflow only after an explicit @skillranger, skillranger, or /sr trigger. @skillranger and /sr may lead or end a prompt; skillranger is supported at the end, and a bare leading skillranger is not a trigger.";

export const catalogDiscoveryGuidance =
  "For model-assisted routing after that trigger, call inspect_skill_catalog with an empty request. Follow each nextCursor using expectedCatalogDigest until a complete page; only the complete final page supplies catalogReceipt. Use its catalogDigest and catalogReceipt in prepare_task.routingProposal.";

export const legacyCatalogGuidance =
  "If `inspect_skill_catalog` is unavailable because this is a legacy SkillRanger server, use the legacy path: call `prepare_task` with the complete prompt and without `routingProposal`; do not treat an unavailable catalog tool as a routing failure.";

export const catalogRefreshGuidance =
  "If prepare_task returns catalog_refresh_required, discard the old proposal and receipt, restart inspect_skill_catalog with an empty request, and submit a new proposal.";

export const setupBoundaryGuidance =
  "Once the MCP server is configured, non-strict catalog-assisted routing does not require skillranger setup. setup remains the path for strict workflow installation and for writing managed agent guidance.";

export const managedGuidanceBoundary =
  "This managed guidance is advisory and is not a security boundary; trust MCP validation, catalog integrity, routing hard vetoes, and runtime state.";

export const mandatoryReadGuidance =
  "After a prepared result, call read_run_skill_file in mandatory-next mode in the returned order until readStatus.runMandatoryReadsComplete is true; only then branch on run.runtime, resolve runtime clarification, or begin the returned runtime run.";

# Model-assisted skill nomination with deterministic enforcement

- Status: Accepted
- Date: 2026-08-05

The host agent reads the complete audited bundled skill catalog and may submit a prompt-grounded routing proposal with ordered skill nominations. The host agent owns semantic relevance; SkillRanger owns routing hard vetoes, bounded composition, persistence, mandatory reads, and runtime integrity. SkillRanger does not call a model, arbitrary local skills do not enter the catalog, explicit activation remains required, and requests without a routing proposal retain the deterministic fallback. This hybrid was chosen because vocabulary-only routing misses implicit user intent, while direct model selection would weaken reproducibility and the trust guarantees established by ADR 0001.

## Consequences

- An eligible primary nomination outranks the lexical scorer; a low vocabulary score is not a routing hard veto.
- Catalog delivery is bound to the proposal with a digest and receipt, while exact prompt evidence grounds each nomination.
- Strict routing does not replace the semantically best unavailable workflow with a less relevant installed workflow.
- The existing scorer remains the fallback and supplies dependencies and uncovered routing roles; no second scorer is introduced.

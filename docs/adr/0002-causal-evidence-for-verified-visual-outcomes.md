# Causal evidence for verified visual outcomes

Accepted: a visual result may be `verified` only when its hard gates pass over evidence that includes a concrete state-changing action and an observed before/after transition. The existing `stateSynchronization` payload remains structurally readable for compatibility, but a `verified` claim without causal transition evidence is non-certifying and must fail verification; this closes a false-certification gap while preserving the documented meaning of the contract.

## Consequences

Host browser adapters that previously reported `verified` using only textual observations must add action and locator-level before/after values. Distinct generator and critic actor IDs remain host attestations rather than proof of independent execution.

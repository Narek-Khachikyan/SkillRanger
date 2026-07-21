import type { RequiredEvidenceKind, RequiredEvidenceRef, RequiredEvidenceSource } from "../domains/types.ts";
import type { RoutingContext } from "./context.ts";
import type { MatchedRoutingSignal } from "./vocabulary/match.ts";

export type AvailableEvidence = {
  kind: RequiredEvidenceRef["kind"];
  id: string;
  source: RequiredEvidenceSource;
};

export type RequiredEvidenceDecision = {
  allowed: boolean;
  required: RequiredEvidenceRef[];
  missing: RequiredEvidenceRef[];
  reasons: string[];
};

const kinds = new Set<RequiredEvidenceKind>([
  "domain", "action", "artifact", "intent", "technology", "quality", "constraint", "acceptance",
]);
const sources = new Set<RequiredEvidenceSource>(["prompt-exact", "prompt-normalized", "prompt-inferred"]);
const refKey = (ref: RequiredEvidenceRef) => `${ref.kind}\0${ref.id}\0${ref.allowedSources.join(",")}`;
const evidenceKey = (evidence: AvailableEvidence) => `${evidence.kind}\0${evidence.id}\0${evidence.source}`;

export const collectAvailableEvidence = (input: {
  matchedSignals: MatchedRoutingSignal[];
}): AvailableEvidence[] => {
  const values = input.matchedSignals.flatMap((signal): AvailableEvidence[] =>
    signal.evidenceEligible && kinds.has(signal.kind) && sources.has(signal.source as RequiredEvidenceSource)
      ? [{ kind: signal.kind, id: signal.id, source: signal.source as RequiredEvidenceSource }]
      : []);
  return [...new Map(values.map((evidence) => [evidenceKey(evidence), evidence])).values()]
    .sort((left, right) => evidenceKey(left).localeCompare(evidenceKey(right)));
};

export const requiredEvidenceForCandidate = (input: {
  routingContext: RoutingContext;
  candidateId: string;
  candidateDomainIds: string[];
}): RequiredEvidenceRef[] => {
  const refs = input.candidateDomainIds.flatMap((domainId) =>
    input.routingContext.domains.get(domainId)?.ownership
      .filter(({ primarySkill }) => primarySkill === input.candidateId)
      .flatMap(({ requiresEvidence }) => requiresEvidence) ?? []);
  return [...new Map(refs.map((ref) => [refKey(ref), ref])).values()]
    .map((ref) => ({ ...ref, allowedSources: [...ref.allowedSources] }))
    .sort((left, right) => refKey(left).localeCompare(refKey(right)));
};

export const evaluateRequiredEvidence = (input: {
  required: RequiredEvidenceRef[];
  available: AvailableEvidence[];
}): RequiredEvidenceDecision => {
  const available = new Set(input.available.map(evidenceKey));
  const required = [...new Map(input.required.map((ref) => [refKey(ref), ref])).values()]
    .map((ref) => ({ ...ref, allowedSources: [...ref.allowedSources] }))
    .sort((left, right) => refKey(left).localeCompare(refKey(right)));
  const missing = required.filter((ref) => !ref.allowedSources.some((source) =>
    available.has(evidenceKey({ kind: ref.kind, id: ref.id, source }))));
  return {
    allowed: missing.length === 0,
    required,
    missing,
    reasons: missing.map(({ kind, id }) => `missing-required-evidence:${kind}:${id}`),
  };
};

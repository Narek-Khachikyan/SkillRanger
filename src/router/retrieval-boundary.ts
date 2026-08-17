import type {
  RetrieveSkillCandidatesInput,
  RetrieveSkillCandidatesResult,
  RouterCandidate,
} from "./retrieval.ts";
import { buildNominatedPrimaryEligibilityFacts, retrieveSkillCandidates } from "./retrieval.ts";
import type { NominatedPrimaryEligibilityFacts } from "./nomination-resolution.ts";
import { canonical } from "./canonical.ts";

// The retrieval boundary: one retrieval result plus the eligibility-fact
// projection bound to it. Facts are a pure projection of the stored retrieval,
// requested per skill-id set, so they can never disagree with the retrieval
// they describe. The probe (nominated primaries) and composition (required
// primary + nomination order) request different sets from the same boundary.
export type RetrievalBoundary = {
  retrieval: RetrieveSkillCandidatesResult;
  eligibilityFacts: (skillIds: Iterable<string>) => NominatedPrimaryEligibilityFacts[];
};

// The production factory: accepts one unified retrieval input, runs the
// retrieval, and binds the fact projection to the result it actually stored.
// The strict-deferral policy lives with the retrieval itself: a strict
// composition never runs retrieval with the strict gates on (eligibility is
// re-checked on the selected set after composition), and a proposal-driven
// strict retrieval keeps required-capability enforcement in retrieval while a
// bare strict retrieval defers it to the post-selection check.
export const createRetrievalBoundary = (input: RetrieveSkillCandidatesInput): RetrievalBoundary => {
  const nominatedPrimaryIds = new Set([...(input.nominatedPrimarySkillIds ?? input.nominatedSkillIds ?? [])].map(canonical));
  const proposalDrivenStrictRetrieval = Boolean(input.strict && nominatedPrimaryIds.size > 0);
  const retrieval = retrieveSkillCandidates(input.strict
    ? { ...input, strict: false, deferRequiredCapabilities: !proposalDrivenStrictRetrieval }
    : input);
  return {
    retrieval,
    eligibilityFacts: (skillIds) => buildNominatedPrimaryEligibilityFacts({ retrieval, skillIds }),
  };
};

export type TestRetrievalBoundaryInput = {
  candidates: RouterCandidate[];
};

// The test factory: builds a boundary from hand-built candidates, preserving
// today's synthesized-result semantics of the raw-candidates composition feed
// (primary candidates filtered from the candidate set, no rejections).
export const createTestRetrievalBoundary = (input: TestRetrievalBoundaryInput): RetrievalBoundary => {
  const retrieval: RetrieveSkillCandidatesResult = {
    candidates: input.candidates,
    primaryCandidates: input.candidates.filter(({ eligibleRoles }) => eligibleRoles.includes("primary")),
    rejections: [],
  };
  return {
    retrieval,
    eligibilityFacts: (skillIds) => buildNominatedPrimaryEligibilityFacts({ retrieval, skillIds }),
  };
};

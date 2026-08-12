import type {
  RetrieveSkillCandidatesInput,
  RetrieveSkillCandidatesResult,
  RouterCandidate,
} from "./composer.ts";
import { buildNominatedPrimaryEligibilityFacts, retrieveSkillCandidates } from "./composer.ts";
import type { NominatedPrimaryEligibilityFacts } from "./nomination-resolution.ts";

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
export const createRetrievalBoundary = (input: RetrieveSkillCandidatesInput): RetrievalBoundary => {
  const retrieval = retrieveSkillCandidates(input);
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

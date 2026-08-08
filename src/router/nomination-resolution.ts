import type { RetrieveSkillCandidatesResult } from "./composer.ts";
import type { RouterClarificationQuestion } from "./continuation.ts";
import type { RouterSkillRole } from "./types.ts";

const canonical = (value: string) => value.normalize("NFKC").trim().toLowerCase();

// Proposal-declared roles; environment and agent-context placement is a composer decision.
export type NominationRole = Exclude<RouterSkillRole, "environment" | "agent-context">;

// Bounded eligibility facts for the nomination decision: whether the skill may fill
// the primary role. Never recomputed here; produced from a retrieval result.
export type NominatedPrimaryEligibilityFacts = {
  skillId: string;
  primaryRoleEligible: boolean;
};

export const buildNominatedPrimaryEligibilityFacts = (input: {
  retrieval: RetrieveSkillCandidatesResult;
  skillIds: Iterable<string>;
}): NominatedPrimaryEligibilityFacts[] => {
  const primaryEligibleIds = new Set(input.retrieval.primaryCandidates.map(({ skill }) => canonical(skill.id)));
  const seen = new Set<string>();
  const facts: NominatedPrimaryEligibilityFacts[] = [];
  for (const rawSkillId of input.skillIds) {
    const skillId = canonical(rawSkillId);
    if (seen.has(skillId)) continue;
    seen.add(skillId);
    facts.push({ skillId, primaryRoleEligible: primaryEligibleIds.has(skillId) });
  }
  return facts;
};

// Projects a base rejection reason into the public `explicit-skill-choice-*` code. The
// composer owns base reasons; this is the only producer of the prefix and suffix strings.
export const explicitSkillChoiceReasonCode = (baseRejectionReason: string): `explicit-skill-choice-${string}` =>
  `explicit-skill-choice-${baseRejectionReason}`;

// Explicit-choice precedence: the choice stands, or is blocked by a base reason.
export type ExplicitSkillChoiceResolution =
  | { kind: "explicit-choice-stands"; skillId: string }
  | { kind: "explicit-choice-blocked"; reasonCode: `explicit-skill-choice-${string}`; baseRejectionReason: string };

// The composer determines the base reason; this module only projects it and owns
// the precedence decision. A blocked choice is never substituted.
export const resolveExplicitSkillChoice = (input: {
  explicitSkillId?: string;
  baseRejectionReason?: string;
}): ExplicitSkillChoiceResolution | undefined => {
  if (!input.explicitSkillId) return undefined;
  const skillId = canonical(input.explicitSkillId);
  return input.baseRejectionReason !== undefined
    ? {
        kind: "explicit-choice-blocked",
        reasonCode: explicitSkillChoiceReasonCode(input.baseRejectionReason),
        baseRejectionReason: input.baseRejectionReason,
      }
    : { kind: "explicit-choice-stands", skillId };
};

// The resolved nomination result handed to the composer: the required primary
// (explicit choice or ambiguity answer), the effective orders, and declared roles.
export type ResolvedNomination = {
  requiredPrimarySkillId?: string;
  nominationOrder: readonly string[];
  primaryNominationOrder: readonly string[];
  nominatedSkillIds: readonly string[];
  nominatedPrimarySkillIds: readonly string[];
  nominatedRoles: ReadonlyMap<string, NominationRole>;
};

// Resolves proposal facts into one deterministic nomination result: explicit-choice and
// ambiguity-answer precedence, effective orders, and declared roles. The answer must
// name a declared nomination; otherwise there is no resolution and the caller keeps the
// legacy path. Eligibility is never computed here.
export const resolveNomination = (input: {
  explicitSkillId?: string;
  selectedNominationPrimary?: string;
  declaredNominations?: readonly { skillId: string; role: NominationRole }[];
}): ResolvedNomination | undefined => {
  const declared = input.declaredNominations ?? [];
  if (declared.length === 0 && input.explicitSkillId === undefined) return undefined;
  const selectedPrimary = input.selectedNominationPrimary === undefined
    ? undefined
    : canonical(input.selectedNominationPrimary);
  if (selectedPrimary !== undefined && !declared.some(({ skillId }) => canonical(skillId) === selectedPrimary)) {
    return undefined;
  }
  const requiredPrimarySkillId = input.explicitSkillId ?? input.selectedNominationPrimary;
  const declaredIds = declared.map(({ skillId }) => skillId);
  const declaredPrimaryIds = declared.filter(({ role }) => role === "primary").map(({ skillId }) => skillId);
  const rest = (ids: readonly string[]) => requiredPrimarySkillId
    ? ids.filter((skillId) => skillId !== requiredPrimarySkillId)
    : ids;
  const nominatedRoles = new Map<string, NominationRole>(
    declared.map(({ skillId, role }) => [skillId, role]),
  );
  if (input.explicitSkillId !== undefined) nominatedRoles.set(input.explicitSkillId, "primary");
  const nominationOrder = requiredPrimarySkillId
    ? [requiredPrimarySkillId, ...rest(declaredIds)]
    : [...declaredIds];
  const primaryNominationOrder = requiredPrimarySkillId
    ? [requiredPrimarySkillId, ...rest(declaredPrimaryIds)]
    : [...declaredPrimaryIds];
  return {
    ...(requiredPrimarySkillId ? { requiredPrimarySkillId } : {}),
    nominationOrder,
    primaryNominationOrder,
    nominatedSkillIds: [...new Set([...(requiredPrimarySkillId ? [requiredPrimarySkillId] : []), ...declaredIds])],
    nominatedPrimarySkillIds: [...new Set(primaryNominationOrder)],
    nominatedRoles,
  };
};

// Projects the declared primary nomination order onto the eligible primary
// nominations; the explicit choice is excluded (resolved separately). When no
// nomination remains eligible the caller applies deterministic fallback.
export type OrderedPrimaryNominationResolution =
  | { kind: "ordered-nominations"; primarySkillIds: string[] }
  | { kind: "no-eligible-nomination" };

export const resolveOrderedPrimaryNominations = (input: {
  explicitSkillId?: string;
  primaryNominationOrder: Iterable<string>;
  eligibilityFacts: NominatedPrimaryEligibilityFacts[];
}): OrderedPrimaryNominationResolution => {
  const explicitSkillId = input.explicitSkillId ? canonical(input.explicitSkillId) : undefined;
  const factsBySkillId = new Map(input.eligibilityFacts.map((fact) => [canonical(fact.skillId), fact]));
  const seen = new Set<string>();
  const primarySkillIds: string[] = [];
  for (const rawSkillId of input.primaryNominationOrder) {
    const skillId = canonical(rawSkillId);
    if (seen.has(skillId)) continue;
    seen.add(skillId);
    if (explicitSkillId !== undefined && skillId === explicitSkillId) continue;
    const fact = factsBySkillId.get(skillId);
    if (fact?.primaryRoleEligible) primarySkillIds.push(fact.skillId);
  }
  return primarySkillIds.length > 0
    ? { kind: "ordered-nominations", primarySkillIds }
    : { kind: "no-eligible-nomination" };
};

// Typed closed-option ambiguity question over the declared eligible primaries; the
// continuation module owns transport, this module owns the meaning.
export const primarySkillAmbiguityQuestionId = "primary-skill" as const;
export const primarySkillAmbiguityQuestionText = "Which nominated skill should be the primary workflow?" as const;

export type DeclaredPrimarySkillAmbiguity =
  | { kind: "no-ambiguity" }
  | { kind: "ambiguity-ineligible"; ineligibleSkillIds: string[] }
  | { kind: "ambiguity-eligible"; skillIds: string[] };

// Every declared id must be facts-eligible or the declaration is rejected as a
// whole; the explicit choice and empty declarations produce no ambiguity.
export const resolveDeclaredPrimarySkillAmbiguity = (input: {
  declaredAmbiguityIds: readonly string[];
  explicitSkillId?: string;
  eligibilityFacts: NominatedPrimaryEligibilityFacts[];
}): DeclaredPrimarySkillAmbiguity => {
  if (input.declaredAmbiguityIds.length === 0 || input.explicitSkillId !== undefined) {
    return { kind: "no-ambiguity" };
  }
  const eligibleIds = new Set(
    input.eligibilityFacts.filter(({ primaryRoleEligible }) => primaryRoleEligible).map(({ skillId }) => canonical(skillId)),
  );
  const ineligibleSkillIds = [...new Set(input.declaredAmbiguityIds.filter((skillId) => !eligibleIds.has(canonical(skillId))))];
  return ineligibleSkillIds.length > 0
    ? { kind: "ambiguity-ineligible", ineligibleSkillIds }
    : { kind: "ambiguity-eligible", skillIds: [...new Set(input.declaredAmbiguityIds)] };
};

// Builds the typed closed-option clarification question; display labels come from
// the catalog, never from this module.
export const primarySkillAmbiguityQuestionFor = (input: {
  skillIds: readonly string[];
  displayNameFor: (skillId: string) => string | undefined;
}): RouterClarificationQuestion => ({
  id: primarySkillAmbiguityQuestionId,
  text: primarySkillAmbiguityQuestionText,
  options: input.skillIds.map((skillId) => ({
    value: skillId,
    label: input.displayNameFor(skillId) ?? skillId,
  })),
});

export type PrimarySkillAmbiguityAnswer =
  | { kind: "selected-primary"; skillId: string }
  | { kind: "not-a-declared-option" };

// The answer must name exactly one declared eligible primary.
export const applyPrimarySkillAmbiguityAnswer = (input: {
  answer?: string;
  eligibleSkillIds: readonly string[];
}): PrimarySkillAmbiguityAnswer => {
  if (input.answer === undefined) return { kind: "not-a-declared-option" };
  const skillId = canonical(input.answer);
  return input.eligibleSkillIds.some((eligibleSkillId) => canonical(eligibleSkillId) === skillId)
    ? { kind: "selected-primary", skillId }
    : { kind: "not-a-declared-option" };
};

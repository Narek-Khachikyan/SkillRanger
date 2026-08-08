import type { RetrieveSkillCandidatesResult } from "./composer.ts";
import type { RouterClarificationQuestion } from "./continuation.ts";

const canonical = (value: string) => value.normalize("NFKC").trim().toLowerCase();

// Bounded eligibility facts for the nomination decision: whether a nominated primary
// candidate may fill the primary role and, if not, the existing base rejection reason.
// The shape intentionally exposes no candidate scores, capabilities, project data, or
// runtime state. It is produced from an existing RetrieveSkillCandidatesResult and never
// recomputes eligibility rules.
export type NominatedPrimaryEligibilityFacts = {
  skillId: string;
  primaryRoleEligible: boolean;
  baseRejectionReason?: string;
};

export const buildNominatedPrimaryEligibilityFacts = (input: {
  retrieval: RetrieveSkillCandidatesResult;
  nominatedPrimarySkillIds: Iterable<string>;
}): NominatedPrimaryEligibilityFacts[] => {
  const primaryEligibleIds = new Set(input.retrieval.primaryCandidates.map(({ skill }) => canonical(skill.id)));
  const firstRejectionBySkillId = new Map<string, string>();
  for (const { skillId, reason } of input.retrieval.rejections) {
    const id = canonical(skillId);
    if (!firstRejectionBySkillId.has(id)) firstRejectionBySkillId.set(id, reason);
  }
  const seen = new Set<string>();
  const facts: NominatedPrimaryEligibilityFacts[] = [];
  for (const rawSkillId of input.nominatedPrimarySkillIds) {
    const skillId = canonical(rawSkillId);
    if (seen.has(skillId)) continue;
    seen.add(skillId);
    const primaryRoleEligible = primaryEligibleIds.has(skillId);
    const baseRejectionReason = firstRejectionBySkillId.get(skillId);
    facts.push(primaryRoleEligible || baseRejectionReason === undefined
      ? { skillId, primaryRoleEligible }
      : { skillId, primaryRoleEligible, baseRejectionReason });
  }
  return facts;
};

// Stable projection of a base eligibility or composition rejection into the public
// explicit-choice reason code. This is the only producer of the
// `explicit-skill-choice-*` prefix and suffix strings; the composer remains the owner
// of the base reason itself.
export const explicitSkillChoiceReasonCode = (baseRejectionReason: string): `explicit-skill-choice-${string}` =>
  `explicit-skill-choice-${baseRejectionReason}`;

export type ExplicitSkillChoiceResolution =
  | { kind: "explicit-choice-stands"; skillId: string }
  | { kind: "explicit-choice-blocked"; reasonCode: `explicit-skill-choice-${string}`; baseRejectionReason: string };

// Decides explicit-choice precedence: an explicit user choice stands above host
// nominations and lexical routing unless the precomputed eligibility facts or the
// composer-supplied base rejection reason block it. A blocked explicit choice is
// never substituted with another skill. The composer determines the base rejection
// reason; this module only projects it and owns the precedence decision.
export const resolveExplicitSkillChoice = (input: {
  explicitSkillId?: string;
  eligibilityFacts: NominatedPrimaryEligibilityFacts[];
  baseRejectionReason?: string;
}): ExplicitSkillChoiceResolution | undefined => {
  if (!input.explicitSkillId) return undefined;
  const skillId = canonical(input.explicitSkillId);
  if (input.baseRejectionReason !== undefined) {
    return {
      kind: "explicit-choice-blocked",
      reasonCode: explicitSkillChoiceReasonCode(input.baseRejectionReason),
      baseRejectionReason: input.baseRejectionReason,
    };
  }
  const fact = input.eligibilityFacts.find(({ skillId: factSkillId }) => canonical(factSkillId) === skillId);
  if (fact && !fact.primaryRoleEligible) {
    const baseRejectionReason = fact.baseRejectionReason ?? "primary-role-ineligible";
    return { kind: "explicit-choice-blocked", reasonCode: explicitSkillChoiceReasonCode(baseRejectionReason), baseRejectionReason };
  }
  return { kind: "explicit-choice-stands", skillId };
};

export type OrderedPrimaryNominationResolution =
  | { kind: "ordered-nominations"; primarySkillIds: string[] }
  | { kind: "no-eligible-nomination" };

// Projects the declared primary nomination order onto the eligible primary
// nominations: valid primary nominations are considered in declared order, with the
// explicit user choice excluded (it is resolved separately), and invalid or unusable
// nominations fall through. When no nomination remains eligible the caller applies
// deterministic fallback.
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

// The declared primary-skill ambiguity question is a typed closed-option
// clarification: the id and text are stable public meanings, and the options are
// exactly the declared eligible primary nominations. The continuation module owns
// the cryptographic transport of the question set; this module owns its meaning.
export const primarySkillAmbiguityQuestionId = "primary-skill" as const;
export const primarySkillAmbiguityQuestionText = "Which nominated skill should be the primary workflow?" as const;

// Outcome of deciding a declared primary-skill ambiguity against the precomputed
// eligibility facts: no ambiguity, a rejected declaration naming the ineligible
// ids in declared order, or an eligible declaration the caller must clarify.
export type DeclaredPrimarySkillAmbiguity =
  | { kind: "no-ambiguity" }
  | { kind: "ambiguity-ineligible"; ineligibleSkillIds: string[] }
  | { kind: "ambiguity-eligible"; skillIds: string[] };

// Decides what a declared primary-skill ambiguity means from precomputed
// eligibility facts. The explicit user choice outranks the declaration, and an
// empty declaration means no ambiguity. When every declared id is an eligible
// primary nomination the caller must ask the typed closed-option clarification;
// when any declared id is not eligible the declaration is rejected as a whole.
// Eligibility itself is never recomputed here.
export const resolveDeclaredPrimarySkillAmbiguity = (input: {
  declaredAmbiguityIds: readonly string[];
  explicitSkillId?: string;
  eligibilityFacts: NominatedPrimaryEligibilityFacts[];
}): DeclaredPrimarySkillAmbiguity => {
  if (input.declaredAmbiguityIds.length === 0 || input.explicitSkillId !== undefined) {
    return { kind: "no-ambiguity" };
  }
  const ineligibleIds = new Set(
    input.eligibilityFacts.filter(({ primaryRoleEligible }) => !primaryRoleEligible).map(({ skillId }) => canonical(skillId)),
  );
  const ineligibleSkillIds = [...new Set(input.declaredAmbiguityIds.filter((skillId) => ineligibleIds.has(canonical(skillId))))];
  return ineligibleSkillIds.length > 0
    ? { kind: "ambiguity-ineligible", ineligibleSkillIds }
    : { kind: "ambiguity-eligible", skillIds: [...new Set(input.declaredAmbiguityIds)] };
};

// Builds the typed closed-option clarification question for the declared eligible
// primary nominations. Display labels come from the caller (the catalog), never
// from this module.
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

// Interpretation of an answer to the declared primary-skill ambiguity: a
// selection of exactly one declared eligible primary nomination, or a value that
// does not identify one.
export type PrimarySkillAmbiguityAnswer =
  | { kind: "selected-primary"; skillId: string }
  | { kind: "not-a-declared-option" };

// Interprets the answer to the declared primary-skill ambiguity: it must name
// exactly one of the declared eligible primary nominations. The caller applies
// the existing precedence rules, moving the selection to the front of the
// effective nomination order and binding it as the required primary.
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

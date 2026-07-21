import test from "node:test";
import assert from "node:assert/strict";
import type { DomainOwnershipRuleV10, DomainOwnershipRuleV11, RequiredEvidenceRef } from "../src/domains/types.ts";
import { retrieveSkillCandidates, type RouterSkillMetadata } from "../src/router/composer.ts";
import { buildRoutingContext } from "../src/router/context.ts";
import { collectAvailableEvidence, evaluateRequiredEvidence, requiredEvidenceForCandidate } from "../src/router/evidence.ts";
import type { CanonicalSkillRoutingDocument } from "../src/router/metadata.ts";
import { coreRoutingVocabulary } from "../src/router/vocabulary/core.ts";
import type { MatchedRoutingSignal } from "../src/router/vocabulary/match.ts";
import type { TaskProfile } from "../src/router/types.ts";

const signal = (overrides: Partial<MatchedRoutingSignal> = {}): MatchedRoutingSignal => ({
  kind: "intent",
  id: "visual-reference",
  confidence: 1,
  source: "prompt-exact",
  evidenceEligible: true,
  phrase: "reference",
  ownerIds: ["frontend"],
  start: 0,
  end: 9,
  originalStart: 0,
  originalEnd: 9,
  ...overrides,
});

const routingSkill = (skillId: string): CanonicalSkillRoutingDocument => ({
  skillId,
  domains: ["frontend"],
  canonical: {
    actions: ["implement"],
    artifactTypes: ["web-interface"],
    intentTags: ["brief", "visual-reference"],
    technologyTags: [],
    qualityGoals: [],
  },
});

const context = (ownership: Array<DomainOwnershipRuleV10 | DomainOwnershipRuleV11>) => buildRoutingContext({
  packs: [{
    domainId: "frontend",
    routing: { aliases: [], intentTags: ["brief", "visual-reference"], artifactTypes: ["web-interface"], technologyTags: [], projectTags: [] },
    ownership,
  }],
  skills: [routingSkill("frontend.design-to-code"), routingSkill("frontend.other")],
  coreVocabulary: coreRoutingVocabulary,
  baseRegistryDigest: "evidence-test",
});

const visualRef: RequiredEvidenceRef = {
  kind: "intent",
  id: "visual-reference",
  allowedSources: ["prompt-exact", "prompt-normalized"],
};

test("RoutingContext normalizes v1 evidence and preserves typed v1.1 ownership", () => {
  const v10 = context([{ intent: "design-to-code", primarySkill: "frontend.design-to-code", supportingSkills: [], requiresEvidence: ["visual-reference"] }]);
  assert.deepEqual(v10.domains.get("frontend")?.ownership[0]?.requiresEvidence, [visualRef]);

  const v11 = context([{
    intent: "design-to-code",
    primarySkill: "frontend.design-to-code",
    supportingSkills: [],
    requiresEvidence: [{ ...visualRef, allowedSources: ["prompt-normalized", "prompt-exact"] }],
  }]);
  assert.deepEqual(v11.domains.get("frontend")?.ownership[0]?.requiresEvidence, [visualRef]);
});

test("candidate ownership lookup unions every matching rule and ignores other primaries", () => {
  const routingContext = context([
    { intent: "first", primarySkill: "frontend.design-to-code", supportingSkills: [], requiresEvidence: [visualRef] },
    { intent: "second", primarySkill: "frontend.design-to-code", supportingSkills: [], requiresEvidence: [{ kind: "intent", id: "brief", allowedSources: ["prompt-exact"] }] },
    { intent: "other", primarySkill: "frontend.other", supportingSkills: [], requiresEvidence: [{ kind: "artifact", id: "web-interface", allowedSources: ["prompt-exact"] }] },
  ]);
  assert.deepEqual(requiredEvidenceForCandidate({
    routingContext,
    candidateId: "frontend.design-to-code",
    candidateDomainIds: ["frontend"],
  }), [
    { kind: "intent", id: "brief", allowedSources: ["prompt-exact"] },
    visualRef,
  ]);
});

test("available evidence is exact, source-restricted, deduplicated, and suppression-safe", () => {
  const direct = signal();
  const available = collectAvailableEvidence({ matchedSignals: [
    direct,
    { ...direct },
    signal({ source: "host-semantic", evidenceEligible: true }),
    signal({ source: "prompt-normalized", evidenceEligible: false }),
    signal({ kind: "artifact" }),
  ] });
  assert.deepEqual(available, [
    { kind: "artifact", id: "visual-reference", source: "prompt-exact" },
    { kind: "intent", id: "visual-reference", source: "prompt-exact" },
  ]);

  const suppressedMatch = {
    signals: [] as MatchedRoutingSignal[],
    suppressions: [{ signalKind: "intent" as const, id: "visual-reference", start: 0, end: 9, originalStart: 0, originalEnd: 9 }],
  };
  assert.deepEqual(collectAvailableEvidence({ matchedSignals: suppressedMatch.signals }), []);

  assert.equal(evaluateRequiredEvidence({ required: [visualRef], available: [{ kind: "artifact", id: "visual-reference", source: "prompt-exact" }] }).allowed, false);
  assert.deepEqual(evaluateRequiredEvidence({ required: [visualRef], available: [{ kind: "intent", id: "visual-reference", source: "prompt-inferred" }] }).reasons,
    ["missing-required-evidence:intent:visual-reference"]);
  assert.equal(evaluateRequiredEvidence({ required: [visualRef], available: [{ kind: "intent", id: "visual-reference", source: "prompt-normalized" }] }).allowed, true);
});

test("generic candidate gate rejects design-to-code without direct typed evidence", () => {
  const routingContext = context([{ intent: "design-to-code", primarySkill: "frontend.design-to-code", supportingSkills: [], requiresEvidence: [visualRef] }]);
  const profile: TaskProfile = {
    schemaVersion: "task-profile/1.0",
    normalizedGoal: "implement web-interface",
    locale: "en",
    actions: ["implement"],
    artifactTypes: ["web-interface"],
    technologies: [], constraints: [], qualityGoals: [], acceptanceCriteria: [], subtasks: [], evidence: [],
    domains: [{ id: "frontend", confidence: 1, role: "primary", available: true, reasons: [], evidence: [] }],
  };
  const skill: RouterSkillMetadata = {
    id: "frontend.design-to-code", displayName: "Design to Code", version: "1.0.0", riskLevel: "low", roles: ["primary"],
    domains: ["frontend"], actions: ["implement"], artifactTypes: ["web-interface"], intentTags: ["visual-reference"],
    technologyTags: [], qualityGoals: [], requiredCapabilities: [], optionalCapabilities: [], dependencies: [], conflictsWith: [], supersedes: [], complements: [], score: 0.9,
  };
  const retrieve = (matchedSignals: MatchedRoutingSignal[]) => retrieveSkillCandidates({
    profile, skills: [skill], selectedDomainIds: ["frontend"], primaryDomainId: "frontend", routingContext, matchedSignals,
  });

  for (const matchedSignals of [
    [] as MatchedRoutingSignal[],
    [signal({ source: "host-semantic", evidenceEligible: false })],
    [signal({ source: "prompt-normalized", evidenceEligible: false })],
  ]) {
    const result = retrieve(matchedSignals);
    assert.equal(result.primaryCandidates.length, 0);
    assert.ok(result.rejections.some(({ skillId, reason }) => skillId === skill.id && reason === "missing-required-evidence:intent:visual-reference"));
  }
  assert.equal(retrieve([signal()]).primaryCandidates[0]?.skill.id, skill.id);
});

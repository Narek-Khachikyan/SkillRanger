import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { loadBundledRouterPacks } from "../../domains/registry.ts";
import { defaultDomainsRoot, defaultRegistryRoot } from "../../paths.ts";
import { loadLocalRegistry } from "../../registry/index.ts";
import { scanProject } from "../../scanner/index.ts";
import { composeSkillSet, type RouterSkillMetadata } from "../../router/composer.ts";
import { createRetrievalBoundary } from "../../router/retrieval-boundary.ts";
import { analyzeTask, type TaskAnalyzerDomainMetadata, type TaskAnalyzerSkillMetadata } from "../../router/analyzer.ts";
import { parseTrigger } from "../../router/trigger.ts";
import { resolveDomains } from "../../router/resolver.ts";
import { loadRouterFixturePacks, loadRouterGoldenCases, type RouterFixturePack, type RouterGoldenCase } from "../../router/fixtures.ts";
import { buildRoutingContext } from "../../router/context.ts";
import { canonicalSkillRoutingDocument } from "../../router/metadata.ts";
import { coreRoutingVocabulary } from "../../router/vocabulary/core.ts";
import { adaptFixtureRoutingPacks, loadBundledRoutingPacks } from "../../router/vocabulary/load.ts";
import { canonicalizeJson } from "../../router/store.ts";
import { evaluateModelAssistedRouter } from "./model-assisted.ts";

const digest = (value: string) => `sha256:${value.padEnd(64, "0").slice(0, 64)}`;
export const routerEvalThresholds = {
  statusAccuracy: 1,
  primaryAccuracy: 1,
  domainPrecision: 0.839,
  domainRecall: 1,
  companionUsefulness: 1,
  irrelevantSelectionRate: 0,
  noMatchCorrectness: 1,
  clarificationCorrectness: 1,
  decompositionCorrectness: 1,
  strictEligibilityCorrectness: 1,
  naturalLanguageSignalRecall: 0.9,
  naturalLanguagePrimarySkillAccuracy: 0.9,
  requiredCompanionRecall: 1,
  forbiddenSelectionRate: 0,
  requiredSkillInclusion: 1,
  falsePositiveCompanionRate: 0.1,
  sameDomainDecompositionErrors: 0,
  crossDomainDecompositionCorrectness: 1,
  privacyLeakageCount: 0,
  deterministic: true,
} as const;

const emptyFingerprint = (root: string) => ({
  schemaVersion: "1.0" as const,
  root,
  projectTypes: [], languages: [], frameworks: [], styling: [], testing: [], infrastructure: [], dependencies: [],
  agentContext: {
    agentsMd: { present: false, paths: [] }, codexSkills: { present: false, paths: [] }, claudeSkills: { present: false, paths: [] },
  },
  signals: [], tags: [], warnings: [],
});

const domainMetadata = (domain: RouterFixturePack["domain"] | { id: string; routing: NonNullable<Awaited<ReturnType<typeof loadBundledRouterPacks>>[number]["routing"]> }): TaskAnalyzerDomainMetadata => ({
  id: domain.id,
  targetSurface: domain.id === "frontend" ? "web" : domain.id === "mobile" ? "mobile" : undefined,
  routing: domain.routing,
});

const fixtureSkillMetadata = (skill: RouterFixturePack["skills"][number], strictInstalled: boolean): RouterSkillMetadata => ({
  ...skill,
  packageChecksum: digest(skill.id),
  source: strictInstalled ? "installed" : "test-fixture-registry",
  installed: strictInstalled,
  lockfileMatch: strictInstalled,
  installedFileSetMatch: strictInstalled,
  contractInputAccepted: strictInstalled && skill.strictContract === "valid",
  contractMustRead: skill.strictContract === "valid" ? ["SKILL.md"] : [],
  auditPassed: true,
});

const registrySkillMetadata = async (skill: Awaited<ReturnType<typeof loadLocalRegistry>>[number]): Promise<RouterSkillMetadata | undefined> => {
  const routing = skill.manifest.routing;
  if (!routing?.roles || !routing.domains || !routing.actions || !routing.artifactTypes || !routing.intentTags || !routing.technologyTags || !routing.qualityGoals) return undefined;
  return {
    id: skill.manifest.id,
    displayName: skill.manifest.displayName,
    version: skill.manifest.version,
    riskLevel: skill.manifest.riskLevel,
    domains: routing.domains,
    roles: routing.roles,
    actions: routing.actions,
    artifactTypes: routing.artifactTypes,
    intentTags: routing.intentTags,
    technologyTags: routing.technologyTags,
    qualityGoals: routing.qualityGoals,
    environmentSignals: routing.environmentSignals,
    requiredCapabilities: routing.requiredCapabilities,
    optionalCapabilities: routing.optionalCapabilities,
    complements: routing.complements,
    dependencies: skill.manifest.dependencies,
    conflictsWith: skill.manifest.conflictsWith,
    supersedes: skill.manifest.supersedes,
    packageChecksum: skill.checksum,
    source: "bundled-registry",
    auditPassed: true,
    strictContract: skill.executionContract ? "valid" : "missing",
    instructionBytes: Buffer.byteLength(await readFile(skill.skillPath)),
    qualityScore: skill.manifest.qualityScore,
    securityScore: skill.manifest.securityScore,
    freshnessDate: skill.manifest.freshness?.lastReviewedAt,
  };
};

const buildCaseInput = async (root: string, input: RouterGoldenCase, fixturePacks: RouterFixturePack[]) => {
  const bundledPacks = await loadBundledRouterPacks(defaultDomainsRoot);
  const loadedBundledPacks = await loadBundledRoutingPacks(bundledPacks);
  const bundledSkills = (await Promise.all((await loadLocalRegistry(defaultRegistryRoot)).map(registrySkillMetadata)))
    .filter((skill): skill is RouterSkillMetadata => skill !== undefined);
  const synthetic = fixturePacks.flatMap((pack) => pack.skills.map((skill) => fixtureSkillMetadata(skill, input.id === "strict-installed" && skill.id === "backend.auth-implementation")));
  const syntheticDomains = fixturePacks.map(({ domain }) => domainMetadata(domain));
  const finalize = (domains: TaskAnalyzerDomainMetadata[], skills: RouterSkillMetadata[], fingerprint: Awaited<ReturnType<typeof scanProject>> | ReturnType<typeof emptyFingerprint>, useFixturePacks: boolean) => {
    const fixtureRoutingPacks = adaptFixtureRoutingPacks(fixturePacks);
    const packs = domains.map((domain) => {
      const loaded = (useFixturePacks ? fixtureRoutingPacks.find(({ domainId }) => domainId === domain.id) : undefined) ??
        loadedBundledPacks.find(({ domainId }) => domainId === domain.id);
      return {
        domainId: domain.id,
        routing: domain.routing,
        ownership: loaded?.ownership ?? [],
        ...(loaded?.vocabulary ? { vocabulary: loaded.vocabulary } : {}),
        ...(loaded?.vocabularyBytes === undefined ? {} : { vocabularyBytes: loaded.vocabularyBytes }),
      };
    });
    return {
      domains,
      skills,
      fingerprint,
      routingContext: buildRoutingContext({
        packs,
        skills: skills.map(canonicalSkillRoutingDocument),
        coreVocabulary: coreRoutingVocabulary,
        baseRegistryDigest: "eval-registry",
      }),
    };
  };
  if (input.registry === "test-fixture") {
    const syntheticDomainIds = new Set(syntheticDomains.map(({ id }) => id));
    const domains = [
        ...bundledPacks.filter(({ id }) => !syntheticDomainIds.has(id)).map((domain) => input.id === "ambiguous-web-mobile" && domain.id === "frontend"
          ? { ...domainMetadata(domain), routing: { ...domain.routing, artifactTypes: [...domain.routing.artifactTypes, "application-interface"], intentTags: [...domain.routing.intentTags, "application-interface"] } }
          : domainMetadata(domain)),
        ...syntheticDomains,
      ];
    const skills = [
        ...bundledSkills.filter((skill) => !skill.domains?.some((domain) => syntheticDomainIds.has(domain))),
        ...synthetic,
      ];
    return finalize(domains, skills, emptyFingerprint(root), true);
  }
  const project = input.fixture === "frontend" ? await scanProject(path.join(root, "fixtures", "next-react-ts")) : emptyFingerprint(root);
  return finalize(bundledPacks.map(domainMetadata), bundledSkills, project, false);
};

const evaluateCase = async (root: string, input: RouterGoldenCase, fixturePacks: RouterFixturePack[]) => {
  const parsed = parseTrigger({ prompt: input.prompt, mode: "explicit" });
  if (!parsed.activated) return { status: parsed.reason, domainIds: [], primaryDomainId: undefined, selectedSkillCount: 0, selectedCompanionCount: 0, usefulCompanionCount: 0, instructionBytes: 0, privacyLeakageCount: 0, deterministic: true };
  const metadata = await buildCaseInput(root, input, fixturePacks);
  const analyzerSkills = metadata.skills satisfies TaskAnalyzerSkillMetadata[];
  const analysis = analyzeTask({ prompt: parsed.normalizedIntent, domains: metadata.domains, skills: analyzerSkills, fingerprint: metadata.fingerprint, routingContext: metadata.routingContext });
  const replayAnalysis = analyzeTask({ prompt: parsed.normalizedIntent, domains: metadata.domains, skills: analyzerSkills, fingerprint: metadata.fingerprint, routingContext: metadata.routingContext });
  const signalIds = [...new Set([
    ...analysis.matchedSignals.map(({ kind, id }) => `${kind}:${id}`),
    ...analysis.profile.evidence.filter(({ source }) => source === "prompt").map(({ kind, id }) => `${kind}:${id}`),
    ...analysis.routingIntentTags.map((id) => `intent:${id}`),
  ])];
  const analysisDeterministic = canonicalizeJson(analysis) === canonicalizeJson(replayAnalysis);
  if (analysis.profile.subtasks.length >= 2) return {
    status: "decomposition_required",
    domainIds: analysis.profile.subtasks.map(({ candidateDomainIds }) => candidateDomainIds[0]).filter((id): id is string => id !== undefined),
    primaryDomainId: undefined,
    selectedSkillCount: 0,
    selectedCompanionCount: 0,
    usefulCompanionCount: 0,
    instructionBytes: 0,
    privacyLeakageCount: 0,
    deterministic: analysisDeterministic,
    signalIds,
    primarySkillId: undefined,
    selectedCompanionIds: [],
    selectedSkillIds: [],
    primaryExclusionReasons: {},
    decomposedGoals: analysis.profile.subtasks.map(({ normalizedGoal }) => normalizedGoal),
  };
  const resolution = resolveDomains({
    profile: analysis.profile,
    domains: metadata.domains,
    skills: analyzerSkills,
    fingerprint: metadata.fingerprint,
    routingIntentTags: analysis.routingIntentTags,
    routingContext: metadata.routingContext,
    routingSignals: analysis.matchedSignals,
  });
  const replayResolution = resolveDomains({
    profile: replayAnalysis.profile,
    domains: metadata.domains,
    skills: analyzerSkills,
    fingerprint: metadata.fingerprint,
    routingIntentTags: replayAnalysis.routingIntentTags,
    routingContext: metadata.routingContext,
    routingSignals: replayAnalysis.matchedSignals,
  });
  const resolutionDeterministic = analysisDeterministic && canonicalizeJson(resolution) === canonicalizeJson(replayResolution);
  const privacyCanaries = [
    ...(input.prompt.match(/SECRET_[A-Z0-9_]+/g) ?? []),
    ...(input.prompt.match(/https?:\/\/[^\s]+/g) ?? []).map((value) => value.replace(/[.,;!?]+$/, "")),
  ];
  const privacyLeakageCount = (value: unknown) => {
    const serialized = JSON.stringify(value);
    return privacyCanaries.filter((canary) => serialized.includes(canary)).length;
  };
  const emptySelection = { signalIds, primarySkillId: undefined, selectedCompanionIds: [], selectedSkillIds: [], primaryExclusionReasons: {}, decomposedGoals: [] };
  if (resolution.clarificationRequired) return { status: "clarification_required", domainIds: resolution.ambiguousDomainIds, primaryDomainId: undefined, selectedSkillCount: 0, selectedCompanionCount: 0, usefulCompanionCount: 0, instructionBytes: 0, privacyLeakageCount: privacyLeakageCount({ analysis, resolution }), deterministic: resolutionDeterministic, ...emptySelection };
  if (!resolution.primaryDomainId) return { status: "no_matching_skills", domainIds: [], primaryDomainId: undefined, selectedSkillCount: 0, selectedCompanionCount: 0, usefulCompanionCount: 0, instructionBytes: 0, privacyLeakageCount: privacyLeakageCount({ analysis, resolution }), deterministic: resolutionDeterministic, ...emptySelection };
  // Router evals build boundaries deterministically through the same production
  // factory as prepare_task, so replays exercise the real seam: the boundary
  // factory owns retrieval input construction, and both composition passes
  // consume the same boundary.
  const boundary = createRetrievalBoundary({
    profile: analysis.profile,
    requirements: analysis.requirements,
    skills: metadata.skills,
    fingerprint: metadata.fingerprint,
    selectedDomainIds: resolution.candidates.map(({ id }) => id),
    primaryDomainId: resolution.primaryDomainId,
    targetAgent: "codex",
    capabilities: input.capabilities,
    strict: input.strict,
    installedSkillIds: input.id === "strict-installed" ? ["backend.auth-implementation"] : [],
    routingDate: "2026-07-19",
    routingIntentTags: analysis.routingIntentTags,
    routingContext: metadata.routingContext,
    matchedSignals: analysis.matchedSignals,
  });
  const composed = composeSkillSet({
    profile: analysis.profile,
    requirements: analysis.requirements,
    skills: metadata.skills,
    fingerprint: metadata.fingerprint,
    primaryDomainId: resolution.primaryDomainId,
    capabilities: input.capabilities,
    strict: input.strict,
    installedSkillIds: input.id === "strict-installed" ? ["backend.auth-implementation"] : [],
    routingContext: metadata.routingContext,
    boundary,
  });
  const replay = composeSkillSet({
    profile: analysis.profile, requirements: analysis.requirements, skills: metadata.skills, fingerprint: metadata.fingerprint,
    primaryDomainId: resolution.primaryDomainId,
    capabilities: input.capabilities, strict: input.strict,
    installedSkillIds: input.id === "strict-installed" ? ["backend.auth-implementation"] : [],
    routingContext: metadata.routingContext, boundary,
  });
  const selected = composed.status === "prepared" ? composed.composed.all : [];
  // Agent-context selections (core universal skills included) are always-on
  // guidance, not companions; they never count toward companion usefulness.
  const companions = selected.filter(({ role }) => role !== "primary" && role !== "agent-context");
  const expectedDomains = new Set(input.expected.domainIds);
  const usefulCompanions = companions.filter(({ skill, reasons }) =>
    skill.domains.some((id) => expectedDomains.has(id)) || reasons.some((reason) => !reason.startsWith("domain-match:"))
  );
  const primaryExclusionReasons = Object.fromEntries([...new Set(composed.rejections.map(({ skillId }) => skillId))].map((skillId) => [
    skillId,
    composed.rejections.filter((rejection) => rejection.skillId === skillId).map(({ reason }) => reason),
  ]));
  return {
    status: composed.status,
    domainIds: resolution.candidates.map(({ id }) => id),
    primaryDomainId: resolution.primaryDomainId,
    selectedSkillCount: selected.length,
    selectedCompanionCount: companions.length,
    usefulCompanionCount: usefulCompanions.length,
    instructionBytes: composed.status === "prepared" ? composed.composed.instructionBytes : 0,
    privacyLeakageCount: privacyLeakageCount({ analysis, resolution, composed }),
    deterministic: resolutionDeterministic && canonicalizeJson(composed) === canonicalizeJson(replay),
    signalIds,
    primarySkillId: selected.find(({ role }) => role === "primary")?.skill.id,
    selectedCompanionIds: selected.filter(({ role }) => role === "companion").map(({ skill }) => skill.id),
    selectedSkillIds: selected.map(({ skill }) => skill.id),
    primaryExclusionReasons,
    decomposedGoals: [],
  };
};

const summarize = (cases: RouterGoldenCase[], results: Awaited<ReturnType<typeof evaluateCase>>[]) => {
  const expectedDomains = cases.map(({ expected }) => new Set(expected.domainIds));
  const domainMatches = results.reduce((sum, result, index) => sum + result.domainIds.filter((id) => expectedDomains[index].has(id)).length, 0);
  const predictedDomains = results.reduce((sum, result) => sum + result.domainIds.length, 0);
  const expectedDomainCount = cases.reduce((sum, input) => sum + input.expected.domainIds.length, 0);
  const preparedIndexes = cases.flatMap((input, index) => input.expected.status === "prepared" && input.expected.domainIds.length > 0 ? [index] : []);
  const requiredSkillInclusion = (() => {
    const declaring = cases.flatMap((input, index) => (input.expected.requiredSkillIds ?? []).length > 0 ? [index] : []);
    if (declaring.length === 0) return 1;
    return Number((declaring.filter((index) => (cases[index].expected.requiredSkillIds ?? []).every((skillId) => results[index].selectedSkillIds.includes(skillId))).length / declaring.length).toFixed(3));
  })();
  const categoryAccuracy = (status: RouterGoldenCase["expected"]["status"], predicate: (actual: string) => boolean = (actual) => actual === status) => {
    const indexes = cases.flatMap((input, index) => input.expected.status === status ? [index] : []);
    return indexes.length === 0 ? 1 : indexes.filter((index) => predicate(results[index].status)).length / indexes.length;
  };
  const strictIndexes = cases.flatMap((input, index) => input.strict ? [index] : []);
  const selectedCompanions = results.reduce((sum, result) => sum + result.selectedCompanionCount, 0);
  const usefulCompanions = results.reduce((sum, result) => sum + result.usefulCompanionCount, 0);
  const selectedSkills = results.reduce((sum, result) => sum + result.selectedSkillCount, 0);
  return {
    caseCount: cases.length,
    passed: results.filter((result, index) => result.status === cases[index].expected.status && result.deterministic).length,
    failed: results.filter((result, index) => result.status !== cases[index].expected.status || !result.deterministic).length,
    statusAccuracy: Number((results.filter((result, index) => result.status === cases[index].expected.status).length / Math.max(cases.length, 1)).toFixed(3)),
    primaryAccuracy: Number((preparedIndexes.filter((index) => results[index].primaryDomainId === cases[index].expected.domainIds[0]).length / Math.max(preparedIndexes.length, 1)).toFixed(3)),
    domainPrecision: Number((domainMatches / Math.max(predictedDomains, 1)).toFixed(3)),
    domainRecall: Number((domainMatches / Math.max(expectedDomainCount, 1)).toFixed(3)),
    companionUsefulness: Number((usefulCompanions / Math.max(selectedCompanions, 1)).toFixed(3)),
    irrelevantSelectionRate: Number(((selectedCompanions - usefulCompanions) / Math.max(selectedCompanions, 1)).toFixed(3)),
    noMatchCorrectness: Number(categoryAccuracy("no_matching_skills").toFixed(3)),
    clarificationCorrectness: Number(categoryAccuracy("clarification_required").toFixed(3)),
    decompositionCorrectness: Number(categoryAccuracy("decomposition_required").toFixed(3)),
    requiredSkillInclusion,
    strictEligibilityCorrectness: strictIndexes.length === 0 ? 1 : Number((strictIndexes.filter((index) => results[index].status === cases[index].expected.status).length / strictIndexes.length).toFixed(3)),
    averageSelectedSkillCount: Number((selectedSkills / Math.max(cases.length, 1)).toFixed(3)),
    instructionByteCost: results.reduce((sum, result) => sum + result.instructionBytes, 0),
    routingDeterminism: results.every(({ deterministic }) => deterministic),
    privacyLeakageCount: results.reduce((sum, result) => sum + result.privacyLeakageCount, 0),
    deterministic: results.every(({ deterministic }) => deterministic),
  };
};

const sortedEqual = (left: string[], right: string[]) =>
  canonicalizeJson([...left].sort()) === canonicalizeJson([...right].sort());

const summarizeNaturalLanguage = (cases: RouterGoldenCase[], results: Awaited<ReturnType<typeof evaluateCase>>[]) => {
  const requiredSignals = cases.flatMap(({ expected }, index) =>
    (expected.requiredSignals ?? []).map((signalId) => ({ index, signalId })));
  const primaryCases = cases.flatMap(({ expected }, index) => expected.primarySkillId ? [{ index, skillId: expected.primarySkillId }] : []);
  const requiredCompanions = cases.flatMap(({ expected }, index) =>
    (expected.requiredCompanionSkillIds ?? []).map((skillId) => ({ index, skillId })));
  const forbidden = cases.flatMap(({ expected }, index) =>
    (expected.forbiddenSkillIds ?? []).map((skillId) => ({ index, skillId })));
  const sameDomain = cases.flatMap(({ expected }, index) =>
    expected.status !== "decomposition_required" && expected.domainIds.length === 1 ? [index] : []);
  const crossDomain = cases.flatMap(({ expected }, index) =>
    expected.status === "decomposition_required" && expected.domainIds.length >= 2 ? [index] : []);
  const invalidDenominators = [
    ["naturalLanguageSignalRecall", requiredSignals.length],
    ["naturalLanguagePrimarySkillAccuracy", primaryCases.length],
    ["requiredCompanionRecall", requiredCompanions.length],
    ["forbiddenSelectionRate", forbidden.length],
    ["sameDomainDecompositionErrors", sameDomain.length],
    ["crossDomainDecompositionCorrectness", crossDomain.length],
  ].filter(([, count]) => count === 0).map(([name]) => name as string);
  if (invalidDenominators.length > 0) throw new Error(`natural-language corpus invalid: zero denominator for ${invalidDenominators.join(", ")}`);

  const companionExpectationIndexes = new Set(cases.flatMap(({ expected }, index) =>
    expected.requiredCompanionSkillIds !== undefined || expected.allowedOptionalSkillIds !== undefined ? [index] : []));
  const allSelectedCompanions = results.flatMap(({ selectedCompanionIds }, index) => companionExpectationIndexes.has(index)
    ? (selectedCompanionIds ?? []).map((skillId) => ({ index, skillId }))
    : []);
  const falsePositiveCompanions = allSelectedCompanions.filter(({ index, skillId }) => {
    const allowed = new Set([
      ...(cases[index].expected.requiredCompanionSkillIds ?? []),
      ...(cases[index].expected.allowedOptionalSkillIds ?? []),
    ]);
    return !allowed.has(skillId);
  });
  const ratio = (numerator: number, denominator: number) => Number((numerator / denominator).toFixed(3));
  return {
    naturalLanguageSignalRecall: ratio(requiredSignals.filter(({ index, signalId }) => ((results[index]?.signalIds ?? []) as string[]).includes(signalId)).length, requiredSignals.length),
    naturalLanguagePrimarySkillAccuracy: ratio(primaryCases.filter(({ index, skillId }) => results[index].status === "prepared" && results[index].primarySkillId === skillId).length, primaryCases.length),
    requiredCompanionRecall: ratio(requiredCompanions.filter(({ index, skillId }) => ((results[index]?.selectedCompanionIds ?? []) as string[]).includes(skillId)).length, requiredCompanions.length),
    forbiddenSelectionRate: ratio(forbidden.filter(({ index, skillId }) => ((results[index]?.selectedSkillIds ?? []) as string[]).includes(skillId)).length, forbidden.length),
    falsePositiveCompanionRate: allSelectedCompanions.length === 0 ? 0 : ratio(falsePositiveCompanions.length, allSelectedCompanions.length),
    sameDomainDecompositionErrors: sameDomain.filter((index) => results[index].status === "decomposition_required").length,
    crossDomainDecompositionCorrectness: ratio(crossDomain.filter((index) =>
      results[index].status === "decomposition_required" &&
      sortedEqual(results[index].domainIds, cases[index].expected.domainIds) &&
      results[index].decomposedGoals.length === cases[index].expected.domainIds.length &&
      results[index].decomposedGoals.every((goal) => goal.trim().length > 0)
    ).length, crossDomain.length),
  };
};

const deterministicRouterGatePassed = (
  metrics: ReturnType<typeof summarize>,
  naturalLanguageMetrics: ReturnType<typeof summarizeNaturalLanguage>,
) => (
  metrics.failed === 0 &&
  metrics.statusAccuracy >= routerEvalThresholds.statusAccuracy &&
  metrics.primaryAccuracy >= routerEvalThresholds.primaryAccuracy &&
  metrics.domainPrecision >= routerEvalThresholds.domainPrecision &&
  metrics.domainRecall >= routerEvalThresholds.domainRecall &&
  metrics.companionUsefulness >= routerEvalThresholds.companionUsefulness &&
  metrics.irrelevantSelectionRate <= routerEvalThresholds.irrelevantSelectionRate &&
  metrics.noMatchCorrectness >= routerEvalThresholds.noMatchCorrectness &&
  metrics.clarificationCorrectness >= routerEvalThresholds.clarificationCorrectness &&
  metrics.decompositionCorrectness >= routerEvalThresholds.decompositionCorrectness &&
  metrics.strictEligibilityCorrectness >= routerEvalThresholds.strictEligibilityCorrectness &&
  metrics.requiredSkillInclusion >= routerEvalThresholds.requiredSkillInclusion &&
  naturalLanguageMetrics.naturalLanguageSignalRecall >= routerEvalThresholds.naturalLanguageSignalRecall &&
  naturalLanguageMetrics.naturalLanguagePrimarySkillAccuracy >= routerEvalThresholds.naturalLanguagePrimarySkillAccuracy &&
  naturalLanguageMetrics.requiredCompanionRecall >= routerEvalThresholds.requiredCompanionRecall &&
  naturalLanguageMetrics.forbiddenSelectionRate <= routerEvalThresholds.forbiddenSelectionRate &&
  naturalLanguageMetrics.falsePositiveCompanionRate <= routerEvalThresholds.falsePositiveCompanionRate &&
  naturalLanguageMetrics.sameDomainDecompositionErrors <= routerEvalThresholds.sameDomainDecompositionErrors &&
  naturalLanguageMetrics.crossDomainDecompositionCorrectness >= routerEvalThresholds.crossDomainDecompositionCorrectness &&
  metrics.privacyLeakageCount <= routerEvalThresholds.privacyLeakageCount &&
  metrics.deterministic === routerEvalThresholds.deterministic
);

export const evaluateRouterFixtures = async (
  root = process.cwd(),
  options: { includeQuarantine?: boolean } = {},
) => {
  const cases = await loadRouterGoldenCases(path.join(root, "tests", "fixtures", "router-cases.json"));
  const packs = await loadRouterFixturePacks(path.join(root, "tests", "fixtures", "router-packs"));
  const results = await Promise.all(cases.map((input) => evaluateCase(root, input, packs)));
  void options.includeQuarantine;
  const quarantineCases = await loadRouterGoldenCases(path.join(root, "tests", "fixtures", "router-paraphrase-cases.json"));
  const quarantineResults = await Promise.all(quarantineCases.map((input) => evaluateCase(root, input, packs)));
  const naturalLanguageMetrics = summarizeNaturalLanguage(quarantineCases, quarantineResults);
  const metrics = summarize([...cases, ...quarantineCases], [...results, ...quarantineResults]);
  const shippedIndexes = cases.flatMap((input, index) => input.registry === "bundled" ? [index] : []);
  const syntheticIndexes = cases.flatMap((input, index) => input.registry === "test-fixture" ? [index] : []);
  const modelAssisted = await evaluateModelAssistedRouter(root, {
    deterministicCorpusRegression: deterministicRouterGatePassed(metrics, naturalLanguageMetrics),
  });
  return {
    schemaVersion: "router-eval/1.0" as const,
    caseCount: cases.length + quarantineCases.length,
    syntheticPackCount: packs.length,
    syntheticSkillCount: packs.reduce((total, pack) => total + pack.skills.length, 0),
    caseIds: [...cases, ...quarantineCases].map(({ id }) => id),
    domainIds: packs.map(({ domain }) => domain.id),
    routingDate: "2026-07-19",
    thresholds: routerEvalThresholds,
    metrics,
    suites: {
      shipped: summarize(shippedIndexes.map((index) => cases[index]), shippedIndexes.map((index) => results[index])),
      synthetic: summarize(syntheticIndexes.map((index) => cases[index]), syntheticIndexes.map((index) => results[index])),
      naturalLanguage: {
        gated: true,
        caseIds: quarantineCases.map(({ id }) => id),
        metrics: { ...summarize(quarantineCases, quarantineResults), ...naturalLanguageMetrics },
        results: quarantineCases.map((input, index) => ({
          id: input.id,
          expected: input.expected.status,
          actual: quarantineResults[index].status,
          passed: quarantineResults[index].status === input.expected.status && quarantineResults[index].deterministic,
          signalIds: quarantineResults[index].signalIds,
          primarySkillId: quarantineResults[index].primarySkillId,
          selectedCompanionIds: quarantineResults[index].selectedCompanionIds,
          domainIds: quarantineResults[index].domainIds,
          decomposedGoals: quarantineResults[index].decomposedGoals,
          primaryExclusionReasons: Object.fromEntries(Object.keys(input.expected.requiredPrimaryExclusionReasons ?? {}).map((skillId) => [
            skillId,
            (quarantineResults[index]?.primaryExclusionReasons as Record<string, string[]> | undefined)?.[skillId] ?? [],
          ])),
        })),
      },
      modelAssisted: modelAssisted.benchmark,
    },
    modelAssisted,
    promotion: modelAssisted.promotion,
    results: cases.map((input, index) => ({
      id: input.id,
      expected: input.expected.status,
      actual: results[index].status,
      passed: results[index].status === input.expected.status && results[index].deterministic,
      domainIds: results[index].domainIds,
    })),
  };
};

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const unknown = args.find((arg) => arg !== "--include-quarantine");
  if (unknown) throw new Error(`Unknown router eval option: ${unknown}`);
  const report = await evaluateRouterFixtures(process.cwd(), { includeQuarantine: args.includes("--include-quarantine") });
  console.log(JSON.stringify(report, null, 2));
  if (!deterministicRouterGatePassed(report.metrics, report.suites.naturalLanguage.metrics) || report.promotion.verdict !== "promotable") {
    process.exitCode = 1;
  }
}

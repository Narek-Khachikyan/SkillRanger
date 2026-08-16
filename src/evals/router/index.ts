import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultRegistryRoot } from "../../paths.ts";
import { scanProject } from "../../scanner/index.ts";
import { defaultRouterLimits } from "../../router/composer.ts";
import { parseTrigger } from "../../router/trigger.ts";
import { loadRouterGoldenCases, routerEvalRoutingDate, type RouterGoldenCase } from "../../router/fixtures.ts";
import { runRoutingPipeline, type RoutingPipelineDecision } from "../../router/pipeline.ts";
import { canonicalizeJson } from "../../router/store.ts";
import { loadRoutingWorld, type RoutingWorldRegistry } from "../../router/world.ts";
import type { InstalledSkill } from "../../types.ts";
import { evaluateModelAssistedRouter } from "./model-assisted.ts";
import { emptyFingerprint, publicOutcomeStatus, skillIndexById } from "./helpers.ts";

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

// The whole pipeline input core (router packs, router skill metadata, canonical
// routing documents, domain metadata, routing packs, routing context with the
// real base registry digest) is built by the Routing world loader; this adapter
// only adds the fingerprint, which is adapter-owned.
const buildCaseInput = async (root: string, input: RouterGoldenCase, normalizedIntent: string) => {
  // "test-fixture" golden cases compose the bundled world with the fixture packs
  // (override-by-id), which is exactly the loader's merge mode.
  const registry: RoutingWorldRegistry = input.registry === "bundled"
    ? { kind: "bundled", root: defaultRegistryRoot }
    : { kind: "merge", root: defaultRegistryRoot, fixtureRoot: path.join(root, "tests", "fixtures", "router-packs") };
  // Installed marking is an explicit loader input: the strict-installed case
  // passes its controlled installed-skill list, every other case stays empty so
  // evaluation determinism never depends on the machine's lockfile.
  const installed: InstalledSkill[] = input.id === "strict-installed"
    ? [{
        skillId: "backend.auth-implementation",
        version: "1.0.0",
        checksum: `sha256:${"a".repeat(64)}`,
        targetAgent: "codex",
        scope: "repo",
        installedPath: ".agents/skills/backend.auth-implementation",
        source: { type: "curated", registry: "local", path: "skills/frontend" },
        audit: { riskLevel: "low", securityScore: 1, findings: [] },
      }]
    : [];
  const world = await loadRoutingWorld({
    registry,
    projectRoot: root,
    targetAgent: "codex",
    skillInputs: {},
    intent: normalizedIntent,
    installed,
  });
  const fingerprint = input.registry === "bundled" && input.fixture === "frontend"
    ? await scanProject(path.join(root, "fixtures", "next-react-ts"))
    : emptyFingerprint(root);
  return {
    skills: world.skills,
    domains: world.domains,
    fingerprint,
    routingContext: world.routingContext,
  };
};

const evaluateCase = async (root: string, input: RouterGoldenCase) => {
  const parsed = parseTrigger({ prompt: input.prompt, mode: "explicit" });
  if (!parsed.activated) return { status: parsed.reason, domainIds: [], primaryDomainId: undefined, selectedSkillCount: 0, selectedCompanionCount: 0, usefulCompanionCount: 0, instructionBytes: 0, privacyLeakageCount: 0, deterministic: true };
  const metadata = await buildCaseInput(root, input, parsed.normalizedIntent);
  // Router evals enter through the same preloaded-metadata input contract as
  // production: the pipeline decides and the eval is a second adapter over the
  // routing decision, with no disk persistence. Replaying the whole decision
  // (signals, outcome, warnings, selections, digests) replaces the per-stage
  // replay checks of the hand-rolled orchestration.
  const pipelineInput = {
    trigger: parsed,
    activation: { mode: "explicit" as const },
    skills: metadata.skills,
    domains: metadata.domains,
    fingerprint: metadata.fingerprint,
    routingContext: metadata.routingContext,
    targetAgent: "codex",
    strict: input.strict,
    capabilities: input.capabilities,
    routingDate: routerEvalRoutingDate,
    limits: defaultRouterLimits,
  };
  const decision = runRoutingPipeline(pipelineInput);
  const replay = runRoutingPipeline(pipelineInput);
  const deterministic = canonicalizeJson(decision) === canonicalizeJson(replay);
  const outcome = decision.outcome;
  const status = publicOutcomeStatus(outcome.status);
  const expectedDomains = new Set(input.expected.domainIds);
  const selected = outcome.status === "prepared" ? outcome.selections : undefined;
  // Agent-context selections (core universal skills included) are always-on
  // guidance, not companions; they never count toward companion usefulness.
  const companions = selected ? [...selected.environment, ...selected.companions, ...selected.verification] : [];
  const usefulCompanions = companions.filter(({ domains, reasons }) =>
    domains.some((id) => expectedDomains.has(id)) || reasons.some((reason) => !reason.startsWith("domain-match:"))
  );
  const signalIds = [...new Set([
    ...decision.signals.matchedSignals.map(({ kind, id }) => `${kind}:${id}`),
    ...(decision.taskProfile?.evidence.filter(({ source }) => source === "prompt").map(({ kind, id }) => `${kind}:${id}`) ?? []),
    ...decision.signals.routingIntentTags.map((id) => `intent:${id}`),
  ])];
  // An analysis-level decomposition decision (two or more subtasks) reports the
  // per-subtask candidate domain; any other outcome reports the routed domain
  // candidates. Clarification outcomes report the ambiguous domain ids.
  const domainIds = outcome.status === "decomposition_required" && decision.taskProfile!.subtasks.length >= 2
    ? decision.taskProfile!.subtasks.map(({ candidateDomainIds }) => candidateDomainIds[0]).filter((id): id is string => id !== undefined)
    : outcome.status === "clarification_required"
      ? decision.continuation.ambiguousDomainIds
      : decision.domains.map(({ id }) => id);
  const primaryDomainId = outcome.status === "prepared"
    ? outcome.primaryDomain
    : decision.domains.find(({ role }) => role === "primary")?.id;
  const skillById = skillIndexById(metadata.skills);
  const privacyCanaries = [
    ...(input.prompt.match(/SECRET_[A-Z0-9_]+/g) ?? []),
    ...(input.prompt.match(/https?:\/\/[^\s]+/g) ?? []).map((value) => value.replace(/[.,;!?]+$/, "")),
  ];
  const serialized = JSON.stringify(decision);
  const privacyLeakageCount = privacyCanaries.filter((canary) => serialized.includes(canary)).length;
  const primaryExclusionReasons = Object.fromEntries([...new Set(decision.rejections.map(({ skillId }) => skillId))].map((skillId) => [
    skillId,
    decision.rejections.filter((rejection) => rejection.skillId === skillId).map(({ reason }) => reason),
  ]));
  if (outcome.status !== "prepared") {
    return {
      status,
      domainIds,
      primaryDomainId,
      selectedSkillCount: 0,
      selectedCompanionCount: 0,
      usefulCompanionCount: 0,
      instructionBytes: 0,
      privacyLeakageCount,
      deterministic,
      signalIds,
      primarySkillId: undefined,
      selectedCompanionIds: [],
      selectedSkillIds: [],
      primaryExclusionReasons,
      decomposedGoals: outcome.status === "decomposition_required" && decision.taskProfile!.subtasks.length >= 2
        ? decision.taskProfile!.subtasks.map(({ normalizedGoal }) => normalizedGoal)
        : [],
    };
  }
  const selectedCompanions = [...outcome.selections.environment, ...outcome.selections.companions, ...outcome.selections.verification];
  return {
    status,
    domainIds,
    primaryDomainId,
    selectedSkillCount: outcome.selectedSkillIds.length,
    selectedCompanionCount: selectedCompanions.length,
    usefulCompanionCount: usefulCompanions.length,
    instructionBytes: outcome.selectedSkillIds.reduce((sum, skillId) => sum + (skillById.get(skillId)?.instructionBytes ?? 0), 0),
    privacyLeakageCount,
    deterministic,
    signalIds,
    primarySkillId: outcome.selections.primary.skillId,
    selectedCompanionIds: outcome.selections.companions.map(({ skillId }) => skillId),
    selectedSkillIds: outcome.selectedSkillIds,
    primaryExclusionReasons,
    decomposedGoals: [],
  };
};

const summarize = (cases: RouterGoldenCase[], results: Awaited<ReturnType<typeof evaluateCase>>[]) => {
  const expectedDomains = cases.map(({ expected }) => new Set(expected.domainIds));
  const domainMatches = results.reduce((sum, result, index) => sum + result.domainIds.filter((id) => expectedDomains[index]?.has(id) ?? false).length, 0);
  const predictedDomains = results.reduce((sum, result) => sum + result.domainIds.length, 0);
  const expectedDomainCount = cases.reduce((sum, input) => sum + input.expected.domainIds.length, 0);
  const preparedIndexes = cases.flatMap((input, index) => input.expected.status === "prepared" && input.expected.domainIds.length > 0 ? [index] : []);
  const requiredSkillInclusion = (() => {
    const declaring = cases.flatMap((input, index) => (input.expected.requiredSkillIds ?? []).length > 0 ? [index] : []);
    if (declaring.length === 0) return 1;
    const covered = declaring.filter((index) => {
      const required = cases[index]?.expected.requiredSkillIds ?? [];
      const selected = results[index]?.selectedSkillIds ?? [];
      return required.every((skillId) => selected.includes(skillId));
    }).length;
    return Number((covered / declaring.length).toFixed(3));
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
  // Corpus metadata facts (synthetic pack and skill counts, fixture domain ids)
  // also come from the loader: a replace-mode world over the fixture packs. The
  // eval never loads packs, metadata, or routing context on its own.
  const syntheticWorld = await loadRoutingWorld({
    registry: { kind: "test-fixture", root: path.join(root, "tests", "fixtures", "router-packs") },
    projectRoot: root,
    targetAgent: "codex",
    skillInputs: {},
    installed: [],
  });
  const results = await Promise.all(cases.map((input) => evaluateCase(root, input)));
  void options.includeQuarantine;
  const quarantineCases = await loadRouterGoldenCases(path.join(root, "tests", "fixtures", "router-paraphrase-cases.json"));
  const quarantineResults = await Promise.all(quarantineCases.map((input) => evaluateCase(root, input)));
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
    syntheticPackCount: syntheticWorld.domains.length,
    syntheticSkillCount: syntheticWorld.skills.length,
    caseIds: [...cases, ...quarantineCases].map(({ id }) => id),
    domainIds: syntheticWorld.domains.map(({ id }) => id),
    routingDate: routerEvalRoutingDate,
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

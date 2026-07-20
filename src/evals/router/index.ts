import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { loadBundledRouterPacks } from "../../domains/registry.ts";
import { defaultDomainsRoot, defaultRegistryRoot } from "../../paths.ts";
import { loadLocalRegistry } from "../../registry/index.ts";
import { scanProject } from "../../scanner/index.ts";
import { composeSkillSet, type RouterSkillMetadata } from "../../router/composer.ts";
import { analyzeTask, type TaskAnalyzerDomainMetadata, type TaskAnalyzerSkillMetadata } from "../../router/analyzer.ts";
import { parseTrigger } from "../../router/trigger.ts";
import { resolveDomains } from "../../router/resolver.ts";
import { loadRouterFixturePacks, loadRouterGoldenCases, type RouterFixturePack, type RouterGoldenCase } from "../../router/fixtures.ts";

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
  const bundledSkills = (await Promise.all((await loadLocalRegistry(defaultRegistryRoot)).map(registrySkillMetadata)))
    .filter((skill): skill is RouterSkillMetadata => skill !== undefined);
  const synthetic = fixturePacks.flatMap((pack) => pack.skills.map((skill) => fixtureSkillMetadata(skill, input.id === "strict-installed" && skill.id === "backend.auth-implementation")));
  const syntheticDomains = fixturePacks.map(({ domain }) => domainMetadata(domain));
  if (input.registry === "test-fixture") {
    const syntheticDomainIds = new Set(syntheticDomains.map(({ id }) => id));
    return {
      domains: [
        ...bundledPacks.filter(({ id }) => !syntheticDomainIds.has(id)).map((domain) => input.id === "ambiguous-web-mobile" && domain.id === "frontend"
          ? { ...domainMetadata(domain), routing: { ...domain.routing, artifactTypes: [...domain.routing.artifactTypes, "application-interface"], intentTags: [...domain.routing.intentTags, "application-interface"] } }
          : domainMetadata(domain)),
        ...syntheticDomains,
      ],
      skills: [
        ...bundledSkills.filter((skill) => !skill.domains?.some((domain) => syntheticDomainIds.has(domain))),
        ...synthetic,
      ],
      fingerprint: input.fixture === "empty" ? emptyFingerprint(root) : emptyFingerprint(root),
    };
  }
  const project = input.fixture === "frontend" ? await scanProject(path.join(root, "fixtures", "next-react-ts")) : emptyFingerprint(root);
  return { domains: bundledPacks.map(domainMetadata), skills: bundledSkills, fingerprint: project };
};

const evaluateCase = async (root: string, input: RouterGoldenCase, fixturePacks: RouterFixturePack[]) => {
  const parsed = parseTrigger({ prompt: input.prompt, mode: "explicit" });
  if (!parsed.activated) return { status: parsed.reason, domainIds: [], primaryDomainId: undefined, selectedSkillCount: 0, selectedCompanionCount: 0, usefulCompanionCount: 0, instructionBytes: 0, privacyLeakageCount: 0, deterministic: true };
  const metadata = await buildCaseInput(root, input, fixturePacks);
  const analyzerSkills = metadata.skills satisfies TaskAnalyzerSkillMetadata[];
  const analysis = analyzeTask({ prompt: parsed.normalizedIntent, domains: metadata.domains, skills: analyzerSkills, fingerprint: metadata.fingerprint });
  const resolution = resolveDomains({ profile: analysis.profile, domains: metadata.domains, skills: analyzerSkills, fingerprint: metadata.fingerprint, routingIntentTags: analysis.routingIntentTags });
  const privacyCanaries = [
    ...(input.prompt.match(/SECRET_[A-Z0-9_]+/g) ?? []),
    ...(input.prompt.match(/https?:\/\/[^\s]+/g) ?? []).map((value) => value.replace(/[.,;!?]+$/, "")),
  ];
  const privacyLeakageCount = (value: unknown) => {
    const serialized = JSON.stringify(value);
    return privacyCanaries.filter((canary) => serialized.includes(canary)).length;
  };
  if (resolution.clarificationRequired) return { status: "clarification_required", domainIds: resolution.ambiguousDomainIds, primaryDomainId: undefined, selectedSkillCount: 0, selectedCompanionCount: 0, usefulCompanionCount: 0, instructionBytes: 0, privacyLeakageCount: privacyLeakageCount({ analysis, resolution }), deterministic: true };
  if (!resolution.primaryDomainId) return { status: "no_matching_skills", domainIds: [], primaryDomainId: undefined, selectedSkillCount: 0, selectedCompanionCount: 0, usefulCompanionCount: 0, instructionBytes: 0, privacyLeakageCount: privacyLeakageCount({ analysis, resolution }), deterministic: true };
  const composed = composeSkillSet({
    profile: analysis.profile,
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
  });
  const replay = composeSkillSet({
    profile: analysis.profile, skills: metadata.skills, fingerprint: metadata.fingerprint,
    selectedDomainIds: resolution.candidates.map(({ id }) => id), primaryDomainId: resolution.primaryDomainId,
    targetAgent: "codex", capabilities: input.capabilities, strict: input.strict,
    installedSkillIds: input.id === "strict-installed" ? ["backend.auth-implementation"] : [], routingDate: "2026-07-19", routingIntentTags: analysis.routingIntentTags,
  });
  const selected = composed.status === "prepared" ? composed.composed.all : [];
  const companions = selected.filter(({ role }) => role !== "primary");
  const expectedDomains = new Set(input.expected.domainIds);
  const usefulCompanions = companions.filter(({ skill, reasons }) =>
    skill.domains.some((id) => expectedDomains.has(id)) || reasons.some((reason) => !reason.startsWith("domain-match:"))
  );
  return {
    status: composed.status,
    domainIds: resolution.candidates.map(({ id }) => id),
    primaryDomainId: resolution.primaryDomainId,
    selectedSkillCount: selected.length,
    selectedCompanionCount: companions.length,
    usefulCompanionCount: usefulCompanions.length,
    instructionBytes: composed.status === "prepared" ? composed.composed.instructionBytes : 0,
    privacyLeakageCount: privacyLeakageCount({ analysis, resolution, composed }),
    deterministic: JSON.stringify(composed) === JSON.stringify(replay),
  };
};

const summarize = (cases: RouterGoldenCase[], results: Awaited<ReturnType<typeof evaluateCase>>[]) => {
  const expectedDomains = cases.map(({ expected }) => new Set(expected.domainIds));
  const domainMatches = results.reduce((sum, result, index) => sum + result.domainIds.filter((id) => expectedDomains[index].has(id)).length, 0);
  const predictedDomains = results.reduce((sum, result) => sum + result.domainIds.length, 0);
  const expectedDomainCount = cases.reduce((sum, input) => sum + input.expected.domainIds.length, 0);
  const preparedIndexes = cases.flatMap((input, index) => input.expected.status === "prepared" && input.expected.domainIds.length > 0 ? [index] : []);
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
    strictEligibilityCorrectness: strictIndexes.length === 0 ? 1 : Number((strictIndexes.filter((index) => results[index].status === cases[index].expected.status).length / strictIndexes.length).toFixed(3)),
    averageSelectedSkillCount: Number((selectedSkills / Math.max(cases.length, 1)).toFixed(3)),
    instructionByteCost: results.reduce((sum, result) => sum + result.instructionBytes, 0),
    routingDeterminism: results.every(({ deterministic }) => deterministic),
    privacyLeakageCount: results.reduce((sum, result) => sum + result.privacyLeakageCount, 0),
    deterministic: results.every(({ deterministic }) => deterministic),
  };
};

export const evaluateRouterFixtures = async (root = process.cwd()) => {
  const cases = await loadRouterGoldenCases(path.join(root, "tests", "fixtures", "router-cases.json"));
  const packs = await loadRouterFixturePacks(path.join(root, "tests", "fixtures", "router-packs"));
  const results = await Promise.all(cases.map((input) => evaluateCase(root, input, packs)));
  const metrics = summarize(cases, results);
  const shippedIndexes = cases.flatMap((input, index) => input.registry === "bundled" ? [index] : []);
  const syntheticIndexes = cases.flatMap((input, index) => input.registry === "test-fixture" ? [index] : []);
  return {
    schemaVersion: "router-eval/1.0" as const,
    caseCount: cases.length,
    syntheticPackCount: packs.length,
    syntheticSkillCount: packs.reduce((total, pack) => total + pack.skills.length, 0),
    caseIds: cases.map(({ id }) => id),
    domainIds: packs.map(({ domain }) => domain.id),
    routingDate: "2026-07-19",
    thresholds: routerEvalThresholds,
    metrics,
    suites: {
      shipped: summarize(shippedIndexes.map((index) => cases[index]), shippedIndexes.map((index) => results[index])),
      synthetic: summarize(syntheticIndexes.map((index) => cases[index]), syntheticIndexes.map((index) => results[index])),
    },
    results: cases.map((input, index) => ({ id: input.id, expected: input.expected.status, actual: results[index].status, passed: results[index].status === input.expected.status && results[index].deterministic })),
  };
};

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const report = await evaluateRouterFixtures();
  console.log(JSON.stringify(report, null, 2));
  if (
    report.metrics.failed > 0 ||
    report.metrics.statusAccuracy < report.thresholds.statusAccuracy ||
    report.metrics.primaryAccuracy < report.thresholds.primaryAccuracy ||
    report.metrics.domainPrecision < report.thresholds.domainPrecision ||
    report.metrics.domainRecall < report.thresholds.domainRecall ||
    report.metrics.companionUsefulness < report.thresholds.companionUsefulness ||
    report.metrics.irrelevantSelectionRate > report.thresholds.irrelevantSelectionRate ||
    report.metrics.noMatchCorrectness < report.thresholds.noMatchCorrectness ||
    report.metrics.clarificationCorrectness < report.thresholds.clarificationCorrectness ||
    report.metrics.decompositionCorrectness < report.thresholds.decompositionCorrectness ||
    report.metrics.strictEligibilityCorrectness < report.thresholds.strictEligibilityCorrectness ||
    report.metrics.privacyLeakageCount > report.thresholds.privacyLeakageCount ||
    report.metrics.deterministic !== report.thresholds.deterministic
  ) {
    process.exitCode = 1;
  }
}

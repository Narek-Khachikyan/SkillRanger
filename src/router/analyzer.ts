import type { ProjectFingerprint } from "../types.ts";
import type {
  TaskAction,
  TaskLocale,
  TaskProfile,
  TaskSignalEvidence,
  TaskSubtask,
  RouterSkillRole,
} from "./types.ts";

export type TaskAnalyzerDomainMetadata = {
  id: string;
  targetSurface?: string;
  routing: {
    aliases: string[];
    intentTags: string[];
    artifactTypes: string[];
    technologyTags: string[];
    projectTags: string[];
  };
};

export type TaskAnalyzerSkillMetadata = {
  domains: string[];
  roles?: RouterSkillRole[];
  actions: TaskAction[];
  artifactTypes: string[];
  intentTags: string[];
  technologyTags: string[];
  qualityGoals: string[];
  environmentSignals?: string[];
};

export type AnalyzeTaskInput = {
  prompt: string;
  domains: TaskAnalyzerDomainMetadata[];
  skills: TaskAnalyzerSkillMetadata[];
  fingerprint?: ProjectFingerprint;
};

export type TaskAnalysisResult = {
  profile: TaskProfile;
  warnings: string[];
  routingIntentTags: string[];
};

type Match = { id: string; index: number };
type Alias = { phrase: string; ids: string[] };

const actionAliases: Record<TaskAction, string[]> = {
  create: ["create", "build", "add", "создай", "создать", "добавь", "добавить"],
  implement: ["implement", "implementation", "реализуй", "реализовать", "внедри", "внедрить"],
  modify: ["modify", "change", "update", "измени", "изменить", "обнови", "обновить"],
  fix: ["fix", "repair", "исправь", "исправить", "почини", "починить"],
  debug: ["debug", "diagnose", "отладь", "отладить", "диагностируй", "диагностировать"],
  review: ["review", "audit", "ревью", "проведи ревью", "проанализируй"],
  test: ["test", "tests", "testing", "тест", "тесты", "тестирование", "протестируй"],
  verify: ["verify", "validate", "check", "проверь", "проверить", "валидация"],
  document: ["document", "documentation", "документируй", "документация"],
  deploy: ["deploy", "deployment", "разверни", "развернуть", "деплой"],
  migrate: ["migrate", "migration", "мигрируй", "миграция", "перенеси"],
  optimize: ["optimize", "optimization", "оптимизируй", "оптимизация", "ускорь"],
  research: ["research", "исследуй", "исследование", "изучи"],
  design: ["design", "redesign", "спроектируй", "дизайн", "редизайн", "переработай дизайн"],
  configure: ["configure", "configuration", "настрой", "настроить", "конфигурация"],
  investigate: ["investigate", "investigation", "расследуй", "расследование", "разберись"],
};

const vocabularyAliases: Alias[] = [
  { phrase: "web interface", ids: ["web-interface"] },
  { phrase: "website", ids: ["web-interface"] },
  { phrase: "web site", ids: ["web-interface"] },
  { phrase: "сайт", ids: ["web-interface"] },
  { phrase: "веб сайт", ids: ["web-interface"] },
  { phrase: "веб интерфейс", ids: ["web-interface"] },
  { phrase: "интерфейс сайта", ids: ["web-interface"] },
  { phrase: "mobile application", ids: ["mobile-interface"] },
  { phrase: "mobile app", ids: ["mobile-interface"] },
  { phrase: "mobile interface", ids: ["mobile-interface"] },
  { phrase: "мобильное приложение", ids: ["mobile-interface"] },
  { phrase: "мобильный интерфейс", ids: ["mobile-interface"] },
  { phrase: "mobile screen", ids: ["mobile-screen"] },
  { phrase: "screen", ids: ["mobile-screen"] },
  { phrase: "экран приложения", ids: ["mobile-screen"] },
  { phrase: "integration tests", ids: ["integration-test", "test-suite"] },
  { phrase: "integration test", ids: ["integration-test", "test-suite"] },
  { phrase: "интеграционные тесты", ids: ["integration-test", "test-suite"] },
  { phrase: "интеграционный тест", ids: ["integration-test", "test-suite"] },
  { phrase: "authentication", ids: ["authentication-flow"] },
  { phrase: "authorization", ids: ["authentication-flow"] },
  { phrase: "auth", ids: ["authentication-flow"] },
  { phrase: "refresh token", ids: ["authentication-flow"] },
  { phrase: "токен обновления", ids: ["authentication-flow"] },
  { phrase: "авторизация", ids: ["authentication-flow"] },
  { phrase: "аутентификация", ids: ["authentication-flow"] },
  { phrase: "sql queries", ids: ["sql-query"] },
  { phrase: "queries", ids: ["sql-query"] },
  { phrase: "database queries", ids: ["sql-query"] },
  { phrase: "запросы к базе", ids: ["sql-query"] },
  { phrase: "database schema", ids: ["database-schema"] },
  { phrase: "схема базы", ids: ["database-schema"] },
  { phrase: "security review", ids: ["security-review"] },
  { phrase: "аудит безопасности", ids: ["security-review"] },
  { phrase: "landing page", ids: ["page", "web-interface"] },
  { phrase: "лендинг", ids: ["page", "web-interface"] },
  { phrase: "компонент", ids: ["component"] },
  { phrase: "страница", ids: ["page"] },
  { phrase: "форма", ids: ["form"] },
];

const qualityAliases: Alias[] = [
  { phrase: "accessibility", ids: ["accessibility"] },
  { phrase: "доступность", ids: ["accessibility"] },
  { phrase: "performance", ids: ["performance"] },
  { phrase: "производительность", ids: ["performance"] },
  { phrase: "security", ids: ["security"] },
  { phrase: "безопасность", ids: ["security"] },
  { phrase: "correctness", ids: ["correctness"] },
  { phrase: "корректность", ids: ["correctness"] },
  { phrase: "coverage", ids: ["coverage"] },
  { phrase: "покрытие", ids: ["coverage"] },
  { phrase: "usability", ids: ["usability"] },
  { phrase: "удобство использования", ids: ["usability"] },
];

const constraintAliases: Alias[] = [
  { phrase: "without network", ids: ["no-network"] },
  { phrase: "no network", ids: ["no-network"] },
  { phrase: "offline only", ids: ["no-network"] },
  { phrase: "без сети", ids: ["no-network"] },
  { phrase: "без интернета", ids: ["no-network"] },
  { phrase: "do not install", ids: ["no-installation"] },
  { phrase: "without installation", ids: ["no-installation"] },
  { phrase: "не устанавливай", ids: ["no-installation"] },
  { phrase: "без установки", ids: ["no-installation"] },
  { phrase: "read only", ids: ["read-only"] },
  { phrase: "только чтение", ids: ["read-only"] },
];

const acceptanceAliases: Alias[] = [
  { phrase: "tests pass", ids: ["tests-pass"] },
  { phrase: "tests passing", ids: ["tests-pass"] },
  { phrase: "тесты проходят", ids: ["tests-pass"] },
  { phrase: "тесты должны пройти", ids: ["tests-pass"] },
  { phrase: "static analysis passes", ids: ["static-analysis-pass"] },
  { phrase: "линтер проходит", ids: ["static-analysis-pass"] },
  { phrase: "security gates pass", ids: ["security-gates-pass"] },
  { phrase: "проверки безопасности проходят", ids: ["security-gates-pass"] },
  { phrase: "accessibility gates pass", ids: ["accessibility-gates-pass"] },
  { phrase: "проверки доступности проходят", ids: ["accessibility-gates-pass"] },
  { phrase: "measure performance", ids: ["performance-measured"] },
  { phrase: "performance measured", ids: ["performance-measured"] },
  { phrase: "измерь производительность", ids: ["performance-measured"] },
  { phrase: "schema is valid", ids: ["schema-valid"] },
  { phrase: "схема валидна", ids: ["schema-valid"] },
  { phrase: "deployment smoke passes", ids: ["deployment-smoke-pass"] },
  { phrase: "smoke test passes", ids: ["deployment-smoke-pass"] },
];

const normalize = (value: string) => value
  .normalize("NFKC")
  .toLocaleLowerCase("und")
  .replaceAll("ё", "е");

const phrasePattern = (phrase: string) => {
  const escaped = normalize(phrase)
    .split(/[-\s]+/u)
    .filter(Boolean)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[-\\s]+");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})(?=$|[^\\p{L}\\p{N}_])`, "gu");
};

const positions = (source: string, phrase: string) => {
  const result: Array<{ index: number; end: number }> = [];
  for (const match of source.matchAll(phrasePattern(phrase))) {
    const index = (match.index ?? 0) + match[1].length;
    result.push({ index, end: index + match[2].length });
  }
  return result;
};

const orderedUniqueMatches = (matches: Match[]) => {
  const firstById = new Map<string, number>();
  for (const match of matches) {
    const previous = firstById.get(match.id);
    if (previous === undefined || match.index < previous) firstById.set(match.id, match.index);
  }
  return [...firstById]
    .sort(([leftId, leftIndex], [rightId, rightIndex]) => leftIndex - rightIndex || leftId.localeCompare(rightId))
    .map(([id, index]) => ({ id, index }));
};

const matchAliases = (source: string, aliases: Alias[], allowed?: ReadonlySet<string>) => {
  const candidates = aliases.flatMap(({ phrase, ids }) => positions(source, phrase).map(({ index, end }) => ({
    index,
    end,
    phrase: normalize(phrase),
    ids: ids.filter((id) => !allowed || allowed.has(id)),
  }))).filter(({ ids }) => ids.length > 0).sort((left, right) =>
    (right.end - right.index) - (left.end - left.index) || left.index - right.index || left.phrase.localeCompare(right.phrase),
  );
  const claimed: Array<{ index: number; end: number }> = [];
  const matches: Match[] = [];
  for (const candidate of candidates) {
    const exact = claimed.some(({ index, end }) => index === candidate.index && end === candidate.end);
    const overlapsLonger = claimed.some(({ index, end }) => candidate.index < end && candidate.end > index);
    if (overlapsLonger && !exact) continue;
    if (!exact) claimed.push({ index: candidate.index, end: candidate.end });
    matches.push(...candidate.ids.map((id) => ({ id, index: candidate.index })));
  }
  return orderedUniqueMatches(matches);
};

const canonicalAliases = (ids: Iterable<string>): Alias[] => [...new Set(ids)].flatMap((id) => {
  const phrase = id.replaceAll("-", " ").replaceAll("_", " ");
  return phrase === id ? [{ phrase: id, ids: [id] }] : [{ phrase: id, ids: [id] }, { phrase, ids: [id] }];
});

const detectLocale = (source: string): TaskLocale => {
  const hasEnglish = /\p{Script=Latin}/u.test(source);
  const hasRussian = /\p{Script=Cyrillic}/u.test(source);
  if (hasEnglish && hasRussian) return "mixed";
  if (hasRussian) return "ru";
  if (hasEnglish) return "en";
  return "unknown";
};

const evidence = (
  source: TaskSignalEvidence["source"],
  kind: TaskSignalEvidence["kind"],
  matches: Match[],
): TaskSignalEvidence[] => matches.map(({ id }) => ({ source, kind, id }));

const uniqueEvidence = (items: TaskSignalEvidence[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.source}:${item.kind}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const domainMatches = (
  source: string,
  domains: TaskAnalyzerDomainMetadata[],
  artifacts: Match[],
  technologies: Match[],
) => {
  const matches: Match[] = [];
  for (const domain of domains) {
    const direct = matchAliases(source, canonicalAliases([
      domain.id,
      ...domain.routing.aliases,
      ...domain.routing.intentTags,
    ]));
    const artifactIndex = artifacts.find(({ id }) => domain.routing.artifactTypes.includes(id))?.index;
    const technologyIndex = technologies.find(({ id }) => domain.routing.technologyTags.includes(id))?.index;
    const projectIndex = direct[0]?.index;
    if (projectIndex !== undefined || artifactIndex !== undefined || technologyIndex !== undefined) {
      matches.push({
        id: domain.id,
        index: Math.min(projectIndex ?? Infinity, artifactIndex ?? Infinity, technologyIndex ?? Infinity),
      });
    }
  }
  return orderedUniqueMatches(matches);
};

const fingerprintMatches = (
  fingerprint: ProjectFingerprint | undefined,
  technologyVocabulary: ReadonlySet<string>,
  domains: TaskAnalyzerDomainMetadata[],
) => {
  if (!fingerprint) return { technologies: [] as Match[], domains: [] as Match[] };
  const signalNames = [
    ...fingerprint.languages.map(({ name }) => name),
    ...fingerprint.frameworks.map(({ name }) => name),
    ...fingerprint.testing.map(({ name }) => name),
    ...fingerprint.infrastructure.map(({ name }) => name),
    ...fingerprint.tags,
  ].map(normalize);
  const technologies = orderedUniqueMatches(signalNames.flatMap((name, index) => {
    const canonical = [...technologyVocabulary].find((id) => normalize(id) === name);
    return canonical ? [{ id: canonical, index }] : [];
  }));
  const domainsFound: Match[] = [];
  domains.forEach((domain) => {
    const projectTags = new Set(domain.routing.projectTags.map(normalize));
    const index = signalNames.findIndex((name) => projectTags.has(name));
    if (index >= 0) domainsFound.push({ id: domain.id, index });
  });
  return { technologies, domains: orderedUniqueMatches(domainsFound) };
};

const normalizedGoal = (actions: Match[], artifacts: Match[], technologies: Match[] = [], qualityGoals: Match[] = []) => [
  ...actions.map(({ id }) => id),
  ...artifacts.map(({ id }) => id),
  ...technologies.map(({ id }) => id),
  ...qualityGoals.map(({ id }) => id),
].join(" ");

const analyzeSegment = (
  source: string,
  domains: TaskAnalyzerDomainMetadata[],
  actionVocabulary: ReadonlySet<TaskAction>,
  artifactAliases: Alias[],
  artifactVocabulary: ReadonlySet<string>,
  technologyAliases: Alias[],
  technologyVocabulary: ReadonlySet<string>,
) => {
  const actionAliasesForVocabulary: Alias[] = [...actionVocabulary].flatMap((id) => [
    { phrase: id, ids: [id] },
    ...actionAliases[id].map((phrase) => ({ phrase, ids: [id] })),
  ]);
  const actions = matchAliases(source, actionAliasesForVocabulary) as Match[];
  const artifacts = matchAliases(source, artifactAliases, artifactVocabulary);
  const technologies = matchAliases(source, technologyAliases, technologyVocabulary);
  const matchedDomains = domainMatches(source, domains, artifacts, technologies);
  return { actions, artifacts, technologies, domains: matchedDomains };
};

const buildSubtasks = (
  source: string,
  domains: TaskAnalyzerDomainMetadata[],
  actionVocabulary: ReadonlySet<TaskAction>,
  artifactAliases: Alias[],
  artifactVocabulary: ReadonlySet<string>,
  technologyAliases: Alias[],
  technologyVocabulary: ReadonlySet<string>,
): TaskSubtask[] => {
  const segments = source.split(/\s*(?:,|;|\band\b|\bи\b)\s*/iu).filter(Boolean);
  const candidates = segments.map((segment) => analyzeSegment(
    segment,
    domains,
    actionVocabulary,
    artifactAliases,
    artifactVocabulary,
    technologyAliases,
    technologyVocabulary,
  )).filter(({ actions, artifacts }) => actions.length > 0 || artifacts.length > 0);
  if (candidates.length < 2) return [];

  const usedIds = new Map<string, number>();
  return candidates.map((candidate) => {
    const goal = normalizedGoal(candidate.actions, candidate.artifacts, candidate.technologies)
      || candidate.domains.map(({ id }) => id).join(" ");
    const baseId = [
      candidate.domains[0]?.id ?? candidate.artifacts[0]?.id ?? "task",
      candidate.actions[0]?.id ?? "work",
    ].join("-").slice(0, 128);
    const occurrence = (usedIds.get(baseId) ?? 0) + 1;
    usedIds.set(baseId, occurrence);
    return {
      id: occurrence === 1 ? baseId : `${baseId}-${occurrence}`.slice(0, 128),
      normalizedGoal: goal,
      actions: candidate.actions.map(({ id }) => id as TaskAction),
      artifactTypes: candidate.artifacts.map(({ id }) => id),
      candidateDomainIds: candidate.domains.map(({ id }) => id),
    };
  });
};

const hasUnknownTechnology = (source: string, knownTechnologyMatches: Match[]) => {
  const candidate = /(?:\busing\b|\bwith\b|\bна\b|\bиспользуя\b)\s+([\p{L}\p{N}][\p{L}\p{N}._+-]*)/giu.exec(source);
  if (!candidate || /^(?:the|a|an|без|no)$/iu.test(candidate[1])) return false;
  const start = candidate.index + candidate[0].lastIndexOf(candidate[1]);
  return !knownTechnologyMatches.some(({ index }) => index === start);
};

export const analyzeTask = ({
  prompt,
  domains,
  skills,
  fingerprint,
}: AnalyzeTaskInput): TaskAnalysisResult => {
  const source = normalize(prompt);
  const actionVocabulary = new Set<TaskAction>(Object.keys(actionAliases) as TaskAction[]);
  const artifactVocabulary = new Set([
    ...domains.flatMap(({ routing }) => routing.artifactTypes),
    ...skills.flatMap(({ artifactTypes }) => artifactTypes),
  ]);
  const technologyVocabulary = new Set([
    ...domains.flatMap(({ routing }) => routing.technologyTags),
    ...skills.flatMap(({ technologyTags }) => technologyTags),
  ]);
  const qualityVocabulary = new Set(skills.flatMap(({ qualityGoals }) => qualityGoals));
  const intentVocabulary = new Set(skills.flatMap(({ intentTags }) => intentTags));
  const artifactAliases = [...vocabularyAliases, ...canonicalAliases(artifactVocabulary)];
  const technologyAliases = canonicalAliases(technologyVocabulary);
  const intentAliases = [...canonicalAliases(intentVocabulary), ...[...intentVocabulary].flatMap((id) => {
    const token = id.split(/[-_]/u)[0];
    return token.length >= 5 && token !== "workflow" ? [{ phrase: token, ids: [id] }] : [];
  })];
  const allActionAliases = [...actionVocabulary].flatMap((id) => [
    { phrase: id, ids: [id] },
    ...actionAliases[id].map((phrase) => ({ phrase, ids: [id] })),
  ]);

  const actions = matchAliases(source, allActionAliases) as Array<Match & { id: TaskAction }>;
  const artifacts = matchAliases(source, artifactAliases, artifactVocabulary);
  const promptTechnologies = matchAliases(source, technologyAliases, technologyVocabulary);
  const routingIntentTags = matchAliases(source, intentAliases, intentVocabulary).map(({ id }) => id);
  const project = fingerprintMatches(fingerprint, technologyVocabulary, domains);
  const technologies = orderedUniqueMatches([...promptTechnologies, ...project.technologies]);
  const qualityGoals = matchAliases(
    source,
    [...qualityAliases, ...canonicalAliases(qualityVocabulary)],
    qualityVocabulary,
  );
  const constraints = matchAliases(source, constraintAliases);
  const acceptanceCriteria = matchAliases(source, acceptanceAliases);
  const promptDomains = domainMatches(source, domains, artifacts, promptTechnologies);
  const matchedDomainIds = orderedUniqueMatches([...promptDomains, ...project.domains]);
  const promptIntentEvidence = uniqueEvidence(domains.flatMap((domain) => {
    const aliases = [domain.id, ...domain.routing.aliases, ...domain.routing.intentTags];
    return matchAliases(source, canonicalAliases(domain.routing.intentTags), new Set(domain.routing.intentTags))
      .filter(({ id }) => aliases.some((alias) => normalize(alias) === normalize(id)))
      .map(({ id }) => ({ source: "prompt" as const, kind: "domain" as const, id }));
  }));

  const profileEvidence = uniqueEvidence([
    ...evidence("prompt", "action", actions),
    ...evidence("prompt", "artifact", artifacts),
    ...evidence("prompt", "technology", promptTechnologies),
    ...evidence("fingerprint", "technology", project.technologies),
    ...evidence("prompt", "quality", qualityGoals),
    ...evidence("prompt", "constraint", constraints),
    ...evidence("prompt", "acceptance", acceptanceCriteria),
    ...evidence("prompt", "domain", promptDomains),
    ...promptIntentEvidence,
    ...evidence("fingerprint", "domain", project.domains),
  ]);

  const profile: TaskProfile = {
    schemaVersion: "task-profile/1.0",
    normalizedGoal: normalizedGoal(actions, artifacts, technologies, qualityGoals),
    locale: detectLocale(source),
    actions: actions.map(({ id }) => id),
    artifactTypes: artifacts.map(({ id }) => id),
    technologies: technologies.map(({ id }) => id),
    constraints: constraints.map(({ id }) => id),
    qualityGoals: qualityGoals.map(({ id }) => id),
    acceptanceCriteria: acceptanceCriteria.map(({ id }) => id),
    domains: matchedDomainIds.map(({ id }, index) => {
      const domain = domains.find((candidate) => candidate.id === id);
      const evidenceItems = profileEvidence.filter((item) => item.kind === "domain" && item.id === id);
      const promptMatched = promptDomains.some((candidate) => candidate.id === id);
      const projectMatched = project.domains.some((candidate) => candidate.id === id);
      return {
        id,
        confidence: promptMatched && projectMatched ? 1 : promptMatched ? 0.7 : 0.45,
        role: index === 0 ? "primary" as const : "supporting" as const,
        available: Boolean(domain),
        reasons: [
          `domain-match:${id}`,
          ...(projectMatched ? [`environment-match:${id}`] : []),
        ],
        evidence: evidenceItems,
      };
    }),
    subtasks: buildSubtasks(
      source,
      domains,
      actionVocabulary,
      artifactAliases,
      artifactVocabulary,
      technologyAliases,
      technologyVocabulary,
    ),
    evidence: profileEvidence,
  };

  return {
    profile,
    warnings: hasUnknownTechnology(source, promptTechnologies)
      ? ["unclassified-technology-signal"]
      : [],
    routingIntentTags,
  };
};

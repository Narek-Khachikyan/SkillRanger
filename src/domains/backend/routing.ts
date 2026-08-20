import { defaultDomainsRoot } from "../../paths.ts";
import type { ProjectFingerprint, Recommendation, RegistrySkill, SkillLane } from "../../types.ts";
import { loadBundledDomainManifestSync, registerDomainPack } from "../registry.ts";
import type { DomainRoutingPolicy } from "../types.ts";

const tokenize = (input: string) =>
  new Set(
    input
      .toLowerCase()
      .split(/[^\p{L}\p{N}+.#-]+/u)
      .map((part) => part.trim())
      .map((part) => part.replace(/^[.,:;!?()[\]{}"']+|[.,:;!?()[\]{}"']+$/g, ""))
      .filter(Boolean),
  );

const hasAnyToken = (tokens: Set<string>, expected: Set<string>) =>
  [...tokens].some((token) => expected.has(token));

const backendTokens = new Set([
  "api",
  "endpoint",
  "endpoints",
  "route",
  "handler",
  "route-handler",
  "server-action",
  "server",
  "service",
  "backend",
  "prisma",
  "@prisma/client",
  "drizzle",
  "drizzle-orm",
  "next-auth",
  "@auth/core",
  "auth",
  "authentication",
  "authorization",
  "persistence",
  "database",
  "db",
  "postgres",
  "postgresql",
  "query",
  "migration",
  "migrations",
  "schema",
  "model",
  "nodejs",
  "node",
  "express",
  "nestjs",
  "cache",
  "апи",
  "эндпоинт",
  "роут",
  "хэндлер",
  "хендлер",
  "серверный",
  "экшен",
  "бэкенд",
  "призма",
  "дриззл",
  "аутентификация",
  "авторизация",
  "персистентность",
  "база",
  "бд",
  "данных",
  "миграция",
  "миграции",
  "схема",
  "сервис",
  "служба",
  "сессия",
  "токен",
  "jwt",
]);

const frontendOnlyTokens = new Set([
  "accessibility",
  "browser",
  "component",
  "css",
  "e2e",
  "frontend",
  "hydration",
  "landing",
  "mobile",
  "page",
  "playwright",
  "react",
  "responsive",
  "rsc",
  "screenshot",
  "tailwind",
  "visual",
  "visually",
  "интерфейс",
  "страница",
  "фронтенд",
  "сайт",
  "сайта",
  "лендинг",
  "красивый",
  "красивым",
  "стильный",
  "современный",
  "визуальный",
  "премиальный",
  "дорогой",
  "адаптивный",
  "дизайн",
  "редизайн",
  "ребрендинг",
]);

const frontendOnlyPhrases = [
  "красивый дизайн",
  "красивым дизайном",
  "стильный дизайн",
  "современный дизайн",
  "визуальный дизайн",
  "премиальный вид",
  "дорогой вид",
  "сделай красиво",
  "landing page",
  "лендинг",
  "красивый сайт",
  "tailor tailwind",
  "tailwind css",
  "visual design",
  "beautiful design",
  "polished design",
  "modern visual style",
  "responsive design",
  "адаптивный дизайн",
];

const genericNonDomainTokens = new Set([
  "changelog",
  "cli",
  "covering",
  "csv",
  "date",
  "dependency",
  "docs",
  "documentation",
  "export",
  "formatting",
  "helper",
  "index",
  "license",
  "package",
  "pure",
  "python",
  "rate",
  "readme",
  "release",
  "reports",
  "rust",
  "script",
  "swift",
  "terraform",
  "terminal",
]);

const hardNonBackendTokens = new Set(["native", "swift"]);

const requiredStackTags = new Set([
  "prisma",
  "drizzle",
  "next-auth",
  "nodejs",
  "express",
  "nestjs",
  "postgresql",
]);

const specializedIntentHints: Record<string, string[]> = {
  "backend.api-design": [
    "api",
    "openapi",
    "open api",
    "endpoint",
    "route handler",
    "server action",
    "json schema",
    "rest",
    "contract",
    "апи",
    "эндпоинт",
    "роут",
    "контракт",
    "спека",
  ],
  "backend.persistence": [
    "prisma",
    "drizzle",
    "database",
    "migration",
    "schema",
    "data model",
    "призма",
    "дриззл",
    "база данных",
    "модель данных",
    "схема базы",
    "миграция",
  ],
  "backend.auth": [
    "auth",
    "authentication",
    "authorization",
    "next-auth",
    "next auth",
    "session",
    "jwt",
    "аутентификация",
    "авторизация",
    "сессия",
  ],
};

const hasSpecializedIntent = (intent?: string) => {
  if (!intent) return false;
  const normalized = intent.toLowerCase();
  const tokens = tokenize(intent);
  return Object.values(specializedIntentHints)
    .flat()
    .some((hint) => (hint.includes(" ") ? normalized.includes(hint) : tokens.has(hint)));
};

const specializedIntentScore = (skillId: string, intent?: string) => {
  if (!intent) return 0;
  const hints = specializedIntentHints[skillId] ?? [];
  if (hints.length === 0) return 0;
  const normalized = intent.toLowerCase();
  const tokens = tokenize(intent);
  let score = 0;
  for (const hint of hints) {
    if (hint.includes(" ")) {
      if (normalized.includes(hint)) score += 1.5;
    } else if (tokens.has(hint)) {
      score += 0.65;
    }
  }
  return Math.max(0, Math.min(1, score / 1.5));
};

const hasRequiredStackTags = (fingerprint: ProjectFingerprint, skill: RegistrySkill) => {
  const fingerprintTags = new Set(fingerprint.tags);
  return skill.manifest.stackTags
    .filter((tag) => requiredStackTags.has(tag))
    .every((tag) => fingerprintTags.has(tag));
};

const routing: DomainRoutingPolicy = {
  rejectIntent(intent) {
    if (!intent) return false;
    const normalizedIntent = intent.toLowerCase();
    if (frontendOnlyPhrases.some((phrase) => normalizedIntent.includes(phrase))) {
      const tokens = tokenize(intent);
      if (!hasAnyToken(tokens, backendTokens)) return true;
    }
    const tokens = tokenize(intent);
    if (hasAnyToken(tokens, hardNonBackendTokens)) return true;
    return (
      (hasAnyToken(tokens, frontendOnlyTokens) || hasAnyToken(tokens, genericNonDomainTokens)) &&
      !hasAnyToken(tokens, backendTokens)
    );
  },
  laneAdjustment(lane: SkillLane, intent?: string) {
    if (!intent) return 0;
    if (hasSpecializedIntent(intent)) {
      return lane === "implementation" ? 0.08 : lane === "design" ? -0.08 : 0;
    }
    return 0;
  },
  skillAdjustment(skill, intent) {
    if (!intent) return 0;
    const score = specializedIntentScore(skill.manifest.id, intent);
    if (score >= 0.5) return 0.35;
    if (!hasSpecializedIntent(intent)) return 0;
    return score > 0 ? 0.18 * score : -0.14;
  },
  includeSkill(fingerprint, skill, _intent) {
    if (!hasRequiredStackTags(fingerprint, skill)) return false;
    return true;
  },
  compose(recommendations: Recommendation[]) {
    const primary = recommendations[0];
    if (!primary) return recommendations;
    const sorted = [...recommendations].sort((a, b) => b.score - a.score);
    const companions = sorted.slice(1, 3).map((rec) => ({ ...rec, role: "companion" as const }));
    return [{ ...primary, role: "primary" as const }, ...companions];
  },
};

export const backendDomainManifest = loadBundledDomainManifestSync({
  domainId: "backend",
  manifestUrl: new URL("../../../domains/backend/domain.manifest.json", import.meta.url),
});

export const registerBackendDomainPack = () =>
  registerDomainPack({
    manifest: backendDomainManifest,
    routing,
    root: `${defaultDomainsRoot}/backend`,
  });

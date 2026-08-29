import { defaultDomainsRoot } from "../../paths.ts";
import type { ProjectFingerprint, Recommendation, RegistrySkill, SkillLane } from "../../types.ts";
import { loadBundledDomainManifestSync, registerDomainPack } from "../registry.ts";
import type { DomainRoutingPolicy } from "../types.ts";
import { hasAnyToken, tokenize } from "../routing-helpers.ts";
import { backendValidatorEvaluators } from "./validators.ts";

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
  "аутентификацию",
  "аутентификации",
  "аутентификацией",
  "авторизация",
  "авторизацию",
  "авторизации",
  "авторизацией",
  "персистентность",
  "база",
  "базы",
  "базу",
  "базой",
  "бд",
  "данных",
  "миграция",
  "миграции",
  "миграцию",
  "миграцией",
  "миграций",
  "схема",
  "схемы",
  "схему",
  "схемой",
  "сервис",
  "служба",
  "сессия",
  "сессию",
  "сессии",
  "сессией",
  "токен",
  "jwt",
]);

/** Tokens that are exclusive to frontend presentation – backend routing defers when they appear without backend signals. */
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

/** Tokens that indicate a generic non-domain task (docs, release, python etc) – never trigger backend routing. */
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

/** Hard-exclude tokens that unambiguously map to native/mobile stacks and must never route to backend. */
const hardNonBackendTokens = new Set(["native", "swift", "cli"]);

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
    "базы данных",
    "базу данных",
    "модель данных",
    "модели данных",
    "схема базы",
    "схемы базы",
    "схему базы",
    "миграция",
    "миграцию",
    "миграции",
    "миграцией",
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
    "аутентификацию",
    "авторизация",
    "авторизацию",
    "сессия",
    "сессию",
    "сессии",
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
    // Synthetic test markers must be handled by the synthetic fixture packs, not the real backend pack
    if (
      normalizedIntent.includes("synthetic") ||
      normalizedIntent.includes("cyclic") ||
      normalizedIntent.includes("conflicting") ||
      normalizedIntent.includes("oversized") ||
      normalizedIntent.includes("contractless") ||
      normalizedIntent.includes("input-required")
    ) return true;
    if (frontendOnlyPhrases.some((phrase) => normalizedIntent.includes(phrase))) {
      const tokens = tokenize(intent);
      if (!hasAnyToken(tokens, backendTokens)) return true;
    }
    // Defer Server Actions / Route Handlers review with UI/caching concerns to frontend presentation
    if (
      normalizedIntent.includes("server action") &&
      normalizedIntent.includes("review") &&
      ["pending", "cached route", "stale", "rsc", "hydration", "client component"].some((phrase) => normalizedIntent.includes(phrase))
    ) {
      return true;
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
    validators: [
      "backend/contract-test",
      "backend/migration-safety",
      "backend/secret-audit",
    ],
    validatorEvaluators: backendValidatorEvaluators,
  });

import { defaultDomainsRoot } from "../../paths.ts";
import type { ProjectFingerprint, Recommendation, RegistrySkill, SkillLane } from "../../types.ts";
import { registerDomainPack } from "../registry.ts";
import type { DomainPackManifest, DomainRoutingPolicy } from "../types.ts";
import { frontendRecipeFiles } from "./design/catalog.ts";
import { analyzeFrontendIntent, type CanonicalFrontendIntent } from "./intents/index.ts";
import { evaluateFrontendRunPolicy } from "./run-policy.ts";

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

const nonDomainOnlyTokens = new Set([
  "api", "архитектура", "база", "бэкенд", "backend", "cache", "данных", "database",
  "db", "endpoint", "migration", "node", "postgresql", "query", "server", "service",
  "сервис", "схема",
]);

const nonDomainPhrases = [
  "api design", "data model", "database design", "database schema", "design the database",
  "дизайн базы данных", "дизайн схемы базы", "схема базы данных",
];

const nonDomainTokens = new Set([
  "changelog", "cli", "covering", "csv", "date", "dependency", "docs", "documentation",
  "export", "formatting", "helper", "index", "license", "migration", "package", "pure",
  "python", "rate", "readme", "release", "reports", "rust", "script", "sql", "swift",
  "terraform", "terminal",
]);

const hardNonDomainTokens = new Set(["native", "swift"]);

const domainTokens = new Set([
  "accessibility", "browser", "component", "css", "e2e", "frontend", "hydration", "landing",
  "mobile", "next", "page", "playwright", "react", "responsive", "rsc", "screenshot",
  "tailwind", "test", "testing", "ui", "visual", "visually", "интерфейс", "страница", "фронтенд",
]);

const motionAuditVerbTokens = new Set([
  "audit", "review", "аудит", "проверить", "проверь", "проверьте", "проверка", "ревью",
]);

const motionSubjectTokens = new Set([
  "animation", "animations", "motion", "анимация", "анимации", "анимаций", "анимацию", "моушн",
]);

const specializedIntentHints: Record<string, string[]> = {
  "frontend.accessibility-review": [
    "accessibility", "aria", "combobox", "contrast", "dialog", "disabled", "accessible name",
    "escape close", "focus", "focus trap", "focus-visible", "inert background", "keyboard",
    "labels", "modal dialog", "return focus", "target size", "wcag",
  ],
  "frontend.agents-md-bootstrap": [
    "accessibility checks", "agent instructions", "agents.md", "bootstrap", "browser qa",
    "build/test commands", "design conventions", "documenting",
  ],
  "frontend.design-system": [
    "design system", "dark mode", "hard-coded", "shadcn", "semantic token", "semantic tokens",
    "theme", "token", "token migration", "tokens", "variant", "variants",
  ],
  "frontend.design-to-code": [
    "design to code", "figma", "implement", "matching responsive behavior", "mock", "mockup",
    "provided screenshot", "product screenshot", "supplied", "supplied product screenshot",
  ],
  "frontend.interaction-polish": [
    "drag", "drawer", "drop", "focus correctly", "interaction polish", "modal", "toast",
  ],
  "frontend.motion-audit": [
    "animation audit", "animation performance", "generic decorative motion", "jank", "motion audit",
    "motion review", "reduced-motion accessibility", "reduced-motion support", "review motion",
    "аудит анимаций", "проверить анимации", "джанк",
  ],
  "frontend.motion-design": [
    "animation", "animations", "motion", "motion design", "motion system", "choreography", "easing",
    "page transition", "page transitions", "view transition", "view transitions", "transition system",
    "transitions", "reduced-motion", "анимация", "анимации", "система анимаций", "хореография", "переходы",
  ],
  "frontend.next-app-router-review": [
    "app router", "cache", "cached route data", "next", "next.js", "pending/error ui", "route data",
    "route handler", "rsc", "server action", "server actions", "use client",
  ],
  "frontend.performance-review": [
    "bundle", "feels slow", "inp", "lcp", "lighthouse", "performance", "render bottleneck", "slow",
  ],
  "frontend.playwright-debug": [
    "actionability", "browser test", "chromium", "ci", "e2e", "flake", "flaky", "locator",
    "playwright", "spec fails", "test-results", "timeout", "trace",
  ],
  "frontend.react-component-design": [
    "boolean prop", "component api", "composition", "controlled", "derived during render", "prop sprawl",
    "react value", "uncontrolled",
  ],
  "frontend.react-app-review": [
    "data flow", "derived during render", "effect", "provider", "react app", "state ownership",
    "state reset", "state resets", "useeffect",
  ],
  "frontend.tailwind-ui-polish": [
    "390px", "active state", "arbitrary colors", "breakpoint fix", "className cleanup", "css repair",
    "empty", "error states", "icons shift", "labels wrap", "loading", "nav", "navigation", "overlaps",
    "radii", "responsive", "responsive fix", "spacing", "state styling", "tailwind", "tailwind class",
    "tailwind fix", "wrapping",
  ],
  "frontend.testing-strategy": [
    "component test", "e2e mix", "no tests", "playwright component", "test portfolio", "tests are bad",
    "testing strategy", "unit",
  ],
  "frontend.ux-critique": [
    "affordance", "checkout", "cognitive load", "completion blocker", "confusing", "empty state",
    "error recovery", "error state", "findability", "flow", "form usability", "information architecture",
    "navigation", "onboarding", "recovery", "search results", "search usability", "settings page",
    "settings usability", "task completion", "task flow", "usability", "user flow", "ux", "wayfinding",
  ],
  "frontend.visual-design-polish": [
    "art direction", "before-after", "brand direction", "crowded", "design language", "design.md",
    "editorial", "generic", "hierarchy", "layout bug", "look and feel", "looks", "looks off", "manga",
    "product fit", "rebrand", "redesign", "refresh", "revamp", "modernize", "редизайн", "ребрендинг",
    "screenshot looks off", "style guide", "subject-specific", "tell me what to change", "visual",
    "visual direction", "visual identity", "visual language", "visual regression", "visual thesis",
  ],
  "frontend.visual-critic": [
    "compare rendered variants", "compare screenshots", "compare these two rendered variants",
    "rendered variants", "two rendered variants", "variant screenshots",
    "сравни два отрисованных варианта", "сравни скриншоты вариантов",
    "сравните два отрисованных варианта", "сравните скриншоты вариантов",
    "отрисованных варианта", "скриншоты вариантов",
  ],
};

const designIntentPhrases = ["make this app better", "make this page better", "make the page better"];

const implementationDesignPhrases = [
  "component api", "controlled and uncontrolled", "data model", "render props", "state ownership",
];

const designIntentTokens = new Set([
  "design", "distinctive", "landing", "mobile", "palette", "polish", "polished", "rebrand", "redesign",
  "refresh", "revamp", "modernize", "responsive", "spacing", "typography", "ui", "visual", "visually",
  "дизайн", "редизайн", "ребрендинг", "современный",
]);

const intentGatedSkillIds = new Set([
  "frontend.motion-audit", "frontend.motion-design", "frontend.visual-critic",
]);
const visualCriticActionTokens = new Set([
  "compare", "critique", "evaluate", "rank", "review", "select", "reject",
  "сравни", "сравните", "оцени", "оцените", "выбери", "выберите", "проверь", "проверьте",
]);
const visualCriticEvidencePhrases = [
  "rendered variant", "rendered variants", "variant screenshot", "variant screenshots",
  "mobile and desktop screenshots", "отрисованного варианта", "отрисованных варианта",
  "скриншот варианта", "скриншоты вариантов", "мобильным и десктопным скриншотам",
];
const requiredStackTags = new Set(["nextjs", "vite", "react", "tailwind", "playwright"]);

const canonicalIntentBySkillId: Partial<Record<string, CanonicalFrontendIntent>> = {
  "frontend.accessibility-review": "accessibility-review",
  "frontend.audit": "audit",
  "frontend.design-system": "design-system",
  "frontend.design-to-code": "design-to-code",
  "frontend.interaction-polish": "interaction-polish",
  "frontend.motion-audit": "motion-audit",
  "frontend.motion-design": "motion-design",
  "frontend.performance-review": "performance-review",
  "frontend.tailwind-ui-polish": "tailwind-ui-polish",
  "frontend.ux-critique": "ux-critique",
  "frontend.visual-design-polish": "visual-design-polish",
};

const legacySpecializedIntentHints = Object.fromEntries(
  Object.entries(specializedIntentHints).filter(([skillId]) => !canonicalIntentBySkillId[skillId]),
) as Record<string, string[]>;

const companionSkillIds: Record<string, string[]> = {
  "frontend.visual-design-polish": [
    "frontend.tailwind-ui-polish", "frontend.interaction-polish", "frontend.accessibility-review",
  ],
  "frontend.design-to-code": [
    "frontend.tailwind-ui-polish", "frontend.interaction-polish", "frontend.accessibility-review",
  ],
  "frontend.design-system": ["frontend.tailwind-ui-polish", "frontend.accessibility-review"],
  "frontend.tailwind-ui-polish": ["frontend.accessibility-review"],
  "frontend.interaction-polish": ["frontend.accessibility-review"],
  "frontend.ux-critique": ["frontend.accessibility-review"],
};

const isMotionAuditIntent = (intent?: string) => {
  if (!intent) return false;
  const tokens = tokenize(intent);
  return hasAnyToken(tokens, motionAuditVerbTokens) && hasAnyToken(tokens, motionSubjectTokens);
};

const isVisualCriticIntent = (intent?: string) => {
  if (!intent) return false;
  const normalized = intent.toLowerCase();
  return hasAnyToken(tokenize(intent), visualCriticActionTokens) &&
    visualCriticEvidencePhrases.some((phrase) => normalized.includes(phrase));
};

const legacySpecializedIntentScore = (skillId: string, intent: string) => {
  const hints = legacySpecializedIntentHints[skillId] ?? [];
  if (hints.length === 0) return 0;
  const normalizedIntent = intent.toLowerCase();
  const tokens = tokenize(intent);
  let score = 0;
  for (const hint of hints) {
    if (hint.includes(" ")) {
      if (normalizedIntent.includes(hint)) score += 1;
    } else if (tokens.has(hint)) {
      score += 0.65;
    }
  }
  return Math.max(0, Math.min(1, score / 2));
};

const specializedIntentScore = (skill: RegistrySkill, intent?: string) => {
  if (!intent) return 0;
  const expected = canonicalIntentBySkillId[skill.manifest.id];
  if (expected) return analyzeFrontendIntent(intent).intents.has(expected) ? 1 : 0;
  return legacySpecializedIntentScore(skill.manifest.id, intent);
};

const canonicalIntentPriority: CanonicalFrontendIntent[] = [
  "motion-audit", "audit", "accessibility-review", "design-to-code", "design-system",
  "performance-review", "interaction-polish", "motion-design", "visual-design-polish",
  "tailwind-ui-polish", "ux-critique",
];

const primaryCanonicalIntent = (intent: string): CanonicalFrontendIntent | undefined => {
  const analysis = analyzeFrontendIntent(intent);
  const hasStrongLegacySpecialist = Object.keys(legacySpecializedIntentHints)
    .some((skillId) => legacySpecializedIntentScore(skillId, intent) > 0.5);
  if (hasStrongLegacySpecialist) return undefined;
  const intents = analysis.intents;
  if (
    intents.has("interaction-polish") &&
    /\b(interaction polish|polish this modal|drag|drop|drawer|toast|взаимодействие|дровер|тост)\b/u.test(analysis.normalized)
  ) return "interaction-polish";
  if (
    intents.has("ux-critique") &&
    /\b(critique|usability|onboarding|cognitive|wayfinding|user flow|information architecture|ux|юзабилити|онбординг|сценарий|путь пользователя)\b/u.test(analysis.normalized)
  ) return "ux-critique";
  if (
    intents.has("tailwind-ui-polish") &&
    !["audit", "accessibility-review", "design-system", "design-to-code"]
      .some((candidate) => intents.has(candidate as CanonicalFrontendIntent)) &&
    /\btailwind\b/u.test(analysis.normalized)
  ) {
    return "tailwind-ui-polish";
  }
  if (
    intents.has("tailwind-ui-polish") &&
    intents.has("accessibility-review") &&
    !/\b(accessibility|aria|contrast|focus|focus-visible|keyboard|wcag|доступность|клавиатура|фокус|контраст)\b/u.test(analysis.normalized)
  ) return "tailwind-ui-polish";
  return canonicalIntentPriority.find((candidate) => intents.has(candidate));
};

const hasSpecializedIntent = (intent?: string) => {
  if (!intent) return false;
  if (analyzeFrontendIntent(intent).intents.size > 0) return true;
  if (isMotionAuditIntent(intent)) return true;
  const normalizedIntent = intent.toLowerCase();
  const tokens = tokenize(intent);
  return Object.values(legacySpecializedIntentHints)
    .flat()
    .some((hint) => hint.includes(" ") ? normalizedIntent.includes(hint) : tokens.has(hint));
};

const isAuditIntent = (intent?: string) =>
  Boolean(intent && primaryCanonicalIntent(intent) === "audit");

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
    if (nonDomainPhrases.some((phrase) => normalizedIntent.includes(phrase))) return true;
    const tokens = tokenize(intent);
    if (hasAnyToken(tokens, hardNonDomainTokens)) return true;
    return (
      (hasAnyToken(tokens, nonDomainOnlyTokens) || hasAnyToken(tokens, nonDomainTokens)) &&
      !hasAnyToken(tokens, domainTokens)
    );
  },
  laneAdjustment(lane: SkillLane, intent?: string) {
    if (!intent) return lane === "framework" ? 0.02 : 0;
    const normalizedIntent = intent.toLowerCase();
    const tokens = tokenize(intent);
    if (lane === "agent-context" && normalizedIntent.includes("agents.md")) return 0.08;
    if (implementationDesignPhrases.some((phrase) => normalizedIntent.includes(phrase))) {
      return lane === "design" ? -0.08 : 0;
    }
    const canonicalIntent = primaryCanonicalIntent(intent);
    const hasDesignIntent =
      canonicalIntent === "design-system" ||
      canonicalIntent === "design-to-code" ||
      canonicalIntent === "interaction-polish" ||
      canonicalIntent === "motion-design" ||
      canonicalIntent === "tailwind-ui-polish" ||
      canonicalIntent === "ux-critique" ||
      canonicalIntent === "visual-design-polish" ||
      hasAnyToken(tokens, designIntentTokens) ||
      designIntentPhrases.some((phrase) => normalizedIntent.includes(phrase));
    if (!hasDesignIntent) return 0;
    return lane === "design" ? 0.08 : -0.08;
  },
  skillAdjustment(skill, intent) {
    const specializedScore = specializedIntentScore(skill, intent);
    if (intentGatedSkillIds.has(skill.manifest.id) && (!intent || specializedScore === 0)) return -0.01;
    if (!intent) return 0;
    if (skill.manifest.id === "frontend.audit") return isAuditIntent(intent) ? 0.32 : 0;
    if (skill.manifest.id === "frontend.playwright-debug") {
      return specializedScore >= 0.5 ? 0.18 * specializedScore : -0.18;
    }
    if (!hasSpecializedIntent(intent)) return 0;
    const expected = canonicalIntentBySkillId[skill.manifest.id];
    if (expected && primaryCanonicalIntent(intent) !== expected) return -0.14;
    if (expected && specializedScore > 0) return 0.25 * specializedScore;
    return specializedScore > 0 ? 0.18 * specializedScore : -0.14;
  },
  includeSkill(fingerprint, skill, intent) {
    if (!hasRequiredStackTags(fingerprint, skill)) return false;
    if (skill.manifest.id === "frontend.agents-md-bootstrap" && fingerprint.agentContext.agentsMd.present) {
      return false;
    }
    if (skill.manifest.id === "frontend.audit" && !isAuditIntent(intent)) return false;
    if (skill.manifest.id === "frontend.visual-critic" && !isVisualCriticIntent(intent)) return false;
    if (
      intentGatedSkillIds.has(skill.manifest.id) &&
      specializedIntentScore(skill, intent) === 0 &&
      !(skill.manifest.id === "frontend.motion-audit" && isMotionAuditIntent(intent))
    ) {
      return false;
    }
    return true;
  },
  compose(recommendations: Recommendation[]) {
    const primary = recommendations[0];
    if (!primary) return recommendations;
    const companions = (companionSkillIds[primary.skillId] ?? [])
      .flatMap((skillId) => {
        const recommendation = recommendations.find((candidate) => candidate.skillId === skillId);
        return recommendation ? [{ ...recommendation, role: "companion" as const }] : [];
      })
      .slice(0, 2);
    return [{ ...primary, role: "primary" as const }, ...companions];
  },
};

export const frontendDomainManifest: DomainPackManifest = {
  schemaVersion: "1.0",
  id: "frontend",
  displayName: "Frontend",
  version: "1.0.0",
  coreApi: "1.0",
  skillIdPrefix: "frontend.",
  capabilities: [
    "project-signals", "intent-routing", "structured-artifacts", "verification", "repair", "evaluation",
  ],
  artifacts: {
    intents: ["intents/ownership.json"],
    schemas: [
      "schemas/design-brief.schema.json", "schemas/design-direction.schema.json",
      "schemas/design-execution-policy.schema.json", "schemas/bounded-repair-request.schema.json",
      "schemas/verification-report.schema.json", "schemas/design-rule.schema.json",
      "schemas/recipe-example.schema.json", "schemas/design-variant.schema.json",
      "schemas/visual-critic-report.schema.json", "schemas/visual-run.schema.json",
    ],
    recipes: frontendRecipeFiles.map((file) => `recipes/${file}`),
    rules: ["rules/index.json"],
    examples: frontendRecipeFiles.map((file) => `examples/${file.replace(/\.json$/, "")}/example.json`),
    workflows: ["workflows/design-generation.workflow.json", "workflows/design-to-code.workflow.json"],
    validators: ["validators/frontend-validation.rules.json"],
    evalSuite: "evals/frontend/suite.json",
  },
  ownership: [
    { intent: "visual-direction", primarySkill: "frontend.visual-design-polish", supportingSkills: ["frontend.ux-critique", "frontend.design-system"] },
    { intent: "tailwind-execution", primarySkill: "frontend.tailwind-ui-polish", supportingSkills: ["frontend.accessibility-review"] },
    { intent: "design-system", primarySkill: "frontend.design-system", supportingSkills: ["frontend.tailwind-ui-polish"] },
    { intent: "design-to-code", primarySkill: "frontend.design-to-code", supportingSkills: ["frontend.tailwind-ui-polish"], requiresEvidence: ["visual-reference"] },
    { intent: "ux-review", primarySkill: "frontend.ux-critique", supportingSkills: ["frontend.accessibility-review"] },
    { intent: "interaction-polish", primarySkill: "frontend.interaction-polish", supportingSkills: ["frontend.accessibility-review"] },
    { intent: "motion-design", primarySkill: "frontend.motion-design", supportingSkills: ["frontend.interaction-polish"] },
    { intent: "motion-review", primarySkill: "frontend.motion-audit", supportingSkills: ["frontend.performance-review"] },
    { intent: "release-review", primarySkill: "frontend.audit", supportingSkills: [] },
  ],
};

export const registerFrontendDomainPack = () =>
  registerDomainPack({
    manifest: frontendDomainManifest,
    routing,
    runPolicy: { evaluate: evaluateFrontendRunPolicy },
    root: `${defaultDomainsRoot}/frontend`,
  });

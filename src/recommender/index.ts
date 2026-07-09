import type {
  ProjectFingerprint,
  Recommendation,
  RegistrySkill,
  SkillLane,
} from "../types.ts";

export type RecommendSkillsOptions = {
  targetAgent?: string;
  userIntent?: string;
  lane?: SkillLane;
  limitPerLane?: number;
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

const tokenize = (input: string) =>
  new Set(
    input
      .toLowerCase()
      .split(/[^\p{L}\p{N}+.#-]+/u)
      .map((part) => part.trim())
      .map((part) => part.replace(/^[.,:;!?()[\]{}"']+|[.,:;!?()[\]{}"']+$/g, ""))
      .filter(Boolean),
  );

const overlapScore = (left: string[], right: string[]) => {
  if (right.length === 0) return 0;
  const leftSet = new Set(left.map((item) => item.toLowerCase()));
  const hits = right.filter((item) => leftSet.has(item.toLowerCase())).length;
  return hits / right.length;
};

const freshnessScore = (date?: string) => {
  if (!date) return 0.5;
  const reviewed = Date.parse(date);
  if (Number.isNaN(reviewed)) return 0.5;
  const ageDays = (Date.now() - reviewed) / 86_400_000;
  if (ageDays <= 180) return 1;
  if (ageDays <= 540) return 0.75;
  return 0.45;
};

const fieldTokens = (values: string[]) => tokenize(values.join(" "));

const backendOnlyIntentTokens = new Set([
  "api",
  "архитектура",
  "база",
  "бэкенд",
  "backend",
  "cache",
  "данных",
  "database",
  "db",
  "endpoint",
  "migration",
  "node",
  "postgresql",
  "query",
  "server",
  "service",
  "сервис",
  "схема",
]);

const backendArchitecturePhrases = [
  "api design",
  "data model",
  "database design",
  "database schema",
  "design the database",
  "дизайн базы данных",
  "дизайн схемы базы",
  "схема базы данных",
];

const nonFrontendIntentTokens = new Set([
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
  "migration",
  "package",
  "pure",
  "python",
  "rate",
  "readme",
  "release",
  "reports",
  "rust",
  "script",
  "sql",
  "swift",
  "terraform",
  "terminal",
]);

const hardNonFrontendIntentTokens = new Set(["native", "swift"]);

const frontendIntentTokens = new Set([
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
  "screenshot",
  "tailwind",
  "test",
  "testing",
  "ui",
  "visual",
  "visually",
  "интерфейс",
  "страница",
  "фронтенд",
  "ui",
]);

const specializedIntentHints: Record<string, string[]> = {
  "frontend.accessibility-review": [
    "accessibility",
    "aria",
    "combobox",
    "contrast",
    "dialog",
    "disabled",
    "accessible name",
    "escape close",
    "focus",
    "focus trap",
    "focus-visible",
    "inert background",
    "keyboard",
    "labels",
    "modal dialog",
    "return focus",
    "target size",
    "wcag",
  ],
  "frontend.agents-md-bootstrap": [
    "accessibility checks",
    "agent instructions",
    "agents.md",
    "bootstrap",
    "browser qa",
    "build/test commands",
    "design conventions",
    "documenting",
  ],
  "frontend.design-system": [
    "design system",
    "dark mode",
    "hard-coded",
    "shadcn",
    "semantic token",
    "semantic tokens",
    "theme",
    "token",
    "token migration",
    "tokens",
    "variant",
    "variants",
  ],
  "frontend.design-to-code": [
    "design to code",
    "figma",
    "implement",
    "matching responsive behavior",
    "mock",
    "mockup",
    "provided screenshot",
    "product screenshot",
    "supplied",
    "supplied product screenshot",
  ],
  "frontend.interaction-polish": [
    "animation",
    "drag",
    "drawer",
    "drop",
    "focus correctly",
    "modal",
    "motion",
    "toast",
    "transition",
  ],
  "frontend.next-app-router-review": [
    "app router",
    "cache",
    "cached route data",
    "next",
    "next.js",
    "pending/error ui",
    "route data",
    "route handler",
    "rsc",
    "server action",
    "server actions",
    "use client",
  ],
  "frontend.performance-review": [
    "bundle",
    "feels slow",
    "inp",
    "lcp",
    "lighthouse",
    "performance",
    "render bottleneck",
    "slow",
  ],
  "frontend.playwright-debug": [
    "actionability",
    "browser test",
    "chromium",
    "ci",
    "e2e",
    "flake",
    "flaky",
    "locator",
    "playwright",
    "spec fails",
    "test-results",
    "timeout",
    "trace",
  ],
  "frontend.react-component-design": [
    "boolean prop",
    "component api",
    "composition",
    "controlled",
    "derived during render",
    "prop sprawl",
    "react value",
    "uncontrolled",
  ],
  "frontend.react-app-review": [
    "data flow",
    "derived during render",
    "effect",
    "effects",
    "provider",
    "react app",
    "state ownership",
    "state reset",
    "state resets",
    "useeffect",
  ],
  "frontend.tailwind-ui-polish": [
    "390px",
    "active state",
    "arbitrary colors",
    "empty",
    "error states",
    "icons shift",
    "labels wrap",
    "loading",
    "nav",
    "navigation",
    "overlaps",
    "radii",
    "responsive",
    "spacing",
    "state styling",
    "tailwind",
    "wrapping",
  ],
  "frontend.testing-strategy": [
    "component test",
    "e2e mix",
    "no tests",
    "playwright component",
    "test portfolio",
    "tests are bad",
    "testing strategy",
    "unit",
  ],
  "frontend.ux-critique": [
    "affordance",
    "checkout",
    "completion blocker",
    "confusing",
    "flow",
    "onboarding",
    "ux",
  ],
  "frontend.visual-design-polish": [
    "before-after",
    "crowded",
    "editorial",
    "generic",
    "hierarchy",
    "layout bug",
    "looks",
    "looks off",
    "manga",
    "product fit",
    "redesign",
    "rebrand",
    "refresh",
    "revamp",
    "modernize",
    "редизайн",
    "ребрендинг",
    "screenshot looks off",
    "tell me what to change",
    "visual",
    "visual direction",
    "visual regression",
  ],
};

const designIntentPhrases = [
  "make this app better",
  "make this page better",
  "make the page better",
];

const frontendAuditIntentPhrases = [
  "cross-cutting frontend",
  "final frontend review",
  "frontend audit",
  "frontend scorecard",
  "release readiness",
  "release-readiness",
  "whole frontend",
];

const implementationDesignPhrases = [
  "component api",
  "controlled and uncontrolled",
  "data model",
  "render props",
  "state ownership",
];

const designIntentTokens = new Set([
  "design",
  "distinctive",
  "landing",
  "mobile",
  "palette",
  "polish",
  "polished",
  "rebrand",
  "redesign",
  "refresh",
  "revamp",
  "modernize",
  "responsive",
  "spacing",
  "typography",
  "ui",
  "visual",
  "visually",
  "дизайн",
  "редизайн",
  "ребрендинг",
  "современный",
]);

const hasAnyToken = (tokens: Set<string>, expected: Set<string>) =>
  [...tokens].some((token) => expected.has(token));

const isFrontendAuditIntent = (intent?: string) => {
  if (!intent) return false;
  const normalizedIntent = intent.toLowerCase();
  return frontendAuditIntentPhrases.some((phrase) =>
    normalizedIntent.includes(phrase),
  );
};

const hasImplementationDesignIntent = (intent?: string) =>
  Boolean(
    intent &&
      implementationDesignPhrases.some((phrase) =>
        intent.toLowerCase().includes(phrase),
      ),
  );

const isBackendOnlyIntent = (intent?: string) => {
  if (!intent) return false;
  const normalizedIntent = intent.toLowerCase();
  if (backendArchitecturePhrases.some((phrase) => normalizedIntent.includes(phrase))) {
    return true;
  }
  const tokens = tokenize(intent);
  if (hasAnyToken(tokens, hardNonFrontendIntentTokens)) return true;
  return (
    (hasAnyToken(tokens, backendOnlyIntentTokens) || hasAnyToken(tokens, nonFrontendIntentTokens)) &&
    !hasAnyToken(tokens, frontendIntentTokens)
  );
};

const intentLaneAdjustment = (lane: SkillLane, intent?: string) => {
  if (!intent) return 0;
  const normalizedIntent = intent.toLowerCase();
  const tokens = tokenize(intent);
  if (lane === "agent-context" && normalizedIntent.includes("agents.md")) return 0.08;
  if (hasImplementationDesignIntent(intent)) return lane === "design" ? -0.08 : 0;
  const hasDesignIntent =
    hasAnyToken(tokens, designIntentTokens) ||
    designIntentPhrases.some((phrase) => normalizedIntent.includes(phrase));
  if (!hasDesignIntent) return 0;
  return lane === "design" ? 0.08 : -0.08;
};

const specializedIntentScore = (skill: RegistrySkill, intent?: string) => {
  if (!intent) return 0;
  const hints = specializedIntentHints[skill.manifest.id] ?? [];
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
  return clamp(score / 2);
};

const hasSpecializedIntent = (intent?: string) => {
  if (!intent) return false;
  const normalizedIntent = intent.toLowerCase();
  const tokens = tokenize(intent);
  return Object.values(specializedIntentHints)
    .flat()
    .some((hint) => hint.includes(" ") ? normalizedIntent.includes(hint) : tokens.has(hint));
};

const intentSkillAdjustment = (skill: RegistrySkill, intent?: string) => {
  if (!intent) return 0;
  if (skill.manifest.id === "frontend.audit") {
    return isFrontendAuditIntent(intent) ? 0.25 : 0;
  }
  const specializedScore = specializedIntentScore(skill, intent);
  if (skill.manifest.id === "frontend.playwright-debug") {
    return specializedScore >= 0.5 ? 0.18 * specializedScore : -0.18;
  }
  if (!hasSpecializedIntent(intent)) return 0;
  return specializedScore > 0 ? 0.18 * specializedScore : -0.14;
};

const intentScore = (skill: RegistrySkill, intent?: string) => {
  if (!intent) return 0.5;
  const tokens = tokenize(intent);
  if (tokens.size === 0) return 0.5;

  const identityTokens = fieldTokens([
    skill.manifest.id,
    skill.manifest.name,
    skill.manifest.displayName,
  ]);
  const taskTokens = fieldTokens(skill.manifest.taskTags);
  const stackTokens = fieldTokens(skill.manifest.stackTags);
  const descriptionTokens = fieldTokens([skill.manifest.description]);

  let score = 0;
  for (const token of tokens) {
    if (identityTokens.has(token)) score += 1;
    else if (taskTokens.has(token)) score += 0.55;
    else if (stackTokens.has(token)) score += 0.45;
    else if (descriptionTokens.has(token)) score += 0.25;
  }
  return score / tokens.size;
};

const compatibilityScore = (skill: RegistrySkill, targetAgent: string) => {
  const compatibility = skill.manifest.compatibility?.[targetAgent];
  if (!compatibility)
    return skill.manifest.supportedAgents.includes(targetAgent) ? 1 : 0;
  if (compatibility.level === "native") return 1;
  if (compatibility.level === "packageable") return 0.65;
  if (compatibility.level === "convertible") return 0.45;
  return 0;
};

const rounded = (value: number) => Number(value.toFixed(3));

const requiredStackTags = new Set(["nextjs", "vite", "react", "tailwind", "playwright"]);

const hasRequiredStackTags = (
  fingerprint: ProjectFingerprint,
  skill: RegistrySkill,
) => {
  const fingerprintTags = new Set(fingerprint.tags);
  return skill.manifest.stackTags
    .filter((tag) => requiredStackTags.has(tag))
    .every((tag) => fingerprintTags.has(tag));
};

const isAlreadyCoveredByAgentContext = (
  fingerprint: ProjectFingerprint,
  skill: RegistrySkill,
) => {
  return skill.manifest.id === "frontend.agents-md-bootstrap" && fingerprint.agentContext.agentsMd.present;
};

const fallbackLane = (skill: RegistrySkill): SkillLane => {
  if (skill.manifest.id.includes("agents-md")) return "agent-context";
  if (
    skill.manifest.taskTags.some((tag) =>
      ["testing", "e2e-testing", "qa", "debugging"].includes(tag),
    )
  ) {
    return "qa";
  }
  if (
    skill.manifest.taskTags.some((tag) =>
      [
        "visual-design",
        "design-system",
        "design-to-code",
        "interaction-polish",
        "ux",
        "styling",
      ].includes(tag),
    )
  ) {
    return "design";
  }
  if (skill.manifest.stackTags.includes("nextjs")) return "framework";
  return "implementation";
};

export const groupRecommendationsByLane = (recommendations: Recommendation[]) => {
  const groups: Array<{ lane: SkillLane; recommendations: Recommendation[] }> = [];
  const groupIndex = new Map<SkillLane, number>();
  for (const recommendation of recommendations) {
    const lane = recommendation.lane ?? "implementation";
    const existingIndex = groupIndex.get(lane);
    if (existingIndex === undefined) {
      groupIndex.set(lane, groups.length);
      groups.push({ lane, recommendations: [recommendation] });
    } else {
      groups[existingIndex].recommendations.push(recommendation);
    }
  }
  return groups;
};

export const recommendSkills = (
  fingerprint: ProjectFingerprint,
  skills: RegistrySkill[],
  options: RecommendSkillsOptions = {},
): Recommendation[] => {
  const targetAgent = options.targetAgent ?? "codex";
  if (isBackendOnlyIntent(options.userIntent)) return [];

  const rankedRecommendations = skills
    .flatMap((skill) => {
      const stackMatch = overlapScore(
        fingerprint.tags,
        skill.manifest.stackTags,
      );
      const userIntentMatch = intentScore(skill, options.userIntent);
      const qualityScore = clamp(skill.manifest.qualityScore);
      const securityScore = clamp(skill.manifest.securityScore);
      const freshScore = freshnessScore(
        skill.manifest.freshness?.lastReviewedAt,
      );
      const agentCompatibilityScore = compatibilityScore(skill, targetAgent);
      const lane = skill.manifest.routing?.lane ?? fallbackLane(skill);
      if (agentCompatibilityScore === 0) return [];
      if (
        skill.manifest.id === "frontend.audit" &&
        !isFrontendAuditIntent(options.userIntent)
      ) {
        return [];
      }
      if (skill.manifest.stackTags.length > 0 && stackMatch === 0) return [];
      if (!hasRequiredStackTags(fingerprint, skill)) return [];
      if (isAlreadyCoveredByAgentContext(fingerprint, skill)) return [];

      const duplicatePenalty =
        fingerprint.agentContext.codexSkills.present &&
        skill.manifest.supportedAgents.includes("codex")
          ? 0.2
          : 0;
      const laneAdjustment = intentLaneAdjustment(lane, options.userIntent);
      const skillAdjustment = intentSkillAdjustment(skill, options.userIntent);

      const score =
        0.3 * stackMatch +
        0.2 * userIntentMatch +
        0.15 * qualityScore +
        0.15 * securityScore +
        0.08 * freshScore +
        0.07 * agentCompatibilityScore -
        0.02 * duplicatePenalty +
        laneAdjustment +
        skillAdjustment;

      const reasons: string[] = [];
      const matchedStackTags = skill.manifest.stackTags.filter((tag) =>
        fingerprint.tags.includes(tag),
      );
      for (const tag of skill.manifest.stackTags) {
        if (fingerprint.tags.includes(tag)) reasons.push(`${tag} detected`);
      }
      if (agentCompatibilityScore === 1)
        reasons.push(`supports ${targetAgent}`);
      if (options.userIntent && userIntentMatch > 0.7)
        reasons.push("matches user intent");
      if (skillAdjustment > 0)
        reasons.push("specialized intent boost");
      if (laneAdjustment > 0)
        reasons.push(`${lane} lane matches intent`);
      if (skill.manifest.riskLevel === "low")
        reasons.push("low-risk instruction-only skill");
      if (!fingerprint.agentContext.codexSkills.present)
        reasons.push("no similar repo-local skill directory detected");

      return [
        {
          skillId: skill.manifest.id,
          displayName: skill.manifest.displayName,
          lane,
          category: skill.manifest.routing?.category,
          score: rounded(score),
          scoreBreakdown: {
            stackMatch: rounded(stackMatch),
            userIntentMatch: rounded(userIntentMatch),
            qualityScore: rounded(qualityScore),
            securityScore: rounded(securityScore),
            freshnessScore: rounded(freshScore),
            compatibilityScore: rounded(agentCompatibilityScore),
            duplicatePenalty: rounded(duplicatePenalty),
            laneAdjustment: rounded(laneAdjustment),
            skillAdjustment: rounded(skillAdjustment),
            finalScore: rounded(score),
          },
          riskLevel: skill.manifest.riskLevel,
          reasons: [
            ...reasons,
            matchedStackTags.length > 0
              ? `score driven by stack match ${stackMatch.toFixed(2)} (${matchedStackTags.join(", ")})`
              : `score driven by baseline quality/security/freshness`,
          ].slice(0, 6),
        },
      ];
    })
    .filter((recommendation) => recommendation.score > 0.25)
    .sort((a, b) => b.score - a.score || a.skillId.localeCompare(b.skillId));

  const laneRecommendations = options.lane
    ? rankedRecommendations.filter(
        (recommendation) => recommendation.lane === options.lane,
      )
    : rankedRecommendations;

  const limitPerLane = options.limitPerLane;
  if (typeof limitPerLane === "number" && Number.isInteger(limitPerLane) && limitPerLane > 0) {
    return groupRecommendationsByLane(laneRecommendations).flatMap((group) =>
      group.recommendations.slice(0, limitPerLane),
    );
  }

  return laneRecommendations;
};

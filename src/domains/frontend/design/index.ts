import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultDomainsRoot } from "../../../paths.ts";
import type { VerificationReport } from "../../../runtime/types.ts";
import type { ProjectFingerprint } from "../../../types.ts";
import type { DesignBrief, DesignDirection, DesignRecipe } from "./types.ts";
export * from "./types.ts";
export * from "./policy-types.ts";
export * from "./policy.ts";
export * from "./validation.ts";
export * from "./browser.ts";
export * from "./source-validation.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const asDesignBrief = (value: unknown): DesignBrief | undefined => {
  if (!isRecord(value)) return undefined;
  const candidate = value as Partial<DesignBrief>;
  return candidate.schemaVersion === "1.0"
    && isRecord(candidate.product)
    && isRecord(candidate.surface)
    && isRecord(candidate.evidence)
    && Array.isArray(candidate.evidence.observed)
    ? candidate as DesignBrief
    : undefined;
};

const recipesRoot = path.join(defaultDomainsRoot, "frontend", "recipes");
const recipeFiles = [
  "operational-command-center.json",
  "consumer-discovery.json",
  "developer-tool.json",
  "editorial-content.json",
];

export const loadFrontendRecipes = async (): Promise<DesignRecipe[]> =>
  Promise.all(
    recipeFiles.map(async (file) =>
      JSON.parse(await readFile(path.join(recipesRoot, file), "utf8")) as DesignRecipe,
    ),
  );

const words = (value: string) => new Set(value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));

export const recommendFrontendRecipe = (
  brief: DesignBrief,
  recipes: DesignRecipe[],
) => {
  const evidence = words([
    brief.product.domain,
    brief.product.primaryTask,
    brief.surface.type,
    ...brief.product.contentTypes,
    ...brief.product.stakes,
  ].join(" "));
  return recipes
    .map((recipe) => {
      const signalHits = recipe.domainSignals.filter((signal) =>
        [...words(signal)].some((word) => evidence.has(word)),
      );
      const requiredStateHits = recipe.requiredStates.filter((state) =>
        brief.surface.requiredStates.includes(state),
      );
      const score = Number((signalHits.length * 0.15 + requiredStateHits.length * 0.03).toFixed(3));
      return {
        recipe,
        score,
        reasons: [
          ...(signalHits.length > 0 ? [`domain signals: ${signalHits.join(", ")}`] : []),
          ...(requiredStateHits.length > 0 ? [`state fit: ${requiredStateHits.join(", ")}`] : []),
        ],
      };
    })
    .sort((a, b) => b.score - a.score || a.recipe.id.localeCompare(b.recipe.id));
};

const section = (title: string, lines: string[]) =>
  `## ${title}\n\n${lines.length > 0 ? lines.map((line) => `- ${line}`).join("\n") : "- None"}`;

export const compileDesignMarkdown = (
  brief: DesignBrief,
  direction: DesignDirection,
  report?: VerificationReport,
) => [
  "# Design Contract",
  "",
  `Generated from canonical .design JSON artifacts. Recipe: \`${direction.recipeId}\`.`,
  "",
  section("Product", [
    `Domain: ${brief.product.domain}`,
    `Primary actor: ${brief.product.primaryUserOrActor}`,
    `Primary task: ${brief.product.primaryTask}`,
    `Primary action: ${brief.surface.primaryAction}`,
  ]),
  "",
  section("Direction", [
    `Thesis: ${direction.thesis}`,
    `Product reason: ${direction.productReason}`,
    `Signature move: ${direction.signatureMove}`,
    `Destructive critique: ${direction.destructiveCritique}`,
  ]),
  "",
  section("Axes", Object.entries(direction.axes).map(([key, value]) => `${key}: ${value}`)),
  "",
  section("Required States", brief.surface.requiredStates),
  "",
  section("Responsive", brief.surface.supportedViewports.map((viewport) => `${viewport}px`)),
  "",
  section("Rejected Defaults", direction.rejectedDefaults),
  "",
  section("Verification", report
    ? [`Outcome: ${report.outcome}`, `Hard gates: ${report.gates.hardPassed ? "passed" : "failed"}`, ...report.residualRisks]
    : ["Outcome: not-run"]),
  "",
].join("\n");

export const compileDesignFile = async (input: {
  brief: DesignBrief;
  direction: DesignDirection;
  report?: VerificationReport;
  outputPath: string;
}) => {
  const markdown = compileDesignMarkdown(input.brief, input.direction, input.report);
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, markdown, "utf8");
  return { outputPath: path.resolve(input.outputPath), bytes: Buffer.byteLength(markdown), markdown };
};

export const readJsonArtifact = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(filePath, "utf8")) as T;

export const createDesignBriefScaffold = (
  fingerprint: ProjectFingerprint,
  input: {
    domain?: string;
    primaryUserOrActor?: string;
    primaryTask?: string;
    surfaceType?: string;
    primaryAction?: string;
  } = {},
): DesignBrief => ({
  schemaVersion: "1.0",
  product: {
    domain: input.domain ?? "unknown",
    primaryUserOrActor: input.primaryUserOrActor ?? "unknown",
    primaryTask: input.primaryTask ?? "unknown",
    contentTypes: [],
    usageFrequency: "unknown",
    stakes: [],
  },
  surface: {
    type: input.surfaceType ?? "unknown",
    primaryAction: input.primaryAction ?? "unknown",
    supportedViewports: [390, 1440],
    requiredStates: ["loading", "empty", "error", "success"],
  },
  direction: {
    requestedTone: [],
    antiGoals: ["generic product-agnostic UI", "invented users, metrics, testimonials, or brand assets"],
    existingDirection: "unknown",
  },
  evidence: {
    observed: [
      ...fingerprint.projectTypes.map((entry) => ({ statement: `Project type: ${entry.type}`, source: "project scan" })),
      ...fingerprint.frameworks.map((entry) => ({ statement: `Framework: ${entry.name}`, source: entry.evidence.join(", ") })),
      ...fingerprint.styling.map((entry) => ({ statement: `Styling: ${entry.name}`, source: entry.evidence.join(", ") })),
    ],
    inferred: [],
    assumed: [],
    unknown: [
      ...(!input.domain ? [{ statement: "Product domain is unknown." }] : []),
      ...(!input.primaryUserOrActor ? [{ statement: "Primary user or actor is unknown." }] : []),
      ...(!input.primaryTask ? [{ statement: "Primary task is unknown." }] : []),
    ],
  },
});

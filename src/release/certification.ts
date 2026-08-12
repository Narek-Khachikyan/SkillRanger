import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { readDomainPackManifest, validateDomainPackManifest } from "../domains/registry.ts";
import { frontendRecipeIds } from "../domains/frontend/design/catalog.ts";
import { loadFrontendRecipes } from "../domains/frontend/design/index.ts";
import { loadDesignRuleLibrary } from "../domains/frontend/design/library.ts";
import { loadCraftCatalog, craftReferenceKindsFor } from "../domains/frontend/design/craft.ts";
import { craftBundleSources, defaultCraftRoot } from "./craft-bundle.ts";
import { designRuleFamilies, designRuleIds } from "../domains/frontend/design/library-types.ts";
import { loadRecipeExamplePacks } from "../domains/frontend/design/examples.ts";
import { renderExamplePlate } from "../domains/frontend/design/example-renderer.ts";
import {
  loadFrontendEvalSuite,
  summarizeFrontendVariance,
  validateFrontendEvalSuite,
  validateFrontendTaskEvidence,
  type FrontendEvalSuite,
  type FrontendTaskEvidence,
  type FrontendTaskEvidenceReport,
  type FrontendVarianceSummary,
} from "../evals/frontend.ts";
import { validateCapabilityRecord, type ModelCapabilityRecord } from "../evals/visual/calibration.ts";
import {
  canonicalJson,
  type VisualBlindReviewMapping,
  type VisualBlindReviewPackage,
} from "../evals/visual/review.ts";
import { aggregateVisualBenchmark } from "../evals/visual/metrics.ts";
import { visualBenchmarkExecutionFailureReason } from "../evals/visual/operational.ts";
import {
  loadVisualBenchmarkSuite,
  validateVisualBenchmarkSuite,
} from "../evals/visual/suite.ts";
import { validateVisualBenchmarkPlan, validateVisualCandidates } from "../evals/visual/runner.ts";
import type {
  VisualBenchmarkPlan,
  VisualBenchmarkPlanEntry,
  VisualBenchmarkReport,
  VisualBenchmarkRunResult,
  VisualCapabilityCandidate,
  VisualBenchmarkSuite,
  VisualHumanReview,
} from "../evals/visual/types.ts";
import { defaultDomainsRoot, defaultFrontendEvalSuitePath, packageRoot } from "../paths.ts";

export const frontendReleaseVersion = "0.4.1" as const;

const packageRootResolved = path.resolve(packageRoot);
const frontendRoot = path.join(defaultDomainsRoot, "frontend");
const renderedExtension = /\.(png|jpe?g|webp)$/i;
const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const canonicalDigest = (value: unknown) => sha256(new TextEncoder().encode(canonicalJson(value)));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);

const sameArray = (left: unknown, right: readonly string[]) =>
  Array.isArray(left) && left.length === right.length && left.every((item, index) => item === right[index]);

const safeRelative = (value: string) =>
  !path.isAbsolute(value) && !value.replaceAll("\\", "/").split("/").includes("..");

const contained = (root: string, candidate: string) =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

const resolveContained = (root: string, relative: string, label: string) => {
  if (!safeRelative(relative)) throw new Error(`${label} is not a safe relative path: ${relative}`);
  const resolved = path.resolve(root, relative);
  if (!contained(path.resolve(root), resolved)) throw new Error(`${label} escapes its root: ${relative}`);
  return resolved;
};

export type ReleaseArtifactFile = {
  path: string;
  role: string;
  bytes: number;
  sha256: string;
};

export type FrontendReleaseRuleContract = {
  families: string[];
  ruleCount: number;
  recipeCount: number;
  examplePackCount: number;
  exampleSceneCount: number;
  assetCount: number;
};

export type FrontendReleaseArtifactReport = {
  schemaVersion: "1.0";
  releaseVersion: string;
  packageVersion: string;
  domain: { id: string; version: string; releaseVersion: string };
  ruleContract: FrontendReleaseRuleContract;
  visualBenchmarkDigest?: string;
  frontendEvalSuiteDigest?: string;
  files: ReleaseArtifactFile[];
  issues: string[];
  ok: boolean;
};

type FrontendReleaseManifest = {
  schemaVersion: "1.0";
  releaseVersion: string;
  domainId: string;
  domainApiVersion: string;
  ruleContract: {
    families: string[];
    ruleIds: string[];
    ruleCount: number;
    recipeIds: string[];
    recipeCount: number;
    examplePackCount: number;
    exampleSceneCount: number;
    assetCount: number;
  };
  publishedArtifacts: Record<string, unknown>;
};

const expectedRuleContract = {
  families: [...designRuleFamilies],
  ruleIds: [...designRuleIds],
  ruleCount: designRuleIds.length,
  recipeIds: [...frontendRecipeIds],
  recipeCount: frontendRecipeIds.length,
  examplePackCount: frontendRecipeIds.length,
  exampleSceneCount: frontendRecipeIds.length * 10,
  assetCount: frontendRecipeIds.length * 10,
} as const;

const expectedPublishedArtifactRoles = [
  "domainManifest",
  "ruleIndex",
  "ruleFiles",
  "recipes",
  "examples",
  "visualBenchmarkSuite",
  "frontendEvalSuite",
] as const;

const expectedPublishedArtifacts = {
  domainManifest: "domains/frontend/domain.manifest.json",
  ruleIndex: "domains/frontend/rules/index.json",
  ruleFiles: [
    "domains/frontend/rules/typography.json",
    "domains/frontend/rules/layout.json",
    "domains/frontend/rules/responsive.json",
    "domains/frontend/rules/color.json",
    "domains/frontend/rules/state.json",
    "domains/frontend/rules/signature-move.json",
  ],
  recipes: frontendRecipeIds.map((recipeId) => `domains/frontend/recipes/${recipeId}.json`),
  examples: frontendRecipeIds.map((recipeId) => `domains/frontend/examples/${recipeId}/example.json`),
  visualBenchmarkSuite: "evals/frontend/visual-benchmark/suite.json",
  frontendEvalSuite: "evals/frontend/suite.json",
} as const;

const readJson = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(file, "utf8")) as T;

const referencePath = (file: string) =>
  path.relative(packageRootResolved, file).replaceAll(path.sep, "/");

const addReleaseFile = async (
  files: Map<string, ReleaseArtifactFile>,
  issues: string[],
  file: string,
  role: string,
  root = packageRootResolved,
) => {
  const resolved = path.resolve(file);
  try {
    const info = await lstat(resolved);
    if (!info.isFile() || info.isSymbolicLink() || info.size === 0) {
      issues.push(`${role} is not a non-empty regular file: ${resolved}`);
      return;
    }
    const canonicalRoot = await realpath(root);
    const canonicalFile = await realpath(resolved);
    if (!contained(canonicalRoot, canonicalFile)) {
      issues.push(`${role} escapes its package root: ${resolved}`);
      return;
    }
    const bytes = await readFile(resolved);
    const key = canonicalFile;
    if (!files.has(key)) {
      files.set(key, { path: referencePath(resolved), role, bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
  } catch {
    issues.push(`${role} is missing: ${resolved}`);
  }
};

const validateReleaseManifestShape = (value: unknown): value is FrontendReleaseManifest => {
  if (!isRecord(value)
    || !exactKeys(value, ["schemaVersion", "releaseVersion", "domainId", "domainApiVersion", "ruleContract", "publishedArtifacts"])
    || value.schemaVersion !== "1.0"
    || typeof value.releaseVersion !== "string"
    || typeof value.domainId !== "string"
    || typeof value.domainApiVersion !== "string"
    || !isRecord(value.ruleContract)
    || !isRecord(value.publishedArtifacts)) return false;
  const contract = value.ruleContract;
  const published = value.publishedArtifacts;
  return exactKeys(contract, [
    "families", "ruleIds", "ruleCount", "recipeIds", "recipeCount",
    "examplePackCount", "exampleSceneCount", "assetCount",
  ])
    && stringArray(contract.families)
    && stringArray(contract.ruleIds)
    && Number.isInteger(contract.ruleCount)
    && stringArray(contract.recipeIds)
    && Number.isInteger(contract.recipeCount)
    && Number.isInteger(contract.examplePackCount)
    && Number.isInteger(contract.exampleSceneCount)
    && Number.isInteger(contract.assetCount)
    && exactKeys(published, expectedPublishedArtifactRoles)
    && typeof published.domainManifest === "string"
    && typeof published.ruleIndex === "string"
    && stringArray(published.ruleFiles) && published.ruleFiles.length === 6
    && stringArray(published.recipes) && published.recipes.length === 8
    && stringArray(published.examples) && published.examples.length === 8
    && typeof published.visualBenchmarkSuite === "string"
    && typeof published.frontendEvalSuite === "string";
};

const addManifestReferences = async (
  manifest: Record<string, unknown>,
  files: Map<string, ReleaseArtifactFile>,
  issues: string[],
) => {
  if (!isRecord(manifest.artifacts)) return;
  for (const [name, value] of Object.entries(manifest.artifacts)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (typeof item !== "string" || !item.trim()) continue;
      try {
        const root = name === "evalSuite" ? packageRootResolved : frontendRoot;
        const resolved = resolveContained(root, item, `domain artifact ${name}`);
        await addReleaseFile(files, issues, resolved, `domain artifact ${name}`);
      } catch (error) {
        issues.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
};

const addPublishedReferences = async (
  manifest: FrontendReleaseManifest,
  files: Map<string, ReleaseArtifactFile>,
  issues: string[],
) => {
  const values = Object.entries(manifest.publishedArtifacts).flatMap(([role, value]) =>
    (Array.isArray(value) ? value : [value]).map((item) => ({ role, item })),
  );
  for (const { role, item } of values) {
    if (typeof item !== "string" || !item.trim()) {
      issues.push(`published artifact ${role} must contain non-empty paths`);
      continue;
    }
    try {
      await addReleaseFile(
        files,
        issues,
        resolveContained(packageRootResolved, item, `published artifact ${role}`),
        `published artifact ${role}`,
      );
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
};

export const validateFrontendReleaseArtifacts = async (): Promise<FrontendReleaseArtifactReport> => {
  const issues: string[] = [];
  const files = new Map<string, ReleaseArtifactFile>();
  let packageVersion = "";
  let domainId = "frontend";
  let domainVersion = "";
  let domainReleaseVersion = "";
  let releaseManifest: FrontendReleaseManifest | undefined;
  let ruleCount = 0;
  let recipeCount = 0;
  let examplePackCount = 0;
  let exampleSceneCount = 0;
  let assetCount = 0;
  let visualBenchmarkDigest = "";
  let frontendEvalSuiteDigest = "";

  try {
    const packageJson = await readJson<{ version?: unknown }>(path.join(packageRootResolved, "package.json"));
    packageVersion = typeof packageJson.version === "string" ? packageJson.version : "";
    if (packageVersion !== frontendReleaseVersion) {
      issues.push(`package version must be ${frontendReleaseVersion}; received ${packageVersion || "missing"}`);
    }
  } catch {
    issues.push("package.json is missing or unreadable");
  }
  await addReleaseFile(files, issues, path.join(packageRootResolved, "package.json"), "package identity");

  let domainManifest: Record<string, unknown> | undefined;
  try {
    const loaded = await readDomainPackManifest("frontend");
    domainManifest = loaded as unknown as Record<string, unknown>;
    domainId = loaded.id;
    domainVersion = loaded.version;
    domainReleaseVersion = typeof (loaded as { releaseVersion?: unknown }).releaseVersion === "string"
      ? (loaded as { releaseVersion: string }).releaseVersion
      : "";
    const manifestIssues = validateDomainPackManifest(domainManifest);
    issues.push(...manifestIssues.map((issue) => `frontend domain manifest: ${issue}`));
    if (loaded.schemaVersion !== "1.2") issues.push("frontend domain manifest must use schemaVersion 1.2 for the 0.4.1 release identity");
    if (domainReleaseVersion !== frontendReleaseVersion) {
      issues.push(`frontend domain releaseVersion must be ${frontendReleaseVersion}; received ${domainReleaseVersion || "missing"}`);
    }
    await addReleaseFile(files, issues, path.join(frontendRoot, "domain.manifest.json"), "frontend domain manifest");
    await addManifestReferences(domainManifest, files, issues);
  } catch (error) {
    issues.push(`frontend domain manifest is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const releaseManifestPath = path.join(frontendRoot, "release.json");
  try {
    const raw = await readJson<unknown>(releaseManifestPath);
    if (!validateReleaseManifestShape(raw)) {
      issues.push("frontend release manifest has an invalid contract");
    } else {
      releaseManifest = raw;
      if (releaseManifest.releaseVersion !== frontendReleaseVersion) issues.push("frontend release manifest version does not match 0.4.1");
      if (releaseManifest.domainId !== "frontend") issues.push("frontend release manifest domainId must be frontend");
      if (releaseManifest.domainApiVersion !== domainVersion) issues.push("frontend release manifest domain API version does not match the domain manifest");
      if (!sameArray(releaseManifest.ruleContract.families, expectedRuleContract.families)) issues.push("frontend release manifest family order is not the six-family contract");
      if (!sameArray(releaseManifest.ruleContract.ruleIds, expectedRuleContract.ruleIds)) issues.push("frontend release manifest rule ids do not match the stable corpus");
      if (releaseManifest.ruleContract.ruleCount !== expectedRuleContract.ruleCount) issues.push("frontend release manifest rule count is not 18");
      if (!sameArray(releaseManifest.ruleContract.recipeIds, expectedRuleContract.recipeIds)) issues.push("frontend release manifest recipe ids do not match the frozen eight recipes");
      for (const [field, expected] of Object.entries(expectedRuleContract).filter(([key]) => key !== "families" && key !== "ruleIds" && key !== "recipeIds")) {
        if (releaseManifest.ruleContract[field as keyof typeof releaseManifest.ruleContract] !== expected) {
          issues.push(`frontend release manifest ${field} is ${String(releaseManifest.ruleContract[field as keyof typeof releaseManifest.ruleContract])}; expected ${String(expected)}`);
        }
      }
      if (!exactKeys(releaseManifest.publishedArtifacts, expectedPublishedArtifactRoles)) {
        issues.push("frontend release manifest published artifact roles are incomplete or unknown");
      }
      for (const role of expectedPublishedArtifactRoles) {
        const expected = expectedPublishedArtifacts[role] as string | readonly string[];
        const actual = releaseManifest.publishedArtifacts[role];
        if (Array.isArray(expected) ? !sameArray(actual, expected) : actual !== expected) {
          issues.push(`frontend release manifest ${role} does not match the canonical published references`);
        }
      }
      await addReleaseFile(files, issues, releaseManifestPath, "frontend release manifest");
      await addPublishedReferences(releaseManifest, files, issues);
    }
  } catch (error) {
    issues.push(`frontend release manifest is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (domainManifest && isRecord(domainManifest.artifacts)
    && domainManifest.artifacts.releaseManifest !== "release.json") {
    issues.push("frontend domain manifest must publish release.json as releaseManifest");
  }

  try {
    const library = await loadDesignRuleLibrary();
    ruleCount = library.rules.length;
    if (ruleCount !== expectedRuleContract.ruleCount) issues.push(`frontend rule corpus contains ${ruleCount} rules; expected 18`);
    if (!sameArray([...new Set(library.rules.map((rule) => rule.family))], expectedRuleContract.families)) issues.push("frontend rule corpus does not cover the six families in contract order");
    if (!sameArray(library.rules.map((rule) => rule.id), expectedRuleContract.ruleIds)) issues.push("frontend rule corpus does not match the stable 18-rule contract");
  } catch (error) {
    issues.push(`frontend rule corpus is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const { catalog } = await loadCraftCatalog();
    const expectedKinds = new Set(craftReferenceKindsFor(catalog.schemaVersion));
    const actualKinds = Object.keys(catalog.categories);
    if (actualKinds.length !== expectedKinds.size || actualKinds.some((kind) => !expectedKinds.has(kind as never))) {
      issues.push(`frontend craft catalog schemaVersion ${catalog.schemaVersion} must declare exactly the ${expectedKinds.size} reference kinds; received ${actualKinds.join(", ")}`);
    }
    const sources = await craftBundleSources(defaultCraftRoot);
    for (const { name, sourcePath } of sources) {
      const bundledPath = path.join(packageRootResolved, "registry/skills/frontend.visual-design-polish/references/craft", name);
      try {
        const bundled = await readFile(bundledPath);
        const source = await readFile(sourcePath);
        if (!bundled.equals(source)) {
          issues.push(`craft ${name} is not bundled byte-identically into the visual-design-polish skill package`);
        } else {
          await addReleaseFile(files, issues, bundledPath, "craft bundled reference");
        }
      } catch {
        issues.push(`craft ${name} bundled copy is missing in the visual-design-polish skill package`);
      }
    }
  } catch (error) {
    issues.push(`frontend craft corpus is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const recipes = await loadFrontendRecipes();
    recipeCount = recipes.length;
    if (!sameArray(recipes.map((recipe) => recipe.id), expectedRuleContract.recipeIds)) issues.push("frontend recipe definitions do not match the frozen eight-recipe order");
    const recipeKeys = [
      "schemaVersion", "id", "name", "appropriateWhen", "inappropriateWhen", "domainSignals",
      "layoutModels", "densityRange", "hierarchyStrategies", "mobileStrategy", "requiredStates",
      "signatureMovePatterns", "forbiddenDefaults", "validationRules",
    ];
    const recipeArrayFields = recipeKeys.filter((key) => !["schemaVersion", "id", "name"].includes(key));
    const recipeEnums: Record<string, Set<string>> = {
      layoutModels: new Set(["grid", "editorial-grid", "structured-list", "split-pane", "table", "timeline"]),
      densityRange: new Set(["compact", "balanced", "spacious", "editorial"]),
      hierarchyStrategies: new Set(["action-first", "data-first", "narrative-first", "exception-first"]),
    };
    for (const recipe of recipes) {
      const value = recipe as unknown as Record<string, unknown>;
      if (!exactKeys(value, recipeKeys) || value.schemaVersion !== "1.0" || typeof value.id !== "string" || typeof value.name !== "string" || !value.name.trim()) {
        issues.push(`frontend recipe definition is structurally invalid: ${String(value.id ?? "unknown")}`);
        continue;
      }
      for (const field of recipeArrayFields) if (!stringArray(value[field])) issues.push(`frontend recipe ${value.id} has an invalid ${field} array`);
      for (const [field, allowed] of Object.entries(recipeEnums)) {
        const entries = value[field];
        if (stringArray(entries) && entries.some((entry) => !allowed.has(entry))) issues.push(`frontend recipe ${value.id} has an unsupported ${field} value`);
      }
      const requiredStates = value.requiredStates;
      if (stringArray(requiredStates)) {
        if (new Set(requiredStates).size !== requiredStates.length) issues.push(`frontend recipe ${value.id} repeats a required state`);
        if (!["loading", "empty", "error"].every((state) => requiredStates.includes(state))) issues.push(`frontend recipe ${value.id} does not cover the required state contract`);
      }
    }
    if (recipeCount !== expectedRuleContract.recipeCount) issues.push(`frontend recipe definitions contain ${recipeCount}; expected eight`);
  } catch (error) {
    issues.push(`frontend recipe definitions are invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const packs = await loadRecipeExamplePacks();
    examplePackCount = packs.length;
    const exampleRecipeCount = new Set(packs.map((pack) => pack.recipeId)).size;
    if (examplePackCount !== expectedRuleContract.examplePackCount || exampleRecipeCount !== expectedRuleContract.recipeCount) {
      issues.push(`frontend examples contain ${examplePackCount} packs for ${exampleRecipeCount} recipes; expected eight`);
    }
    if (!sameArray(packs.map((pack) => pack.recipeId), expectedRuleContract.recipeIds)) issues.push("frontend examples do not match the frozen eight-recipe order");
    for (const pack of packs) {
      if (pack.scenes.length !== 10) issues.push(`frontend example pack ${pack.recipeId} contains ${pack.scenes.length} scenes; expected 10`);
      await addReleaseFile(files, issues, pack.sourcePath, "recipe example source");
      for (const scene of pack.scenes) {
        exampleSceneCount += 1;
        assetCount += 1;
        await addReleaseFile(files, issues, scene.assetPath, "recipe example asset");
        try {
          const actual = await readFile(scene.assetPath, "utf8");
          if (actual !== renderExamplePlate(scene)) issues.push(`recipe example asset is not deterministic: ${pack.recipeId}/${scene.id}`);
        } catch {
          issues.push(`recipe example asset cannot be read: ${pack.recipeId}/${scene.id}`);
        }
      }
    }
    if (exampleSceneCount !== expectedRuleContract.exampleSceneCount) issues.push(`frontend examples contain ${exampleSceneCount} scenes; expected 80`);
    if (assetCount !== expectedRuleContract.assetCount) issues.push(`frontend examples contain ${assetCount} assets; expected 80`);
  } catch (error) {
    issues.push(`frontend recipe examples are invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const visualSuitePath = path.join(packageRootResolved, "evals/frontend/visual-benchmark/suite.json");
    const visualSuite = await loadVisualBenchmarkSuite(visualSuitePath);
    visualBenchmarkDigest = canonicalDigest(visualSuite);
    const visualIssues = validateVisualBenchmarkSuite(visualSuite);
    issues.push(...visualIssues.map((issue) => `visual benchmark suite: ${issue}`));
    if (visualSuite.skillRangerVersion !== frontendReleaseVersion) issues.push(`visual benchmark suite must pin SkillRanger ${frontendReleaseVersion}`);
    await addReleaseFile(files, issues, visualSuitePath, "visual benchmark suite");
    for (const brief of visualSuite.briefs) await addReleaseFile(files, issues, path.join(path.dirname(visualSuitePath), "briefs", `${brief.recipeId}.json`), "visual benchmark brief");
  } catch (error) {
    issues.push(`visual benchmark suite is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const frontendSuite = await loadFrontendEvalSuite(defaultFrontendEvalSuitePath);
    frontendEvalSuiteDigest = canonicalDigest(frontendSuite);
    issues.push(...validateFrontendEvalSuite(frontendSuite).map((issue) => `frontend eval suite: ${issue}`));
    await addReleaseFile(files, issues, defaultFrontendEvalSuitePath, "frontend eval suite");
  } catch (error) {
    issues.push(`frontend eval suite is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  const ruleContract: FrontendReleaseRuleContract = {
    families: [...expectedRuleContract.families],
    ruleCount,
    recipeCount,
    examplePackCount,
    exampleSceneCount,
    assetCount,
  };
  return {
    schemaVersion: "1.0",
    releaseVersion: domainReleaseVersion || frontendReleaseVersion,
    packageVersion,
    domain: { id: domainId, version: domainVersion, releaseVersion: domainReleaseVersion },
    ruleContract,
    ...(visualBenchmarkDigest ? { visualBenchmarkDigest } : {}),
    ...(frontendEvalSuiteDigest ? { frontendEvalSuiteDigest } : {}),
    files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path)),
    issues: [...new Set(issues)],
    ok: issues.length === 0 && Boolean(releaseManifest),
  };
};

export type ReleaseEvidenceFile = {
  path: string;
  roles: string[];
  bytes: number;
  sha256: string;
};

export type ReleaseEvidenceFileCollection = {
  files: ReleaseEvidenceFile[];
  issues: string[];
};

export const collectReleaseEvidenceFiles = async (
  entries: Array<{ path: string; role: string }>,
): Promise<ReleaseEvidenceFileCollection> => {
  const files = new Map<string, ReleaseEvidenceFile>();
  const issues: string[] = [];
  for (const entry of entries) {
    const resolved = path.resolve(entry.path);
    try {
      const info = await lstat(resolved);
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0) {
        issues.push(`${entry.role} evidence file is not a non-empty regular file: ${resolved}`);
        continue;
      }
      const canonical = await realpath(resolved);
      const bytes = await readFile(resolved);
      const existing = files.get(canonical);
      if (existing) {
        if (!existing.roles.includes(entry.role)) existing.roles.push(entry.role);
      } else {
        files.set(canonical, { path: resolved, roles: [entry.role], bytes: bytes.byteLength, sha256: sha256(bytes) });
      }
    } catch {
      issues.push(`${entry.role} evidence file is missing: ${resolved}`);
    }
  }
  return { files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path)), issues: [...new Set(issues)] };
};

type ReleaseGate = {
  verdict: "promotable" | "not-promotable";
  blockingReasons: string[];
};

export type ReleaseVisualEvidence = {
  suite: VisualBenchmarkSuite;
  candidates: VisualCapabilityCandidate[];
  capabilityRecord: ModelCapabilityRecord;
  aggregateReportPath: string;
  publicReviewDir: string;
  plan: VisualBenchmarkPlan;
  results: VisualBenchmarkRunResult[];
  reviewPackage: VisualBlindReviewPackage;
  privateMapping: VisualBlindReviewMapping;
  reviews: VisualHumanReview[];
  aggregateReport: VisualBenchmarkReport;
};

export type ReleaseBaselineEvidence = {
  suite: FrontendEvalSuite;
  evidence: FrontendTaskEvidence;
};

export type ReleaseHandoffEvaluationInput = {
  releaseArtifacts: FrontendReleaseArtifactReport;
  visual?: ReleaseVisualEvidence;
  baseline?: ReleaseBaselineEvidence;
  sourceIssues?: string[];
  evidenceFiles: ReleaseEvidenceFile[];
};

export type ReleaseBaselineGateReport = {
  suiteName: string;
  validation: FrontendTaskEvidenceReport;
  variance: FrontendVarianceSummary;
};

export type ReleaseHandoff = {
  schemaVersion: "1.0";
  releaseVersion: string;
  packageVersion: string;
  verdict: "promotable" | "not-promotable";
  blockingReasons: string[];
  gates: {
    artifacts: ReleaseGate & { ruleContract: FrontendReleaseRuleContract };
    visual: ReleaseGate & { report?: VisualBenchmarkReport };
    baseline: ReleaseGate & { report?: ReleaseBaselineGateReport };
  };
  evidenceBundle: {
    files: ReleaseEvidenceFile[];
    requiredRoles: string[];
    missingRoles: string[];
    visual: { runResults: number; screenshots: number; reviewPairs: number; humanReviews: number };
    baseline: { runs: number; artifacts: number; repetitions: number };
  };
};

const unique = (values: string[]) => [...new Set(values.filter((value) => value.trim()))].sort((left, right) => left.localeCompare(right));
const isVisualIssue = (issue: string) => /visual|review|screenshot|benchmark|mapping|human|candidate|capability/i.test(issue);
const isBaselineIssue = (issue: string) => /baseline|task evidence|variance|assertion|repetition/i.test(issue);

const visualPlanIdentityFields = [
  "runId", "briefId", "recipeId", "capabilityCandidateId", "modelId", "commandProfile",
  "commandProfileDigest", "arm", "repetition", "prompt", "fixture", "route",
] as const satisfies readonly (keyof VisualBenchmarkPlanEntry)[];
type VisualPlanIdentityField = typeof visualPlanIdentityFields[number];

const validateVisualEvidenceIdentity = (input: {
  suite: VisualBenchmarkSuite;
  candidates: VisualCapabilityCandidate[];
  plan: VisualBenchmarkPlan;
  results: VisualBenchmarkRunResult[];
}) => {
  const issues: string[] = [];
  const briefs = new Map(input.suite.briefs.map((brief) => [brief.id, brief]));
  let candidates: VisualCapabilityCandidate[];
  try {
    candidates = validateVisualCandidates(input.candidates);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  for (const candidate of candidates) if (!candidate.commandProfileDigest) issues.push(`visual candidate ${candidate.id} is missing its command-profile digest`);
  const planByRunId = new Map<string, VisualBenchmarkPlanEntry>();
  for (const entry of input.plan.entries) {
    planByRunId.set(entry.runId, entry);
    const brief = briefs.get(entry.briefId);
    if (!brief) {
      issues.push(`visual plan references unknown suite brief ${entry.briefId}`);
    } else {
      for (const field of ["recipeId", "prompt", "fixture", "route"] as const) {
        if (entry[field] !== brief[field]) issues.push(`visual plan brief identity does not match suite for ${entry.briefId}/${field}`);
      }
    }
    const candidate = candidatesById.get(entry.capabilityCandidateId);
    if (!candidate) {
      issues.push(`visual plan references unknown candidate ${entry.capabilityCandidateId}`);
    } else {
      if (entry.modelId !== candidate.modelId) issues.push(`visual plan candidate model does not match candidates for ${entry.capabilityCandidateId}`);
      if (entry.commandProfile !== candidate.commandProfile) issues.push(`visual plan candidate command profile does not match candidates for ${entry.capabilityCandidateId}`);
      if (entry.commandProfileDigest !== candidate.commandProfileDigest) issues.push(`visual plan candidate command-profile digest does not match candidates for ${entry.capabilityCandidateId}`);
    }
    if (!entry.commandProfileDigest) issues.push(`visual plan entry ${entry.runId} is missing its command-profile digest`);
  }
  if (!Array.isArray(input.results)) return [...issues, "visual results must be an array"];
  const resultsByRunId = new Map<string, VisualBenchmarkRunResult>();
  for (const result of input.results) {
    if (resultsByRunId.has(result.runId)) issues.push(`visual results contain duplicate run ${result.runId}`);
    resultsByRunId.set(result.runId, result);
    const entry = planByRunId.get(result.runId);
    if (!entry) {
      issues.push(`visual results contain run ${result.runId} absent from the validated plan`);
      continue;
    }
    for (const field of visualPlanIdentityFields) {
      if (result[field as VisualPlanIdentityField] !== entry[field as VisualPlanIdentityField]) {
        issues.push(`visual result ${result.runId} does not match its plan entry for ${field}`);
      }
    }
    if (result.benchmarkVersion !== input.plan.benchmarkVersion) issues.push(`visual result ${result.runId} benchmark identity does not match the plan`);
    if (result.skillRangerVersion !== input.plan.skillRangerVersion) issues.push(`visual result ${result.runId} release identity does not match the plan`);
    if (result.skillRangerChecksum !== input.plan.skillRangerChecksum) issues.push(`visual result ${result.runId} checksum does not match the plan`);
    if (!result.commandProfileDigest) issues.push(`visual result ${result.runId} is missing its command-profile digest`);
    const executionFailure = visualBenchmarkExecutionFailureReason(result);
    if (executionFailure) issues.push(executionFailure);
  }
  for (const runId of planByRunId.keys()) if (!resultsByRunId.has(runId)) issues.push(`visual plan entry ${runId} has no retained result`);
  return issues;
};

export const evaluateReleaseHandoff = (input: ReleaseHandoffEvaluationInput): ReleaseHandoff => {
  const sourceIssues = input.sourceIssues ?? [];
  const artifactReasons = input.releaseArtifacts.ok
    ? []
    : (input.releaseArtifacts.issues.length > 0 ? input.releaseArtifacts.issues : ["frontend release artifacts are not valid"]);
  const visualReasons: string[] = [];
  const baselineReasons: string[] = [];
  const bundleReasons: string[] = [];
  let visualReport: VisualBenchmarkReport | undefined;
  let baselineReport: ReleaseBaselineGateReport | undefined;

  const requiredRoles = [
    "visual-suite", "visual-candidates", "visual-command-profile-weak", "visual-command-profile-medium", "visual-command-profile-strong",
    "visual-plan", "visual-results", "visual-aggregate", "capability-record",
    "public-review-package", "private-mapping", "human-review-1", "human-review-2",
    "baseline-suite", "baseline-evidence",
  ];
  const availableRoles = new Set(input.evidenceFiles.flatMap((file) => file.roles));
  const missingRoles = requiredRoles.filter((role) => !availableRoles.has(role));
  for (const role of missingRoles) bundleReasons.push(`evidence bundle is missing required retained artifact: ${role}`);

  if (!input.visual) {
    visualReasons.push("complete 96-run visual benchmark evidence is required");
  } else {
    try {
      const suiteIssues = validateVisualBenchmarkSuite(input.visual.suite);
      visualReasons.push(...suiteIssues);
      if (input.visual.suite.version !== "visual-benchmark-v1") visualReasons.push("visual benchmark suite identity is not visual-benchmark-v1");
      if (input.visual.suite.skillRangerVersion !== frontendReleaseVersion) visualReasons.push(`visual benchmark suite is not pinned to ${frontendReleaseVersion}`);
      if (!input.releaseArtifacts.visualBenchmarkDigest) visualReasons.push("pinned visual benchmark suite digest is missing");
      else if (canonicalDigest(input.visual.suite) !== input.releaseArtifacts.visualBenchmarkDigest) visualReasons.push("visual benchmark suite does not match the pinned release artifact");
      validateVisualBenchmarkPlan(input.visual.plan);
      if (input.visual.plan.benchmarkVersion !== input.visual.suite.version) visualReasons.push("visual plan benchmark identity does not match the suite");
      if (input.visual.plan.skillRangerVersion !== frontendReleaseVersion) visualReasons.push(`visual plan is not pinned to ${frontendReleaseVersion}`);
      if (input.visual.plan.skillRangerChecksum !== input.visual.suite.skillRangerChecksum) visualReasons.push("visual plan checksum does not match the suite");
      visualReasons.push(...validateVisualEvidenceIdentity(input.visual));
      for (const candidate of input.visual.candidates) {
        const retained = input.evidenceFiles.find((file) => file.roles.includes(`visual-command-profile-${candidate.id}`));
        if (!retained) visualReasons.push(`visual candidate ${candidate.id} command profile was not retained`);
        else if (candidate.commandProfileDigest && `sha256:${retained.sha256}` !== candidate.commandProfileDigest) visualReasons.push(`visual candidate ${candidate.id} command-profile digest does not match retained bytes`);
      }
      const capabilityIssues = validateCapabilityRecord(input.visual.capabilityRecord);
      visualReasons.push(...capabilityIssues.map((issue) => `capability record: ${issue}`));
      const aggregate = aggregateVisualBenchmark({
        suite: input.visual.suite,
        plan: input.visual.plan,
        results: input.visual.results,
        reviewPackage: input.visual.reviewPackage,
        privateMapping: input.visual.privateMapping,
        reviews: input.visual.reviews,
        publicReviewDir: input.visual.publicReviewDir,
      });
      visualReport = aggregate;
      if (canonicalJson(aggregate) !== canonicalJson(input.visual.aggregateReport)) {
        visualReasons.push("visual aggregate report does not match the immutable plan, results, mapping, and reviews");
      }
      if (aggregate.promotion.verdict !== "promotable") {
        visualReasons.push(...aggregate.promotion.blockingReasons);
      }
      if (capabilityIssues.length === 0) {
        const candidateId = input.visual.capabilityRecord.candidateId;
        if (!(candidateId in aggregate.byCapability) || candidateId === "unknown") {
          visualReasons.push(`capability record candidate ${candidateId} is not one of the frozen candidates`);
        } else {
          const metrics = aggregate.byCapability[candidateId as "weak" | "medium" | "strong"];
          const recordMetrics = input.visual.capabilityRecord.metrics;
          for (const key of ["meanQuality", "catastrophicFailureRate", "verificationSuccessRate", "withinConditionVariance", "meanRepairIterations"] as const) {
            if (recordMetrics[key] !== metrics[key]) visualReasons.push(`capability record ${key} does not match the aggregate report`);
          }
          if (input.visual.capabilityRecord.sampleCount !== metrics.sampleCount) visualReasons.push("capability record sampleCount does not match the aggregate report");
          if (canonicalJson([...input.visual.capabilityRecord.modelIds].sort()) !== canonicalJson([...metrics.modelIds].sort())) visualReasons.push("capability record modelIds do not match the aggregate report");
          const relativeEvidencePaths = metrics.evidencePaths.map((evidencePath) => path.relative(path.dirname(input.visual!.aggregateReportPath), path.resolve(evidencePath)).replaceAll(path.sep, "/")).sort();
          if (canonicalJson([...input.visual.capabilityRecord.evidencePaths].sort()) !== canonicalJson(relativeEvidencePaths)) visualReasons.push("capability record evidencePaths do not match the aggregate report");
        }
      }
      if (input.visual.results.length !== 96) visualReasons.push("visual benchmark must retain all 96 run results");
      if (input.visual.reviewPackage.pairs.length !== 48 || input.visual.privateMapping.pairs.length !== 48) visualReasons.push("visual benchmark must retain all 48 blind pairs");
      const screenshotlessRuns = input.visual.results.filter((result) => !Array.isArray(result.artifactPaths) || !result.artifactPaths.some((artifact) => renderedExtension.test(artifact)));
      if (screenshotlessRuns.length > 0) visualReasons.push(`visual benchmark runs are missing screenshots: ${screenshotlessRuns.map(({ runId }) => runId).join(", ")}`);
      const screenshots = input.visual.results.reduce((count, result) => count + (Array.isArray(result.artifactPaths) ? result.artifactPaths.filter((artifact) => renderedExtension.test(artifact)).length : 0), 0);
      if (screenshots < 96) visualReasons.push("visual benchmark must retain at least one screenshot for every run");
      if (input.visual.reviews.length !== 2) visualReasons.push("visual promotion requires exactly two human reviews");
    } catch (error) {
      visualReasons.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (!input.baseline) {
    baselineReasons.push("matched without-skill, old-skill, and current-skill baseline evidence is required");
  } else {
    try {
      const suiteIssues = validateFrontendEvalSuite(input.baseline.suite);
      if (!input.releaseArtifacts.frontendEvalSuiteDigest) baselineReasons.push("pinned frontend eval suite digest is missing");
      else if (canonicalDigest(input.baseline.suite) !== input.releaseArtifacts.frontendEvalSuiteDigest) baselineReasons.push("frontend eval suite does not match the pinned release artifact");
      const validation = validateFrontendTaskEvidence(input.baseline.suite, input.baseline.evidence);
      const variance = summarizeFrontendVariance(input.baseline.evidence, input.baseline.suite);
      baselineReport = { suiteName: input.baseline.suite.name, validation, variance };
      baselineReasons.push(...suiteIssues.map((issue) => `frontend eval suite: ${issue}`));
      baselineReasons.push(...validation.issues);
      baselineReasons.push(...variance.issues);
      if (!validation.metrics.promotionReady) baselineReasons.push("matched baseline task-evidence gate is not promotable");
      if (!variance.promotionReady) baselineReasons.push("matched baseline variance gate is not promotable");
      const baselines = new Set(input.baseline.evidence.baselines ?? []);
      for (const required of ["without-skill", "old-skill", "current-skill"]) {
        if (!baselines.has(required)) baselineReasons.push(`matched baseline evidence is missing ${required}`);
      }
      if (baselines.size !== 3) baselineReasons.push("matched baseline evidence must contain exactly three arms");
      if ((input.baseline.evidence.repetitions ?? 1) < 3) baselineReasons.push("matched baseline evidence requires at least three repetitions");
    } catch (error) {
      baselineReasons.push(`matched baseline evidence is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const visualSourceIssues = sourceIssues.filter(isVisualIssue);
  const baselineSourceIssues = sourceIssues.filter(isBaselineIssue);
  visualReasons.push(...visualSourceIssues);
  baselineReasons.push(...baselineSourceIssues);
  bundleReasons.push(...sourceIssues.filter((issue) => !isVisualIssue(issue) && !isBaselineIssue(issue)));
  const visualGate: ReleaseGate & { report?: VisualBenchmarkReport } = {
    verdict: visualReasons.length === 0 ? "promotable" : "not-promotable",
    blockingReasons: unique(visualReasons),
    ...(visualReport ? { report: visualReport } : {}),
  };
  const baselineGate: ReleaseGate & { report?: ReleaseBaselineGateReport } = {
    verdict: baselineReasons.length === 0 ? "promotable" : "not-promotable",
    blockingReasons: unique(baselineReasons),
    ...(baselineReport ? { report: baselineReport } : {}),
  };
  const artifactGate: ReleaseGate & { ruleContract: FrontendReleaseRuleContract } = {
    verdict: artifactReasons.length === 0 ? "promotable" : "not-promotable",
    blockingReasons: unique(artifactReasons),
    ruleContract: input.releaseArtifacts.ruleContract,
  };
  const visualResults = Array.isArray(input.visual?.results) ? input.visual.results : [];
  const visualReviewPairs = Array.isArray(input.visual?.reviewPackage?.pairs) ? input.visual.reviewPackage.pairs.length : 0;
  const visualHumanReviews = Array.isArray(input.visual?.reviews) ? input.visual.reviews.length : 0;
  const baselineRuns = Array.isArray(input.baseline?.evidence?.runs) ? input.baseline.evidence.runs : [];
  const blockingReasons = unique([
    ...artifactGate.blockingReasons.map((reason) => `release artifacts: ${reason}`),
    ...visualGate.blockingReasons.map((reason) => `visual benchmark gate: ${reason}`),
    ...baselineGate.blockingReasons.map((reason) => `baseline gate: ${reason}`),
    ...bundleReasons,
  ]);
  return {
    schemaVersion: "1.0",
    releaseVersion: input.releaseArtifacts.releaseVersion,
    packageVersion: input.releaseArtifacts.packageVersion,
    verdict: blockingReasons.length === 0 ? "promotable" : "not-promotable",
    blockingReasons,
    gates: { artifacts: artifactGate, visual: visualGate, baseline: baselineGate },
    evidenceBundle: {
      files: input.evidenceFiles,
      requiredRoles,
      missingRoles,
      visual: {
        runResults: visualResults.length,
        screenshots: visualResults.reduce((count, result) => count + (Array.isArray(result.artifactPaths) ? result.artifactPaths.filter((artifact) => renderedExtension.test(artifact)).length : 0), 0),
        reviewPairs: visualReviewPairs,
        humanReviews: visualHumanReviews,
      },
      baseline: {
        runs: baselineRuns.length,
        artifacts: baselineRuns.reduce((count, run) => count + (Array.isArray(run.artifacts) ? run.artifacts.length : 0), 0),
        repetitions: input.baseline?.evidence?.repetitions ?? 0,
      },
    },
  };
};

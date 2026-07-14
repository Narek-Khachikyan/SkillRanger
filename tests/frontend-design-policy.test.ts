import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type {
  BoundedRepairRequest,
  DesignExecutionPolicy,
} from "../src/domains/frontend/design/index.ts";
import {
  resolveDesignExecutionPolicy,
  validateImplementationPrerequisites,
} from "../src/domains/frontend/design/index.ts";

// @ts-expect-error Canonical policy caps variants at three.
const unsupportedVariantLimit: DesignExecutionPolicy["variantLimit"] = 4;
const execFileAsync = promisify(execFile);

test("checks canonical policy constraints at compile time", async () => {
  await execFileAsync(process.execPath, [
    "node_modules/typescript/bin/tsc",
    "--ignoreConfig",
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--target", "ES2023",
    "--module", "NodeNext",
    "--moduleResolution", "NodeNext",
    "--allowImportingTsExtensions",
    "--types", "node",
    "tests/frontend-design-policy.test.ts",
  ]);
});

test("exports the frontend policy and bounded repair contracts", () => {
  const policy: DesignExecutionPolicy = {
    schemaVersion: "1.0",
    requestedMode: "explore",
    effectiveMode: "explore",
    profile: "standard",
    capabilityClassId: "benchmark-medium",
    downgradeReasons: [],
    variantLimit: 2,
    recipeSelection: "ranked-set",
    allowedRecipeIds: ["saas-workspace", "operational-command-center"],
    freedoms: {
      composition: "recipe-layouts",
      visualLanguage: "rule-bound",
      primitives: "local-variants",
      tokens: "role-library",
      motion: "bounded",
    },
    implementationStrategy: "patterns-preferred",
    requiredRuleFamilies: ["typography", "layout", "responsive", "color", "state", "signature-move"],
    structuredDirectionRequired: true,
    independentCriticRequired: true,
    repairRequired: true,
    maxRepairIterations: 3,
    requiredViewports: [390, 768, 1440],
    requiredStates: ["loading", "empty", "error", "success"],
  };
  assert.equal(policy.variantLimit, 2);

  const repair: BoundedRepairRequest = {
    schemaVersion: "1.0",
    id: "repair-1",
    workflowId: "frontend.design-generation",
    targetVariantId: "variant-a",
    sourceEvidenceId: "evidence-1",
    iteration: 1,
    maxIterations: 3,
    findings: [],
    allowedFiles: ["src/App.tsx"],
    allowedChanges: ["spacing"],
    protectedInvariants: [{ kind: "behavior", description: "Checkout still submits once." }],
    passCriteria: [],
  };
  assert.equal(repair.allowedChanges[0], "spacing");
});

test("publishes both schemas in the frontend domain manifest", async () => {
  const manifest = JSON.parse(await readFile("domains/frontend/domain.manifest.json", "utf8"));
  assert.ok(manifest.artifacts.schemas.includes("schemas/design-execution-policy.schema.json"));
  assert.ok(manifest.artifacts.schemas.includes("schemas/bounded-repair-request.schema.json"));
});

const ranked = ["saas-workspace", "operational-command-center", "developer-tool"];

test("constrained downgrades exploration and forces one recipe", () => {
  const policy = resolveDesignExecutionPolicy({ mode: "reimagine", profile: "constrained", rankedRecipeIds: ranked });
  assert.equal(policy.effectiveMode, "refine");
  assert.equal(policy.variantLimit, 1);
  assert.deepEqual(policy.allowedRecipeIds, ["saas-workspace"]);
  assert.equal(policy.implementationStrategy, "verified-patterns-only");
  assert.equal(policy.freedoms.primitives, "existing-only");
});

test("standard explores two variants but keeps repair singular", () => {
  assert.equal(resolveDesignExecutionPolicy({ mode: "explore", profile: "standard", rankedRecipeIds: ranked }).variantLimit, 2);
  assert.equal(resolveDesignExecutionPolicy({ mode: "repair", profile: "standard", rankedRecipeIds: ranked }).variantLimit, 1);
  assert.equal(resolveDesignExecutionPolicy({ mode: "reimagine", profile: "standard", rankedRecipeIds: ranked }).effectiveMode, "explore");
});

test("advanced allows free composition and new primitives", () => {
  const policy = resolveDesignExecutionPolicy({ mode: "reimagine", profile: "advanced", rankedRecipeIds: ranked });
  assert.equal(policy.effectiveMode, "reimagine");
  assert.equal(policy.freedoms.composition, "free");
  assert.equal(policy.freedoms.primitives, "new-primitives");
});

test("empirical capability constraints can only reduce freedom", () => {
  const policy = resolveDesignExecutionPolicy({
    mode: "reimagine",
    profile: "advanced",
    rankedRecipeIds: ranked,
    capability: {
      id: "unstable-sample",
      maxVariants: 1,
      allowedRecipeIds: ["developer-tool"],
      maxCompositionFreedom: "recipe-layouts",
      maxPrimitiveFreedom: "existing-only",
      implementationStrategy: "verified-patterns-only",
    },
  });
  assert.equal(policy.variantLimit, 1);
  assert.deepEqual(policy.allowedRecipeIds, ["developer-tool"]);
  assert.equal(policy.freedoms.composition, "recipe-layouts");
});

test("empirical capability constraints cannot expand a profile", () => {
  const policy = resolveDesignExecutionPolicy({
    mode: "explore",
    profile: "standard",
    rankedRecipeIds: ranked,
    capability: {
      id: "overstated-sample",
      maxVariants: 3,
      maxCompositionFreedom: "free",
      maxPrimitiveFreedom: "new-primitives",
      implementationStrategy: "free",
    },
  });
  assert.equal(policy.variantLimit, 2);
  assert.equal(policy.freedoms.composition, "recipe-layouts");
  assert.equal(policy.freedoms.primitives, "local-variants");
  assert.equal(policy.implementationStrategy, "patterns-preferred");
});

test("rejects capability recipe constraints that exclude every ranked recipe", () => {
  assert.throws(
    () => resolveDesignExecutionPolicy({
      mode: "refine",
      profile: "standard",
      rankedRecipeIds: ranked,
      capability: {
        id: "mismatched-sample",
        maxVariants: 2,
        allowedRecipeIds: ["consumer-discovery"],
        maxCompositionFreedom: "recipe-layouts",
        maxPrimitiveFreedom: "local-variants",
        implementationStrategy: "patterns-preferred",
      },
    }),
    /capability allowedRecipeIds do not include any ranked recipe/,
  );
});

test("blocks arbitrary JSX before a direction and verified pattern selection", () => {
  const policy = resolveDesignExecutionPolicy({ mode: "refine", profile: "constrained", rankedRecipeIds: ranked });
  const findings = validateImplementationPrerequisites({
    policy,
    directions: [],
    selectedRuleIds: [],
    implementationKind: "arbitrary-jsx-css",
  });
  assert.deepEqual(findings.map(({ code }) => code), [
    "structured-direction-missing",
    "verified-pattern-selection-missing",
    "implementation-strategy-violation",
  ]);
});

test("constrained implementation requires all six selected rule families", () => {
  const policy = resolveDesignExecutionPolicy({ mode: "refine", profile: "constrained", rankedRecipeIds: ranked });
  const findings = validateImplementationPrerequisites({
    policy,
    directions: [],
    selectedRuleIds: ["typography.role-contrast"],
    implementationKind: "local-primitives",
  });
  assert.ok(findings.some(({ code }) => code === "verified-pattern-selection-missing"));
});

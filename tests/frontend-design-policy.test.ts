import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type {
  BoundedRepairRequest,
  DesignExecutionPolicy,
} from "../src/domains/frontend/design/index.ts";

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

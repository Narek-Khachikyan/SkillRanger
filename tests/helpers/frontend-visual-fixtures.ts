import type { DesignBrief } from "../../src/domains/frontend/design/index.ts";

export const makeBrief = (input: {
  requiredStates?: string[];
  supportedViewports?: number[];
} = {}): DesignBrief => ({
  schemaVersion: "1.0",
  product: {
    domain: "developer run diagnostics", primaryUserOrActor: "Repository maintainer",
    primaryTask: "Inspect a failed run", contentTypes: ["run", "log", "command"],
    usageFrequency: "frequent", stakes: [],
  },
  surface: {
    type: "developer tool", primaryAction: "Inspect failure",
    supportedViewports: input.supportedViewports ?? [390, 768, 1440],
    requiredStates: input.requiredStates ?? ["loading", "empty", "error", "success"],
  },
  direction: { requestedTone: ["clear"], antiGoals: ["generic SaaS"], existingDirection: "repository UI" },
  evidence: {
    observed: [{ statement: "The fixture contains run and log records.", source: "test fixture" }],
    inferred: [], assumed: [], unknown: [],
  },
});

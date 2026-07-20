import type { RouterSelectableRisk } from "../router/types.ts";

export type RouterConfig = {
  schemaVersion: "router-config/1.0";
  defaultTargetAgent: string;
  router: {
    enabled: boolean;
    strictByDefault: boolean;
    maxSelectedRisk: RouterSelectableRisk;
    maxEnvironmentSkills: number;
    maxTaskCompanions: number;
    maxVerificationSkills: number;
    maxAgentContextSkills: number;
    maxTotalSelectedSkills: number;
    maxInstructionBytes: number;
    maxAdditionalReadBytes: number;
    maxSingleFileBytes: number;
    maxIntentBytes: number;
  };
  privacy: {
    allowRawIntentPersistence: boolean;
  };
};

export type LoadedRouterConfig = {
  config: RouterConfig;
  digest: string;
  source: "defaults" | "project";
};

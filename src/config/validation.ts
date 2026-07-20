import { createHash } from "node:crypto";
import type { RouterConfig } from "./types.ts";

export class RouterConfigError extends Error {
  readonly code = "router-config-invalid";

  constructor(message: string) {
    super(message);
    this.name = "RouterConfigError";
  }
}

const rootKeys = ["schemaVersion", "defaultTargetAgent", "router", "privacy"] as const;
const routerKeys = [
  "enabled",
  "strictByDefault",
  "maxSelectedRisk",
  "maxEnvironmentSkills",
  "maxTaskCompanions",
  "maxVerificationSkills",
  "maxAgentContextSkills",
  "maxTotalSelectedSkills",
  "maxInstructionBytes",
  "maxAdditionalReadBytes",
  "maxSingleFileBytes",
  "maxIntentBytes",
] as const;
const privacyKeys = ["allowRawIntentPersistence"] as const;

const record = (value: unknown, at: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RouterConfigError(`${at} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const exactKeys = (value: Record<string, unknown>, keys: readonly string[], at: string) => {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new RouterConfigError(`${at} contains unknown property ${unknown}.`);
  const missing = keys.find((key) => !Object.hasOwn(value, key));
  if (missing) throw new RouterConfigError(`${at} is missing required property ${missing}.`);
};

const boolean = (value: unknown, at: string) => {
  if (typeof value !== "boolean") throw new RouterConfigError(`${at} must be a boolean.`);
};

const boundedInteger = (value: unknown, at: string, minimum: number, maximum: number) => {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RouterConfigError(`${at} must be an integer from ${minimum} to ${maximum}.`);
  }
};

export const validateRouterConfig = (input: unknown): RouterConfig => {
  const value = record(input, "router config");
  exactKeys(value, rootKeys, "router config");
  if (value.schemaVersion !== "router-config/1.0") {
    throw new RouterConfigError("router config.schemaVersion must be router-config/1.0.");
  }
  if (typeof value.defaultTargetAgent !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value.defaultTargetAgent)) {
    throw new RouterConfigError("router config.defaultTargetAgent must be a canonical agent ID.");
  }

  const router = record(value.router, "router config.router");
  exactKeys(router, routerKeys, "router config.router");
  boolean(router.enabled, "router config.router.enabled");
  boolean(router.strictByDefault, "router config.router.strictByDefault");
  if (router.maxSelectedRisk !== "low" && router.maxSelectedRisk !== "medium") {
    throw new RouterConfigError("router config.router.maxSelectedRisk must be low or medium.");
  }
  boundedInteger(router.maxEnvironmentSkills, "router config.router.maxEnvironmentSkills", 0, 16);
  boundedInteger(router.maxTaskCompanions, "router config.router.maxTaskCompanions", 0, 16);
  boundedInteger(router.maxVerificationSkills, "router config.router.maxVerificationSkills", 0, 16);
  boundedInteger(router.maxAgentContextSkills, "router config.router.maxAgentContextSkills", 0, 4);
  boundedInteger(router.maxTotalSelectedSkills, "router config.router.maxTotalSelectedSkills", 1, 32);
  boundedInteger(router.maxInstructionBytes, "router config.router.maxInstructionBytes", 1, 10_000_000);
  boundedInteger(router.maxAdditionalReadBytes, "router config.router.maxAdditionalReadBytes", 0, 10_000_000);
  boundedInteger(router.maxSingleFileBytes, "router config.router.maxSingleFileBytes", 1, 10_000_000);
  boundedInteger(router.maxIntentBytes, "router config.router.maxIntentBytes", 1, 1_000_000);

  const privacy = record(value.privacy, "router config.privacy");
  exactKeys(privacy, privacyKeys, "router config.privacy");
  boolean(privacy.allowRawIntentPersistence, "router config.privacy.allowRawIntentPersistence");
  return structuredClone(value) as RouterConfig;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonicalize(child)]),
  );
};

export const canonicalRouterConfig = (config: RouterConfig) => JSON.stringify(canonicalize(config));

export const routerConfigDigest = (config: RouterConfig) => (
  `sha256:${createHash("sha256").update(canonicalRouterConfig(config), "utf8").digest("hex")}`
);

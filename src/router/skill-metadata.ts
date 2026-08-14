import path from "node:path";
import { readFile } from "node:fs/promises";
import { auditSkill } from "../audit/index.ts";
import "../domains/bundled.ts";
import { resolveDomainPackForSkill } from "../domains/registry.ts";
import { resolveInstalledSkillRoot } from "../installers/installed-path.ts";
import { readLockfile } from "../lockfile/index.ts";
import { validateJsonSchema } from "../runtime/strict/json-schema.ts";
import { assertInstalledMatches } from "../runtime/strict/service.ts";
import type { InstalledSkill, RegistrySkill } from "../types.ts";
import type { RouterFixturePack } from "./fixtures.ts";
import type { RouterSkillMetadata } from "./retrieval.ts";
import { routerRecordDigest } from "./store.ts";

// The required-field contract shared by every router skill metadata record,
// regardless of source (bundled registry, installed, test fixture). Both the
// registry and fixture builders must produce every field below; the assertion
// below enforces the contract at the single factory boundary, so a production
// and an evaluation record can never silently diverge in field presence.
export const routerSkillMetadataRequiredFields = [
  "id",
  "displayName",
  "version",
  "riskLevel",
  "domains",
  "roles",
  "actions",
  "artifactTypes",
  "intentTags",
  "technologyTags",
  "qualityGoals",
  "packageChecksum",
  "source",
  "installed",
  "lockfileMatch",
  "installedFileSetMatch",
  "auditPassed",
  "auditDigest",
  "strictContract",
  "contractInputAccepted",
  "contractMustRead",
  "instructionBytes",
] as const;

export const assertRouterSkillMetadataContract = (metadata: RouterSkillMetadata): RouterSkillMetadata => {
  const missing = routerSkillMetadataRequiredFields.filter((field) => metadata[field] === undefined);
  if (missing.length > 0) {
    throw new Error(`Router skill metadata violates the required-field contract: missing ${missing.join(", ")} for ${metadata.id ?? "unknown"}.`);
  }
  return metadata;
};

export type RouterSkillMetadataBuildSource =
  | { kind: "registry"; skill: RegistrySkill }
  | { kind: "fixture"; skill: RouterFixturePack["skills"][number]; installed: boolean };

export type RouterSkillMetadataBuildInput = {
  source: RouterSkillMetadataBuildSource;
  projectRoot: string;
  targetAgent: string;
  inputs: Record<string, Record<string, unknown>>;
  intent?: string;
};

export type RouterSkillMetadataBuildResult = {
  metadata: RouterSkillMetadata;
  installedRoot?: string;
  entry?: InstalledSkill;
};

const installedEntryFor = async (projectRoot: string, skillId: string, targetAgent: string) => {
  const lockfile = await readLockfile(projectRoot);
  return lockfile.installed.find((entry) => entry.skillId === skillId && entry.targetAgent === targetAgent && entry.scope === "repo");
};

const safeInstalledRoot = async (projectRoot: string, installedPath: string) => {
  try {
    return await resolveInstalledSkillRoot(projectRoot, installedPath);
  } catch {
    return undefined;
  }
};

const buildRegistryMetadata = async (
  input: Omit<RouterSkillMetadataBuildInput, "source">,
  skill: RegistrySkill,
): Promise<RouterSkillMetadataBuildResult | undefined> => {
  const routing = skill.manifest.routing;
  if (!routing?.roles || !routing.domains || !routing.actions || !routing.artifactTypes || !routing.intentTags || !routing.technologyTags || !routing.qualityGoals) return undefined;
  const audit = await auditSkill(skill);
  const entry = await installedEntryFor(input.projectRoot, skill.manifest.id, input.targetAgent);
  const installedRoot = entry ? await safeInstalledRoot(input.projectRoot, entry.installedPath) : undefined;
  const installed = Boolean(entry && installedRoot && entry.checksum === skill.checksum && await assertInstalledMatches(skill, installedRoot, entry.checksum).then(() => true).catch(() => false));
  const contract = skill.executionContract;
  const contractInputAccepted = contract
    ? validateJsonSchema(
      JSON.parse(await readFile(path.join(skill.path, contract.inputSchema), "utf8")) as Record<string, unknown>,
      input.inputs[skill.manifest.id] ?? {},
    ).length === 0
    : false;
  const requiredCapabilities = [...new Set([
    ...(routing.requiredCapabilities ?? []),
    ...(skill.manifest.verification?.requiredCapabilities ?? []),
  ])];
  const domainPack = resolveDomainPackForSkill(skill.manifest.id);
  const laneAdjustment = domainPack?.routing.laneAdjustment(routing.lane, input.intent) ?? 0;
  const skillAdjustment = domainPack?.routing.skillAdjustment(skill, input.intent) ?? 0;
  return {
    metadata: assertRouterSkillMetadataContract({
      id: skill.manifest.id,
      displayName: skill.manifest.displayName,
      version: skill.manifest.version,
      riskLevel: skill.manifest.riskLevel,
      domains: routing.domains,
      roles: routing.roles,
      actions: routing.actions,
      artifactTypes: routing.artifactTypes,
      intentTags: routing.intentTags,
      technologyTags: routing.technologyTags,
      qualityGoals: routing.qualityGoals,
      environmentSignals: routing.environmentSignals,
      ...(contract?.applicability?.op === "signal" ? {
        applicabilitySignal: {
          collection: contract.applicability.collection,
          name: contract.applicability.name,
          minConfidence: contract.applicability.minConfidence ?? 0.5,
        },
      } : {}),
      requiredCapabilities,
      routingRequiredCapabilities: routing.requiredCapabilities ?? [],
      verificationRequiredCapabilities: skill.manifest.verification?.requiredCapabilities ?? [],
      strictPrerequisiteCapabilities: contract?.prerequisites.flatMap((prerequisite) => prerequisite.kind === "capability" ? [prerequisite.capability] : []) ?? [],
      optionalCapabilities: routing.optionalCapabilities,
      complements: routing.complements,
      dependencies: skill.manifest.dependencies,
      conflictsWith: skill.manifest.conflictsWith,
      supersedes: skill.manifest.supersedes,
      packageChecksum: skill.checksum,
      source: installed ? "installed" as const : "bundled-registry" as const,
      installed,
      lockfileMatch: installed,
      installedFileSetMatch: installed,
      auditPassed: audit.riskLevel !== "high" && audit.riskLevel !== "block" && audit.checksum === skill.checksum,
      auditDigest: routerRecordDigest(audit),
      strictContract: contract ? "valid" as const : "missing" as const,
      contractInputAccepted,
      contractMustRead: contract?.mustRead ?? [],
      instructionBytes: Buffer.byteLength(await readFile(skill.skillPath), "utf8"),
      qualityScore: skill.manifest.qualityScore,
      securityScore: skill.manifest.securityScore,
      freshnessDate: skill.manifest.freshness?.lastReviewedAt,
      laneAdjustment,
      skillAdjustment,
      supportedTargets: [...new Set([
        ...skill.manifest.supportedAgents,
        ...Object.entries(skill.manifest.compatibility ?? {})
          .filter(([, compatibility]) => compatibility.level !== "unsupported")
          .map(([agent]) => agent),
      ])],
    }),
    ...(installedRoot && installed ? { installedRoot } : {}),
    ...(installed && entry ? { entry } : {}),
  };
};

const buildFixtureMetadata = (
  input: Omit<RouterSkillMetadataBuildInput, "source">,
  skill: RouterFixturePack["skills"][number],
  installed: boolean,
): RouterSkillMetadataBuildResult => ({
  metadata: assertRouterSkillMetadataContract({
    ...skill,
    packageChecksum: routerRecordDigest(skill.id),
    source: installed ? "installed" as const : "test-fixture-registry" as const,
    installed,
    lockfileMatch: installed,
    installedFileSetMatch: installed,
    auditPassed: true,
    auditDigest: routerRecordDigest({ skillId: skill.id, fixture: true }),
    contractInputAccepted: installed && skill.strictContract === "valid",
    contractMustRead: ["SKILL.md"],
  }),
});

// The single canonical router skill metadata factory. Production preparation
// and router evaluations both build every metadata record through this entry
// point; the required-field contract is enforced before any record leaves it.
export const buildRouterSkillMetadata = async (
  input: RouterSkillMetadataBuildInput,
): Promise<RouterSkillMetadataBuildResult | undefined> => {
  const { source, ...common } = input;
  switch (source.kind) {
    case "registry":
      return buildRegistryMetadata(common, source.skill);
    case "fixture":
      return buildFixtureMetadata(common, source.skill, source.installed);
  }
};

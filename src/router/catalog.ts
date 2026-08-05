import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { auditSkill } from "../audit/index.ts";
import {
  loadBundledRouterPacks,
  type BundledRouterPack,
} from "../domains/registry.ts";
import { defaultDomainsRoot, defaultRegistryRoot } from "../paths.ts";
import {
  assertSkillIntegrity,
  loadLocalRegistry,
} from "../registry/index.ts";
import type {
  AuditReport,
  RegistrySkill,
  RiskLevel,
} from "../types.ts";
import { routerRecordDigest } from "./store.ts";
import {
  loadBundledRoutingPacks,
  type LoadedRouterPack,
} from "./vocabulary/load.ts";

export const skillCatalogSchemaVersion = "skill-catalog/1.0" as const;

export const skillCatalogLimits = {
  defaultMaxItems: 16,
  defaultMaxBytes: 128_000,
  maxItems: 64,
  maxBytes: 256_000,
  maxTokenBytes: 8_192,
  receiptTtlMs: 15 * 60 * 1000,
} as const;

export type CatalogErrorCode =
  | "catalog-integrity"
  | "catalog-cursor-invalid"
  | "catalog-digest-mismatch"
  | "catalog-page-limit-invalid"
  | "catalog-page-limit-too-small"
  | "catalog-receipt-invalid";

export class SkillCatalogError extends Error {
  readonly code: CatalogErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: CatalogErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SkillCatalogError";
    this.code = code;
    this.details = details;
  }
}

export type SkillCatalogDomain = {
  domainId: string;
  displayName: string;
  description: string;
};

export type SkillCatalogCard = {
  skillId: string;
  displayName: string;
  description: string;
  version: string;
  domains: string[];
  roles: string[];
  actions: string[];
  artifactTypes: string[];
  intentTags: string[];
  technologyTags: string[];
  qualityGoals: string[];
  requiredCapabilities: string[];
  riskLevel: RiskLevel;
  supportedAgents: string[];
};

export type SkillCatalogPage = {
  ok: true;
  schemaVersion: typeof skillCatalogSchemaVersion;
  catalogDigest: string;
  domains: SkillCatalogDomain[];
  skills: SkillCatalogCard[];
  nextCursor: string | null;
  complete: boolean;
  catalogReceipt?: string;
};

export type SkillCatalogSnapshot = {
  domains: SkillCatalogDomain[];
  skills: SkillCatalogCard[];
  digest: string;
};

export type InspectSkillCatalogInput = {
  cursor?: string;
  expectedCatalogDigest?: string;
  maxItems?: number;
  maxBytes?: number;
};

export type SkillCatalogLoaders = {
  loadSkills?: (registryRoot: string) => Promise<RegistrySkill[]>;
  loadDomains?: (domainsRoot: string) => Promise<BundledRouterPack[]>;
  loadRoutingPacks?: (packs: BundledRouterPack[]) => Promise<LoadedRouterPack[]>;
  auditSkill?: (skill: RegistrySkill) => Promise<AuditReport>;
};

export type SkillCatalogSourceOptions = {
  registryRoot?: string;
  domainsRoot?: string;
  loaders?: SkillCatalogLoaders;
  now?: number | Date | (() => number | Date);
};

type CatalogSnapshot = SkillCatalogSnapshot;

type CursorPayload = {
  kind: "cursor";
  schemaVersion: typeof skillCatalogSchemaVersion;
  catalogDigest: string;
  offset: number;
  page: number;
  maxItems: number;
  maxBytes: number;
  previousPageDigest: string;
};

type ReceiptPayload = {
  kind: "receipt";
  schemaVersion: typeof skillCatalogSchemaVersion;
  catalogDigest: string;
  page: number;
  itemCount: number;
  chainDigest: string;
  issuedAt: number;
  expiresAt: number;
};

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const tokenSecret = randomBytes(32);

const canonicalCompare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

const canonicalStrings = (values: ReadonlyArray<string> | undefined) =>
  [...new Set(values ?? [])].sort(canonicalCompare);

const tokenError = (kind: "cursor" | "receipt", message: string): never => {
  throw new SkillCatalogError(
    kind === "cursor" ? "catalog-cursor-invalid" : "catalog-receipt-invalid",
    message,
  );
};

const signToken = (prefix: string, payload: object) => {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", tokenSecret).update(`${prefix}${encoded}`, "utf8").digest("base64url");
  return `${prefix}${encoded}.${signature}`;
};

const readToken = <T extends object>(token: unknown, prefix: string, kind: "cursor" | "receipt") => {
  if (typeof token !== "string" || token.length > skillCatalogLimits.maxTokenBytes || !token.startsWith(prefix)) {
    return tokenError(kind, `Invalid catalog ${kind} token.`);
  }
  const value = token.slice(prefix.length);
  const separator = value.lastIndexOf(".");
  if (separator <= 0 || separator === value.length - 1) return tokenError(kind, `Invalid catalog ${kind} token.`);
  const encoded = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = createHmac("sha256", tokenSecret).update(`${prefix}${encoded}`, "utf8").digest("base64url");
  const signatureBytes = Buffer.from(signature, "base64url");
  const expectedBytes = Buffer.from(expected, "base64url");
  if (signatureBytes.length !== expectedBytes.length || !timingSafeEqual(signatureBytes, expectedBytes)) {
    return tokenError(kind, `Invalid catalog ${kind} token signature.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return tokenError(kind, `Invalid catalog ${kind} token payload.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return tokenError(kind, `Invalid catalog ${kind} token payload.`);
  }
  return parsed as T;
};

const assertDigest = (value: unknown, name: string) => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw new SkillCatalogError("catalog-digest-mismatch", `${name} must be a canonical catalog digest.`, {
      argument: name,
    });
  }
  return value;
};

const pageLimit = (value: unknown, name: "maxItems" | "maxBytes", fallback: number) => {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > skillCatalogLimits[name]
  ) {
    throw new SkillCatalogError(
      "catalog-page-limit-invalid",
      `${name} must be an integer between 1 and ${skillCatalogLimits[name]}.`,
      { argument: name },
    );
  }
  return value;
};

const validateCursorPayload = (payload: CursorPayload) => {
  if (
    payload.kind !== "cursor" ||
    payload.schemaVersion !== skillCatalogSchemaVersion ||
    !digestPattern.test(payload.catalogDigest) ||
    !Number.isSafeInteger(payload.offset) || payload.offset < 1 ||
    !Number.isSafeInteger(payload.page) || payload.page < 1 ||
    !Number.isSafeInteger(payload.maxItems) || payload.maxItems < 1 || payload.maxItems > skillCatalogLimits.maxItems ||
    !Number.isSafeInteger(payload.maxBytes) || payload.maxBytes < 1 || payload.maxBytes > skillCatalogLimits.maxBytes ||
    !digestPattern.test(payload.previousPageDigest)
  ) {
    return tokenError("cursor", "Invalid catalog cursor payload.");
  }
  return payload;
};

const validateReceiptPayload = (payload: ReceiptPayload) => {
  if (
    payload.kind !== "receipt" ||
    payload.schemaVersion !== skillCatalogSchemaVersion ||
    !digestPattern.test(payload.catalogDigest) ||
    !Number.isSafeInteger(payload.page) || payload.page < 1 ||
    !Number.isSafeInteger(payload.itemCount) || payload.itemCount < 0 ||
    !digestPattern.test(payload.chainDigest) ||
    !Number.isSafeInteger(payload.issuedAt) || payload.issuedAt < 0 ||
    !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= payload.issuedAt
  ) {
    return tokenError("receipt", "Invalid catalog receipt payload.");
  }
  return payload;
};

const catalogNow = (value?: number | Date | (() => number | Date)) => {
  const raw = typeof value === "function" ? value() : value;
  const timestamp = raw instanceof Date ? raw.getTime() : raw ?? Date.now();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new SkillCatalogError("catalog-receipt-invalid", "Catalog receipt clock is invalid.");
  }
  return timestamp;
};

const domainDescription = (pack: BundledRouterPack) =>
  pack.description ?? `${pack.displayName} domain pack.`;

const domainCard = (pack: BundledRouterPack): SkillCatalogDomain => ({
  domainId: pack.id,
  displayName: pack.displayName,
  description: domainDescription(pack),
});

const canonicalOwnership = (pack: BundledRouterPack) => pack.ownership.map((rule) => ({
  intent: rule.intent,
  primarySkill: rule.primarySkill,
  supportingSkills: canonicalStrings(rule.supportingSkills),
  ...(rule.requiresEvidence === undefined ? {} : {
    requiresEvidence: rule.requiresEvidence.map((evidence) =>
      typeof evidence === "string"
        ? evidence
        : {
          kind: evidence.kind,
          id: evidence.id,
          allowedSources: canonicalStrings(evidence.allowedSources),
        }),
    }),
})).sort((left, right) => canonicalCompare(`${left.intent}:${left.primarySkill}`, `${right.intent}:${right.primarySkill}`));

const canonicalDomainManifest = (pack: BundledRouterPack, routingPack: LoadedRouterPack | undefined) => ({
  schemaVersion: pack.schemaVersion,
  id: pack.id,
  displayName: pack.displayName,
  ...(pack.description === undefined ? {} : { description: pack.description }),
  version: pack.version,
  ...(pack.schemaVersion === "1.2" ? { releaseVersion: pack.releaseVersion } : {}),
  coreApi: pack.coreApi,
  skillIdPrefix: pack.skillIdPrefix,
  capabilities: canonicalStrings(pack.capabilities),
  routing: {
    aliases: canonicalStrings(pack.routing?.aliases),
    intentTags: canonicalStrings(pack.routing?.intentTags),
    artifactTypes: canonicalStrings(pack.routing?.artifactTypes),
    technologyTags: canonicalStrings(pack.routing?.technologyTags),
    projectTags: canonicalStrings(pack.routing?.projectTags),
  },
  artifacts: pack.artifacts,
  ownership: canonicalOwnership(pack),
  ...(routingPack?.vocabulary === undefined ? {} : { routingVocabulary: routingPack.vocabulary }),
});

const routingValues = (skill: RegistrySkill) => {
  const routing = skill.manifest.routing;
  if (
    !routing ||
    !routing.roles?.length ||
    !routing.domains?.length ||
    !routing.actions?.length ||
    !routing.artifactTypes?.length ||
    !routing.intentTags?.length ||
    !routing.technologyTags?.length ||
    !routing.qualityGoals?.length
  ) {
    throw new SkillCatalogError(
      "catalog-integrity",
      `Bundled skill ${skill.manifest.id} does not expose complete routing metadata.`,
      { skillId: skill.manifest.id },
    );
  }
  return routing;
};

const skillCard = (skill: RegistrySkill, audit: AuditReport, domains: ReadonlySet<string>): SkillCatalogCard => {
  const routing = routingValues(skill);
  const skillDomains = canonicalStrings(routing.domains);
  if (skillDomains.some((domainId) => !domains.has(domainId))) {
    throw new SkillCatalogError(
      "catalog-integrity",
      `Bundled skill ${skill.manifest.id} references an unknown Domain Pack.`,
      { skillId: skill.manifest.id },
    );
  }
  const requiredCapabilities = canonicalStrings([
    ...(routing.requiredCapabilities ?? []),
    ...(skill.manifest.verification?.requiredCapabilities ?? []),
  ]);
  return {
    skillId: skill.manifest.id,
    displayName: skill.manifest.displayName,
    description: skill.manifest.description,
    version: skill.manifest.version,
    domains: skillDomains,
    roles: canonicalStrings(routing.roles),
    actions: canonicalStrings(routing.actions),
    artifactTypes: canonicalStrings(routing.artifactTypes),
    intentTags: canonicalStrings(routing.intentTags),
    technologyTags: canonicalStrings(routing.technologyTags),
    qualityGoals: canonicalStrings(routing.qualityGoals),
    requiredCapabilities,
    riskLevel: audit.riskLevel,
    supportedAgents: canonicalStrings(skill.manifest.supportedAgents),
  };
};

const auditProjection = (audit: AuditReport) => ({
  checksum: audit.checksum,
  riskLevel: audit.riskLevel,
  securityScore: audit.securityScore,
  findings: [...audit.findings].sort((left, right) => canonicalCompare(
    `${left.severity}:${left.code}:${left.path ?? ""}`,
    `${right.severity}:${right.code}:${right.path ?? ""}`,
  )).map(({ severity, code, path }) => ({
    severity,
    code,
    ...(path === undefined ? {} : { path }),
  })),
});

const loadSnapshot = async (options: SkillCatalogSourceOptions = {}): Promise<CatalogSnapshot> => {
  const registryRoot = options.registryRoot ?? defaultRegistryRoot;
  const domainsRoot = options.domainsRoot ?? defaultDomainsRoot;
  const loaders = options.loaders ?? {};
  let skills: RegistrySkill[];
  let packs: BundledRouterPack[];
  try {
    [skills, packs] = await Promise.all([
      (loaders.loadSkills ?? loadLocalRegistry)(registryRoot),
      (loaders.loadDomains ?? loadBundledRouterPacks)(domainsRoot),
    ]);
  } catch (error) {
    if (error instanceof SkillCatalogError) throw error;
    throw new SkillCatalogError("catalog-integrity", error instanceof Error ? error.message : String(error));
  }

  let routingPacks: LoadedRouterPack[] = [];
  try {
    routingPacks = await (loaders.loadRoutingPacks ?? loadBundledRoutingPacks)(packs);
  } catch (error) {
    throw new SkillCatalogError("catalog-integrity", error instanceof Error ? error.message : String(error));
  }

  const sortedPacks = [...packs].sort((left, right) => canonicalCompare(left.id, right.id));
  const domainIds = new Set(sortedPacks.map(({ id }) => id));
  const routingDomainIds = new Set(routingPacks.map(({ domainId }) => domainId));
  if (
    sortedPacks.length === 0 ||
    domainIds.size !== sortedPacks.length ||
    routingDomainIds.size !== routingPacks.length ||
    routingDomainIds.size !== domainIds.size ||
    [...domainIds].some((domainId) => !routingDomainIds.has(domainId))
  ) {
    throw new SkillCatalogError("catalog-integrity", "Bundled Domain Pack ids must be unique.");
  }
  const domains = sortedPacks.map(domainCard);
  const sortedSkills = [...skills].sort((left, right) => canonicalCompare(left.manifest.id, right.manifest.id));
  if (
    sortedSkills.length === 0 ||
    new Set(sortedSkills.map(({ manifest }) => manifest.id)).size !== sortedSkills.length
  ) {
    throw new SkillCatalogError("catalog-integrity", "Bundled skill ids must be unique.");
  }

  const audited = await Promise.all(sortedSkills.map(async (skill) => {
    try {
      if (skill.manifest.source.type !== "curated" || skill.manifest.source.registry !== "local") {
        throw new Error(`Bundled skill ${skill.manifest.id} is not from the curated local registry.`);
      }
      await assertSkillIntegrity(skill);
      const audit = await (loaders.auditSkill ?? auditSkill)(skill);
      if (audit.checksum !== skill.checksum) {
        throw new Error(`Audit checksum does not match bundled skill ${skill.manifest.id}.`);
      }
      if (audit.riskLevel === "block") {
        throw new Error(`Bundled skill ${skill.manifest.id} is blocked by static audit.`);
      }
      return { skill, audit, card: skillCard(skill, audit, domainIds) };
    } catch (error) {
      if (error instanceof SkillCatalogError) throw error;
      throw new SkillCatalogError(
        "catalog-integrity",
        error instanceof Error ? error.message : String(error),
        { skillId: skill.manifest.id },
      );
    }
  }));

  const skillsForDigest = audited.map(({ skill, audit, card }) => ({
    card,
    packageChecksum: skill.checksum,
    manifest: skill.manifest,
    audit: auditProjection(audit),
  }));
  const domainsForDigest = sortedPacks.map((pack) => ({
    card: domainCard(pack),
    manifest: canonicalDomainManifest(pack, routingPacks.find(({ domainId }) => domainId === pack.id)),
  }));
  const digest = routerRecordDigest({
    schemaVersion: skillCatalogSchemaVersion,
    domains: domainsForDigest,
    skills: skillsForDigest,
  });
  return {
    domains,
    skills: audited.map(({ card }) => card),
    digest,
  };
};

const pageBytes = (domains: SkillCatalogDomain[], skills: SkillCatalogCard[]) =>
  Buffer.byteLength(JSON.stringify({ domains, skills }), "utf8");

const pageChainDigest = (input: {
  catalogDigest: string;
  page: number;
  offset: number;
  skills: SkillCatalogCard[];
  bytes: number;
  previousPageDigest: string;
}) => routerRecordDigest({
  catalogDigest: input.catalogDigest,
  page: input.page,
  offset: input.offset,
  skillIds: input.skills.map(({ skillId }) => skillId),
  bytes: input.bytes,
  previousPageDigest: input.previousPageDigest,
});

export const inspectSkillCatalog = async (
  input: InspectSkillCatalogInput = {},
  options: SkillCatalogSourceOptions = {},
): Promise<SkillCatalogPage> => {
  const snapshot = await loadSnapshot(options);
  const cursor = input.cursor === undefined ? undefined : validateCursorPayload(
    readToken<CursorPayload>(input.cursor, "catalog-cursor.", "cursor"),
  );
  const maxItems = pageLimit(input.maxItems, "maxItems", cursor?.maxItems ?? skillCatalogLimits.defaultMaxItems);
  const maxBytes = pageLimit(input.maxBytes, "maxBytes", cursor?.maxBytes ?? skillCatalogLimits.defaultMaxBytes);

  if (cursor && (maxItems !== cursor.maxItems || maxBytes !== cursor.maxBytes)) {
    throw new SkillCatalogError("catalog-cursor-invalid", "Catalog page limits cannot change during a cursor chain.");
  }
  if (cursor && input.expectedCatalogDigest === undefined) {
    throw new SkillCatalogError("catalog-cursor-invalid", "expectedCatalogDigest is required with a catalog cursor.", {
      argument: "expectedCatalogDigest",
    });
  }
  if (input.expectedCatalogDigest !== undefined) {
    const expected = assertDigest(input.expectedCatalogDigest, "expectedCatalogDigest");
    if (expected !== snapshot.digest) {
      throw new SkillCatalogError("catalog-digest-mismatch", "The catalog changed; restart discovery from the first page.", {
        expectedCatalogDigest: expected,
        currentCatalogDigest: snapshot.digest,
      });
    }
  }
  if (cursor && cursor.catalogDigest !== snapshot.digest) {
    throw new SkillCatalogError("catalog-digest-mismatch", "The catalog changed; restart discovery from the first page.", {
      expectedCatalogDigest: cursor.catalogDigest,
      currentCatalogDigest: snapshot.digest,
    });
  }

  const offset = cursor?.offset ?? 0;
  const pageNumber = cursor?.page ?? 0;
  const previousPageDigest = cursor?.previousPageDigest ?? routerRecordDigest({ kind: "initial-catalog-page" });
  if (offset > snapshot.skills.length) {
    throw new SkillCatalogError("catalog-cursor-invalid", "Catalog cursor points past the end of the catalog.");
  }
  const domains = offset === 0 ? snapshot.domains : [];
  const selected: SkillCatalogCard[] = [];
  const remaining = snapshot.skills.slice(offset);
  if (pageBytes(domains, []) > maxBytes) {
    throw new SkillCatalogError("catalog-page-limit-too-small", "maxBytes is too small for the complete domain overview.", {
      argument: "maxBytes",
    });
  }
  for (const skill of remaining) {
    if (selected.length >= maxItems) break;
    const candidate = [...selected, skill];
    const bytes = pageBytes(domains, candidate);
    if (bytes > maxBytes) {
      if (selected.length === 0) {
        throw new SkillCatalogError("catalog-page-limit-too-small", `maxBytes is too small for skill ${skill.skillId}.`, {
          argument: "maxBytes",
          skillId: skill.skillId,
        });
      }
      break;
    }
    selected.push(skill);
  }
  const bytes = pageBytes(domains, selected);
  const end = offset + selected.length;
  const complete = end === snapshot.skills.length;
  if (!complete && selected.length === 0) {
    throw new SkillCatalogError("catalog-page-limit-too-small", "The catalog page limits cannot deliver the next skill card.");
  }
  const chainDigest = pageChainDigest({
    catalogDigest: snapshot.digest,
    page: pageNumber + 1,
    offset,
    skills: selected,
    bytes,
    previousPageDigest,
  });
  const issuedAt = catalogNow(options.now);
  const expiresAt = issuedAt + skillCatalogLimits.receiptTtlMs;
  const nextCursor = complete
    ? null
    : signToken("catalog-cursor.", {
      kind: "cursor",
      schemaVersion: skillCatalogSchemaVersion,
      catalogDigest: snapshot.digest,
      offset: end,
      page: pageNumber + 1,
      maxItems,
      maxBytes,
      previousPageDigest: chainDigest,
    } satisfies CursorPayload);
  return {
    ok: true,
    schemaVersion: skillCatalogSchemaVersion,
    catalogDigest: snapshot.digest,
    domains,
    skills: selected,
    nextCursor,
    complete,
    ...(complete && cursor !== undefined ? {
      catalogReceipt: signToken("catalog-receipt.", {
        kind: "receipt",
        schemaVersion: skillCatalogSchemaVersion,
        catalogDigest: snapshot.digest,
        page: pageNumber + 1,
        itemCount: end,
        chainDigest,
        issuedAt,
        expiresAt,
      } satisfies ReceiptPayload),
    } : {}),
  };
};

export type CatalogReceiptValidationOptions = {
  expectedItemCount?: number;
  now?: number | Date;
};

export const assertValidCatalogReceipt = (
  receipt: string,
  catalogDigest: string,
  options: CatalogReceiptValidationOptions = {},
) => {
  const payload = validateReceiptPayload(readToken<ReceiptPayload>(receipt, "catalog-receipt.", "receipt"));
  if (payload.catalogDigest !== assertDigest(catalogDigest, "catalogDigest")) {
    throw new SkillCatalogError("catalog-digest-mismatch", "Catalog receipt belongs to a different catalog digest.", {
      expectedCatalogDigest: payload.catalogDigest,
      currentCatalogDigest: catalogDigest,
    });
  }
  if (options.expectedItemCount !== undefined && payload.itemCount !== options.expectedItemCount) {
    throw new SkillCatalogError("catalog-receipt-invalid", "Catalog receipt does not prove delivery of the complete catalog.", {
      expectedItemCount: options.expectedItemCount,
      receivedItemCount: payload.itemCount,
    });
  }
  if (catalogNow(options.now) >= payload.expiresAt) {
    throw new SkillCatalogError("catalog-receipt-invalid", "Catalog receipt has expired.");
  }
  return payload;
};

export const isCatalogReceiptValid = (receipt: string, catalogDigest: string, options: CatalogReceiptValidationOptions = {}) => {
  try {
    assertValidCatalogReceipt(receipt, catalogDigest, options);
    return true;
  } catch {
    return false;
  }
};

export const buildSkillCatalog = async (options: SkillCatalogSourceOptions = {}) => loadSnapshot(options);

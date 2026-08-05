import { createHash } from "node:crypto";
import {
  assertValidCatalogReceipt,
  type SkillCatalogCard,
  type SkillCatalogSnapshot,
} from "./catalog.ts";
import type { RoutingContext } from "./context.ts";
import { canonicalizeJson, routerRecordDigest } from "./store.ts";
import type { MatchedRoutingSignal } from "./vocabulary/match.ts";
import type { OwnerCanonicalAllowlists, RoutingSignalKind } from "./vocabulary/types.ts";
import { normalizeRoutingText } from "./vocabulary/normalize.ts";

export const routingProposalSchemaVersion = "routing-proposal/1.0" as const;

export const routingProposalLimits = {
  maxBytes: 32_768,
  maxInterpretationItems: 32,
  maxNominations: 16,
  maxPrimaryNominations: 3,
  maxCompanionNominations: 2,
  maxVerificationNominations: 2,
  maxEvidenceBytes: 512,
  maxCatalogReceiptBytes: 8_192,
} as const;

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const canonicalIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const nominationRoles = new Set(["primary", "companion", "verification"] as const);
const interpretationFields = [
  ["domains", "domain"],
  ["actions", "action"],
  ["artifactTypes", "artifact"],
  ["intentTags", "intent"],
  ["technologyTags", "technology"],
  ["qualityGoals", "quality"],
] as const;

export type RoutingProposalRole = "primary" | "companion" | "verification";

export type RoutingProposalInterpretation = {
  domains: string[];
  actions: string[];
  artifactTypes: string[];
  intentTags: string[];
  technologyTags: string[];
  qualityGoals: string[];
};

export type RoutingProposalNomination = {
  skillId: string;
  role: string;
  confidence: number;
  evidenceText: string;
};

export type RoutingProposalInput = {
  schemaVersion: typeof routingProposalSchemaVersion;
  catalogDigest: string;
  catalogReceipt: string;
  interpretation: RoutingProposalInterpretation;
  nominations: RoutingProposalNomination[];
  ambiguity?: { primarySkillIds: string[] };
};

export type RoutingProposalRejection = {
  skillId?: string;
  reasonCode: string;
};

export type RoutingProposalProjection = {
  schemaVersion: typeof routingProposalSchemaVersion;
  catalogDigest: string;
  proposalDigest: string;
  interpretation: RoutingProposalInterpretation;
  nominations: Array<{
    skillId: string;
    role: RoutingProposalRole;
    confidence: number;
    evidenceDigest: string;
  }>;
  rejections: RoutingProposalRejection[];
  ambiguity?: { primarySkillIds: string[] };
};

export type ValidatedRoutingProposalNomination = RoutingProposalProjection["nominations"][number] & {
  normalizedEvidence: string;
};

export type ValidatedRoutingProposal = {
  catalogDigest: string;
  proposalDigest: string;
  interpretation: RoutingProposalInterpretation;
  nominations: ValidatedRoutingProposalNomination[];
  rejections: RoutingProposalRejection[];
  ambiguity?: { primarySkillIds: string[] };
  semanticSignals: MatchedRoutingSignal[];
  projection: RoutingProposalProjection;
};

export type RoutingProposalRefresh = {
  status: "catalog_refresh_required";
  reasonCode: "catalog-digest-mismatch" | "catalog-receipt-invalid" | "catalog-receipt-expired" | "catalog-incomplete";
  currentCatalogDigest: string;
  nextTool: "inspect_skill_catalog";
};

export class RoutingProposalError extends Error {
  readonly code = "routing-proposal-invalid" as const;
  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "RoutingProposalError";
    this.details = details;
  }
}

const invalid = (message: string, details?: Record<string, unknown>): never => {
  throw new RoutingProposalError(message, details);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const isJsonValue = (value: unknown, seen = new WeakSet<object>()): boolean => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every((entry) => isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
};

const exactKeys = (value: Record<string, unknown>, required: string[], optional: string[], at: string) => {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) invalid(`${at}.${unknown} is an unknown property.`, { field: `${at}.${unknown}` });
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (missing) invalid(`${at}.${missing} is required.`, { field: `${at}.${missing}` });
};

const stringValue = (value: unknown, at: string, maxBytes = 128) => {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maxBytes) {
    invalid(`${at} must be a non-empty string of at most ${maxBytes} UTF-8 bytes.`, { field: at });
  }
  return value as string;
};

const canonicalId = (value: string, at: string) => {
  if (!canonicalIdPattern.test(value) || value.normalize("NFKC").toLowerCase() !== value) {
    invalid(`${at} must be a canonical ID.`, { field: at });
  }
  return value;
};

const stringArray = (value: unknown, at: string, maxItems: number): string[] => {
  if (!Array.isArray(value) || value.length > maxItems) {
    invalid(`${at} must be an array of at most ${maxItems} canonical IDs.`, { field: at });
  }
  const values = value as unknown[];
  const result = values.map((entry, index) => canonicalId(stringValue(entry, `${at}[${index}]`), `${at}[${index}]`));
  if (new Set(result).size !== result.length) invalid(`${at} must contain unique IDs.`, { field: at });
  return result;
};

const assertStructuralObject = (value: unknown): RoutingProposalInput => {
  if (!isJsonValue(value)) invalid("routingProposal must contain only structural JSON values.");
  if (!isRecord(value)) invalid("routingProposal must be a plain JSON object.");
  const record = value as Record<string, unknown>;
  exactKeys(record, ["schemaVersion", "catalogDigest", "catalogReceipt", "interpretation", "nominations"], ["ambiguity"], "routingProposal");
  if (record.schemaVersion !== routingProposalSchemaVersion) invalid("routingProposal.schemaVersion is invalid.", { field: "routingProposal.schemaVersion" });
  if (typeof record.catalogDigest !== "string" || !digestPattern.test(record.catalogDigest)) invalid("routingProposal.catalogDigest is invalid.", { field: "routingProposal.catalogDigest" });
  const receipt = stringValue(record.catalogReceipt, "routingProposal.catalogReceipt", routingProposalLimits.maxCatalogReceiptBytes);
  if (Buffer.byteLength(receipt, "utf8") > routingProposalLimits.maxCatalogReceiptBytes) invalid("routingProposal.catalogReceipt is too large.", { field: "routingProposal.catalogReceipt" });

  const rawInterpretation = record.interpretation;
  if (!isRecord(rawInterpretation)) invalid("routingProposal.interpretation must be an object.", { field: "routingProposal.interpretation" });
  const interpretationRecord = rawInterpretation as Record<string, unknown>;
  exactKeys(interpretationRecord, interpretationFields.map(([field]) => field), [], "routingProposal.interpretation");
  const interpretation = Object.fromEntries(interpretationFields.map(([field]) => [
    field,
    stringArray(interpretationRecord[field], `routingProposal.interpretation.${field}`, routingProposalLimits.maxInterpretationItems),
  ])) as unknown as RoutingProposalInterpretation;

  const rawNominations = record.nominations;
  if (!Array.isArray(rawNominations) || rawNominations.length === 0 || rawNominations.length > routingProposalLimits.maxNominations) {
    invalid(`routingProposal.nominations must contain between 1 and ${routingProposalLimits.maxNominations} items.`, { field: "routingProposal.nominations" });
  }
  const nominations = (rawNominations as unknown[]).map((entry, index) => {
    const at = `routingProposal.nominations[${index}]`;
    if (!isRecord(entry)) invalid(`${at} must be an object.`, { field: at });
    const nomination = entry as Record<string, unknown>;
    exactKeys(nomination, ["skillId", "role", "confidence", "evidenceText"], [], at);
    for (const field of ["skillId", "role", "evidenceText"] as const) {
      if (typeof nomination[field] !== "string") invalid(`${at}.${field} must be a string.`, { field: `${at}.${field}` });
    }
    if (typeof nomination.confidence !== "number" || !Number.isFinite(nomination.confidence) || nomination.confidence < 0 || nomination.confidence > 1) {
      invalid(`${at}.confidence must be a finite number between 0 and 1.`, { field: `${at}.confidence` });
    }
    // Nomination-level semantic failures are handled by validateRoutingProposal so that one
    // malformed nomination cannot erase usable nominations from the same proposal.
    return {
      skillId: typeof nomination.skillId === "string" ? nomination.skillId : "",
      role: typeof nomination.role === "string" ? nomination.role : "",
      confidence: typeof nomination.confidence === "number" ? nomination.confidence : Number.NaN,
      evidenceText: typeof nomination.evidenceText === "string" ? nomination.evidenceText : "",
    } satisfies RoutingProposalNomination;
  });

  let ambiguity: RoutingProposalInput["ambiguity"];
  if (record.ambiguity !== undefined) {
    const rawAmbiguity = record.ambiguity;
    if (!isRecord(rawAmbiguity)) invalid("routingProposal.ambiguity must be an object.", { field: "routingProposal.ambiguity" });
    const ambiguityRecord = rawAmbiguity as Record<string, unknown>;
    exactKeys(ambiguityRecord, ["primarySkillIds"], [], "routingProposal.ambiguity");
    const primarySkillIds = stringArray(ambiguityRecord.primarySkillIds, "routingProposal.ambiguity.primarySkillIds", 3);
    if (primarySkillIds.length < 2) invalid("routingProposal.ambiguity.primarySkillIds must contain two or three IDs.", { field: "routingProposal.ambiguity.primarySkillIds" });
    ambiguity = { primarySkillIds };
  }

  const proposal = { schemaVersion: routingProposalSchemaVersion, catalogDigest: record.catalogDigest as string, catalogReceipt: receipt, interpretation, nominations, ...(ambiguity ? { ambiguity } : {}) };
  let bytes = 0;
  try { bytes = Buffer.byteLength(canonicalizeJson(proposal), "utf8"); }
  catch { invalid("routingProposal must contain only structural JSON values."); }
  if (bytes > routingProposalLimits.maxBytes) invalid(`routingProposal exceeds ${routingProposalLimits.maxBytes} UTF-8 bytes.`);
  return proposal;
};

export const validateRoutingProposalShape = (value: unknown) => assertStructuralObject(value);

const evidenceDigest = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const rounded = (value: number) => Math.round(value * 1_000) / 1_000;

const ownerIdsFor = (
  kind: RoutingSignalKind,
  id: string,
  catalog: SkillCatalogSnapshot,
  ownerAllowlists?: ReadonlyMap<string, OwnerCanonicalAllowlists>,
) => {
  if (ownerAllowlists) {
    return [...ownerAllowlists].flatMap(([ownerKey, owner]) => {
      const values = kind === "domain" ? owner.domainIds
        : kind === "action" ? owner.actionIds
          : kind === "artifact" ? owner.artifactIds
            : kind === "intent" ? owner.intentIds
              : kind === "technology" ? owner.technologyIds
                : kind === "quality" ? owner.qualityIds
                  : kind === "constraint" ? owner.constraintIds : owner.acceptanceIds;
      if (!values.has(id)) return [];
      return [ownerKey === "core:core" ? "core" : ownerKey.replace(/^domain:/, "")];
    }).sort();
  }

  if (kind === "domain") return catalog.domains.some(({ domainId }) => domainId === id) ? [id] : [];
  const field = kind === "action" ? "actions"
    : kind === "artifact" ? "artifactTypes"
      : kind === "intent" ? "intentTags"
        : kind === "technology" ? "technologyTags" : "qualityGoals";
  const owners = catalog.skills.filter((skill) => skill[field].includes(id)).flatMap(({ domains }) => domains);
  if (kind === "action" || kind === "artifact" || kind === "quality") owners.push("core");
  return [...new Set(owners)].sort();
};

const cardById = (catalog: SkillCatalogSnapshot) => new Map(catalog.skills.map((card) => [card.skillId, card]));

const semanticSignal = (kind: RoutingSignalKind, id: string, ownerIds: string[], phrase: string, index: number): MatchedRoutingSignal => ({
  kind,
  id,
  confidence: 0.75,
  source: "host-semantic",
  evidenceEligible: false,
  phrase,
  ownerIds,
  start: index,
  end: index + phrase.length,
  originalStart: 0,
  originalEnd: 0,
});

const refresh = (reasonCode: RoutingProposalRefresh["reasonCode"], currentCatalogDigest: string): RoutingProposalRefresh => ({
  status: "catalog_refresh_required",
  reasonCode,
  currentCatalogDigest,
  nextTool: "inspect_skill_catalog",
});

const receiptReason = (error: unknown): RoutingProposalRefresh["reasonCode"] => {
  const code = (error as { code?: string }).code;
  if (code === "catalog-digest-mismatch") return "catalog-digest-mismatch";
  if (code === "catalog-receipt-invalid" && /expired/i.test(error instanceof Error ? error.message : "")) return "catalog-receipt-expired";
  if (code === "catalog-receipt-invalid" && /complete|item/i.test(error instanceof Error ? error.message : "")) return "catalog-incomplete";
  return "catalog-receipt-invalid";
};

const validateCatalogBinding = (proposal: RoutingProposalInput, catalog: SkillCatalogSnapshot) => {
  if (proposal.catalogDigest !== catalog.digest) return refresh("catalog-digest-mismatch", catalog.digest);
  try {
    assertValidCatalogReceipt(proposal.catalogReceipt, catalog.digest, { expectedItemCount: catalog.skills.length });
  } catch (error) {
    return refresh(receiptReason(error), catalog.digest);
  }
  return undefined;
};

export const validateRoutingProposalCatalogBinding = (input: {
  proposal: unknown;
  catalog: SkillCatalogSnapshot;
}): RoutingProposalRefresh | undefined => {
  const proposal = assertStructuralObject(input.proposal);
  return validateCatalogBinding(proposal, input.catalog);
};

export const validateRoutingProposal = (input: {
  proposal: unknown;
  prompt: string;
  catalog: SkillCatalogSnapshot;
  routingContext?: RoutingContext;
}): ValidatedRoutingProposal | RoutingProposalRefresh => {
  const proposal = assertStructuralObject(input.proposal);
  const bindingRefresh = validateCatalogBinding(proposal, input.catalog);
  if (bindingRefresh) return bindingRefresh;

  const ownerAllowlists = input.routingContext?.ownerAllowlists;
  for (const [field, kind] of interpretationFields) {
    for (const [index, id] of proposal.interpretation[field].entries()) {
      const canonical = canonicalId(id, `routingProposal.interpretation.${field}[${index}]`);
      if (ownerIdsFor(kind, canonical, input.catalog, ownerAllowlists).length === 0) {
        invalid(`routingProposal.interpretation.${field}[${index}] is not owner-scoped catalog metadata.`, { field: `routingProposal.interpretation.${field}[${index}]` });
      }
    }
  }

  const cards = cardById(input.catalog);
  const rejections: RoutingProposalRejection[] = [];
  const accepted: ValidatedRoutingProposalNomination[] = [];
  const seenSkills = new Set<string>();
  const roleCounts = new Map<RoutingProposalRole, number>();
  const normalizedPrompt = normalizeRoutingText(input.prompt).normalized;

  for (const nomination of proposal.nominations) {
    const rawSkillId = nomination.skillId;
    const canonicalSkillId = canonicalIdPattern.test(rawSkillId) && rawSkillId.normalize("NFKC").toLowerCase() === rawSkillId ? rawSkillId : undefined;
    const reject = (reasonCode: string, skillId = canonicalSkillId) => rejections.push({ ...(skillId ? { skillId } : {}), reasonCode });
    if (!canonicalSkillId) { reject("non-canonical-skill-id"); continue; }
    if (seenSkills.has(canonicalSkillId)) { reject("duplicate-skill"); continue; }
    const card = cards.get(canonicalSkillId);
    if (!card) { reject("skill-not-in-catalog"); continue; }
    if (!nominationRoles.has(nomination.role as RoutingProposalRole)) { reject("role-not-allowed", canonicalSkillId); continue; }
    const role = nomination.role as RoutingProposalRole;
    if (!card.roles.includes(role)) { reject("role-not-published-by-skill", canonicalSkillId); continue; }
    if (!Number.isFinite(nomination.confidence) || nomination.confidence < 0 || nomination.confidence > 1) { reject("confidence-out-of-range", canonicalSkillId); continue; }
    if (!nomination.evidenceText.trim() || Buffer.byteLength(nomination.evidenceText, "utf8") > routingProposalLimits.maxEvidenceBytes) { reject("evidence-invalid", canonicalSkillId); continue; }
    const normalizedEvidence = normalizeRoutingText(nomination.evidenceText).normalized;
    if (!normalizedEvidence || !normalizedPrompt.includes(normalizedEvidence)) { reject("evidence-not-in-normalized-prompt", canonicalSkillId); continue; }
    const count = roleCounts.get(role) ?? 0;
    const roleLimit = role === "primary"
      ? proposal.ambiguity?.primarySkillIds.length ?? routingProposalLimits.maxPrimaryNominations
      : role === "companion" ? routingProposalLimits.maxCompanionNominations : routingProposalLimits.maxVerificationNominations;
    if (count >= roleLimit) { reject(role === "primary" && !proposal.ambiguity ? "primary-limit" : "role-limit", canonicalSkillId); continue; }
    seenSkills.add(canonicalSkillId);
    roleCounts.set(role, count + 1);
    accepted.push({
      skillId: canonicalSkillId,
      role,
      confidence: rounded(nomination.confidence),
      evidenceDigest: evidenceDigest(normalizedEvidence),
      normalizedEvidence,
    });
  }

  const primaryIds = accepted.filter(({ role }) => role === "primary").map(({ skillId }) => skillId);
  let ambiguity: RoutingProposalInput["ambiguity"];
  if (proposal.ambiguity) {
    const uniquePrimaryIds = [...new Set(proposal.ambiguity.primarySkillIds)];
    if (uniquePrimaryIds.some((skillId) => !primaryIds.includes(skillId))) {
      invalid("routingProposal.ambiguity.primarySkillIds must identify valid primary nominations.", { field: "routingProposal.ambiguity.primarySkillIds" });
    }
    ambiguity = { primarySkillIds: uniquePrimaryIds };
  }

  const interpretation = Object.fromEntries(interpretationFields.map(([field]) => [field, [...proposal.interpretation[field]].sort()])) as unknown as RoutingProposalInterpretation;
  const semanticSignals = interpretationFields.flatMap(([field, kind]) => interpretation[field].map((id, index) => {
    const owners = ownerIdsFor(kind, id, input.catalog, ownerAllowlists);
    return semanticSignal(kind, id, owners, id, index);
  }));
  const nominatedDomains = accepted
    .filter(({ role }) => role === "primary")
    .flatMap(({ skillId }) => cards.get(skillId)?.domains ?? [])
    .filter((id) => !interpretation.domains.includes(id));
  for (const [index, id] of nominatedDomains.entries()) {
    semanticSignals.push(semanticSignal("domain", id, [id], id, interpretationFields.length + index));
  }

  const projectionWithoutDigest = {
    schemaVersion: routingProposalSchemaVersion,
    catalogDigest: input.catalog.digest,
    interpretation,
    nominations: accepted.map(({ normalizedEvidence: _normalizedEvidence, ...nomination }) => nomination),
    rejections: rejections.sort((left, right) => `${left.skillId ?? ""}:${left.reasonCode}`.localeCompare(`${right.skillId ?? ""}:${right.reasonCode}`)),
    ...(ambiguity ? { ambiguity } : {}),
  };
  const proposalDigest = routerRecordDigest(projectionWithoutDigest);
  const projection: RoutingProposalProjection = { ...projectionWithoutDigest, proposalDigest };
  return {
    catalogDigest: input.catalog.digest,
    proposalDigest,
    interpretation,
    nominations: accepted,
    rejections: projection.rejections,
    ...(ambiguity ? { ambiguity } : {}),
    semanticSignals,
    projection,
  };
};

const escapedRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const codeRanges = (source: string) => {
  const ranges: Array<[number, number]> = [];
  for (const match of source.matchAll(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/gu)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
};

const inRange = (position: number, ranges: Array<[number, number]>) => ranges.some(([start, end]) => position >= start && position < end);

const isNegatedChoice = (source: string, start: number) => {
  const sentenceStart = Math.max(
    source.lastIndexOf(".", start - 1),
    source.lastIndexOf("!", start - 1),
    source.lastIndexOf("?", start - 1),
    source.lastIndexOf("\n", start - 1),
    source.lastIndexOf(",", start - 1),
    source.lastIndexOf(";", start - 1),
  ) + 1;
  const prefix = source.slice(sentenceStart, start);
  return /\b(?:do\s+not|don't|dont|avoid|never|not|without|exclude|skip)\b[^.!?\n]{0,80}$/iu.test(prefix) ||
    /(?:^|\s)(?:не|без)\s+(?:(?:используй|использовать|используйте|бери|брать|нужен|нужно|выбирай|выбирать|применяй|применить)\s*)?$/iu.test(prefix);
};

const isAffirmativeChoice = (source: string, start: number) => {
  const clauseStart = Math.max(
    source.lastIndexOf(".", start - 1),
    source.lastIndexOf("!", start - 1),
    source.lastIndexOf("?", start - 1),
    source.lastIndexOf("\n", start - 1),
    source.lastIndexOf(",", start - 1),
    source.lastIndexOf(";", start - 1),
  ) + 1;
  const prefix = source.slice(clauseStart, start);
  return /(?:^|\s)(?:please\s+)?(?:use|select|choose|pick|apply|run|route(?:\s+(?:this|it))?\s+through|work\s+with)\s*:?\s+(?:(?:the|an?|exact|canonical|this)\s+)*(?:skill\s+)?(?:id\s+)?$/iu.test(prefix) ||
    /(?:^|\s)(?:пожалуйста\s+)?(?:используй|использовать|используйте|выбери|выбрать|выбирай|примени|применить|бери|брать|работай\s+с|через)\s*:?\s+(?:(?:этот|эту|точный|канонический)\s+)*(?:навык\s+)?(?:идентификатор\s+)?$/iu.test(prefix);
};

const isUrlOrCompoundToken = (source: string, start: number, end: number) => {
  const tokenStart = Math.max(source.lastIndexOf(" ", start - 1), source.lastIndexOf("\n", start - 1), source.lastIndexOf("\t", start - 1)) + 1;
  const remainder = source.slice(end);
  const nextSpace = remainder.search(/[\s]/u);
  const tokenEnd = nextSpace === -1 ? source.length : end + nextSpace;
  const token = source.slice(tokenStart, tokenEnd);
  return token.includes("://") || token.includes("/") || token.includes("\\") ||
    (start > tokenStart && /[.@]/u.test(source[start - 1]!)) ||
    (end < tokenEnd && /[.@]/u.test(source[end]!));
};

export const detectExplicitSkillChoice = (prompt: string, skillIds: Iterable<string>) => {
  const source = prompt.normalize("NFKC");
  const ranges = codeRanges(source);
  const occurrences: Array<{ skillId: string; start: number }> = [];
  for (const skillId of [...new Set(skillIds)]
    .filter((value) => canonicalIdPattern.test(value) && value.normalize("NFKC").toLowerCase() === value)
    .sort((left, right) => left.length - right.length || left.localeCompare(right))) {
    const expression = new RegExp(`(^|[^\\p{L}\\p{N}_.-])(${escapedRegExp(skillId)})(?=$|[^\\p{L}\\p{N}_.-])`, "gu");
    for (const match of source.matchAll(expression)) {
      const start = (match.index ?? 0) + match[1].length;
      const end = start + skillId.length;
      if (inRange(start, ranges) || isUrlOrCompoundToken(source, start, end) || isNegatedChoice(source, start) || !isAffirmativeChoice(source, start)) continue;
      occurrences.push({ skillId, start });
    }
  }
  return occurrences.sort((left, right) => left.start - right.start || left.skillId.localeCompare(right.skillId))[0]?.skillId;
};

import { createHash } from "node:crypto";
import type { RoutingContext } from "./context.ts";
import { canonicalizeJson, routerRecordDigest } from "./store.ts";
import type { SemanticHint, SemanticHintsInput } from "./types.ts";
import type { MatchedRoutingSignal } from "./vocabulary/match.ts";
import { normalizeRoutingText, type NormalizedText } from "./vocabulary/normalize.ts";
import type { RoutingSignalKind } from "./vocabulary/types.ts";

export type SemanticHintProjection = {
  kind: SemanticHint["kind"];
  id: string;
  confidence: number;
  evidenceDigest: string;
};

export type SemanticHintValidationResult = {
  issues: string[];
  signals: MatchedRoutingSignal[];
  digest: string;
};

const kinds = new Set<SemanticHint["kind"]>(["domain", "action", "artifact", "intent", "technology", "quality"]);
const canonicalId = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const round = (value: number) => Math.round(value * 1_000) / 1_000;
const evidenceDigest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isJsonValue = (value: unknown, seen = new WeakSet<object>()): boolean => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value as object)) return false;
  seen.add(value as object);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : Object.getPrototypeOf(value) === Object.prototype && Object.values(value as Record<string, unknown>).every((entry) => isJsonValue(entry, seen));
  seen.delete(value as object);
  return valid;
};
const allowlistFor = (context: RoutingContext, ownerKey: string, kind: SemanticHint["kind"]) => {
  const owner = context.ownerAllowlists.get(ownerKey as `core:core` | `domain:${string}`);
  if (!owner) return undefined;
  if (kind === "domain") return owner.domainIds;
  if (kind === "action") return owner.actionIds;
  if (kind === "artifact") return owner.artifactIds;
  if (kind === "intent") return owner.intentIds;
  if (kind === "technology") return owner.technologyIds;
  return owner.qualityIds;
};
const ownersFor = (context: RoutingContext, kind: SemanticHint["kind"], id: string) => [...context.ownerAllowlists]
  .filter(([ownerKey]) => allowlistFor(context, ownerKey, kind)?.has(id as never))
  .map(([ownerKey]) => ownerKey === "core:core" ? "core" : ownerKey.slice("domain:".length))
  .sort();

const originalSpan = (text: NormalizedText, start: number, end: number) => {
  const covered = text.tokens.filter((token) => token.normalizedStart < end && token.normalizedEnd > start);
  return covered.length ? {
    originalStart: Math.min(...covered.map(({ originalStart }) => originalStart)),
    originalEnd: Math.max(...covered.map(({ originalEnd }) => originalEnd)),
  } : { originalStart: 0, originalEnd: 0 };
};

export const validateSemanticHints = (input: {
  semanticHints: unknown;
  prompt: string;
  context: RoutingContext;
}): SemanticHintValidationResult => {
  const issues: string[] = [];
  const empty = { issues, signals: [], digest: routerRecordDigest([]) };
  if (input.semanticHints === undefined) return empty;
  if (!isJsonValue(input.semanticHints)) return { ...empty, issues: ["semanticHints must be a structural JSON value"] };
  let byteLength = 0;
  try { byteLength = Buffer.byteLength(canonicalizeJson(input.semanticHints), "utf8"); }
  catch { return { ...empty, issues: ["semanticHints must be a structural JSON value"] }; }
  if (byteLength > 16_384) issues.push("semanticHints exceeds 16384 UTF-8 bytes");
  if (!isRecord(input.semanticHints)) return { ...empty, issues: [...issues, "semanticHints must be an object"] };
  const root = input.semanticHints;
  for (const key of Object.keys(root)) if (!new Set(["schemaVersion", "signals"]).has(key)) issues.push(`semanticHints.${key} is an unknown property`);
  if (root.schemaVersion !== "semantic-hints/1.0") issues.push("semanticHints.schemaVersion is invalid");
  if (!Array.isArray(root.signals)) return { ...empty, issues: [...issues, "semanticHints.signals must be an array"] };
  if (root.signals.length > 32) issues.push("semanticHints.signals exceeds 32 items");
  const prompt = normalizeRoutingText(input.prompt);
  const validated: Array<SemanticHint & { normalizedEvidence: string; ownerIds: string[]; start: number; end: number }> = [];
  for (const [index, raw] of root.signals.entries()) {
    const at = `semanticHints.signals[${index}]`;
    if (!isRecord(raw)) { issues.push(`${at} must be an object`); continue; }
    for (const key of Object.keys(raw)) if (!new Set(["kind", "id", "evidenceText", "confidence"]).has(key)) issues.push(`${at}.${key} is an unknown property`);
    if (!kinds.has(raw.kind as SemanticHint["kind"])) issues.push(`${at}.kind is invalid`);
    if (typeof raw.id !== "string" || !canonicalId.test(raw.id)) issues.push(`${at}.id is invalid`);
    if (typeof raw.evidenceText !== "string" || raw.evidenceText.trim() === "") issues.push(`${at}.evidenceText must be non-empty`);
    else if (Buffer.byteLength(raw.evidenceText, "utf8") > 256) issues.push(`${at}.evidenceText exceeds 256 UTF-8 bytes`);
    if (typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence) || raw.confidence < 0.5 || raw.confidence > 1) issues.push(`${at}.confidence must be between 0.5 and 1.0`);
    if (!kinds.has(raw.kind as SemanticHint["kind"]) || typeof raw.id !== "string" || !canonicalId.test(raw.id) ||
      typeof raw.evidenceText !== "string" || raw.evidenceText.trim() === "" || typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence)) continue;
    const kind = raw.kind as SemanticHint["kind"];
    const ownerIds = ownersFor(input.context, kind, raw.id);
    if (ownerIds.length === 0) { issues.push(`${at}.id is not owner-scoped canonical metadata`); continue; }
    const normalizedEvidence = normalizeRoutingText(raw.evidenceText).normalized;
    const start = prompt.normalized.indexOf(normalizedEvidence);
    if (!normalizedEvidence || start < 0) { issues.push(`${at}.evidenceText is not present in the normalized intent`); continue; }
    validated.push({ kind, id: raw.id, evidenceText: raw.evidenceText, confidence: Math.min(0.75, raw.confidence), normalizedEvidence, ownerIds, start, end: start + normalizedEvidence.length });
  }
  if (issues.length) return { issues, signals: [], digest: routerRecordDigest([]) };
  const deduped = new Map<string, typeof validated[number]>();
  for (const hint of validated) {
    const key = `${hint.kind}\0${hint.id}\0${hint.normalizedEvidence}`;
    const current = deduped.get(key);
    if (!current || hint.confidence > current.confidence) deduped.set(key, hint);
  }
  const values = [...deduped.values()];
  const projection: SemanticHintProjection[] = values.map((hint) => ({
    kind: hint.kind,
    id: hint.id,
    confidence: round(hint.confidence),
    evidenceDigest: evidenceDigest(hint.normalizedEvidence),
  })).sort((left, right) => `${left.kind}:${left.id}:${left.confidence}:${left.evidenceDigest}`.localeCompare(`${right.kind}:${right.id}:${right.confidence}:${right.evidenceDigest}`));
  const signals = values.map((hint): MatchedRoutingSignal => ({
    kind: hint.kind as RoutingSignalKind,
    id: hint.id,
    confidence: round(hint.confidence),
    source: "host-semantic",
    evidenceEligible: false,
    phrase: hint.normalizedEvidence,
    ownerIds: hint.ownerIds,
    start: hint.start,
    end: hint.end,
    ...originalSpan(prompt, hint.start, hint.end),
  })).sort((left, right) => left.start - right.start || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  return { issues, signals, digest: routerRecordDigest(projection) };
};

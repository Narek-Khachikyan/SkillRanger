import type { EvidenceSignalSource } from "../../domains/types.ts";
import type {
  RoutingSignalKind,
  RoutingVocabularyEntry,
  RoutingVocabularyLocale,
} from "./types.ts";
import { normalizeRoutingText, type NormalizedText } from "./normalize.ts";

export type OwnedRoutingVocabularyEntry = Omit<RoutingVocabularyEntry, "locale"> & {
  locales: RoutingVocabularyLocale[];
  ownerIds: string[];
  localeMultiplier: number;
  origin: "explicit" | "baseline";
  evidenceEligible: boolean;
};

export type CompiledRoutingClaim = {
  entry: OwnedRoutingVocabularyEntry;
  normalizedPhrase: string;
  tokenLength: number;
  negative: boolean;
};

export type RoutingTrieNode = {
  children: ReadonlyMap<string, RoutingTrieNode>;
  claims: ReadonlyArray<CompiledRoutingClaim>;
};

export type CompiledRoutingVocabulary = {
  root: RoutingTrieNode;
  maxPhraseTokens: number;
  phraseCount: number;
};

export type RoutingSuppression = {
  signalKind: RoutingSignalKind;
  id: string;
  start: number;
  end: number;
  originalStart: number;
  originalEnd: number;
};

export type MatchedRoutingSignal = {
  kind: RoutingSignalKind;
  id: string;
  confidence: number;
  source: Exclude<EvidenceSignalSource, "fingerprint">;
  evidenceEligible: boolean;
  phrase: string;
  ownerIds: string[];
  start: number;
  end: number;
  originalStart: number;
  originalEnd: number;
};

export type RoutingMatchResult = {
  signals: MatchedRoutingSignal[];
  suppressions: RoutingSuppression[];
  protectedBoundaryIndexes: number[];
  operationCount: number;
};

type MutableTrieNode = { children: Map<string, MutableTrieNode>; claims: CompiledRoutingClaim[] };
type Candidate = {
  claim: CompiledRoutingClaim;
  tokenStart: number;
  tokenEnd: number;
  start: number;
  end: number;
  originalStart: number;
  originalEnd: number;
};

const kindPrecedence: RoutingSignalKind[] = [
  "intent", "artifact", "technology", "quality", "action", "domain", "constraint", "acceptance",
];
const tokensForPhrase = (phrase: string) => normalizeRoutingText(phrase).tokens.map(({ value }) => value);
const entryOrder = (left: CompiledRoutingClaim, right: CompiledRoutingClaim) =>
  right.tokenLength - left.tokenLength ||
  right.normalizedPhrase.length - left.normalizedPhrase.length ||
  (right.entry.priority ?? 50) - (left.entry.priority ?? 50) ||
  (right.entry.weight ?? 1) - (left.entry.weight ?? 1) ||
  kindPrecedence.indexOf(left.entry.kind) - kindPrecedence.indexOf(right.entry.kind) ||
  (left.entry.ownerIds[0] ?? "").localeCompare(right.entry.ownerIds[0] ?? "") ||
  left.entry.id.localeCompare(right.entry.id);

export const compileRoutingVocabulary = (
  entries: OwnedRoutingVocabularyEntry[],
): CompiledRoutingVocabulary => {
  const root: MutableTrieNode = { children: new Map(), claims: [] };
  let maxPhraseTokens = 0;
  let phraseCount = 0;
  const insert = (entry: OwnedRoutingVocabularyEntry, phrase: string, negative: boolean) => {
    const tokens = tokensForPhrase(phrase);
    if (tokens.length === 0) return;
    let node = root;
    for (const token of tokens) {
      let child = node.children.get(token);
      if (!child) {
        child = { children: new Map(), claims: [] };
        node.children.set(token, child);
      }
      node = child;
    }
    node.claims.push({ entry, normalizedPhrase: tokens.join(" "), tokenLength: tokens.length, negative });
    maxPhraseTokens = Math.max(maxPhraseTokens, tokens.length);
    phraseCount += 1;
  };
  for (const entry of entries) {
    for (const phrase of entry.phrases) insert(entry, phrase, false);
    for (const phrase of entry.negativePhrases ?? []) insert(entry, phrase, true);
  }
  const freeze = (node: MutableTrieNode): RoutingTrieNode => ({
    children: new Map([...node.children.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, freeze(child)])),
    claims: [...node.claims].sort(entryOrder),
  });
  return { root: freeze(root), maxPhraseTokens, phraseCount };
};

const candidateOrder = (left: Candidate, right: Candidate) =>
  entryOrder(left.claim, right.claim) ||
  left.start - right.start ||
  left.end - right.end;
const overlaps = (left: Candidate, right: Candidate) => left.start < right.end && right.start < left.end;
const exactSpan = (left: Candidate, right: Candidate) => left.start === right.start && left.end === right.end;
const hasBoundaryBetween = (text: NormalizedText, tokenEnd: number, tokenStart: number) =>
  text.boundaries.some(({ tokenIndex }) => tokenIndex >= tokenEnd && tokenIndex <= tokenStart);

const promptSource = (text: NormalizedText, candidate: Candidate): "prompt-exact" | "prompt-normalized" => {
  const original = text.original.slice(candidate.originalStart, candidate.originalEnd).normalize("NFKC").toLocaleLowerCase("und");
  return candidate.claim.entry.phrases.some((phrase) => phrase.normalize("NFKC").toLocaleLowerCase("und") === original)
    ? "prompt-exact"
    : "prompt-normalized";
};

export const matchRoutingVocabulary = (input: {
  text: NormalizedText;
  vocabulary: CompiledRoutingVocabulary;
}): RoutingMatchResult => {
  const candidates: Candidate[] = [];
  let operationCount = 0;
  for (let tokenStart = 0; tokenStart < input.text.tokens.length; tokenStart += 1) {
    let node: RoutingTrieNode | undefined = input.vocabulary.root;
    const maximum = Math.min(input.text.tokens.length, tokenStart + input.vocabulary.maxPhraseTokens);
    for (let tokenEnd = tokenStart; tokenEnd < maximum; tokenEnd += 1) {
      operationCount += 1;
      node = node.children.get(input.text.tokens[tokenEnd].value);
      if (!node) break;
      for (const claim of node.claims) {
        const first = input.text.tokens[tokenStart];
        const last = input.text.tokens[tokenEnd];
        candidates.push({
          claim,
          tokenStart,
          tokenEnd: tokenEnd + 1,
          start: first.normalizedStart,
          end: last.normalizedEnd,
          originalStart: first.originalStart,
          originalEnd: last.originalEnd,
        });
      }
    }
  }

  const negatives = candidates.filter(({ claim }) => claim.negative);
  const positives = candidates.filter(({ claim }) => !claim.negative);
  const suppressed: Candidate[] = [];
  const unsuppressed = positives.filter((positive) => {
    const match = negatives.find((negative) => negative.claim.entry === positive.claim.entry && (
      overlaps(negative, positive) ||
      (negative.tokenEnd <= positive.tokenStart && positive.tokenStart - negative.tokenEnd <= 3 &&
        !hasBoundaryBetween(input.text, negative.tokenEnd, positive.tokenStart))
    ));
    if (match) suppressed.push(positive);
    return !match;
  });

  const selected: Candidate[] = [];
  for (const candidate of [...unsuppressed].sort(candidateOrder)) {
    const blocked = selected.some((existing) =>
      existing.claim.entry.kind === candidate.claim.entry.kind && overlaps(existing, candidate) && !exactSpan(existing, candidate));
    if (!blocked) selected.push(candidate);
  }
  selected.sort((left, right) => left.start - right.start || candidateOrder(left, right));

  const deduped = new Map<string, MatchedRoutingSignal>();
  for (const candidate of selected) {
    const source = promptSource(input.text, candidate);
    const confidence = Math.min(1, (candidate.claim.entry.weight ?? 1) * candidate.claim.entry.localeMultiplier);
    const signal: MatchedRoutingSignal = {
      kind: candidate.claim.entry.kind,
      id: candidate.claim.entry.id,
      confidence,
      source,
      evidenceEligible: candidate.claim.entry.evidenceEligible,
      phrase: candidate.claim.normalizedPhrase,
      ownerIds: [...candidate.claim.entry.ownerIds].sort(),
      start: candidate.start,
      end: candidate.end,
      originalStart: candidate.originalStart,
      originalEnd: candidate.originalEnd,
    };
    const key = `${signal.kind}\0${signal.id}\0${signal.source}\0${signal.start}\0${signal.end}`;
    const existing = deduped.get(key);
    if (!existing) deduped.set(key, signal);
    else {
      existing.confidence = Math.max(existing.confidence, signal.confidence);
      existing.ownerIds = [...new Set([...existing.ownerIds, ...signal.ownerIds])].sort();
      existing.evidenceEligible ||= signal.evidenceEligible;
    }
  }
  const protectedBoundaryIndexes = input.text.boundaries.flatMap((boundary, index) =>
    selected.some(({ tokenStart, tokenEnd }) => tokenStart < boundary.tokenIndex && boundary.tokenIndex < tokenEnd) ? [index] : []);
  return {
    signals: [...deduped.values()],
    suppressions: suppressed.map((candidate) => ({
      signalKind: candidate.claim.entry.kind,
      id: candidate.claim.entry.id,
      start: candidate.start,
      end: candidate.end,
      originalStart: candidate.originalStart,
      originalEnd: candidate.originalEnd,
    })),
    protectedBoundaryIndexes,
    operationCount,
  };
};

export const buildCanonicalBaselineEntries = (input: {
  ownerId: string;
  claims: Array<{ kind: RoutingSignalKind; id: string }>;
  domainAliases?: string[];
}): OwnedRoutingVocabularyEntry[] => {
  const result: OwnedRoutingVocabularyEntry[] = input.claims.map(({ kind, id }) => {
    const spaced = id.replace(/[-_]+/gu, " ");
    return {
      kind,
      id,
      phrases: spaced === id ? [id] : [id, spaced],
      locales: ["mixed"],
      ownerIds: [input.ownerId],
      localeMultiplier: 1,
      origin: "baseline",
      evidenceEligible: false,
      weight: 1,
      priority: 0,
    };
  });
  if (input.domainAliases?.length) {
    const domain = input.claims.find(({ kind }) => kind === "domain");
    if (domain) result.push({
      kind: "domain",
      id: domain.id,
      phrases: [...new Set(input.domainAliases.flatMap((alias) => {
        const spaced = alias.replace(/[-_]+/gu, " ");
        return spaced === alias ? [alias] : [alias, spaced];
      }))],
      locales: ["mixed"],
      ownerIds: [input.ownerId],
      localeMultiplier: 1,
      origin: "baseline",
      evidenceEligible: false,
      weight: 1,
      priority: 0,
    });
  }
  return result;
};

import type { MatchedRoutingSignal, RoutingSuppression } from "./vocabulary/match.ts";
import type { NormalizedText } from "./vocabulary/normalize.ts";

export type RequestFrameMatch = {
  phrase: string;
  start: number;
  end: number;
  originalStart: number;
  originalEnd: number;
};

const requestFrames = [
  "дай мне", "мне нужен", "мне нужна", "мне нужно", "give me", "i want", "i need", "need an", "need a",
  "дай", "хочу", "нужен", "нужна", "нужно",
].map((phrase) => ({ phrase, tokens: phrase.split(" ") }))
  .sort((left, right) => right.tokens.length - left.tokens.length || left.phrase.localeCompare(right.phrase));

const tokenRangeForSignal = (text: NormalizedText, signal: MatchedRoutingSignal) => {
  const tokenStart = text.tokens.findIndex(({ normalizedEnd }) => normalizedEnd > signal.start);
  let tokenEnd = tokenStart;
  while (tokenEnd < text.tokens.length && text.tokens[tokenEnd].normalizedStart < signal.end) tokenEnd += 1;
  return { tokenStart, tokenEnd };
};

const boundaryIsProtected = (text: NormalizedText, boundaryIndex: number, signals: MatchedRoutingSignal[]) => {
  const boundary = text.boundaries[boundaryIndex];
  return signals.some((signal) => {
    const { tokenStart, tokenEnd } = tokenRangeForSignal(text, signal);
    return tokenStart < boundary.tokenIndex && boundary.tokenIndex < tokenEnd ||
      (boundary.separator !== "," && boundary.separator !== ";" && tokenStart <= boundary.tokenIndex && boundary.tokenIndex < tokenEnd);
  });
};

export const inferRequestFrameActions = (input: {
  text: NormalizedText;
  matchedSignals: MatchedRoutingSignal[];
  suppressions: RoutingSuppression[];
  creatableArtifactIds: ReadonlySet<string>;
}): MatchedRoutingSignal[] => {
  const boundaries = input.text.boundaries
    .filter((_, index) => !boundaryIsProtected(input.text, index, input.matchedSignals))
    .map(({ tokenIndex }) => tokenIndex)
    .sort((left, right) => left - right);
  const segmentFor = (tokenIndex: number) => boundaries.filter((boundary) => boundary <= tokenIndex).length;
  const explicitActionSegments = new Set(input.matchedSignals
    .filter(({ kind }) => kind === "action")
    .map((signal) => segmentFor(tokenRangeForSignal(input.text, signal).tokenStart)));
  const artifacts = input.matchedSignals
    .filter((signal) => signal.kind === "artifact" && input.creatableArtifactIds.has(signal.id))
    .map((signal) => ({ signal, ...tokenRangeForSignal(input.text, signal) }))
    .sort((left, right) => left.signal.start - right.signal.start || right.signal.end - left.signal.end || left.signal.id.localeCompare(right.signal.id));

  const frames: Array<RequestFrameMatch & { tokenStart: number; tokenEnd: number }> = [];
  for (let tokenStart = 0; tokenStart < input.text.tokens.length; tokenStart += 1) {
    const match = requestFrames.find(({ tokens }) => tokens.every((token, offset) => input.text.tokens[tokenStart + offset]?.value === token));
    if (!match) continue;
    const first = input.text.tokens[tokenStart];
    const last = input.text.tokens[tokenStart + match.tokens.length - 1];
    frames.push({
      phrase: match.phrase,
      tokenStart,
      tokenEnd: tokenStart + match.tokens.length,
      start: first.normalizedStart,
      end: last.normalizedEnd,
      originalStart: first.originalStart,
      originalEnd: last.originalEnd,
    });
  }

  const emittedSegments = new Set<number>();
  const inferred: MatchedRoutingSignal[] = [];
  for (const frame of frames.sort((left, right) => left.start - right.start || right.end - left.end)) {
    const segment = segmentFor(frame.tokenStart);
    if (explicitActionSegments.has(segment) || emittedSegments.has(segment)) continue;
    const previous = input.text.tokens.slice(Math.max(0, frame.tokenStart - 2), frame.tokenStart).map(({ value }) => value);
    const immediatelyNegated = ["не", "нет", "no", "not"].includes(previous.at(-1) ?? "") ||
      ["do not", "don t"].includes(previous.join(" "));
    if (immediatelyNegated) continue;
    const artifact = artifacts.find((candidate) => candidate.signal.start >= frame.end && segmentFor(candidate.tokenStart) === segment);
    if (!artifact) continue;
    const artifactPrevious = input.text.tokens.slice(Math.max(0, artifact.tokenStart - 2), artifact.tokenStart).map(({ value }) => value);
    if (["без", "no", "without"].includes(artifactPrevious.at(-1) ?? "") ||
      /^without (?:a|an|the)$/u.test(artifactPrevious.join(" "))) continue;
    const suppressed = input.suppressions.some((suppression) => suppression.signalKind === "action" && suppression.id === "create" &&
      suppression.originalStart < artifact.signal.originalEnd && frame.originalStart < suppression.originalEnd);
    if (suppressed) continue;
    inferred.push({
      kind: "action",
      id: "create",
      confidence: 0.75,
      source: "prompt-inferred",
      evidenceEligible: true,
      phrase: frame.phrase,
      ownerIds: ["core"],
      start: frame.start,
      end: frame.end,
      originalStart: frame.originalStart,
      originalEnd: frame.originalEnd,
    });
    emittedSegments.add(segment);
  }
  return inferred;
};


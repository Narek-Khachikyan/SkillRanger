import type { RoutingContext } from "./context.ts";
import type { CanonicalRequirement } from "./requirements.ts";
import { routerRecordDigest } from "./store.ts";
import type { MatchedRoutingSignal } from "./vocabulary/match.ts";
import type { NormalizedText } from "./vocabulary/normalize.ts";

export type InternalTaskSegment = {
  id: string;
  originalStart: number;
  originalEnd: number;
  requirements: CanonicalRequirement[];
  matchedSignals: MatchedRoutingSignal[];
  explicitDomainIds: string[];
  candidateDomainIds: string[];
  primaryDomainId?: string;
  head: boolean;
};

const kindOrder = ["action", "artifact", "intent", "technology", "quality"] as const;
const boundaryOrder = [";", "then", "потом", ",", "and", "и"] as const;
const unique = <T>(values: T[]) => [...new Set(values)];
const requirementKey = (requirement: CanonicalRequirement) => `${requirement.kind}:${requirement.id}`;

export const taskSegmentId = (input: Pick<InternalTaskSegment, "requirements" | "candidateDomainIds" | "primaryDomainId">) => {
  const projection = {
    requirements: [...input.requirements].sort((left, right) => requirementKey(left).localeCompare(requirementKey(right)))
      .map(({ kind, id, confidence, requirementClass }) => ({ kind, id, confidence, requirementClass })),
    candidateDomainIds: [...input.candidateDomainIds],
    ...(input.primaryDomainId ? { primaryDomainId: input.primaryDomainId } : {}),
  };
  return `task-${routerRecordDigest(projection).slice("sha256:".length, "sha256:".length + 12)}`;
};

const domainIds = (signals: MatchedRoutingSignal[], context: RoutingContext) => unique(signals.flatMap((signal) => {
  if (signal.kind === "domain" && context.domains.has(signal.id)) return [signal.id];
  if (!["artifact", "intent", "technology", "quality"].includes(signal.kind)) return [];
  return signal.ownerIds.filter((id) => context.domains.has(id));
}));

const makeSegment = (input: {
  originalStart: number;
  originalEnd: number;
  signals: MatchedRoutingSignal[];
  requirements: CanonicalRequirement[];
  context: RoutingContext;
}): InternalTaskSegment => {
  const signalKeys = new Set(input.signals.map(({ kind, id }) => `${kind}:${id}`));
  const requirements = input.requirements.filter((requirement) => signalKeys.has(requirementKey(requirement)))
    .sort((left, right) => kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind) || left.id.localeCompare(right.id));
  const explicitDomainIds = unique(input.signals.filter(({ kind, source }) => kind === "domain" && source !== "host-semantic").map(({ id }) => id));
  const head = input.signals.some((signal) => signal.source !== "host-semantic" &&
    (signal.kind === "domain" || ((signal.kind === "action" || signal.kind === "artifact") &&
      requirements.some((requirement) => requirement.kind === signal.kind && requirement.id === signal.id && requirement.requirementClass !== "context"))));
  const segment = {
    id: "",
    originalStart: input.originalStart,
    originalEnd: input.originalEnd,
    requirements,
    matchedSignals: input.signals,
    explicitDomainIds,
    candidateDomainIds: domainIds(input.signals, input.context),
    head,
  };
  return { ...segment, id: taskSegmentId(segment) };
};

export const segmentAnalyzedTask = (input: {
  text: NormalizedText;
  signals: MatchedRoutingSignal[];
  requirements: CanonicalRequirement[];
  context: RoutingContext;
}): InternalTaskSegment[] => {
  const boundaries = input.text.boundaries
    .filter((boundary) => !input.signals.some((signal) => signal.originalStart < boundary.originalStart && boundary.originalEnd < signal.originalEnd))
    .sort((left, right) => left.originalStart - right.originalStart ||
      boundaryOrder.indexOf(left.separator) - boundaryOrder.indexOf(right.separator));
  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (const boundary of boundaries) {
    if (boundary.tokenIndex > start) ranges.push({ start, end: boundary.tokenIndex });
    const wordBoundary = boundary.separator !== "," && boundary.separator !== ";";
    start = Math.max(start, boundary.tokenIndex + (wordBoundary ? 1 : 0));
  }
  if (start < input.text.tokens.length) ranges.push({ start, end: input.text.tokens.length });
  const segments = ranges.filter(({ start, end }) => end > start).map((range) => {
    const originalStart = input.text.tokens[range.start].originalStart;
    const originalEnd = input.text.tokens[range.end - 1].originalEnd;
    return makeSegment({
      originalStart,
      originalEnd,
      signals: input.signals.filter((signal) => signal.originalStart >= originalStart && signal.originalEnd <= originalEnd),
      requirements: input.requirements,
      context: input.context,
    });
  }).filter(({ matchedSignals }) => matchedSignals.length > 0);
  const headIndexes = segments.flatMap((segment, index) => segment.head ? [index] : []);
  if (headIndexes.length === 0) {
    if (segments.length === 0) return [];
    return [makeSegment({
      originalStart: Math.min(...segments.map(({ originalStart }) => originalStart)),
      originalEnd: Math.max(...segments.map(({ originalEnd }) => originalEnd)),
      signals: segments.flatMap(({ matchedSignals }) => matchedSignals),
      requirements: input.requirements,
      context: input.context,
    })];
  }
  const attached = new Map<number, InternalTaskSegment[]>(headIndexes.map((index) => [index, [segments[index]]]));
  segments.forEach((segment, index) => {
    if (segment.head) return;
    const previous = headIndexes.filter((headIndex) => headIndex < index).at(-1);
    const next = headIndexes.find((headIndex) => headIndex > index);
    const target = previous === undefined ? next : next === undefined ? previous :
      segment.originalStart - segments[previous].originalEnd <= segments[next].originalStart - segment.originalEnd ? previous : next;
    if (target !== undefined) attached.get(target)?.push(segment);
  });
  return headIndexes.map((index) => {
    const group = attached.get(index) ?? [segments[index]];
    return makeSegment({
      originalStart: Math.min(...group.map(({ originalStart }) => originalStart)),
      originalEnd: Math.max(...group.map(({ originalEnd }) => originalEnd)),
      signals: group.flatMap(({ matchedSignals }) => matchedSignals).sort((left, right) => left.originalStart - right.originalStart),
      requirements: input.requirements,
      context: input.context,
    });
  });
};

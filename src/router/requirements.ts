import { routerRecordDigest } from "./store.ts";
import type { RoutingSignalKind } from "./vocabulary/types.ts";

export type CanonicalRequirementKind = "action" | "artifact" | "intent" | "technology" | "quality";
export type CanonicalRequirementSource = "prompt-exact" | "prompt-normalized" | "prompt-inferred" | "host-semantic" | "fingerprint";

export type CanonicalRequirement = {
  kind: CanonicalRequirementKind;
  id: string;
  confidence: number;
  baseWeight: number;
  sources: CanonicalRequirementSource[];
  requirementClass: "explicit" | "inferred" | "context";
};

export type InternalRoutingSignal = {
  kind: RoutingSignalKind;
  id: string;
  source: CanonicalRequirementSource;
  evidenceEligible: boolean;
  ownerIds: string[];
  confidence: number;
};

const sourceOrder: CanonicalRequirementSource[] = ["prompt-exact", "prompt-normalized", "prompt-inferred", "host-semantic", "fingerprint"];
const kindOrder: RoutingSignalKind[] = ["domain", "action", "artifact", "intent", "technology", "quality", "constraint", "acceptance"];
const weights: Record<CanonicalRequirementKind, number> = { intent: 3, artifact: 2, quality: 1.5, action: 1, technology: 1 };
const requirementKinds = new Set<CanonicalRequirementKind>(Object.keys(weights) as CanonicalRequirementKind[]);
const rounded = (value: number) => Math.round(value * 1_000) / 1_000;

export const buildCanonicalRequirements = (signals: InternalRoutingSignal[]): CanonicalRequirement[] => {
  const grouped = new Map<string, InternalRoutingSignal[]>();
  for (const signal of signals) {
    if (!requirementKinds.has(signal.kind as CanonicalRequirementKind)) continue;
    const key = `${signal.kind}\0${signal.id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), signal]);
  }
  return [...grouped.values()].map((group) => {
    const explicit = group.filter(({ source }) => source === "prompt-exact" || source === "prompt-normalized");
    const inferred = group.filter(({ source }) => source === "prompt-inferred");
    const winning = explicit.length ? explicit : inferred.length ? inferred : group;
    const kind = group[0].kind as CanonicalRequirementKind;
    return {
      kind,
      id: group[0].id,
      confidence: rounded(Math.max(...winning.map(({ confidence }) => confidence))),
      baseWeight: weights[kind],
      sources: sourceOrder.filter((source) => group.some((signal) => signal.source === source)),
      requirementClass: explicit.length ? "explicit" as const : inferred.length ? "inferred" as const : "context" as const,
    };
  }).sort((left, right) =>
    kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind) || left.id.localeCompare(right.id));
};

export const routingSignalDigest = (signals: InternalRoutingSignal[]) => {
  const grouped = new Map<string, InternalRoutingSignal[]>();
  for (const signal of signals) {
    const key = `${signal.kind}\0${signal.id}\0${signal.source}\0${signal.evidenceEligible}`;
    grouped.set(key, [...(grouped.get(key) ?? []), signal]);
  }
  const projection = [...grouped.values()].map((group) => ({
    kind: group[0].kind,
    id: group[0].id,
    source: group[0].source,
    evidenceEligible: group[0].evidenceEligible,
    ownerIds: [...new Set(group.flatMap(({ ownerIds }) => ownerIds))].sort(),
    confidence: rounded(Math.max(...group.map(({ confidence }) => confidence))),
  })).sort((left, right) =>
    kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind) ||
    left.id.localeCompare(right.id) ||
    sourceOrder.indexOf(left.source) - sourceOrder.indexOf(right.source) ||
    Number(left.evidenceEligible) - Number(right.evidenceEligible) ||
    left.ownerIds.join(",").localeCompare(right.ownerIds.join(",")) ||
    left.confidence - right.confidence);
  return routerRecordDigest(projection);
};

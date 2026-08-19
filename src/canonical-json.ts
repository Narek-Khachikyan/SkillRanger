import { createHash } from "node:crypto";

export const canonicalizeJson = (value: unknown): string => {
  const order = (nested: unknown): unknown => {
    if (Array.isArray(nested)) return nested.map(order);
    if (typeof nested !== "object" || nested === null) return nested;
    return Object.fromEntries(
      Object.entries(nested as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, order(child)]),
    );
  };
  return JSON.stringify(order(value));
};

export const routerRecordDigest = (value: unknown): string =>
  `sha256:${createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex")}`;

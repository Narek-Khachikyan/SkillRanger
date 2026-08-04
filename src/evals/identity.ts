export const FRONTEND_COMPARISON_BASELINES = [
  "without-skill",
  "old-skill",
  "current-skill",
] as const;

export const canonicalizeEvalIdentityValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeEvalIdentityValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalizeEvalIdentityValue(child)]),
  );
};

export const sameEvalIdentityValue = (left: unknown, right: unknown) =>
  JSON.stringify(canonicalizeEvalIdentityValue(left)) === JSON.stringify(canonicalizeEvalIdentityValue(right));

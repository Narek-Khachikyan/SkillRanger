export const tokenize = (input: string) =>
  new Set(
    input
      .toLowerCase()
      .split(/[^\p{L}\p{N}+.#-]+/u)
      .map((part) => part.trim())
      .map((part) => part.replace(/^[.,:;!?()[\]{}"']+|[.,:;!?()[\]{}"']+$/g, ""))
      .filter(Boolean),
  );

export const hasAnyToken = (tokens: Set<string>, expected: Set<string>) =>
  [...tokens].some((token) => expected.has(token));

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const gateSlug = (gateId: string) => gateId.slice(gateId.lastIndexOf("/") + 1);

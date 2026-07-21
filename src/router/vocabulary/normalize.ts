export type NormalizedText = {
  original: string;
  normalized: string;
  tokens: Array<{
    value: string;
    normalizedStart: number;
    normalizedEnd: number;
    originalStart: number;
    originalEnd: number;
  }>;
  boundaries: Array<{
    separator: "," | ";" | "and" | "и" | "then" | "потом";
    tokenIndex: number;
    originalStart: number;
    originalEnd: number;
  }>;
};

type MappedPart = { text: string; originalStart: number; originalEnd: number };
const dash = /[\u002d\u058a\u05be\u1400\u1806\u2010-\u2015\u2e17\u2e1a\u2e3a-\u2e3b\u2e40\u301c\u3030\u30a0\ufe31-\ufe32\ufe58\ufe63\uff0d]/u;
const quote = /['"`´‘’‚‛“”„‟‹›«»]/u;
const separatorWords = new Set(["and", "и", "then", "потом"] as const);
const isLetter = (value: string | undefined) => value !== undefined && /\p{L}/u.test(value);
const isWord = (value: string | undefined) => value !== undefined && /[\p{L}\p{N}_]/u.test(value);
const isWhitespace = (value: string | undefined) => value === undefined || /\s/u.test(value);

const normalizedParts = (input: string): MappedPart[] => {
  const parts: MappedPart[] = [];
  let index = 0;
  while (index < input.length) {
    const start = index;
    const first = String.fromCodePoint(input.codePointAt(index)!);
    index += first.length;
    let cluster = first;
    while (index < input.length) {
      const next = String.fromCodePoint(input.codePointAt(index)!);
      if (!/\p{M}/u.test(next)) break;
      cluster += next;
      index += next.length;
    }
    const normalized = cluster.normalize("NFKC").toLocaleLowerCase("und").replaceAll("ё", "е");
    for (const character of normalized) parts.push({ text: character, originalStart: start, originalEnd: index });
  }
  return parts;
};

export const normalizeRoutingText = (input: string): NormalizedText => {
  const source = normalizedParts(input);
  const punctuationBoundaries: Array<{ separator: "," | ";"; originalStart: number; originalEnd: number }> = [];
  const transformed: MappedPart[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const part = source[index];
    const character = part.text;
    if (character === "," || character === ";") {
      punctuationBoundaries.push({ separator: character, originalStart: part.originalStart, originalEnd: part.originalEnd });
      transformed.push({ ...part, text: " " });
      continue;
    }
    if (dash.test(character) && (character !== "-" || (isLetter(source[index - 1]?.text) && isLetter(source[index + 1]?.text)))) {
      transformed.push({ ...part, text: " " });
      continue;
    }
    if (quote.test(character)) {
      transformed.push({ ...part, text: " " });
      continue;
    }
    if (/[\p{L}\p{N}_\s]/u.test(character)) {
      transformed.push(part);
      continue;
    }
    const previous = source[index - 1]?.text;
    const next = source[index + 1]?.text;
    const technologyPunctuation = (character === "+" || character === "#") &&
      (isWord(previous) || isWord(next) || previous === character || next === character);
    const technologyDot = character === "." && (isWord(previous) || isWord(next));
    const compactSlash = character === "/" && !isWhitespace(previous) && !isWhitespace(next);
    transformed.push({ ...part, text: technologyPunctuation || technologyDot || compactSlash ? character : " " });
  }

  const collapsed: MappedPart[] = [];
  for (const part of transformed) {
    if (/\s/u.test(part.text)) {
      const previous = collapsed.at(-1);
      if (previous?.text === " ") {
        previous.originalEnd = part.originalEnd;
      } else {
        collapsed.push({ ...part, text: " " });
      }
    } else {
      collapsed.push(part);
    }
  }
  while (collapsed[0]?.text === " ") collapsed.shift();
  while (collapsed.at(-1)?.text === " ") collapsed.pop();

  let normalized = "";
  const spans: Array<{ originalStart: number; originalEnd: number }> = [];
  for (const part of collapsed) {
    normalized += part.text;
    for (let offset = 0; offset < part.text.length; offset += 1) spans.push({ originalStart: part.originalStart, originalEnd: part.originalEnd });
  }
  const tokens: NormalizedText["tokens"] = [];
  for (const match of normalized.matchAll(/\S+/gu)) {
    const normalizedStart = match.index;
    const normalizedEnd = normalizedStart + match[0].length;
    const mapped = spans.slice(normalizedStart, normalizedEnd);
    tokens.push({
      value: match[0],
      normalizedStart,
      normalizedEnd,
      originalStart: Math.min(...mapped.map(({ originalStart }) => originalStart)),
      originalEnd: Math.max(...mapped.map(({ originalEnd }) => originalEnd)),
    });
  }

  const boundaries: NormalizedText["boundaries"] = punctuationBoundaries.map((boundary) => ({
    ...boundary,
    tokenIndex: tokens.filter(({ originalEnd }) => originalEnd <= boundary.originalStart).length,
  }));
  tokens.forEach((token, tokenIndex) => {
    if (separatorWords.has(token.value as "and" | "и" | "then" | "потом")) {
      boundaries.push({
        separator: token.value as "and" | "и" | "then" | "потом",
        tokenIndex,
        originalStart: token.originalStart,
        originalEnd: token.originalEnd,
      });
    }
  });
  boundaries.sort((left, right) => left.originalStart - right.originalStart || left.originalEnd - right.originalEnd);
  return { original: input, normalized, tokens, boundaries };
};

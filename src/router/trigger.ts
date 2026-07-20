import type { TriggerParseResult } from "./types.ts";

const defaultMaxIntentBytes = 64_000;
const aliases = ["@skillranger", "skillranger", "/sr"] as const;

export type TriggerParseInput = {
  prompt: string;
  mode: "explicit" | "direct";
  maxIntentBytes?: number;
};

const lineEndFrom = (source: string, start: number) => {
  const newline = source.indexOf("\n", start);
  return newline === -1 ? source.length : newline;
};

const fenceAt = (line: string, closing?: { marker: "`" | "~"; length: number }) => {
  let offset = 0;
  while (offset < line.length && offset < 3 && line[offset] === " ") offset += 1;
  const marker = line[offset];
  if (marker !== "`" && marker !== "~") return undefined;

  let end = offset;
  while (end < line.length && line[end] === marker) end += 1;
  const length = end - offset;
  if (length < (closing?.length ?? 3) || (closing && marker !== closing.marker)) return undefined;

  if (closing) {
    for (let index = end; index < line.length; index += 1) {
      if (line[index] !== " " && line[index] !== "\t" && line[index] !== "\r") return undefined;
    }
  } else if (marker === "`" && line.slice(end).includes("`")) {
    return undefined;
  }
  return { marker, length } as const;
};

const isInsideCode = (source: string, position: number) => {
  let fence: { marker: "`" | "~"; length: number } | undefined;
  let inlineDelimiterLength = 0;

  for (let lineStart = 0; lineStart < position;) {
    const lineEnd = lineEndFrom(source, lineStart);
    const line = source.slice(lineStart, lineEnd);
    const candidateFence = fenceAt(line, fence);

    if (fence) {
      if (candidateFence) fence = undefined;
    } else if (inlineDelimiterLength === 0 && candidateFence) {
      fence = candidateFence;
    } else {
      const scanEnd = Math.min(lineEnd, position);
      for (let index = lineStart; index < scanEnd; index += 1) {
        if (source[index] === "\\" && inlineDelimiterLength === 0) {
          index += 1;
          continue;
        }
        if (source[index] !== "`") continue;
        let end = index + 1;
        while (end < scanEnd && source[end] === "`") end += 1;
        const length = end - index;
        if (inlineDelimiterLength === 0) inlineDelimiterLength = length;
        else if (inlineDelimiterLength === length) inlineDelimiterLength = 0;
        index = end - 1;
      }
    }

    lineStart = lineEnd === source.length ? source.length : lineEnd + 1;
  }

  return fence !== undefined || inlineDelimiterLength !== 0;
};

const hasTokenBoundary = (source: string, start: number) => {
  if (start === 0) return true;
  let tokenStart = start - 1;
  while (tokenStart >= 0 && !/\s/u.test(source[tokenStart])) tokenStart -= 1;
  const prefix = source.slice(tokenStart + 1, start).toLowerCase();
  const hasUrlHost = /(?:^|[([{<"'])(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/#?].*)?$/u.test(prefix);
  if (prefix.includes("://") || /(?:^|[([{<"'])(?:https?|ftp|file|mailto|wss?):/u.test(prefix)
    || prefix.includes("www.") || prefix.includes("/") || prefix.includes("\\") || prefix.includes("@") || hasUrlHost) {
    return false;
  }
  const previous = source[start - 1];
  if (/\s/u.test(previous)) return true;
  if (/[./\\_@-]/u.test(previous)) return false;
  return /\p{P}/u.test(previous);
};

const explicitTrigger = (source: string) => {
  const lower = source.toLowerCase();
  for (const alias of aliases) {
    if (!lower.endsWith(alias)) continue;
    const start = source.length - alias.length;
    if (hasTokenBoundary(source, start) && !isInsideCode(source, start)) return { alias, start };
  }
  return undefined;
};

export const parseTrigger = ({
  prompt,
  mode,
  maxIntentBytes = defaultMaxIntentBytes,
}: TriggerParseInput): TriggerParseResult => {
  if (Buffer.byteLength(prompt, "utf8") > maxIntentBytes) {
    return { activated: false, mode, originalPrompt: prompt, reason: "intent-too-large" };
  }

  const normalizedPrompt = prompt.normalize("NFKC").trimEnd();
  if (mode === "direct") {
    const normalizedIntent = normalizedPrompt.trimStart();
    return normalizedIntent
      ? { activated: true, mode, originalPrompt: prompt, normalizedIntent }
      : { activated: false, mode, originalPrompt: prompt, reason: "empty-intent" };
  }

  const match = explicitTrigger(normalizedPrompt);
  if (!match) return { activated: false, mode, originalPrompt: prompt, reason: "trigger-required" };
  const normalizedIntent = normalizedPrompt.slice(0, match.start).trim();
  return normalizedIntent
    ? { activated: true, mode, trigger: match.alias, originalPrompt: prompt, normalizedIntent }
    : { activated: false, mode, originalPrompt: prompt, reason: "empty-intent" };
};

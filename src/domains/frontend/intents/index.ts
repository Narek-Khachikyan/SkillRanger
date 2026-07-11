import { enFrontendIntentAliases } from "./en.ts";
import { ruFrontendIntentAliases } from "./ru.ts";
import type {
  CanonicalFrontendIntent,
  FrontendControlIntent,
  FrontendIntentAnalysis,
} from "./types.ts";

export type {
  CanonicalFrontendIntent,
  FrontendControlIntent,
  FrontendIntentAliasPack,
  FrontendIntentAnalysis,
  FrontendLocale,
} from "./types.ts";

export const normalizeFrontendText = (input: string) =>
  input
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}+.#-]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

export const analyzeFrontendIntent = (input: string): FrontendIntentAnalysis => {
  const normalized = normalizeFrontendText(input);
  const tokens = new Set(normalized.split(" ").filter(Boolean));
  const hasCyrillic = /[а-я]/u.test(normalized);
  const hasLatin = /[a-z]/u.test(normalized);
  const locale = hasCyrillic && hasLatin ? "mixed" : hasCyrillic ? "ru" : hasLatin ? "en" : "unknown";
  const intents = new Set<CanonicalFrontendIntent>();
  const controlIntents = new Set<FrontendControlIntent>();
  for (const pack of [enFrontendIntentAliases, ruFrontendIntentAliases]) {
    for (const [intent, aliases] of Object.entries(pack.intents) as Array<[CanonicalFrontendIntent, { tokens: string[]; phrases: string[] }]>) {
      if (aliases.tokens.some((token) => tokens.has(normalizeFrontendText(token))) || aliases.phrases.some((phrase) => normalized.includes(normalizeFrontendText(phrase)))) intents.add(intent);
    }
    for (const [control, phrases] of Object.entries(pack.controls) as Array<[FrontendControlIntent, string[]]>) {
      if (phrases.some((phrase) => normalized.includes(normalizeFrontendText(phrase)))) controlIntents.add(control);
    }
  }
  return { locale, normalized, tokens, intents, controlIntents };
};

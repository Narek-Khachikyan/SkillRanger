// The single canonical identity module. Every Routing module and evaluation
// adapter normalizes, validates, and indexes through this one interface so a
// canonical id can never be normalized differently, validated differently, or
// indexed differently between modules. Prompt-language normalization stays
// outside: locale-aware case folding and Russian ё→е substitution belong to
// Routing analysis and its vocabulary modules, not here.
export const canonical = (value: string) => value.normalize("NFKC").trim().toLowerCase();

const canonicalIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;

// Canonical source-form validation. The supplied value itself must already be
// canonical: 1–128 ASCII characters, starting with a lowercase letter or digit,
// and continuing with lowercase letters, digits, `.`, `_`, or `-`. A value
// that merely *can* be normalized to a canonical id (upper-case, surrounding
// whitespace, or an NFKC-compatibility form) is rejected — lookup may
// normalize, validation may not.
export const isCanonicalId = (value: string): boolean => {
  if (typeof value !== "string") return false;
  if (!canonicalIdPattern.test(value)) return false;
  return value === canonical(value);
};

export const skillIndexById = <TSkill extends { id: string }>(skills: TSkill[]) =>
  new Map(skills.map((skill) => [canonical(skill.id), skill]));

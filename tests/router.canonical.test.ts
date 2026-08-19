import test from "node:test";
import assert from "node:assert/strict";
import { canonical, isCanonicalId, isCanonical, skillIndexById } from "../src/router/canonical.ts";
import { normalizeRoutingText } from "../src/router/vocabulary/normalize.ts";

// Table-driven contract for the single canonical identity module:
// normalization (NFKC + trim + lowercase), validation (source-form 1..128
// ASCII, first char a-z0-9, rest a-z0-9._-), the distinction between the two,
// skill indexing, and separation from prompt-language normalization.

test("canonical lookup normalization preserves NFKC, trim, and lowercase", () => {
  const cases: Array<[string, string, string]> = [
    ["already canonical", "abc", "abc"],
    ["lowercase conversion", "ABC", "abc"],
    ["mixed case", "AbC", "abc"],
    ["surrounding whitespace", "  abc  ", "abc"],
    ["tab and newline surrounding", "\t\nabc\n\t", "abc"],
    ["internal whitespace preserved then lowercased", "a B c", "a b c"],
    ["NFKC fullwidth a", "\uFF41", "a"],
    ["NFKC fullwidth ABC", "\uFF21\uFF22\uFF23", "abc"],
    ["NFKC fi ligature", "\uFB01", "fi"],
    ["NFKC Angstrom", "\u212B", "å"],
    // Trim + NFKC + lowercase combined
    ["combined NFKC and trim and case", "  \uFF21\uFB01  ", "afi"],
  ];
  for (const [label, input, expected] of cases) {
    assert.equal(canonical(input), expected, label);
  }
});

test("canonical does not perform locale-specific prompt substitutions", () => {
  // Vocabulary normalization replaces ё with е; canonical must not.
  assert.equal(canonical("Ёлка"), "ёлка");
  assert.equal(canonical("ёлка"), "ёлка");
  assert.notEqual(canonical("ёлка"), "елка");
  assert.equal(canonical("ё"), "ё");
  assert.notEqual(canonical("ё"), "е");
  // Vocabulary does ё→е via locale-aware path; prove the two modules differ.
  assert.equal(normalizeRoutingText("Ёлка").normalized, "елка");
  assert.equal(normalizeRoutingText("ёлка").normalized, "елка");
  assert.notEqual(canonical("Ёлка"), normalizeRoutingText("Ёлка").normalized);
});

test("isCanonicalId accepts valid canonical source forms (table-driven)", () => {
  const valid: Array<[string, string]> = [
    ["one-char letter", "a"],
    ["one-char digit", "0"],
    ["lowercase letter", "z"],
    ["digit start", "9abc"],
    ["dot", "a.b"],
    ["underscore", "a_b"],
    ["hyphen", "a-b"],
    ["mixed allowed", "a.b_c-d"],
    ["mixed longer", "frontend.react-component_design"],
    ["real skill id", "frontend.react-component-design"],
    ["agent id", "codex"],
    ["agent id hyphen", "generic-agent-skills"],
    ["domain id", "core"],
    ["all digits", "123"],
    ["alphabet plus digits", "a1b2c3"],
    ["dots underscores hyphens combined", "a1.b2_c3-d4.e5"],
    ["128-char max (all a)", "a".repeat(128)],
    ["128-char max (digits)", "0".repeat(128)],
    ["128-char max (mixed)", `a${"b.c_d-e".repeat(18)}x`], // 1+126+1 =128? ensure length
  ];
  // Adjust the mixed 128 case to exactly 128
  const mixed128 = `a${"b".repeat(127)}`;
  assert.equal(mixed128.length, 128);
  valid.push(["128-char max mixed b", mixed128]);

  for (const [label, id] of valid) {
    assert.equal(isCanonicalId(id), true, `${label}: ${id}`);
    assert.equal(isCanonical(id), true, `alias: ${label}: ${id}`);
    // Valid ids must already be normalized: canonical(id) === id
    assert.equal(canonical(id), id, `valid id must be stable under canonical: ${label}`);
  }
  // Explicit 128 boundary
  assert.equal(isCanonicalId("a".repeat(128)), true);
});

test("isCanonicalId rejects invalid canonical source forms (table-driven)", () => {
  const invalid: Array<[string, string]> = [
    ["empty", ""],
    ["single dot leading", ".abc"],
    ["single underscore leading", "_abc"],
    ["single hyphen leading", "-abc"],
    ["dot leading", ".a"],
    ["uppercase", "Abc"],
    ["all uppercase", "ABC"],
    ["mixed case", "aBc"],
    ["uppercase first", "Aabc"],
    ["whitespace leading", " abc"],
    ["whitespace trailing", "abc "],
    ["whitespace surrounding", " abc "],
    ["internal space", "a b"],
    ["tab internal", "a\tb"],
    ["newline internal", "a\nb"],
    ["slash", "a/b"],
    ["backslash", "a\\b"],
    ["url like", "https://example.com"],
    ["url with slash", "a/b/c"],
    ["at sign", "a@b"],
    ["hash", "a#b"],
    ["exclamation", "a!b"],
    ["colon", "a:b"],
    ["semicolon", "a;b"],
    ["comma", "a,b"],
    ["dollar", "a$b"],
    ["percent", "a%b"],
    ["plus", "a+b"],
    ["equals", "a=b"],
    ["non-ascii latin é", "café"],
    ["non-ascii cyrillic", "привет"],
    ["cyrillic mixed", "aпривет"],
    ["naive diaeresis", "naïve"],
    ["emoji", "a😀b"],
    ["129-char too long", "a".repeat(129)],
    ["128+1 mixed too long", `${"a".repeat(128)}b`],
    ["disallowed star", "a*b"],
    ["disallowed question", "a?b"],
    ["disallowed brackets", "a[b]"],
    ["only hyphen", "-"],
    ["only dot", "."],
    ["only underscore", "_"],
    ["leading digit dot ok but leading punctuation not", "-0abc"],
  ];
  for (const [label, id] of invalid) {
    assert.equal(isCanonicalId(id), false, `${label}: ${JSON.stringify(id)}`);
    assert.equal(isCanonical(id), false, `alias invalid: ${label}`);
  }
});

test("isCanonicalId rejects length limits precisely", () => {
  assert.equal(isCanonicalId("a".repeat(1)), true);
  assert.equal(isCanonicalId("a".repeat(128)), true);
  assert.equal(isCanonicalId("a".repeat(129)), false);
  assert.equal(isCanonicalId(""), false);
  assert.equal(isCanonicalId("a".repeat(127) + "."), true);
  assert.equal(isCanonicalId("a".repeat(128) + "."), false);
});

test("isCanonicalId rejects disallowed characters while canonical normalizes them", () => {
  // These are invalid ids but canonical would lower/trim etc.
  // Ensure the characters themselves are the reason for rejection, not just case.
  const disallowed = ["a/b", "a\\b", "a:b", "a;b", "a,b", "a@b", "a#b", "a!b", "a b", "a\tb"];
  for (const id of disallowed) {
    assert.equal(isCanonicalId(id), false, id);
    // canonical does not strip these punctuation (except via other vocab rules), so they remain;
    // but canonical lowercases/trim, not punctuation removal, so still invalid.
    assert.equal(canonical(id), id.toLowerCase().trim().normalize("NFKC"));
  }
});

test("validation checks source form, not normalized form", () => {
  const cases: Array<[string, string, boolean, string]> = [
    ["uppercase normalizes to valid but validation fails", "ABC", "abc", false],
    ["surrounding whitespace normalizes to valid but fails", "  abc  ", "abc", false],
    ["mixed case with whitespace", "  AbC  ", "abc", false],
    ["fullwidth a normalizes to a but fails", "\uFF41", "a", false],
    ["fullwidth ABC normalizes to abc but fails", "\uFF21\uFF22\uFF23", "abc", false],
    ["fi ligature normalizes to fi but fails", "\uFB01", "fi", false],
    ["already canonical stays valid", "abc", "abc", true],
    ["tab surrounding", "\tabc\t", "abc", false],
  ];
  for (const [label, input, normalized, shouldValidate] of cases) {
    assert.equal(canonical(input), normalized, `${label} normalization`);
    assert.equal(isCanonicalId(input), shouldValidate, `${label} validation`);
    if (!shouldValidate) {
      // Prove the normalized form *would* be valid, highlighting the distinction.
      assert.equal(isCanonicalId(normalized), true, `${label} normalized form is valid`);
      assert.notEqual(input, normalized, `${label} source differs from normalized`);
    }
  }
});

test("NFKC compatibility input is rejected by validation even though it normalizes to ASCII", () => {
  const nfkcCases: Array<[string, string]> = [
    ["fullwidth a", "\uFF41", "a"],
    ["fullwidth A", "\uFF21", "a"],
    ["fullwidth digits", "\uFF10\uFF11", "01"],
    ["ligature fi", "\uFB01", "fi"],
    ["ligature fl", "\uFB02", "fl"],
    ["angstrom", "\u212B", "å"],
    ["circled digit", "\u2460", "1"],
  ];
  for (const [label, input, expectedNormalized] of nfkcCases) {
    const normalized = canonical(input);
    assert.equal(normalized, expectedNormalized, `${label} NFKC`);
    // If the normalized form is ASCII canonical, it should be valid; the source must be rejected.
    if (isCanonicalId(expectedNormalized)) {
      assert.equal(isCanonicalId(input), false, `${label} source rejected`);
    } else {
      // Even when normalized is not canonical (e.g., å), source is still rejected due to NFKC.
      assert.equal(isCanonicalId(input), false, `${label} source rejected (non-ascii)`);
    }
  }
});

test("skillIndexById builds normalized index and handles deterministic duplicates", () => {
  const skills = [
    { id: "frontend.react-component-design", value: 1 },
    { id: "Frontend.React-Component-Design", value: 2 },
    { id: "  frontend.react-component-design  ", value: 3 },
    { id: "other-skill", value: 4 },
  ];
  const index = skillIndexById(skills);
  // All three forms of the first skill normalize to the same key; last write wins.
  assert.equal(index.size, 2);
  assert.equal(index.get("frontend.react-component-design")?.value, 3);
  assert.equal(index.get(canonical("Frontend.React-Component-Design"))?.value, 3);
  assert.equal(index.get("other-skill")?.value, 4);
  // Lookup via any normalized variant works.
  assert.equal(index.get(canonical("FRONTEND.REACT-COMPONENT-DESIGN"))?.value, 3);
  assert.equal(index.get("other-skill"), index.get(canonical("Other-Skill")));
});

test("skillIndexById uses canonical normalization, not prompt vocab normalization", () => {
  // Prompt vocab would map ё→е; skill index must not.
  const skills = [{ id: "ёлка", v: 1 }, { id: "елка", v: 2 }];
  const index = skillIndexById(skills as Array<{ id: string; v: number }>);
  assert.equal(index.size, 2, "ё and е must be distinct keys");
  assert.equal(index.get(canonical("ЁЛКА"))?.v, 1);
  assert.equal(index.get(canonical("ёлка"))?.v, 1);
  assert.equal(index.get(canonical("елка"))?.v, 2);
  assert.notEqual(canonical("ёлка"), canonical("елка"));
});

test("skillIndexById handles empty and single entry", () => {
  assert.equal(skillIndexById([]).size, 0);
  const single = skillIndexById([{ id: "a", x: 1 }]);
  assert.equal(single.size, 1);
  assert.equal(single.get("a")?.x, 1);
});

test("canonical and isCanonicalId are consistent: every valid id is stable under canonical", () => {
  const ids = ["a", "0", "a0", "a.b", "a_b", "a-b", "a.b_c-d", "a".repeat(128), "my-skill_1.test"];
  for (const id of ids) {
    if (isCanonicalId(id)) {
      assert.equal(canonical(id), id, `stable: ${id}`);
    }
  }
});

test("isCanonical is alias of isCanonicalId", () => {
  const samples = ["abc", "ABC", "  abc ", "\uFF41", "a/b", "", "a".repeat(128), "a".repeat(129)];
  for (const s of samples) {
    assert.equal(isCanonical(s), isCanonicalId(s), `alias equal for ${JSON.stringify(s)}`);
  }
});

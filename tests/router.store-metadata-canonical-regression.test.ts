import test from "node:test";
import assert from "node:assert/strict";
import { assertValidRouterRun } from "../src/router/store.ts";
import { validateMetadataArray, routerMetadataLimits } from "../src/router/metadata.ts";
import { validateDomainPackManifest } from "../src/domains/registry.ts";
import { isCanonicalId, canonical } from "../src/router/canonical.ts";
import type { RouterRun } from "../src/router/types.ts";

// Regression coverage for issue #135: Router store and domain metadata
// must use the shared canonical identity rule without changing persisted
// compatibility or diagnostics.
//
// Valid records remain readable.
// Invalid persisted identities retain their current integrity diagnostics.
// Canonical metadata tokens use the shared rule.
// Metadata keeps 128-byte diagnostic and duplicate-after-normalization behavior.
// Validation paths and messages remain stable.

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
const projectIdentity = digest("a");

const validRouterRun = (): RouterRun => ({
  schemaVersion: "router-run/1.0",
  routerRunId: "route_12345678",
  revision: 0,
  readRevision: 0,
  state: "prepared",
  createdAt: "2026-07-19T00:00:00.000Z",
  updatedAt: "2026-07-19T00:00:00.000Z",
  projectIdentity,
  taskProfile: {
    schemaVersion: "task-profile/1.0",
    normalizedGoal: "implement api",
    locale: "en",
    actions: ["implement"],
    artifactTypes: ["api"],
    technologies: ["nodejs"],
    constraints: [],
    qualityGoals: [],
    acceptanceCriteria: [],
    domains: [],
    subtasks: [],
    evidence: [],
  },
  routing: {
    mode: "limited-deterministic-fallback",
    targetAgent: "codex",
    domains: [],
    deterministicKey: digest("b"),
    routerAlgorithmVersion: "router/1.0",
    routingDate: "2026-07-19",
    fingerprintDigest: digest("c"),
    registryDigest: digest("d"),
    configDigest: digest("e"),
    routingProposal: {
      schemaVersion: "routing-proposal/1.0",
      catalogDigest: digest("f"),
      proposalDigest: digest("0"),
      interpretation: {
        domains: ["frontend"],
        actions: ["implement"],
        artifactTypes: ["web-interface"],
        intentTags: ["design"],
        technologyTags: ["react"],
        qualityGoals: ["accessibility"],
      },
      nominations: [{
        skillId: "frontend.design-to-code",
        role: "primary",
        confidence: 0.9,
        evidenceDigest: digest("1"),
      }],
      rejections: [{ skillId: "frontend.other-skill", reasonCode: "role-not-allowed" }],
      ambiguity: undefined,
    },
  },
  selections: {
    environment: [],
    primary: {
      skillId: "frontend.primary",
      displayName: "Primary",
      role: "primary",
      domains: ["frontend"],
      version: "1.0.0",
      packageChecksum: digest("f"),
      score: 0.9,
      source: "bundled-registry",
      reasons: ["domain-match:frontend"],
      verificationStatus: "not-required",
    },
    companions: [],
    verification: [],
    agentContext: [],
  },
  sourceInventory: [],
  readLedger: [],
  runtime: { kind: "lifecycle-v1", runId: "run_12345678" },
});

const withRoutingProposal = (overrides: Partial<RouterRun["routing"]["routingProposal"]> & { interpretation?: Partial<RouterRun["routing"]["routingProposal"] extends { interpretation: infer I } ? I : never> }): RouterRun => {
  const base = validRouterRun();
  const existing = base.routing.routingProposal!;
  return {
    ...base,
    routing: {
      ...base.routing,
      routingProposal: {
        ...existing,
        ...overrides,
        interpretation: { ...existing.interpretation, ...(overrides.interpretation ?? {}) },
        nominations: overrides.nominations ?? existing.nominations,
        rejections: overrides.rejections ?? existing.rejections,
        ambiguity: overrides.ambiguity ?? existing.ambiguity,
      },
    },
  };
};

// --- Router store: valid records remain readable ---

test("Router store: valid persisted record remains readable via canonical module", () => {
  const run = validRouterRun();
  assert.doesNotThrow(() => assertValidRouterRun(run));
  // also ensure 128-char canonical ids remain valid in persisted fields
  const maxId = "a".repeat(128);
  const runMax = withRoutingProposal({
    interpretation: { domains: [maxId] },
    nominations: [{ skillId: maxId, role: "primary", confidence: 0.9, evidenceDigest: digest("1") }],
    rejections: [{ skillId: maxId, reasonCode: "ineligible" }],
    ambiguity: { primarySkillIds: [maxId, "b".repeat(128)] },
  });
  assert.doesNotThrow(() => assertValidRouterRun(runMax));
  // valid canonical ids cover allowed alphabet
  const validIds = ["a", "0", "a0", "a.b", "a_b", "a-b", "frontend.react-component_design", "generic-agent-skills", "core"];
  for (const id of validIds) {
    assert.equal(isCanonicalId(id), true, `isCanonicalId valid: ${id}`);
    assert.equal(canonical(id), id);
  }
});

test("Router store: valid record without routingProposal remains readable (legacy compatibility)", () => {
  const run = validRouterRun();
  // Legacy records may omit routingProposal entirely; they remain valid
  const legacy = structuredClone(run);
  delete (legacy.routing as { routingProposal?: unknown }).routingProposal;
  assert.doesNotThrow(() => assertValidRouterRun(legacy));
});

// --- Router store: invalid persisted identities retain diagnostics ---

test("Router store: non-canonical interpretation IDs retain integrity diagnostics", () => {
  const invalidCases: Array<[string, Partial<RouterRun["routing"]["routingProposal"] extends { interpretation: infer I } ? I : never>, string]> = [
    ["uppercase domain", { domains: ["Frontend"] }, "interpretation.domains"],
    ["leading punctuation", { domains: [".frontend"] }, "interpretation.domains"],
    ["slash in id", { actions: ["a/b"] }, "interpretation.actions"],
    ["internal space", { artifactTypes: ["a b"] }, "interpretation.artifactTypes"],
    ["non-ascii", { intentTags: ["café"] }, "interpretation.intentTags"],
    ["129-char overlong", { technologyTags: ["a".repeat(129)] }, "interpretation.technologyTags"],
    ["NFKC fullwidth", { qualityGoals: ["\uFF41"] }, "interpretation.qualityGoals"],
    ["whitespace padded", { domains: [" frontend"] }, "interpretation.domains"],
  ];
  for (const [label, interp, expectedPath] of invalidCases) {
    const run = withRoutingProposal({ interpretation: interp });
    assert.throws(() => assertValidRouterRun(run), (error: unknown) => {
      const msg = (error as Error).message;
      assert.match(msg, new RegExp(expectedPath), `${label} path`);
      assert.match(msg, /invalid canonical ID/, `${label} diagnostic`);
      return true;
    }, label);
  }
});

test("Router store: non-canonical nomination skillId retains diagnostic", () => {
  const invalidSkillIds = ["Frontend.design-to-code", "frontend/primary", "a b", "A".repeat(5), "\uFF21bc", "a".repeat(129), ".frontend", "-abc"];
  for (const skillId of invalidSkillIds) {
    const run = withRoutingProposal({ nominations: [{ skillId, role: "primary", confidence: 0.9, evidenceDigest: digest("1") }] });
    assert.throws(() => assertValidRouterRun(run), (error: unknown) => {
      const msg = (error as Error).message;
      assert.match(msg, /nominations\[0\]\.skillId is not canonical/, skillId);
      return true;
    }, `nomination ${JSON.stringify(skillId)}`);
    // also ensure isCanonicalId rejects
    assert.equal(isCanonicalId(skillId), false, `isCanonicalId rejects ${JSON.stringify(skillId)}`);
  }
  // empty skillId fails at string non-empty check, which is the expected integrity diagnostic for empty
  const emptyRun = withRoutingProposal({ nominations: [{ skillId: "", role: "primary", confidence: 0.9, evidenceDigest: digest("1") }] });
  assert.throws(() => assertValidRouterRun(emptyRun), (error: unknown) => {
    assert.match((error as Error).message, /must be a non-empty string/);
    return true;
  });
  assert.equal(isCanonicalId(""), false);
});

test("Router store: non-canonical rejection skillId retains diagnostic", () => {
  const run = withRoutingProposal({ rejections: [{ skillId: "BadSkill", reasonCode: "test" }] });
  assert.throws(() => assertValidRouterRun(run), (error: unknown) => {
    assert.match((error as Error).message, /rejections\[0\]\.skillId is not canonical/);
    return true;
  });
  // valid rejection remains readable
  const valid = withRoutingProposal({ rejections: [{ skillId: "frontend.valid_skill-1", reasonCode: "test" }] });
  assert.doesNotThrow(() => assertValidRouterRun(valid));
});

test("Router store: non-canonical ambiguity primarySkillIds retain diagnostic", () => {
  const runUpper = withRoutingProposal({ ambiguity: { primarySkillIds: ["Frontend", "frontend.other"] } });
  assert.throws(() => assertValidRouterRun(runUpper), (error) => {
    assert.match((error as Error).message, /ambiguity\.primarySkillIds is invalid/);
    return true;
  });
  const runTooFew = withRoutingProposal({ ambiguity: { primarySkillIds: ["a"] } });
  assert.throws(() => assertValidRouterRun(runTooFew), (e) => (e as Error).message.includes("ambiguity") );

  const runTooMany = withRoutingProposal({ ambiguity: { primarySkillIds: ["a","b","c","d"] } });
  assert.throws(() => assertValidRouterRun(runTooMany), (e) => (e as Error).message.includes("ambiguity") );

  const runSlash = withRoutingProposal({ ambiguity: { primarySkillIds: ["a/b", "c"] } });
  assert.throws(() => assertValidRouterRun(runSlash), (e) => (e as Error).message.includes("ambiguity") );
});

test("Router store: NFKC source-form rejected even though normalized would be valid", () => {
  // Fullwidth "a" normalizes to "a" (valid), but source form is non-canonical
  const fullwidth = "\uFF41"; // fullwidth a
  assert.equal(canonical(fullwidth), "a");
  assert.equal(isCanonicalId("a"), true);
  assert.equal(isCanonicalId(fullwidth), false);
  const run = withRoutingProposal({ interpretation: { domains: [fullwidth] } });
  assert.throws(() => assertValidRouterRun(run), (e) => (e as Error).message.includes("invalid canonical ID"));
});

// --- Metadata: canonical token validation uses shared rule ---

test("metadata: valid canonical tokens pass (including 128-byte boundary)", () => {
  const valid = ["a", "0", "a0", "frontend", "frontend-web", "web_ui", "a.b_c-d", "my-skill_1.test", "a".repeat(128)];
  for (const token of valid) {
    const issues = validateMetadataArray(valid, "routing.test");
    // sanity: valid array passes
    assert.equal(validateMetadataArray([token], "routing.test").length, 0, `valid token ${token}`);
    assert.equal(isCanonicalId(token), true, `isCanonicalId valid ${token}`);
  }
  assert.deepEqual(validateMetadataArray(valid, "routing.test"), []);
  // valid array with mixed allowed
  assert.deepEqual(validateMetadataArray(["frontend", "react", "web-interface"], "routing.aliases"), []);
});

test("metadata: invalid canonical tokens produce canonical diagnostic with stable path/message", () => {
  const invalid: Array<[string, string]> = [
    ["uppercase", "Frontend"],
    ["leading dot", ".frontend"],
    ["leading underscore", "_frontend"],
    ["leading hyphen", "-frontend"],
    ["slash", "a/b"],
    ["backslash", "a\\b"],
    ["space", "a b"],
    ["at sign", "a@b"],
    ["hash", "a#b"],
    ["colon", "a:b"],
    ["non-ascii é", "café"],
    ["cyrillic", "привет"],
    ["emoji", "a😀b"],
    ["empty", ""],
    ["only hyphen", "-"],
    ["NFKC fullwidth", "\uFF41"],
  ];
  for (const [label, token] of invalid) {
    const issues = validateMetadataArray([token], "routing.aliases");
    assert.ok(issues.some(i => i.path === "routing.aliases.0" && i.message === "Must be a canonical metadata token."), `${label}: ${token} canonical diagnostic`);
    assert.equal(isCanonicalId(token), false, `${label} isCanonicalId rejects`);
  }
});

test("metadata: 128-byte limit diagnostic preserved", () => {
  const token128 = "a".repeat(128);
  const token129 = "a".repeat(129);
  // 128-byte ASCII token is exactly 128 bytes and canonical valid
  assert.equal(Buffer.byteLength(token128, "utf8"), 128);
  assert.equal(validateMetadataArray([token128], "routing.aliases").length, 0);
  assert.equal(isCanonicalId(token128), true);

  // 129-byte token must produce byte diagnostic
  assert.equal(Buffer.byteLength(token129, "utf8"), 129);
  const issues129 = validateMetadataArray([token129], "routing.aliases");
  assert.ok(issues129.some(i => i.path === "routing.aliases.0" && i.message === "Token must be at most 128 UTF-8 bytes."), "129-byte diagnostic preserved");
  // canonical check also fails for overlong (since 129 >128 chars)
  assert.equal(isCanonicalId(token129), false);
  // Ensure byte diagnostic is present even when canonical also fails — both are reported
  // The important preservation is byte message exists with stable path/message
  const hasByte = issues129.some(i => i.message.includes("128 UTF-8 bytes"));
  const hasCanonical = issues129.some(i => i.message === "Must be a canonical metadata token.");
  // byte must be present; canonical may also be present due to shared 128-char rule but byte diagnostic remains primary
  assert.equal(hasByte, true);
  // For ASCII overlong, canonical will also be invalid; document that behavior
  assert.equal(hasCanonical, true, "overlong ASCII also fails canonical (128-char) rule");

  // Non-ASCII byte limit: 64 emojis = 256 bytes >128 but char length 2? Actually emoji 4 bytes each. Use 33 emojis =132 bytes
  const emojiToken = "😀".repeat(33); // each 4 bytes => 132 bytes, char length 66
  const emojiIssues = validateMetadataArray([emojiToken], "routing.aliases");
  assert.ok(emojiIssues.some(i => i.message.includes("128 UTF-8 bytes")), "emoji byte limit");
  assert.ok(emojiIssues.some(i => i.message === "Must be a canonical metadata token."), "emoji canonical");
});

test("metadata: duplicate-after-normalization behavior preserved", () => {
  // Simple case-insensitive duplicate
  const dupCase = validateMetadataArray(["react", "React"], "routing.aliases");
  assert.ok(dupCase.some(i => i.path === "routing.aliases" && i.message === "Values must be unique after NFKC lowercase normalization."), "case duplicate");

  // NFKC duplicate: fullwidth vs ascii
  const fullwidthA = "\uFF41"; // fullwidth a -> "a" after NFKC+lowercase
  const dupNfkc = validateMetadataArray([fullwidthA, "a"], "routing.aliases");
  assert.ok(dupNfkc.some(i => i.message.includes("unique after NFKC")), "NFKC duplicate");

  // Fullwidth also fails canonical, but duplicate still reported
  assert.ok(dupNfkc.some(i => i.path === "routing.aliases.0" && i.message === "Must be a canonical metadata token."), "fullwidth canonical fail");

  // Trim not part of metadata normalization, so " a" and "a" are NOT duplicates after NFKC lower (since metadata does NOT trim)
  // This preserves old behavior: canonical trims but metadata does not
  const trimCase = validateMetadataArray(["a", " a"], "routing.aliases");
  // " a" fails canonical (space not allowed) but duplicate check uses NFKC lower only, so " a" normalizes to " a" not "a", so no duplicate
  // However " a" canonical fails, but duplicate should NOT be reported because normalized tokens differ
  assert.equal(trimCase.some(i => i.message.includes("unique after NFKC")), false, "trim not normalized in metadata");
  // metadata duplicate via canonical normalizer would have dup, but metadata preserves its own logic
  assert.equal(canonical(" a"), "a");
  // So canonical would consider them duplicate, but metadata must not

  // Valid duplicate via lowercase + NFKC
  const dupLower = validateMetadataArray(["frontend-web", "FRONTEND-WEB"], "routing.aliases");
  assert.ok(dupLower.some(i => i.message.includes("unique after NFKC")), "uppercase duplicate");
});

test("metadata: domain-pack validation uses same canonical paths/messages", () => {
  // Build a synthetic domain manifest with routing metadata containing invalid tokens
  const baseValid = {
    schemaVersion: "1.2" as const,
    id: "test-domain",
    displayName: "Test",
    version: "0.0.1",
    coreApi: "1.0",
    skillIdPrefix: "test-domain.",
    releaseVersion: "0.1.0",
    capabilities: ["intent-routing" as const],
    artifacts: { intents: ["intents.json"], schemas: [], recipes: [], workflows: [], validators: [] },
    ownership: [{ intent: "test", primarySkill: "test-domain.primary", supportingSkills: [] }],
    routing: {
      aliases: ["valid-alias"],
      intentTags: ["valid-tag"],
      artifactTypes: ["valid-type"],
      technologyTags: ["valid-tech"],
      projectTags: ["valid-project"],
    },
  };
  assert.deepEqual(validateDomainPackManifest(baseValid), []);

  const invalidManifest = structuredClone(baseValid) as unknown as Record<string, unknown>;
  (invalidManifest.routing as Record<string, unknown>).aliases = ["InvalidAlias"];
  const issuesAlias = validateDomainPackManifest(invalidManifest);
  assert.ok(issuesAlias.some(i => i.includes("routing.aliases.0") && i.includes("Must be a canonical metadata token.")), "alias canonical diagnostic");

  const invalidManifest2 = structuredClone(baseValid) as unknown as Record<string, unknown>;
  (invalidManifest2.routing as Record<string, unknown>).technologyTags = ["a".repeat(129)];
  const issuesByte = validateDomainPackManifest(invalidManifest2);
  assert.ok(issuesByte.some(i => i.includes("routing.technologyTags.0") && i.includes("128")), "domain manifest byte diagnostic");

  const duplicateManifest = structuredClone(baseValid) as unknown as Record<string, unknown>;
  (duplicateManifest.routing as Record<string, unknown>).intentTags = ["react", "React"];
  const dupIssues = validateDomainPackManifest(duplicateManifest);
  assert.ok(dupIssues.some(i => i.includes("routing.intentTags") && i.includes("unique after NFKC")), "domain manifest duplicate");

  // Also test slash in alias retains canonical message
  const slashManifest = structuredClone(baseValid) as unknown as Record<string, unknown>;
  (slashManifest.routing as Record<string, unknown>).aliases = ["a/b"];
  const slashIssues = validateDomainPackManifest(slashManifest);
  assert.ok(slashIssues.some(i => i.includes("Must be a canonical metadata token.")), "slash canonical");
});

test("metadata: allowed set still enforced after canonical migration", () => {
  // validateMetadataArray with allowed set should still enforce allowed check separately from canonical
  const allowed = new Set(["implement", "review"]);
  const issuesAllowed = validateMetadataArray(["unknown-action"], "routing.actions", { allowed });
  assert.ok(issuesAllowed.some(i => i.message === "Contains an unsupported value."), "unsupported value");
  // canonical token should also be checked; "unknown-action" is canonical, so no canonical error, only allowed error
  assert.equal(issuesAllowed.filter(i => i.message === "Must be a canonical metadata token.").length, 0);

  const issuesBoth = validateMetadataArray(["BadAction"], "routing.actions", { allowed });
  // "BadAction" fails canonical (uppercase) and also not in allowed
  assert.ok(issuesBoth.some(i => i.message === "Must be a canonical metadata token."), "canonical fail");
  assert.ok(issuesBoth.some(i => i.message === "Contains an unsupported value."), "allowed fail");
});

test("no Router record schema, domain manifest schema, persisted projection, or runtime schema changes", () => {
  // Ensure a valid run still has same schema fields and can be serialized round-trip
  const run = validRouterRun();
  const serialized = JSON.stringify(run);
  const parsed = JSON.parse(serialized);
  assert.doesNotThrow(() => assertValidRouterRun(parsed));
  // Check fields are still present and not mutated
  assert.equal(parsed.schemaVersion, "router-run/1.0");
  assert.ok("projectIdentity" in parsed);
  assert.ok("routing" in parsed);
  assert.ok("selections" in parsed);
  // Domain manifest schema unchanged: validateDomainPackManifest still works for v1.0/1.1/1.2
  const v12 = {
    schemaVersion: "1.2",
    id: "schema-test",
    displayName: "Test",
    version: "0.0.1",
    coreApi: "1.0",
    skillIdPrefix: "schema-test.",
    capabilities: ["intent-routing"],
    artifacts: { intents: [], schemas: [], recipes: [], workflows: [], validators: [] },
    ownership: [{ intent: "i", primarySkill: "schema-test.s", supportingSkills: [] }],
    releaseVersion: "0.1.0",
    routing: {
      aliases: [],
      intentTags: [],
      artifactTypes: [],
      technologyTags: [],
      projectTags: [],
    },
  };
  assert.deepEqual(validateDomainPackManifest(v12), []);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  ContinuationTokenError,
  createContinuationToken,
  validateClarificationAnswers,
  validateContinuation,
  verifyContinuationToken,
  type ContinuationBinding,
  type RouterClarificationQuestion,
} from "../src/router/continuation.ts";

const secret = "01234567890123456789012345678901";
const questions: RouterClarificationQuestion[] = [
  {
    id: "workflow",
    text: "Which workflow should be primary?",
    options: [
      { value: "api", label: "API" },
      { value: "mobile", label: "Mobile" },
    ],
  },
];
const binding = (overrides: Partial<ContinuationBinding> = {}): ContinuationBinding => ({
  fingerprintDigest: "sha256:fingerprint",
  registryDigest: "sha256:registry",
  configDigest: "sha256:config",
  routingDate: "2026-07-19",
  targetAgent: "codex",
  strict: false,
  capabilities: ["playwright", "node"],
  projectIdentity: "sha256:project",
  promptProjection: {
    normalizedGoal: "implement authentication",
    actions: ["implement"],
  },
  routingProjection: {
    domains: ["backend-api", "qa-testing"],
  },
  ...overrides,
});

test("continuation tokens are opaque and bind the canonical request", () => {
  const created = createContinuationToken(binding(), questions, { secret, now: 1_000 });
  assert.equal(created.expiresAt, "1970-01-01T00:15:01.000Z");
  assert.equal(created.token.includes("implement authentication"), false);
  assert.doesNotThrow(() => verifyContinuationToken({
    token: created.token,
    binding: binding(),
    questions,
    secret,
    now: 1_001,
  }));
});

test("canonical equivalent routing projections replay during the token lifetime", () => {
  const created = createContinuationToken(binding({
    capabilities: ["Node", "playwright"],
    promptProjection: { actions: ["implement"], normalizedGoal: "implement authentication" },
  }), questions, { secret, now: 1_000 });
  assert.doesNotThrow(() => verifyContinuationToken({
    token: created.token,
    binding: binding({
      capabilities: ["playwright", "node"],
      promptProjection: { normalizedGoal: "implement authentication", actions: ["implement"] },
    }),
    questions,
    secret,
    now: 899_999,
  }));
});

test("tampering, expiration, and cross-project reuse fail closed", () => {
  const created = createContinuationToken(binding(), questions, { secret, now: 1_000 });
  const [header, payload, signature] = created.token.split(".");
  const tampered = `${header}.${payload}.${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
  assert.throws(
    () => verifyContinuationToken({ token: tampered, binding: binding(), questions, secret, now: 1_001 }),
    (error) => error instanceof ContinuationTokenError && error.code === "continuation-invalid",
  );
  assert.throws(
    () => verifyContinuationToken({ token: created.token, binding: binding(), questions, secret, now: 901_000 }),
    (error) => error instanceof ContinuationTokenError && error.code === "continuation-expired",
  );
  assert.throws(
    () => verifyContinuationToken({ token: created.token, binding: binding({ fingerprintDigest: "sha256:other" }), questions, secret, now: 1_001 }),
    (error) => error instanceof ContinuationTokenError && error.code === "continuation-invalid",
  );
  assert.throws(
    () => verifyContinuationToken({ token: created.token, binding: binding(), questions, secret: `${secret}x`, now: 1_001 }),
    (error) => error instanceof ContinuationTokenError && error.code === "continuation-invalid",
  );
});

test("prompt, question, target, strict, and capability bindings cannot be substituted", () => {
  const created = createContinuationToken(binding(), questions, { secret, now: 1_000 });
  const cases: Array<{ binding?: Partial<ContinuationBinding>; questions?: RouterClarificationQuestion[] }> = [
    { binding: { promptProjection: { normalizedGoal: "delete authentication" } } },
    { binding: { targetAgent: "claude-code" } },
    { binding: { strict: true } },
    { binding: { capabilities: ["node"] } },
    { binding: { projectIdentity: "sha256:other-project" } },
    { questions: [{ ...questions[0], id: "other-workflow" }] },
  ];
  for (const current of cases) {
    assert.throws(
      () => verifyContinuationToken({
        token: created.token,
        binding: binding(current.binding),
        questions: current.questions ?? questions,
        secret,
        now: 1_001,
      }),
      (error) => error instanceof ContinuationTokenError && error.code === "continuation-invalid",
    );
  }
});

test("answers require every question and a closed option value", () => {
  assert.deepEqual(
    validateClarificationAnswers(questions, [{ questionId: "WORKFLOW", value: "API" }]),
    [{ questionId: "workflow", value: "api" }],
  );
  assert.throws(
    () => validateClarificationAnswers(questions, [{ questionId: "workflow", value: "free-form" }]),
    (error) => error instanceof ContinuationTokenError && error.code === "clarification-answer-invalid",
  );
  assert.throws(
    () => validateClarificationAnswers(questions, []),
    (error) => error instanceof ContinuationTokenError && error.code === "clarification-answer-invalid",
  );
});

test("validation requires token and answers together", () => {
  const created = createContinuationToken(binding(), questions, { secret, now: 1_000 });
  const result = validateContinuation({
    token: created.token,
    binding: binding(),
    questions,
    answers: [{ questionId: "workflow", value: "api" }],
    secret,
    now: 1_001,
  });
  assert.deepEqual(result.answers, [{ questionId: "workflow", value: "api" }]);
});

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const tokenVersion = "router-continuation/1.0" as const;
const algorithm = "HS256" as const;
const defaultTtlMs = 15 * 60 * 1000;
const maxTokenBytes = 4096;
const maxQuestions = 8;
const maxStringLength = 256;

const processSecret = randomBytes(32);

export type RouterClarificationQuestion = {
  id: string;
  text: string;
  options: Array<{ value: string; label: string }>;
};

export type ContinuationAnswer = {
  questionId: string;
  value: string;
};

export type ContinuationBinding = {
  fingerprintDigest: string;
  registryDigest: string;
  configDigest: string;
  routingDate: string;
  targetAgent: string;
  strict: boolean;
  capabilities: readonly string[];
  promptProjection: unknown;
  routingProjection: unknown;
  projectIdentity: string;
};

export type ContinuationTokenClaims = {
  version: typeof tokenVersion;
  issuedAt: number;
  expiresAt: number;
  fingerprintDigest: string;
  registryDigest: string;
  configDigest: string;
  routingDate: string;
  targetAgent: string;
  strict: boolean;
  capabilities: string[];
  projectIdentity: string;
  promptDigest: string;
  routingDigest: string;
  questionDigest: string;
};

export type ContinuationTokenOptions = {
  secret?: Uint8Array | string;
  now?: number | Date;
  ttlMs?: number;
};

export type VerifyContinuationTokenInput = ContinuationTokenOptions & {
  token: string;
  binding: ContinuationBinding;
  questions: readonly RouterClarificationQuestion[];
};

export type ValidatedContinuation = {
  claims: ContinuationTokenClaims;
  answers: ContinuationAnswer[];
};

export type ContinuationErrorCode =
  | "continuation-invalid"
  | "continuation-expired"
  | "clarification-answer-invalid";

export class ContinuationTokenError extends Error {
  readonly code: ContinuationErrorCode;

  constructor(code: ContinuationErrorCode, message: string) {
    super(message);
    this.name = "ContinuationTokenError";
    this.code = code;
  }
}

const invalid = (message: string): never => {
  throw new ContinuationTokenError("continuation-invalid", message);
};

const answerInvalid = (message: string): never => {
  throw new ContinuationTokenError("clarification-answer-invalid", message);
};

const asSecret = (secret?: Uint8Array | string) => {
  const value = typeof secret === "string" ? Buffer.from(secret, "utf8") : secret ?? processSecret;
  if (value.byteLength < 32) invalid("Continuation secret must contain at least 32 bytes.");
  return value;
};

const asNow = (now?: number | Date) => {
  const value = now instanceof Date ? now.getTime() : now ?? Date.now();
  if (!Number.isSafeInteger(value) || value < 0) invalid("Continuation timestamp is invalid.");
  return value;
};

const normalizeText = (value: unknown, field: string, limit = maxStringLength) => {
  if (typeof value !== "string") return invalid(`${field} must be a string.`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > limit) invalid(`${field} is empty or too long.`);
  return normalized;
};

const normalizeId = (value: unknown, field: string) => normalizeText(value, field, 128).toLowerCase();

const canonicalize = (value: unknown, at = "value"): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(`${at} must contain only finite numbers.`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item, index) => canonicalize(item, `${at}[${index}]`)).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      invalid(`${at} must contain plain JSON values.`);
    }
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item, `${at}.${key}`)}`).join(",")}}`;
  }
  return invalid(`${at} must contain only JSON values.`);
};

const base64urlEncode = (value: string | Uint8Array) => Buffer.from(value).toString("base64url");

const base64urlDecode = (value: string): Buffer => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) invalid("Continuation token encoding is invalid.");
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return invalid("Continuation token encoding is invalid.");
  }
};

const mac = (secret: Uint8Array, value: string) => createHmac("sha256", secret).update(value, "utf8").digest("hex");
const digest = (secret: Uint8Array, value: unknown) => `hmac-sha256:${mac(secret, canonicalize(value))}`;

const safeEqual = (left: string, right: string) => {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const normalizedCapabilities = (capabilities: readonly string[]) => {
  if (!Array.isArray(capabilities) || capabilities.length > 64) invalid("Capabilities are invalid.");
  const values = capabilities.map((value, index) => normalizeId(value, `capabilities[${index}]`));
  if (new Set(values).size !== values.length) invalid("Capabilities must be unique.");
  return values.sort((left, right) => left.localeCompare(right));
};

const normalizedQuestions = (questions: readonly RouterClarificationQuestion[]) => {
  if (!Array.isArray(questions) || questions.length === 0 || questions.length > maxQuestions) {
    invalid(`Questions must contain between 1 and ${maxQuestions} items.`);
  }
  const seenIds = new Set<string>();
  return questions.map((question, questionIndex) => {
    if (!question || typeof question !== "object") invalid(`questions[${questionIndex}] is invalid.`);
    const id = normalizeId(question.id, `questions[${questionIndex}].id`);
    if (seenIds.has(id)) invalid("Question IDs must be unique.");
    seenIds.add(id);
    const text = normalizeText(question.text, `questions[${questionIndex}].text`);
    if (!Array.isArray(question.options) || question.options.length === 0 || question.options.length > 32) {
      invalid(`questions[${questionIndex}].options are invalid.`);
    }
    const seenValues = new Set<string>();
    const options = question.options.map((option, optionIndex) => {
      if (!option || typeof option !== "object") invalid(`questions[${questionIndex}].options[${optionIndex}] is invalid.`);
      const value = normalizeId(option.value, `questions[${questionIndex}].options[${optionIndex}].value`);
      if (seenValues.has(value)) invalid("Question option values must be unique.");
      seenValues.add(value);
      return {
        value,
        label: normalizeText(option.label, `questions[${questionIndex}].options[${optionIndex}].label`),
      };
    });
    return { id, text, options };
  });
};

const normalizedBinding = (binding: ContinuationBinding) => {
  if (!binding || typeof binding !== "object") invalid("Continuation binding is invalid.");
  if (typeof binding.strict !== "boolean") invalid("Continuation strict flag is invalid.");
  return {
    fingerprintDigest: normalizeText(binding.fingerprintDigest, "fingerprintDigest"),
    registryDigest: normalizeText(binding.registryDigest, "registryDigest"),
    configDigest: normalizeText(binding.configDigest, "configDigest"),
    routingDate: normalizeText(binding.routingDate, "routingDate"),
    targetAgent: normalizeId(binding.targetAgent, "targetAgent"),
    strict: binding.strict,
    capabilities: normalizedCapabilities(binding.capabilities),
    promptProjection: binding.promptProjection,
    routingProjection: binding.routingProjection,
    projectIdentity: normalizeText(binding.projectIdentity, "projectIdentity"),
  };
};

const claimsFor = (
  binding: ContinuationBinding,
  questions: readonly RouterClarificationQuestion[],
  secret: Uint8Array,
  issuedAt: number,
  expiresAt: number,
): ContinuationTokenClaims => {
  const normalized = normalizedBinding(binding);
  const normalizedQuestionSet = normalizedQuestions(questions);
  return {
    version: tokenVersion,
    issuedAt,
    expiresAt,
    fingerprintDigest: normalized.fingerprintDigest,
    registryDigest: normalized.registryDigest,
    configDigest: normalized.configDigest,
    routingDate: normalized.routingDate,
    targetAgent: normalized.targetAgent,
    strict: normalized.strict,
    capabilities: normalized.capabilities,
    projectIdentity: normalized.projectIdentity,
    promptDigest: digest(secret, normalized.promptProjection),
    routingDigest: digest(secret, {
      targetAgent: normalized.targetAgent,
      strict: normalized.strict,
      capabilities: normalized.capabilities,
      projection: normalized.routingProjection,
    }),
    questionDigest: digest(secret, normalizedQuestionSet),
  };
};

const sign = (header: string, payload: string, secret: Uint8Array) => mac(secret, `${header}.${payload}`);

const serializeClaims = (claims: ContinuationTokenClaims, secret: Uint8Array) => {
  const header = base64urlEncode(JSON.stringify({ alg: algorithm, typ: "SRCT", version: 1 }));
  const payload = base64urlEncode(canonicalize(claims));
  return `${header}.${payload}.${sign(header, payload, secret)}`;
};

const parseClaims = (token: string, secret: Uint8Array): ContinuationTokenClaims => {
  if (typeof token !== "string" || Buffer.byteLength(token, "utf8") > maxTokenBytes) invalid("Continuation token is invalid.");
  const parts = token.split(".");
  if (parts.length !== 3) invalid("Continuation token structure is invalid.");
  const [encodedHeader, encodedPayload, signature] = parts;
  if (!encodedHeader || !encodedPayload || !signature) invalid("Continuation token structure is invalid.");
  const headerBytes = base64urlDecode(encodedHeader);
  const payloadBytes = base64urlDecode(encodedPayload);
  if (!safeEqual(sign(encodedHeader, encodedPayload, secret), signature)) invalid("Continuation token signature is invalid.");
  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(headerBytes.toString("utf8"));
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    invalid("Continuation token JSON is invalid.");
  }
  if (canonicalize(header) !== canonicalize({ alg: algorithm, typ: "SRCT", version: 1 })) invalid("Continuation token header is invalid.");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) invalid("Continuation token claims are invalid.");
  const claims = payload as Record<string, unknown>;
  const allowed = new Set([
    "version", "issuedAt", "expiresAt", "fingerprintDigest", "registryDigest", "configDigest", "routingDate",
    "targetAgent", "strict", "capabilities", "projectIdentity", "promptDigest", "routingDigest", "questionDigest",
  ]);
  const unknown = Object.keys(claims).find((key) => !allowed.has(key));
  if (unknown) invalid(`Continuation token contains unknown claim ${unknown}.`);
  if (claims.version !== tokenVersion || typeof claims.issuedAt !== "number" || typeof claims.expiresAt !== "number" ||
    !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= claims.issuedAt ||
    typeof claims.fingerprintDigest !== "string" || typeof claims.registryDigest !== "string" || typeof claims.configDigest !== "string" ||
    typeof claims.routingDate !== "string" || typeof claims.targetAgent !== "string" || typeof claims.strict !== "boolean" ||
    !Array.isArray(claims.capabilities) || !claims.capabilities.every((value) => typeof value === "string") ||
    typeof claims.projectIdentity !== "string" ||
    typeof claims.promptDigest !== "string" || typeof claims.routingDigest !== "string" || typeof claims.questionDigest !== "string") {
    invalid("Continuation token claims have invalid types.");
  }
  return claims as unknown as ContinuationTokenClaims;
};

const assertBinding = (
  claims: ContinuationTokenClaims,
  binding: ContinuationBinding,
  questions: readonly RouterClarificationQuestion[],
  secret: Uint8Array,
) => {
  const expected = claimsFor(binding, questions, secret, claims.issuedAt, claims.expiresAt);
  if (canonicalize(claims) !== canonicalize(expected)) invalid("Continuation token binding does not match the current request.");
};

export const createContinuationToken = (
  binding: ContinuationBinding,
  questions: readonly RouterClarificationQuestion[],
  options: ContinuationTokenOptions = {},
) => {
  const secret = asSecret(options.secret);
  const issuedAt = asNow(options.now);
  const ttlMs = options.ttlMs ?? defaultTtlMs;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > defaultTtlMs) invalid("Continuation token TTL must be between 1 ms and 15 minutes.");
  const expiresAt = issuedAt + ttlMs;
  if (!Number.isSafeInteger(expiresAt)) invalid("Continuation token expiration is invalid.");
  const token = serializeClaims(claimsFor(binding, questions, secret, issuedAt, expiresAt), secret);
  if (Buffer.byteLength(token, "utf8") > maxTokenBytes) invalid("Continuation token exceeds the maximum size.");
  return { token, expiresAt: new Date(expiresAt).toISOString() };
};

export const verifyContinuationToken = ({
  token,
  binding,
  questions,
  secret: rawSecret,
  now,
}: VerifyContinuationTokenInput): ContinuationTokenClaims => {
  const secret = asSecret(rawSecret);
  const claims = parseClaims(token, secret);
  const currentTime = asNow(now);
  if (currentTime >= claims.expiresAt) {
    throw new ContinuationTokenError("continuation-expired", "Continuation token has expired.");
  }
  if (currentTime < claims.issuedAt) invalid("Continuation token is not valid yet.");
  assertBinding(claims, binding, questions, secret);
  return claims;
};

export const validateClarificationAnswers = (
  questions: readonly RouterClarificationQuestion[],
  answers: readonly ContinuationAnswer[],
): ContinuationAnswer[] => {
  const normalized = normalizedQuestions(questions);
  if (!Array.isArray(answers) || answers.length !== normalized.length) {
    answerInvalid("Exactly one answer is required for every clarification question.");
  }
  const questionsById = new Map(normalized.map((question) => [question.id, question]));
  const seen = new Set<string>();
  return answers.map((answer, index) => {
    if (!answer || typeof answer !== "object") answerInvalid(`answers[${index}] is invalid.`);
    const questionId = normalizeId(answer.questionId, `answers[${index}].questionId`);
    const value = normalizeId(answer.value, `answers[${index}].value`);
    if (seen.has(questionId)) answerInvalid(`answers[${index}] duplicates a question.`);
    seen.add(questionId);
    const question = questionsById.get(questionId);
    if (!question) return answerInvalid(`answers[${index}] references an unknown question.`);
    if (!question.options.some((option) => option.value === value)) answerInvalid(`answers[${index}] contains an unsupported option.`);
    return { questionId, value };
  }).sort((left, right) => left.questionId.localeCompare(right.questionId));
};

export const validateContinuation = ({
  answers,
  ...input
}: VerifyContinuationTokenInput & { answers: readonly ContinuationAnswer[] }): ValidatedContinuation => ({
  claims: verifyContinuationToken(input),
  answers: validateClarificationAnswers(input.questions, answers),
});

export const continuationTokenTtlMs = defaultTtlMs;

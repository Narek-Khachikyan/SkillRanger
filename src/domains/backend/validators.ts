import type { DomainValidatorProjection, DomainValidatorEvaluator } from "../types.ts";
import type { Result } from "../../runtime/strict/core-validators.ts";
import { isRecord } from "../routing-helpers.ts";

type BackendEvidence = {
  verificationInput: unknown;
  output: unknown;
  sourceReview: unknown;
  artifacts: DomainValidatorProjection["artifacts"];
};

const collectTexts = (evidence: BackendEvidence, keys: string[]): string[] => {
  const texts: string[] = [];
  const pushFrom = (value: unknown) => {
    if (typeof value === "string") texts.push(value);
    else if (isRecord(value)) {
      for (const key of keys) {
        const v = value[key];
        if (typeof v === "string") texts.push(v);
        if (Array.isArray(v)) texts.push(...v.filter((s): s is string => typeof s === "string"));
      }
      texts.push(JSON.stringify(value));
    } else if (Array.isArray(value)) {
      texts.push(...value.filter((s): s is string => typeof s === "string"));
    }
  };
  pushFrom(evidence.verificationInput);
  pushFrom(evidence.output);
  if (Array.isArray(evidence.sourceReview)) {
    texts.push(...evidence.sourceReview.filter((s): s is string => typeof s === "string"));
  }
  return texts;
};

// -- contract-test: validates OpenAPI / JSON Schema contract evidence --

const resolveJsonPointer = (root: unknown, ref: string): unknown => {
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref.slice(2).split("/").map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur: unknown = root;
  for (const part of parts) {
    if (!isRecord(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
    if (cur === undefined) return undefined;
  }
  return cur;
};

const collectRefs = (value: unknown, out: string[] = []): string[] => {
  if (isRecord(value)) {
    if (typeof value.$ref === "string") out.push(value.$ref);
    for (const v of Object.values(value)) collectRefs(v, out);
  } else if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, out);
  }
  return out;
};

const hasSchema = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (value.schema !== undefined) return true;
  if (value.$ref !== undefined) return true;
  if (isRecord(value.content)) {
    for (const media of Object.values(value.content)) {
      if (isRecord(media) && (media.schema !== undefined || (isRecord(media) && (media as Record<string, unknown>).$ref !== undefined))) return true;
      if (isRecord(media) && isRecord((media as Record<string, unknown>).schema)) return true;
    }
  }
  return false;
};

const validateOpenApi = (input: unknown): string | undefined => {
  if (!isRecord(input)) return "api-contract must be a JSON object";
  const openapi = input.openapi;
  if (typeof openapi !== "string" || !/^3\.\d+\.\d+$/.test(openapi)) return "api-contract openapi must be a 3.x version string";
  const info = input.info;
  if (!isRecord(info) || typeof info.title !== "string" || !info.title.trim() || typeof info.version !== "string" || !info.version.trim()) {
    return "api-contract info.title and info.version are required";
  }
  const paths = input.paths;
  if (!isRecord(paths) || Object.keys(paths).length === 0) return "api-contract paths must contain at least one route";
  for (const [pathKey, pathItem] of Object.entries(paths)) {
    if (!pathKey.startsWith("/")) return `api-contract path ${pathKey} must start with /`;
    if (!isRecord(pathItem)) return `api-contract path ${pathKey} must be an object`;
    const methods = ["get", "post", "put", "delete", "patch", "options", "head", "trace"];
    let hasOperation = false;
    for (const method of methods) {
      const op = (pathItem as Record<string, unknown>)[method];
      if (op !== undefined) {
        hasOperation = true;
        if (!isRecord(op)) return `api-contract ${pathKey}.${method} must be an object`;
        const responses = (op as Record<string, unknown>).responses;
        if (!isRecord(responses) || Object.keys(responses).length === 0) return `api-contract ${pathKey}.${method} must declare responses`;
        // endpoint without schema check: at least one response must carry a schema
        let hasResponseSchema = false;
        for (const resp of Object.values(responses)) {
          if (hasSchema(resp)) hasResponseSchema = true;
          if (isRecord(resp) && isRecord(resp.content)) {
            for (const mediaValue of Object.values(resp.content)) {
              if (hasSchema(mediaValue) || isRecord(mediaValue)) hasResponseSchema = hasResponseSchema || hasSchema(mediaValue);
            }
          }
        }
        // also consider requestBody schema as alternative for some designs, but responses are mandatory for schema
        if (!hasResponseSchema) {
          // also check requestBody schema to allow endpoints that define input schema only (e.g., POST without response body schema is still invalid per spec)
          // Spec says endpoint without schema fails – we enforce at least one schema in responses or requestBody
          const requestBody = (op as Record<string, unknown>).requestBody;
          if (!hasSchema(requestBody)) {
            return `api-contract ${pathKey}.${method} endpoint without schema: operation must declare request/response schema`;
          }
        }
      }
    }
    if (!hasOperation) return `api-contract path ${pathKey} must declare at least one operation`;
  }
  // $ref resolution
  const refs = collectRefs(input);
  for (const ref of refs) {
    if (!ref.startsWith("#/")) return `api-contract broken $ref ${ref}: only internal #/ refs are supported`;
    const resolved = resolveJsonPointer(input, ref);
    if (resolved === undefined) return `api-contract broken $ref ${ref}: target not found`;
  }
  return undefined;
};

const findOpenApiCandidates = (projection: DomainValidatorProjection): unknown[] => {
  const candidates: unknown[] = [];
  if (projection.verificationInput !== undefined) {
    if (isRecord(projection.verificationInput) && projection.verificationInput.contract !== undefined) {
      candidates.push(projection.verificationInput.contract);
    }
    if (isRecord(projection.verificationInput) && typeof (projection.verificationInput as Record<string, unknown>).contract === "string") {
      try { candidates.push(JSON.parse((projection.verificationInput as Record<string, unknown>).contract as string)); } catch { /* ignore */ }
    }
    candidates.push(projection.verificationInput);
    // also allow stringified JSON
    if (typeof projection.verificationInput === "string") {
      try { candidates.push(JSON.parse(projection.verificationInput)); } catch { /* ignore */ }
    }
  }
  if (projection.output !== undefined) {
    if (isRecord(projection.output) && (projection.output as Record<string, unknown>).contract !== undefined) {
      candidates.push((projection.output as Record<string, unknown>).contract);
    }
    if (typeof projection.output === "string") {
      try { candidates.push(JSON.parse(projection.output)); } catch { /* ignore */ }
    }
    candidates.push(projection.output);
  }
  if (Array.isArray(projection.sourceReview)) {
    for (const item of projection.sourceReview) {
      if (typeof item === "string") {
        try {
          const parsed = JSON.parse(item);
          if (isRecord(parsed) && parsed.openapi) candidates.push(parsed);
        } catch { /* ignore */ }
      } else if (isRecord(item) && item.openapi) candidates.push(item);
    }
  }
  return candidates;
};

export const evaluateContractTest = (projection: DomainValidatorProjection): Result => {
  const candidates = findOpenApiCandidates(projection);
  // Also try to parse artifacts that might be JSON strings via sourceReview fallback (not ideal)
  // If no candidates, try artifacts with kind containing contract
  const contractArtifacts = projection.artifacts.filter((a) => a.kind === "api-contract" || a.kind === "openapi-schema" || a.kind.includes("contract"));
  if (candidates.length === 0 && contractArtifacts.length === 0) {
    return { passed: false, message: "No api-contract evidence was staged. Provide a valid OpenAPI 3.x contract as verification-input or output.contract." };
  }
  // Try each candidate; if any passes validation, gate passes
  const errors: string[] = [];
  for (const candidate of candidates) {
    // Candidate may be wrapped: { openapi: "3.0.0", ... } or { contract: {...}}
    const subject = candidate;
    const err = validateOpenApi(subject);
    if (err === undefined) return { passed: true };
    errors.push(err);
  }
  // If candidates failed, also try to see if any artifact's metadata suggests failure without content
  if (contractArtifacts.length > 0 && candidates.length === 0) {
    return { passed: false, message: "api-contract artifact present but no parsable OpenAPI payload found in verification-input/output." };
  }
  return { passed: false, message: errors[0] ?? "api-contract validation failed" };
};

// -- migration-safety: ensures migration plan has no destructive drop --

const destructivePatterns: Array<{ re: RegExp; code: string }> = [
  { re: /\bDROP\s+TABLE\b/i, code: "DROP TABLE" },
  { re: /\bDROP\s+COLUMN\b/i, code: "DROP COLUMN" },
  { re: /\bDROP\s+DATABASE\b/i, code: "DROP DATABASE" },
  { re: /\bTRUNCATE\s+TABLE\b/i, code: "TRUNCATE TABLE" },
  { re: /\bDELETE\s+FROM\s+\w+\s*;/i, code: "unbounded DELETE" },
  { re: /\bALTER\s+TABLE\b[^;]*\bDROP\b/i, code: "ALTER TABLE DROP" },
];

const extractDryRun = (projection: DomainValidatorProjection): boolean | undefined => {
  const candidates: unknown[] = [projection.verificationInput, projection.output];
  for (const cand of candidates) {
    if (!isRecord(cand)) continue;
    if (typeof cand.dryRun === "boolean") return cand.dryRun;
    if (typeof (cand as Record<string, unknown>)["dry-run"] === "boolean") return (cand as Record<string, unknown>)["dry-run"] as boolean;
    if (isRecord(cand.safety) && typeof (cand.safety as Record<string, unknown>).dryRun === "boolean") return (cand.safety as Record<string, unknown>).dryRun as boolean;
    if (isRecord(cand.safety) && typeof (cand.safety as Record<string, unknown>)["dry-run"] === "boolean") return (cand.safety as Record<string, unknown>)["dry-run"] as boolean;
  }
  return undefined;
};

const hasSafeguard = (projection: DomainValidatorProjection, combined: string): boolean => {
  const candidates: unknown[] = [projection.verificationInput, projection.output];
  for (const cand of candidates) {
    if (!isRecord(cand)) continue;
    if (cand.safeguard === true || cand.allowDestructive === true || cand.safe === true) return true;
    if (isRecord(cand.safety) && ((cand.safety as Record<string, unknown>).safeguard === true || (cand.safety as Record<string, unknown>).allowDestructive === true)) return true;
    if (typeof cand.safeguard === "string" && /safeguard|transaction|backup/i.test(cand.safeguard)) return true;
  }
  // textual safeguard markers: IF EXISTS, transactional wrappers, or explicit safeguard keyword
  if (/\bIF\s+EXISTS\b/i.test(combined) && /\bDROP\b/i.test(combined)) return true;
  if (/safeguard/i.test(combined)) return true;
  return false;
};

const findMigrationCandidates = (projection: DomainValidatorProjection): string[] => {
  const evidence: BackendEvidence = {
    verificationInput: projection.verificationInput,
    output: projection.output,
    sourceReview: projection.sourceReview,
    artifacts: projection.artifacts,
  };
  const texts = collectTexts(evidence, ["sql", "migration", "plan", "statements", "migrations"]);
  const migrationArtifacts = projection.artifacts.filter((a) => a.kind === "migration-plan" || a.kind === "migration" || a.kind.includes("migration"));
  if (texts.length === 0 && migrationArtifacts.length > 0) {
    return [];
  }
  return texts;
};

export const evaluateMigrationSafety = (projection: DomainValidatorProjection): Result => {
  const candidates = findMigrationCandidates(projection);
  if (candidates.length === 0) {
    const hasMigrationArtifact = projection.artifacts.some((a) => a.kind.includes("migration"));
    if (!hasMigrationArtifact) {
      return { passed: false, message: "No migration-plan evidence was staged. Provide migration sql/plan for dry-run safety check." };
    }
    return { passed: false, message: "migration-plan artifact present but no textual sql content found for safety analysis." };
  }
  const combined = candidates.join("\n");
  const dryRun = extractDryRun(projection);
  // dryRun must be explicitly true when provided; if explicitly false, block unless no-op
  if (dryRun === false && !/no-op|empty|no migration/i.test(combined)) {
    return { passed: false, message: "migration-safety requires dryRun: true for safety check." };
  }
  const safeguard = hasSafeguard(projection, combined);
  for (const { re, code } of destructivePatterns) {
    if (re.test(combined)) {
      if (safeguard) continue;
      // allow DROP with IF EXISTS as safeguard already handled, otherwise block
      return { passed: false, message: `migration-safety blocked destructive operation: ${code}. Use safe additive migration with dry-run and safeguard where needed.` };
    }
  }
  const hasMigrationContent = /(CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+INDEX|ADD\s+COLUMN|CREATE\s+TYPE|CREATE\s+EXTENSION|ADD\s+CONSTRAINT|\bINSERT\b|\bUPDATE\b|\bSELECT\b)/i.test(combined);
  if (!hasMigrationContent) {
    if (/no-op|empty|no migration|dry[-\s]?run/i.test(combined)) return { passed: true };
    // additive migrations without explicit CREATE are allowed if they contain any SQL and no destructive ops
    if (/\b(ALTER|ADD|CREATE|INSERT|UPDATE)\b/i.test(combined)) return { passed: true };
    return { passed: false, message: "migration-plan does not contain recognizable safe migration statements." };
  }
  return { passed: true };
};

// -- secret-audit: reuses audit secret patterns, scans artifacts for leaked secrets --
// Canonical patterns aligned with src/audit (allowlist drift noted in review): includes OPENSSH/EC
// NOTE: This duplicates src/audit secret inventory — keep in sync or extract to shared module (future)
const secretPatterns: Array<{ re: RegExp; code: string }> = [
  { re: /AKIA[0-9A-Z]{16}/, code: "aws-access-key" },
  { re: /ghp_[a-zA-Z0-9]{36,}/, code: "github-pat" },
  { re: /sk_live_[a-zA-Z0-9]{20,}/, code: "stripe-live-key" },
  { re: /-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/, code: "private-key" },
  { re: /xox[bpras]-[0-9a-zA-Z-]{10,}/, code: "slack-token" },
  { re: /\b(password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/i, code: "hardcoded-password" },
  { re: /\b(api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/i, code: "hardcoded-api-key" },
  { re: /\b(secret|client_secret)\s*[:=]\s*['"][^'"]{8,}['"]/i, code: "hardcoded-secret" },
  { re: /\.env\b/, code: "dotenv-exposure" },
  { re: /Bearer\s+[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}/, code: "bearer-token" },
];

const isEnvVarUsage = (text: string) => /process\.env\.[A-Z_]+|import\.meta\.env\.[A-Z_]+/.test(text);

export const evaluateSecretAudit = (projection: DomainValidatorProjection): Result => {
  const evidence: BackendEvidence = {
    verificationInput: projection.verificationInput,
    output: projection.output,
    sourceReview: projection.sourceReview,
    artifacts: projection.artifacts,
  };
  const texts = collectTexts(evidence, []);
  // Fallback: if collectTexts gave only JSON dumps without string keys, ensure we have stringified dumps
  if (texts.length === 0) {
    if (typeof projection.verificationInput === "string") texts.push(projection.verificationInput);
    if (typeof projection.output === "string") texts.push(projection.output);
  }
  const hasSourceArtifact = projection.artifacts.some((a) => a.kind === "implementation-diff" || a.kind.includes("source") || a.kind.includes("secret"));
  if (texts.length === 0 && !hasSourceArtifact) {
    if (projection.artifacts.length === 0) {
      return { passed: false, message: "No source evidence staged for secret-audit. Provide implementation diff or source files for scanning." };
    }
  }
  const combined = texts.join("\n");
  for (const { re, code } of secretPatterns) {
    const match = combined.match(re);
    if (match) {
      if (code === "hardcoded-password" || code === "hardcoded-api-key" || code === "hardcoded-secret") {
        const lines = combined.split("\n").filter((line) => re.test(line));
        const unsafeLines = lines.filter((line) => !isEnvVarUsage(line));
        if (unsafeLines.length > 0) {
          return { passed: false, message: `secret-audit blocked ${code}: hardcoded credential found. Use process.env indirection.` };
        }
      } else if (code === "dotenv-exposure") {
        const hasRealEnv = combined.split("\n").some((line) => /\.env\b/.test(line) && !/\.env\.example/.test(line));
        if (hasRealEnv && /[A-Z_]{3,}=['"]?[^'"\s]+['"]?/.test(combined)) {
          return { passed: false, message: "secret-audit blocked dotenv exposure: .env content must not be committed. Use .env.example with placeholders." };
        }
      } else {
        return { passed: false, message: `secret-audit blocked ${code}: credential material detected in staged evidence.` };
      }
    }
  }
  return { passed: true };
};

export const backendValidatorEvaluators: Readonly<Record<string, DomainValidatorEvaluator>> = {
  "backend/contract-test": evaluateContractTest,
  "backend/migration-safety": evaluateMigrationSafety,
  "backend/secret-audit": evaluateSecretAudit,
};

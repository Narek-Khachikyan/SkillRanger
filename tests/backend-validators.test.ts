import test from "node:test";
import assert from "node:assert/strict";
import { evaluateContractTest, evaluateMigrationSafety, evaluateSecretAudit } from "../src/domains/backend/validators.ts";
import type { DomainValidatorProjection } from "../src/domains/types.ts";

const baseProjection = (overrides: Partial<DomainValidatorProjection> = {}): DomainValidatorProjection => ({
  gateId: "backend.api-design/gate/contract-test",
  validatorId: "backend/contract-test",
  skillId: "backend.api-design",
  artifacts: [],
  ...overrides,
});

// -- contract-test --

const validContract = {
  openapi: "3.0.3",
  info: { title: "Test API", version: "1.0.0" },
  paths: {
    "/users": {
      get: {
        responses: {
          "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } }
        }
      }
    }
  },
  components: { schemas: { User: { type: "object" } } }
};

test("backend/contract-test passes with valid OpenAPI 3.x contract", () => {
  const result = evaluateContractTest(baseProjection({
    verificationInput: { contract: validContract },
    artifacts: [{ kind: "api-contract", path: "contract.json" } as never],
  }));
  assert.equal(result.passed, true);
});

test("backend/contract-test fails on broken $ref", () => {
  const broken = structuredClone(validContract);
  // add broken ref
  (broken.paths as Record<string, unknown>)["/broken"] = {
    get: { responses: { "200": { $ref: "#/components/schemas/NonExistent" } } }
  } as unknown;
  const result = evaluateContractTest(baseProjection({
    verificationInput: broken,
    artifacts: [{ kind: "api-contract", path: "c.json" } as never],
  }));
  assert.equal(result.passed, false);
  assert.match(result.message ?? "", /broken \$ref/i);
});

test("backend/contract-test fails when endpoint has no schema", () => {
  const noSchema = {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/empty": {
        get: { responses: { "200": { description: "no schema" } } }
      }
    }
  };
  const result = evaluateContractTest(baseProjection({
    verificationInput: noSchema,
  }));
  assert.equal(result.passed, false);
  assert.match(result.message ?? "", /without schema/i);
});

test("backend/contract-test fails on invalid openapi version and missing info", () => {
  const invalid = { openapi: "2.0", info: {}, paths: {} };
  const result = evaluateContractTest(baseProjection({ verificationInput: invalid }));
  assert.equal(result.passed, false);
});

test("backend/contract-test passes when contract is wrapped in verificationInput.contract", () => {
  const result = evaluateContractTest(baseProjection({
    verificationInput: { contract: validContract },
  }));
  assert.equal(result.passed, true);
});

// -- migration-safety --

const migrationGate = (overrides: Partial<DomainValidatorProjection> = {}) => ({
  gateId: "backend.persistence/gate/migration-safety",
  validatorId: "backend/migration-safety",
  skillId: "backend.persistence",
  artifacts: [{ kind: "migration-plan", path: "m.sql" } as never],
  ...overrides,
} as DomainValidatorProjection);

test("backend/migration-safety passes for additive migration with dryRun true", () => {
  const result = evaluateMigrationSafety(migrationGate({
    verificationInput: { sql: "ALTER TABLE users ADD COLUMN age INT;", dryRun: true },
  }));
  assert.equal(result.passed, true);
});

test("backend/migration-safety allows safe DROP with safeguard IF EXISTS", () => {
  const result = evaluateMigrationSafety(migrationGate({
    verificationInput: { sql: "DROP TABLE IF EXISTS old_users;", dryRun: true, safeguard: true },
  }));
  assert.equal(result.passed, true);
});

test("backend/migration-safety blocks destructive DROP without safeguard", () => {
  const result = evaluateMigrationSafety(migrationGate({
    verificationInput: { sql: "DROP TABLE users;" },
  }));
  assert.equal(result.passed, false);
  assert.match(result.message ?? "", /DROP TABLE/i);
});

test("backend/migration-safety checks dryRun false blocks", () => {
  const result = evaluateMigrationSafety(migrationGate({
    verificationInput: { sql: "ALTER TABLE users ADD COLUMN age INT;", dryRun: false },
  }));
  assert.equal(result.passed, false);
  assert.match(result.message ?? "", /dryRun/i);
});

test("backend/migration-safety passes for additive migration without explicit CREATE TABLE", () => {
  const result = evaluateMigrationSafety(migrationGate({
    verificationInput: { sql: "ALTER TABLE users ADD COLUMN bio TEXT;", dryRun: true },
  }));
  assert.equal(result.passed, true);
});

test("backend/migration-safety passes for no-op migration", () => {
  const result = evaluateMigrationSafety(migrationGate({
    verificationInput: { sql: "no-op", dryRun: true },
  }));
  assert.equal(result.passed, true);
});

// -- secret-audit --

const secretGate = (overrides: Partial<DomainValidatorProjection> = {}) => ({
  gateId: "backend.auth/gate/secret-audit",
  validatorId: "backend/secret-audit",
  skillId: "backend.auth",
  artifacts: [{ kind: "implementation-diff", path: "auth.ts" } as never],
  ...overrides,
} as DomainValidatorProjection);

test("backend/secret-audit passes when secrets use process.env indirection", () => {
  const result = evaluateSecretAudit(secretGate({
    sourceReview: ["const token = process.env.JWT_SECRET;"],
    output: { secretHandling: { usesEnv: true } },
  }));
  assert.equal(result.passed, true);
});

test("backend/secret-audit blocks hardcoded password", () => {
  const result = evaluateSecretAudit(secretGate({
    sourceReview: ['const password = "hunter2";'],
  }));
  assert.equal(result.passed, false);
  assert.match(result.message ?? "", /hardcoded-password/i);
});

test("backend/secret-audit blocks AWS key", () => {
  const result = evaluateSecretAudit(secretGate({
    sourceReview: ["AKIAIOSFODNN7EXAMPLE"],
  }));
  assert.equal(result.passed, false);
  assert.match(result.message ?? "", /aws-access-key/i);
});

test("backend/secret-audit blocks private key including OPENSSH and EC variants", () => {
  for (const key of [
    "-----BEGIN RSA PRIVATE KEY-----",
    "-----BEGIN EC PRIVATE KEY-----",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "-----BEGIN PRIVATE KEY-----",
  ]) {
    const result = evaluateSecretAudit(secretGate({ sourceReview: [key] }));
    assert.equal(result.passed, false, key);
  }
});

test("backend/secret-audit does not flag sudo/chmod as secret (audit separation)", () => {
  const result = evaluateSecretAudit(secretGate({
    sourceReview: ["sudo apt update", "chmod 777 file.sh"],
  }));
  // secret-audit should NOT block privilege escalation – that belongs to generic audit
  assert.equal(result.passed, true);
});

test("backend/secret-audit blocks dotenv exposure", () => {
  const result = evaluateSecretAudit(secretGate({
    sourceReview: [".env\nSECRET_KEY=abc123"],
  }));
  assert.equal(result.passed, false);
  assert.match(result.message ?? "", /dotenv/i);
});

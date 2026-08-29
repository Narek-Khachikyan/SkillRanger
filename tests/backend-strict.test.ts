import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  StrictSkillRunStore,
  beginStrictStep,
  completeStrictStep,
  createContentChunks,
  createStrictSkillRun,
  deriveStrictValidatorResults,
  readNextStrictChunk,
} from "../src/runtime/strict/index.ts";
import type { ExecutionContractV2 } from "../src/runtime/strict/types.ts";

const sha = (v: string | Buffer) => `sha256:${createHash("sha256").update(v).digest("hex")}`;

const validContract = {
  openapi: "3.0.3",
  info: { title: "Test API", version: "1.0.0" },
  paths: {
    "/users": {
      get: {
        responses: {
          "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } },
        },
      },
    },
  },
};

const backendApiContract: ExecutionContractV2 = {
  schemaVersion: "2.0",
  skillId: "backend.api-design",
  contractVersion: "2.0.0",
  inputSchema: "input.schema.json",
  outputSchema: "output.schema.json",
  mustRead: ["SKILL.md"],
  applicability: { op: "input", path: "contractPath", present: true },
  prerequisites: [{ id: "contract-path", kind: "input", path: "contractPath" }],
  steps: [
    { id: "backend.api-design/step/collect-contract", type: "collect", requiredEvidenceKinds: ["api-contract"], ruleIds: ["backend.api-design/rule/contract-present"] },
    { id: "backend.api-design/step/validate-contract", type: "validate", requiredEvidenceKinds: ["verification-input"], ruleIds: ["backend.api-design/rule/contract-valid"] },
    { id: "backend.api-design/step/final-report", type: "report", requiredEvidenceKinds: ["skill-output"], ruleIds: ["backend.api-design/rule/output-schema-valid"] },
  ],
  rules: [
    { id: "backend.api-design/rule/contract-present", description: "Provide contract" },
    { id: "backend.api-design/rule/contract-valid", description: "Contract valid" },
    { id: "backend.api-design/rule/output-schema-valid", description: "Output valid" },
  ],
  gates: [
    { id: "backend.api-design/gate/contract-present", level: "hard", evaluator: { type: "evidence-present", evidenceKind: "api-contract" }, ruleIds: ["backend.api-design/rule/contract-present"] },
    { id: "backend.api-design/gate/contract-test", level: "hard", evaluator: { type: "validator", validatorId: "backend/contract-test" }, ruleIds: ["backend.api-design/rule/contract-valid"] },
    { id: "backend.api-design/gate/output-schema-valid", level: "hard", evaluator: { type: "schema-valid", schema: "output" }, ruleIds: ["backend.api-design/rule/output-schema-valid"] },
  ],
  maxRepairIterations: 2,
};

const makeRun = (contract = backendApiContract, runId = "run_backend_strict_valid") =>
  createStrictSkillRun({
    runId,
    domain: "backend",
    targetAgent: "codex",
    locale: "en",
    intent: { sha256: sha("test"), normalizedGoal: "test backend" },
    selectedSkills: [
      {
        skillId: contract.skillId,
        role: "primary",
        mandatory: true,
        version: "0.1.0",
        packageChecksum: sha("pkg"),
        contractChecksum: sha(JSON.stringify(contract)),
        contract,
        schemaSnapshots: {
          input: { type: "object" },
          output: { type: "object", required: ["contract", "validation", "changes", "residualRisks"] },
        },
        schemaChecksums: {
          input: sha(JSON.stringify({ type: "object" })),
          output: sha(JSON.stringify({ type: "object", required: ["contract", "validation", "changes", "residualRisks"] })),
        },
        contentChunks: createContentChunks("SKILL.md", "# Backend test\n"),
        applicable: true,
        unmetPrerequisites: [],
        input: { contractPath: "contract.json" },
      },
    ],
  });

test("backend strict valid contract passes contract-test gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "backend-strict-valid-"));
  const store = new StrictSkillRunStore(root);
  let run = makeRun();
  run = beginStrictStep(readNextStrictChunk(run, backendApiContract.skillId).run, backendApiContract.skillId, backendApiContract.steps[0].id);
  await store.create(run);
  const contractPath = path.join(root, "contract.json");
  await writeFile(contractPath, JSON.stringify(validContract));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: contractPath,
    kind: "api-contract",
    attributions: [{ skillId: backendApiContract.skillId, stepId: backendApiContract.steps[0].id, attempt: 1, relation: "produced", ruleIds: [backendApiContract.rules[0].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendApiContract.skillId, backendApiContract.steps[0].id));
  run = await store.update(run.runId, (c) => beginStrictStep(c, backendApiContract.skillId, backendApiContract.steps[1].id));
  const inputPath = path.join(root, "verification-input.json");
  await writeFile(inputPath, JSON.stringify({ contract: validContract }));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: inputPath,
    kind: "verification-input",
    attributions: [{ skillId: backendApiContract.skillId, stepId: backendApiContract.steps[1].id, attempt: 1, relation: "produced", ruleIds: [backendApiContract.rules[1].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendApiContract.skillId, backendApiContract.steps[1].id));
  run = await store.update(run.runId, (c) => beginStrictStep(c, backendApiContract.skillId, backendApiContract.steps[2].id));
  const outputPath = path.join(root, "output.json");
  await writeFile(outputPath, JSON.stringify({ contract: validContract, validation: { passed: true, errors: [] }, changes: [], residualRisks: [] }));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: outputPath,
    kind: "skill-output",
    validatedAs: "output",
    attributions: [{ skillId: backendApiContract.skillId, stepId: backendApiContract.steps[2].id, attempt: 1, relation: "produced", ruleIds: [backendApiContract.rules[2].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendApiContract.skillId, backendApiContract.steps[2].id));
  const result = await deriveStrictValidatorResults(root, run, run.skillLedgers[0]);
  assert.equal(result.validatorResults["backend.api-design/gate/contract-test"].passed, true);
  const verified = await store.verifySkill(run.runId, backendApiContract.skillId);
  assert.equal(verified.skillLedgers[0].verificationReports.at(-1)?.hardPassed, true);
});

test("backend strict broken $ref fails contract-test gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "backend-strict-broken-"));
  const store = new StrictSkillRunStore(root);
  let run = makeRun(backendApiContract, "run_backend_broken_ref");
  run = beginStrictStep(readNextStrictChunk(run, backendApiContract.skillId).run, backendApiContract.skillId, backendApiContract.steps[0].id);
  await store.create(run);
  const broken = { ...validContract, paths: { "/broken": { get: { responses: { "200": { $ref: "#/components/schemas/NonExistent" } } } } } };
  const contractPath = path.join(root, "contract.json");
  await writeFile(contractPath, JSON.stringify(broken));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: contractPath,
    kind: "api-contract",
    attributions: [{ skillId: backendApiContract.skillId, stepId: backendApiContract.steps[0].id, attempt: 1, relation: "produced", ruleIds: [backendApiContract.rules[0].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendApiContract.skillId, backendApiContract.steps[0].id));
  run = await store.update(run.runId, (c) => beginStrictStep(c, backendApiContract.skillId, backendApiContract.steps[1].id));
  const inputPath = path.join(root, "verification-input.json");
  await writeFile(inputPath, JSON.stringify({ contract: broken }));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: inputPath,
    kind: "verification-input",
    attributions: [{ skillId: backendApiContract.skillId, stepId: backendApiContract.steps[1].id, attempt: 1, relation: "produced", ruleIds: [backendApiContract.rules[1].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendApiContract.skillId, backendApiContract.steps[1].id));
  run = await store.update(run.runId, (c) => beginStrictStep(c, backendApiContract.skillId, backendApiContract.steps[2].id));
  const outputPath = path.join(root, "output.json");
  await writeFile(outputPath, JSON.stringify({ contract: broken, validation: { passed: false, errors: ["broken ref"] }, changes: [], residualRisks: [] }));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: outputPath,
    kind: "skill-output",
    validatedAs: "output",
    attributions: [{ skillId: backendApiContract.skillId, stepId: backendApiContract.steps[2].id, attempt: 1, relation: "produced", ruleIds: [backendApiContract.rules[2].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendApiContract.skillId, backendApiContract.steps[2].id));
  const result = await deriveStrictValidatorResults(root, run, run.skillLedgers[0]);
  assert.equal(result.validatorResults["backend.api-design/gate/contract-test"].passed, false);
  assert.match(result.validatorResults["backend.api-design/gate/contract-test"].message ?? "", /broken \$ref/i);
});

// --- migration-safety strict integration ---

const backendPersistenceContract: ExecutionContractV2 = {
  schemaVersion: "2.0",
  skillId: "backend.persistence",
  contractVersion: "2.0.0",
  inputSchema: "input.schema.json",
  outputSchema: "output.schema.json",
  mustRead: ["SKILL.md"],
  applicability: { op: "input", path: "modelPath", present: true },
  prerequisites: [{ id: "model-path", kind: "input", path: "modelPath" }],
  steps: [
    { id: "backend.persistence/step/collect-model", type: "collect", requiredEvidenceKinds: ["migration-plan"], ruleIds: ["backend.persistence/rule/migration-present"] },
    { id: "backend.persistence/step/validate-safety", type: "validate", requiredEvidenceKinds: ["verification-input"], ruleIds: ["backend.persistence/rule/migration-safe"] },
    { id: "backend.persistence/step/final-report", type: "report", requiredEvidenceKinds: ["skill-output"], ruleIds: ["backend.persistence/rule/output-schema-valid"] },
  ],
  rules: [
    { id: "backend.persistence/rule/migration-present", description: "Provide migration" },
    { id: "backend.persistence/rule/migration-safe", description: "Migration safe" },
    { id: "backend.persistence/rule/output-schema-valid", description: "Output valid" },
  ],
  gates: [
    { id: "backend.persistence/gate/migration-present", level: "hard", evaluator: { type: "evidence-present", evidenceKind: "migration-plan" }, ruleIds: ["backend.persistence/rule/migration-present"] },
    { id: "backend.persistence/gate/migration-safety", level: "hard", evaluator: { type: "validator", validatorId: "backend/migration-safety" }, ruleIds: ["backend.persistence/rule/migration-safe"] },
    { id: "backend.persistence/gate/output-schema-valid", level: "hard", evaluator: { type: "schema-valid", schema: "output" }, ruleIds: ["backend.persistence/rule/output-schema-valid"] },
  ],
  maxRepairIterations: 2,
};

const makePersistenceRun = (runId = "run_backend_persistence_valid") =>
  createStrictSkillRun({
    runId,
    domain: "backend",
    targetAgent: "codex",
    locale: "en",
    intent: { sha256: sha("test"), normalizedGoal: "test persistence" },
    selectedSkills: [
      {
        skillId: backendPersistenceContract.skillId,
        role: "primary",
        mandatory: true,
        version: "0.1.0",
        packageChecksum: sha("pkg"),
        contractChecksum: sha(JSON.stringify(backendPersistenceContract)),
        contract: backendPersistenceContract,
        schemaSnapshots: {
          input: { type: "object" },
          output: { type: "object", required: ["migration", "safety", "changes", "residualRisks"] },
        },
        schemaChecksums: {
          input: sha(JSON.stringify({ type: "object" })),
          output: sha(JSON.stringify({ type: "object", required: ["migration", "safety", "changes", "residualRisks"] })),
        },
        contentChunks: createContentChunks("SKILL.md", "# Persistence test\n"),
        applicable: true,
        unmetPrerequisites: [],
        input: { modelPath: "prisma/schema.prisma" },
      },
    ],
  });

test("backend strict persistence valid migration passes migration-safety gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "backend-persistence-valid-"));
  const store = new StrictSkillRunStore(root);
  let run = makePersistenceRun();
  run = beginStrictStep(readNextStrictChunk(run, backendPersistenceContract.skillId).run, backendPersistenceContract.skillId, backendPersistenceContract.steps[0].id);
  await store.create(run);
  const planPath = path.join(root, "migration.sql");
  await writeFile(planPath, "ALTER TABLE users ADD COLUMN age INT;");
  run = await store.ingestEvidence(run.runId, {
    sourcePath: planPath,
    kind: "migration-plan",
    attributions: [{ skillId: backendPersistenceContract.skillId, stepId: backendPersistenceContract.steps[0].id, attempt: 1, relation: "produced", ruleIds: [backendPersistenceContract.rules[0].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendPersistenceContract.skillId, backendPersistenceContract.steps[0].id));
  run = await store.update(run.runId, (c) => beginStrictStep(c, backendPersistenceContract.skillId, backendPersistenceContract.steps[1].id));
  const inputPath = path.join(root, "verification-input.json");
  await writeFile(inputPath, JSON.stringify({ sql: "ALTER TABLE users ADD COLUMN age INT;", dryRun: true }));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: inputPath,
    kind: "verification-input",
    attributions: [{ skillId: backendPersistenceContract.skillId, stepId: backendPersistenceContract.steps[1].id, attempt: 1, relation: "produced", ruleIds: [backendPersistenceContract.rules[1].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendPersistenceContract.skillId, backendPersistenceContract.steps[1].id));
  run = await store.update(run.runId, (c) => beginStrictStep(c, backendPersistenceContract.skillId, backendPersistenceContract.steps[2].id));
  const outputPath = path.join(root, "output.json");
  await writeFile(outputPath, JSON.stringify({ migration: { sql: "ALTER TABLE users ADD COLUMN age INT;", statements: ["ALTER TABLE users ADD COLUMN age INT;"] }, safety: { dryRun: true, destructive: false }, changes: ["prisma/schema.prisma"], residualRisks: [] }));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: outputPath,
    kind: "skill-output",
    validatedAs: "output",
    attributions: [{ skillId: backendPersistenceContract.skillId, stepId: backendPersistenceContract.steps[2].id, attempt: 1, relation: "produced", ruleIds: [backendPersistenceContract.rules[2].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendPersistenceContract.skillId, backendPersistenceContract.steps[2].id));
  const result = await deriveStrictValidatorResults(root, run, run.skillLedgers[0]);
  assert.equal(result.validatorResults["backend.persistence/gate/migration-safety"].passed, true);
  const verified = await store.verifySkill(run.runId, backendPersistenceContract.skillId);
  assert.equal(verified.skillLedgers[0].verificationReports.at(-1)?.hardPassed, true);
});

test("backend strict persistence destructive DROP without safeguard fails migration-safety", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "backend-persistence-drop-"));
  const store = new StrictSkillRunStore(root);
  let run = makePersistenceRun("run_backend_persistence_drop");
  run = beginStrictStep(readNextStrictChunk(run, backendPersistenceContract.skillId).run, backendPersistenceContract.skillId, backendPersistenceContract.steps[0].id);
  await store.create(run);
  const planPath = path.join(root, "migration.sql");
  await writeFile(planPath, "DROP TABLE users;");
  run = await store.ingestEvidence(run.runId, {
    sourcePath: planPath,
    kind: "migration-plan",
    attributions: [{ skillId: backendPersistenceContract.skillId, stepId: backendPersistenceContract.steps[0].id, attempt: 1, relation: "produced", ruleIds: [backendPersistenceContract.rules[0].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendPersistenceContract.skillId, backendPersistenceContract.steps[0].id));
  run = await store.update(run.runId, (c) => beginStrictStep(c, backendPersistenceContract.skillId, backendPersistenceContract.steps[1].id));
  const inputPath = path.join(root, "verification-input.json");
  await writeFile(inputPath, JSON.stringify({ sql: "DROP TABLE users;", dryRun: true }));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: inputPath,
    kind: "verification-input",
    attributions: [{ skillId: backendPersistenceContract.skillId, stepId: backendPersistenceContract.steps[1].id, attempt: 1, relation: "produced", ruleIds: [backendPersistenceContract.rules[1].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendPersistenceContract.skillId, backendPersistenceContract.steps[1].id));
  run = await store.update(run.runId, (c) => beginStrictStep(c, backendPersistenceContract.skillId, backendPersistenceContract.steps[2].id));
  const outputPath = path.join(root, "output.json");
  await writeFile(outputPath, JSON.stringify({ migration: { sql: "DROP TABLE users;", statements: ["DROP TABLE users;"] }, safety: { dryRun: true, destructive: true }, changes: [], residualRisks: [] }));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: outputPath,
    kind: "skill-output",
    validatedAs: "output",
    attributions: [{ skillId: backendPersistenceContract.skillId, stepId: backendPersistenceContract.steps[2].id, attempt: 1, relation: "produced", ruleIds: [backendPersistenceContract.rules[2].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendPersistenceContract.skillId, backendPersistenceContract.steps[2].id));
  const result = await deriveStrictValidatorResults(root, run, run.skillLedgers[0]);
  assert.equal(result.validatorResults["backend.persistence/gate/migration-safety"].passed, false);
});

// --- secret-audit strict integration ---

const backendAuthContract: ExecutionContractV2 = {
  schemaVersion: "2.0",
  skillId: "backend.auth",
  contractVersion: "2.0.0",
  inputSchema: "input.schema.json",
  outputSchema: "output.schema.json",
  mustRead: ["SKILL.md"],
  applicability: { op: "input", path: "provider", present: true },
  prerequisites: [{ id: "provider", kind: "input", path: "provider" }],
  steps: [
    { id: "backend.auth/step/collect-auth-design", type: "collect", requiredEvidenceKinds: ["implementation-diff"], ruleIds: ["backend.auth/rule/secret-handling"] },
    { id: "backend.auth/step/audit-secrets", type: "validate", requiredEvidenceKinds: ["verification-input"], ruleIds: ["backend.auth/rule/no-leaked-secrets"] },
    { id: "backend.auth/step/final-report", type: "report", requiredEvidenceKinds: ["skill-output"], ruleIds: ["backend.auth/rule/output-schema-valid"] },
  ],
  rules: [
    { id: "backend.auth/rule/secret-handling", description: "Auth handles secrets" },
    { id: "backend.auth/rule/no-leaked-secrets", description: "No leaked secrets" },
    { id: "backend.auth/rule/output-schema-valid", description: "Output valid" },
  ],
  gates: [
    { id: "backend.auth/gate/secret-handling", level: "hard", evaluator: { type: "evidence-present", evidenceKind: "implementation-diff" }, ruleIds: ["backend.auth/rule/secret-handling"] },
    { id: "backend.auth/gate/secret-audit", level: "hard", evaluator: { type: "validator", validatorId: "backend/secret-audit" }, ruleIds: ["backend.auth/rule/no-leaked-secrets"] },
    { id: "backend.auth/gate/output-schema-valid", level: "hard", evaluator: { type: "schema-valid", schema: "output" }, ruleIds: ["backend.auth/rule/output-schema-valid"] },
  ],
  maxRepairIterations: 2,
};

const makeAuthRun = (runId = "run_backend_auth_valid") =>
  createStrictSkillRun({
    runId,
    domain: "backend",
    targetAgent: "codex",
    locale: "en",
    intent: { sha256: sha("test"), normalizedGoal: "test auth" },
    selectedSkills: [
      {
        skillId: backendAuthContract.skillId,
        role: "primary",
        mandatory: true,
        version: "0.1.0",
        packageChecksum: sha("pkg"),
        contractChecksum: sha(JSON.stringify(backendAuthContract)),
        contract: backendAuthContract,
        schemaSnapshots: {
          input: { type: "object" },
          output: { type: "object", required: ["auth", "secretHandling", "changes", "residualRisks"] },
        },
        schemaChecksums: {
          input: sha(JSON.stringify({ type: "object" })),
          output: sha(JSON.stringify({ type: "object", required: ["auth", "secretHandling", "changes", "residualRisks"] })),
        },
        contentChunks: createContentChunks("SKILL.md", "# Auth test\n"),
        applicable: true,
        unmetPrerequisites: [],
        input: { provider: "next-auth" },
      },
    ],
  });

test("backend strict auth with env indirection passes secret-audit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "backend-auth-valid-"));
  const store = new StrictSkillRunStore(root);
  let run = makeAuthRun();
  run = beginStrictStep(readNextStrictChunk(run, backendAuthContract.skillId).run, backendAuthContract.skillId, backendAuthContract.steps[0].id);
  await store.create(run);
  const diffPath = path.join(root, "auth.diff");
  await writeFile(diffPath, "const token = process.env.JWT_SECRET;\n");
  run = await store.ingestEvidence(run.runId, {
    sourcePath: diffPath,
    kind: "implementation-diff",
    attributions: [{ skillId: backendAuthContract.skillId, stepId: backendAuthContract.steps[0].id, attempt: 1, relation: "produced", ruleIds: [backendAuthContract.rules[0].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendAuthContract.skillId, backendAuthContract.steps[0].id));
  run = await store.update(run.runId, (c) => beginStrictStep(c, backendAuthContract.skillId, backendAuthContract.steps[1].id));
  const inputPath = path.join(root, "verification-input.json");
  await writeFile(inputPath, JSON.stringify("const token = process.env.JWT_SECRET;"));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: inputPath,
    kind: "verification-input",
    attributions: [{ skillId: backendAuthContract.skillId, stepId: backendAuthContract.steps[1].id, attempt: 1, relation: "produced", ruleIds: [backendAuthContract.rules[1].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendAuthContract.skillId, backendAuthContract.steps[1].id));
  run = await store.update(run.runId, (c) => beginStrictStep(c, backendAuthContract.skillId, backendAuthContract.steps[2].id));
  const outputPath = path.join(root, "output.json");
  await writeFile(outputPath, JSON.stringify({ auth: { provider: "next-auth", session: {} }, secretHandling: { usesEnv: true, audited: true }, changes: ["auth.ts"], residualRisks: [] }));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: outputPath,
    kind: "skill-output",
    validatedAs: "output",
    attributions: [{ skillId: backendAuthContract.skillId, stepId: backendAuthContract.steps[2].id, attempt: 1, relation: "produced", ruleIds: [backendAuthContract.rules[2].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendAuthContract.skillId, backendAuthContract.steps[2].id));
  const result = await deriveStrictValidatorResults(root, run, run.skillLedgers[0]);
  assert.equal(result.validatorResults["backend.auth/gate/secret-audit"].passed, true);
  const verified = await store.verifySkill(run.runId, backendAuthContract.skillId);
  assert.equal(verified.skillLedgers[0].verificationReports.at(-1)?.hardPassed, true);
});

test("backend strict auth hardcoded secret fails secret-audit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "backend-auth-fail-"));
  const store = new StrictSkillRunStore(root);
  let run = makeAuthRun("run_backend_auth_fail");
  run = beginStrictStep(readNextStrictChunk(run, backendAuthContract.skillId).run, backendAuthContract.skillId, backendAuthContract.steps[0].id);
  await store.create(run);
  const diffPath = path.join(root, "auth.diff");
  await writeFile(diffPath, 'const password = "hunter2";\n');
  run = await store.ingestEvidence(run.runId, {
    sourcePath: diffPath,
    kind: "implementation-diff",
    attributions: [{ skillId: backendAuthContract.skillId, stepId: backendAuthContract.steps[0].id, attempt: 1, relation: "produced", ruleIds: [backendAuthContract.rules[0].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendAuthContract.skillId, backendAuthContract.steps[0].id));
  run = await store.update(run.runId, (c) => beginStrictStep(c, backendAuthContract.skillId, backendAuthContract.steps[1].id));
  const inputPath = path.join(root, "verification-input.json");
  await writeFile(inputPath, JSON.stringify('const password = "hunter2";'));
  run = await store.ingestEvidence(run.runId, {
    sourcePath: inputPath,
    kind: "verification-input",
    attributions: [{ skillId: backendAuthContract.skillId, stepId: backendAuthContract.steps[1].id, attempt: 1, relation: "produced", ruleIds: [backendAuthContract.rules[1].id] }],
  });
  run = await store.update(run.runId, (c) => completeStrictStep(c, backendAuthContract.skillId, backendAuthContract.steps[1].id));
  const result = await deriveStrictValidatorResults(root, run, run.skillLedgers[0]);
  assert.equal(result.validatorResults["backend.auth/gate/secret-audit"].passed, false);
  assert.match(result.validatorResults["backend.auth/gate/secret-audit"].message ?? "", /hardcoded-password/i);
});

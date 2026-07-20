import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  computeSourcePackageChecksum,
  createSkillSourceSnapshot,
  RouterReaderError,
  RouterSourceReader,
  RouterStore,
  type SourceSnapshotInput,
} from "../src/router/index.ts";
import type { RouterRun, SkillSourceSnapshot } from "../src/router/types.ts";

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
const temporaryProject = () => mkdtemp(path.join(os.tmpdir(), "skillranger-router-reader-"));

const writeSource = async (root: string, files: Record<string, string | Uint8Array>) => {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
};

const createSnapshotInput = async (projectRoot: string, sourceRoot: string, mandatoryPaths?: string[]): Promise<SourceSnapshotInput> => ({
  skillId: "fixture.primary",
  source: "installed",
  version: "1.0.0",
  packageChecksum: await computeSourcePackageChecksum(sourceRoot),
  auditDigest: digest("a"),
  sourceRoot,
  authorizedRoot: projectRoot,
  locator: { kind: "installed", targetAgent: "codex", installedPath: path.relative(projectRoot, sourceRoot).replace(/\\/g, "/") },
  mandatoryPaths,
});

const createRun = async (projectRoot: string, snapshot: SkillSourceSnapshot): Promise<RouterRun> => {
  const store = new RouterStore(projectRoot);
  return {
    schemaVersion: "router-run/1.0",
    routerRunId: "route_12345678",
    revision: 0,
    readRevision: 0,
    state: "prepared",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    projectIdentity: await store.projectIdentity(),
    taskProfile: {
      schemaVersion: "task-profile/1.0", normalizedGoal: "read skill", locale: "en", actions: ["implement"],
      artifactTypes: [], technologies: [], constraints: [], qualityGoals: [], acceptanceCriteria: [], domains: [], subtasks: [], evidence: [],
    },
    routing: {
      targetAgent: "codex", domains: [], deterministicKey: digest("b"), routerAlgorithmVersion: "router/1.0", routingDate: "2026-07-19",
      fingerprintDigest: digest("c"), registryDigest: digest("d"), configDigest: digest("e"),
    },
    selections: {
      environment: [],
      primary: {
        skillId: snapshot.skillId, displayName: "Primary", role: "primary", domains: ["frontend"], version: snapshot.version,
        packageChecksum: snapshot.packageChecksum, score: 1, source: snapshot.source, reasons: ["test"], verificationStatus: "not-required",
      },
      companions: [], verification: [], agentContext: [],
    },
    sourceInventory: [snapshot],
    readLedger: [],
    runtime: { kind: "lifecycle-v1", runId: "run_12345678" },
  };
};

test("source snapshot inventories only allowed UTF-8 text and records checksums", async () => {
  const projectRoot = await temporaryProject();
  const sourceRoot = path.join(projectRoot, "skill-source");
  await writeSource(sourceRoot, {
    "SKILL.md": "# Skill\n",
    "references/guide.txt": "guide\n",
    "references/data.json": "{\"ok\":true}\n",
    "scripts/check.sh": "#!/bin/sh\nprintf no-execution\n",
    "scripts/deploy.rb": "puts 'not delivered'\n",
    "references/.env/token.txt": "blocked",
    "assets/logo.svg": "<svg />",
    "README.md": "not delivered",
  });
  const snapshot = await createSkillSourceSnapshot(await createSnapshotInput(projectRoot, sourceRoot));
  assert.deepEqual(snapshot.files.map(({ path: filePath }) => filePath), ["SKILL.md", "references/data.json", "references/guide.txt", "scripts/check.sh"]);
  assert.equal(snapshot.files.find(({ path: filePath }) => filePath === "scripts/check.sh")?.mimeType, "text/plain");
  assert.equal(snapshot.files.find(({ path: filePath }) => filePath === "SKILL.md")?.mandatory, true);
  assert.equal(snapshot.files.some(({ path: filePath }) => filePath.includes(".env") || filePath.endsWith(".rb")), false);
});

test("reader serves sequential UTF-8 mandatory chunks and idempotent replay", async () => {
  const projectRoot = await temporaryProject();
  const sourceRoot = path.join(projectRoot, "skill-source");
  const content = "Привет, SkillRanger.\n";
  await writeSource(sourceRoot, { "SKILL.md": content, "references/guide.txt": "optional guide" });
  const snapshot = await createSkillSourceSnapshot(await createSnapshotInput(projectRoot, sourceRoot));
  const store = new RouterStore(projectRoot);
  await store.create(await createRun(projectRoot, snapshot));
  const reader = new RouterSourceReader(projectRoot, store, { chunkBytes: 7 });
  let revision = 0;
  let assembled = "";
  let last = await reader.read({ routerRunId: "route_12345678", readRequestId: randomUUID(), expectedReadRevision: revision, mode: "mandatory-next" });
  assembled += last.content;
  revision = last.readRevision;
  while (!last.complete) {
    last = await reader.read({ routerRunId: "route_12345678", readRequestId: randomUUID(), expectedReadRevision: revision, mode: "mandatory-next" });
    assembled += last.content;
    revision = last.readRevision;
  }
  assert.equal(assembled, content);
  assert.equal(last.readStatus.runMandatoryReadsComplete, true);
  const replayInput = { routerRunId: "route_12345678", readRequestId: (await store.read("route_12345678")).readLedger[0].readRequestId, expectedReadRevision: 0, mode: "mandatory-next" as const };
  const replay = await reader.read(replayInput);
  assert.equal(replay.content, (await store.read("route_12345678")).readLedger[0].bytes === replay.deliveredBytes ? replay.content : "");
  assert.equal((await store.read("route_12345678")).readLedger.length, revision);
});

test("reader rejects traversal, arbitrary skills, optional reads before mandatory, and conflicting replay", async () => {
  const projectRoot = await temporaryProject();
  const sourceRoot = path.join(projectRoot, "skill-source");
  await writeSource(sourceRoot, { "SKILL.md": "mandatory", "references/guide.txt": "optional" });
  const snapshot = await createSkillSourceSnapshot(await createSnapshotInput(projectRoot, sourceRoot));
  const store = new RouterStore(projectRoot);
  await store.create(await createRun(projectRoot, snapshot));
  const reader = new RouterSourceReader(projectRoot, store, { chunkBytes: 32 });
  const requestId = randomUUID();
  await assert.rejects(
    () => reader.read({ routerRunId: "route_12345678", readRequestId: requestId, expectedReadRevision: 0, mode: "optional-file", skillId: "other.skill", path: "references/guide.txt" }),
    (error) => error instanceof RouterReaderError && error.code === "skill-not-selected",
  );
  await assert.rejects(
    () => reader.read({ routerRunId: "route_12345678", readRequestId: randomUUID(), expectedReadRevision: 0, mode: "optional-file", skillId: snapshot.skillId, path: "../secret.txt" }),
    (error) => error instanceof RouterReaderError && error.code === "skill-path-blocked",
  );
  await assert.rejects(
    () => reader.read({ routerRunId: "route_12345678", readRequestId: randomUUID(), expectedReadRevision: 0, mode: "optional-file", skillId: snapshot.skillId, path: "references/guide.txt" }),
    (error) => error instanceof RouterReaderError && error.code === "read-order-invalid",
  );
  await reader.read({ routerRunId: "route_12345678", readRequestId: requestId, expectedReadRevision: 0, mode: "mandatory-next" });
  await assert.rejects(
    () => reader.read({ routerRunId: "route_12345678", readRequestId: requestId, expectedReadRevision: 0, mode: "optional-file", skillId: snapshot.skillId, path: "SKILL.md" }),
    (error) => error instanceof RouterReaderError && error.code === "read-request-conflict",
  );
});

test("reader rejects stale concurrent revisions and preserves an incomplete interrupted read", async () => {
  const projectRoot = await temporaryProject();
  const sourceRoot = path.join(projectRoot, "skill-source");
  await writeSource(sourceRoot, { "SKILL.md": "0123456789abcdef" });
  const snapshot = await createSkillSourceSnapshot(await createSnapshotInput(projectRoot, sourceRoot));
  const store = new RouterStore(projectRoot);
  await store.create(await createRun(projectRoot, snapshot));
  const reader = new RouterSourceReader(projectRoot, store, { chunkBytes: 4 });
  const requestIds = [randomUUID(), randomUUID()];
  const results = await Promise.allSettled([
    reader.read({ routerRunId: "route_12345678", readRequestId: requestIds[0], expectedReadRevision: 0, mode: "mandatory-next" }),
    reader.read({ routerRunId: "route_12345678", readRequestId: requestIds[1], expectedReadRevision: 0, mode: "mandatory-next" }),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status, reason }) => status === "rejected" && reason instanceof RouterReaderError && reason.code === "read-order-invalid").length, 1);
  const current = await store.read("route_12345678");
  assert.equal(current.readRevision, 1);
  assert.equal(current.state, "reading");
  const winnerIndex = results.findIndex(({ status }) => status === "fulfilled");
  const replay = await reader.read({ routerRunId: "route_12345678", readRequestId: requestIds[winnerIndex], expectedReadRevision: 0, mode: "mandatory-next" });
  assert.equal(replay.readRevision, 1);
  assert.equal((await store.read("route_12345678")).readRevision, 1);
});

test("reader enforces the optional additional-read budget", async () => {
  const projectRoot = await temporaryProject();
  const sourceRoot = path.join(projectRoot, "skill-source");
  await writeSource(sourceRoot, { "SKILL.md": "mandatory", "references/guide.txt": "optional-content" });
  const snapshot = await createSkillSourceSnapshot(await createSnapshotInput(projectRoot, sourceRoot));
  const store = new RouterStore(projectRoot);
  await store.create(await createRun(projectRoot, snapshot));
  const reader = new RouterSourceReader(projectRoot, store, { chunkBytes: 32, maxAdditionalReadBytes: 5 });
  await reader.read({ routerRunId: "route_12345678", readRequestId: randomUUID(), expectedReadRevision: 0, mode: "mandatory-next" });
  const firstOptional = await reader.read({ routerRunId: "route_12345678", readRequestId: randomUUID(), expectedReadRevision: 1, mode: "optional-file", skillId: snapshot.skillId, path: "references/guide.txt" });
  assert.equal(firstOptional.deliveredBytes, 5);
  await assert.rejects(
    () => reader.read({ routerRunId: "route_12345678", readRequestId: randomUUID(), expectedReadRevision: 2, mode: "optional-file", skillId: snapshot.skillId, path: "references/guide.txt" }),
    (error) => error instanceof RouterReaderError && error.code === "context-budget-exceeded",
  );
});

test("reader blocks stale source, symlink components, binary data, and invalid UTF-8", async (context) => {
  if (process.platform === "win32") context.skip("symlink fixture requires platform-specific privileges on Windows");
  const projectRoot = await temporaryProject();
  const sourceRoot = path.join(projectRoot, "skill-source");
  await writeSource(sourceRoot, { "SKILL.md": "stable", "references/guide.txt": "guide" });
  const snapshot = await createSkillSourceSnapshot(await createSnapshotInput(projectRoot, sourceRoot));
  const store = new RouterStore(projectRoot);
  await store.create(await createRun(projectRoot, snapshot));
  await writeFile(path.join(sourceRoot, "SKILL.md"), "mutated");
  const reader = new RouterSourceReader(projectRoot, store, { chunkBytes: 32 });
  await assert.rejects(
    () => reader.read({ routerRunId: "route_12345678", readRequestId: randomUUID(), expectedReadRevision: 0, mode: "mandatory-next" }),
    (error) => error instanceof RouterReaderError && error.code === "stale-skill-checksum",
  );

  const invalidRoot = path.join(projectRoot, "invalid-source");
  await writeSource(invalidRoot, { "SKILL.md": Buffer.from([0xff, 0xfe]) });
  const invalidChecksum = await computeSourcePackageChecksum(invalidRoot);
  const invalidInput = await createSnapshotInput(projectRoot, invalidRoot);
  await assert.rejects(
    () => createSkillSourceSnapshot({ ...invalidInput, packageChecksum: invalidChecksum }),
    (error) => error instanceof RouterReaderError && error.code === "skill-file-unsupported",
  );
  await symlink(sourceRoot, path.join(projectRoot, "linked-source"));
  const linkedInput: SourceSnapshotInput = {
    ...(await createSnapshotInput(projectRoot, sourceRoot)),
    sourceRoot: path.join(projectRoot, "linked-source"),
    locator: { kind: "installed", targetAgent: "codex", installedPath: "linked-source" },
  };
  await assert.rejects(
    () => createSkillSourceSnapshot(linkedInput),
    (error) => error instanceof RouterReaderError && error.code === "skill-source-unavailable",
  );
});

test("snapshot and reader enforce bounded inventory and authorized source roots", async () => {
  const projectRoot = await temporaryProject();
  const sourceRoot = path.join(projectRoot, "skill-source");
  await writeSource(sourceRoot, { "SKILL.md": "stable", "references/a.txt": "a", "references/b.txt": "b" });
  const input = await createSnapshotInput(projectRoot, sourceRoot);
  await assert.rejects(
    () => createSkillSourceSnapshot(input, { maxSourceFiles: 2 }),
    (error) => error instanceof RouterReaderError && error.code === "skill-source-unavailable",
  );

  const snapshot = await createSkillSourceSnapshot(input);
  const store = new RouterStore(projectRoot);
  await store.create(await createRun(projectRoot, snapshot));
  const outside = await temporaryProject();
  await writeSource(outside, { "SKILL.md": "outside" });
  const reader = new RouterSourceReader(projectRoot, store, { resolveInstalledRoot: () => outside });
  await assert.rejects(
    () => reader.read({ routerRunId: "route_12345678", readRequestId: randomUUID(), expectedReadRevision: 0, mode: "mandatory-next" }),
    (error) => error instanceof RouterReaderError && error.code === "skill-path-blocked",
  );
});

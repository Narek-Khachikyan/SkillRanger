import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadLocalRegistry,
  validateLocalRegistry,
} from "../src/registry/index.ts";
import { validateSkillManifest } from "../src/registry/validation.ts";

const validManifest = (
  id: string,
  name: string,
  description = "Review frontend code for quality, accessibility, and maintainability.",
) => ({
  id,
  name,
  displayName: "Test Skill",
  description,
  stackTags: ["frontend"],
  taskTags: ["code-review"],
  supportedAgents: ["codex"],
  source: {
    type: "curated",
    registry: "local",
    path: `./registry/skills/${id}`,
  },
  version: "0.1.0",
  riskLevel: "low",
  permissions: {
    filesystem: ["read-project"],
    network: false,
    shell: false,
    writes: [],
  },
  scripts: [],
  dependencies: [],
  qualityScore: 0.5,
  securityScore: 0.9,
  installTargets: ["repo"],
  conflictsWith: [],
  supersedes: [],
  maintainer: {
    name: "test",
    trustTier: "test",
  },
  license: "MIT",
});

const qualityScoreFields = [
  "usefulness",
  "triggerSpecificity",
  "progressiveDisclosure",
  "verifiability",
  "maintainability",
  "portability",
] as const;

const derivedQualityScore = (
  scores: Record<(typeof qualityScoreFields)[number], number>,
) =>
  Number(
    (
      qualityScoreFields.reduce((sum, field) => sum + scores[field], 0) /
      qualityScoreFields.length
    ).toFixed(2),
  );

const writeSkillPackage = async (
  registryRoot: string,
  id: string,
  input: {
    manifest: unknown;
    skillText: string;
  },
) => {
  const skillRoot = path.join(registryRoot, "skills", id);
  await mkdir(skillRoot, { recursive: true });
  await writeFile(path.join(skillRoot, "SKILL.md"), input.skillText);
  await writeFile(
    path.join(skillRoot, "skill.manifest.json"),
    JSON.stringify(input.manifest, null, 2),
  );
};

test("local registry validation accepts curated skills", async () => {
  const report = await validateLocalRegistry("registry");
  assert.equal(report.ok, true);
  assert.equal(report.skills.length, 17);
});

test("curated skills carry derived quality rubric metadata", async () => {
  const skills = await loadLocalRegistry("registry");
  for (const skill of skills) {
    assert.ok(
      skill.manifest.quality,
      `${skill.manifest.id} should include quality rubric metadata`,
    );
    assert.equal(skill.manifest.quality.rubricVersion, "1.0");
    assert.equal(
      derivedQualityScore(skill.manifest.quality.scores),
      skill.manifest.qualityScore,
    );
  }
});

test("curated skills carry native compatibility metadata for supported agents", async () => {
  const skills = await loadLocalRegistry("registry");
  for (const skill of skills) {
    assert.ok(
      skill.manifest.compatibility,
      `${skill.manifest.id} should include compatibility metadata`,
    );
    for (const agent of skill.manifest.supportedAgents) {
      assert.equal(skill.manifest.compatibility[agent]?.level, "native");
      assert.ok(skill.manifest.compatibility[agent]?.scopes?.includes("repo"));
    }
  }
});

test("curated skills carry routing lane metadata", async () => {
  const skills = await loadLocalRegistry("registry");
  const allowedLanes = new Set([
    "framework",
    "design",
    "implementation",
    "qa",
    "agent-context",
  ]);
  for (const skill of skills) {
    assert.ok(
      skill.manifest.routing,
      `${skill.manifest.id} should include routing metadata`,
    );
    assert.ok(allowedLanes.has(skill.manifest.routing.lane));
    assert.match(skill.manifest.routing.category, /^[a-z0-9][a-z0-9._-]*$/);
  }
});

test("manifest validation accepts optional evaluation metadata statuses", () => {
  for (const status of [
    "none",
    "trigger-eval",
    "task-eval",
    "real-project-smoke",
    "curated",
  ]) {
    const issues = validateSkillManifest({
      ...validManifest(`good.${status}`, status),
      evaluation: {
        status,
        lastRunAt: "2026-07-05T12:00:00.000Z",
        benchmarkVersion: "frontend-skill-quality-v1",
        evidenceUri: "evals/frontend/results/good.json",
        score: 0.87,
      },
    });

    assert.deepEqual(
      issues.filter((issue) => issue.path.startsWith("evaluation")),
      [],
      `${status} should be accepted`,
    );
  }
});

test("manifest validation rejects malformed evaluation metadata", () => {
  const issues = validateSkillManifest({
    ...validManifest("bad.evaluation", "evaluation"),
    evaluation: {
      status: "manual-smoke",
      lastRunAt: "not-a-date",
      benchmarkVersion: " ",
      evidenceUri: "",
      score: 1.01,
    },
  });

  assert.deepEqual(
    issues
      .filter((issue) => issue.path.startsWith("evaluation"))
      .map((issue) => issue.path),
    [
      "evaluation.status",
      "evaluation.lastRunAt",
      "evaluation.benchmarkVersion",
      "evaluation.evidenceUri",
      "evaluation.score",
    ],
  );
});

test("local registry loader rejects invalid manifests", async () => {
  const tmpRoot = await mkdtemp(
    path.join(os.tmpdir(), "skillranger-registry-"),
  );
  const registryRoot = path.join(tmpRoot, "registry");
  const manifest = validManifest("bad.skill", "bad");
  delete (manifest as Partial<typeof manifest>).name;
  await writeSkillPackage(registryRoot, "bad.skill", {
    manifest,
    skillText:
      "---\nname: bad\ndescription: Review frontend code for quality, accessibility, and maintainability.\n---\n# Bad\n",
  });

  await assert.rejects(
    loadLocalRegistry(registryRoot),
    /Invalid skill manifest/,
  );
});

test("local registry loader rejects SKILL.md frontmatter name mismatch", async () => {
  const tmpRoot = await mkdtemp(
    path.join(os.tmpdir(), "skillranger-registry-"),
  );
  const registryRoot = path.join(tmpRoot, "registry");
  await writeSkillPackage(registryRoot, "bad.frontmatter-name", {
    manifest: validManifest("bad.frontmatter-name", "manifest-name"),
    skillText:
      "---\nname: skill-md-name\ndescription: Review frontend code for quality, accessibility, and maintainability.\n---\n# Bad\n",
  });

  await assert.rejects(
    loadLocalRegistry(registryRoot),
    /SKILL\.md\.frontmatter\.name/,
  );
});

test("local registry loader rejects SKILL.md frontmatter description drift", async () => {
  const tmpRoot = await mkdtemp(
    path.join(os.tmpdir(), "skillranger-registry-"),
  );
  const registryRoot = path.join(tmpRoot, "registry");
  await writeSkillPackage(registryRoot, "bad.frontmatter-description", {
    manifest: validManifest("bad.frontmatter-description", "description-drift"),
    skillText:
      "---\nname: description-drift\ndescription: Manage Kubernetes incident response and database migrations.\n---\n# Bad\n",
  });

  await assert.rejects(
    loadLocalRegistry(registryRoot),
    /SKILL\.md\.frontmatter\.description/,
  );
});

test("local registry loader rejects hidden registry files", async () => {
  const tmpRoot = await mkdtemp(
    path.join(os.tmpdir(), "skillranger-registry-"),
  );
  const registryRoot = path.join(tmpRoot, "registry");
  await mkdir(path.join(registryRoot, "skills"), { recursive: true });
  await writeFile(path.join(registryRoot, "skills", ".DS_Store"), "");

  await assert.rejects(
    loadLocalRegistry(registryRoot),
    /hidden files or folders/,
  );
});

test("local registry loader rejects unexpected skill package top-level entries", async () => {
  const tmpRoot = await mkdtemp(
    path.join(os.tmpdir(), "skillranger-registry-"),
  );
  const registryRoot = path.join(tmpRoot, "registry");
  await writeSkillPackage(registryRoot, "bad.extra-file", {
    manifest: validManifest("bad.extra-file", "extra-file"),
    skillText:
      "---\nname: extra-file\ndescription: Review frontend code for quality, accessibility, and maintainability.\n---\n# Bad\n",
  });
  await writeFile(
    path.join(registryRoot, "skills", "bad.extra-file", "notes.txt"),
    "not part of the package contract\n",
  );

  await assert.rejects(
    loadLocalRegistry(registryRoot),
    /Unexpected skill package top-level entry/,
  );
});

test("local registry loader rejects duplicate skill names", async () => {
  const tmpRoot = await mkdtemp(
    path.join(os.tmpdir(), "skillranger-registry-"),
  );
  const registryRoot = path.join(tmpRoot, "registry");
  for (const id of ["bad.duplicate-one", "bad.duplicate-two"]) {
    await writeSkillPackage(registryRoot, id, {
      manifest: validManifest(id, "duplicate-name"),
      skillText:
        "---\nname: duplicate-name\ndescription: Review frontend code for quality, accessibility, and maintainability.\n---\n# Duplicate\n\nUse this skill when reviewing frontend code. Do not use it for backend work.\n\n## Workflow\n\n1. Review the code.\n\n## Validation\n\nValidate findings.\n\n## Output Contract\n\nReturn findings.\n\n## References\n\nNo packaged references are required for this test skill.\n",
    });
  }

  await assert.rejects(loadLocalRegistry(registryRoot), /Duplicate skill name/);
});

test("local registry loader rejects qualityScore drift from rubric", async () => {
  const tmpRoot = await mkdtemp(
    path.join(os.tmpdir(), "skillranger-registry-"),
  );
  const registryRoot = path.join(tmpRoot, "registry");
  const manifest = validManifest("bad.quality-score", "quality-score");
  await writeSkillPackage(registryRoot, "bad.quality-score", {
    manifest: {
      ...manifest,
      qualityScore: 0.9,
      quality: {
        rubricVersion: "1.0",
        scores: {
          usefulness: 0.5,
          triggerSpecificity: 0.5,
          progressiveDisclosure: 0.5,
          safety: 0.9,
          verifiability: 0.5,
          maintainability: 0.5,
          portability: 0.5,
        },
      },
    },
    skillText:
      "---\nname: quality-score\ndescription: Review frontend code for quality, accessibility, and maintainability.\n---\n# Bad\n",
  });

  await assert.rejects(
    loadLocalRegistry(registryRoot),
    /derived quality rubric score 0\.50/,
  );
});

test("local registry loader rejects supportedAgents without native compatibility", async () => {
  const tmpRoot = await mkdtemp(
    path.join(os.tmpdir(), "skillranger-registry-"),
  );
  const registryRoot = path.join(tmpRoot, "registry");
  await writeSkillPackage(registryRoot, "bad.compatibility", {
    manifest: {
      ...validManifest("bad.compatibility", "compatibility"),
      compatibility: {
        codex: {
          level: "convertible",
          scopes: ["repo"],
        },
      },
    },
    skillText:
      "---\nname: compatibility\ndescription: Review frontend code for quality, accessibility, and maintainability.\n---\n# Bad\n",
  });

  await assert.rejects(
    loadLocalRegistry(registryRoot),
    /supportedAgents entries must have native compatibility/,
  );
});

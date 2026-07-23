import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadLocalRegistry,
  validateLocalRegistry,
} from "../src/registry/index.ts";
import { parseSkillFrontmatter, validateSkillManifest } from "../src/registry/validation.ts";

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
  assert.equal(report.skills.length, 18);
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

const convertibleSetupTargets = [
  "claude-code",
  "opencode",
  "cursor",
  "gemini-cli",
] as const;

test("bundled skills declare recommendation compatibility for every setup target", async () => {
  const skills = await loadLocalRegistry("registry");
  for (const skill of skills) {
    assert.equal(skill.manifest.compatibility?.codex?.level, "native", skill.manifest.id);
    assert.ok(skill.manifest.compatibility?.codex?.scopes?.includes("repo"), skill.manifest.id);

    for (const target of convertibleSetupTargets) {
      const compatibility = skill.manifest.compatibility?.[target];
      assert.equal(compatibility?.level, "convertible", `${skill.manifest.id}:${target}`);
      assert.deepEqual(compatibility?.scopes, ["repo"], `${skill.manifest.id}:${target}`);
      assert.equal(compatibility?.adapter, target, `${skill.manifest.id}:${target}`);
      assert.equal(compatibility?.requiresAdapter, true, `${skill.manifest.id}:${target}`);
      assert.equal(skill.manifest.supportedAgents.includes(target), false, `${skill.manifest.id}:${target}`);
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

test("curated skills carry explicit universal router metadata", async () => {
  const skills = await loadLocalRegistry("registry");
  for (const skill of skills) {
    const routing = skill.manifest.routing;
    assert.ok(routing, skill.manifest.id);
    assert.ok(routing.roles?.length, skill.manifest.id);
    assert.ok(routing.domains?.includes("frontend"), skill.manifest.id);
    assert.ok(routing.actions?.length, skill.manifest.id);
    assert.ok(routing.artifactTypes?.length, skill.manifest.id);
    assert.ok(routing.intentTags?.length, skill.manifest.id);
    assert.ok(routing.technologyTags?.length, skill.manifest.id);
    assert.ok(routing.environmentSignals?.length, skill.manifest.id);
    assert.ok(routing.qualityGoals?.length, skill.manifest.id);
    assert.ok(routing.requiredCapabilities?.length, skill.manifest.id);
    assert.ok(Array.isArray(routing.optionalCapabilities), skill.manifest.id);
    assert.ok(Array.isArray(routing.complements), skill.manifest.id);
  }
});

test("skill router metadata preserves lane/category and validates declarative fields", () => {
  const issues = validateSkillManifest({
    ...validManifest("good.router-metadata", "router-metadata"),
    routing: {
      lane: "implementation",
      category: "authentication",
      roles: ["primary", "companion"],
      domains: ["backend-api"],
      actions: ["implement", "fix"],
      artifactTypes: ["authentication-flow", "api"],
      intentTags: ["authentication", "oauth"],
      technologyTags: ["nestjs", "openid-connect"],
      environmentSignals: ["dependency:@nestjs/core", "file:src/**/*.controller.ts"],
      qualityGoals: ["security", "correctness"],
      requiredCapabilities: ["filesystem", "terminal"],
      optionalCapabilities: ["network"],
      complements: ["qa.api-integration-testing"],
    },
  });

  assert.deepEqual(issues.filter((issue) => issue.path.startsWith("routing")), []);
});

test("skill router metadata rejects unknown fields, normalized duplicates, conflicts, bounds, and unsafe DSL", () => {
  const issues = validateSkillManifest({
    ...validManifest("bad.router-metadata", "router-metadata"),
    dependencies: ["shared.skill"],
    conflictsWith: ["shared.skill"],
    routing: {
      lane: "implementation",
      category: "authentication",
      roles: ["primary", "primary"],
      domains: ["backend-api", "BACKEND-API"],
      actions: ["implement"],
      artifactTypes: Array.from({ length: 65 }, (_, index) => `artifact-${index}`),
      intentTags: ["authentication"],
      technologyTags: ["x".repeat(129)],
      environmentSignals: ["command:rm -rf /", "file:../secret", "file:{src,test}/**/*"],
      qualityGoals: ["security"],
      requiredCapabilities: ["filesystem"],
      optionalCapabilities: [],
      complements: ["bad.router-metadata"],
      unexpected: true,
    },
  });
  const paths = issues.map((issue) => issue.path);

  assert.ok(paths.includes("routing.unexpected"));
  assert.ok(paths.includes("routing.roles"));
  assert.ok(paths.includes("routing.domains"));
  assert.ok(paths.includes("routing.artifactTypes"));
  assert.ok(paths.includes("routing.technologyTags.0"));
  assert.ok(paths.includes("routing.environmentSignals.0"));
  assert.ok(paths.includes("routing.environmentSignals.1"));
  assert.ok(paths.includes("routing.environmentSignals.2"));
  assert.ok(paths.includes("routing.complements.0"));
  assert.ok(paths.includes("dependencies"));
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

test("local registry loader enforces manifest byte and object-depth limits", async () => {
  const oversizedRoot = path.join(await mkdtemp(path.join(os.tmpdir(), "skillranger-registry-")), "registry");
  await writeSkillPackage(oversizedRoot, "bad.oversized", {
    manifest: { ...validManifest("bad.oversized", "oversized"), padding: "x".repeat(256_000) },
    skillText: "---\nname: oversized\ndescription: Review frontend code for quality, accessibility, and maintainability.\n---\n# Bad\n",
  });
  await assert.rejects(loadLocalRegistry(oversizedRoot), /manifest exceeds 256000 bytes/);

  const deepRoot = path.join(await mkdtemp(path.join(os.tmpdir(), "skillranger-registry-")), "registry");
  let nested: Record<string, unknown> = {};
  for (let depth = 0; depth < 20; depth += 1) nested = { nested };
  await writeSkillPackage(deepRoot, "bad.deep", {
    manifest: { ...validManifest("bad.deep", "deep"), nested },
    skillText: "---\nname: deep\ndescription: Review frontend code for quality, accessibility, and maintainability.\n---\n# Bad\n",
  });
  await assert.rejects(loadLocalRegistry(deepRoot), /manifest exceeds object depth 16/);
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

test("parseSkillFrontmatter accepts CRLF-delimited frontmatter (Windows checkout)", () => {
  const crlf = "---\r\nname: crlf-skill\r\ndescription: Review frontend code for quality, accessibility, and maintainability.\r\n---\r\n# CRLF\r\n";
  const { frontmatter, issues } = parseSkillFrontmatter(crlf);
  assert.deepEqual(issues, []);
  assert.equal(frontmatter?.name, "crlf-skill");
  assert.equal(frontmatter?.description, "Review frontend code for quality, accessibility, and maintainability.");
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

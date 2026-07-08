# Registry And Skills

This document covers skill package metadata, registry design, own-vs-third-party handling, generated skill gates, and data file shapes.

## 5. Skill registry design

Registry entry should separate skill package metadata from install metadata.

Research refinement: registry metadata is not the skill itself. The portable skill is the folder plus `SKILL.md`; the registry entry indexes it, scores it, audits it and maps it to install targets. Target-specific fields belong in compatibility/adapter metadata, not in the portable skill core.

Recommended layered shape:

```json
{
  "manifestVersion": "1.0",
  "skill": {
    "id": "frontend.playwright-debug",
    "name": "playwright-debug",
    "displayName": "Playwright Debug",
    "description": "Debug Playwright E2E failures in web apps.",
    "version": "0.1.0",
    "license": "MIT",
    "maintainer": { "name": "local-curated", "trustTier": "curated" },
    "stackTags": ["frontend", "web-app", "playwright", "testing"],
    "taskTags": ["debugging", "e2e-testing", "qa"]
  },
  "package": {
    "path": "./registry/skills/frontend.playwright-debug",
    "files": ["SKILL.md", "skill.manifest.json"],
    "checksum": "sha256:..."
  },
  "quality": {
    "rubricVersion": "1.0",
    "scores": {
      "usefulness": 0.85,
      "triggerSpecificity": 0.8,
      "progressiveDisclosure": 0.75,
      "safety": 0.95,
      "verifiability": 0.7,
      "maintainability": 0.8,
      "portability": 0.78
    },
    "qualityScore": 0.8,
    "securityScore": 0.94
  },
  "compatibility": {
    "codex": { "level": "native", "scopes": ["repo"], "adapter": "codex-skill" },
    "generic-agent-skills": { "level": "native", "scopes": ["repo"] },
    "claude-code": { "level": "convertible", "requiresAdapter": true },
    "codex-plugin": { "level": "packageable", "requires": [".codex-plugin/plugin.json", "marketplace"] }
  }
}
```

For MVP, keep the existing flat `skill.manifest.json` for simplicity, but treat it as a compatibility-preserving projection of this layered model. Do not add vendor-specific Codex plugin fields directly to the portable core.

Recommended fields:

- `id`
- `name`
- `description`
- `stackTags`
- `taskTags`
- `supportedAgents`
- `source`
- `version`
- `checksum`
- `riskLevel`
- `permissions`
- `scripts`
- `dependencies`
- `qualityScore`
- `securityScore`
- `freshness`
- `evaluation`
- `installTargets`
- `conflictsWith`
- `supersedes`
- `maintainer`
- `license`
- `createdAt`
- `updatedAt`

Additional fields to add after MVP:

- `manifestVersion`
- `quality.rubricVersion`
- `quality.scores.usefulness`
- `quality.scores.triggerSpecificity`
- `quality.scores.progressiveDisclosure`
- `quality.scores.safety`
- `quality.scores.verifiability`
- `quality.scores.maintainability`
- `quality.scores.portability`
- `compatibility.<target>.level`
- `compatibility.<target>.scopes`
- `compatibility.<target>.adapter`
- `compatibility.<target>.requires`

- `evaluation.status`
- `evaluation.lastRunAt`
- `evaluation.benchmarkVersion`
- `evaluation.evidenceUri`
- `evaluation.score`
Example skill entry:

```json
{
  "id": "frontend.next-app-router-review",
  "name": "next-app-router-review",
  "displayName": "Next.js App Router Review",
  "description": "Review Next.js App Router changes for routing, Server/Client Component boundaries, data fetching, caching, Server Actions, metadata, streaming, and framework-specific performance risk.",
  "stackTags": ["frontend", "react", "nextjs", "typescript", "tailwind"],
  "taskTags": ["code-review", "accessibility", "performance", "testing", "ui-quality"],
  "supportedAgents": ["codex", "claude-code", "generic-agent-skills"],
  "source": {
    "type": "curated",
    "registry": "local",
    "path": "./registry/skills/frontend.next-app-router-review"
  },
  "version": "0.1.0",
  "checksum": "sha256:REPLACE_WITH_REAL_HASH",
  "riskLevel": "low",
  "permissions": {
    "filesystem": ["read-project"],
    "network": false,
    "shell": false,
    "writes": []
  },
  "scripts": [],
  "dependencies": [],
  "qualityScore": 0.86,
  "securityScore": 0.93,
  "freshness": {
    "lastReviewedAt": "2026-07-01",
    "targetFrameworkVersions": {
      "nextjs": "14-15",
      "react": "18-19"
    }
  },
  "installTargets": ["repo", "user"],
  "conflictsWith": [],
  "supersedes": [],
  "maintainer": {
    "name": "local-curated",
    "trustTier": "curated"
  },
  "license": "MIT"
}
```

## 11. Own skills vs third-party skills

Use third-party skills for:

- stable public workflows;
- framework best practices;
- Expo/EAS workflows;
- accessibility checks;
- testing/debugging playbooks;
- security review checklists.

Create own skills for:

- team conventions;
- private design system;
- repo-specific launch/run recipes;
- deployment rituals;
- API style guides;
- internal review process;
- domain-specific workflows.

AI/subagents can generate skills, but:

- generated skills are not trusted;
- generated skills may hallucinate commands, dependencies, or unsafe assumptions;
- generated skills must pass audit;
- generated skills must pass eval;
- human review required before publishing to curated registry.

Review/eval pipeline:

1. Validate `SKILL.md` schema.
2. Run static security audit.
3. Run quality lint: description, trigger specificity, scope.
4. Run fixture tasks with and without skill.
5. Compare outcomes.
6. Human approves promotion.
7. Publish to local registry with checksum.

## 12. Skill generation pipeline

Process:

1. User goal.
2. Research and context collection.
3. Draft `SKILL.md`.
4. Create examples.
5. Create tests/checklist.
6. Run audit.
7. Run eval.
8. Human review.
9. Publish to local registry.

Example: user asks "mobile development skills for React Native Expo".

Pipeline output:

```text
drafts/expo-mobile-workflow/
  SKILL.md
  references/
    expo-debugging.md
    eas-build-checklist.md
  examples/
    app-router-task.md
  tests/
    eval-prompts.json
  skill.manifest.json
```

Draft metadata:

```json
{
  "id": "draft.expo-mobile-workflow",
  "riskLevel": "draft-untrusted",
  "trusted": false,
  "source": { "type": "generated" },
  "requiredGates": ["audit", "eval", "human-review"]
}
```

The generated skill should not be installed as trusted. It can be installed only as a draft/local experimental skill after confirmation.

## 17. Data files

### `registry.schema.json`

Validates registry skill entries:

- required fields;
- allowed risk levels;
- supported agents;
- permissions shape;
- source shape.

### `skill.manifest.json`

Lives beside every skill:

```json
{
  "id": "frontend.next-app-router-review",
  "version": "0.1.0",
  "riskLevel": "low",
  "permissions": {
    "filesystem": ["read-project"],
    "network": false,
    "shell": false
  }
}
```

### `skillranger.lock.json`

```json
{
  "schemaVersion": "1.0",
  "installed": [
    {
      "skillId": "frontend.next-app-router-review",
      "version": "0.1.0",
      "checksum": "sha256:...",
      "targetAgent": "codex",
      "scope": "repo",
      "installedPath": ".agents/skills/next-app-router-review",
      "source": {
        "type": "local-registry",
        "path": "./registry/skills/frontend.next-app-router-review"
      },
      "audit": {
        "riskLevel": "low",
        "securityScore": 0.93,
        "findings": []
      }
    }
  ]
}
```

### `skillranger.config.json`

```json
{
  "schemaVersion": "1.0",
  "defaultTargetAgent": "codex",
  "defaultScope": "repo",
  "registries": [
    {
      "name": "local",
      "type": "local",
      "path": "./registry"
    }
  ],
  "security": {
    "maxAutoInstallRisk": "low",
    "requireConfirmationFor": ["medium", "high", "third-party"],
    "allowScripts": false,
    "allowRemoteRegistries": false
  }
}
```

### `adapters.json`

```json
{
  "codex": {
    "repoSkillPath": ".agents/skills",
    "userSkillPath": "~/.agents/skills"
  },
  "claude-code": {
    "repoSkillPath": ".claude/skills",
    "userSkillPath": "~/.claude/skills"
  },
  "generic-agent-skills": {
    "repoSkillPath": ".agents/skills",
    "userSkillPath": "~/.agents/skills"
  }
}
```

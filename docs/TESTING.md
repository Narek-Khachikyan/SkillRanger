# Testing And Evaluation

This document captures fixture strategy, golden tests, security test cases, install tests, registry quality tests, LLM eval ideas, and manual review criteria.

## 18. Testing and evaluation

Testing strategy:

- fixture projects;
- expected project fingerprints;
- expected recommended skills;
- registry-wide validation;
- skill linting;
- frontmatter/manifest consistency;
- security test cases;
- install/uninstall tests;
- lockfile golden files;
- generated skill evals later;
- manual review checklist.

Fixture projects:

- `next-react-ts`: Next.js + React + TypeScript + Tailwind.
- `vite-react-ts`: Vite + React + TypeScript.
- `expo-react-native`: Expo + React Native.
- `backend-node`: Fastify/Nest/Express.
- `monorepo`: packages with mixed frontend/backend.
- `malicious-skill`: skill with dangerous scripts.

Golden tests:

```text
input: fixtures/next-react-ts
expected top recommendations:
1. frontend.next-app-router-review
2. frontend.accessibility-review
3. frontend.tailwind-ui-polish
```

Security test cases:

- invalid manifest shape;
- manifest/frontmatter mismatch;
- folder id/source path mismatch;
- unsupported install target;
- hidden `.env` file in skill package;
- hidden file at registry root such as `.DS_Store`;
- binary file;
- `curl | sh`;
- `sudo`;
- `rm -rf`;
- attempts to read `~/.ssh`;
- remote script download;
- mismatch checksum;
- symlink outside package.
- path traversal in `manifest.name`;
- prompt-injection text inside `references/`;
- dead references or declared scripts missing from package.

Install tests:

- dry-run has no writes;
- apply writes expected files;
- lockfile contains checksum;
- reinstall detects already installed;
- update detects checksum/version changes.
- block-risk skill cannot write files or lockfile entries;
- target agent compatibility is enforced before writes;
- user scope either works or is rejected consistently before path planning.

Registry quality tests:

- all curated skills pass manifest schema validation;
- all curated skills pass `lint:skills`;
- all curated skills pass low-risk audit;
- `qualityScore` is derived from rubric fields once rubric metadata is added;
- `securityScore` is adjusted by audit findings, not manually trusted;
- golden recommendation order remains stable for fixture projects;
- unsupported agents are filtered or clearly marked as incompatible.

LLM eval for generated skills:

- task success with skill vs without skill;
- safety violations;
- trigger precision;
- instruction clarity;
- hallucinated commands.

Manual review checklist:

- Is the skill single-purpose?
- Is the description trigger-specific?
- Does it avoid unnecessary scripts?
- Are commands safe and explicit?
- Does it fit supported agent surfaces?
- Are permissions minimal?
- Does it have examples/tests?
- Does audit pass?

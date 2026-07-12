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

## Release and bilingual routing gates

Run focused and frozen routing checks before the full gate:

```bash
node --test tests/frontend-eval.test.ts
npm run eval:frontend -- --run-routing --project fixtures/next-react-ts --locale all --json
npm run eval:frontend:ru
npm run check
npm test
npm run build
npm run release:check
```

`eval:frontend:ru` must select Cyrillic and mixed Cyrillic/Latin prompts, exclude English-only prompts, pass routing, and cover at least one evaluated prompt for every frontend-owned canonical skill. `--locale en` must contain Latin text and no Cyrillic. `--locale all` must preserve all 157 frozen routing prompts. Invalid locale values must exit non-zero with `--locale must be one of: en, ru, all.`

External model comparison is analytical rather than a local release blocker. The exact Russian-only filter is `ru-visual-direction-reference,ru-tailwind-responsive-execution,ru-frontend-release-audit`; it is not a declared promotion slice. For promotion-ready variance, run the complete real `visual-direction`, `tailwind-execution`, and `design-to-code` slices separately with `fixtures/next-react-ts`, the `opencode` target, identical installed versions/checksums, all three baselines, and at least three repetitions per pinned model. Keep GLM and DeepSeek under separate exact model labels and output directories, then grade evidence and run `--verify-task-evidence ... --summarize-variance` for each complete slice.

## Lifecycle acceptance checks

- CLI: start an OpenCode-targeted frontend run, confirm raw intent is absent by default, record every selected skill read, resolve required clarification or its bounded fallback, begin immediately before implementation, complete with artifacts, and verify with hard-gate evidence.
- MCP: replay the equivalent `start_skill_run` through `verify_skill_run` event sequence, including `begin_skill_run_execution`; compare normalized artifacts and the canonical verification digest with CLI.
- Guarantee: assert that completion without evidence never reaches `verified`; external agents may bypass SkillRanger but cannot receive a SkillRanger `verified` outcome without evidence.
- Persistence: confirm artifacts live under `.skillranger/runs/`; corrupt JSON returns `run-integrity` without replacement, after which recovery uses a trusted copy or a new run.
- Managed context: run `skillranger setup` twice and confirm exactly one managed `AGENTS.md` block while preserving user text; verify `--no-agent-context` leaves agent context unmanaged and malformed markers fail safely.

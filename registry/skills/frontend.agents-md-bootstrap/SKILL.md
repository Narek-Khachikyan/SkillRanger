---
name: agents-md-bootstrap
description: Create or improve frontend AGENTS.md guidance with project commands, architecture notes, coding conventions, validation steps, and agent safety boundaries.
---

# Frontend AGENTS.md Bootstrap

Use this skill when creating or improving repo-local `AGENTS.md` guidance for a frontend project so coding agents understand commands, architecture, conventions, validation steps, and safety boundaries. Do not use it for generic README writing, public product documentation, or agent rules that conflict with the repository's actual scripts and structure.

## Decision Rules

- Ground every instruction in files that exist in the repository.
- Prefer concise, durable guidance over long policy text that will drift quickly.
- Include commands only when they are discoverable from project config or documentation.
- Keep agent safety boundaries explicit: do not invent secrets, deployment actions, or destructive maintenance rituals.

## Workflow

1. Inspect package scripts, test config, build config, framework files, folder structure, and existing docs.
2. Identify the project stack, source layout, common commands, test strategy, style conventions, and generated artifacts to avoid editing.
3. Draft guidance sections for overview, setup assumptions, commands, coding conventions, validation, and agent-specific cautions.
4. Add repo-specific notes only when supported by evidence from files or existing docs.
5. Keep the document short enough that an agent can use it as active context.
6. Flag any missing information the maintainer should confirm instead of guessing.

## References

- No packaged references are required for this MVP skill.
- When available in the project, inspect `package.json`, README files, framework config, test config, CI workflow, and existing agent or editor rules.

## Validation

- Every command in the output should match a real script, config, or documented workflow.
- The guidance should avoid credentials, private deployment steps, and machine-specific absolute paths.
- If the project already has `AGENTS.md`, proposed edits should preserve valid existing conventions and remove only stale or contradictory text with evidence.

## Output Contract

- Provide the proposed `AGENTS.md` structure or patch summary.
- Cite the project files that justify commands and conventions.
- List validation commands run or recommended.
- Call out assumptions, missing maintainer decisions, and any safety-sensitive guidance.

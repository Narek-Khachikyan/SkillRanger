# Awesome-list PRs

Draft PR descriptions for three awesome lists. Each entry below records the
exact `owner/repo`, the section it targets, and the format that list uses.
Create the PRs only after the SkillRanger launch PR is merged, so links and
the README are live.

## 1. hesreallyhim/awesome-claude-code

- **Repo:** `hesreallyhim/awesome-claude-code`
- **Target section:** `## Skills`
- **Format (verified 2026-08-12):** bullet per entry —
  `- [Name](url) by [author](author-url) - description`. Entries in the
  Skills section are one line; no table.
- **Proposed entry:**

```markdown
- [SkillRanger](https://github.com/Narek-Khachikyan/SkillRanger) by [Narek Khachikyan](https://github.com/Narek-Khachikyan) - Scan your repo, audit, and install Claude Code skills with a static security pass, an explicit write plan, and checksum-pinned lockfile.
```

- **PR body:** "Adds SkillRanger under Skills: an installer that audits skills before install, supports Claude Code among five agent targets, and pins installed skills in a checksummed lockfile."

## 2. composio-community/awesome-codex-skills

- **Repo:** `composio-community/awesome-codex-skills`
- **Target section:** `## Skills` → `### Development & Code Tools` (or its
  closest category at PR time — the list reorganizes frequently)
- **Format (verified 2026-08-12):** bullet per entry —
  `- [name](url) - description`. Entries that ship an installer include a
  trailing `Install: <command>` clause.
- **Proposed entry:**

```markdown
- [SkillRanger](https://github.com/Narek-Khachikyan/SkillRanger) - Scan your repo and install Codex skills from an audited, checksum-pinned bundle — audit summary and write plan shown before install. Install: `npx -y skillranger@latest setup`
```

- **PR body:** "Adds SkillRanger under Development & Code Tools: it manages
  Codex skills (and four other agent targets) with pre-install static audit
  and lockfile integrity tracking."

## 3. punkpeye/awesome-mcp-servers

- **Repo:** `punkpeye/awesome-mcp-servers`
- **Target section:** the main server list (alphabetical bullets).
- **Format (verified 2026-08-12):** bullet per entry —
  `- [owner/repo](url) [![<name> MCP server](glama.ai badge)](glama.ai/servers/...) <emoji tags> - description`.
  Emoji tags mark runtime/language (e.g. `🐍` Python, `🏠` local). SkillRanger
  is TypeScript and stdio-local: use `🏠` and no language tag.
- **Proposed entry:**

```markdown
- [Narek-Khachikyan/SkillRanger](https://github.com/Narek-Khachikyan/SkillRanger) 🏠 - MCP server that scans a project, recommends and audits bundled agent skills, accepts a host model's skill proposal for validation, and serves the installed instructions.
```

- **PR body:** "Adds SkillRanger: a local-first MCP server for discovering,
  auditing, and installing agent skills with a checksummed lockfile."

## Blockers and notes

- None of the three lists has an automated contribution format beyond the
  README conventions above; all three are PR-driven. Re-verify each README
  format on the day of the PR — the Codex list in particular reorganizes
  its sections.
- If any list rejects installers/tools in favor of skills-only content,
  do not argue: drop the entry and record the outcome here.
- Do not submit to lists that cannot be identified unambiguously; this file
  only covers the three confirmed above.

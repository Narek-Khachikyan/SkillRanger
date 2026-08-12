# SkillRanger compatible badge

A badge for skill authors and tool maintainers whose packages work with
SkillRanger (for example: your skill installs cleanly via `skillranger setup`
and passes `skillranger audit`).

## Badge

Source: [`badge.svg`](badge.svg).

```markdown
[![SkillRanger compatible](https://raw.githubusercontent.com/Narek-Khachikyan/SkillRanger/main/docs/badge.svg)](https://github.com/Narek-Khachikyan/SkillRanger)
```

## Requirements to use it

- Your skill package is installable by SkillRanger (a `SKILL.md` with
  `name`/`description` frontmatter, no scripts or binaries).
- `skillranger audit <your-skill-id>` reports `risk low` with no findings —
  or your package ships in your own registry that SkillRanger can address.

Only claim compatibility you can reproduce: run the audit locally before
adding the badge. SkillRanger does not certify third-party badges; the badge
states that your package follows the same instruction-only, auditable shape.

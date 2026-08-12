# Show HN post

## Title

Primary (66 chars, no hype words, no emoji):

> SkillRanger: an audited, versioned installer for AI agent skills

Alternatives:

- Show HN: SkillRanger — scan, audit, and install AI agent skills (60 chars)
- SkillRanger: skills for AI agents that are audited before install (64 chars)

## First comment

> I built SkillRanger because the scariest part of the agent ecosystem is the
> most boring one: agent skills are just instructions. A Markdown file your
> agent reads and then acts on — inside your repository, with your credentials.
> Most install flows treat that as a non-event: no plan, no audit, no checksum.
>
> The tool scans your repo, detects the stack, recommends a small skill set,
> prints a static security audit (risk level + findings) and the exact write
> plan, and only then installs — pinned in `skillranger.lock.json` with
> SHA-256 checksums. Nothing executes during install; the skills are
> instruction files the host agent reads. Everything runs locally: no API
> keys, no telemetry, no network calls.
>
> What it deliberately does not do:
>
> - It does not bundle remote registries or auto-install third-party skills —
>   today the registry is a bundled, frontend-only set of 18 skills.
> - It does not run skill scripts, sandbox anything, or invoke a model itself.
> - It is not a replacement for reviewing what your agent does — it makes the
>   review step (of the skill, not the output) cheap and visible.
>
> Feedback I'm most interested in: is "audit before install" the right
> default, or do you prefer the trust model of curated marketplaces? What
> non-frontend domains would you want bundled next? And anything that makes
> the `npx -y skillranger@latest setup` first-run feel untrustworthy —
> that's the experience I'm trying to fix.
>
> Source: github.com/Narek-Khachikyan/SkillRanger (MIT, TypeScript, zero
> runtime dependencies).

## Pre-publish checklist

- [ ] README renders correctly (GIF, badges, quick start).
- [ ] `npx -y skillranger@latest setup` run on a fresh project works.
- [ ] Open the GitHub repo page in a logged-out session: description, social preview image, README.
- [ ] Reply to every comment for the first hours; keep the thread factual, no hype.

# r/LocalLLaMA post

Draft for a technical, problem-first post. No marketing tone, no emoji in the title.

## Title

> Agent skills are untrusted instructions — I built a local installer that audits them before install

## Body

Agent skills are the new supply chain: a folder with a `SKILL.md` that your
coding agent loads into its context and then acts on, inside your repo, with
your credentials. Skills have become the de facto distribution unit for
agent behavior — but most install flows skip the only step that matters:
reading what you are about to trust.

The install path today is usually one of: copy a folder from a GitHub repo,
`git clone` a collection into your agent's skills directory, or install a
curated list. None of them version the content, checksum it, tell you what
will be written, or run a static pass for the obvious injection patterns
before the skill lands in the context your agent trusts most.

What I built (TypeScript, MIT, zero runtime dependencies):

- `npx -y skillranger@latest setup` inside a project scans the repo, detects
  the stack, and recommends a small compatible skill set — not a dump of
  everything available.
- Before anything is written it prints an audit summary per skill (computed
  risk level + finding count) and the exact write plan.
- After confirmation it installs instruction files (nothing executes),
  writes a marker-delimited block into `AGENTS.md`, and pins everything in
  `skillranger.lock.json` with SHA-256 checksums. `skillranger verify`
  re-checks them.
- Everything is local: no API keys, no telemetry, no network calls in the
  scan/recommend/audit path. The bundled registry ships with the package —
  it is frontend-focused today (18 skills), which is the honest current
  limitation.
- There is also a stdio MCP server for hosts: a host model can propose a
  skill set for a task, and the server validates that proposal against the
  catalog, audit, and compatibility rules instead of trusting it.

The threat model treats third-party skills as untrusted by default: blocked
patterns include `curl | sh`, credential exfiltration instructions, hidden
credential files, obfuscated execution, and destructive commands. Nothing
in the pipeline executes skill scripts.

This is an MVP in an ecosystem that is moving fast (Claude Code skills,
Codex skills, MCP). I'd rather publish the honest version now — the
frontend-only registry and no remote marketplace — than pretend otherwise.
If this direction is useful, the next questions are which domains to bundle
next and whether the audit rule set should be configurable per project.

Repo: https://github.com/Narek-Khachikyan/SkillRanger

## Posting notes

- Mention local-first explicitly in the post (commenter expectations).
- Do not claim benchmarks or adoption numbers; the star count is low and that is fine.
- The demo GIF lives in the README; linking the repo is enough.

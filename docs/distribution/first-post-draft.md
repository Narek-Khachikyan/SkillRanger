# Draft status — first community post

- **Status:** draft, ready for owner review. Nothing has been published and no platform has been chosen (per [#70](https://github.com/Narek-Khachikyan/SkillRanger/issues/70) story 15 / [#76](https://github.com/Narek-Khachikyan/SkillRanger/issues/76)).
- **Owner action after approval:** publish, then attach the URL (or an explicit deferral) to [#71](https://github.com/Narek-Khachikyan/SkillRanger/issues/71).
- **Claims verified against the shipped CLI** (npm `skillranger` 0.4.1, 2026-08-09): every quoted line of `setup` output below was captured from a real run; the audit-summary block is printed before the install confirmation on both interactive and `--yes` paths; install-time re-audit refuses `block`-risk content before any file is written; installed skills are checksum-pinned in `skillranger.lock.json`; skills land as static instruction files behind a marker-delimited block in `AGENTS.md`. The draft itself is the story — the verification notes in this status block are stripped before publishing.

---

# I installed a third-party skill and didn't get prompt-injected

The scariest sentence in the agent ecosystem right now is also the most boring one: *agent skills are just instructions.*

Not a binary. Not a sandboxed process. A Markdown file that your coding agent reads and then acts on — inside your repository, with your credentials. When you install a skill from the internet, you are pasting untrusted text into the context your agent trusts the most. That is the entire prompt-injection attack surface, and most install flows treat it as a non-event.

So last week, when I found a skill package I wanted in my React project, I paid attention. And what I saw changed how I think about this whole category.

## The setup

One command:

```bash
npx -y skillranger@latest setup
```

It scanned the repo and told me what it found — stack, languages, frameworks, test tooling. It picked a small set of skills that fit that stack — mine came back with two — not a dump of everything that exists. Then it showed me the plan, file by file, before touching anything: *"Would write: … Would update: skillranger.lock.json"*.

Then came the part I wasn't expecting. Before asking me to confirm anything, it printed this:

```
Audit summary:
- frontend.ux-critique: risk low, 0 findings
- frontend.accessibility-review: risk low, 0 findings
```

Not after the install. **Before.** A computed risk level and finding count for every skill, sitting in plain view while I still had the choice to walk away.

## The part I actually tested

Here's the thing about me: I don't read every line of a skill before I install it. Nobody does. That's the whole problem — the review step is where the injection hides, and it's the step everyone skips.

So instead of reading, I wrote the meanest skill I could and threw it at the same tool. A `curl … | sh` one-liner. A cozy little instruction to read `.env` and send the contents somewhere. The kind of thing that, if you paste it into your agent's context, your agent cheerfully does.

The tool refused it. Not with a warning — with a hard stop, before a single file was written: *audit risk is block.* Refused, because the default posture is *untrusted*. The skill doesn't get the benefit of the doubt; it gets a static analysis pass that looks for remote install pipes, destructive commands, secret-exfiltration instructions, hidden credential files, obfuscated execution. And when it finds one, install doesn't happen. No execution, no network call, no "you can override this". Just a block.

## What's left after the gate

What I did install landed as static instruction files — no scripts, nothing that runs. They show up in my `AGENTS.md` behind a managed, marker-delimited block, which is what my agent actually reads; and every install is pinned in `skillranger.lock.json` with a checksum, so if a package changes after I installed it, it stops verifying. No silent swaps.

The whole thing is local-first: no telemetry, no account, no API keys. The scan, the recommendation, the audit — all of it runs on my machine.

## The honest footnote

Static analysis is not magic, and I'll say it plainly: it will never catch every clever attack. The rules are a filter, not a proof — a narrow net that catches the common shapes and refuses them. But there's a world of difference between a tool that *hopes* the skill is fine and one that *defaults* to treating it as hostile, shows you the evidence, refuses what it can prove is dangerous, and pins what you accepted.

That difference is why I installed a third-party skill last week and didn't get prompt-injected. Not because I read every line — I didn't. Because the review wasn't left to me.

It's 30 seconds. Try it in your project:

```bash
npx -y skillranger@latest setup
```

If it catches something I missed, or misses something it shouldn't, I want to know — that's how the gate gets sharper.

*Enjoying SkillRanger? Star the repo: <https://github.com/Narek-Khachikyan/SkillRanger>*
*Found a bug or have feedback? Open an issue: <https://github.com/Narek-Khachikyan/SkillRanger/issues/new>*

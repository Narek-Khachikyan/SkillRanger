# Security

This document is the expanded security model. The shorter MVP threat-model note remains in docs/threat-model.md for quick reference.

## Current MVP Threat Model

SkillRanger treats third-party skills as untrusted by default.

MVP controls:

- Install from the local registry only.
- Compute SHA-256 over skill package files.
- Do not execute scripts during install.
- Show exact write plan before apply.
- Write repo-scope Codex/generic skills under `.agents/skills`.
- Block installs when audit risk is `block`.

Blocked patterns include symlinks, `.env`, `.ssh`, credential access, destructive shell commands, remote install pipes, and obfuscated execution.

High-risk patterns include binary files, privilege escalation, persistence mechanisms, and prompt-injection references that tell the agent to ignore instructions or reveal secrets.

Medium-risk patterns include declared scripts, declared network access, and package/dependency install instructions. The MVP installer records these findings but never executes skill scripts.

## 10. Security model

Security must be central, not an afterthought.

Principles:

- Third-party skills are untrusted by default.
- Installation requires confirmation.
- No auto-install of third-party skills.
- No script execution during install.
- Prefer repo-local install for project-specific skills.
- Prefer instruction-only skills in MVP.
- All installed skills should be pinned and locked.
- The user must see what changes before apply.

### Required controls

Runtime validation:

- validate every `skill.manifest.json` before recommendation, audit or install;
- schema must cover nested `source`, `permissions`, `scripts`, `dependencies`, `installTargets`, `maintainer`, `quality`, and `compatibility`;
- reject unknown or unsupported install scopes before planning writes;
- verify `id`, folder name, `source.path`, frontmatter `name`, and manifest `name` consistency;
- fail closed on invalid JSON or missing required files.

Pinned versions:

- install exact version;
- no floating `main` as trusted;
- remote git source should pin commit SHA.

Checksum:

- compute SHA-256 over canonical skill package;
- lock checksum;
- verify before install and update.

Allowlist / denylist:

- allow trusted registries;
- deny known malicious sources;
- allow max risk level by policy.

Static analysis:

- parse `SKILL.md` frontmatter;
- compare `SKILL.md` frontmatter with registry manifest;
- scan scripts;
- inspect references/assets;
- detect hidden files;
- detect binaries;
- detect symlinks;
- compare metadata permissions to content.

Package-zone policy:

- `SKILL.md`: must be text, must include `name` and `description`, should include workflow, boundaries and output contract.
- `references/`: text resources only by default; scan for prompt injection, secret exfiltration instructions, hidden override language and dead links.
- `scripts/`: high/medium risk by default; never execute during install; require explicit declaration and review.
- `assets/`: allow small non-executable assets only; binary assets are high risk unless provenance is verified.
- `agents/`: target-specific metadata such as `agents/openai.yaml`; validate separately from portable core.

Secret scanning:

- flag API keys, tokens, private keys, `.env` contents;
- do not print secrets in full;
- block skills that ask agents to read or exfiltrate secrets.

Suspicious command detection:

- `curl | sh`
- `wget | sh`
- `sudo`
- `rm -rf`
- `chmod +x` plus remote fetch
- writes to `~/.ssh`, `~/.codex`, `~/.claude`, shell profiles
- encoded payloads, base64 decode and execute
- background persistence: launch agents, cron, systemd, login items

Remote fetch detection:

- scripts that call `curl`, `wget`, `git clone`, `npm install`, `pip install`
- remote scripts are medium/high risk even if benign.

Hidden files detection:

- `.env`
- `.ssh`
- `.npmrc`
- `.pypirc`
- hidden executable files
- hidden nested folders.

Binary detection:

- binaries should be high-risk unless signed/provenance verified.

Symlink policy:

- MVP should block symlinks inside skill packages.
- Later, allow only internal symlinks after `realpath` containment checks.
- Audit must never follow a symlink outside the skill package root.

Install path containment:

- normalize skill install slug with a strict allowlist;
- reject empty slug, `.`, `..`, slashes and path traversal after normalization;
- resolve target path and verify it is inside the allowed install root before writes;
- do the same check for every lockfile path and generated file path.

Script sandboxing:

- MVP should not execute skill scripts.
- Later, scripts run only with explicit user confirmation and restricted sandbox.

Permission model:

```json
{
  "filesystem": "none | read-project | write-skill-dir | write-project | write-home",
  "network": "none | registry-only | arbitrary",
  "shell": "none | read-only-commands | project-commands | arbitrary",
  "secrets": "none | named-env-vars",
  "mcp": "none | bundled-local | remote"
}
```

Lockfile:

- records source, version, checksum, audit result, installed path;
- supports reproducibility and review.

Provenance:

- curated local;
- trusted team registry;
- official marketplace;
- community registry;
- arbitrary GitHub URL.

Signed skills in future:

- registry snapshot signatures;
- package signatures;
- publisher identity;
- transparency log.

### Risk levels

Low-risk:

- instruction-only;
- no scripts;
- no network;
- no hidden files;
- no binary files;
- clear metadata;
- curated source;
- writes only to skill install directory.

Medium-risk:

- scripts present but not auto-run;
- reads project files;
- suggests test/build commands;
- has dependencies but pinned;
- no secrets or arbitrary network.

High-risk:

- MCP server bundle;
- hooks;
- binaries;
- shell scripts;
- network calls;
- writes outside skill directory;
- modifies agent config;
- requires auth or tokens.

Block / critical:

- credential exfiltration;
- obfuscated execution;
- destructive commands;
- persistence mechanisms;
- privilege escalation;
- unsigned binary from unknown source;
- mismatched checksum;
- installation outside allowed root.

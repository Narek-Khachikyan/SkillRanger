# Threat Model

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

# Workflow Runtime

SkillRanger v1 is host-managed. Codex, OpenCode, Claude Code, or another agent host invokes the model, grants tools, and applies changes. SkillRanger provides deterministic contracts and checks.

The design flow is:

```text
scan project
-> create brief
-> validate brief
-> recommend recipe
-> create and validate direction
-> host implements
-> host captures browser observations
-> SkillRanger verifies
-> SkillRanger emits bounded repair request
-> host repairs
-> SkillRanger verifies again
-> compile DESIGN.md
```

No Core command invokes a model, stores provider credentials, or silently edits application files. This keeps model comparisons portable and makes tool permissions visible in the host.

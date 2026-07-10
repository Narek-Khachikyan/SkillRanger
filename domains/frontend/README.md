# Frontend Domain Pack

The frontend pack is SkillRanger's reference domain implementation. It owns frontend routing policy, structured design artifacts, product recipes, deterministic validation rules, workflows, and frontend eval slices. Core imports only the generic domain interfaces.

The host remains responsible for model execution and project edits. SkillRanger validates artifacts and browser observations, computes outcomes, and emits bounded repair requests. It never silently edits a project through this runtime.

## Structured Design Flow

1. Create `.design/brief.json` from observed project evidence.
2. Run `skillranger design:validate --brief .design/brief.json`.
3. Run `skillranger design:recommend-recipe --brief .design/brief.json`.
4. Create `.design/direction.json` using the selected recipe.
5. Implement the direction through the selected skill.
6. Record browser observations for required viewports and states. Use `design:observe` with a project-specific browser adapter or provide the same JSON contract through the host.
7. Run `skillranger design:verify` and repair hard findings.
8. Compile `.design/DESIGN.md` from the canonical JSON artifacts.

`verified` requires browser and screenshot capabilities, all required viewport/state evidence, and no hard findings. Otherwise the result remains `implemented-unverified`, `failed`, or `blocked`.

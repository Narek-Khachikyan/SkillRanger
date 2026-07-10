# Repair Loop

Repair is bounded by the workflow, with a maximum of five iterations at runtime and three in bundled frontend workflows. SkillRanger receives a verification report and returns prioritized, normalized repair instructions. It does not apply edits itself.

The loop stops when hard gates pass, the result is blocked, or the iteration limit is reached. Repair instructions explicitly preserve approved design direction and unrelated behavior. Hosts should run each benchmark arm in an isolated project copy to prevent cross-run contamination.

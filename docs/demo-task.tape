# docs/demo-task.tape
#
# Terminal demo for the README (renders docs/demo-task.gif).
# Regenerate with: pnpm demo:task
#
# Requires charmbracelet/vhs (https://github.com/charmbracelet/vhs):
#   brew install vhs          # macOS
#   go install github.com/charmbracelet/vhs@latest
# VHS also needs ttyd and ffmpeg on PATH; the brew formula installs them.
#
# The tape builds nothing itself: `pnpm demo:task` runs `pnpm build` first,
# then this tape drives the locally compiled dist/cli/index.js against an
# isolated copy of fixtures/next-react-ts. Nothing here touches the network,
# npm, or a published @latest release.

Output "docs/demo-task.gif"
Set Width 1200
Set Height 1400
Set FontSize 16
Set Theme "PaleNightHC"
Set Padding 24
Set Framerate 15
Set TypingSpeed 75ms

# Prepare an isolated copy of the fixture and a local `skillranger` on PATH;
# all of this is invisible.
Hide
Type "rm -rf /tmp/skillranger-demo /tmp/skillranger-bin"
Enter
Type "cp -r fixtures/next-react-ts /tmp/skillranger-demo"
Enter
Type "mkdir -p /tmp/skillranger-bin"
Enter
Type `ln -sf "$PWD/dist/cli/index.js" /tmp/skillranger-bin/skillranger`
Enter
Type "export PATH=/tmp/skillranger-bin:$PATH"
Enter
Type "clear"
Enter
Show

# Describe what you want to build; SkillRanger routes it to the skills it needs.
Type "cd /tmp/skillranger-demo"
Enter
Type `skillranger task . --intent "Create a landing page for my SaaS product" --target opencode --explain`
Enter

Sleep 5s

# Clean up the temporary copies; invisible.
Hide
Type "rm -rf /tmp/skillranger-demo /tmp/skillranger-bin"
Enter
Type "clear"
Enter
Show

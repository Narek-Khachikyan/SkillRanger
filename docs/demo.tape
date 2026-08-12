# docs/demo.tape
#
# Terminal demo for the README (renders docs/demo.gif).
# Regenerate with: pnpm demo
#
# Requires charmbracelet/vhs (https://github.com/charmbracelet/vhs):
#   brew install vhs          # macOS
#   go install github.com/charmbracelet/vhs@latest
# VHS also needs ttyd and ffmpeg on PATH; the brew formula installs them.
#
# The tape builds nothing itself: `pnpm demo` runs `pnpm build` first, then
# this tape drives the locally compiled dist/cli/index.js against an isolated
# copy of fixtures/next-react-ts. Nothing here touches the network, npm, or
# a published @latest release.

Output "docs/demo.gif"
Set Width 1200
Set Height 2200
Set FontSize 16
Set Theme "PaleNightHC"
Set Padding 24
Set Framerate 30
Set TypingSpeed 75ms

# Prepare an isolated copy of the fixture; all of this is invisible.
Hide
Type "rm -rf /tmp/skillranger-demo"
Enter
Type "cp -r fixtures/next-react-ts /tmp/skillranger-demo"
Enter
Type "clear"
Enter
Show

# Run the locally built CLI on the temporary copy.
Type `node dist/cli/index.js setup /tmp/skillranger-demo --target codex --intent "Improve the design and polish of this React app" --scope repo --copy`
Enter

# The skill selection screen shows the pre-selected set; Enter confirms it.
Wait+Screen /Recommended skills:/
Sleep 3s
Enter

# The audit summary and install plan are shown; confirm with y.
Wait+Line /Install selected skills into this project/
Sleep 3s
Type "y"
Enter

Sleep 8s

# Clean up the temporary copy; invisible.
Hide
Type "rm -rf /tmp/skillranger-demo"
Enter
Type "clear"
Enter
Show

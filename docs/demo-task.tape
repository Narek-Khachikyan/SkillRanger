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
# This tape is a lightweight illustration, not a real run: it shows a prompt
# ending in @skillranger and the skills the MCP router would select for it.
# A mock `opencode` REPL on PATH prints the canned selection; nothing here
# touches the network, npm, or a published @latest release.
#
# The committed GIF is smaller than the raw VHS output: it is post-processed
# at display size (scale 640, 10 fps, 64-color palette) with the same ffmpeg
# pipeline documented in docs/demo.tape.

Output "docs/demo-task.gif"
Set Width 960
Set Height 700
Set FontSize 16
Set Theme "PaleNightHC"
Set Padding 24
Set Framerate 15
Set TypingSpeed 60ms

# Put a mock agent REPL on PATH; all of this is invisible.
Hide
Type "rm -rf /tmp/skillranger-bin"
Enter
Type "mkdir -p /tmp/skillranger-bin"
Enter
Type `printf '#!/usr/bin/env bash\nread -r prompt\nsleep 1\necho ""\necho "SkillRanger (MCP) selected skills for this task:"\necho "  primary       frontend.visual-design-polish"\necho "  companion     frontend.tailwind-ui-polish"\necho "  companion     frontend.react-component-design"\necho "  verification  frontend.testing-strategy"\n' > /tmp/skillranger-bin/opencode && chmod +x /tmp/skillranger-bin/opencode`
Enter
Type "export PATH=/tmp/skillranger-bin:$PATH"
Enter
Type "clear"
Enter
Show

# Describe what you want to build; @skillranger makes the router pick the skills.
Type "opencode"
Enter
Sleep 1s
Type "Create a landing page for my SaaS product @skillranger"
Enter

Sleep 5s

# Clean up; invisible.
Hide
Type "rm -rf /tmp/skillranger-bin"
Enter
Type "clear"
Enter
Show

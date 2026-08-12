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
#
# The committed GIF is smaller than the raw VHS output: it is post-processed
# at display size (scale 720, 10 fps, 64-color palette) with
#   ffmpeg -i demo.gif -vf "fps=10,scale=720:-1:flags=lanczos,palettegen=max_colors=64:stats_mode=full" /tmp/pal.png
#   ffmpeg -i demo.gif -i /tmp/pal.png -lavfi "fps=10,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=none" /tmp/demo-opt.gif
#   gifsicle -O3 /tmp/demo-opt.gif -o docs/demo.gif

Output "docs/demo.gif"
Set Width 1200
Set Height 2200
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

# A normal person just runs setup and completes the prompts.
Type "cd /tmp/skillranger-demo"
Enter
Type "skillranger setup"
Enter

# Install for which agents? Enter accepts the detected set.
Wait+Screen /Install for which agents/
Sleep 2s
Enter

# Scope and install mode prompts; Enter picks the project-safe defaults.
Wait+Screen /Install globally for your user account/
Sleep 1s
Enter
Wait+Screen /Use symlinks instead of copies/
Sleep 1s
Enter

# The skill selection screen shows the pre-selected set; Enter confirms it.
Wait+Screen /Recommended skills:/
Sleep 2s
Enter

# The install plan and audit summary are shown; confirm with y.
Wait+Line /Install selected skills into this project/
Sleep 2s
Type "y"
Enter

Sleep 5s

# Clean up the temporary copies; invisible.
Hide
Type "rm -rf /tmp/skillranger-demo /tmp/skillranger-bin"
Enter
Type "clear"
Enter
Show

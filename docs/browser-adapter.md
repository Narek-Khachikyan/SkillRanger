# Browser Adapter

`skillranger design:observe` executes a project or host supplied browser adapter once for every required viewport and state. SkillRanger invokes it with `spawn` and `shell: false`.

Available placeholders:

- `{{url}}`
- `{{route}}`
- `{{width}}`
- `{{height}}`
- `{{state}}`
- `{{screenshotPath}}`

The adapter writes one JSON object to stdout:

```json
{
  "horizontalOverflow": false,
  "clippedControls": [],
  "unreachableActions": [],
  "stickyOverlaps": [],
  "consoleErrors": [],
  "keyboardTraps": [],
  "invisibleFocus": [],
  "criticalAxeViolations": [],
  "reducedMotionVerified": true,
  "screenshotPath": "/absolute/path/to/screenshot.png"
}
```

The host adapter owns state setup. For example, `loading`, `empty`, and `error` may require route interception, fixture data, query parameters, or application test hooks. The adapter must fail rather than report an unrendered state as verified.

Example:

```bash
skillranger design:observe \
  --brief .design/brief.json \
  --base-url http://127.0.0.1:3000 \
  --route /skills \
  --command 'node scripts/skillranger-browser-adapter.mjs "{{url}}" "{{width}}" "{{height}}" "{{state}}" "{{screenshotPath}}"' \
  --output .design/observations.json
```

Browser engines, axe integration, focus checks, state setup, and screenshot capture can use the project's existing Playwright installation. SkillRanger deliberately does not install or execute a hidden browser dependency.

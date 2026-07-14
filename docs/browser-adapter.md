# Browser Adapter

`skillranger design:observe` and UI evidence capture execute a project- or host-supplied browser adapter once for every required viewport and state. SkillRanger invokes the command with Node.js `spawn`, `shell: false`, contained output paths, and a per-capture timeout. The adapter must write exactly one JSON object to stdout and create the requested non-empty screenshot.

Available placeholders:

- `{{url}}`
- `{{route}}`
- `{{width}}`
- `{{height}}`
- `{{state}}`
- `{{screenshotPath}}`

## Payload contract

Every adapter response retains these required legacy fields:

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
  "reducedMotionVerified": true
}
```

Extended UI evidence capture also requires:

```json
{
  "stateRendered": true,
  "overlaps": [],
  "focusOrderViolations": [],
  "contrastViolations": [
    { "locator": "#muted", "ratio": 4.8, "largeText": false }
  ],
  "mechanicalSnapshot": {
    "spacingContexts": [{ "id": "toolbar", "locators": ["#save"], "valuesPx": [8, 16] }],
    "colors": [{ "locator": "#status", "value": "#12805c", "role": "success", "occurrences": 2 }],
    "radii": [{ "locator": "#panel", "valuePx": 8, "isPillOrCircle": false }],
    "shadows": [{ "locator": "#panel", "value": "none", "isNone": true }],
    "cards": [{ "locator": ".run", "depth": 1, "repeatedCount": 3, "semanticRole": "item" }],
    "typography": [{ "locator": "h1", "role": "h1", "fontSizePx": 24, "fontWeight": 600 }],
    "textBlocks": [{ "locator": "article p", "measureCh": 68 }],
    "touchTargets": [{ "locator": "button", "widthPx": 44, "heightPx": 44, "interactive": true }]
  }
}
```

`semanticRole` is one of `generic`, `group`, `tool`, or `item`. Typography `role` is one of `h1`, `h2`, `h3`, `body`, or `meta`. Contrast entries provide a locator, measured ratio, and whether the text qualifies as large.

The adapter must exercise sequential `Tab` and `Shift+Tab` navigation, plus `Escape` behavior for dismissible or modal UI, to populate keyboard, focus-order, reachability, and visible-focus results. It must emulate the `prefers-reduced-motion: reduce` media feature and verify the resulting behavior before setting `reducedMotionVerified: true`.

The host adapter owns state setup. For example, `loading`, `empty`, and `error` may require route interception, fixture data, query parameters, or application test hooks. It must fail rather than report an unrendered state as verified. Browser engines, axe integration, focus checks, state setup, and screenshot capture can use the project's existing Playwright installation; SkillRanger does not install or execute a hidden browser dependency.

Example:

```bash
skillranger design:observe \
  --brief .design/brief.json \
  --base-url http://127.0.0.1:3000 \
  --route /skills \
  --command 'node scripts/skillranger-browser-adapter.mjs "{{url}}" "{{width}}" "{{height}}" "{{state}}" "{{screenshotPath}}"' \
  --output .design/observations.json
```

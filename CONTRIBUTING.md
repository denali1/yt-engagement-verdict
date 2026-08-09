# Contributing to YT Engagement Verdict

## The most common contribution: fixing broken selectors

YouTube silently changes its DOM markup without any notice. When this happens, the extension's scrapers stop finding view counts, like counts, or comment counts. Here's how to fix it without shipping a new extension release.

### How the selector system works

The extension fetches `selectors.json` from this repo every 24 hours and caches the result in `browser.storage.local`. Every installed copy updates automatically — no reinstall, no new release needed. This is the same pattern used by uBlock Origin's filter lists.

If the remote fetch fails for any reason (network down, malformed JSON, GitHub outage), the extension silently falls back to the hardcoded selectors baked into `content.js`.

### Fixing a broken selector

1. Open a YouTube video in Firefox with the DevTools console open (`F12`)

2. In the **Inspector** tab, find the element that holds the data:
   - **View count**: right-click the view number → Inspect
   - **Like count**: right-click the like button count → Inspect
   - **Comment count**: scroll to comments, right-click the "N Comments" heading → Inspect

3. Note the element's tag, class names, ID, and any relevant parent structure. You want a CSS selector that:
   - Is as specific as needed, but not so specific it'll break on minor layout tweaks
   - Targets the element containing the number text, not a wrapper
   - Works on both the standard and cinema-mode layouts if possible

4. Test your selector in the DevTools console:
   ```js
   document.querySelector("YOUR_SELECTOR_HERE").textContent
   ```
   Confirm it returns the number you expect.

5. Open `selectors.json` and:
   - Add your new selector to the **beginning** of the relevant array (so it's tried first)
   - Leave the old selectors in place as fallbacks
   - Bump the `version` field (e.g. `"1.0.0"` → `"1.0.1"`)
   - Update the `updated` date

6. Open a pull request with:
   - What broke (which selector, what YouTube changed)
   - Your new selector and how you tested it
   - The DevTools screenshot showing it working is a bonus

### Testing your fix locally

1. Temporarily edit `FALLBACK_SELECTORS` in `content.js` to match your updated `selectors.json`
2. Load the extension as a temporary add-on (`about:debugging`)
3. Navigate to a YouTube video and confirm the widget appears with correct numbers
4. Check the DevTools console for `[YTEV]` log lines — they'll tell you which selector matched

### Selector update workflow summary

```
YouTube changes DOM
      ↓
Someone notices widget shows "—" for a metric
      ↓
Open DevTools → find correct selector → test it
      ↓
Edit selectors.json: add selector to top of array, bump version
      ↓
Open PR → merge to main
      ↓
All installed copies pick up the fix within 24 hours automatically
```

### What not to change in selectors.json

- Don't remove old selectors — they serve as fallbacks for users on older YouTube layouts
- Don't add JavaScript expressions or anything executable — selectors must be plain CSS selector strings only
- Don't change the JSON structure — `content.js` validates the shape and will reject malformed files

---

## Other contributions

### Scoring threshold calibration

The engagement rate ranges in `verdict.js` (`VIEW_TIERS`) are based on published industry benchmarks. If you have access to a dataset of verified authentic and verified botted videos and can propose better-calibrated thresholds with evidence, that's a meaningful contribution. Open an issue first to discuss methodology before submitting a PR.

### Chrome / Chromium port

The extension uses `browser.*` (WebExtensions API). A `chrome.*` compatibility shim or a build step using `webextension-polyfill` would make this a cross-browser extension. This is a welcome contribution — open an issue first to coordinate.

### Reporting a broken selector

If you notice the widget is missing or showing `—` for a metric, please open an issue with:
- The YouTube video URL (or just the video ID)
- Which metric is missing (views / likes / comments)
- Your Firefox version
- A screenshot of the widget if possible

---

## Code style

- Vanilla JS only — no build step, no bundler, no frameworks
- `"use strict"` in every file
- Comments explain *why*, not *what*
- Selectors are data, not code — keep them in `selectors.json`, not scattered through `content.js`

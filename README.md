# YT Engagement Verdict

A Firefox extension that analyzes YouTube video engagement and renders a statistically-grounded authenticity verdict directly below the view count.

![Verdicts: View Botted 🤖 · Hot Garbage 💩 · Solid Video 👍 · Legit on Fire 🔥](https://img.shields.io/badge/verdicts-4-blue)
![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Firefox](https://img.shields.io/badge/browser-Firefox-orange)

---

## What it does

For every YouTube video you watch, the extension:

1. Scrapes the **view count**, **like count**, and **comment count** from the page
2. Fetches an estimated **dislike count** from the [Return YouTube Dislike](https://returnyoutubedislike.com/) API
3. Runs a **multi-signal, log-normalized engagement scoring** algorithm
4. Displays a verdict inline — no popups, no redirects

### The four verdicts

| Verdict | Meaning |
|---|---|
| 🤖 **View Botted** | Engagement is far below what's expected for this view count. Likely artificially inflated. |
| 💩 **Hot Garbage** | Views exist, but the audience isn't engaging. Low quality or heavily disliked. |
| 👍 **Solid Video** | Engagement is healthy and consistent with genuine viewership. |
| 🔥 **Legit on Fire** | Exceptional engagement across all signals. This one is genuinely popping off. |

---

## Methodology

### Why simple ratios don't work

A flat engagement threshold (e.g. "below 0.1% = botted") fails because of **engagement decay** — a well-documented phenomenon where engagement rate drops naturally as a video accumulates more passive, algorithm-driven viewers. A video with 10M views and 0.2% engagement may be perfectly authentic; a video with 5,000 views and 0.2% engagement may not be.

### The scoring model

Three signals are scored independently on a 0–2 scale, then summed into a composite score:

| Signal | Score 0 | Score 1 | Score 2 |
|---|---|---|---|
| **Like rate** (likes / views) | Below tier minimum | Within expected range | Above tier maximum |
| **Comment rate** (comments / views) | Below tier minimum | Within expected range | Above tier maximum |
| **Sentiment ratio** (likes / likes+dislikes) | < 40% positive | 40–84% positive | ≥ 85% positive |

If dislike data is unavailable (RYD API timeout or failure), the sentiment signal is excluded and the score is recalculated out of 4 instead of 6.

### View tier thresholds

Expected engagement rates are scaled logarithmically by view count:

| View tier | Expected like rate | Expected comment rate |
|---|---|---|
| 0 – 10K | 2.0% – 10.0% | 0.50% – 3.00% |
| 10K – 100K | 1.0% – 5.0% | 0.20% – 1.50% |
| 100K – 1M | 0.5% – 3.0% | 0.10% – 0.80% |
| 1M – 10M | 0.2% – 1.5% | 0.05% – 0.40% |
| 10M+ | 0.1% – 0.8% | 0.02% – 0.20% |

### Composite score → verdict

| Score (% of max) | Verdict |
|---|---|
| 0–20% | 🤖 View Botted |
| 21–55% | 💩 Hot Garbage |
| 56–90% | 👍 Solid Video |
| 91–100% | 🔥 Legit on Fire |

### Academic grounding

This methodology draws from:

- **Fake views removal and popularity on YouTube** — *Scientific Reports / Nature*, 2024. Establishes that engagement corrections are batched and that view-count anomalies affect the majority of channels studied.
- **Navigating the Anomalies: A Comprehensive Analysis of YouTube Channel Behavior** — *Springer*, 2024. Proposes normalized 0–1 suspicion scores combining engagement metrics and commenter behavior via PCA and cosine similarity.
- **Predicting Social Media Engagement from Emotional and Temporal Features** — *arXiv*, 2025. Demonstrates that likes are highly predictable (R²=0.98) while comments are not (R²=0.41), confirming comments as the stronger authenticity signal.
- Standard log-transformation of engagement metrics before analysis, as used across the academic literature on YouTube analytics.

> **Honest caveat:** This extension implements a *heuristic*, not a trained classifier. It will catch obvious cases well but has no ground-truth training data. Treat verdicts as an informed signal, not a definitive ruling.

---

## Installation (Developer / Unpacked)

Firefox does not yet support loading unpacked extensions permanently without signing, but you can run it in temporary mode for testing:

1. Clone this repository:
   ```bash
   git clone https://github.com/Denali1/yt-engagement-verdict.git
   ```

2. Open Firefox and navigate to:
   ```
   about:debugging#/runtime/this-firefox
   ```

3. Click **Load Temporary Add-on…**

4. Select the `manifest.json` file inside the cloned folder.

5. Navigate to any YouTube video — the verdict widget will appear below the view count.

> **Note:** Temporary add-ons are removed when Firefox closes. For persistent installation, the extension needs to be signed via [Mozilla Add-on Hub](https://addons.mozilla.org/en-US/developers/).

---

## Selector updates (no reinstall needed)

YouTube frequently changes its DOM markup without notice, which breaks the scrapers that read view counts, like counts, and comment counts. To handle this without requiring users to reinstall or update the extension, we use a remote selector list — the same pattern as uBlock Origin's filter lists.

**How it works:**
- On first use, the extension fetches [`selectors.json`](selectors.json) from this repo
- The result is cached in `browser.storage.local` for 24 hours
- After 24 hours, it silently re-fetches in the background on the next YouTube video visit
- If the fetch fails for any reason, it falls back to the selectors baked into `content.js`
- The popup toolbar icon shows the active selector version and a **↻ Refresh** button to force an immediate re-fetch

**When YouTube breaks something**, a fix is a one-line PR to `selectors.json` — no new release needed, every installed copy picks it up within 24 hours.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full selector fix workflow.

---

## Contributing

Pull requests are welcome. Key areas for improvement:

- **DOM selector resilience** — YouTube frequently changes its markup. If the view/like/comment scrapers break, `content.js` is where to fix them.
- **Threshold calibration** — The view-tier engagement ranges in `verdict.js` are based on published benchmarks. If you have access to a dataset of known-authentic and known-botted videos, better-calibrated thresholds would be a meaningful contribution.
- **Chrome / Chromium port** — The extension uses `browser.*` (WebExtensions API). A `chrome.*` compatibility shim would be a straightforward port.
- **i18n** — All user-facing strings are currently hardcoded in English.

---

## Privacy

- This extension makes **one external API call** per video: to `returnyoutubedislikeapi.com` to fetch estimated dislike counts.
- No user data is collected, stored, or transmitted anywhere else.
- All scoring runs locally in your browser.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [Return YouTube Dislike](https://returnyoutubedislike.com/) — for maintaining the crowd-sourced dislike API that makes the sentiment signal possible.
- The academic researchers cited in the Methodology section whose work informed the scoring design.

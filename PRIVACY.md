# Privacy Policy — YT Engagement Verdict

*Last updated: August 12, 2026*

---

## Overview

YT Engagement Verdict is a browser extension that analyzes YouTube video engagement and displays an authenticity verdict. This policy explains what data the extension collects, how it is used, and your choices.

---

## What we collect

### By default — nothing

Out of the box, the extension collects no data. All scoring runs locally in your browser. Nothing is transmitted anywhere.

### Optional anonymous telemetry (opt-in only)

If you choose to opt in via the welcome screen or the extension popup, the extension will anonymously share the following data points after scoring each YouTube video:

- The YouTube video ID (e.g. `dQw4w9WgXcQ`) — this is a public identifier, not personal information
- View count, like rate, comment rate, and sentiment score at the time of scoring
- Whether YouTube has marked the video as AI-generated content
- The verdict and composite score

**What is never collected or transmitted:**

- Your identity or any personally identifiable information
- Your YouTube account or watch history
- Your location
- Any data that could identify you as an individual

---

## How we use the data

Anonymous telemetry data is used solely to improve the accuracy of the engagement scoring algorithm. As data accumulates across installs, it will be used to calculate statistically meaningful engagement benchmarks per view tier, replacing the current fixed thresholds with z-score based scoring.

No data is sold, shared with third parties, or used for advertising purposes.

---

## Infrastructure and IP addresses

When the extension makes network requests — to fetch the selector update list from GitHub, to retrieve dislike estimates from Return YouTube Dislike, or to submit optional telemetry — your IP address may be visible to the following infrastructure providers as part of normal network routing:

- **Cloudflare** — hosts the telemetry API endpoint
- **Neon** — hosts the Postgres database that stores aggregated telemetry
- **GitHub** — hosts the selector update file (`selectors.json`)
- **Return YouTube Dislike** — provides estimated dislike counts

IP addresses are not stored in our database and are not used by this extension. Each provider's own privacy policy governs their handling of network-level data.

---

## Your choices

- **Opt in or out at any time** using the toggle in the extension popup
- **No account required** — there is no registration, login, or user profile
- **Uninstalling the extension** stops all data collection immediately

---

## Data retention

Anonymous telemetry reports are retained for 90 days on a rolling basis, after which they are automatically deleted. Aggregated scoring statistics derived from this data may be retained indefinitely.

---

## Changes to this policy

If this policy changes materially, the updated version will be committed to this repository with an updated date. Continued use of the extension after a policy change constitutes acceptance of the new terms.

---

## Contact

Questions about this privacy policy can be directed to the GitHub repository:

[https://github.com/Denali1/yt-engagement-verdict](https://github.com/Denali1/yt-engagement-verdict)

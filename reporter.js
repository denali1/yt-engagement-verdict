/**
 * reporter.js
 * YT Engagement Verdict — Telemetry Reporter
 *
 * Sends anonymous verdict data to the Cloudflare Worker API
 * only if the user has opted in via the welcome page or popup toggle.
 *
 * Data sent:
 *   - videoId, views, likeRate, commentRate, sentiment
 *   - verdict, score, maxScore, isAiContent
 *
 * Data never sent:
 *   - User identity, watch history, or anything identifying
 *
 * Note: IP address may be visible to Cloudflare/Neon at the
 * network layer but is never stored in our database.
 */

"use strict";

const Reporter = (() => {

  const API_URL = "https://yt-engagement-verdict-api.steve-mcknelly-cloudflare.workers.dev/verdict";
  const API_KEY_STORAGE_KEY = "api_key";
  const OPT_IN_KEY = "telemetry_opted_in";

  /**
   * Check if the user has opted in to telemetry.
   * Returns false if not set (default to off).
   */
  async function isOptedIn() {
    try {
      const result = await browser.storage.local.get(OPT_IN_KEY);
      return result[OPT_IN_KEY] === true;
    } catch {
      return false;
    }
  }

  /**
   * Retrieve the API key from storage.
   * Set via the popup or options page in a future update.
   */
  async function getApiKey() {
    try {
      const result = await browser.storage.local.get(API_KEY_STORAGE_KEY);
      return result[API_KEY_STORAGE_KEY] || null;
    } catch {
      return null;
    }
  }

  /**
   * Report a verdict to the Worker API.
   * Silently no-ops if the user hasn't opted in or no API key is set.
   *
   * @param {string} videoId
   * @param {object} result — the full YTVerdict.compute() result
   */
  async function report(videoId, result) {
    if (!await isOptedIn()) return;

    const apiKey = await getApiKey();
    if (!apiKey) {
      console.debug("[YTEV Reporter] No API key set — skipping report");
      return;
    }

    const { inputs, verdict, composite, maxScore } = result;

    const body = {
      videoId,
      views:       inputs.views,
      likeRate:    inputs.likes / inputs.views,
      commentRate: inputs.comments !== null ? inputs.comments / inputs.views : null,
      sentiment:   inputs.dislikes !== null ? inputs.likes / (inputs.likes + inputs.dislikes) : null,
      verdict:     verdict.label.toLowerCase().replace(/\s+/g, "_"),
      score:       composite,
      maxScore,
      isAiContent: result.isAiContent || false,
    };

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-YTEV-Key": apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        console.debug(`[YTEV Reporter] Report failed: HTTP ${response.status}`);
      } else {
        console.debug(`[YTEV Reporter] Reported verdict for ${videoId}`);
      }
    } catch (err) {
      // Network failure — silently swallow, never block the UI
      console.debug(`[YTEV Reporter] Network error: ${err.message}`);
    }
  }

  return { report, isOptedIn };

})();

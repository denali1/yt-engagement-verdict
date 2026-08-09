/**
 * ryd.js
 * YT Engagement Verdict — Return YouTube Dislike API client
 *
 * Fetches estimated dislike counts from the crowd-sourced RYD API.
 * https://returnyoutubedislike.com/
 *
 * Treats dislike data as a confirming signal, not a primary input.
 * If the API is unavailable or times out, scoring continues without it.
 */

"use strict";

const RYD = (() => {

  const BASE_URL = "https://returnyoutubedislikeapi.com/votes";
  const TIMEOUT_MS = 4000;

  /**
   * Extracts the video ID from the current page URL.
   * @returns {string|null}
   */
  function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("v") || null;
  }

  /**
   * Fetches dislike data for a given video ID.
   * Returns null on any failure — callers must handle null gracefully.
   * @param {string} videoId
   * @returns {Promise<{likes: number, dislikes: number, rating: number}|null>}
   */
  async function fetchDislikes(videoId) {
    if (!videoId) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${BASE_URL}?videoId=${encodeURIComponent(videoId)}`, {
        signal: controller.signal,
        headers: { "Accept": "application/json" },
      });

      clearTimeout(timer);

      if (!response.ok) return null;

      const data = await response.json();

      // Validate shape before trusting the data
      if (
        typeof data.likes    !== "number" ||
        typeof data.dislikes !== "number" ||
        data.likes    < 0 ||
        data.dislikes < 0
      ) {
        return null;
      }

      return {
        likes:    data.likes,
        dislikes: data.dislikes,
        rating:   data.rating ?? null,
      };

    } catch (err) {
      clearTimeout(timer);
      // AbortError = timeout; TypeError = network failure — both are fine to swallow
      return null;
    }
  }

  return { fetchDislikes, getVideoId };

})();

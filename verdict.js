/**
 * verdict.js
 * YT Engagement Verdict — Scoring Engine
 *
 * Methodology based on:
 *   - Log-transformed engagement normalization (standard in academic YouTube research)
 *   - Multi-signal weighted scoring (Springer 2024, Nature Scientific Reports 2024)
 *   - Engagement decay by view tier (industry-documented phenomenon)
 *
 * Signals scored 0–2 each, max composite score = 6:
 *   [A] Like rate vs. view tier expected range
 *   [B] Comment rate vs. view tier expected range
 *   [C] Sentiment ratio (likes / likes+dislikes)
 *
 * Verdicts:
 *   0–1  → 🤖 View Botted
 *   2–3  → 💩 Hot Garbage
 *   4–5  → 👍 Solid Video
 *   6    → 🔥 Legit on Fire
 */

"use strict";

const YTVerdict = (() => {

  /**
   * Expected engagement rate ranges by view tier.
   * Source: industry benchmarks + academic engagement decay literature.
   * Rates = (likes + comments) / views
   */
  const VIEW_TIERS = [
    { max: 10_000,      likeRate: { low: 0.02, high: 0.10 }, commentRate: { low: 0.005, high: 0.03 } },
    { max: 100_000,     likeRate: { low: 0.01, high: 0.05 }, commentRate: { low: 0.002, high: 0.015 } },
    { max: 1_000_000,   likeRate: { low: 0.005, high: 0.03 }, commentRate: { low: 0.001, high: 0.008 } },
    { max: 10_000_000,  likeRate: { low: 0.002, high: 0.015 }, commentRate: { low: 0.0005, high: 0.004 } },
    { max: Infinity,    likeRate: { low: 0.001, high: 0.008 }, commentRate: { low: 0.0002, high: 0.002 } },
  ];

  /**
   * Returns the expected rate ranges for a given view count.
   */
  function getTier(views) {
    return VIEW_TIERS.find(t => views <= t.max);
  }

  /**
   * Scores a single ratio against a tier's expected range.
   *   2 = at or above the high end (great)
   *   1 = within normal range
   *   0 = below the low end (suspicious)
   */
  function scoreRate(actual, range) {
    if (actual >= range.high) return 2;
    if (actual >= range.low)  return 1;
    return 0;
  }

  /**
   * Scores the like/dislike sentiment ratio.
   *   2 = ≥85% positive (well-liked)
   *   1 = 40–84% positive (mixed)
   *   0 = <40% positive (mostly disliked)
   *
   * If dislike data is unavailable, returns null (signal excluded from scoring).
   */
  function scoreSentiment(likes, dislikes) {
    if (dislikes === null || dislikes === undefined) return null;
    const total = likes + dislikes;
    if (total === 0) return null;
    const ratio = likes / total;
    if (ratio >= 0.85) return 2;
    if (ratio >= 0.40) return 1;
    return 0;
  }

  /**
   * Maps a composite score to a verdict object.
   */
  function scoreToVerdict(score, maxScore) {
    const pct = score / maxScore;
    if (pct <= 0.20) return { emoji: "🤖", label: "View Botted",    color: "#ff4444", description: "Engagement is far below what's expected for this view count. Likely artificially inflated." };
    if (pct <= 0.55) return { emoji: "💩", label: "Hot Garbage",    color: "#ff8c00", description: "Views exist, but the audience isn't engaging. Low quality or heavily disliked." };
    if (pct <= 0.90) return { emoji: "👍", label: "Solid Video",    color: "#4caf50", description: "Engagement is healthy and consistent with genuine viewership." };
    return               { emoji: "🔥", label: "Legit on Fire",  color: "#ff6b35", description: "Exceptional engagement across all signals. This one is genuinely popping off." };
  }

  /**
   * Main entry point.
   * @param {number} views
   * @param {number} likes
   * @param {number|null} dislikes  — null if RYD data unavailable
   * @param {number} comments
   * @returns {object} Full verdict result
   */
  function compute(views, likes, dislikes, comments) {
    if (!views || views === 0) {
      return { verdict: null, error: "No view data available." };
    }

    const tier = getTier(views);
    const likeRate    = likes    / views;
    const commentRate = comments / views;

    const scoreA = scoreRate(likeRate,    tier.likeRate);
    const scoreB = scoreRate(commentRate, tier.commentRate);
    const scoreC = scoreSentiment(likes, dislikes);

    const signals = [
      { name: "Like rate",    score: scoreA, max: 2, rate: likeRate,    expected: tier.likeRate },
      { name: "Comment rate", score: scoreB, max: 2, rate: commentRate, expected: tier.commentRate },
    ];

    let composite = scoreA + scoreB;
    let maxScore  = 4;

    if (scoreC !== null) {
      signals.push({ name: "Sentiment", score: scoreC, max: 2, rate: likes / (likes + dislikes), expected: { low: 0.40, high: 0.85 } });
      composite += scoreC;
      maxScore  += 2;
    }

    const verdict = scoreToVerdict(composite, maxScore);

    return {
      verdict,
      composite,
      maxScore,
      signals,
      inputs: { views, likes, dislikes, comments },
      hasSentiment: scoreC !== null,
    };
  }

  return { compute };

})();

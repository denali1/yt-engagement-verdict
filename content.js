/**
 * content.js
 * YT Engagement Verdict — Content Script
 *
 * Responsibilities:
 *   1. Load CSS selectors from cache or remote selectors.json
 *   2. Wait for YouTube's dynamic DOM to settle on a video page
 *   3. Scrape view count, like count, and comment count from the page
 *   4. Fetch dislike estimate from Return YouTube Dislike API
 *   5. Run YTVerdict.compute() with all signals
 *   6. Inject the verdict widget below the view count
 *   7. Re-run on YouTube SPA navigation (popstate / yt-navigate-finish)
 *
 * Selector update strategy (uBlock-style):
 *   - On first run, fetch selectors.json from GitHub raw URL
 *   - Cache result in browser.storage.local with a timestamp
 *   - Re-fetch only if cache is older than SELECTOR_TTL_MS (24 hours)
 *   - If fetch fails for any reason, fall back to FALLBACK_SELECTORS
 *   - Selectors are data only — never eval'd or executed
 */

"use strict";

(function () {

  const WIDGET_ID        = "ytev-widget";
  const RETRY_LIMIT      = 40;
  const RETRY_MS         = 500;
  const SELECTOR_TTL_MS  = 24 * 60 * 60 * 1000; // 24 hours
  const SELECTOR_CACHE_KEY  = "ytev_selectors";
  const SELECTOR_FETCH_URL  =
    "https://raw.githubusercontent.com/Denali1/yt-engagement-verdict/main/selectors.json";

  // ─── Fallback Selectors ───────────────────────────────────────────────────
  // These are baked in at build time and used when the remote fetch fails.
  // Update selectors.json on GitHub to push fixes without a new release.

  const FALLBACK_SELECTORS = {
    version: "1.0.1",
    views: [
      "ytd-watch-info-text span.yt-core-attributed-string",
      "#info .view-count",
      "ytd-video-view-count-renderer .view-count"
    ],
    likes: [
      "like-button-view-model button",
      "ytd-toggle-button-renderer like-button-view-model button",
      "ytd-menu-renderer ytd-toggle-button-renderer button[aria-label*='like' i]",
      "like-button-view-model .yt-spec-button-shape-next__button-text-content"
    ],
    comments: [
      "#comments #count .count-text",
      "ytd-comments-header-renderer h2 span"
    ],
    inject_before: [
      "#above-the-fold #bottom-row",
      "#below-the-fold",
      "#meta #actions",
      "#info-contents",
      "ytd-video-primary-info-renderer"
    ]
  };

  // ─── Selector Loader ──────────────────────────────────────────────────────

  let activeSelectors = FALLBACK_SELECTORS;

  /**
   * Loads selectors from cache or remote, with fallback.
   * Resolves to the selector set to use — always resolves, never rejects.
   */
  async function loadSelectors() {
    try {
      // Check cache first
      const stored = await browser.storage.local.get(SELECTOR_CACHE_KEY);
      const cached = stored[SELECTOR_CACHE_KEY];

      if (cached && cached.selectors && cached.fetchedAt) {
        const age = Date.now() - cached.fetchedAt;
        if (age < SELECTOR_TTL_MS) {
          // Cache is fresh — use it
          activeSelectors = cached.selectors;
          console.debug(
            `[YTEV] Using cached selectors v${cached.selectors.version} ` +
            `(${Math.round(age / 60000)}m old)`
          );
          return activeSelectors;
        }
      }

      // Cache is stale or missing — fetch fresh copy
      console.debug("[YTEV] Fetching fresh selectors from GitHub...");
      const response = await fetch(SELECTOR_FETCH_URL, {
        cache: "no-cache",
        headers: { "Accept": "application/json" }
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const remote = await response.json();

      // Validate shape before trusting remote data
      if (
        !remote.version ||
        !Array.isArray(remote.views) ||
        !Array.isArray(remote.likes) ||
        !Array.isArray(remote.comments) ||
        !Array.isArray(remote.inject_before)
      ) {
        throw new Error("Remote selectors failed shape validation");
      }

      // Cache it
      await browser.storage.local.set({
        [SELECTOR_CACHE_KEY]: {
          selectors: remote,
          fetchedAt: Date.now()
        }
      });

      activeSelectors = remote;
      console.debug(`[YTEV] Loaded remote selectors v${remote.version}`);
      return activeSelectors;

    } catch (err) {
      // Any failure → fall back to baked-in selectors silently
      console.debug(`[YTEV] Selector fetch failed (${err.message}), using fallback`);
      activeSelectors = FALLBACK_SELECTORS;
      return activeSelectors;
    }
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  /**
   * Parses a YouTube-formatted number string into an integer.
   * Handles: "1.2M views", "45,312 views", "823K likes", etc.
   */
  function parseYTNumber(str) {
    if (!str) return null;
    const clean = str.replace(/,/g, "").trim();
    const match = clean.match(/([\d.]+)\s*([KMBkmb]?)/);
    if (!match) return null;
    let num = parseFloat(match[1]);
    const suffix = match[2].toUpperCase();
    if (suffix === "K") num *= 1_000;
    if (suffix === "M") num *= 1_000_000;
    if (suffix === "B") num *= 1_000_000_000;
    return Math.round(num);
  }

  function formatNum(n) {
    if (n === null || n === undefined) return "—";
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
    if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000)         return (n / 1_000).toFixed(1) + "K";
    return n.toLocaleString();
  }

  function formatRate(r) {
    if (r === null || r === undefined) return "—";
    return (r * 100).toFixed(3) + "%";
  }

  // ─── DOM Scraping (selector-driven) ──────────────────────────────────────

  function scrapeViews() {
    for (const sel of activeSelectors.views) {
      const el = document.querySelector(sel);
      if (el) {
        const val = parseYTNumber(el.textContent);
        if (val !== null) return val;
      }
    }
    // Universal text fallback — scan spans for "N views" pattern
    for (const span of document.querySelectorAll("span")) {
      if (/\d[\d,.]*(K|M|B)?\s+views/i.test(span.textContent)) {
        return parseYTNumber(span.textContent);
      }
    }
    return null;
  }

  function scrapeLikes() {
    // Primary selectors from active set
    for (const sel of activeSelectors.likes) {
      const el = document.querySelector(sel);
      if (!el) continue;

      // Try aria-label first (most reliable)
      // YouTube uses "like this video along with 8,331 other people"
      const label = el.getAttribute("aria-label") || "";
      const labelMatch = label.match(/([\d,.]+[KMBkmb]?)/);
      if (labelMatch) {
        const val = parseYTNumber(labelMatch[1]);
        // Only trust aria-label result if it's > 0 OR the label explicitly
        // says "like this video" with no number (genuinely 0 likes edge case)
        if (val !== null && val > 0) return val;
        if (val === 0 && /like this video/i.test(label) && !/along with/i.test(label)) return 0;
      }

      // Try text content
      const val = parseYTNumber(el.textContent);
      if (val !== null && val > 0) return val;

      // Try sibling span inside toggle renderer
      const countEl = el.closest("ytd-toggle-button-renderer")
        ?.querySelector("span.yt-core-attributed-string");
      if (countEl) {
        const v = parseYTNumber(countEl.textContent);
        if (v !== null && v > 0) return v;
      }
    }
    // Return null so the retry loop keeps trying until aria-label is populated
    return null;
  }

  function scrapeComments() {
    for (const sel of activeSelectors.comments) {
      const el = document.querySelector(sel);
      if (el) {
        const val = parseYTNumber(el.textContent);
        if (val !== null) return val;
      }
    }
    // Universal text fallback
    for (const el of document.querySelectorAll("span, yt-formatted-string")) {
      if (/[\d,.]+[KMBkmb]?\s+comments/i.test(el.textContent)) {
        return parseYTNumber(el.textContent);
      }
    }
    return null;
  }

  // ─── Widget Rendering ─────────────────────────────────────────────────────

  function scoreBar(score, max) {
    const pct = Math.round((score / max) * 100);
    return `
      <div class="ytev-bar-wrap" title="${score}/${max} signals">
        <div class="ytev-bar-fill" style="width:${pct}%"></div>
      </div>`;
  }

  function signalDot(score) {
    const cls = score === 2 ? "high" : score === 1 ? "mid" : "low";
    return `<span class="ytev-dot ytev-dot-${cls}" title="Signal: ${score}/2"></span>`;
  }

  function renderWidget(result, selectorVersion) {
    const existing = document.getElementById(WIDGET_ID);
    if (existing) existing.remove();

    const { verdict, composite, maxScore, signals, inputs, hasSentiment } = result;

    const signalRows = signals.map(s => `
      <div class="ytev-signal-row">
        ${signalDot(s.score)}
        <span class="ytev-signal-name">${s.name}</span>
        <span class="ytev-signal-rate">${formatRate(s.rate)}</span>
        <span class="ytev-signal-range">expected ${formatRate(s.expected.low)}–${formatRate(s.expected.high)}</span>
      </div>
    `).join("");

    const dislikeNote = hasSentiment
      ? `<div class="ytev-ryd-note">Dislikes via <a href="https://returnyoutubedislike.com" target="_blank" rel="noopener">Return YouTube Dislike</a></div>`
      : `<div class="ytev-ryd-note ytev-ryd-missing">Dislike data unavailable — sentiment signal excluded</div>`;

    const widget = document.createElement("div");
    widget.id = WIDGET_ID;
    widget.setAttribute("data-score", composite);
    widget.setAttribute("data-max", maxScore);
    widget.innerHTML = `
      <div class="ytev-header">
        <span class="ytev-emoji">${verdict.emoji}</span>
        <span class="ytev-label" style="color:${verdict.color}">${verdict.label}</span>
        <button class="ytev-toggle" aria-expanded="false" aria-label="Show details">▾</button>
      </div>
      <div class="ytev-score-row">
        ${scoreBar(composite, maxScore)}
        <span class="ytev-score-text">${composite}/${maxScore}</span>
      </div>
      <p class="ytev-description">${verdict.description}</p>
      <div class="ytev-details" hidden>
        <div class="ytev-stats-grid">
          <div class="ytev-stat"><span class="ytev-stat-val">${formatNum(inputs.views)}</span><span class="ytev-stat-lbl">Views</span></div>
          <div class="ytev-stat"><span class="ytev-stat-val">${formatNum(inputs.likes)}</span><span class="ytev-stat-lbl">Likes</span></div>
          <div class="ytev-stat"><span class="ytev-stat-val">${inputs.dislikes !== null ? formatNum(inputs.dislikes) : "—"}</span><span class="ytev-stat-lbl">Dislikes</span></div>
          <div class="ytev-stat"><span class="ytev-stat-val">${formatNum(inputs.comments)}</span><span class="ytev-stat-lbl">Comments</span></div>
        </div>
        <div class="ytev-signals">${signalRows}</div>
        ${dislikeNote}
        <div class="ytev-methodology">
          Scored using log-normalized engagement decay tiers.
          Selectors v${selectorVersion}.<br>
          <a href="https://github.com/Denali1/yt-engagement-verdict#methodology" target="_blank" rel="noopener">Methodology ↗</a>
          &nbsp;·&nbsp;
          <a href="https://github.com/Denali1/yt-engagement-verdict/blob/main/selectors.json" target="_blank" rel="noopener">Selector source ↗</a>
        </div>
      </div>
    `;

    widget.querySelector(".ytev-toggle").addEventListener("click", function () {
      const details = widget.querySelector(".ytev-details");
      const expanded = this.getAttribute("aria-expanded") === "true";
      details.hidden = expanded;
      this.setAttribute("aria-expanded", String(!expanded));
      this.textContent = expanded ? "▾" : "▴";
    });

    return widget;
  }

  function injectWidget(widget) {
    for (const selector of activeSelectors.inject_before) {
      const el = document.querySelector(selector);
      if (el) {
        el.parentNode.insertBefore(widget, el);
        return true;
      }
    }
    return false;
  }

  // ─── Main Flow ─────────────────────────────────────────────────────────────

  let currentVideoId = null;
  let retryCount     = 0;
  let retryTimer     = null;
  let lastResult     = null;

  async function run() {
    const videoId = RYD.getVideoId();
    if (!videoId) return;

    if (videoId === currentVideoId && document.getElementById(WIDGET_ID)) return;
    currentVideoId = videoId;

    clearTimeout(retryTimer);
    retryCount = 0;
    document.getElementById(WIDGET_ID)?.remove();

    // Selectors are already loaded by init() before run() is ever called
    await attempt(videoId);
  }

  async function attempt(videoId) {
    const views    = scrapeViews();
    const likes    = scrapeLikes();
    const comments = scrapeComments();

    if ((views === null || likes === null || likes === 0 || comments === null || comments === 0) && retryCount < RETRY_LIMIT) {
      retryCount++;
      retryTimer = setTimeout(() => attempt(videoId), RETRY_MS);
      return;
    }

    const rydData  = await RYD.fetchDislikes(videoId);
    const dislikes = rydData ? rydData.dislikes : null;

    lastResult = YTVerdict.compute(views ?? 0, likes ?? 0, dislikes, comments ?? 0);

    if (lastResult.error || !lastResult.verdict) return;

    const widget = renderWidget(lastResult, activeSelectors.version);

    function tryInject() {
      if (!injectWidget(widget)) {
        if (retryCount < RETRY_LIMIT) {
          retryCount++;
          retryTimer = setTimeout(tryInject, RETRY_MS);
        }
      }
    }
    tryInject();
  }

  // ─── Message Listener (for popup) ────────────────────────────────────────

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "GET_VERDICT") {
      sendResponse(lastResult || null);
    }
    if (msg.type === "GET_SELECTOR_VERSION") {
      sendResponse({ version: activeSelectors.version });
    }
    if (msg.type === "FORCE_SELECTOR_REFRESH") {
      // Wipe the cache and reload — useful for debugging
      browser.storage.local.remove(SELECTOR_CACHE_KEY).then(() => {
        loadSelectors().then(() => sendResponse({ ok: true, version: activeSelectors.version }));
      });
      return true; // keep channel open for async response
    }
  });

  // ─── Navigation Listeners ─────────────────────────────────────────────────
  // YouTube is a SPA with inconsistent navigation events. We use three
  // strategies in combination to catch all navigation types:
  //   1. yt-navigate-finish — YouTube's own event, most reliable
  //   2. popstate — browser back/forward
  //   3. URL polling — catches pushState navigations that fire neither event

  function onNavigate() {
    currentVideoId = null;
    setTimeout(run, 800);
  }

  window.addEventListener("yt-navigate-finish", onNavigate);
  window.addEventListener("popstate", onNavigate);

  // URL polling fallback — checks every 500ms if the URL has changed.
  // Lightweight since it's just a string comparison.
  let lastUrl = location.href;
  setInterval(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      // Only trigger if we're on a video page
      if (currentUrl.includes("youtube.com/watch")) {
        onNavigate();
      } else {
        // Left a video page — clean up the widget
        currentVideoId = null;
        document.getElementById(WIDGET_ID)?.remove();
      }
    }
  }, 500);

  // ─── Init ─────────────────────────────────────────────────────────────────
  // Load selectors first, then start watching the page.

  async function init() {
    await loadSelectors();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run);
    } else {
      run();
    }
  }

  init();

})();

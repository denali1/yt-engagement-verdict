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
    "https://raw.githubusercontent.com/Denali1/yt-engagement-verdict/master/selectors.json";

  // ─── Fallback Selectors ───────────────────────────────────────────────────
  // These are baked in at build time and used when the remote fetch fails.
  // Update selectors.json on GitHub to push fixes without a new release.

  const FALLBACK_SELECTORS = {
    version: "1.0.3",
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
    ],
    ai_label_container: "ytd-structured-description-content-renderer",
    ai_label_text: "Made with AI"
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

  // Sentinel value meaning comments are intentionally disabled — not a scrape failure
  const COMMENTS_DISABLED = -1;

  function scrapeComments() {
    // Check if comments are turned off before trying selectors
    const msg = document.querySelector("ytd-message-renderer");
    if (msg && /comments are turned off/i.test(msg.textContent)) {
      return COMMENTS_DISABLED;
    }

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

  function scrapeAiLabel() {
    const container = activeSelectors.ai_label_container
      ? document.querySelector(activeSelectors.ai_label_container)
      : document.querySelector("ytd-structured-description-content-renderer");
    if (!container) return false;
    const labelText = activeSelectors.ai_label_text || "Made with AI";
    return Array.from(container.querySelectorAll("span"))
      .some(el => el.textContent.trim() === labelText);
  }

  // ─── Widget Rendering ─────────────────────────────────────────────────────

  /** Create an element with optional className and textContent */
  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Create an anchor element */
  function makeLink(href, text) {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }

  function renderWidget(result, selectorVersion) {
    const existing = document.getElementById(WIDGET_ID);
    if (existing) existing.remove();

    const { verdict, composite, maxScore, signals, inputs, hasSentiment } = result;
    const pct = Math.round((composite / maxScore) * 100);

    // ── Root widget ──
    const widget = document.createElement("div");
    widget.id = WIDGET_ID;
    widget.setAttribute("data-score", composite);
    widget.setAttribute("data-max", maxScore);

    // ── Header ──
    const header = make("div", "ytev-header");
    header.appendChild(make("span", "ytev-emoji", verdict.emoji));
    const labelSpan = make("span", "ytev-label", verdict.label);
    labelSpan.style.color = verdict.color;
    header.appendChild(labelSpan);
    if (result.isAiContent) {
      const aiBadge = make("span", "ytev-ai-badge", "🤖 AI");
      header.appendChild(aiBadge);
    }
    const toggleBtn = make("button", "ytev-toggle", "▾");
    toggleBtn.setAttribute("aria-expanded", "false");
    toggleBtn.setAttribute("aria-label", "Show details");
    header.appendChild(toggleBtn);
    widget.appendChild(header);

    // ── Score bar ──
    const scoreRow = make("div", "ytev-score-row");
    const barWrap = make("div", "ytev-bar-wrap");
    barWrap.title = `${composite}/${maxScore} signals`;
    const barFill = make("div", "ytev-bar-fill");
    barFill.style.width = `${pct}%`;
    barWrap.appendChild(barFill);
    scoreRow.appendChild(barWrap);
    scoreRow.appendChild(make("span", "ytev-score-text", `${composite}/${maxScore}`));
    widget.appendChild(scoreRow);

    // ── Description ──
    widget.appendChild(make("p", "ytev-description", verdict.description));

    // ── Details panel ──
    const details = make("div", "ytev-details");
    details.hidden = true;

    // Stats grid
    const statsGrid = make("div", "ytev-stats-grid");
    [
      [inputs.views,     "Views"],
      [inputs.likes,     "Likes"],
      [inputs.dislikes !== null ? inputs.dislikes : null, "Dislikes"],
      [inputs.comments,  "Comments"],
    ].forEach(([val, label]) => {
      const stat = make("div", "ytev-stat");
      const displayVal = label === "Comments" && result.commentsDisabled
        ? "Off"
        : val !== null ? formatNum(val) : "—";
      stat.appendChild(make("span", "ytev-stat-val", displayVal));
      stat.appendChild(make("span", "ytev-stat-lbl", label));
      statsGrid.appendChild(stat);
    });
    details.appendChild(statsGrid);

    // Signal rows
    const signalsDiv = make("div", "ytev-signals");
    signals.forEach(s => {
      const row = make("div", "ytev-signal-row");
      const dotCls = s.score === 2 ? "high" : s.score === 1 ? "mid" : "low";
      const dot = make("span", `ytev-dot ytev-dot-${dotCls}`);
      dot.title = `Signal: ${s.score}/2`;
      row.appendChild(dot);
      row.appendChild(make("span", "ytev-signal-name", s.name));
      row.appendChild(make("span", "ytev-signal-rate", formatRate(s.rate)));
      row.appendChild(make("span", "ytev-signal-range", `expected ${formatRate(s.expected.low)}–${formatRate(s.expected.high)}`));
      signalsDiv.appendChild(row);
    });
    details.appendChild(signalsDiv);

    // Comments disabled note
    if (result.commentsDisabled) {
      const commentsNote = make("div", "ytev-ryd-note ytev-ryd-missing");
      commentsNote.textContent = "Comments are turned off — comment rate signal excluded";
      details.appendChild(commentsNote);
    }

    // RYD note
    const rydNote = make("div", hasSentiment ? "ytev-ryd-note" : "ytev-ryd-note ytev-ryd-missing");
    if (hasSentiment) {
      rydNote.appendChild(document.createTextNode("Dislikes via "));
      rydNote.appendChild(makeLink("https://returnyoutubedislike.com", "Return YouTube Dislike"));
    } else {
      rydNote.textContent = "Dislike data unavailable — sentiment signal excluded";
    }
    details.appendChild(rydNote);

    // Methodology
    const methodology = make("div", "ytev-methodology");
    methodology.appendChild(document.createTextNode(
      `Scored using log-normalized engagement decay tiers. Selectors v${selectorVersion}.`
    ));
    methodology.appendChild(document.createElement("br"));
    methodology.appendChild(makeLink("https://github.com/Denali1/yt-engagement-verdict#methodology", "Methodology ↗"));
    methodology.appendChild(document.createTextNode(" · "));
    methodology.appendChild(makeLink("https://github.com/Denali1/yt-engagement-verdict/blob/master/selectors.json", "Selector source ↗"));
    details.appendChild(methodology);

    widget.appendChild(details);

    // ── Toggle listener ──
    toggleBtn.addEventListener("click", function () {
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

    if ((views === null || likes === null || likes === 0 || comments === null || comments === 0) && comments !== COMMENTS_DISABLED && retryCount < RETRY_LIMIT) {
      retryCount++;
      retryTimer = setTimeout(() => attempt(videoId), RETRY_MS);
      return;
    }

    const rydData  = await RYD.fetchDislikes(videoId);
    const dislikes = rydData ? rydData.dislikes : null;
    const isAiContent = scrapeAiLabel();

    const commentsValue = comments === COMMENTS_DISABLED ? null : (comments ?? 0);
    lastResult = YTVerdict.compute(views ?? 0, likes ?? 0, dislikes, commentsValue);
    lastResult.commentsDisabled = comments === COMMENTS_DISABLED;
    lastResult.isAiContent = isAiContent;

    if (lastResult.error || !lastResult.verdict) return;

    // Report anonymously if user has opted in
    Reporter.report(videoId, lastResult).catch(() => {});

    // If comments came back 0 (not disabled), start watching for lazy-load
    if (!comments || comments === 0) {
      setTimeout(startCommentObserver, 1000);
    }

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

  // ─── MutationObserver ─────────────────────────────────────────────────
  // Watches for YouTube lazy-loading the comment count into the DOM.
  // When it appears (e.g. after scrolling in playlist mode), re-runs the
  // scraper and updates the widget if the count was previously 0 or null.

  let commentObserver = null;

  function startCommentObserver() {
    if (commentObserver) {
      commentObserver.disconnect();
      commentObserver = null;
    }

    const target = document.querySelector("#comments, ytd-comments");
    if (!target) return;

    commentObserver = new MutationObserver(() => {
      const comments = scrapeComments();
      if (comments && comments > 0 && lastResult) {
        // Comments have loaded — recompute and update widget
        const widget = document.getElementById(WIDGET_ID);
        if (!widget) return;

        const { inputs } = lastResult;
        if (inputs.comments === 0 || inputs.comments === null) {
          console.debug(`[YTEV] MutationObserver caught comment count: ${comments}`);
          lastResult = YTVerdict.compute(inputs.views, inputs.likes, inputs.dislikes, comments);
          if (lastResult.verdict) {
            const newWidget = renderWidget(lastResult, activeSelectors.version);
            widget.parentNode.insertBefore(newWidget, widget);
            widget.remove();
          }
        }

        // Stop observing once we have a count
        commentObserver.disconnect();
        commentObserver = null;
      }
    });

    commentObserver.observe(target, { childList: true, subtree: true, characterData: true });
    console.debug("[YTEV] MutationObserver watching for comment count...");
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  // Load selectors first, then start watching the page.
  // On cold browser load, YouTube's own rendering may not be complete even
  // after DOMContentLoaded — watch for the video title to confirm readiness.

  async function init() {
    await loadSelectors();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => setTimeout(run, 1500));
    } else {
      // DOM is ready but YouTube may still be rendering
      // Watch for the video title element as a readiness signal
      const titleEl = document.querySelector("h1.ytd-watch-metadata, ytd-watch-metadata h1");
      if (titleEl && titleEl.textContent.trim()) {
        // Title already rendered — run with a short delay
        setTimeout(run, 500);
      } else {
        // Title not yet rendered — watch for it
        const readyObserver = new MutationObserver(() => {
          const title = document.querySelector("h1.ytd-watch-metadata, ytd-watch-metadata h1");
          if (title && title.textContent.trim()) {
            readyObserver.disconnect();
            setTimeout(run, 500);
          }
        });
        readyObserver.observe(document.body, { childList: true, subtree: true });
        // Fallback — run after 3 seconds regardless
        setTimeout(() => {
          readyObserver.disconnect();
          run();
        }, 3000);
      }
    }
  }

  init();

})();

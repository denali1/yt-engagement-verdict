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
  const SELECTOR_TTL_MS  = 24 * 60 * 60 * 1000;
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
      "ytd-comments-header-renderer h2 span",
      "#comments ytd-comments-header-renderer span.count-text",
      "ytd-comments-header-renderer #count"
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

  let activeSelectors = FALLBACK_SELECTORS;

  async function loadSelectors() {
    try {
      // Check cache first
      const stored = await browser.storage.local.get(SELECTOR_CACHE_KEY);
      const cached = stored[SELECTOR_CACHE_KEY];

      if (cached && cached.selectors && cached.fetchedAt) {
        const age = Date.now() - cached.fetchedAt;
        if (age < SELECTOR_TTL_MS) {
          activeSelectors = cached.selectors;
          console.debug(`[YTEV] Using cached selectors v${cached.selectors.version} (${Math.round(age / 60000)}m old)`);
          return activeSelectors;
        }
      }

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

      await browser.storage.local.set({
        [SELECTOR_CACHE_KEY]: { selectors: remote, fetchedAt: Date.now() }
      });

      activeSelectors = remote;
      console.debug(`[YTEV] Loaded remote selectors v${remote.version}`);
      return activeSelectors;

    } catch (err) {
      console.debug(`[YTEV] Selector fetch failed (${err.message}), using fallback`);
      activeSelectors = FALLBACK_SELECTORS;
      return activeSelectors;
    }
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

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

  /**
   * querySelector that can't kill a scrape. selectors.json is remote and
   * community-edited — a malformed selector throws SyntaxError. Log the
   * offending selector and fall through to the next one in the list.
   */
  function safeQuery(sel) {
    try {
      return document.querySelector(sel);
    } catch (e) {
      if (e instanceof SyntaxError) {
        console.debug(`[YTEV] Bad selector "${sel}": ${e.message}`);
        return null;
      }
      throw e;
    }
  }

  function scrapeViews() {
    for (const sel of activeSelectors.views) {
      const el = safeQuery(sel);
      if (el) {
        const val = parseYTNumber(el.textContent);
        if (val !== null) return val;
      }
    }
    return null;
  }

  function scrapeLikes() {
    for (const sel of activeSelectors.likes) {
      const el = safeQuery(sel);
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
      const val = parseYTNumber(el.textContent);
      if (val !== null && val > 0) return val;
      const countEl = el.closest("ytd-toggle-button-renderer")
        ?.querySelector("span.yt-core-attributed-string");
      if (countEl) {
        const v = parseYTNumber(countEl.textContent);
        if (v !== null && v > 0) return v;
      }
    }
    return null;
  }

  // Sentinel value meaning comments are intentionally disabled — not a scrape failure
  const COMMENTS_DISABLED = -1;

  function scrapeComments() {
    // Check if comments are turned off before trying selectors
    const msg = safeQuery("ytd-message-renderer");
    if (msg && /comments are turned off/i.test(msg.textContent)) {
      return COMMENTS_DISABLED;
    }
    for (const sel of activeSelectors.comments) {
      const el = safeQuery(sel);
      if (el) {
        const val = parseYTNumber(el.textContent);
        if (val !== null) return val;
      }
    }
    return null;
  }

  function scrapeAiLabel() {
    const container = activeSelectors.ai_label_container
      ? safeQuery(activeSelectors.ai_label_container)
      : safeQuery("ytd-structured-description-content-renderer");
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
    widget.setAttribute("data-score", pct);
    widget.setAttribute("data-max", maxScore);
    // CSS can't range-match attribute values, so the bar-colour band mirrors
    // the scoreToVerdict thresholds (≤20/≤55/≤90/>90); data-score stays the
    // raw percentage. Absolute composite was wrong here — maxScore varies.
    widget.setAttribute("data-band", pct <= 20 ? 0 : pct <= 55 ? 1 : pct <= 90 ? 2 : 3);

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

    // Comments pending note
    if (result.commentsPending) {
      const pendingNote = make("div", "ytev-ryd-note ytev-ryd-missing");
      pendingNote.textContent = "Scroll down to load comment data — score will update automatically";
      details.appendChild(pendingNote);
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
      const el = safeQuery(selector);
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
    await attempt(videoId);
  }

  async function attempt(videoId) {
    const views    = scrapeViews();
    const likes    = scrapeLikes();
    const comments = scrapeComments();

    if ((views === null || likes === null || likes === 0 || comments === null) && comments !== COMMENTS_DISABLED && retryCount < RETRY_LIMIT) {
      retryCount++;
      retryTimer = setTimeout(() => attempt(videoId), RETRY_MS);
      return;
    }

    const rydData     = await RYD.fetchDislikes(videoId);
    const dislikes    = rydData ? rydData.dislikes : null;
    const isAiContent = scrapeAiLabel();

    const commentsValue = comments === COMMENTS_DISABLED ? null : (comments ?? 0);
    lastResult = YTVerdict.compute(views ?? 0, likes ?? 0, dislikes, commentsValue);
    lastResult.commentsDisabled = comments === COMMENTS_DISABLED;
    lastResult.isAiContent = isAiContent;
    lastResult.commentsPending = !comments || comments === 0;

    if (lastResult.error || !lastResult.verdict) return;

    // Report anonymously if user has opted in and reporter.js loaded
    if (typeof Reporter !== "undefined") {
      Reporter.report(videoId, lastResult).catch(() => {});
    }

    if (!comments || comments === 0) {
      commentObserverTimer = setTimeout(startCommentObserver, 2000);
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
    lastResult = null;
    clearTimeout(retryTimer);
    retryTimer = null;
    retryCount = 0;
    clearTimeout(commentObserverTimer);
    commentObserverTimer = null;
    teardownCommentObserver();
    document.getElementById(WIDGET_ID)?.remove();
    setTimeout(run, 800);
  }

  window.addEventListener("yt-navigate-finish", onNavigate);
  window.addEventListener("popstate", onNavigate);

  // URL polling fallback — checks every 500ms if the URL has changed.
  // Lightweight since it's just a string comparison. Does nothing on
  // non-watch pages.
  let lastUrl = location.href;
  setInterval(() => {
    const currentUrl = location.href;
    if (currentUrl === lastUrl) return;
    lastUrl = currentUrl;
    if (!currentUrl.includes("youtube.com/watch")) {
      // Left a video page — drop state so a return to watch re-runs cleanly
      currentVideoId = null;
      document.getElementById(WIDGET_ID)?.remove();
      return;
    }
    onNavigate();
  }, 500);

  // ─── Comment Observer ─────────────────────────────────────────────────────
  // Uses IntersectionObserver — fires when the user naturally scrolls to the
  // comments section. No forced scrolling, no disruption to video playback.
  // Once in view, a narrow MutationObserver on the count element waits for
  // the lazy-loaded count and updates the widget when it appears.

  let commentObserver = null;
  let commentObserverTimer = null;
  let commentObserverTimeout = null;
  let commentIntersectionObs = null;

  function teardownCommentObserver() {
    if (commentObserver) {
      commentObserver.disconnect();
      commentObserver = null;
    }
    if (commentObserverTimeout) {
      clearTimeout(commentObserverTimeout);
      commentObserverTimeout = null;
    }
    if (commentIntersectionObs) {
      commentIntersectionObs.disconnect();
      commentIntersectionObs = null;
    }
  }

  function startCommentObserver() {
    commentObserverTimer = null;
    teardownCommentObserver();

    const commentsEl = safeQuery("#comments");
    if (!commentsEl) return;

    commentIntersectionObs = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      commentIntersectionObs.disconnect();
      commentIntersectionObs = null;

      // Comments are now in view — watch the count element for the
      // lazy-loaded number to appear. Prefer #count; fall back to the
      // header it lives in since the count element may not exist yet.
      const target = safeQuery("#comments #count") ||
        safeQuery("ytd-comments-header-renderer");
      if (!target) return;

      commentObserver = new MutationObserver(() => {
        if (RYD.getVideoId() !== currentVideoId) {
          teardownCommentObserver();
          return;
        }

        const comments = scrapeComments();
        if (comments && comments > 0 && lastResult) {
          teardownCommentObserver();

          const widget = document.getElementById(WIDGET_ID);
          const { inputs } = lastResult;
          if (inputs.comments === 0 || inputs.comments === null) {
            lastResult = YTVerdict.compute(inputs.views, inputs.likes, inputs.dislikes, comments);
            lastResult.commentsDisabled = false;
            lastResult.commentsPending = false;
            lastResult.isAiContent = lastResult.isAiContent || false;
            if (lastResult.verdict) {
              const newWidget = renderWidget(lastResult, activeSelectors.version);
              if (widget && widget.parentNode) {
                widget.parentNode.insertBefore(newWidget, widget);
                widget.remove();
              } else {
                injectWidget(newWidget);
              }
            }
          }
        }
      });

      // Structural changes only — the count node's subtree is all we need
      commentObserver.observe(target, { childList: true, subtree: true });

      // Bounded safety — disconnect if the count never arrives
      commentObserverTimeout = setTimeout(teardownCommentObserver, 8000);

    }, { threshold: 0.1 });

    commentIntersectionObs.observe(commentsEl);
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  // Load selectors first, then start watching the page.
  // On cold browser load, YouTube's own rendering may not be complete even
  // after DOMContentLoaded — watch for the video title to confirm readiness.

  async function init() {
    await loadSelectors();

    // Cold load strategy:
    // 1. If DOM still loading, wait for DOMContentLoaded then run
    // 2. If DOM ready, watch for YouTube's title element to confirm rendering
    // 3. Also listen for window.load as a final fallback
    // 4. Hard fallback at 4 seconds regardless

    let hasRun = false;

    function runOnce() {
      if (hasRun) return;
      hasRun = true;
      run();
    }

    // window.load fires after everything including YouTube's JS
    window.addEventListener("load", () => setTimeout(runOnce, 800));

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => setTimeout(runOnce, 1500));
    } else if (document.readyState === "interactive") {
      window.addEventListener("load", () => setTimeout(runOnce, 500));
    } else {
      const titleEl = safeQuery("h1.ytd-watch-metadata, ytd-watch-metadata h1");
      if (titleEl && titleEl.textContent.trim()) {
        setTimeout(runOnce, 300);
      } else {
        const readyObserver = new MutationObserver(() => {
          const title = safeQuery("h1.ytd-watch-metadata, ytd-watch-metadata h1");
          if (title && title.textContent.trim()) {
            readyObserver.disconnect();
            setTimeout(runOnce, 300);
          }
        });
        readyObserver.observe(document.body, { childList: true, subtree: true });
        // Hard fallback
        setTimeout(() => {
          readyObserver.disconnect();
          runOnce();
        }, 4000);
      }
    }
  }

  init();

})();

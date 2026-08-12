/**
 * chrome/content.js
 * YT Engagement Verdict — Chrome MV3 Content Script
 *
 * Identical to content.js but uses chrome.* instead of browser.*
 * MV3 message listeners use sendResponse callback pattern.
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
      const stored = await chrome.storage.local.get(SELECTOR_CACHE_KEY);
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

      if (
        !remote.version ||
        !Array.isArray(remote.views) ||
        !Array.isArray(remote.likes) ||
        !Array.isArray(remote.comments) ||
        !Array.isArray(remote.inject_before)
      ) {
        throw new Error("Remote selectors failed shape validation");
      }

      await chrome.storage.local.set({
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

  function scrapeViews() {
    for (const sel of activeSelectors.views) {
      const el = document.querySelector(sel);
      if (el) {
        const val = parseYTNumber(el.textContent);
        if (val !== null) return val;
      }
    }
    for (const span of document.querySelectorAll("span")) {
      if (/\d[\d,.]*(K|M|B)?\s+views/i.test(span.textContent)) {
        return parseYTNumber(span.textContent);
      }
    }
    return null;
  }

  function scrapeLikes() {
    for (const sel of activeSelectors.likes) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const label = el.getAttribute("aria-label") || "";
      const labelMatch = label.match(/([\d,.]+[KMBkmb]?)/);
      if (labelMatch) {
        const val = parseYTNumber(labelMatch[1]);
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

  const COMMENTS_DISABLED = -1;

  function scrapeComments() {
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

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

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

    const widget = document.createElement("div");
    widget.id = WIDGET_ID;
    widget.setAttribute("data-score", composite);
    widget.setAttribute("data-max", maxScore);

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

    const scoreRow = make("div", "ytev-score-row");
    const barWrap = make("div", "ytev-bar-wrap");
    barWrap.title = `${composite}/${maxScore} signals`;
    const barFill = make("div", "ytev-bar-fill");
    barFill.style.width = `${pct}%`;
    barWrap.appendChild(barFill);
    scoreRow.appendChild(barWrap);
    scoreRow.appendChild(make("span", "ytev-score-text", `${composite}/${maxScore}`));
    widget.appendChild(scoreRow);

    widget.appendChild(make("p", "ytev-description", verdict.description));

    const details = make("div", "ytev-details");
    details.hidden = true;

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

    if (result.commentsDisabled) {
      const commentsNote = make("div", "ytev-ryd-note ytev-ryd-missing");
      commentsNote.textContent = "Comments are turned off — comment rate signal excluded";
      details.appendChild(commentsNote);
    }

    if (result.commentsPending) {
      const pendingNote = make("div", "ytev-ryd-note ytev-ryd-missing");
      pendingNote.textContent = "Scroll down to load comment data — score will update automatically";
      details.appendChild(pendingNote);
    }

    const rydNote = make("div", hasSentiment ? "ytev-ryd-note" : "ytev-ryd-note ytev-ryd-missing");
    if (hasSentiment) {
      rydNote.appendChild(document.createTextNode("Dislikes via "));
      rydNote.appendChild(makeLink("https://returnyoutubedislike.com", "Return YouTube Dislike"));
    } else {
      rydNote.textContent = "Dislike data unavailable — sentiment signal excluded";
    }
    details.appendChild(rydNote);

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

    if ((views === null || likes === null || likes === 0 || comments === null || comments === 0) && comments !== COMMENTS_DISABLED && retryCount < RETRY_LIMIT) {
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

    Reporter.report(videoId, lastResult).catch(() => {});

    if (!comments || comments === 0) {
      setTimeout(startCommentObserver, 2000);
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

  // ─── Message Listener ────────────────────────────────────────────────────
  // Chrome MV3 uses callback-based sendResponse — must return true for async

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "GET_VERDICT") {
      sendResponse(lastResult || null);
    }
    if (msg.type === "GET_SELECTOR_VERSION") {
      sendResponse({ version: activeSelectors.version });
    }
    if (msg.type === "FORCE_SELECTOR_REFRESH") {
      chrome.storage.local.remove(SELECTOR_CACHE_KEY, () => {
        loadSelectors().then(() => sendResponse({ ok: true, version: activeSelectors.version }));
      });
      return true;
    }
  });

  // ─── Navigation Listeners ─────────────────────────────────────────────────

  function onNavigate() {
    currentVideoId = null;
    setTimeout(run, 800);
  }

  window.addEventListener("yt-navigate-finish", onNavigate);
  window.addEventListener("popstate", onNavigate);

  let lastUrl = location.href;
  setInterval(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      if (currentUrl.includes("youtube.com/watch")) {
        onNavigate();
      } else {
        currentVideoId = null;
        document.getElementById(WIDGET_ID)?.remove();
      }
    }
  }, 1000);

  // ─── MutationObserver ─────────────────────────────────────────────────────

  let commentObserver = null;

  function startCommentObserver() {
    if (commentObserver) {
      clearInterval(commentObserver);
      commentObserver = null;
    }

    const commentsEl = document.querySelector("#comments");
    if (!commentsEl) return;

    // Use IntersectionObserver — fires when user naturally scrolls to comments
    // No forced scrolling, no disruption to video playback
    const intersectionObs = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      intersectionObs.disconnect();

      // Comments are now in view — poll for the count to populate
      let attempts = 0;
      const MAX_ATTEMPTS = 20;

      commentObserver = setInterval(() => {
        attempts++;
        const comments = scrapeComments();

        if (comments && comments > 0 && lastResult) {
          clearInterval(commentObserver);
          commentObserver = null;

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
          return;
        }

        if (attempts >= MAX_ATTEMPTS) {
          clearInterval(commentObserver);
          commentObserver = null;
        }
      }, 300);

    }, { threshold: 0.1 });

    intersectionObs.observe(commentsEl);
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

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
